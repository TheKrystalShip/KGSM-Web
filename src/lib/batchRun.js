// batchRun.js — firing one verb at a set of servers, and following what came of it.
//
// A RUN is what a person starts: one verb, one cluster-wide set of servers, one outcome. A BATCH is
// one node's share of it — the durable unit, held and executed by that node's API. The browser names
// the verb and the servers, and its job ends there: each node records its batch, paces it and runs it
// to completion whether or not a tab stays open.
//
// So this module paces nothing and retries nothing. It mints a run id, groups the selection by node,
// fires one POST per node, and reconciles what came back.
//
// Three properties are load-bearing:
//
//   · THE RUN ID IS MINTED HERE and sent to every node verbatim. That is what makes a run
//     reassemblable afterwards by any client — a different browser, a different person, one that was
//     not open at dispatch — from data the nodes hold. No node learns about any other and nothing
//     relays through a peer, so losing the node you fired FROM cannot orphan work on the nodes it
//     runs ON.
//   · A NODE THAT NEVER ANSWERED IS UNDISPATCHED, NOT FAILED. Its share never started; calling it a
//     failure would claim commands that were never issued. It comes back as its own list, to be
//     offered as a retry.
//   · EACH NODE'S `refused[]` IS THE AUTHORITY FOR ITS OWN SERVERS. The preflight predicts locally so
//     it can explain itself; the node re-decides on arrival and may disagree — one that went offline
//     between render and submit is refused there and nowhere else. The summary reads the responses,
//     never the prediction.

import { api } from "./apiClient.js";
import { markCommandIssued } from "./serverActions.js";
import { batchesStore, selectionStore, serversStore } from "./stores.js";

/// A correlation id for one person's single action. Client-minted on purpose (§4c): a coordinator
/// would buy a tidier id at the cost of the property that matters, which is that no node depends on
/// another for the run to complete.
function mintRunId() {
  const rand = () => Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, "0");
  return "run_" + rand() + rand();
}

/// Group `[{ id, hostId }]` by node, preserving order within each node — the node hands out queue
/// positions in the order it was asked, so the order here is the order an operator sees.
function groupByHost(entries) {
  const byHost = new Map();
  for (const e of entries || []) {
    if (!e || !e.id || !e.hostId) continue;
    if (!byHost.has(e.hostId)) byHost.set(e.hostId, []);
    byHost.get(e.hostId).push(e.id);
  }
  return byHost;
}

/// Fire one run. `servers` is `[{ id, hostId }]` (or full server rows — only the two fields are read).
///
/// Resolves to the run record even when every node refused or failed: a dispatch is reported, never
/// thrown. The per-node result shape mirrors `fanOut`'s `{ ok, data | err }` so an unreachable node is
/// a recorded outcome rather than a rejected promise — `fanOut` itself is GET-only and fans across
/// every connection, which is the wrong set here: a run addresses exactly the nodes its selection
/// names.
function dispatchRun({ verb, servers, force = false, origin = "ui", runId = mintRunId() }) {
  const byHost = groupByHost(servers);
  const requested = [];
  for (const [hostId, ids] of byHost) for (const id of ids) requested.push({ id, hostId });

  if (!verb || !requested.length) {
    return Promise.resolve(summarize({ runId, verb, force, requested, nodes: [] }));
  }

  return Promise.all([...byHost].map(([hostId, serverIds]) => {
    const body = { verb, serverIds, runId, origin };
    // Sent only when asked for, so a run that did not ask keeps the protection. The API refuses the
    // flag on any verb but start, so it is dropped here rather than sent and rejected.
    if (force && verb === "start") body.force = true;
    return api.host(hostId).post("/servers/commands", body).then(
      (data) => ({ hostId, ok: true, data, err: null, serverIds }),
      (err) => ({ hostId, ok: false, data: null, err, serverIds }),
    );
  })).then((nodes) => {
    const run = summarize({ runId, verb, force, requested, nodes });
    // Now — and only now — is a member known to be committed. Patch each admitted row QUEUED, which is
    // what it is: work the node has taken and not yet reached. See markCommandIssued for why the
    // "running" a single command writes would be a fabrication here.
    for (const m of run.admitted) {
      const server = serversStore.find(m.serverId);
      if (server) markCommandIssued(server, verb, "queued", { batchId: m.batchId });
    }
    for (const b of run.batches) {
      batchesStore.upsert(b.batchId, { hostId: b.hostId, runId, verb, total: b.total });
    }
    return run;
  });
}

