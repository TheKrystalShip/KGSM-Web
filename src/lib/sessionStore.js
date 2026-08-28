import { api } from "./apiClient.js";
import { takePendingTokens } from "./authRedirect.js";
import { REGISTRY_KEY, originOfHost } from "./config.js";
import { createStore } from "./store.js";
import { hostsStore } from "./stores.js";

// sessionStore.js — per-host identity sessions (Model A: per-host auth-code
// flow + silent SSO). See architecture.html §6·a.
//
// ── Session model: the API is the authority ─────────────────────────────────
// The client does NOT predict token expiry. It uses whatever access token it
// holds and lets the API be the judge. The whole freshness story is two moves:
//   • rotate()   — exchange the long-lived refresh token for a fresh access token
//   • authorize()— ensure a live session exists (rotate, or bootstrap via /me)
// REST heals reactively: a 401 RESPONSE (apiClient's withRetry) → rotate → replay.
// SSE streams carry the bearer as an Authorization header; a 401 response is
// readable and heals through the same reactive path as every REST call.
//
// The Discord LOGIN is GLOBAL — one live session at discord.com, the SSO anchor.
// Each HOST then mints its OWN short-lived, host-scoped bearer after verifying
// that identity once (/users/@me, then the token is discarded) and resolving the
// user's role via the host's own bot. This store holds those per-host sessions.
//
// Storage:
//   • ACCESS token  → sessionStorage, per host. Short-lived; survives an in-tab
//              reload, gone on tab close.
//   • REFRESH token → localStorage, per host. The long-lived (weeks) "stay signed
//              in" credential — it MUST survive a browser close so a user returning
//              days later silently rotates a fresh access token instead of re-doing
//              Discord (user directive 2026-06-23: trusted, role-restricted friends
//              group → convenience > a strict refresh window). Cleared on explicit
//              sign-out (signOut / forgetHosts). The access token still never
//              leaves sessionStorage.
//   • host URL registry → localStorage (URLs only) so a reload re-bootstraps
//              silently against the hosts you already added.
//
// Status per host:
//   none          never bootstrapped on this host
//   bootstrapping the silent (or interactive) authorize is in flight
//   live          we hold a bearer (or the host is auth-disabled) — calls allowed
//   expired       the bearer lapsed and could NOT be silently rotated — the UI
//                 offers Re-authorize (NOT terminal)
//   denied        identity verified but role insufficient on this host (403) —
//                 TERMINAL. Never auto-re-auth (that would loop forever).
//
// `expired` is written on EVERY 401 the seam then heals: an access token lives 15
// minutes, so an open panel passes through it four times an hour and is back to
// `live` one rotation later. The status itself is instantaneous and true — the
// seam needs it that way — but a surface that ASKS THE USER to re-authorize must
// not appear for a round-trip. That is what `reauthDue` below is for.

  const TOKEN_PREFIX = "krystal:hostsession:";    // sessionStorage (access token + meta)
  const REFRESH_PREFIX = "krystal:hostrefresh:";  // localStorage (long-lived refresh token)
  // REGISTRY_KEY (localStorage, URLs only) is owned by config.js — the base layer
  // reads it to derive the connection set; we write it on connect/forget.

  const store = createStore({ byHost: {} });

  const inflight = {};   // hostId → in-flight authorize/rotate (dedupe concurrent gate/boot calls)
  const getRec = (id) => store.getState().byHost[id] || null;
  const statusOf = (id) => (getRec(id) ? getRec(id).status : "none");
  const isDenied = (id) => statusOf(id) === "denied";
  const isLive = (id) => statusOf(id) === "live";
  const tierOf = (id) => { const r = getRec(id); return r ? r.tier : null; };
  // The live bearer for a host (the seam injects it on every call). Null unless we
  // actually hold one — auth-disabled hosts are "live" with no token.
  const tokenOf = (id) => { const r = getRec(id); return r && r.status === "live" ? (r.token || null) : null; };

  // Decode a JWT's `exp` (seconds → ms), library-free; null if the token isn't a parseable JWT (e.g. an
  // opaque/auth-disabled bearer). Used ONLY to decide a PROACTIVE rotate for the two non-replayable chat
  // calls (the SSE turn + the single-use blueprint finalize) — the rest of the app stays reactive (heals
  // on the API's 401), so this is not general expiry prediction, just the edge those two calls can't reach.
  function jwtExpMs(token) {
    try {
      const seg = token.split(".")[1];
      const json = JSON.parse(atob(seg.replace(/-/g, "+").replace(/_/g, "/")));
      return typeof json.exp === "number" ? json.exp * 1000 : null;
    } catch { return null; }
  }
  // True when a live host's ACCESS token has lapsed (or is within a 30s skew of it) — the signal to
  // rotate BEFORE a non-replayable call instead of letting it 401. An opaque/absent token → false (nothing
  // to predict; fall back to the reactive path).
  function accessTokenLapsed(id) {
    const tok = tokenOf(id);
    if (!tok) return false;
    const expMs = jwtExpMs(tok);
    return expMs != null && Date.now() >= expMs - 30000;
  }

  function setRec(id, partial, persist) {
    store.setState(s => ({ byHost: { ...s.byHost, [id]: { ...(s.byHost[id] || {}), ...partial } } }));
    if (persist) writeSession(id);
    syncReauthSurfacing(id);
    return getRec(id);
  }

  // ---- reauthDue: the SURFACING gate for `expired` ------------------------
  // The record carries `reauthDue` — an expired session that has stayed expired
  // for REAUTH_SURFACE_MS, i.e. one the reactive rotate did NOT heal. Every
  // surface that reports a lapsed session to the user (the node-access notice,
  // the auth badge, the cluster chip's degraded count, the auto-logout) keys on
  // THIS, never on `status === "expired"`; the seam's own gating keeps keying on
  // the raw status, which stays instant. The delay is longer than any rotation
  // (one POST /auth/session/refresh) by orders of magnitude, so the routine
  // 15-minute renewal passes under it silently, while a session that genuinely
  // needs the user is still named — 30s later, with the panel meanwhile showing
  // the last state it measured rather than a wrong one.
  const REAUTH_SURFACE_MS = 30000;
  const surfaceTimers = {};

  function clearSurfaceTimer(id) {
    if (!surfaceTimers[id]) return;
    clearTimeout(surfaceTimers[id]);
    delete surfaceTimers[id];
  }
  function setReauthDue(id, due) {
    const rec = getRec(id);
    if (!rec || !!rec.reauthDue === due) return;
    store.setState(s => (s.byHost[id]
      ? { byHost: { ...s.byHost, [id]: { ...s.byHost[id], reauthDue: due } } }
      : s));
  }
  // Called after every record write: start the countdown on entering `expired`, and stop
  // it only when the session actually comes back.
  //
  // `bootstrapping` deliberately does NOT stop it. An attempt in flight is not a
  // recovery — and every retry passes through that status on its way back to `expired`,
  // so treating it as one restarts the countdown from zero each time. A revoked session
  // is retried by the SSE stream's own reconnect backoff, which tops out at 12s and never
  // gives up, so the 30s never elapsed and a session that was dead for good stayed
  // silently "expired" forever while the panel showed stale data behind a connectivity
  // banner. What is being measured is how long since this session last WORKED.
  //
  // Writes through store.setState directly — routing it back through setRec would recurse.
  function syncReauthSurfacing(id) {
    const status = statusOf(id);
    if (status === "bootstrapping") return;           // an attempt, not an outcome
    if (status !== "expired") { clearSurfaceTimer(id); setReauthDue(id, false); return; }
    const rec = getRec(id);
    if (rec.reauthDue || surfaceTimers[id]) return;   // already surfaced, or already counting
    surfaceTimers[id] = setTimeout(() => {
      delete surfaceTimers[id];
      // Only a session that came back cancels this. Still expired, or mid-retry having
      // been expired, both mean it never healed.
      if (statusOf(id) === "live" || statusOf(id) === "denied") return;
      setReauthDue(id, true);
    }, REAUTH_SURFACE_MS);
  }

  // ---- sessionStorage (access token) -------------------------------------
  function writeSession(id) {
    const r = getRec(id);
    try {
      if (!r || (r.status !== "live" && r.status !== "denied")) { sessionStorage.removeItem(TOKEN_PREFIX + id); return; }
      // Persist only what a tab-reload needs to resume without a re-bounce. No exp
      // field — the token carries its own; a shadow copy is the drift footgun.
      //
      // `account` rides along because a `none` tier is two facts and only this one
      // separates them: waiting on an admin, or unknown on this host. Dropping it meant a
      // reload resumed with it undefined, and the panel told somebody who was waiting
      // that no account existed for them — opposite advice, from the same tier.
      sessionStorage.setItem(TOKEN_PREFIX + id, JSON.stringify({
        status: r.status, tier: r.tier || null, token: r.token || null,
        account: r.account || null,
      }));
    } catch {}
  }
  function readSession(id) {
    try {
      const raw = sessionStorage.getItem(TOKEN_PREFIX + id);
      if (!raw) return null;
      const r = JSON.parse(raw);
      // A persisted live session reads back live and heals reactively on first 401.
      // No lapsed-token expiry flip — the API is the authority.
      return r;
    } catch { return null; }
  }
  function forgetSession(id) { clearSurfaceTimer(id); try { sessionStorage.removeItem(TOKEN_PREFIX + id); } catch {} forgetRefresh(id); }

  // ---- refresh token (localStorage — survives a browser close) -----------
  // The long-lived credential. Stored ONLY here (never in the sessionStorage
  // record's persisted shape), read by rotate() to exchange for an access token.
  function writeRefresh(id, token) {
    try { if (token) localStorage.setItem(REFRESH_PREFIX + id, token); else localStorage.removeItem(REFRESH_PREFIX + id); } catch {}
  }
  function readRefresh(id) { try { return localStorage.getItem(REFRESH_PREFIX + id) || null; } catch { return null; } }
  function forgetRefresh(id) { try { localStorage.removeItem(REFRESH_PREFIX + id); } catch {} }

  // ---- host URL registry (localStorage, URLs only) -----------------------
  function readRegistry() {
    try { return JSON.parse(localStorage.getItem(REGISTRY_KEY) || "[]"); } catch { return []; }
  }
  function writeRegistry(list) { try { localStorage.setItem(REGISTRY_KEY, JSON.stringify(list)); } catch {} }
  function register(host) {
    // The registry stores the CONNECTION ORIGIN we actually reach this host at — an
    // explicit url if the caller has one, else the origin we're ALREADY talking to it
    // on (originOfHost). NEVER the backend's self-reported hostname/id (not a reachable
    // URL). A host we hold no connection for ⇒ don't write.
    const url = host.url || originOfHost(host.id);
    if (!url || !/^https?:\/\//i.test(url)) return;
    const list = readRegistry().filter(h => h.id !== host.id);
    list.push({ id: host.id, url, name: host.name || host.label || host.id });
    writeRegistry(list);
  }

  // ---- bootstrap (resolve identity + tier from GET /me) ------------------
  // Resolves to 'live' | 'expired'. Adopts a token just handed back by the OAuth
  // fragment redirect (if any), then confirms identity + tier via /me. Auth-disabled
  // hosts answer 200 tier=admin with no token; an auth-enabled host with no bearer
  // answers 401 → 'expired'/login_required and the UI bounces to Discord (the OAuth
  // fragment redirect lands the session back through completeOAuthLogin).
  function bootstrap(id) {
    setRec(id, { status: "bootstrapping", error: null });

    // Adopt a token just handed back by the OAuth fragment redirect, if any, BEFORE
    // /me so the bearer rides the tier call (auth-enabled hosts need it; auth-disabled
    // ignores it).
    const pending = takePendingTokens();
    if (pending && pending.access) {
      writeRefresh(id, pending.refresh || null);   // persist for the days-later rotation
      setRec(id, { status: "live", token: pending.access, refresh: pending.refresh || null, tier: "none", error: null });
    }
    // Privileged, UN-FUNNELED identity probe: pass the bearer we hold explicitly
    // (api.meWith) so liveFetch SKIPS the egress funnel. Routing /me through the funnel
    // would re-enter authorize()→bootstrap and recurse.
    const probe = getRec(id);
    return api.meWith(probe && probe.token, id).then(me => {
      const cur = getRec(id);
      setRec(id, {
        status: "live", tier: (me && me.tier) || "none",
        // What the node says about the ACCOUNT behind this session, so a `none` tier can
        // be explained rather than just enforced.
        account: (me && me.status) || "unknown",
        token: (cur && cur.token) || (me && me.token) || null,
        refresh: (cur && cur.refresh) || null, error: null,
      }, true);
      return "live";
    }, err => {
      // Three different answers, kept apart. 403 is the node ANSWERING and
      // refusing the role — terminal, and re-signing in changes nothing. 401 is
      // a lapsed sign-in, which one gesture fixes. Anything else means we never
      // got an answer, so we know nothing about whether we'd be let in and say
      // exactly that rather than guessing at either.
      const code = err && (typeof err.code === "number" ? err.code : err.status);
      if (code === 403) { setRec(id, { status: "denied", error: "forbidden" }); return "denied"; }
      setRec(id, { status: "expired", error: code === 401 ? "login_required" : "unreachable" });
      return "expired";
    });
  }

  // ---- adopt (a session established OUT of band, e.g. the OAuth landing) --
  // completeOAuthLogin (authRedirect) already exchanged the Discord code → it holds
  // the real bearer + the tier from /me. Set the live session DIRECTLY here —
  // deterministically, before the app mounts — so the first host-scoped call finds
  // status:"live" + a token and never races a second bootstrap. Persists so an in-tab
  // reload resumes with no bounce.
  function adoptSession(id, sess) {
    sess = sess || {};
    writeRefresh(id, sess.refresh || null);
    setRec(id, {
      status: "live", token: sess.token || null, refresh: sess.refresh || null,
      tier: sess.tier || "none", account: sess.account || "unknown", error: null,
    }, true);
    return getRec(id);
  }

  // ---- vouch (lazy cluster SSO — mint a session on a sibling node) -------
  // SPA-C1: the SPA holds no session on `targetId`, but it IS logged into another node
  // in the same cluster. Ask that live sibling to vouch the user onto the target
  // (api.vouch → POST /auth/cluster-session/request); adopt the minted tokens, then
  // resolve the tier from the target's /me (the vouch result carries no tier). Returns
  // true ONLY when a fresh session was minted — so apiClient's withRetry replays exactly
  // once and never loops (a target that is already live, or has no live sibling, gets a
  // fast `false`, leaving the ordinary rotate/expired path untouched). Concurrent callers
  // for the same target share one in-flight vouch, so a fan-out of 401s mints one session.
  const vouchInflight = {};
  function vouch(targetId) {
    if (!targetId || statusOf(targetId) === "live") return Promise.resolve(false);
    if (vouchInflight[targetId]) return vouchInflight[targetId];
    // The voucher is any OTHER node we already hold a live session on (same trust domain).
    const source = readRegistry().map(h => h && h.id).filter(Boolean)
      .find(sid => sid !== targetId && isLive(sid));
    if (!source) return Promise.resolve(false);
    const p = api.vouch(source, targetId).then(res => {
      if (!res || !res.accessToken) return false;
      adoptSession(targetId, { token: res.accessToken, refresh: res.refreshToken || null });
      // Tier isn't in the vouch result — resolve it from the target's /me with the
      // freshly-adopted bearer (un-funneled: pass the token explicitly, like bootstrap).
      return api.meWith(res.accessToken, targetId).then(
        me => {
          setRec(targetId, {
            tier: (me && me.tier) || "none", account: (me && me.status) || "unknown",
          }, true);
          return true;
        },
        () => true,   // the session is live even if the tier probe hiccups; gating heals later
      );
    }, () => false);
    vouchInflight[targetId] = p;
    p.then(() => { if (vouchInflight[targetId] === p) delete vouchInflight[targetId]; },
           () => { if (vouchInflight[targetId] === p) delete vouchInflight[targetId]; });
    return p;
  }

  // ---- rotate (exchange the refresh token for a fresh access token) ------
  // The ONLY renewal path. Reactive: called when the API rejects the current token
  // (HTTP 401 → withRetry) or when the WS pre-dial gate finds the token's own exp has
  // passed. The refresh token rides as the bearer (api.refreshSession) — no Discord
  // round-trip. Past the refresh token's absolute cap the backend 401s → we surface
  // 'expired' and the UI offers re-auth. Concurrent callers share ONE in-flight
  // rotation so we mint a single access token, not four.
  function rotate(id) {
    const rec = getRec(id);
    if (!rec || rec.status === "denied") return Promise.resolve(statusOf(id));
    if (inflight[id]) return inflight[id];
    const refreshTok = (rec && rec.refresh) || readRefresh(id);
    // No refresh token to exchange (e.g. an auth-disabled host, or a legacy
    // pre-fix session) — fall back to re-confirming identity via GET /me.
    if (!refreshTok) return bootstrap(id);
    const p = api.refreshSession(id, refreshTok).then(
      res => {
        // tier rides the refresh response, which is what resolves the role for UI gating on the
        // RETURNING-VISITOR path (cold boot: no in-memory tier after a browser close, /me skipped).
        // The node answers with the tier the account holds NOW, so it is adopted as given and a
        // demotion lands exactly like a promotion. A response that OMITS it leaves what we already
        // hold — an absent field is a node that said nothing, not a role that was taken away.
        const cur = getRec(id);
        const tier = (res && res.tier) || (cur && cur.tier) || "none";
        // ROLLING REFRESH (kgsm-api M4·c 4·b): the backend now ROTATES the refresh token on
        // every rotate — the token we just sent is dead (reuse detection), and the response
        // carries a fresh one in `res.refresh`. ADOPT it (persist to localStorage so a
        // browser-close-then-return rotates the LIVE token, not the stale one that 401s). Fall
        // back to the sent token only if an older backend omits `refresh` (non-rotating).
        const newRefresh = (res && res.refresh) || refreshTok;
        if (res && res.refresh) writeRefresh(id, res.refresh);
        setRec(id, { status: "live", token: (res && res.token) || null, refresh: newRefresh, tier, error: null }, true);
        return "live";
      },
      () => {
        // Refresh token invalid or past the absolute cap → genuinely expired. Drop
        // the dead credential so we don't retry it; the UI offers re-auth.
        forgetRefresh(id);
        setRec(id, { status: "expired", refresh: null, error: "login_required" });
        return "expired";
      }
    );
    inflight[id] = p;
    p.then(() => { if (inflight[id] === p) delete inflight[id]; }, () => { if (inflight[id] === p) delete inflight[id]; });
    return p;
  }

  // ---- authorize (ensure a live session) ---------------------------------
  // The gate's entry point (apiClient's bearer funnel + boot). SILENT recovery only:
  // if the discord.com SSO anchor is gone, silent SSO answers 'login_required' and we
  // return 'expired' so the seam fails the call and the UI offers Re-authorize (we do
  // NOT auto-escalate to an interactive consent — that needs a user gesture). A live
  // session returns immediately WITHOUT touching the network — no proactive refresh;
  // a lapsed live token is rotated only on the API's 401 (REST) or the WS pre-dial gate.
  function authorize(id) {
    const st = statusOf(id);
    if (st === "live") return Promise.resolve("live");
    if (st === "denied") return Promise.resolve("denied");
    // De-dupe concurrent first-use calls (the boot fan-out + the funnel can hit a host
    // several times at once) onto ONE in-flight bootstrap/rotate. rotate() self-registers
    // in inflight; bootstrap() does not, so we guard either way below.
    if (inflight[id]) return inflight[id];
    // Returning visitor: the access session (sessionStorage) is gone after a browser
    // close, but a long-lived refresh token survives in localStorage. Rotate it into a
    // fresh access token SILENTLY — no Discord bounce, no doomed /me 401.
    let p;
    if (readRefresh(id)) {
      if (!getRec(id)) setRec(id, { status: "bootstrapping" });
      p = rotate(id);
    } else {
      p = bootstrap(id);
    }
    if (!inflight[id]) {
      inflight[id] = p;
      p.then(() => { if (inflight[id] === p) delete inflight[id]; }, () => { if (inflight[id] === p) delete inflight[id]; });
    }
    return p;
  }

  // ---- authorizeFresh (expiry-AWARE authorize, for non-replayable calls) --
  // authorize() is reactive: a "live" host is handed out AS-IS and only rotated once the API 401s. That's
  // right for REST (it replays), but the SSE turn and the single-use blueprint finalize can't safely replay
  // through the expired-gate — so THOSE resolve their bearer through here instead. A live session whose
  // access token has lapsed is rotated (via the refresh token) BEFORE the call, so the request goes out once
  // with a fresh token and the session never even transiently flips to "expired" (no re-auth flash in the
  // chat). rotate() sets "expired" only when the refresh token is ALSO dead — the honest case that DOES need
  // re-auth. Everything else is untouched and stays reactive.
  function authorizeFresh(id) {
    const st = statusOf(id);
    if (st === "live") return accessTokenLapsed(id) ? rotate(id) : Promise.resolve("live");
    if (st === "denied") return Promise.resolve("denied");
    return authorize(id);   // not live yet → the ordinary bootstrap/rotate path
  }

  // ---- reauthorize (re-read /me for one host, on demand) ----
  // The user clicked "Re-authorize". Re-run identity resolution; an auth-enabled host
  // that still 401s drives the UI back to the Discord OAuth bounce.
  function reauthorize(id) { return bootstrap(id); }
  // A host whose session lapsed and could NOT be silently renewed → the UI shows the
  // expired surface + Re-authorize. (denied is terminal and handled apart.) Keyed on
  // `reauthDue`, so a lapse the seam rotates away in a round-trip never asks the user
  // for anything — see the surfacing gate above.
  function needsReauth(id) { const r = getRec(id); return !!(r && r.reauthDue); }

  // ---- me.patch: the node stating this session's role, live -----------------
  // The node pushes `{tier, status}` on the `me` topic when the account behind THIS session is
  // regraded, and the push is the AUTHORITY — it is the node's current answer, so it is written as
  // given and a demotion lands exactly like a promotion. Persisted, so an in-tab reload resumes at
  // the tier the node last stated rather than the one this session opened with.
  //
  // Only a genuine DELTA is announced. A frame restating the tier already held is not one, and a
  // host with no tier yet has nothing to have changed from — somebody who was granted nothing is
  // not told their access changed.
  //
  // Gating needs no listener: every gate reads `tierOf` through persona.js on each render, and the
  // record write below re-renders the tree. The listeners are for the two things a re-render cannot
  // do — say so out loud, and leave a route this role can no longer occupy.
  const tierListeners = new Set();
  function onTierChange(fn) { tierListeners.add(fn); return () => tierListeners.delete(fn); }

  function applyMePatch(id, patch) {
    if (!id || !patch) return;
    const before = tierOf(id);
    setRec(id, { tier: patch.tier || "none", account: patch.status || "unknown" }, true);
    const after = tierOf(id);
    if (before == null || before === after) return;
    for (const fn of tierListeners) { try { fn({ hostId: id, from: before, to: after }); } catch {} }
  }

  // Mark a host's session expired (apiClient's withRetry calls this on a mid-flight
  // 401 before its one silent-rotate replay).
  function expire(id) { setRec(id, { status: "expired", error: "expired" }, true); }

  function forgetHosts() {                           // drop every host → app shows the Add-host intermediate
    Object.keys(store.getState().byHost).forEach(forgetSession);
    writeRegistry([]);
    store.setState({ byHost: {} });
    hostsStore.setState(s => ({ ...s, list: [] }));
  }
  // Sign out: drop EVERY per-host credential (access in sessionStorage + the long-lived
  // refresh token in localStorage) so a reload can't silently rotate back in — but KEEP
  // the host registry so the user lands on the host's login, not the add-host screen.
  function signOut() {
    const ids = new Set([
      ...Object.keys(store.getState().byHost),
      ...readRegistry().map(h => h.id).filter(Boolean),
    ]);
    ids.forEach(forgetSession);
    store.setState({ byHost: {} });
  }

  // ---- init: resume persisted sessions for the hosts we know about --------
  // A persisted (in-tab) session resumes with no bounce; otherwise the host is left
  // unbootstrapped and the reactive block below authorizes it from GET /me as the host
  // list hydrates. NEVER fabricate a tier/token from host flags.
  function seed() {
    // Resume persisted sessions for every host known at boot — both the (async-hydrating)
    // host list AND the localStorage registry. The registry carries the stable host id
    // BEFORE the GET /hosts round-trip lands, so a same-origin reload restores its access
    // token + tier IMMEDIATELY (no Viewer flash / no doomed unauthenticated call).
    const ids = new Set([
      ...(hostsStore.getState().list || []).map(h => h && h.id),
      ...readRegistry().map(h => h && h.id),
    ].filter(Boolean));
    const live = {};
    ids.forEach(id => { const p = readSession(id); if (p) live[id] = p; });
    store.setState({ byHost: live });
  }

  // Public surface.
  store.statusOf = statusOf;
  store.isDenied = isDenied;
  store.isLive = isLive;
  store.tierOf = tierOf;
  store.tokenOf = tokenOf;
  store.bootstrap = bootstrap;
  store.adoptSession = adoptSession;
  store.vouch = vouch;
  store.rotate = rotate;
  store.authorize = authorize;
  store.authorizeFresh = authorizeFresh;
  store.reauthorize = reauthorize;
  store.needsReauth = needsReauth;
  store.register = register;
  store.readRegistry = readRegistry;
  store.expire = expire;
  store.applyMePatch = applyMePatch;
  store.onTierChange = onTierChange;
  store.forgetHosts = forgetHosts;
  store.signOut = signOut;

  const sessionStore = store;
  // Human-readable tier labels, shared by the badge + settings.
  const TIER_LABEL = { admin: "Admin", operator: "Operator", viewer: "Viewer", none: "No role" };

  // Restoring persisted sessions is a pure storage read that asks nothing of any host, so
  // it stays at import: the gate needs to know on its first render whether this browser
  // already holds a session, without a round trip.
  seed();

  // Authorize each host's tier from GET /me as the host list hydrates. hostsStore loads
  // async, so seed() runs before the host exists — without this the gated surfaces would
  // stay at tier `none` and redirect to the viewer home. Idempotent: only hosts with no
  // session are authorized (authorize flips status off `none` synchronously).
  //
  // Unlike seed(), this TALKS to hosts, so it does not run at import — a browser on the
  // sign-in screen would spend it bootstrapping sessions for a node nobody has chosen.
  // The shell starts it with the rest of the data layer.
  const bootstrapNewHosts = () => {
    (hostsStore.getState().list || []).forEach(h => {
      if (statusOf(h.id) === "none") { register(h); authorize(h.id); }
    });
  };

  // The `me` topic rides the same start/stop, and for the same reason: it is this store's live half,
  // carrying the node's own re-statement of the tier the sweep above resolves once. It is a global
  // topic on the primary stream, so subscribing costs a listener and no socket, and the frame is
  // delivered by the node only to this account's connections — one that arrives is about the reader.
  let unsubscribeBootstrap = null;
  let unsubscribeMe = null;
  store.startBootstrap = () => {
    if (unsubscribeBootstrap) return;
    unsubscribeBootstrap = hostsStore.subscribe(bootstrapNewHosts);
    bootstrapNewHosts();
    unsubscribeMe = api.stream.subscribe(["me"], (m) => {
      if (m && m.type === "me.patch" && m.data && m.hostId) applyMePatch(m.hostId, m.data);
    });
  };
  store.stopBootstrap = () => {
    if (!unsubscribeBootstrap) return;
    unsubscribeBootstrap();
    unsubscribeBootstrap = null;
    if (unsubscribeMe) { unsubscribeMe(); unsubscribeMe = null; }
  };

export { TIER_LABEL, sessionStore };
