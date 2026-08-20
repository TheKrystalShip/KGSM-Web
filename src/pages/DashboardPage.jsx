import React from "react";
import { DashBandList, loadDashOrder, saveDashOrder } from "../components/DashLayout.jsx";
import { Icon } from "../components/Icon.jsx";
import { Kpi } from "../components/KPI.jsx";
import { NeedsAttention } from "../components/NeedsAttention.jsx";
import { ServerTile } from "../components/ServerCard.jsx";
import { DashboardSkeleton, Skel } from "../components/Skeletons.jsx";
import { GameCard } from "../components/GameCard.jsx";
import { ClusterReach } from "../components/host-helpers.jsx";
import { Rail } from "../components/Rail.jsx";
import { RecentActivity } from "../components/RecentActivity.jsx";
import { capUsable } from "../lib/capabilities.js";
import { availabilityRollup, driftRollup, scheduleRollup, servicesRollup } from "../lib/fleetOps.js";
import { crashes, playersPeak, sessionHours, timeToReady, uniquePlayers } from "../lib/fleetStats.js";
import { fmtUntil } from "../lib/formatting.js";
import { KRYSTAL_LABELS } from "../lib/labels.js";
import { fleetSummary, instancesOfBlueprint } from "../lib/servers.js";
import { useStore } from "../lib/store.js";
import { auditStore, clusterStore, favoritesStore, hostsStore, libraryStore, pingStore, serversStore } from "../lib/stores.js";
import { AVAILABILITY_WINDOW, fleetOpsStore, startFleetOps, stopFleetOps } from "../lib/stores/fleet.js";
import { DashFleetStrip } from "./dashboard/DashFleetStrip.jsx";
import { buildClusterNodes } from "./diagnostics/clusterNodes.js";

// DashboardPage — the post-login home. Aggregate stats, a server grid,
// and a recent-activity feed. Designed to answer "what should I care about
// right now?" at a glance.
//
// The server grid here is online-only — the full, filterable inventory lives
// on the dedicated Servers page. ServerTile is shared via ServerCard.jsx.
// The fleet-capacity strip lives in dashboard/DashFleetStrip.jsx.

// The dashboard KPI card lives in KPI.jsx (KPI) and is shared with the
// host diagnostics overview and the server-detail overview stats.

