// stores/batches.js — the batches this browser can see, per node.
//
// A batch is one node's share of a run: the node records it, paces it and completes it whether or not
// anyone is watching. This store holds what the panel has been TOLD about those records — the `202`
// that accepted one, and the `batch.patch` frames the node pushes as its members move.
//
// It holds no opinion and fetches nothing. Two questions are asked of it today:
//
//   · how many members a batch has, so a queued button can say "3rd of 8" rather than "3rd". The
//     total is the node's own `counts.total`, or the length of the `admitted` list the accept
//     returned — measured either way, and simply absent until one of them has arrived, which is why
//     the label degrades to the position alone rather than guessing at a denominator.
//   · whether every batch of a run has settled, which is what lets a run narrow the selection to
//     what still needs doing.

import { api } from "../apiClient.js";
import { createStore } from "../store.js";

const batchesStore = createStore({ byId: {} });

/// Merge what a node said about one batch. `view` is a BatchView (the stream frame's whole payload or
/// a read's row); `seed` is the thinner shape an accept gives, which names the total and nothing else.
batchesStore.upsert = (id, patch) => {
  if (!id || !patch) return;
  batchesStore.setState((s) => ({ byId: { ...s.byId, [id]: { ...s.byId[id], ...patch, id } } }));
};

batchesStore.get = (id) => (id ? batchesStore.getState().byId[id] || null : null);

/// How many members this batch has, or null when nothing has said yet.
batchesStore.totalOf = (id) => {
  const b = batchesStore.get(id);
  if (!b) return null;
  if (b.counts && Number.isFinite(b.counts.total)) return b.counts.total;
  return Number.isFinite(b.total) ? b.total : null;
};

const viewOf = (v, hostId) => ({
  id: v.id,
  hostId: hostId ?? null,
  runId: v.runId ?? null,
  verb: v.verb,
  state: v.state,
  actor: v.actor ?? null,
  origin: v.origin ?? null,
  createdAt: v.createdAt ?? null,
  settledAt: v.settledAt ?? null,
  counts: v.counts ?? null,
  members: Array.isArray(v.members) ? v.members : [],
});

// The `batches` topic carries a whole BatchView on every transition, so a client that reconnects
// mid-run learns the shape of it from the next member that moves — no read is needed to catch up on
// a batch that is still going. The envelope's `hostId` is the node whose socket delivered it, which
// is the node that owns the batch.
api.stream.subscribe(["batches"], (m) => {
  if (m.type !== "batch.patch" || !m.data || !m.data.id) return;
  batchesStore.upsert(m.data.id, viewOf(m.data, m.hostId));
});

export { batchesStore, viewOf };