/// Reconcile every node's answer into one record. Nothing here is predicted — each field comes from a
/// response, or from the absence of one.
function summarize({ runId, verb, force, requested, nodes }) {
  const admitted = [];
  const refused = [];
  const undispatched = [];
  const batches = [];

  for (const n of nodes) {
    if (!n.ok) {
      // Its share never started. Named as such, and offered as a retry.
      for (const serverId of n.serverIds) undispatched.push({ serverId, hostId: n.hostId, err: n.err });
      continue;
    }
    const data = n.data || {};
    const batchId = data.batchId || null;
    const took = Array.isArray(data.admitted) ? data.admitted : [];
    const turnedAway = Array.isArray(data.refused) ? data.refused : [];
    for (const serverId of took) admitted.push({ serverId, hostId: n.hostId, batchId });
    for (const r of turnedAway) refused.push({ serverId: r.serverId, hostId: n.hostId, reason: r.reason || null });
    if (batchId) batches.push({ batchId, hostId: n.hostId, total: took.length });
  }

  return {
    runId, verb, force,
    requested,
    nodes,
    batches,
    admitted,
    refused,
    undispatched,
    nodesAsked: nodes.length,
    nodesReached: nodes.filter((n) => n.ok).length,
  };
}

/// Follow a run to its end, then narrow the selection to what still needs doing.
///
/// The run outlives this browser, so this is a convenience over the batches the nodes are already
/// publishing rather than the thing that makes the run complete. If the stream never delivers, nothing
/// narrows and the selection is left exactly as the operator made it.
///
/// What stays selected: members that ended `failed` or `unknown`, and servers on a node that never
/// answered. What drops: successes, and refusals — a node that refused a verb refuses the identical
/// command identically, so keeping it selected would offer a retry that cannot work.
///
/// The selection is only touched if it is still the one the run was fired from — `selectedIds` is that
/// snapshot, taken before dispatch, and it is wider than what was sent whenever the preflight held
/// something back. An operator who has moved on to a different selection during a twenty-minute run
/// must not have it rewritten under them.
function narrowSelectionWhenSettled(run, selectedIds) {
  if (!run || !run.batches.length) {
    applyNarrowing(run, selectedIds, []);
    return () => {};
  }
  const wanted = new Set(run.batches.map((b) => b.batchId));

  const check = () => {
    const views = [...wanted].map((id) => batchesStore.get(id));
    if (views.some((v) => !v || !v.state)) return false;
    if (views.some((v) => v.state !== "settled")) return false;
    const stuck = [];
    for (const v of views) {
      for (const m of v.members || []) {
        if (m.state === "failed" || m.state === "unknown") stuck.push(m.serverId);
      }
    }
    applyNarrowing(run, selectedIds, stuck);
    return true;
  };

  if (check()) return () => {};
  const unsubscribe = batchesStore.subscribe(() => { if (check()) unsubscribe(); });
  return unsubscribe;
}

function applyNarrowing(run, selectedIds, stuckIds) {
  const fired = new Set(selectedIds || []);
  const current = selectionStore.getState().ids;
  if (current.length !== fired.size || current.some((id) => !fired.has(id))) return;
  const keep = new Set(stuckIds);
  for (const u of run.undispatched || []) keep.add(u.serverId);
  selectionStore.keep([...keep]);
}

/// Cancel a run: one DELETE per node holding a share of it.
///
/// A cancel stops PENDING members only. A kgsm invocation already under way is not interruptible, so
/// each node answers with what it could not stop, and that half is carried out to the caller intact —
/// an operator who reads "cancelled" and then watches a server stop anyway has been misled about the
/// one thing they were trying to prevent.
///
/// Cancelling a run can partially fail exactly as dispatching one can: a node that does not answer
/// keeps running its share, and is reported as untouched rather than folded in with the batches that
/// did stop.
function cancelRun(run) {
  const targets = ((run && run.batches) || []).filter((b) => b && b.id && b.hostId && b.state !== "settled");
  if (!targets.length) return Promise.resolve(summarizeCancel([]));
  return Promise.all(targets.map((b) => api.host(b.hostId).del("/batches/" + encodeURIComponent(b.id)).then(
    (data) => ({ hostId: b.hostId, batchId: b.id, ok: true, data, err: null }),
    (err) => ({ hostId: b.hostId, batchId: b.id, ok: false, data: null, err }),
  ))).then((nodes) => {
    // Re-read rather than patch: what a cancel left behind is the nodes' to state, and each one
    // republishes its batch as it settles the jobs it stopped.
    batchesStore.refresh().catch(() => {});
    return summarizeCancel(nodes);
  });
}

function summarizeCancel(nodes) {
  const cancelled = [];
  const stillRunning = [];
  const untouched = [];
  for (const n of nodes) {
    if (!n.ok) { untouched.push({ hostId: n.hostId, batchId: n.batchId, err: n.err }); continue; }
    const data = n.data || {};
    for (const serverId of data.cancelled || []) cancelled.push({ serverId, hostId: n.hostId });
    for (const serverId of data.stillRunning || []) stillRunning.push({ serverId, hostId: n.hostId });
  }
  return {
    cancelled, stillRunning, untouched,
    nodesAsked: nodes.length,
    nodesReached: nodes.filter((n) => n.ok).length,
  };
}

export { cancelRun, dispatchRun, groupByHost, mintRunId, narrowSelectionWhenSettled };
