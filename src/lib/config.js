// config.js — runtime wiring config: the set of kgsm-api hosts the SPA talks to.
//
// The SPA is a multi-host client (one kgsm-api == one host's aggregator): the
// source of truth is a RUNTIME registry of connected hosts in localStorage.
// There is no single global base URL; each host carries its own. An empty
// registry means no host is connected yet → the app shows the connect screen.
//
//   VITE_API_BASE — OPTIONAL single-host SEED (origin, no /api/v1). When the
//                   registry is empty it stands in as one connection — how the
//                   smoke:live harness points the app at a backend, and a handy
//                   dev shortcut.
//
// CONNECTIONS is seeded once at module load and then GROWS IN PLACE as cluster
// discovery converges on the roster: the array identity never changes, so every
// consumer that holds the import — routing, fan-out, the SSE registry — sees a
// node the moment it is registered. Connect and disconnect still do a FULL PAGE
// RELOAD (they change identity and auth, exactly as login / logout / session-loss
// do); an appended peer needs no reload because nothing about the session changes.
// Subscribe with subscribeConnections() to hold per-connection resources.

const env = (typeof import.meta !== "undefined" && import.meta.env) || {};

function clean(u) { return (u || "").trim().replace(/\/+$/, ""); }

// The host-URL registry (URLs only, never tokens). Shared with sessionStore,
// which writes it; config OWNS the key so the base layer can read it with no
// import cycle. Shape: [{ id, url, name }] — `id` is the BACKEND host id (from
// probing GET /hosts at connect time), `url` an origin (with or without scheme).
export const REGISTRY_KEY = "krystal:hosts:registry";

