// fleetOps.js — pure rollups over the per-node payloads `stores/fleet.js` fetches.
//
// Four facts the summary band states about the whole cluster, each assembled from one slice per
// node. They share a shape and a rule:
//
//   · every result carries `unknownNodes` — how many nodes could not answer for this fact. A
//     figure with unknown nodes behind it is a floor, not a total, and the tile qualifies it.
//   · a node that answered with nothing is not the same as a node that did not answer. The first
//     contributes zero; the second contributes to `unknownNodes` and to nothing else.
//
// No React, no API — these take the store's `byHost` map and return numbers.

import { leafStatus } from "./leaves.js";

const values = (byHost) => Object.values(byHost || {});

// ---------- Availability ----------

// The cluster's uptime over the window, time-weighted across nodes.
//
// Weighted, not averaged: each node's report already sums seconds across its own servers for the
// same reason, and averaging two nodes' percentages would let a node running one server for an
// hour weigh as much as one running twenty all week.
//
// `pct` is null whenever nothing on the cluster was meant to be running — an idle fleet has not
// achieved 100% uptime, it has achieved nothing measurable, and the tile reads "—".
function availabilityRollup(byHost) {
  let intended = 0, down = 0, outages = 0, counted = 0, unknownNodes = 0, degradedNodes = 0;
  let coverageFrom = null;
  let truncated = false;

  for (const rec of values(byHost)) {
    const a = rec && rec.availability;
    if (!a || !a.fleet) { unknownNodes++; continue; }
    if (a.engineHistoryDegraded) { degradedNodes++; unknownNodes++; continue; }
    intended += a.fleet.intendedSeconds || 0;
    down += a.fleet.downtimeSeconds || 0;
    outages += a.fleet.outages || 0;
    counted += a.fleet.serversCounted || 0;
    truncated = truncated || !!a.truncated;
    // The LATEST start wins: the rollup can only speak for the span every node it counted covers.
    const from = a.from ? +new Date(a.from) : null;
    if (from != null && (coverageFrom == null || from > coverageFrom)) coverageFrom = from;
  }

  const pct = intended > 0 ? Math.max(0, Math.min(1, (intended - down) / intended)) : null;
  return { pct, intendedSeconds: intended, downtimeSeconds: down, outages, counted, unknownNodes, degradedNodes, coverageFrom, truncated };
}

// ---------- Desired-state drift ----------

// Instances the supervisor was told to run that are not running — a standing condition, distinct
// from a crash, which is an event. A crash the watchdog recovered from leaves no drift; drift is
// what is wrong right now and nobody has noticed.
//
// Only instances the watchdog actually holds a desired state for can drift. One it has no row for
// has never been given an intent, so its absence is not a discrepancy — which is also why a
// deliberately stopped server does not appear here.
function driftRollup(byHost) {
  let unknownNodes = 0;
  let notReadyNodes = 0;
  const drifting = [];
  let supervised = 0;

  for (const rec of values(byHost)) {
    const sup = rec && rec.supervision;
    if (!sup || !Array.isArray(sup.data)) { unknownNodes++; continue; }
    // `ready:false` with a full table is a real state — the daemon is up and cannot spawn — so the
    // rows still count and the node is flagged rather than dropped.
    if (sup.ready === false) notReadyNodes++;
    for (const row of sup.data) {
      if (!row || !row.name) continue;
      supervised++;
      if (row.desired && row.phase && row.desired !== row.phase) drifting.push(row.name);
    }
  }

  return { count: drifting.length, names: drifting, supervised, unknownNodes, notReadyNodes };
}

// ---------- Maintenance windows ----------

// When the next maintenance window fires anywhere on the cluster, and how many last ran badly.
//
// A run ends in one of four words and only `failed` is a fault: `ok` is a pass, `skipped` is a task that
// did not apply to the instance as it stood, and `aborted` is one an earlier failure in the same window
// took the turn from. Raising either of the last two would report a fault the daemon did not record, and
// a window that has never run carries no record at all — which is not a failure either.
//
// `nextBackup` is tracked beside `next` because the two answer different questions: the soonest window
// on the cluster is what an operator plans around, and the soonest one that takes an ARCHIVE is what the
// backup figure is entitled to name.
function scheduleRollup(byHost, now) {
  let unknownNodes = 0;
  const failures = [];
  let next = null;         // { at, name, kind }
  let nextBackup = null;   // the same, restricted to windows carrying a backup
  let scheduled = 0;

  for (const rec of values(byHost)) {
    const rows = rec && rec.schedules;
    if (!Array.isArray(rows)) { unknownNodes++; continue; }
    for (const r of rows) {
      if (!r || !r.name) continue;
      for (const w of Array.isArray(r.windows) ? r.windows : []) {
        if (!w || !w.id) continue;
        const tasks = Array.isArray(w.tasks) ? w.tasks : [];

        if (w.lastRun && w.lastRun.outcome === "failed") {
          // Which task failed is what makes "the window failed" actionable, so the tile names it rather
          // than the window. A run recorded as failed with no failing task named keeps the hedge.
          const culprit = ((w.lastRun.tasks || []).find(t => t && t.outcome === "failed")) || null;
          failures.push({
            name: r.name,
            kind: culprit ? culprit.name : "maintenance",
            message: (culprit && culprit.message) || null,
          });
        }

        if (!w.nextFireUtc) continue;
        const at = +new Date(w.nextFireUtc);
        if (!Number.isFinite(at)) continue;
        scheduled++;
        // A fire time already past is the scheduler's own boundary jitter, not a job to announce as
        // "next" — it is behind us, and pointing at it would leave the tile stuck reading "due".
        if (at < now) continue;
        const entry = { at, name: r.name, kind: tasks.join(", ") || "no tasks" };
        if (!next || at < next.at) next = entry;
        if (tasks.includes("backup") && (!nextBackup || at < nextBackup.at)) nextBackup = entry;
      }
    }
  }

  return { next, nextBackup, failures, scheduled, unknownNodes };
}

