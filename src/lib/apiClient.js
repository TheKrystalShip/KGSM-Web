import { createStore } from "./store.js";
import { apiV1Of, apiOriginOf, apiV1ForConn, streamUrlForConn, subscribeConnections, CONNECTIONS } from "./config.js";
import { DEVICE_HEADER, deviceId } from "./device.js";
import * as adapt from "./adapters.js";
import { createSseStream } from "./liveStream.js";

// alertsStore + sessionStore are used only inside request methods (deferred,
// `?`-guarded). Static imports would put this base module in init cycles
// (apiClient<->alertsApi, apiClient->sessionStore->stores->apiClient), so
// resolve them lazily after the module graph settles.
let alertsStore = null;
import("./alertsApi.js").then((m) => { alertsStore = m.alertsStore; });
let sessionStore = null;
// Keep the import promise: the egress funnel (authorizedBearer) AWAITS it so the
// FIRST WS dial — which runs synchronously during this module's eval, before this
// lazy import can resolve — doesn't fall through to a tokenless connect and 401.
const sessionReady = import("./sessionStore.js").then((m) => { sessionStore = m.sessionStore; });
// Lazy: apiClient is the base layer; it touches the domain stores only in
// deferred call-time paths (request handlers + the realtime wiring). A static
// import would re-form the apiClient<->stores init cycle.
let storesNs = null;
import("./stores.js").then((m) => {
  storesNs = m;
  // The first WS open can land before the host list hydrates → re-key the realtime
  // indicator under the real host id once hosts arrive (single-host; multi-host
  // fan-out is a later slice). Reuses this one dynamic import.
  if (primaryStreams.length && m.hostsStore) {
    try { m.hostsStore.subscribe(() => primaryStreams.forEach((s, i) => setLiveRealtime(CONNECTIONS[i] && CONNECTIONS[i].id, s.mode()))); } catch {}
  }
});

