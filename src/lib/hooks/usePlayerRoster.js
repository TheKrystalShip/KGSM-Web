import { useKeyedResource } from "../keyedResource.js";
import { useStore } from "../store.js";
import { followPlayers, hydratePlayers, playersKey, playersStore } from "../stores/players.js";

// usePlayerRoster — one server's players, live.
//
// The SHAPE of what this returns is unchanged and deliberately so: `{ status, detection, moderation,
// players }`, exactly as before. What changed is underneath — the fetch and the `players`
// subscription used to be this hook's own local state, so two surfaces reading the same server read
// it twice. They now share a keyed store (stores/players.js) through `useKeyedResource`, which is
// what makes one hydrate and one subscription serve every reader.
//
// That mattered the moment the command palette could be scoped to a server: the palette opens OVER
// the page it is scoped to, so the Players tab and the palette are routinely mounted against the
// same server at once.
//
// Re-exported here rather than moved, so every existing call site keeps working untouched.

export { applyPlayerFrame } from "../stores/players.js";

export function usePlayerRoster(server) {
  const hostId = server && server.hostId;
  const serverId = server && server.id;
  const key = hostId && serverId ? playersKey(hostId, serverId) : null;

  useKeyedResource(key, () => hydratePlayers(server), () => followPlayers(server));

  const entry = useStore(playersStore, s => (key ? s.byKey[key] : null));
  // No entry yet means the first holder's hydrate has not written its loading state — which is a
  // frame away, and is loading either way.
  if (!entry) return { status: "loading" };
  if (entry.status === "error") return { status: "error", error: entry.error };
  if (entry.status !== "ready") return { status: "loading" };
  return {
    status: "ready",
    detection: entry.detection,
    moderation: entry.moderation,
    players: entry.players,
  };
}
