// stores/selection.js — the set of servers one gesture is about to act on.
//
// A selection is CLUSTER-WIDE: seventeen servers over three nodes, six of them needing an update, is
// one selection and one confirm. So every entry carries the node its server belongs to — the
// dispatcher groups by that, and a run that crosses nodes is N requests rather than a relay.
//
// Three rules, and each one exists because its opposite is a way to act on a server nobody meant:
//
//   · CLEARED ON FILTER CHANGE. A selected row hidden behind a filter is invisible consent. The page
//     that owns the filters clears this when any of them moves.
//   · NEVER PERSISTED. It is a gesture, not a preference — nothing here touches localStorage, unlike
//     the favourites store this is otherwise shaped after.
//   · A FINISHED RUN NARROWS IT TO WHAT STILL NEEDS DOING. Rows that succeeded drop out, rows that
//     failed stay, and a clean run leaves nothing selected. Retry is then one click that can only
//     address what actually needs retrying — a selection still holding the successes would re-run the
//     verb against servers already done.

import { createStore, useStore } from "../store.js";

// ids is ORDERED (click order); hostById answers which node each belongs to. Two fields rather than
// a list of pairs so membership is a map lookup — a "select all matching" over a large fleet asks
// this question once per rendered tile.
const selectionStore = createStore({ ids: [], hostById: {} });

const entryOf = (server) =>
  (typeof server === "string" ? { id: server, hostId: null } : { id: server.id, hostId: server.hostId ?? null });

// `!== undefined`, not a truthiness check: a server whose node is unknown holds a null here, and a
// truthy test would report it unselected while it sits in the list.
selectionStore.has = (id) => selectionStore.getState().hostById[id] !== undefined;

/// Select or deselect one server. `on` omitted flips it.
selectionStore.set = (server, on) => selectionStore.setState((s) => {
  const { id, hostId } = entryOf(server);
  if (!id) return s;
  const held = s.ids.includes(id);
  const want = on == null ? !held : !!on;
  if (want === held) return s;
  if (!want) {
    const hostById = { ...s.hostById };
    delete hostById[id];
    return { ids: s.ids.filter((x) => x !== id), hostById };
  }
  return { ids: [...s.ids, id], hostById: { ...s.hostById, [id]: hostId } };
});

selectionStore.toggle = (server) => selectionStore.set(server, undefined);

/// Add a run of servers without disturbing what is already held — the shift-click range, and the
/// "select all N matching" that adds a filtered page in one press.
selectionStore.add = (servers) => selectionStore.setState((s) => {
  const ids = [...s.ids];
  const hostById = { ...s.hostById };
  let changed = false;
  for (const server of servers || []) {
    const { id, hostId } = entryOf(server);
    if (!id || hostById[id] !== undefined) continue;
    ids.push(id);
    hostById[id] = hostId;
    changed = true;
  }
  return changed ? { ids, hostById } : s;
});

/// Replace the whole selection with exactly these servers.
selectionStore.replace = (servers) => selectionStore.setState(() => {
  const ids = [];
  const hostById = {};
  for (const server of servers || []) {
    const { id, hostId } = entryOf(server);
    if (!id || hostById[id] !== undefined) continue;
    ids.push(id);
    hostById[id] = hostId;
  }
  return { ids, hostById };
});

/// Keep only these ids, dropping the rest. What a settled run leaves behind.
selectionStore.keep = (keepIds) => selectionStore.setState((s) => {
  const keep = new Set(keepIds || []);
  const ids = s.ids.filter((id) => keep.has(id));
  if (ids.length === s.ids.length) return s;
  const hostById = {};
  for (const id of ids) hostById[id] = s.hostById[id];
  return { ids, hostById };
});

selectionStore.clear = () => selectionStore.setState((s) => (s.ids.length ? { ids: [], hostById: {} } : s));

/// The selection as `[{ id, hostId }]`, in the order it was built.
selectionStore.entries = () => {
  const { ids, hostById } = selectionStore.getState();
  return ids.map((id) => ({ id, hostId: hostById[id] ?? null }));
};

const useIsSelected = (id) => useStore(selectionStore, (s) => s.hostById[id] !== undefined);
const useSelectionIds = () => useStore(selectionStore, (s) => s.ids);

export { selectionStore, useIsSelected, useSelectionIds };
