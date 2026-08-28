import { api } from "../apiClient.js";
import { createStore } from "../store.js";

// stores/players.js — one server's player roster, keyed, shared by everything that wants it.
//
// Keyed for the reason every store here is keyed: a roster held in one slot works while exactly one
// surface reads it, and stops the moment a second can. The Players tab and the command palette can
// both be looking at the same server at once — the palette opens over the page it is scoped to — and
// two readers fighting over one slot would each blank the other's roster with no error to show for
// it. Two DIFFERENT servers at once has the same shape and the same answer.
//
// It pairs with `useKeyedResource`: keying is what lets two targets coexist, and that is what stops
// N mounts of the same target hydrating N times.
//
// TAIL-THEN-FOLLOW, and the ORDER IS A RACE. `acquire` calls hydrate() and follow() back to back
// and neither waits, so live frames start arriving while the REST read is still in flight. A frame
// applied before the roster lands would be overwritten by it — somebody would join, and then
// silently un-join when the hydrate finished. So frames are BUFFERED until the read completes and
// replayed in order behind it. The same guarantee ConsolePanel's tail makes, for the same reason.

const playersKey = (hostId, serverId) => (hostId || "_") + "/" + serverId;

const _empty = () => ({
  status: "loading",
  detection: "unknown",
  // What the game can be asked to do, as the backend reports it. Defaults to NOTHING so a backend
  // that has not shipped the field renders no moderation controls, rather than buttons that would
  // 409 on click.
  moderation: { kick: false, ban: false, unban: false, targetKind: null },
  players: [],
  error: null,
  everLoaded: false,
});

const playersStore = createStore({ byKey: {} });

playersStore.entry = (hostId, serverId) =>
  playersStore.getState().byKey[playersKey(hostId, serverId)] || null;

const _patch = (key, fn) =>
  playersStore.setState(s => ({ ...s, byKey: { ...s.byKey, [key]: fn(s.byKey[key] || _empty()) } }));

/// Fold one live frame into a roster keyed by player identity.
///
/// Exported because it is pure and the whole live half rests on it — a reset marks every player of
/// THIS server offline and touches no other server's rows, which is the one case worth being able to
/// assert directly.
function applyPlayerFrame(roster, type, player, serverId) {
  if (type === "players.reset") {
    const next = new Map(roster);
    for (const [k, p] of next) if (p._serverId === serverId) next.set(k, { ...p, status: "offline" });
    return next;
  }
  if (!player || !player.playerIdentity) return roster;
  if (type !== "players.join" && type !== "players.leave" && type !== "players.ban") return roster;
  const next = new Map(roster);
  next.set(player.playerIdentity, { ...player, _serverId: serverId });
  return next;
}

// Frames that arrived before the REST read landed, per key.
const _buffered = new Map();

const _rosterOf = (key) => {
  const e = playersStore.getState().byKey[key];
  return new Map((e ? e.players : []).map(p => [p.playerIdentity, p]));
};

/// Read one server's roster. Safe to call for a key already held — the caller is `useKeyedResource`,
/// which only calls it for the first holder.
function hydratePlayers(server) {
  if (!server || !server.hostId) return Promise.resolve();
  const key = playersKey(server.hostId, server.id);
  _buffered.set(key, []);
  _patch(key, e => ({ ...e, status: "loading", error: null }));

  return api.host(server.hostId).get("/servers/" + server.id + "/players").then(
    (res) => {
      let roster = new Map();
      ((res && res.players) || []).forEach((p) => {
        if (p && p.playerIdentity) roster.set(p.playerIdentity, { ...p, _serverId: server.id });
      });
      // Everything that arrived while we were reading, in the order it arrived.
      for (const [type, player, sid] of (_buffered.get(key) || [])) {
        roster = applyPlayerFrame(roster, type, player, sid);
      }
      _buffered.delete(key);
      _patch(key, e => ({
        ...e,
        status: "ready",
        detection: (res && res.detection) || "unknown",
        moderation: (res && res.moderation) || e.moderation,
        players: [...roster.values()],
        error: null,
        everLoaded: true,
      }));
    },
    (err) => {
      _buffered.delete(key);
      _patch(key, e => ({ ...e, status: "error", error: err, everLoaded: true }));
    },
  );
}

/// Follow one server's live transitions. Returns the disposer `useKeyedResource` releases.
function followPlayers(server) {
  if (!server || !server.hostId) return () => {};
  const key = playersKey(server.hostId, server.id);
  const dispose = api.stream.subscribe(["players"], (m) => {
    if (!m || !m.data || m.data.serverId !== server.id) return;
    const buf = _buffered.get(key);
    if (buf) { buf.push([m.type, m.data.player, m.data.serverId]); return; }   // still hydrating
    const next = applyPlayerFrame(_rosterOf(key), m.type, m.data.player, m.data.serverId);
    _patch(key, e => ({ ...e, players: [...next.values()] }));
  });
  return () => { dispose(); _buffered.delete(key); playersStore.drop(key); };
}

/// Forget a roster nobody holds. Keeping it would mean the next reader renders a stale list — with
/// live statuses in it — for however long the re-read takes.
playersStore.drop = (key) => {
  playersStore.setState(s => {
    if (!s.byKey[key]) return s;
    const byKey = { ...s.byKey };
    delete byKey[key];
    return { ...s, byKey };
  });
};

export { applyPlayerFrame, followPlayers, hydratePlayers, playersKey, playersStore };
