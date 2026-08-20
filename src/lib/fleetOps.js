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

// ---------- Backup & restart schedules ----------

// When the next scheduled job fires anywhere on the cluster, and how many schedules last ran badly.
//
// A schedule that has never run is not a failure — `lastRunOk`/`lastBackupOk` are null until a run
// happens, and only an explicit `false` counts. Treating null as failure would report every
// freshly-configured schedule as broken.
function scheduleRollup(byHost, now) {
  let unknownNodes = 0;
  const failures = [];
  let next = null;   // { at, name, kind }
  let scheduled = 0;

  for (const rec of values(byHost)) {
    const rows = rec && rec.schedules;
    if (!Array.isArray(rows)) { unknownNodes++; continue; }
    for (const r of rows) {
      if (!r || !r.name) continue;
      if (r.lastBackupOk === false) failures.push({ name: r.name, kind: "backup", message: r.lastBackupMessage || null });
      if (r.lastRunOk === false) failures.push({ name: r.name, kind: "restart", message: r.lastRunMessage || null });

      for (const [iso, kind] of [[r.nextBackupUtc, "backup"], [r.nextFireUtc, "restart"]]) {
        if (!iso) continue;
        const at = +new Date(iso);
        if (!Number.isFinite(at)) continue;
        scheduled++;
        // A fire time already past is the scheduler's own boundary jitter, not a job to announce as
        // "next" — it is behind us, and pointing at it would leave the tile stuck reading "due".
        if (at < now) continue;
        if (!next || at < next.at) next = { at, name: r.name, kind };
      }
    }
  }

  return { next, failures, scheduled, unknownNodes };
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

export { availabilityRollup, driftRollup, scheduleRollup, servicesRollup };
