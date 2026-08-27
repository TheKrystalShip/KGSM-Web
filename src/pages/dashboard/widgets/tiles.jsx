import React from "react";

import { Kpi } from "../../../components/KPI.jsx";
import { useNav } from "../../../components/NavContext.jsx";
import { fmtUntil } from "../../../lib/formatting.js";
import { useStore } from "../../../lib/store.js";
import { auditStore, hostsStore, serversStore } from "../../../lib/stores.js";
import { AVAILABILITY_WINDOW, fleetOpsStore, startFleetOps, stopFleetOps } from "../../../lib/stores/fleet.js";
import * as kpi from "../fleetKpis.js";

// tiles.jsx — the twelve glance figures, each its own widget.
//
// A tile is placeable alone, which is the whole point: somebody who wants the four numbers they care
// about can have exactly those four, and the add-widget catalog can offer a single figure. They are
// twelve components rather than one parameterised block because a block cannot be interleaved with
// anything else — you could never put Crashes·24h beside a leaf journal.
//
// The figures themselves are derived in ../fleetKpis.js, once, so twelve tiles cannot drift into
// twelve slightly different definitions of "running". This file is only how each is worded.
//
// Each recomputes from the same stores, which is cheap: the data is already in memory and the
// derivation is a reduce over an array. What is NOT cheap is the per-node fetch behind five of them,
// which is why `useFleetOps` shares one refcounted loop (stores/fleet.js) rather than each tile
// running its own.

// ---- Shared bits ---------------------------------------------------------

// The per-node payloads behind Uptime, Drift, Oldest backup, Schedule fails and Services. The loop
// is refcounted, so five tiles wanting it run one loop and the last to leave stops it.
function useFleetOps() {
  React.useEffect(() => { startFleetOps(); return () => stopFleetOps(); }, []);
  return {
    ops: useStore(fleetOpsStore, s => s.byHost),
    loaded: useStore(fleetOpsStore, s => s.everLoaded),
  };
}

// Wall-clock, ticking, for every relative duration. A backup's age and a crash's place in the last
// 24h are facts about the world, not about the event feed — anchoring them to the newest audit event
// would subtract the cluster's idle time from both, reading an overdue backup as fresh and dropping
// real crashes out of the window early.
function useNow(everyMs = 30_000) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

const useServers = () => useStore(serversStore, s => s.list);
const useAudit = () => useStore(auditStore, s => s.list);

// ---- Row 1 · the fleet and the people ------------------------------------

function TileRunning() {
  const nav = useNav();
  const servers = useServers();
  const run = kpi.running(servers);
  return (
    <Kpi compact icon="server" label="Running"
      value={servers.length ? run.count : "—"}
      unit={servers.length ? "of " + run.total : null}
      sub={servers.length
        ? (run.transitional ? `${run.transitional} in transition` : `${run.total - run.count} stopped`)
        : "no servers yet"}
      tone={!servers.length ? "muted" : run.count ? "ok" : "muted"}
      onView={() => nav.servers()} />
  );
}

function TilePlayersNow() {
  const nav = useNav();
  const ppl = kpi.players(useServers(), useAudit(), useNow());
  return (
    <Kpi compact icon="users" label="Players now"
      value={ppl.current}
      sub={ppl.peak.peak == null
        ? "peak unknown"
        : (ppl.peak.covered ? `peak ${ppl.peak.peak} today` : `peak ${ppl.peak.peak} in the loaded feed`)
          + (ppl.unseen ? ` · ${ppl.unseen} unseen` : "")}
      tone={ppl.current > 0 ? "info" : "muted"}
      onView={() => nav.servers()} />
  );
}

function TilePlayersWeek() {
  const nav = useNav();
  const week = kpi.weeklyPlayers(useAudit(), useNow());
  return (
    <Kpi compact icon="user-round-check" label="Players · 7d"
      value={week.count}
      sub={week.count
        ? `across ${week.servers} server${week.servers === 1 ? "" : "s"}` + (week.covered ? "" : " · partial feed")
        : "nobody connected"}
      tone={week.count ? "info" : "muted"}
      onView={() => nav.audit()} />
  );
}

function TilePlayed() {
  const nav = useNav();
  const play = kpi.played(useAudit(), useNow());
  return (
    <Kpi compact icon="hourglass" label="Played · 24h"
      value={play.hours >= 10 ? Math.round(play.hours) : Math.round(play.hours * 10) / 10}
      unit="h"
      sub={play.sessions
        ? `${play.sessions} session${play.sessions === 1 ? "" : "s"}`
          + (play.unpaired ? ` · ${play.unpaired} started earlier` : "")
        : "no sessions"}
      tone={play.hours > 0 ? "info" : "muted"}
      onView={() => nav.audit()} />
  );
}

function TileUptime() {
  const nav = useNav();
  const { ops, loaded } = useFleetOps();
  const avail = kpi.availability(ops);
  return (
    <Kpi compact icon="shield-check" label={"Uptime · " + AVAILABILITY_WINDOW}
      value={avail.pct == null ? "—" : (avail.pct >= 99.95 ? "100" : avail.pct.toFixed(2))}
      unit={avail.pct == null ? null : "%"}
      sub={avail.pct == null
        ? (loaded ? "nothing scheduled up" : "measuring…")
        : (avail.outages
          ? `${avail.outages} outage${avail.outages === 1 ? "" : "s"} · ${avail.counted} servers`
          : `no outages · ${avail.counted} servers`) + kpi.partial(avail.unknownNodes)}
      tone={avail.tone}
      onView={() => nav.audit()} />
  );
}

