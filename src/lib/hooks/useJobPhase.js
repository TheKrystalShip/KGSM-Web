import { batchesStore } from "../stores/batches.js";
import { useStore } from "../store.js";

// useJobPhase — the three states a lifecycle control is drawn in: idle · queued · running.
//
// Two, historically, and it was harmless: every surface derived pending work as
// `job.state === "running"`, so a queued job rendered as idle — no spinner, no label, live buttons —
// and `queued` lasted milliseconds. A batch makes it last as long as the work ahead of it takes. A
// server eighth in a stop queue looked like nothing was happening to it, with a Stop button inviting
// a command the node would refuse.
//
// So the phase is derived ONCE, here, and the surfaces that draw a button read it: the tile, the
// cinematic hero, and an alert card's suggested action. A fourth derivation is how one of them comes
// to disagree with the others about a server nobody is watching.
//
// `queuedTotal` is the batch's member count. It is absent until a node has stated it — through the
// accept that named the admitted members, or a `batch.patch` frame — and the label then reads "3rd"
// rather than inventing a denominator.

/// The verb a job is actually WORKING on, or null.
function pendingVerbOf(server) {
  const job = server && server.job;
  return job && job.state === "running" ? job.verb : null;
}

/// The job a node has taken and not yet started, or null.
function queuedJobOf(server) {
  const job = server && server.job;
  return job && job.state === "queued" ? job : null;
}

function totalOf(byId, batchId) {
  const b = batchId ? byId[batchId] : null;
  if (!b) return null;
  if (b.counts && Number.isFinite(b.counts.total)) return b.counts.total;
  return Number.isFinite(b.total) ? b.total : null;
}

const phase = (server, queuedTotal) => {
  const queued = queuedJobOf(server);
  return {
    pendingVerb: pendingVerbOf(server),
    queuedVerb: queued ? queued.verb : null,
    queuedPosition: queued ? queued.queuedPosition : null,
    queuedTotal,
  };
};

/// The reactive read, for a component that can hold a hook.
function useJobPhase(server) {
  const queued = queuedJobOf(server);
  const batchId = queued ? queued.batchId : null;
  const queuedTotal = useStore(batchesStore, (s) => totalOf(s.byId, batchId));
  return phase(server, queuedTotal);
}

/// The same answer without subscribing, for a caller that has already returned early and cannot take
/// a hook (`AlertCard`'s `useAlertActions`). It re-reads on every render its caller does, which is
/// every server frame — enough for a denominator that arrives once and never moves.
function jobPhaseOf(server) {
  const queued = queuedJobOf(server);
  return phase(server, totalOf(batchesStore.getState().byId, queued ? queued.batchId : null));
}

export { jobPhaseOf, pendingVerbOf, queuedJobOf, useJobPhase };
