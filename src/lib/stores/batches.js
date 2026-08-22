// stores/batches.js — the batch records this browser can see, and which nodes it could ask.
//
// A batch is one node's share of a run: the node records it, paces it and completes it whether or
// not anyone is watching. This store holds what the panel has been told about those records — the
// `202` that accepted one, the rows a read returns, and the `batch.patch` frames a node pushes as
// its members move.
//
// ── Hydrate, then follow ──────────────────────────────────────────────────
//
// `refresh()` fans `GET /batches?active=true` across every connection and keeps each node's answer
// under that node's id. Hydration is what makes a run visible to a client that was not open when it
// started — which is the reader this exists for. A view assembled from frames alone shows nothing to
// the browser that arrived second, and nothing at all to a different person.
//
// ── A node that did not answer is stated, never subtracted ────────────────
//
// `nodes` holds the last fan-out's per-connection outcome. A run reassembled while one node is
// unreachable is a run whose share on that node is UNKNOWN, not a run with fewer members — so the
// surface reads the failures out of here and says so, rather than drawing a smaller run and letting
// it pass for the whole one.
//
// ── The node is the authority for its own active set ──────────────────────
//
// A batch this browser holds as active which the node no longer lists is re-read individually rather
// than dropped: it settled, and how it settled is the node's to say. Dropping it would make a run
// vanish mid-glance, and marking it settled here would be this browser inventing an outcome.
//
// Two more questions are asked of it: a batch's member count, so a queued button can say "3rd of 8"
// instead of guessing a denominator, and whether every batch of a run has settled, which is what
// lets a run narrow the selection to what still needs doing.

import { api } from "../apiClient.js";
import { createStore } from "../store.js";

/// How many settled RUNS survive in the store. A tray follows live work; the settled ones below it
/// are the tail an operator is still checking on, and beyond a screenful they are audit's job. The
/// cap is on runs rather than batches because a run is what a person started — trimming to a batch
/// count would cut a three-node run into a partial one, which is the one shape this store must never
/// present.
const SETTLED_RUNS_KEPT = 10;

const batchesStore = createStore({ byId: {}, nodes: {}, hydrated: false });

/// Merge what a node said about one batch. `view` is a BatchView (the stream frame's whole payload or
/// a read's row); `seed` is the thinner shape an accept gives, which names the total and nothing else.
batchesStore.upsert = (id, patch) => {
  if (!id || !patch) return;
  batchesStore.setState((s) => {
    const prev = s.byId[id];
    const next = { ...prev, ...patch, id };
    // A frame that names no node must not erase the node already recorded for this batch — the same
    // rule a job's origin follows. Which node owns a batch is the only thing that routes a cancel.
    if (prev && prev.hostId && !next.hostId) next.hostId = prev.hostId;
    return { ...s, byId: prune({ ...s.byId, [id]: next }) };
  });
};

batchesStore.get = (id) => (id ? batchesStore.getState().byId[id] || null : null);

/// How many members this batch has, or null when nothing has said yet.
batchesStore.totalOf = (id) => {
  const b = batchesStore.get(id);
  if (!b) return null;
  if (b.counts && Number.isFinite(b.counts.total)) return b.counts.total;
  return Number.isFinite(b.total) ? b.total : null;
};

/// Every node's active batches, plus which nodes could be asked at all.
///
/// Resolves once every connection has answered or failed; it never rejects, because a node being
/// down is one of the two things this read exists to report.
batchesStore.refresh = () => api.fanOut("/batches?active=true").then((results) => {
  const nodes = {};
  const fresh = [];
  const listedBy = new Map();          // hostId → the ids that node currently calls active

  for (const r of results || []) {
    const conn = r && r.conn;
    const hostId = (conn && conn.id) || null;
    const key = hostId || (conn && conn.url) || "_unrouted";
    nodes[key] = {
      key, hostId,
      label: (conn && (conn.name || conn.url)) || key,
      ok: !!(r && r.ok),
      error: r && r.ok ? null : reasonOf(r && r.err),
    };
    if (!r || !r.ok) continue;
    const rows = Array.isArray(r.data) ? r.data : (r.data && Array.isArray(r.data.data) ? r.data.data : []);
    const ids = new Set();
    for (const v of rows) {
      if (!v || !v.id) continue;
      fresh.push(viewOf(v, hostId));
      ids.add(v.id);
    }
    if (hostId) listedBy.set(hostId, ids);
  }

  const stragglers = [];
  batchesStore.setState((s) => {
    const byId = { ...s.byId };
    for (const v of fresh) byId[v.id] = { ...byId[v.id], ...v };
    // A node that answered has stated its whole active set. Anything this browser still holds as
    // active for that node ended while nobody was listening, and the node is the only authority on
    // how — so it is asked, one row at a time.
    for (const [hostId, ids] of listedBy) {
      for (const b of Object.values(byId)) {
        if (b.hostId === hostId && b.state === "active" && !ids.has(b.id)) stragglers.push(b);
      }
    }
    return { ...s, byId: prune(byId), nodes, hydrated: true };
  });

  return Promise.all(stragglers.map((b) => api.host(b.hostId).get("/batches/" + encodeURIComponent(b.id)).then(
    (row) => { if (row && row.id) batchesStore.upsert(row.id, viewOf(row, b.hostId)); },
    (err) => { if (err && err.code === 404) batchesStore.drop(b.id); },
  ))).then(() => batchesStore.getState());
});

