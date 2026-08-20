// stores/ui.js — Client-local preferences: favorites, link latency KPI.

import { api } from "../apiClient.js";
import { CONNECTIONS } from "../config.js";
import { createStore, useStore } from "../store.js";
import { hostsStore } from "./hosts.js";

// ---- Favorites (client-local, persisted) --------------------------------
const FAVORITES_KEY = "krystal:favorites";
function readFavorites() {
  try {
    const arr = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
    return Array.isArray(arr) ? arr.filter(x => typeof x === "string") : [];
  } catch { return []; }
}
const favoritesStore = createStore({ ids: readFavorites() });
function writeFavorites(ids) { try { localStorage.setItem(FAVORITES_KEY, JSON.stringify(ids)); } catch {} }
favoritesStore.has = (id) => favoritesStore.getState().ids.includes(id);
favoritesStore.toggle = (id) => favoritesStore.setState(s => {
  const next = s.ids.includes(id) ? s.ids.filter(x => x !== id) : [...s.ids, id];
  writeFavorites(next);
  return { ids: next };
});
favoritesStore.set = (id, on) => favoritesStore.setState(s => {
  if (on === s.ids.includes(id)) return s;
  const next = on ? [...s.ids, id] : s.ids.filter(x => x !== id);
  writeFavorites(next);
  return { ids: next };
});
const useIsFavorite = (id) => useStore(favoritesStore, s => s.ids.includes(id));

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