function DashboardPage({ user, onOpenServer, onAction, onLibrary, onInstall, onAudit, onDiagnostics, onOpenHostDiagnostics, onAttention, onRunAlertAction, onServers, onOpenServersForNode, onOpenNodeLogs, onAskAboutNode, onViewAlerts, canCluster = true }) {
  // The dashboard is the CLUSTER's front page: every card reads every node. A
  // per-node view is a thing you navigate to (a node's page), not a mode this
  // one switches into.
  const servers = useStore(serversStore, s => s.list);
  // What's up, who's on, and what can't be seen — one line, and the counting rules that keep the
  // player figure honest live in lib/servers.js beside the ones the Servers page reads.
  const summary = fleetSummary(servers);
  // Bottom "Servers" card — the WHOLE fleet on a rail, UNFILTERED by status so
  // it's not a duplicate of the "Online" KPI above. Servers carry no
  // added/created date, so instead of arbitrary list order the ones worth a
  // glance lead: the user's FAVOURITES first (a pinned server is the one they
  // care about most, whatever it's doing), then most-active online, then the
  // ones in transition (they need watching), then offline last.
  // "View all" opens the full Servers page.
  const SERVER_STATUS_RANK = { online: 0, starting: 1, restarting: 2, stopping: 3, updating: 4, offline: 5 };
  const favIds = useStore(favoritesStore, s => s.ids);
  const favSet = React.useMemo(() => new Set(favIds), [favIds]);
  const featuredServers = React.useMemo(() => {
    return [...servers].sort((a, b) => {
      // Favourites jump to the front, regardless of status or player count.
      const fa = favSet.has(a.id) ? 0 : 1;
      const fb = favSet.has(b.id) ? 0 : 1;
      if (fa !== fb) return fa - fb;
      const ra = SERVER_STATUS_RANK[a.status] ?? 5;
      const rb = SERVER_STATUS_RANK[b.status] ?? 5;
      if (ra !== rb) return ra - rb;
      return (b.players?.current || 0) - (a.players?.current || 0);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- SERVER_STATUS_RANK is a constant rank map, never changes
  }, [servers, favSet]);
  // Recent activity is the same feed as the Audit log page — the dashboard is
  // just a compact window onto it, newest-first, across every node; the page
  // owns the full searchable list. Single source: auditStore.
  const auditScoped = useStore(auditStore, s => s.list);
  const hosts = useStore(hostsStore, s => s.list);
  const pings = useStore(pingStore, s => s.byHost);
  const dataLoading = useStore(serversStore, s => s.status === "loading" && !s.everLoaded);
  // Catalog — the whole installable library on a rail, ordered so the actionable
  // half comes first: what you could add, then what you already run. The backend
  // blueprint catalog carries no "added" date (the LibraryEntry DTO has no
  // timestamp), so within each half the order is alphabetical — predictable
  // enough to find a game in, which is what matters once the rail reaches all of
  // them. "View all" opens the full Library.
  const libraryList = useStore(libraryStore, s => s.list);
  const catalogOrdered = React.useMemo(() => {
    return [...libraryList].sort((a, b) => {
      const ia = instancesOfBlueprint(a, servers).length ? 1 : 0;
      const ib = instancesOfBlueprint(b, servers).length ? 1 : 0;
      if (ia !== ib) return ia - ib;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });
  }, [libraryList, servers]);
  // Fleet capacity strip — one mini-meter row per CLUSTER NODE (connected host
  // + federation "ghost" peers), built from the same merge the Cluster page
  // renders from (buildClusterNodes) so the two surfaces never drift. Capacity
  // can't be averaged across machines, so it's always one row per node. No node
  // is marked "local": which address this browser was pointed at first says
  // nothing about the cluster, so the rows sort by name and read as equals.
  const clusterNodesRaw = useStore(clusterStore, s => s.nodes);
  const clusterNodes = React.useMemo(
    () => buildClusterNodes(hosts, clusterNodesRaw, pings, null),
    [hosts, clusterNodesRaw, pings]);
  // Wall-clock, for every relative duration below. A backup's age and a crash's
  // place in the last 24h are facts about the world, not about the event feed —
  // anchoring them to the newest audit event would subtract the cluster's idle
  // time from both, reading an overdue backup as fresh and dropping real crashes
  // out of the window early. The tick re-renders so the durations stay live.
  const [nowTick, setNowTick] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const now = nowTick;

  // ---- KPIs ---------------------------------------------------------------
  // Twelve glance tiles in two rows. The split is by question, not by source: the
  // first six ask "what is happening on the fleet", the second six "what needs me".
  // Each reads something no other band on this page shows — the capacity strip
  // below already renders per-node CPU/RAM/disk and round-trip, so nothing here
  // restates an instantaneous machine reading. What the strip never does is TIME,
  // which is why half of these are windowed.
  //
  // A tile whose source is missing keeps its slot and renders "—" with an honest
  // sub-line. In a fixed grid a self-hiding tile would reflow the whole band, and
  // an absent measurement is a thing worth saying rather than a gap to close.
  const HOUR = 3600000;
  const DAY = 24 * HOUR;
  const fmtDur = (ms) => {
    const m = Math.max(0, Math.round(ms / 60000));
    if (m < 60) return m + "m";
    const h = Math.floor(m / 60);
    if (h < 24) return h + "h";
    const d = Math.floor(h / 24), rh = h % 24;
    return rh ? `${d}d ${rh}h` : `${d}d`;
  };
  // A duration in the units a person would say it in. Sub-minute stays in seconds
  // because a server that boots in 40s and one that takes 3m are a different
  // experience, and "1m" would flatten both.
  const fmtSecs = (sec) => {
    if (sec == null) return "—";
    if (sec < 90) return Math.round(sec) + "s";
    const m = Math.round(sec / 60);
    return m < 60 ? m + "m" : Math.floor(m / 60) + "h " + (m % 60) + "m";
  };
  // "12 of 40 rows" phrasing for a figure some nodes could not contribute to. The
  // count is then a floor, and every tile that can have one says so in its sub-line.
  const partial = (n) => (n > 0 ? ` · ${n} node${n === 1 ? "" : "s"} unknown` : "");

  // The four per-node payloads behind tiles 5, 7, 10, 11 and 12. Fetched on this
  // page's own loop (stores/fleet.js) — they are nobody else's data.
  const ops = useStore(fleetOpsStore, s => s.byHost);
  const opsLoaded = useStore(fleetOpsStore, s => s.everLoaded);
  React.useEffect(() => { startFleetOps(); return () => stopFleetOps(); }, []);

  // ---- Row 1: the fleet and the people -------------------------------------

  // 1) Servers running. The one tile that is purely a count of now, and the anchor
  //    the rest of the band hangs off. The bar is the whole fleet in one line:
  //    running, mid-transition, and stopped.
  const runningCount = servers.filter(s => s.status === "online").length;
  const transitional = servers.filter(s => ["starting", "restarting", "stopping", "updating", "installing"].includes(s.status)).length;
  const runningPct = servers.length ? (runningCount / servers.length) * 100 : 0;

  // 2) Players online now, and the most at once in the last day. The live total
  //    excludes servers whose presence this host cannot see (players === null) —
  //    the peak reconstruction excludes them for the same reason, since a server
  //    that reports no roster emits no join/leave either.
  const playersNow = servers.reduce((n, s) => n + (s.players ? s.players.current : 0), 0);
  const unseenPresence = servers.filter(s => !s.players && s.status !== "offline").length;
  const peak = playersPeak(auditScoped, playersNow, DAY, now);

  // 3) How many different people played this week. The figure a community host
  //    actually cares about, and the only one here that says whether the thing is
  //    being used at all.
  const uniqueWeek = uniquePlayers(auditScoped, 7 * DAY, now);

  // 4) Time spent connected in the last day, summed across everybody. Sessions
  //    whose start fell outside the loaded feed are excluded, not clamped — see
  //    lib/fleetStats.js — so this is a floor whenever `unpaired` is non-zero.
  const played = sessionHours(auditScoped, DAY, now);

  // 5) Availability — uptime as a fraction of the time something WANTED each
  //    server up, folded by the backend from the engine's own lifecycle events.
  //    A deliberately stopped server lowers the denominator instead of the score,
  //    so an idle fleet reads "—" rather than a flattering 100%.
  const avail = availabilityRollup(ops);
  const availPct = avail.pct == null ? null : avail.pct * 100;
  const availTone = availPct == null ? "muted" : availPct >= 99.9 ? "ok" : availPct >= 99 ? "warn" : "danger";

  // 6) How long a server takes to become connectable — start → ready, averaged.
  //    Catches a boot regression after an update, which nothing else on this page
  //    would show until somebody complained.
  const ready = timeToReady(auditScoped, 7 * DAY, now);

  // ---- Row 2: what needs me -------------------------------------------------

  // 7) Desired-state drift — instances the supervisor was told to run that are
  //    not running. A standing condition, deliberately separate from the crash
  //    count beside it: a crash the watchdog recovered from leaves no drift, and
  //    drift with no recent crash is the case nobody ever notices.
  const drift = driftRollup(ops);
  const driftTone = drift.count === 0 ? (drift.unknownNodes ? "muted" : "ok") : "danger";

  // 8) Crashes in the last day. Detection is the watchdog's job, so a node whose
  //    watchdog is down makes the whole count unstateable — a zero from a blind
  //    fleet is a lie, not a clean bill of health.
  const crash24h = crashes(auditScoped, DAY, now);
  const scopedWatchdogDown = hosts.length > 0 && hosts.some(h => !capUsable(h, "watchdog"));
  const crashTone = scopedWatchdogDown ? "muted" : crash24h.count === 0 ? "ok" : crash24h.count < 3 ? "warn" : "danger";

  // 9) Updates available, and how long the oldest has been outstanding. The age
  //    is what separates "a new build exists" from "this has been overdue a week";
  //    it comes from the engine's own first notice, and is null until the backend
  //    can date one (never derived from the check time).
  const updatable = servers.filter(s => s.update_available && s.status !== "updating");
  const updateSince = updatable
    .map(s => (s.update_available_since ? +new Date(s.update_available_since) : null))
    .filter(t => t != null && Number.isFinite(t));
  const oldestUpdate = updateSince.length ? Math.min(...updateSince) : null;

  // 10) Backups, looking both ways: the worst-case gap behind us and the next run
  //     ahead. The oldest is the MOST-overdue server, not the most recent — the
  //     one actually at risk is what should surface.
  //     s.last_backup is the newest backup's manifest; its createdAt is what dates it. A backup whose
  //     manifest carries no timestamp can't be ranked by age, so it doesn't compete for "oldest" (it
  //     would otherwise sort as either infinitely old or brand new — both fabrications).
  const backupTs = (s) => (s.last_backup?.createdAt ? +new Date(s.last_backup.createdAt) : null);
  const backedUp = servers.filter(s => backupTs(s) != null);
  const oldestBackup = backedUp.reduce((w, s) => (!w || backupTs(s) < backupTs(w)) ? s : w, null);
  // A server the backend SCANNED and found empty outranks every aged backup: having none at all is a
  // wider gap than having an old one. It carries no age, so it takes the tile outright rather than
  // competing on the date axis — ranking it as "infinitely old" would be inventing a timestamp.
  // Only backup_count === 0 qualifies; null is unscanned (see below) and never counts as unprotected.
  const neverBackedUp = servers.filter(s => s.backup_count === 0);
  const backupAgeMs = oldestBackup ? (now - backupTs(oldestBackup)) : 0;
  const backupTone = neverBackedUp.length
    ? "danger"
    : !oldestBackup ? "muted" : backupAgeMs > 24 * HOUR ? "danger" : backupAgeMs > 12 * HOUR ? "warn" : "ok";
  // Only a server the backend has actually scanned and found empty counts as "no backups yet"; one that
  // hasn't been scanned is unknown, and the KPI says so rather than implying it is unprotected.
  const unscanned = servers.filter(s => s.backup_count == null && !s.last_backup).length;
  const sched = scheduleRollup(ops, now);
  const nextRun = sched.next ? fmtUntil(new Date(sched.next.at), new Date(now)) : null;
  const backupSub = neverBackedUp.length
    ? (neverBackedUp.length === 1 ? neverBackedUp[0].name : `${neverBackedUp.length} servers have none`)
    : nextRun
      ? `next ${nextRun} · ${sched.next.name}`
      : oldestBackup
        ? oldestBackup.name
        : servers.length && unscanned === servers.length
          ? "not scanned yet"
          : "no backups yet";
  // One unprotected server drills into it; several drill into the list, since picking one of them to
  // open would be arbitrary.
  const backupView = neverBackedUp.length > 1
    ? () => onServers()
    : neverBackedUp.length === 1
      ? () => onOpenServer(neverBackedUp[0].id)
      : oldestBackup ? () => onOpenServer(oldestBackup.id) : null;

  // 11) Schedules that last ran badly. A silent failure class with no other
  //     surface here: a backup schedule can fail every night and nothing on this
  //     page would move, because the server itself is perfectly healthy.
  //     Only an explicit false counts — a schedule that has never run is null.
  const schedFailTone = sched.failures.length ? "danger" : sched.unknownNodes ? "muted" : "ok";

  // 12) Leaves doing their job, counted by the same rule the Services board
  //     renders — so a socket-activated leaf resting between calls reads healthy
  //     here too rather than being counted as a fault.
  const svc = servicesRollup(ops);
  const svcTone = !svc.total ? "muted" : svc.unhealthy.length === 0 ? "ok"
    : svc.unhealthy[0].tone === "down" ? "danger" : "warn";

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 5) return "Late one,";
    if (h < 12) return "Morning,";
    if (h < 18) return "Hey,";
    return "Evening,";
  })();

  // ---- Layout customization (client-side, per-browser) --------------------
  // Drag the dashboard's vertical bands to reorder them; the order is remembered
  // per-browser in localStorage — exactly how sidebar collapse and dock width
  // are remembered. Dragging is gated behind an explicit "Customize" mode + a
  // grip handle, so it can never fire against the cards' normal click-to-drill.
  const [dashOrder, setDashOrder] = React.useState(() => loadDashOrder());
  const [customize, setCustomize] = React.useState(false);
  const persistOrder = (order) => { setDashOrder(order); saveDashOrder(order); };
  const resetLayout = () => { setDashOrder([]); saveDashOrder([]); };

  // The reorderable bands in their natural (default) order. Each carries a
  // stable id so a saved order survives content changes; conditional bands are
  // simply omitted when empty and the saved order absorbs the gap (merge-safe).
  const capacityNode = <DashFleetStrip nodes={clusterNodes} onOpenDiagnostics={onDiagnostics} onOpenHost={onOpenHostDiagnostics}
    onOpenServersForNode={onOpenServersForNode} onOpenNodeLogs={onOpenNodeLogs} onAskAboutNode={onAskAboutNode} />;

  const bands = [];
  bands.push({
    id: "summary", label: "Summary",
    node: (
      <div className="dash-summary">
        {/* ---- Row 1 · the fleet and the people ---- */}
        <Kpi compact
          icon="server" label="Running"
          value={servers.length ? runningCount : "—"}
          unit={servers.length ? "of " + servers.length : null}
          sub={servers.length
            ? (transitional ? `${transitional} in transition` : `${servers.length - runningCount} stopped`)
            : "no servers yet"}
          tone={!servers.length ? "muted" : runningCount ? "ok" : "muted"}
          barPct={servers.length ? runningPct : null}
          barColor="var(--success-fg)"
          onView={() => onServers()}
        />
        <Kpi compact
          icon="users" label="Players now"
          value={playersNow}
          sub={peak.peak == null
            ? "peak unknown"
            : (peak.covered ? `peak ${peak.peak} today` : `peak ${peak.peak} in the loaded feed`)
              + (unseenPresence ? ` · ${unseenPresence} unseen` : "")}
          tone={playersNow > 0 ? "info" : "muted"}
          onView={() => onServers()}
        />
        <Kpi compact
          icon="user-round-check" label="Players · 7d"
          value={uniqueWeek.count}
          sub={uniqueWeek.count
            ? `across ${uniqueWeek.servers} server${uniqueWeek.servers === 1 ? "" : "s"}`
            + (uniqueWeek.covered ? "" : " · partial feed")
            : "nobody connected"}
          tone={uniqueWeek.count ? "info" : "muted"}
          onView={onAudit}
        />
        <Kpi compact
          icon="hourglass" label="Played · 24h"
          value={played.hours >= 10 ? Math.round(played.hours) : Math.round(played.hours * 10) / 10}
          unit="h"
          sub={played.sessions
            ? `${played.sessions} session${played.sessions === 1 ? "" : "s"}`
            + (played.unpaired ? ` · ${played.unpaired} started earlier` : "")
            : "no sessions"}
          tone={played.hours > 0 ? "info" : "muted"}
          onView={onAudit}
        />
        <Kpi compact
          icon="shield-check" label={"Uptime · " + AVAILABILITY_WINDOW}
          value={availPct == null ? "—" : (availPct >= 99.95 ? "100" : availPct.toFixed(2))}
          unit={availPct == null ? null : "%"}
          sub={availPct == null
            ? (opsLoaded ? "nothing scheduled up" : "measuring…")
            : (avail.outages
              ? `${avail.outages} outage${avail.outages === 1 ? "" : "s"} · ${avail.counted} servers`
              : `no outages · ${avail.counted} servers`) + partial(avail.unknownNodes)}
          tone={availTone}
          onView={onAudit}
        />
        <Kpi compact
          icon="timer" label="Time to ready"
          value={ready.avgSec == null ? "—" : fmtSecs(ready.avgSec)}
          sub={ready.avgSec == null
            ? "no boots recorded"
            : ready.samples > 1
              ? `slowest ${fmtSecs(ready.slowest.sec)} · ${ready.slowest.name}`
              : `one boot · ${ready.slowest.name}`}
          tone={ready.avgSec == null ? "muted" : "info"}
          onView={onAudit}
        />

        {/* ---- Row 2 · what needs me ---- */}
        <Kpi compact
          icon="git-compare-arrows" label="Drift"
          value={drift.unknownNodes && !drift.supervised ? "—" : drift.count}
          sub={drift.unknownNodes && !drift.supervised
            ? "supervisor unreachable"
            : drift.count
              ? drift.names.slice(0, 2).join(", ") + (drift.count > 2 ? ` +${drift.count - 2}` : "")
              : `${drift.supervised} supervised` + partial(drift.unknownNodes)}
          tone={driftTone}
          onView={() => onServers()}
        />
        <Kpi compact
          icon="server-crash" label="Crashes · 24h"
          value={scopedWatchdogDown ? "—" : crash24h.count}
          sub={scopedWatchdogDown
            ? "watchdog down — not monitoring"
            : crash24h.count ? `last: ${crash24h.last.target?.name || "server"}` : "all stable"}
          tone={crashTone}
          onView={onAudit}
        />
        <Kpi compact
          icon="circle-arrow-up" label="Updates"
          value={updatable.length}
          sub={!updatable.length
            ? "all up to date"
            : oldestUpdate != null
              ? `oldest pending ${fmtDur(now - oldestUpdate)}`
              : updatable.map(s => s.game).join(", ")}
          tone={updatable.length ? "info" : "muted"}
          onView={updatable.length ? () => onServers("updates") : null}
        />
        <Kpi compact
          icon="database-backup" label="Oldest backup"
          value={neverBackedUp.length ? "never" : oldestBackup ? fmtDur(backupAgeMs) : "—"}
          sub={backupSub}
          tone={backupTone}
          onView={backupView}
        />
        <Kpi compact
          icon="calendar-x" label="Schedule fails"
          value={sched.unknownNodes && !sched.scheduled ? "—" : sched.failures.length}
          sub={sched.unknownNodes && !sched.scheduled
            ? "scheduler unreachable"
            : sched.failures.length
              ? `${sched.failures[0].name} ${sched.failures[0].kind}`
              : `${sched.scheduled} scheduled` + partial(sched.unknownNodes)}
          tone={schedFailTone}
          onView={onDiagnostics}
        />
        <Kpi compact
          icon="boxes" label="Services"
          value={svc.total ? svc.healthy : "—"}
          unit={svc.total ? "of " + svc.total : null}
          sub={!svc.total
            ? (opsLoaded ? "not reported" : "measuring…")
            : svc.unhealthy.length
              ? `${svc.unhealthy[0].name} ${svc.unhealthy[0].label.toLowerCase()}`
              : "all healthy" + partial(svc.unknownNodes)}
          tone={svcTone}
          onView={onDiagnostics}
        />
      </div>
    )
  });
  // Fleet / host capacity is admin-only — operators see the dashboard without it.
  if (capacityNode && canCluster) bands.push({ id: "capacity", label: "Capacity", node: capacityNode });
  bands.push({
    id: "feed", label: "Alerts & activity",
    node: (
      // Feed band — "needs me now" (Alerts) beside "what just happened" (Recent
      // activity). Two matched compact-list cards; resolved alerts surface in
      // Recent activity, so there's no separate closed-alerts card. Alerts shows
      // its all-clear empty state to keep the band level.
      <div className="dash-feed">
        <NeedsAttention onPick={onAttention} onRun={onRunAlertAction} onViewAll={onViewAlerts} max={3} emptyState title="Alerts - Latest" />

        <RecentActivity onViewAll={onAudit} max={3} title="Audit - Recent activity" />
      </div>
    )
  });
  if (libraryList.length > 0) bands.push({
    id: "recent", label: "Catalog",
    node: (
      // Catalog — every installable game on a rail, uninstalled first. Clicking a
      // card opens the install flow; "View all" opens the full Library catalog.
      <Rail
        variant="catalog"
        icon="library"
        title={KRYSTAL_LABELS.catalog || "Catalog"}
        count={libraryList.length}
        items={catalogOrdered}
        disabled={customize}
        onViewAll={() => onLibrary && onLibrary()}
        renderItem={g => (
          <GameCard game={g} compact onPick={onInstall ? onInstall : () => onLibrary && onLibrary()} />
        )}
      />
    )
  });
  bands.push({
    id: "servers", label: "Servers",
    node: (
      // Servers — the whole fleet on a rail, most-worth-a-glance first, with the
      // same ServerTile the Servers page renders. Unfiltered by status; the
      // "Online" KPI above already covers the live count. "View all" opens the
      // full, filterable Servers page.
      servers.length === 0 ? (
        <div className="chat-brief">
          <div className="chat-brief__head">
            <span className="chat-brief__title">
              <Icon name="server" size={13} /> Servers
              <span className="chat-brief__count chat-brief__count--neutral">0</span>
            </span>
          </div>
          <div className="chat-brief__body">
            <div className="dash-servers-empty">
              <Icon name="moon" size={20} />
              <span>No servers yet.</span>
              <button className="dash-servers-empty__link" onClick={() => onServers()}>View all servers</button>
            </div>
          </div>
        </div>
      ) : (
        <Rail
          variant="servers"
          icon="server"
          title="Servers"
          count={servers.length}
          items={featuredServers}
          disabled={customize}
          onViewAll={() => onServers()}
          renderItem={s => (
            <ServerTile server={s} onOpen={onOpenServer} onAction={onAction} showHost={hosts.length > 1} />
          )}
        />
      )
    )
  });

  return (
    <>
      <div className="dash-head dash-head--actions">
        <div className="dash-head__titles">
          <h1>{greeting} {user?.display || user?.name || "there"}.</h1>
          <div className="dash-head__sub">
            {dataLoading
              ? <Skel w={300} h={14} />
              : summary}
          </div>
          <ClusterReach />
        </div>
        {!dataLoading && (
          <div className={"dash-customize" + (customize ? " dash-customize--on" : "")}>
            {customize && (
              <span className="dash-customize__hint">
                <Icon name="grip-vertical" size={13} strokeWidth={2} /> Drag a handle to reorder
              </span>
            )}
            {customize ? (
              <>
                <button className="dash-customize__btn" onClick={resetLayout} title="Restore the default order">
                  <Icon name="rotate-ccw" size={14} strokeWidth={2} /> Reset
                </button>
                <button className="dash-customize__btn dash-customize__btn--done" onClick={() => setCustomize(false)}>
                  <Icon name="check" size={14} strokeWidth={2.4} /> Done
                </button>
              </>
            ) : (
              <button className="dash-customize__btn" onClick={() => setCustomize(true)} title="Rearrange your dashboard">
                <Icon name="layout-dashboard" size={14} strokeWidth={2} /> Customize
              </button>
            )}
          </div>
        )}
      </div>

      {dataLoading
        ? <DashboardSkeleton />
        : <DashBandList bands={bands} customize={customize} storedOrder={dashOrder} onReorder={persistOrder} />}
    </>
  );
}

// The KPI card is defined in KPI.jsx (KPI); the diagnostics overview and
// server-detail stats share that same component.
// RecentActivity is shared with the host diagnostics overview (scoped per host).

export { DashboardPage };
export default DashboardPage;