function TileTimeToReady() {
  const nav = useNav();
  const ready = kpi.timeToReadyRollup(useAudit(), useNow());
  return (
    <Kpi compact icon="timer" label="Time to ready"
      value={ready.avgSec == null ? "—" : kpi.fmtSecs(ready.avgSec)}
      sub={ready.avgSec == null ? "no boots recorded"
        : ready.samples > 1
          ? `slowest ${kpi.fmtSecs(ready.slowest.sec)} · ${ready.slowest.name}`
          : `one boot · ${ready.slowest.name}`}
      tone={ready.avgSec == null ? "muted" : "info"}
      onView={() => nav.audit()} />
  );
}

// ---- Row 2 · what needs me ------------------------------------------------

function TileDrift() {
  const nav = useNav();
  const dft = kpi.drift(useFleetOps().ops);
  return (
    <Kpi compact icon="git-compare-arrows" label="Drift"
      value={dft.unknownNodes && !dft.supervised ? "—" : dft.count}
      sub={dft.unknownNodes && !dft.supervised
        ? "supervisor unreachable"
        : dft.count
          ? dft.names.slice(0, 2).join(", ") + (dft.count > 2 ? ` +${dft.count - 2}` : "")
          : `${dft.supervised} supervised` + kpi.partial(dft.unknownNodes)}
      tone={dft.tone}
      onView={() => nav.servers()} />
  );
}

function TileCrashes() {
  const nav = useNav();
  const hosts = useStore(hostsStore, s => s.list);
  const crash = kpi.crashes24h(useAudit(), hosts, useNow());
  return (
    <Kpi compact icon="server-crash" label="Crashes · 24h"
      value={crash.blind ? "—" : crash.count}
      sub={crash.blind ? "watchdog down — not monitoring"
        : crash.count ? `last: ${crash.last.target?.name || "server"}` : "all stable"}
      tone={crash.tone}
      onView={() => nav.audit()} />
  );
}

function TileUpdates() {
  const nav = useNav();
  const now = useNow();
  const upd = kpi.updates(useServers());
  return (
    <Kpi compact icon="circle-arrow-up" label="Updates"
      value={upd.count}
      sub={!upd.count ? "all up to date"
        : upd.oldest != null ? `oldest pending ${kpi.fmtDur(now - upd.oldest)}`
          : upd.list.map(s => s.game).join(", ")}
      tone={upd.count ? "info" : "muted"}
      onView={upd.count ? () => nav.servers("updates") : null} />
  );
}

function TileOldestBackup() {
  const nav = useNav();
  const now = useNow();
  const servers = useServers();
  const bak = kpi.backups(servers, useFleetOps().ops, now);

  const nextRun = bak.sched.nextBackup ? fmtUntil(new Date(bak.sched.nextBackup.at), new Date(now)) : null;
  const sub = bak.never.length
    ? (bak.never.length === 1 ? bak.never[0].name : `${bak.never.length} servers have none`)
    : nextRun ? `next ${nextRun} · ${bak.sched.nextBackup.name}`
      : bak.oldest ? bak.oldest.name
        : servers.length && bak.unscanned === servers.length ? "not scanned yet"
          : "no backups yet";
  // One unprotected server drills into it; several drill into the list, since picking one of them to
  // open would be arbitrary.
  const view = bak.never.length > 1 ? () => nav.servers()
    : bak.never.length === 1 ? () => nav.openServer(bak.never[0].id)
      : bak.oldest ? () => nav.openServer(bak.oldest.id) : null;

  return (
    <Kpi compact icon="database-backup" label="Oldest backup"
      value={bak.never.length ? "never" : bak.oldest ? kpi.fmtDur(bak.ageMs) : "—"}
      sub={sub} tone={bak.tone} onView={view} />
  );
}

function TileScheduleFails() {
  const nav = useNav();
  const sched = kpi.schedules(useFleetOps().ops, useNow());
  return (
    <Kpi compact icon="calendar-x" label="Schedule fails"
      value={sched.unknownNodes && !sched.scheduled ? "—" : sched.failures.length}
      sub={sched.unknownNodes && !sched.scheduled
        ? "scheduler unreachable"
        : sched.failures.length
          ? `${sched.failures[0].name} ${sched.failures[0].kind}`
          : `${sched.scheduled} scheduled` + kpi.partial(sched.unknownNodes)}
      tone={sched.tone}
      onView={() => nav.cluster()} />
  );
}

function TileServices() {
  const nav = useNav();
  const { ops, loaded } = useFleetOps();
  const svc = kpi.services(ops);
  return (
    <Kpi compact icon="boxes" label="Services"
      value={svc.total ? svc.healthy : "—"}
      unit={svc.total ? "of " + svc.total : null}
      sub={!svc.total ? (loaded ? "not reported" : "measuring…")
        : svc.unhealthy.length
          ? `${svc.unhealthy[0].name} ${svc.unhealthy[0].label.toLowerCase()}`
          : "all healthy" + kpi.partial(svc.unknownNodes)}
      tone={svc.tone}
      onView={() => nav.cluster()} />
  );
}

export {
  TileCrashes, TileDrift, TileOldestBackup, TilePlayed, TilePlayersNow, TilePlayersWeek,
  TileRunning, TileScheduleFails, TileServices, TileTimeToReady, TileUpdates, TileUptime,
};
