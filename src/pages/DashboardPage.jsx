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
import { parseTs } from "../lib/formatting.js";
import { KRYSTAL_LABELS } from "../lib/labels.js";
import { fleetSummary, instancesOfBlueprint } from "../lib/servers.js";
import { useStore } from "../lib/store.js";
import { auditStore, clusterStore, favoritesStore, hostsStore, libraryStore, pingStore, serversStore } from "../lib/stores.js";
import { startPingLoop } from "../lib/stores/ui.js";
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

function DashboardPage({ user, onOpenServer, onAction, onLibrary, onInstall, onAudit, onDiagnostics, onOpenHostDiagnostics, onAttention, onRunAlertAction, onServers, onViewAlerts, canCluster = true }) {
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
  React.useEffect(() => { startPingLoop(); }, []);
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
  // Four glance cards, each reading data that isn't otherwise visible on the
  // dashboard, each stateful, each drilling into the page that owns it.
  const HOUR = 3600000;
  const fmtDur = (ms) => {
    const m = Math.max(0, Math.round(ms / 60000));
    if (m < 60) return m + "m";
    const h = Math.floor(m / 60);
    if (h < 24) return h + "h";
    const d = Math.floor(h / 24), rh = h % 24;
    return rh ? `${d}d ${rh}h` : `${d}d`;
  };
  // 1) Ping — operator's live link to the host(s). Lower is better; non-interactive.
  // Client-measured round trip via WebSocket ping/pong (pingStore, keyed by host id).
  // It's the WORST (max) across every node that has a reading — the slowest link,
  // matching the other summary tiles' worst-case framing. No reading (probe failed /
  // not yet measured) → null → "no reading" (never a fabricated latency).
  const pingVals = hosts.map(h => pings[h.id]).filter(p => p && p.ms != null).map(p => p.ms);
  const pingMs = pingVals.length ? Math.max(...pingVals) : null;
  const pingMultiHost = pingVals.length > 1;
  const pingTone = pingMs == null ? "muted" : pingMs < 60 ? "ok" : pingMs < 120 ? "warn" : "danger";
  // 2) Updates available — servers on an older build, excluding ones already
  //    mid-update. Actionable to-do, not an error → info tone.
  const updatable = servers.filter(s => s.update_available && s.status !== "updating");
  // 3) Oldest backup — the MOST-OVERDUE server (worst-case insurance gap), not
  //    the most recent, so the one actually at risk is what surfaces.
  //    s.last_backup is the newest backup's manifest record; its createdAt is what dates it. A backup
  //    whose manifest carries no timestamp can't be ranked by age, so it doesn't compete for "oldest"
  //    (it would otherwise sort as either infinitely old or brand new — both fabrications).
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
  const backupSub = neverBackedUp.length
    ? (neverBackedUp.length === 1 ? neverBackedUp[0].name : `${neverBackedUp.length} servers have none`)
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
  // 4) Crashes / auto-restarts in the last 24h — caught by the watchdog at the
  //    process level, so it's game-agnostic. Reads the same audit feed.
  const crash24h = auditScoped.filter(ev => ev.action === "server.crash" && (now - parseTs(ev.ts)) <= 24 * HOUR);
  const crashTone = crash24h.length === 0 ? "ok" : crash24h.length < 3 ? "warn" : "danger";
  const lastCrash = crash24h[0];
  // Crash detection is the watchdog's job — if ANY node's watchdog is down we
  // can't claim the cluster is stable, so the KPI reads unknown rather than
  // reporting a count that silently excludes that node.
  const scopedWatchdogDown = hosts.length > 0 && hosts.some(h => !capUsable(h, "watchdog"));
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
  const capacityNode = <DashFleetStrip nodes={clusterNodes} onOpenDiagnostics={onDiagnostics} onOpenHost={onOpenHostDiagnostics} />;

  const bands = [];
  bands.push({
    id: "summary", label: "Summary",
    node: (
      <div className="dash-summary">
        <Kpi
          icon="activity" label="Ping"
          value={pingMs == null ? "—" : pingMs} unit={pingMs == null ? null : "ms"}
          sub={pingMs == null ? "no reading" : (pingMultiHost ? `slowest of ${pingVals.length} hosts` : "your connection")}
          tone={pingTone}
        />
        <Kpi
          icon="circle-arrow-up" label="Updates available"
          value={updatable.length}
          sub={updatable.length ? updatable.map(s => s.game).join(", ") : "all up to date"}
          tone={updatable.length ? "info" : "muted"}
          onView={updatable.length ? () => onServers("updates") : null}
        />
        <Kpi
          icon="database-backup" label="Oldest backup"
          value={neverBackedUp.length ? "never" : oldestBackup ? fmtDur(backupAgeMs) : "—"}
          sub={backupSub}
          tone={backupTone}
          onView={backupView}
        />
        <Kpi
          icon="server-crash" label="Crashes · 24h"
          value={scopedWatchdogDown ? "—" : crash24h.length}
          sub={scopedWatchdogDown ? "watchdog down — not monitoring" : (crash24h.length ? `last: ${lastCrash.target?.name || "server"}` : "all stable")}
          tone={scopedWatchdogDown ? "muted" : crashTone}
          onView={onAudit}
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