// ---------- Leaf health ----------

// How many of the cluster's leaves are doing their job. Reuses `leafStatus` — the same rule the
// Services board renders — so a socket-activated leaf resting between calls reads Idle here too
// rather than being counted as a fault.
function servicesRollup(byHost) {
  let unknownNodes = 0;
  let total = 0, healthy = 0;
  const unhealthy = [];

  for (const rec of values(byHost)) {
    const list = rec && rec.services;
    if (!Array.isArray(list)) { unknownNodes++; continue; }
    for (const svc of list) {
      if (!svc || !svc.id) continue;
      total++;
      const st = leafStatus(svc);
      // Up, or resting on purpose. Anything else is worth a person's attention, including the
      // deliberately neutral `off` — a leaf that is simply stopped is not doing its job.
      if (st.tone === "up" || st.tone === "idle") healthy++;
      else unhealthy.push({ id: svc.id, label: st.label, tone: st.tone, name: svc.displayName || svc.id });
    }
  }

  // Worst first, so a single named leaf on the tile is the one that matters most.
  const rank = { down: 0, warn: 1, off: 2 };
  unhealthy.sort((a, b) => (rank[a.tone] ?? 3) - (rank[b.tone] ?? 3));
  return { healthy, total, unhealthy, unknownNodes };
}


// ---- What the alert engine is watching ------------------------------------------------------
//
// The rules the fleet's conditions are raised from, for the alerts card's all-clear state. Two
// families, and they are not the same kind of thing:
//
//   - METRIC rules come from each node's threshold policy, which the monitor owns and the API
//     relays. They carry an `enabled` flag, so a rule that is switched OFF is reported as such
//     rather than omitted — an unarmed rule is exactly what somebody reading this card needs to
//     see, and dropping the row would make it indistinguishable from one that is watching.
//   - LIFECYCLE rules (a crash loop, an update waiting) are not configurable and have no policy
//     row; they are on whenever the node has the leaf that observes them.
//
// A node whose policy could not be read contributes nothing and is counted in `unknownNodes`, so
// the card can say the list is partial instead of presenting it as the whole truth.

// The human name for each policy key. A key with no entry still renders — under its own key —
// so a rule the monitor grows later is a plain row rather than a missing one.
const RULE_LABEL = {
  "host-disk": "Disk headroom",
  "host-mem": "Memory pressure",
  "host-swap": "Swap pressure",
  "host-load": "CPU load",
  "host-temp": "Temperature",
  "host-gpu-mem": "GPU memory",
  "srv-pids": "Process count",
  "srv-mem": "Server memory",
  "srv-cpu": "Server CPU",
};

function watchedRules(byHost, serverCount) {
  const hosts = Object.keys(byHost || {});
  const merged = new Map();   // key -> { key, label, scope, enabledOn, totalOn }
  let unknownNodes = 0;

  for (const id of hosts) {
    const policy = byHost[id] ? byHost[id].thresholds : null;
    const rules = policy && Array.isArray(policy.rules) ? policy.rules : null;
    if (!rules) { unknownNodes++; continue; }
    for (const r of rules) {
      if (!r || !r.key) continue;
      const prev = merged.get(r.key) || {
        key: r.key,
        label: RULE_LABEL[r.key] || r.key,
        // A `srv-` rule is evaluated per server; everything else is about the machine.
        scope: r.key.startsWith("srv-") ? "server" : "node",
        enabledOn: 0,
        totalOn: 0,
      };
      prev.totalOn++;
      if (r.enabled) prev.enabledOn++;
      merged.set(r.key, prev);
    }
  }

  const nodeCount = hosts.length - unknownNodes;
  const metric = [...merged.values()].map(r => ({
    ...r,
    // Armed on at least one node it was readable on. A rule off everywhere reads as unarmed.
    armed: r.enabledOn > 0,
    scopeLabel: r.scope === "server"
      ? (serverCount === 1 ? "1 server" : serverCount + " servers")
      : (nodeCount === 1 ? "1 node" : nodeCount + " nodes"),
  }));

  // Sorted armed-first so the card's visible rows are the ones actually watching, with anything
  // switched off surfacing in the overflow count rather than pushing a live rule out of view.
  metric.sort((a, b) => (b.armed ? 1 : 0) - (a.armed ? 1 : 0) || a.label.localeCompare(b.label));
  return { rules: metric, unknownNodes, readNodes: nodeCount };
}

export { availabilityRollup, driftRollup, scheduleRollup, servicesRollup, watchedRules };
