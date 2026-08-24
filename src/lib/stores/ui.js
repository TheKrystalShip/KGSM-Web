// stores/ui.js — the account's favourites, and the link latency KPI.

import { api } from "../apiClient.js";
import { CONNECTIONS } from "../config.js";
import { createStore, useStore } from "../store.js";
import { hostsStore } from "./hosts.js";
import { PREF_KEYS, prefsStore } from "./prefs.js";

// ---- Favorites -----------------------------------------------------------
//
// A favourite belongs to the PERSON, not to the browser. It decides which servers the sidebar keeps
// a permanent shortcut to, and shortcuts that differ between a desktop and a phone would be a defect
// with nowhere to report it — so this rides `prefsStore`: read locally and synchronously on the very
// first render, mirrored to the node so it follows the account. The node wins once it answers, the
// same rule the dashboard layout follows.
//
// Every entry carries the NODE its server belongs to, the shape `selectionStore` is itself modelled
// on. A favourite missing from the roster has two very different explanations — its node did not
// answer, or the server is gone — and without the node there is no way to tell them apart. A
// shortcut that quietly vanishes when a node reboots is much the worse of the two mistakes, so the
// node is recorded when the favourite is made.
//
// Order is INSERTION order and nothing re-sorts it. The sidebar list is a dock: a shortcut that
// moves because a server changed state is no longer a shortcut, and status is the dot's job.

// Favourites before they were an account preference. Read once, on a browser that has one, and
// written straight back through `prefsStore` so the node picks it up on the next hydrate.
const LEGACY_FAVORITES_KEY = "krystal:favorites";

/// `["a", "b"]` (legacy) or `[{id, hostId}]` → `{ ids, hostById }`. Tolerant of both because the
/// legacy shape can arrive from this browser's storage at any time after an upgrade.
function normalizeFavorites(rows) {
  const ids = [];
  const hostById = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = typeof row === "string" ? row : (row && row.id);
    if (typeof id !== "string" || !id || hostById[id] !== undefined) continue;
    ids.push(id);
    hostById[id] = (typeof row === "string" ? null : row.hostId) ?? null;
  }
  return { ids, hostById };
}

function readLegacyFavorites() {
  try {
    const raw = localStorage.getItem(LEGACY_FAVORITES_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) && parsed.length ? parsed : null;
  } catch { return null; }
}

/// What the preference holds, or what this browser held before it was one.
function readFavorites() {
  const held = prefsStore.get(PREF_KEYS.SERVER_FAVORITES, null);
  if (Array.isArray(held)) return normalizeFavorites(held);
  const legacy = readLegacyFavorites();
  if (!legacy) return { ids: [], hostById: {} };
  // Taken once. Writing it through now puts it where preferences live, and drops the old key so a
  // later "unfavourite everything" cannot be undone by a value nothing writes any more.
  const state = normalizeFavorites(legacy);
  writeFavorites(state);
  try { localStorage.removeItem(LEGACY_FAVORITES_KEY); } catch { /* blocked */ }
  return state;
}

function writeFavorites({ ids, hostById }) {
  prefsStore.set(PREF_KEYS.SERVER_FAVORITES, ids.map(id => ({ id, hostId: hostById[id] ?? null })));
}

const favoritesStore = createStore(readFavorites());

/// `"factorio-1"` or a server row. The row form is what records the node, so a call site holding one
/// should pass it — an id alone makes a favourite whose node is unknown, which the sidebar can only
/// report as unknown.
const entryOf = (server) =>
  (typeof server === "string" ? { id: server, hostId: null } : { id: server && server.id, hostId: (server && server.hostId) ?? null });

favoritesStore.has = (id) => favoritesStore.getState().hostById[id] !== undefined;

/// The node this favourite was made on, or null when it was made from an id alone.
favoritesStore.hostOf = (id) => favoritesStore.getState().hostById[id] ?? null;

/// Favourite or unfavourite one server. `on` omitted flips it.
favoritesStore.set = (server, on) => favoritesStore.setState(s => {
  const { id, hostId } = entryOf(server);
  if (!id) return s;
  const held = s.hostById[id] !== undefined;
  const want = on == null ? !held : !!on;
  if (want === held) return s;
  let next;
  if (!want) {
    const rest = { ...s.hostById };
    delete rest[id];
    next = { ids: s.ids.filter(x => x !== id), hostById: rest };
  } else {
    next = { ids: [...s.ids, id], hostById: { ...s.hostById, [id]: hostId } };
  }
  writeFavorites(next);
  return next;
});

favoritesStore.toggle = (server) => favoritesStore.set(server, undefined);

/// Drop a favourite whose server no longer exists. Separate from `set(id, false)` only in intent —
/// the sidebar offers this when a REACHABLE node has no such server, never when a node is silent.
favoritesStore.forget = (id) => favoritesStore.set(id, false);

const useIsFavorite = (id) => useStore(favoritesStore, s => s.hostById[id] !== undefined);

// The node's copy lands after the first render — the data layer reads preferences once there is a
// session, and anything showing favourites has already mounted from the local copy by then. Adopt it
// ONCE: after that this browser's writes are the source, and re-reading on every prefs change would
// fight a person starring things, since each write notifies this same store.
let _adopted = false;
prefsStore.subscribe(() => {
  if (_adopted || !prefsStore.getState().hydrated) return;
  _adopted = true;
  const fromNode = prefsStore.get(PREF_KEYS.SERVER_FAVORITES, null);
  if (!Array.isArray(fromNode)) return;
  const next = normalizeFavorites(fromNode);
  const held = favoritesStore.getState();
  if (JSON.stringify(next) !== JSON.stringify({ ids: held.ids, hostById: held.hostById })) {
    favoritesStore.setState(next);
  }
});

// ---- Link latency -------------------------------------------------------
// Client-measured round trip per node, read by the dashboard's capacity strip, the cluster
// constellation and the diagnostics page. Started once from boot.js — a consumer mounting does
// not start it, because several of them can be open at once and the loop is one per app.
const pingStore = createStore({ byHost: {} });
pingStore.record = (hostId, ms) =>
  pingStore.setState(s => ({ byHost: { ...s.byHost, [hostId]: { ms, at: Date.now() } } }));

const PING_INTERVAL_MS = 1000;
let _pingTimer = null;
function pingTick() {
  if (typeof document !== "undefined" && document.hidden) return;
  const list = hostsStore.getState().list || [];
  for (const h of list) {
    if (!h || !h.id) continue;
    api.pingHost(h.id).then(ms => pingStore.record(h.id, ms), () => pingStore.record(h.id, null));
  }
}
function startPingLoop() {
  if (_pingTimer || !CONNECTIONS.length) return;
  if ((hostsStore.getState().list || []).length) pingTick();
  else { const un = hostsStore.subscribe(() => { if ((hostsStore.getState().list || []).length) { un(); pingTick(); } }); }
  _pingTimer = setInterval(pingTick, PING_INTERVAL_MS);
}

function stopPingLoop() {
  if (!_pingTimer) return;
  clearInterval(_pingTimer);
  _pingTimer = null;
}

export { favoritesStore, useIsFavorite, pingStore, startPingLoop, stopPingLoop };