function readRegistry() {
  try {
    const arr = JSON.parse((typeof localStorage !== "undefined" && localStorage.getItem(REGISTRY_KEY)) || "[]");
    // Self-heal: a registry URL is always a full http(s) ORIGIN (connect.js stores `new URL().origin`).
    // A scheme-less entry (e.g. a bare "hotrod") is a corruption artifact — it would resolve to
    // https://hotrod via originOf and break every call. Drop it so the seed / connect screen take over.
    return Array.isArray(arr) ? arr.filter(h => h && h.url && /^https?:\/\//i.test(h.url)) : [];
  } catch { return []; }
}

// Optional single-host seed from the build/dev env (also the smoke:live lever).
// SAME-ORIGIN deployment: when kgsm-api serves this bundle at / and the API under /api/v1 on
// the SAME host, build with VITE_API_BASE="self" (or "same-origin") — the seed then resolves to
// the origin that served the page (window.location.origin), so the bundle carries no baked URL
// and talks to wherever it was loaded from. Any other value is used verbatim (a full origin).
const RAW_SEED = clean(env.VITE_API_BASE);
const SEED_URL = /^(self|same-origin)$/i.test(RAW_SEED)
  ? (typeof location !== "undefined" ? clean(location.origin) : "")
  : RAW_SEED;

// The connection set the app drives. Real registry wins; otherwise the seed
// stands in as one connection with NO known backend id yet (id:null) — the
// cold-boot exemption in connOf() routes it id-agnostically until GET /hosts
// reconciles the real id. A registry entry already carries its probed id
// (connect resolves it).
const registry = readRegistry();
export const CONNECTIONS = registry.length
  ? registry.map(h => ({ id: h.id || null, url: h.url, name: h.name || null }))
  : (SEED_URL ? [{ id: null, url: SEED_URL, name: null, seed: true }] : []);

// ---- growing the connection set (cluster discovery) ---------------------
// Notified with the connections just appended. The SSE registry uses this to
// open a stream per new node and re-hydrate; nothing here fetches by itself.
const connListeners = new Set();
export function subscribeConnections(fn) {
  connListeners.add(fn);
  return () => connListeners.delete(fn);
}

// Append the connections the app doesn't already drive. Dedupe is by normalized
// ORIGIN and by backend id, so a node already reachable under a URL we hold is
// never added twice — that keeps repeated roster polls idempotent. Returns the
// entries actually added, so a caller can tell "converged" from "nothing new".
export function addConnections(entries) {
  const added = [];
  for (const e of (entries || [])) {
    const url = clean(e && e.url);
    if (!url) continue;
    const o = originOf(url);
    if (CONNECTIONS.some(c => originOf(c.url) === o)) continue;
    if (e.id && CONNECTIONS.some(c => c.id && c.id === e.id)) continue;
    const conn = { id: e.id || null, url, name: e.name || null };
    CONNECTIONS.push(conn);
    added.push(conn);
  }
  if (added.length) connListeners.forEach(fn => { try { fn(added); } catch {} });
  return added;
}

// Normalize a stored host URL to an http(s) origin. A URL with an explicit
// scheme is kept verbatim (the seed is a full URL, e.g. http://127.0.0.1:8097);
// a bare host (the registry stores these) defaults to https.
function originOf(url) {
  const u = clean(url);
  if (!u) return "";
  return /^https?:\/\//i.test(u) ? u : "https://" + u;
}

// ---- routing: a call names the node it is for ----------------------------
// The SPA drives N nodes. Routing is EXACT — an id that matches no connection is
// a routing failure, never a cue to pick one, because reading node A's data under
// node B's name is worse than reading nothing. In DEV that throws, so the bug
// surfaces at its source; in PROD it returns null and the call fails honestly
// (an empty base is rejected by liveFetch).
const DEV = !!env.DEV;
function unrouted(why) {
  const msg = `kgsm-web routing: ${why} — ${CONNECTIONS.length} connection(s) configured`;
  if (DEV) throw new Error(msg);
  try { console.error(msg); } catch {}
  return null;
}

// Resolve a connection by BACKEND host id.
//
// The ONE documented exemption is COLD BOOT: a lone connection whose backend id
// isn't known yet (the VITE_API_BASE seed, or a registry entry before GET /hosts
// reconciles it). There is nothing to match an id against and only one node it
// could mean, so it answers to any id; the exemption ends the moment
// reconcileConnectionId lands or a second node joins.
//
// A node-less call against a lone IDENTIFIED connection still resolves — one node
// is unambiguous — but it is a latent bug that breaks the moment the cluster grows,
// so dev says so loudly. At N ≥ 2 it is simply unrouted.
function connOf(hostId) {
  if (hostId) {
    const c = CONNECTIONS.find(c => c.id === hostId);
    return c || unrouted(`no connection is registered for node "${hostId}"`);
  }
  if (CONNECTIONS.length === 1 && CONNECTIONS[0].id == null) return CONNECTIONS[0];  // cold boot
  if (!CONNECTIONS.length) return null;      // not connected at all — callers guard on CONNECTIONS.length
  if (CONNECTIONS.length === 1) {
    if (DEV) { try { console.warn("kgsm-web routing: a call named no node and fell through to the only one — name the node it is for; this breaks as soon as a second joins."); } catch {} }
    return CONNECTIONS[0];
  }
  return unrouted("a routed call named no node");
}

// Address a connection DIRECTLY by the entry we hold rather than by a backend id.
// The fan-out and the SSE registry iterate CONNECTIONS, so the node is already in
// hand — routing those through an id would fail on a connection whose id isn't
// reconciled yet, and naming the entry is exactly as specific as naming its id.
export function apiV1ForConn(conn) {
  const o = conn ? originOf(conn.url) : "";
  return o ? o + "/api/v1" : "";
}
// SSE stream URL for a connection: "…/api/v1/stream?topics=a,b,c". Topics are
// comma-separated, URL-encoded, and fixed for the lifetime of the stream.
export function streamUrlForConn(conn, topics) {
  const base = apiV1ForConn(conn);
  if (!base) return "";
  const qs = topics && topics.length ? "?topics=" + encodeURIComponent(topics.join(",")) : "";
  return base + "/stream" + qs;
}

// Per-host REST base ("…/api/v1"). Empty string when there's no connection —
// callers guard on CONNECTIONS.length.
export function apiV1Of(hostId) {
  const c = connOf(hostId);
  return c ? originOf(c.url) + "/api/v1" : "";
}
// The bare host ORIGIN (no /api/v1). The auth endpoints (/auth/discord/*,
// /auth/session/refresh) are root-routed on the backend, NOT under /api/v1.
export function apiOriginOf(hostId) {
  const c = connOf(hostId);
  return c ? originOf(c.url) : "";
}

// ---- looking a node up (not calling it) ---------------------------------
// The origin we reach a node at, for DISPLAY and bookkeeping — an address to
// show or store, not a call to route. A node we don't hold is honestly "" here
// rather than a routing failure, because these run during render and while
// registering hosts we may not be connected to.
export function originOfHost(hostId) {
  const c = hostId ? CONNECTIONS.find(c => c.id === hostId)
                   : (CONNECTIONS.length === 1 ? CONNECTIONS[0] : null);
  return c ? originOf(c.url) : "";
}
// The bare HOSTNAME/IP of a host (no scheme, no port) — the address the SPA
// reached this host's api at. kgsm/monitor source no ip address, so the connect
// origin IS the honest host address (the api and its game servers are co-located
// per host). Used to compose a server's player-facing connect address (host:port).
// Empty string when no such connection — callers fall back to honest-unknown.
export function hostAddressOf(hostId) {
  const o = originOfHost(hostId);
  if (!o) return "";
  try { return new URL(o).hostname; } catch { return ""; }
}

// Reconcile a connection's BACKEND host id once it's known (from connect's GET
// /hosts probe, or cold-boot). Sets it in-memory (so apiV1Of/streamUrlOf exact-match
// it) AND persists it into the registry so the next load routes by id immediately
// — no reconnect window. A no-op for the lone seed (kept id-less; sole-connection
// fallback routes N=1 anyway), unless that seed already has a registry entry.
export function reconcileConnectionId(url, id) {
  if (!id) return;
  const o = originOf(url);
  const c = CONNECTIONS.find((c) => originOf(c.url) === o);
  if (c) c.id = id;
  try {
    const reg = readRegistry();
    let changed = false;
    for (const e of reg) { if (originOf(e.url) === o && e.id !== id) { e.id = id; changed = true; } }
    if (changed) localStorage.setItem(REGISTRY_KEY, JSON.stringify(reg));
  } catch {}
}

// ---- the sign-in doorway -------------------------------------------------
// Discord identity is a GLOBAL SSO anchor: a session minted by any node vouches
// the user onto the rest of the cluster. So signing in picks a DOORWAY, not a
// node to read from — the OAuth bounce, the /me that follows it and the registry
// entry it writes all belong to the node the user came through. The sign-in offers
// the connected nodes and remembers which one it used; this is the sole-candidate
// answer for the N=1 case and the honest empty when there is nothing to sign in
// against.
// ---- The HOME node ------------------------------------------------------
// Which node holds this account's preferences.
//
// A cluster is reached by knowing ONE node, and that entry point is where a person's preferences
// live. It is a route, not an authority: nothing about it makes it special to the cluster, and the
// rows it holds converge with any other node's on their own merge key rather than on which node
// wrote them.
//
// Resolved as the node SERVING THE PANEL, because that is the one somebody actually chose by typing
// its address — kgsm-api serves the SPA out of its own wwwroot, so the document's origin is that
// node's. In development the SPA is served by Vite on a different port, and behind a reverse proxy
// the origin may be neither; both fall back to the first connection, which at N=1 is the only answer
// there is and at N≥2 is the seed the registry was built from.
export function homeConn() {
  if (!CONNECTIONS.length) return null;
  try {
    const here = typeof window !== "undefined" && window.location ? window.location.origin : "";
    if (here) {
      const match = CONNECTIONS.find(c => originOf(c.url) === here);
      if (match) return match;
    }
  } catch { /* no window (SSR/prerender) — fall through */ }
  return CONNECTIONS[0];
}

// The home node's backend id, or null before it has been reconciled (cold boot) / with no
// connection at all. A caller with no id skips the call rather than routing it at a guess.
export function homeHostId() {
  const c = homeConn();
  return c && c.id ? c.id : null;
}

export function soleConnectionOrigin() {
  return CONNECTIONS.length === 1 ? originOf(CONNECTIONS[0].url) : "";
}