// apiClient.js — the single seam between the client and the backend.
//
// Everything that talks to the server goes through `api`: REST over fetch
// (translated by adapters.js) and realtime over one WebSocket per connected host
// (liveStream.js). The call sites (the domain stores) only ever see `api`. See
// architecture.html (§3, §3·b).

  // ---- connection health (drives the resilience layer) -------------------
  // connectionStore is REST reachability, the reactive signal the shell reads:
  // 'connecting' (booting), 'live' (reachable), 'down' (unreachable). `everLoaded`
  // separates a COLD start (never succeeded → full takeover) from a WARM drop
  // (succeeded before → non-blocking banner). Updated as a side effect of traffic.
  //
  // Reachability is tracked PER CONNECTION (the `hosts` map) and the global summary
  // is AGGREGATED from it: 'live' when ANY connection answers, 'down' ONLY when every
  // known connection is unreachable. This mirrors realtimeStore's per-host model —
  // one down host (a federated peer that's offline, a background fan-out probe that
  // fails) must never flip the whole shell to "Can't reach Krystal" while the host
  // you're actually on is fine. Its own surfaces carry the per-host degraded state.
  const connectionStore = createStore({
    status: "connecting",
    everLoaded: false,
    failures: 0,
    retrying: false,
    hosts: {},   // per-connection reachability: { [hostId]: "live" | "down" }
  });

  // ---- realtime channel health (PER-HOST WebSocket + the browser online state) --
  // Distinct from REST reachability above. realtimeStore answers "is the live
  // PUSH channel up?" — and that channel is PER HOST: the panel is a sink
  // aggregating N hosts, each running its own agent over its own WebSocket. One
  // host's link can drop while the others keep streaming, so there is no single
  // global "live" state — only `online` (does the BROWSER have a network at all?)
  // plus a per-host socket mode. When a host's link drops we don't blank its data:
  // on reconnect the socket re-subscribes + re-hydrates the REST stores. This is
  // the "Realtime fallback" promised in architecture.html (§3·j).
  //
  //   per host →  'live'         socket connected, that host is pushing
  //               'reconnecting' its link dropped but we're online — backing off
  //   global   →  'offline'      the browser itself reports no network
  const nav = (typeof navigator !== "undefined") ? navigator : { onLine: true };
  let online = nav.onLine !== false;
  const realtimeStore = createStore({ online, hosts: {} });

  // ---- fan-out reach (what an aggregated read actually got) ---------------
  // A read spanning N nodes comes back partial when a node is unreachable,
  // refuses the session, or errors: the rows that node owns are simply absent.
  // On a list with no node dimension on screen that is indistinguishable from
  // "those servers are gone" — a fabricated state. So every fan-out records its
  // per-node outcome here and the aggregated surfaces disclose it. Absence of
  // data is never the signal; this is the measurement.
  //   ok           the node answered
  //   unreachable  transport failure — no answer at all
  //   unauthorized the node refused the session (401/403)
  //   error        the node answered, with a failure
  // Keyed by the connection's URL, not its id: a connection's backend id is null
  // until GET /hosts reconciles it, so id-keying would strand the reads taken
  // before that under a second key and inflate the node count. The URL is the
  // one identity that holds from the first request. `id` rides along for label
  // resolution and can fill in later.
  const reachStore = createStore({ byHost: {} });
  function reachReason(err) {
    if (!err) return "unreachable";
    // `preflight` means the call never left: the session couldn't be established.
    // That covers a node that is simply down (its /me probe can't complete) as
    // well as one whose session is dead, so it must NOT be reported as the node
    // refusing us — we never got to ask it.
    if (err.preflight) return "unauthenticated";
    if (err.code === 401 || err.code === 403) return "unauthorized";
    if (typeof err.code === "number") return "error";
    return "unreachable";   // ECONNREFUSED / EOFFLINE / a thrown transport error
  }
  function recordReach(conn, ok, err) {
    const key = (conn && conn.url) || "_default";
    const reason = ok ? null : reachReason(err);
    const id = (conn && conn.id) || null;
    const prev = reachStore.getState().byHost[key];
    if (prev && prev.ok === ok && prev.reason === reason && prev.id === id) return;   // steady state → no churn
    reachStore.setState(s => ({
      byHost: { ...s.byHost, [key]: { ok, reason, id, name: (conn && conn.name) || null, at: Date.now() } },
    }));
  }

  // The connection a call routed to; a falsy / aggregate ("all") id folds onto the
  // sole-connection default key so N=1 (and unscoped calls) attribute consistently.
  function connKey(hostId) { return (hostId && hostId !== "all") ? hostId : "_default"; }
  function downCount(hosts) { let n = 0; for (const k in hosts) if (hosts[k] === "down") n++; return n; }
  // 'live' if any connection is reachable, 'down' only when every one is, else the
  // cold pre-first-response 'connecting'.
  function aggregateStatus(hosts) {
    let anyLive = false, anyDown = false;
    for (const k in hosts) { if (hosts[k] === "live") anyLive = true; else if (hosts[k] === "down") anyDown = true; }
    return anyLive ? "live" : (anyDown ? "down" : "connecting");
  }
  function markSuccess(hostId) {
    const key = connKey(hostId);
    const s = connectionStore.getState();
    // Hot path: this host already live on an already-live warm shell → nothing to change.
    if (s.hosts[key] === "live" && s.status === "live" && s.everLoaded && !s.retrying) return;
    const hosts = { ...s.hosts, [key]: "live" };
    connectionStore.setState({ status: "live", everLoaded: true, failures: downCount(hosts), retrying: false, hosts });
  }
  function markFailure(hostId) {
    const key = connKey(hostId);
    const s = connectionStore.getState();
    const hosts = { ...s.hosts, [key]: "down" };
    // Global 'down' ONLY when no connection is reachable; one down host among healthy
    // ones keeps the shell live (that host's own surfaces show its degraded state).
    connectionStore.setState({ status: aggregateStatus(hosts), everLoaded: s.everLoaded, failures: downCount(hosts), retrying: false, hosts });
  }
  function netError() {
    const e = new Error("Can't reach the Krystal backend (network).");
    e.code = "ECONNREFUSED";
    e.userMessage = "Can't reach Krystal.";
    return e;
  }
  // Defensive: a stray call before any host is connected. The app shows the
  // connect screen before any data surface, so this is a backstop — an honest
  // "not connected", never silently invented data.
  function offlineError() {
    const e = new Error("No kgsm-api host is connected.");
    e.code = "EOFFLINE";
    e.userMessage = "Connect a host to get started.";
    return e;
  }

  // ---- REST transport ----------------------------------------------------
  // Hit a real kgsm-api over fetch and translate its honest DTOs into the shapes
  // the components read (see adapters.js). The connection signal tracks
  // REACHABILITY: any HTTP response (even 4xx/5xx) means the host answered →
  // markSuccess; only a transport throw is "down".
  function apiError(status, body) {
    const env = body && body.error ? body.error : {};
    const e = new Error(env.message || ("HTTP " + status));
    e.code = status;                 // numeric — the host-auth gate keys on 401/403
    e.envCode = env.code || null;
    e.status = status;
    e.userMessage = env.message || "The server returned an error.";
    // The envelope's optional `details` object, carried through verbatim. Some errors say more than a
    // sentence can — `blueprint_invalid` puts the ENGINE's own validator messages in `details.errors`,
    // and the blueprint editor renders them one per line. Dropping it here would leave the caller with
    // "the engine rejected this blueprint" and nothing about what to fix.
    e.details = env.details || null;
    return e;
  }
  // A host's bearer, when we hold a live one. Sessions are keyed by BACKEND HOST
  // ID, so the id must be the one the call is for — there is no ambient node to
  // borrow a token from, and sending one node's token to another is how a request
  // becomes both wrong and authenticated. No id (the cold-boot connection, before
  // GET /hosts names it) or the aggregate scope ⇒ no bearer. Null is also the
  // honest answer under KGSM_API_AUTH_DISABLED, where no token is minted at all
  // and the call goes out unauthenticated.
  function liveBearer(hostId) {
    try {
      if (sessionStore && sessionStore.tokenOf && hostId && hostId !== "all") return sessionStore.tokenOf(hostId);
    } catch {}
    return null;
  }
  // ---- the egress AUTH FUNNEL (the single chokepoint every request resolves its bearer through) ----
  // The model is REACTIVE — the API is the authority. This hands back the host's CURRENT access token
  // as-is; it does NOT check expiry. If the token has lapsed the API answers 401 and hostScoped.withRetry
  // rotates (via the refresh token) + replays — one round-trip, no client-side prediction. We only
  // (silently) authorize a session that isn't live yet, and THROW authError (tagged `preflight`, so the
  // host gate doesn't pointlessly re-retry) when it can't be made live. Returns null when the host needs
  // no bearer (auth-disabled). The auth layer's OWN calls (refreshSession, the bootstrap /me probe via
  // meWith) pass an explicit bearer and so SKIP this — that keeps the funnel from re-entering itself.
  async function authorizedBearer(hostId) {
    const id = hostId;
    // The FIRST WS/REST call can fire during apiClient's synchronous module eval — BEFORE the lazy
    // import("./sessionStore.js") above resolves — so without this await `sessionStore` is still null and
    // we'd fall through to a tokenless bearer → a guaranteed 401 on every fresh load, healed only by the
    // reconnect backoff. Awaiting the module-ready promise lets seed() restore the persisted session
    // first, so the first call already carries the token. Bounded: the module is in-bundle.
    if (!sessionStore) { try { await sessionReady; } catch {} }
    // No session layer (auth-disabled / still unavailable), no host scope, or the aggregate scope → fall
    // back to the sync best-effort bearer (null when none).
    if (!sessionStore || !sessionStore.authorize || !id || id === "all") return liveBearer(hostId);
    let st = sessionStore.statusOf(id);
    if (st !== "live") st = await sessionStore.authorize(id);   // rotate/bootstrap only when NOT already live
    if (st === "denied") { const e = authError(403, id); e.preflight = true; throw e; }
    if (st !== "live")   { const e = authError(401, id); e.preflight = true; throw e; }
    return sessionStore.tokenOf(id);   // may be a lapsed JWT — REST heals it reactively on the 401
  }
  // A call that couldn't be routed to a node. In prod apiV1Of/apiOriginOf answer
  // "" for a node we don't hold, and a relative fetch would quietly hit whatever
  // origin served the bundle — so stop here and say which node was asked for.
  function unroutedError(hostId) {
    const e = new Error(`No connection for node ${hostId ? `"${hostId}"` : "(unnamed)"}.`);
    e.code = "EUNROUTED";
    e.userMessage = "That node isn’t connected.";
    return e;
  }
  // hostId routes the call to that host's base URL + bearer. It is the NODE the
  // call is for: routing is exact (config.connOf), so an id we don't hold fails
  // here rather than landing on another node.
  async function liveFetch(method, path, body, hostId, bearerOverride, baseOverride) {
    const headers = body != null
      ? { "Content-Type": "application/json", Accept: "application/json" }
      : { Accept: "application/json" };
    // bearerOverride lets a caller send a specific bearer (the refresh-token
    // rotation needs the REFRESH token, not the access token the seam injects).
    // `undefined` = use the host's live access bearer; a string/null = send/omit as given.
    const tok = bearerOverride !== undefined ? bearerOverride : await authorizedBearer(hostId);
    if (tok) headers.Authorization = "Bearer " + tok;
    // Which BROWSER is asking, for the per-device half of the preference store. Sent on every call
    // rather than only the preference ones: it is one short header, and a seam that decides per path
    // which headers to attach is a seam that gets it wrong when a path moves.
    headers[DEVICE_HEADER] = deviceId();
    // baseOverride routes off the default /api/v1 base (the auth endpoints are
    // root-routed on the backend, not under /api/v1; the fan-out addresses an
    // as-yet-unidentified connection by its own URL).
    const base = baseOverride !== undefined ? baseOverride : apiV1Of(hostId);
    if (!base) throw unroutedError(hostId);
    // Serialize OUTSIDE the try below. Only a TRANSPORT throw is "the host is unreachable" —
    // a body that can't be serialized is a caller bug, and letting it land in that catch would
    // report a healthy backend as down (banner included) while hiding the real TypeError.
    const payload = body != null ? JSON.stringify(body) : undefined;
    let res;
    try {
      res = await fetch(base + path, { method, headers, body: payload });
    } catch { markFailure(hostId); throw netError(); }
    markSuccess(hostId);             // the host answered → reachable
    if (res.status === 204) return null;
    let json = null;
    try { json = await res.json(); } catch { json = null; }
    if (!res.ok) throw apiError(res.status, json);
    return json;
  }
  // Map a logical FE path onto its response adapter (GET only; writes pass
  // through). Match on the path WITHOUT its query string so paginated/filtered
  // reads (e.g. /alerts?status=resolved, /audit?cursor=…) still hit their adapter.
  function adaptResponse(path, json) {
    const base = path.split("?")[0];
    if (base === "/servers") return adapt.adaptServers(json);
    if (base === "/hosts") return adapt.adaptHosts(json);
    if (base === "/library") return adapt.adaptLibrary(json);
    if (base === "/audit") return adapt.adaptAudit(json);
    if (/^\/hosts\/[^/]+\/logs$/.test(base)) return adapt.adaptLogPage(json); // before /hosts/{id} → adaptHost
    if (/^\/hosts\/[^/]+\/services\/[^/]+\/config$/.test(base)) return adapt.adaptLeafConfig(json); // before /services → adaptServices
    if (/^\/hosts\/[^/]+\/services$/.test(base)) return adapt.adaptServices(json); // before /hosts/{id} → adaptHost
    if (base === "/alerts") return adapt.adaptAlerts(json);
    if (base === "/me") return adapt.adaptMe(json);
    // Before /servers/{id} → adaptServer, which would otherwise read this report as an instance and
    // return a server-shaped object with every field null. Relayed verbatim: the backend already
    // answers in the honest model this boundary exists to enforce — an unmeasurable availability is
    // null there — so there is nothing for an adapter to protect against.
    if (base === "/servers/availability") return json;
    if (/^\/servers\/[^/]+$/.test(base)) return adapt.adaptServer(json);
    if (/^\/hosts\/[^/]+$/.test(base)) return adapt.adaptHost(json);
    if (/^\/integrations\/[^/]+$/.test(base)) return adapt.adaptIntegration(json);
    return json;
  }
  const liveGet = (path, hostId) => liveFetch("GET", path, null, hostId).then((j) => adaptResponse(path, j));

  // A GET whose response is a FILE, not JSON — the console log download. It cannot be an <a href>:
  // every gated read carries a bearer, and a top-level navigation sends no Authorization header, so
  // the browser would fetch an anonymous 401 and save it. Streamed into a Blob here and handed to the
  // caller to save. Same routing and the same reachability bookkeeping as any other call.
  async function liveBlob(path, hostId) {
    const base = apiV1Of(hostId);
    if (!base) throw unroutedError(hostId);
    const tok = await authorizedBearer(hostId);
    const headers = {};
    if (tok) headers.Authorization = "Bearer " + tok;
    let res;
    try {
      res = await fetch(base + path, { method: "GET", headers });
    } catch { markFailure(hostId); throw netError(); }
    markSuccess(hostId);
    if (!res.ok) {
      let json = null;
      try { json = await res.json(); } catch { json = null; }
      throw apiError(res.status, json);
    }
    return res.blob();
  }
  const livePost = (path, body, hostId) => liveFetch("POST", path, body, hostId);
  const livePatch = (path, body, hostId) => liveFetch("PATCH", path, body, hostId);
  const livePut = (path, body, hostId) => liveFetch("PUT", path, body, hostId);
  const livedel = (path, hostId) => liveFetch("DELETE", path, null, hostId);

  // Rotate a host's access token from its long-lived refresh token (§6·a): POST
  // /auth/session/refresh with the REFRESH token as the bearer (NOT the access
  // token the seam would inject) → { token, tier }. No Discord round-trip. Past
  // the refresh token's absolute cap the backend 401s → the caller treats it as
  // genuinely expired. ⚠ The endpoint is ROOT-routed (/auth/session/refresh), NOT
  // under /api/v1 — so pass the bare origin as the base override.
  function refreshSession(hostId, refreshToken) {
    return liveFetch("POST", "/auth/session/refresh", null, hostId, refreshToken || null, apiOriginOf(hostId));
  }

  // Privileged, UN-FUNNELED identity probe for the session layer's bootstrap (sessionStore): pass the
  // bearer we hold explicitly (the access token, or null) so liveFetch SKIPS authorizedBearer. Routing
  // /me through the funnel would re-enter authorize()→bootstrap and recurse — so this is the
  // bootstrap's escape hatch, exactly as refreshSession is the refresh path's. Not for general call sites.
  function meWith(bearer, hostId) {
    return liveFetch("GET", "/me", null, hostId, bearer ?? null).then((j) => adaptResponse("/me", j));
  }

  // ---- latency probe ------------------------------------------------------
  // Round trip to one node, read by the dashboard's capacity strip, the cluster constellation
  // and diagnostics.
  // Measure the CLIENT-side round trip via a REST GET to /health on the host.
  // Returns the RTT in ms, or null on any failure → the KPI honestly reads "no
  // reading" (never a fabricated latency, never 0). Deliberately ISOLATED from
  // markSuccess/markFailure: ping is a side channel, not the cold-start signal.
  async function pingHost(hostId) {
    const base = apiOriginOf(hostId);
    if (!base) return null;
    try {
      const t0 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
      const res = await fetch(base + "/health");
      if (!res.ok) return null;
      const rtt = ((typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now()) - t0;
      return Math.round(rtt);
    } catch { return null; }
  }

  async function get(path, hostId) {
    if (!CONNECTIONS.length) return Promise.reject(offlineError());
    return liveGet(path, hostId);
  }
  async function patch(path, body, hostId) {
    if (!CONNECTIONS.length) return Promise.reject(offlineError());
    return livePatch(path, body, hostId);
  }
  async function post(path, body, hostId) {
    if (!CONNECTIONS.length) return Promise.reject(offlineError());
    return livePost(path, body, hostId);
  }
  async function put(path, body, hostId) {
    if (!CONNECTIONS.length) return Promise.reject(offlineError());
    return livePut(path, body, hostId);
  }
  async function del(path, hostId) {
    if (!CONNECTIONS.length) return Promise.reject(offlineError());
    return livedel(path, hostId);
  }

  // Root-routed counterparts to get/post: the session endpoints
  // (/auth/sessions, /auth/session/revoke, …) live at the bare origin, NOT
  // under /api/v1 (like refreshSession), but — unlike refreshSession/meWith —
  // callers here DO want the funnel: a live per-host bearer + the 401-heal in
  // sessionsScoped's withRetry below. Leaving bearerOverride undefined routes
  // liveFetch through authorizedBearer exactly like get/post do; only baseOverride
  // changes.
  async function rootGet(path, hostId) {
    if (!CONNECTIONS.length) return Promise.reject(offlineError());
    return liveFetch("GET", path, null, hostId, undefined, apiOriginOf(hostId));
  }
  async function rootPost(path, body, hostId) {
    if (!CONNECTIONS.length) return Promise.reject(offlineError());
    return liveFetch("POST", path, body, hostId, undefined, apiOriginOf(hostId));
  }
  async function rootPatch(path, body, hostId) {
    if (!CONNECTIONS.length) return Promise.reject(offlineError());
    return liveFetch("PATCH", path, body, hostId, undefined, apiOriginOf(hostId));
  }
  async function rootDel(path, hostId) {
    if (!CONNECTIONS.length) return Promise.reject(offlineError());
    return liveFetch("DELETE", path, null, hostId, undefined, apiOriginOf(hostId));
  }

  // ---- realtime transport (SSE streams, one primary + dynamic per host) ------
  // The primary stream carries a fixed global topic set and drives realtimeStore
  // mode + rehydrateAll on open. Resource-scoped topics (containing '/') get
  // their own ref-counted dynamic streams.
  const GLOBAL_TOPICS = ["servers", "jobs", "audit", "alerts", "console", "players", "batches"];
  const isResourceScoped = (t) => t.includes("/");

  const listeners = new Set();
  function dispatchMessage(full) {
    for (const l of listeners) if (l.topics.has(full.topic)) { try { l.fn(full); } catch {} }
  }
  const topicStillWanted = (topic) => {
    for (const l of listeners) if (l.topics.has(topic)) return true;
    return false;
  };

  // Reshape a server→client frame into the FE shapes the stores hold. Unknown
  // topics/types pass through untouched — a new server message must never crash an
  // old client (forward-compatible).
  //
  // `hostId` is the node whose socket delivered the frame, stamped on every
  // message: an event carries its origin so a listener never has to guess which
  // node produced it. Null only when the frame didn't come from a node's stream
  // (the dev __dispatch hook).
  function adaptStreamMessage(msg, hostId = null) {
    if (!msg) return msg;
    const { topic, type, data } = msg;
    const at = (d) => ({ topic, type, data: d, hostId });
    if (topic === "servers" && type === "server.patch") return at(adapt.adaptServer(data));
    if (topic === "jobs" && type === "job.patch") return at(adapt.adaptJob(data));
    if (topic === "alerts" && type === "alert.raise") return at(adapt.adaptAlert(data));
    if (type === "host.metrics" && /^hosts\/[^/]+\/metrics$/.test(topic || "")) return at(adapt.adaptHostMetrics(data));
    if (type === "capabilities.patch" && /^hosts\/[^/]+\/capabilities$/.test(topic || "")) return at(adapt.adaptCapabilities(data));
    if (type === "metrics.tick" && /^servers\/[^/]+\/metrics$/.test(topic || "")) return at(adapt.adaptServerMetrics(data));
    if (type === "metrics.roster" && topic === "servers/metrics") return at(adapt.adaptServerMetricsRoster(data));
    if (type === "log.line" && /^hosts\/[^/]+\/logs$/.test(topic || "")) return at(adapt.adaptLogLine(data));
    if (type === "service.patch" && /^hosts\/[^/]+\/services$/.test(topic || "")) return at(adapt.adaptService(data));
    return { ...msg, hostId };
  }

  // On every (re)open of the primary stream, re-hydrate the REST stores to catch
  // deltas missed while the stream was down (§3·j).
  function rehydrateAll() {
    ["serversStore", "hostsStore", "auditStore", "libraryStore", "batchesStore"].forEach(name => {
      const st = storesNs && storesNs[name];
      if (st && st.refresh) st.refresh().catch(() => {});
    });
    if (alertsStore && alertsStore.refresh) alertsStore.refresh().catch(() => {});
    // Services and host journals are keyed by host, and several nodes' worth can be held at once.
    // Re-hydrate EVERY key somebody is currently holding — refreshing only one would leave the rest
    // showing whatever they had before the stream dropped, with no sign that they had stopped
    // following. A key nobody holds is absent from the map and costs nothing.
    ["servicesStore", "logsStore"].forEach(name => {
      const st = storesNs && storesNs[name];
      const held = st && st.getState && st.getState().byHost;
      if (held) Object.keys(held).forEach(hostId => st.refresh(hostId).catch(() => {}));
    });
  }

  // Realtime state is keyed by the CONNECTION whose socket produced the mode —
  // never by "whichever node loaded first", which would report one node's link
  // under another's name. A connection with no backend id yet (cold boot) keys
  // under COLD_BOOT_KEY: its own state, attributed to nothing, until the hostsStore
  // subscription above re-emits it under the reconciled id.
  const COLD_BOOT_KEY = "_cold-boot";
  function setLiveRealtime(connId, mode) {
    const id = connId || COLD_BOOT_KEY;
    realtimeStore.setState((s) => ({ online, hosts: { ...s.hosts, [id]: { mode, attempts: 0, nextRetryInMs: 0, lastSyncAt: Date.now(), polling: mode === "reconnecting" } } }));
  }

  // Per-host primary + dynamic stream registries.
  let primaryStreams = [];      // one per connection
  const dynamicStreams = new Map(); // topic → { stream, refCount, hosts }

  // Open the primary SSE stream for a connection (global topics, drives mode + rehydrate).
  function openPrimary(conn) {
    const url = streamUrlForConn(conn, GLOBAL_TOPICS);
    if (!url) return null;
    return createSseStream({
      url,
      bearer: () => authorizedBearer(conn.id),
      onOpen: () => rehydrateAll(),
      onMessage: (raw) => dispatchMessage(adaptStreamMessage(raw, conn.id)),
      onMode: (m) => setLiveRealtime(conn.id, m),
      onUnauthorized: () => { if (sessionStore) sessionStore.expire(conn.id); },
    });
  }

  // Open a dynamic SSE stream for a resource-scoped topic on all connected hosts.
  // Before the streams are started the topic is recorded with no sockets, so a
  // subscription taken early is honoured by startStreams rather than silently lost.
  function openDynamic(topic) {
    const hosts = [];
    if (!streamsStarted) { dynamicStreams.set(topic, { hosts, refCount: 1 }); return; }
    for (const conn of CONNECTIONS) {
      const url = streamUrlForConn(conn, [topic]);
      if (!url) continue;
      const s = createSseStream({
        url,
        bearer: () => authorizedBearer(conn.id),
        onOpen: () => {},  // dynamic streams self-hydrate via REST
        onMessage: (raw) => dispatchMessage(adaptStreamMessage(raw, conn.id)),
        onMode: () => {},  // dynamic streams don't touch realtimeStore
        onUnauthorized: () => { if (sessionStore) sessionStore.expire(conn.id); },
      });
      hosts.push({ connId: conn.id, stream: s });
    }
    dynamicStreams.set(topic, { hosts, refCount: 1 });
  }

  // Close a dynamic stream for a topic.
  function closeDynamic(topic) {
    const entry = dynamicStreams.get(topic);
    if (!entry) return;
    for (const h of entry.hosts) { try { h.stream.close(); } catch {} }
    dynamicStreams.delete(topic);
  }

  const stream = {
    subscribe(topics, onMessage) {
      const entry = { topics: new Set(topics), fn: onMessage };
      listeners.add(entry);
      // Open dynamic streams for resource-scoped topics not yet covered.
      for (const t of topics) {
        if (!isResourceScoped(t)) continue;
        const existing = dynamicStreams.get(t);
        if (existing) { existing.refCount++; }
        else { openDynamic(t); }
      }
      return () => {
        listeners.delete(entry);
        // Dispose dynamic streams no longer wanted by any listener.
        for (const t of entry.topics) {
          if (!isResourceScoped(t)) continue;
          if (topicStillWanted(t)) continue;
          const existing = dynamicStreams.get(t);
          if (!existing) continue;
          existing.refCount--;
          if (existing.refCount <= 0) closeDynamic(t);
        }
      };
    },
  };

  // Whether the streams are running. They are NOT opened at import: a browser sitting
  // on the sign-in screen holds no session, so every dial would 401 into a backoff loop
  // that never succeeds and never stops — traffic on behalf of nobody, against a host
  // that has not been chosen yet. The shell starts them once there is an identity, and
  // stops them when there is not.
  let streamsStarted = false;

  function startStreams() {
    if (streamsStarted) return;
    streamsStarted = true;
    // One primary stream per connection, each feeding the SAME dispatchMessage seam.
    primaryStreams = CONNECTIONS.map((conn) => openPrimary(conn));
    // Any topic subscribed before the start dialled no sockets; give it them now,
    // keeping the ref count the subscribers already established.
    for (const [topic, entry] of [...dynamicStreams]) {
      if (entry.hosts.length) continue;
      const refCount = entry.refCount;
      dynamicStreams.delete(topic);
      openDynamic(topic);
      const opened = dynamicStreams.get(topic);
      if (opened) opened.refCount = refCount;
    }
  }

  function stopStreams() {
    if (!streamsStarted) return;
    streamsStarted = false;
    for (const s of primaryStreams) { try { if (s) s.close(); } catch {} }
    primaryStreams = [];
    for (const topic of [...dynamicStreams.keys()]) closeDynamic(topic);
  }

  // Cluster discovery grows the connection set in place. Give each new node the
  // same treatment the boot set got — its primary stream (pushed in order, so
  // primaryStreams stays index-aligned with CONNECTIONS for reconnectHost), plus
  // every dynamic topic a view is currently subscribed to, so a late-joining node
  // is not silently missing from an open subscription. Then re-hydrate: the
  // stores fan out over CONNECTIONS, so their current contents predate this node.
  //
  // The listener registers at import and no-ops until the streams are running, so a
  // node discovered before sign-in is simply picked up by startStreams' own sweep
  // over CONNECTIONS rather than needing a second path.
  subscribeConnections((added) => {
    if (!streamsStarted) return;
    for (const conn of added) {
      primaryStreams.push(openPrimary(conn));
      for (const [topic, entry] of dynamicStreams) {
        const url = streamUrlForConn(conn, [topic]);
        if (!url) continue;
        entry.hosts.push({
          connId: conn.id,
          stream: createSseStream({
            url,
            bearer: () => authorizedBearer(conn.id),
            onOpen: () => {},
            onMessage: (raw) => dispatchMessage(adaptStreamMessage(raw, conn.id)),
            onMode: () => {},
            onUnauthorized: () => { if (sessionStore) sessionStore.expire(conn.id); },
          }),
        });
      }
    }
    rehydrateAll();
  });

  // User-driven "Reconnect now" (the connectivity banner / per-host indicator):
  // drop the backoff and re-open that host's streams immediately.
  function reconnectHost(id) {
    const idx = CONNECTIONS.findIndex((c) => c.id === id);
    const s = idx >= 0 ? primaryStreams[idx] : null;
    if (s && s.reconnect) s.reconnect();
    // Also reconnect dynamic streams for this host.
    for (const [, entry] of dynamicStreams) {
      for (const h of entry.hosts) {
        if (h.connId === id && h.stream && h.stream.reconnect) h.stream.reconnect();
      }
    }
  }
  function reconnectAll() {
    primaryStreams.forEach((s) => s && s.reconnect && s.reconnect());
    for (const [, entry] of dynamicStreams) {
      for (const h of entry.hosts) { if (h.stream && h.stream.reconnect) h.stream.reconnect(); }
    }
  }

  // Browser network transitions are global (no network = every host link is down).
  // Offline → mark it; online → flip back and kick every socket to reconnect.
  function handleOffline() { online = false; realtimeStore.setState((s) => ({ ...s, online: false })); }
  function handleOnline() { online = true; realtimeStore.setState((s) => ({ ...s, online: true })); reconnectAll(); }
  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
  }

  // A backgrounded tab suspends the socket's reconnect backoff, so a long stint with the panel hidden
  // (e.g. while in-game) can leave a non-live socket sitting idle. On the tab becoming visible again,
  // nudge any non-live socket to reconnect NOW — its pre-dial gate (wsBearer) rotates a lapsed token
  // before redialing. REST needs nothing here: it heals reactively on its next 401.
  function handleVisible() {
    if (typeof document !== "undefined" && document.hidden) return;
    primaryStreams.forEach((s) => { if (s && s.mode && s.mode() !== "live" && s.reconnect) s.reconnect(); });
    for (const [, entry] of dynamicStreams) {
      for (const h of entry.hosts) { if (h.stream && h.stream.mode && h.stream.mode() !== "live" && h.stream.reconnect) h.stream.reconnect(); }
    }
  }
  if (typeof document !== "undefined" && document.addEventListener) {
    document.addEventListener("visibilitychange", handleVisible);
  }

  // ---- per-host auth gate (Model A) ---------------------------------------
  // api.host(id) is the host-scoped client: it injects that host's bearer and
  // enforces the 401/403/login_required state machine before any call. denied
  // → 403 (terminal); none/expired → lazily (re)bootstrap, then re-check.
  function hostAuthStatus(id) {
    try { return sessionStore ? sessionStore.statusOf(id) : "live"; } catch { return "live"; }
  }
  function authError(code, id) {
    const e = new Error(code === 403 ? "Forbidden on host " + id : "Unauthorized on host " + id);
    e.code = code; e.authState = code === 403 ? "denied" : "expired"; e.hostId = id;
    e.userMessage = code === 403 ? "You don’t have permission on this host." : "Your session expired.";
    return e;
  }
  function hostScoped(id) {
    if (!id) throw new Error("api.host() requires a concrete host id (got " + id + ")");
    // THE reactive heal — this is the whole REST freshness story (the API is the authority). The funnel
    // hands out the current token WITHOUT checking expiry; when it lapses the API answers 401, and HERE we
    // mark the host expired and replay once. The replay re-enters authorizedBearer → authorize → rotate
    // (via the refresh token), so a lapsed token self-heals in one extra round-trip — no client-side
    // expiry prediction anywhere. A funnel PRE-FLIGHT 401 (rotate already failed → session dead) is tagged
    // `preflight` and not retried — re-running it would just fail again; it propagates to the UI's re-auth.
    // Replay-on-401 is safe because every gated verb below is idempotent in effect at the kgsm layer for a
    // retry that only fires when the FIRST attempt was rejected unauthenticated; the SSE turn (not
    // idempotent) deliberately skips the replay.
    const withRetry = (call) => call().catch(async err => {
      if (!err || err.code !== 401 || !sessionStore) throw err;
      // Lazy cluster vouch (SPA-C1): this node has no session of its own, but the SPA
      // IS logged into a sibling in the same cluster — ask the sibling to vouch the user
      // onto this node, adopt the minted session, then retry ONCE. sessionStore.vouch
      // returns false fast when it can't (no live sibling / already live), so this is a
      // pure no-op at N=1 and can't loop (it only mints on a fresh, non-live target).
      if (sessionStore.vouch) {
        let vouched = false;
        try { vouched = await sessionStore.vouch(id); } catch { vouched = false; }
        if (vouched) return call();
      }
      // A funnel PRE-FLIGHT 401 (rotate already failed → session dead) isn't replayed —
      // re-running it just fails again; it propagates to the UI's re-auth.
      if (err.preflight) throw err;
      sessionStore.expire(id);
      return call();
    });
    return {
      // Every call carries THIS host's id → liveFetch routes to its base URL + the funnel-resolved
      // bearer (multi-host). Sole-connection fallback keeps N=1 identical.
      get: (p) => withRetry(() => get(p, id)),
      post: (p, b) => withRetry(() => post(p, b, id)),
      patch: (p, b) => withRetry(() => patch(p, b, id)),
      put: (p, b) => withRetry(() => put(p, b, id)),
      del: (p) => withRetry(() => del(p, id)),
      blob: (p) => withRetry(() => liveBlob(p, id)),
    };
  }

  // api.sessions(id) — the root-routed session-management surface (list/revoke
  // active sessions against kgsm-api's session endpoints). Root-routed
  // because these auth endpoints live at the bare origin, not under /api/v1
  // (rootGet/rootPost above); funneled (not the refreshSession/meWith bypass)
  // because every other call site here wants the live per-host bearer plus the
  // same 401→expire→replay heal hostScoped gives REST calls. Mirrors hostScoped's
  // withRetry verbatim rather than sharing it, since hostScoped's closure is
  // itself scoped to the get/post/patch/put/del set.
  function sessionsScoped(id) {
    if (!id) throw new Error("api.sessions() requires a concrete host id (got " + id + ")");
    const withRetry = (call) => call().catch(err => {
      if (!err || err.code !== 401 || err.preflight || !sessionStore) throw err;
      sessionStore.expire(id);
      return call();
    });
    return {
      // Self, or (admin) another user's sessions via ?userId=.
      list: (userId) => withRetry(() => rootGet("/auth/sessions" + (userId ? "?userId=" + encodeURIComponent(userId) : ""), id)).then(adapt.adaptSessions),
      // Self-revoke: {sid} one, {all:true} every session, {} the caller's own.
      revoke: (body) => withRetry(() => rootPost("/auth/session/revoke", body || {}, id)),
      // Admin: revoke any session cross-user.
      revokeSid: (sid) => withRetry(() => rootPost("/auth/sessions/" + encodeURIComponent(sid) + "/revoke", {}, id)),
      // Admin: log a user out everywhere.
      revokeUser: (userId) => withRetry(() => rootPost("/auth/users/" + encodeURIComponent(userId) + "/sessions/revoke-all", {}, id)),
    };
  }

  // api.users(id) — this host's KGSM accounts (/auth/users…, root-routed like the
  // session endpoints, not under /api/v1). Admin-gated server-side throughout, with
  // one exception: changePassword is the caller changing their own.
  //
  // Deliberately NOT behind a reactive store. Every other domain here is polled or
  // streamed because something else changes it; accounts change only when an admin
  // changes them, on this screen, and a cached list is then a list that can be stale
  // about who may do what. Each screen reads, and re-reads after it writes.
  function usersScoped(id) {
    const withRetry = (call) => call().catch((e) => {
      if (!(e && e.status === 401)) throw e;
      sessionStore.expire(id);
      return call();
    });
    const at = (userId) => "/auth/users/" + encodeURIComponent(userId);
    return {
      list: () => withRetry(() => rootGet("/auth/users", id)).then((r) => (r && r.data) || []),
      get: (userId) => withRetry(() => rootGet(at(userId), id)),
      create: (body) => withRetry(() => rootPost("/auth/users", body || {}, id)),
      update: (userId, body) => withRetry(() => rootPatch(at(userId), body || {}, id)),
      remove: (userId) => withRetry(() => rootDel(at(userId), id)),
      setPassword: (userId, password) => withRetry(() => rootPost(at(userId) + "/password", { password }, id)),
      // Self-service. The current password is required even though the caller holds a
      // live session — the backend refuses without it, and for the reason it should.
      changePassword: (currentPassword, newPassword) =>
        withRetry(() => rootPost("/auth/password", { currentPassword, newPassword }, id)),
    };
  }

  // api.identities(id) — the caller's OWN sign-in methods on this host (/auth/identities…,
  // root-routed like the session and account endpoints). Self-service throughout: an account
  // carries the tier, and only its holder changes what proves it.
  //
  // ⚠ The link flow is SAME-ORIGIN. `startDiscord` sets a one-time HttpOnly ticket cookie the
  // callback comes back with, and a cross-origin fetch does not store one — the deployed panel is
  // served by the API it talks to, which is what makes this work. Against a separately-served dev
  // API the start succeeds and the callback then honestly reports `invalid_state`.
  function identitiesScoped(id) {
    if (!id) throw new Error("api.identities() requires a concrete host id (got " + id + ")");
    const withRetry = (call) => call().catch((e) => {
      if (!(e && e.status === 401)) throw e;
      sessionStore.expire(id);
      return call();
    });
    return {
      list: () => withRetry(() => rootGet("/auth/identities", id)),
      // Prove the KGSM password again, opening the window both writes below need.
      reauth: (password) => withRetry(() => rootPost("/auth/reauth", { password }, id)),
      // Returns the URL to send the browser to. Navigating is the caller's — a bearer does not
      // survive a top-level navigation, so the start has to be an XHR and the bounce a location set.
      // The provider comes from the host's own list, never from a name written here.
      startLink: (provider) =>
        withRetry(() => rootPost(
          "/auth/identities/" + encodeURIComponent(provider) + "/start", {}, id)),
      unlink: (credentialId) =>
        withRetry(() => rootDel("/auth/identities/" + encodeURIComponent(credentialId), id)),
    };
  }

  // api.peers(id) — the cluster peers surface (/api/v1/peers…): admin CRUD over
  // this host's peer roster + the viewer-safe converged roster. v1-routed (get/
  // post/patch/del, not rootGet/rootPost) because peers live under /api/v1, not
  // at the bare origin. Mirrors sessionsScoped's withRetry verbatim (see its
  // comment) rather than sharing it — each scoped surface owns its own closure.
  function peersScoped(id) {
    if (!id) throw new Error("api.peers() requires a concrete host id (got " + id + ")");
    const withRetry = (call) => call().catch(err => {
      if (!err || err.code !== 401 || err.preflight || !sessionStore) throw err;
      sessionStore.expire(id);
      return call();
    });
    return {
      // Admin: this host's full peer roster.
      list: () => withRetry(() => get("/peers", id)).then(j => (j && j.peers) || []),
      // Viewer-safe: the converged cluster node list (no peer-management fields).
      roster: () => withRetry(() => get("/peers/roster", id)).then(j => (j && j.nodes) || []),
      // Admin: add a peer by seed URL (+ optional nickname); returns the raw added row.
      add: (url, nickname) => withRetry(() => post("/peers", { url, nickname: nickname || null }, id)),
      // Admin: drop a peer from this host's roster.
      remove: (peerId) => withRetry(() => del("/peers/" + encodeURIComponent(peerId), id)),
      // Admin: enable/disable a peer (the trust gate), without removing it.
      setEnabled: (peerId, enabled) => withRetry(() => patch("/peers/" + encodeURIComponent(peerId), { enabled: !!enabled }, id)),
      // Admin: on-demand latency probe for one peer.
      latency: (peerId) => withRetry(() => get("/peers/" + encodeURIComponent(peerId) + "/latency", id)),
    };
  }

  // Fan a GET across EVERY connection (multi-host roll-up). Returns
  // [{ conn, ok, data, err }] — per-connection failures captured, so one host
  // being down doesn't fail the whole read; the caller merges (lib/merge.js).
  //
  // A connection with a backend id goes through its scoped client (per-host
  // bearer + the 401 heal). One without an id yet is addressed by ITS OWN URL —
  // the node is named, it just isn't identified — and carries no bearer, because
  // sessions are keyed by host id and there is no token that belongs to it.
  function fanOut(path) {
    if (!CONNECTIONS.length) return Promise.resolve([{ conn: null, ok: false, err: offlineError(), data: null }]);
    const byUrl = (conn) => (p) =>
      liveFetch("GET", p, null, null, null, apiV1ForConn(conn)).then((j) => adaptResponse(p, j));
    return Promise.all(CONNECTIONS.map((conn) => {
      const client = conn.id ? hostScoped(conn.id) : { get: byUrl(conn) };
      return client.get(path).then(
        (data) => { recordReach(conn, true, null); return { conn, ok: true, data }; },
        (err) => { recordReach(conn, false, err); return { conn, ok: false, err, data: null }; },
      );
    }));
  }

  // Server-side sign-out for a host: revoke the CALLING session in the registry
  // (root-routed POST /auth/logout, funneled with the live bearer). Best-effort
  // — the caller drops its local tokens regardless; a 401 (already gone) or a
  // network error must never block the client-side logout.
  function logout(id) {
    if (!id) return Promise.resolve();
    return rootPost("/auth/logout", {}, id).catch(() => {});
  }

  // Cluster SSO vouch initiator (SPA-C1): ask a node the SPA IS logged into (sourceId)
  // to vouch the user onto another cluster node (targetNodeId). The source relays to the
  // target's node-to-node receiver and returns the target's freshly-minted session tokens
  // ({ accessToken, refreshToken, sid, expiresAt } — no tier; the caller resolves it via
  // /me on the target). Root-routed (/auth/cluster-session/request), funneled with the
  // source's live bearer; a lapsed source token heals with a single expire+replay.
  function vouch(sourceId, targetNodeId) {
    const call = () => rootPost("/auth/cluster-session/request", { nodeId: targetNodeId }, sourceId);
    return call().catch(err => {
      if (err && err.code === 401 && !err.preflight && sessionStore) { sessionStore.expire(sourceId); return call(); }
      throw err;
    });
  }

  const api = {
    get, post, patch, put, del, stream, fanOut, refreshSession, meWith, pingHost, logout, vouch,
    host: hostScoped,
    sessions: sessionsScoped,
    users: usersScoped,
    identities: identitiesScoped,
    peers: peersScoped,
    reconnectHost, reconnectAll,
    startStreams, stopStreams,
    __hostAuth: hostAuthStatus,
    // Test/dev affordance: inject a RAW server→client frame through the full live
    // path (adapt → dispatch), exactly as the WebSocket would. Lets the smoke
    // verify the server.patch/server.removed/job.patch remaps deterministically.
    // `hostId` is the node the frame is delivered AS — a real socket always stamps one, so a check
    // that reads the origin off a message has to be able to state it here too.
    __dispatch: (raw, hostId = null) => dispatchMessage(adaptStreamMessage(raw, hostId)),
  };

export { api, connectionStore, reachStore, realtimeStore };