/// Forget one batch — the node no longer has a record of it.
batchesStore.drop = (id) => batchesStore.setState((s) => {
  if (!id || !s.byId[id]) return s;
  const byId = { ...s.byId };
  delete byId[id];
  return { ...s, byId };
});

/// The runs this browser knows about, newest first, live ones ahead of finished ones.
batchesStore.runs = () => runsFrom(batchesStore.getState().byId);

/// The nodes the last hydrate could not read. Their share of any run is unknown — which is a
/// different statement from having none, and the only honest one available.
batchesStore.unreachableNodes = () => Object.values(batchesStore.getState().nodes).filter((n) => !n.ok);

const reasonOf = (err) => (err && (err.message || (err.code ? "HTTP " + err.code : null))) || "no answer";

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

/// What holds a run together: the id the client minted and every node stored verbatim. A batch whose
/// node recorded none is a run of one — it is grouped under itself rather than pooled with every
/// other id-less batch into a run nobody started.
const runKeyOf = (b) => (b && b.runId) || "batch:" + ((b && b.id) || "");

const stamp = (b) => Date.parse((b && (b.settledAt || b.createdAt)) || "") || 0;

/// Drop the oldest settled runs past the cap. Live work is never dropped, and a run is only
/// considered for eviction once EVERY node's share of it has settled — half a run in the store would
/// be shown as a whole one.
function prune(byId) {
  const groups = new Map();
  for (const b of Object.values(byId)) {
    const key = runKeyOf(b);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(b);
  }
  const settled = [...groups].filter(([, bs]) => bs.every((b) => b.state === "settled"));
  if (settled.length <= SETTLED_RUNS_KEPT) return byId;
  settled.sort((a, b) => Math.max(...b[1].map(stamp)) - Math.max(...a[1].map(stamp)));
  const out = { ...byId };
  for (const [, bs] of settled.slice(SETTLED_RUNS_KEPT)) for (const b of bs) delete out[b.id];
  return out;
}

/// Group batches into runs. This is the whole cluster-wide reassembly: no node knows about any
/// other, so the id every node was handed is what says these three records are one person's action.
///
/// Nothing here is computed that a node did not report. The counts are its own `counts` block summed
/// across the run — never re-derived from the member rows, which would produce a total for a batch
/// that has not stated one — and `countsPartial` says outright when a share has not reported.
function runsFrom(byId) {
  const groups = new Map();
  for (const b of Object.values(byId || {})) {
    const key = runKeyOf(b);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(b);
  }
  const runs = [...groups].map(([key, batches]) => runOf(key, batches));
  // Live runs first, then the settled tail newest-first. A run still going is the reason this surface
  // is open; one that finished is the thing being checked on afterwards.
  runs.sort((a, b) => (a.state === b.state ? b.startedAt - a.startedAt : (a.state === "active" ? -1 : 1)));
  return runs;
}

const COUNT_KEYS = ["total", "pending", "running", "succeeded", "failed", "refused", "cancelled", "unknown"];

function runOf(key, batches) {
  const ordered = [...batches].sort((a, b) => String(a.hostId || "").localeCompare(String(b.hostId || "")));
  const counts = {};
  for (const k of COUNT_KEYS) counts[k] = 0;
  let countsPartial = false;
  const members = [];
  let verb = null, verbAgrees = true, actor = null, origin = null;
  let started = Infinity, settled = 0, live = false;

  for (const b of ordered) {
    if (b.counts) { for (const k of COUNT_KEYS) counts[k] += Number(b.counts[k]) || 0; }
    else countsPartial = true;
    for (const m of b.members || []) members.push({ ...m, hostId: b.hostId, batchId: b.id });
    if (verb == null) verb = b.verb || null;
    else if (b.verb && b.verb !== verb) verbAgrees = false;
    if (!actor && b.actor) actor = b.actor;
    if (!origin && b.origin) origin = b.origin;
    const at = Date.parse(b.createdAt || "") || 0;
    if (at) started = Math.min(started, at);
    settled = Math.max(settled, Date.parse(b.settledAt || "") || 0);
    // A batch with no state yet is work this browser has just been told about and nothing more; it
    // holds the run open rather than letting it read as finished.
    if (b.state !== "settled") live = true;
  }

  return {
    key,
    runId: ordered.length ? ordered[0].runId || null : null,
    verb: verbAgrees ? verb : null,
    state: live ? "active" : "settled",
    batches: ordered,
    members,
    counts, countsPartial,
    actor, origin,
    startedAt: Number.isFinite(started) ? started : 0,
    settledAt: live ? 0 : settled,
    nodes: [...new Set(ordered.map((b) => b.hostId).filter(Boolean))],
  };
}

// The `batches` topic carries a whole BatchView on every transition, so a client that reconnects
// mid-run learns the shape of it from the next member that moves — no read is needed to catch up on
// a batch that is still going. The envelope's `hostId` is the node whose socket delivered it, which
// is the node that owns the batch.
api.stream.subscribe(["batches"], (m) => {
  if (m.type !== "batch.patch" || !m.data || !m.data.id) return;
  batchesStore.upsert(m.data.id, viewOf(m.data, m.hostId));
});

export { batchesStore, runsFrom, viewOf };
