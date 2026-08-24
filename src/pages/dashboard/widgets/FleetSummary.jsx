import React from "react";

import { Kpi } from "../../../components/KPI.jsx";
import { useNav } from "../../../components/NavContext.jsx";
import { fmtUntil } from "../../../lib/formatting.js";
import { useStore } from "../../../lib/store.js";
import { auditStore, hostsStore, serversStore } from "../../../lib/stores.js";
import { AVAILABILITY_WINDOW, fleetOpsStore, startFleetOps, stopFleetOps } from "../../../lib/stores/fleet.js";
import * as kpi from "../fleetKpis.js";

// FleetSummary — the twelve glance tiles, as one widget.
//
// Self-sufficient: it reads the stores itself and navigates through NavContext, so it renders the
// same whether it is on the dashboard grid or anywhere else. The figures are derived in
// ../fleetKpis.js; this file is only how they are worded.
//
// A tile whose source is missing KEEPS ITS SLOT and renders "—" with an honest sub-line. In a fixed
// grid a self-hiding tile would reflow the whole band, and an absent measurement is a thing worth
// saying rather than a gap to close.

function FleetSummary() {
  const nav = useNav();
  const servers = useStore(serversStore, s => s.list);
  const audit = useStore(auditStore, s => s.list);
  const hosts = useStore(hostsStore, s => s.list);
  const ops = useStore(fleetOpsStore, s => s.byHost);
  const opsLoaded = useStore(fleetOpsStore, s => s.everLoaded);

  // The four per-node payloads behind tiles 5, 7, 10, 11 and 12. The loop is refcounted, so several
  // consumers can want it at once and it stops when the last one leaves (stores/fleet.js).
  React.useEffect(() => { startFleetOps(); return () => stopFleetOps(); }, []);

  // Wall-clock, for every relative duration below. A backup's age and a crash's place in the last
  // 24h are facts about the world, not about the event feed — anchoring them to the newest audit
  // event would subtract the cluster's idle time from both, reading an overdue backup as fresh and
  // dropping real crashes out of the window early.
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const run = kpi.running(servers);
  const ppl = kpi.players(servers, audit, now);
  const week = kpi.weeklyPlayers(audit, now);
  const play = kpi.played(audit, now);
  const avail = kpi.availability(ops);
  const ready = kpi.timeToReadyRollup(audit, now);
  const dft = kpi.drift(ops);
  const crash = kpi.crashes24h(audit, hosts, now);
  const upd = kpi.updates(servers);
  const bak = kpi.backups(servers, ops, now);
  const sched = kpi.schedules(ops, now);
  const svc = kpi.services(ops);

  const nextRun = bak.sched.next ? fmtUntil(new Date(bak.sched.next.at), new Date(now)) : null;
  const backupSub = bak.never.length
    ? (bak.never.length === 1 ? bak.never[0].name : `${bak.never.length} servers have none`)
    : nextRun ? `next ${nextRun} · ${bak.sched.next.name}`
      : bak.oldest ? bak.oldest.name
        : servers.length && bak.unscanned === servers.length ? "not scanned yet"
          : "no backups yet";
  // One unprotected server drills into it; several drill into the list, since picking one of them to
  // open would be arbitrary.
  const backupView = bak.never.length > 1 ? () => nav.servers()
    : bak.never.length === 1 ? () => nav.openServer(bak.never[0].id)
      : bak.oldest ? () => nav.openServer(bak.oldest.id) : null;

  return (
    <div className="dash-summary">
      {/* ---- Row 1 · the fleet and the people ---- */}
      <Kpi compact icon="server" label="Running"
        value={servers.length ? run.count : "—"}
        unit={servers.length ? "of " + run.total : null}
        sub={servers.length
          ? (run.transitional ? `${run.transitional} in transition` : `${run.total - run.count} stopped`)
          : "no servers yet"}
        tone={!servers.length ? "muted" : run.count ? "ok" : "muted"}
        onView={() => nav.servers()} />

      <Kpi compact icon="users" label="Players now"
        value={ppl.current}
        sub={ppl.peak.peak == null
          ? "peak unknown"
          : (ppl.peak.covered ? `peak ${ppl.peak.peak} today` : `peak ${ppl.peak.peak} in the loaded feed`)
            + (ppl.unseen ? ` · ${ppl.unseen} unseen` : "")}
        tone={ppl.current > 0 ? "info" : "muted"}
        onView={() => nav.servers()} />

      <Kpi compact icon="user-round-check" label="Players · 7d"
        value={week.count}
        sub={week.count
          ? `across ${week.servers} server${week.servers === 1 ? "" : "s"}` + (week.covered ? "" : " · partial feed")
          : "nobody connected"}
        tone={week.count ? "info" : "muted"}
        onView={() => nav.audit()} />

      <Kpi compact icon="hourglass" label="Played · 24h"
        value={play.hours >= 10 ? Math.round(play.hours) : Math.round(play.hours * 10) / 10}
        unit="h"
        sub={play.sessions
          ? `${play.sessions} session${play.sessions === 1 ? "" : "s"}`
            + (play.unpaired ? ` · ${play.unpaired} started earlier` : "")
          : "no sessions"}
        tone={play.hours > 0 ? "info" : "muted"}
        onView={() => nav.audit()} />

      <Kpi compact icon="shield-check" label={"Uptime · " + AVAILABILITY_WINDOW}
        value={avail.pct == null ? "—" : (avail.pct >= 99.95 ? "100" : avail.pct.toFixed(2))}
        unit={avail.pct == null ? null : "%"}
        sub={avail.pct == null
          ? (opsLoaded ? "nothing scheduled up" : "measuring…")
          : (avail.outages
            ? `${avail.outages} outage${avail.outages === 1 ? "" : "s"} · ${avail.counted} servers`
            : `no outages · ${avail.counted} servers`) + kpi.partial(avail.unknownNodes)}
        tone={avail.tone}
        onView={() => nav.audit()} />

      <Kpi compact icon="timer" label="Time to ready"
        value={ready.avgSec == null ? "—" : kpi.fmtSecs(ready.avgSec)}
        sub={ready.avgSec == null ? "no boots recorded"
          : ready.samples > 1
            ? `slowest ${kpi.fmtSecs(ready.slowest.sec)} · ${ready.slowest.name}`
            : `one boot · ${ready.slowest.name}`}
        tone={ready.avgSec == null ? "muted" : "info"}
        onView={() => nav.audit()} />

      {/* ---- Row 2 · what needs me ---- */}
      <Kpi compact icon="git-compare-arrows" label="Drift"
        value={dft.unknownNodes && !dft.supervised ? "—" : dft.count}
        sub={dft.unknownNodes && !dft.supervised
          ? "supervisor unreachable"
          : dft.count
            ? dft.names.slice(0, 2).join(", ") + (dft.count > 2 ? ` +${dft.count - 2}` : "")
            : `${dft.supervised} supervised` + kpi.partial(dft.unknownNodes)}
        tone={dft.tone}
        onView={() => nav.servers()} />

      <Kpi compact icon="server-crash" label="Crashes · 24h"
        value={crash.blind ? "—" : crash.count}
        sub={crash.blind ? "watchdog down — not monitoring"
          : crash.count ? `last: ${crash.last.target?.name || "server"}` : "all stable"}
        tone={crash.tone}
        onView={() => nav.audit()} />

      <Kpi compact icon="circle-arrow-up" label="Updates"
        value={upd.count}
        sub={!upd.count ? "all up to date"
          : upd.oldest != null ? `oldest pending ${kpi.fmtDur(now - upd.oldest)}`
            : upd.list.map(s => s.game).join(", ")}
        tone={upd.count ? "info" : "muted"}
        onView={upd.count ? () => nav.servers("updates") : null} />

      <Kpi compact icon="database-backup" label="Oldest backup"
        value={bak.never.length ? "never" : bak.oldest ? kpi.fmtDur(bak.ageMs) : "—"}
        sub={backupSub}
        tone={bak.tone}
        onView={backupView} />

      <Kpi compact icon="calendar-x" label="Schedule fails"
        value={sched.unknownNodes && !sched.scheduled ? "—" : sched.failures.length}
        sub={sched.unknownNodes && !sched.scheduled
          ? "scheduler unreachable"
          : sched.failures.length
            ? `${sched.failures[0].name} ${sched.failures[0].kind}`
            : `${sched.scheduled} scheduled` + kpi.partial(sched.unknownNodes)}
        tone={sched.tone}
        onView={() => nav.cluster()} />

      <Kpi compact icon="boxes" label="Services"
        value={svc.total ? svc.healthy : "—"}
        unit={svc.total ? "of " + svc.total : null}
        sub={!svc.total ? (opsLoaded ? "not reported" : "measuring…")
          : svc.unhealthy.length
            ? `${svc.unhealthy[0].name} ${svc.unhealthy[0].label.toLowerCase()}`
            : "all healthy" + kpi.partial(svc.unknownNodes)}
        tone={svc.tone}
        onView={() => nav.cluster()} />
    </div>
  );
}

export { FleetSummary };
export default FleetSummary;
