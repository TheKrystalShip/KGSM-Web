// dashboard/catalog.js — the widget types this build offers.
//
// It lives under pages/ rather than lib/ because most entries name a PAGE component. `lib/` never
// imports a page (src/CLAUDE.md), and the registry mechanism in lib/widgets/registry.js holds to
// that: it knows how to hold a type, not which types exist.
//
// Importing this module is what registers them, so it is imported once by the dashboard. Every
// `load` is a dynamic import, so none of these components is in the dashboard's own chunk.

import { registerWidget } from "../../lib/widgets/registry.js";

// ⚠ A `type` string is PERSISTED in every layout that uses it. Renaming one orphans those widgets
// into "no longer available" tiles on other people's dashboards. Treat a shipped type as immutable.

// The twelve figures as one block. Superseded by the individual tiles below and no longer offered in
// the catalog, but still REGISTERED: a shipped type is immutable, and a layout stored before the
// split holds one. Such a layout is expanded into the twelve on load (dashboardStore), so this
// renders only for anything that slipped past that.
registerWidget({
  type: "fleet.summary",
  label: "Fleet summary",
  icon: "layout-dashboard",
  group: "Fleet",
  hidden: true,
  describe: () => "Fleet summary",
  // `minPx` rather than a column count: the constraint is a WIDTH. Below about 380px the console's
  // toolbar, the services grid and a game card's title all overflow, and how many columns 380px
  // buys depends on the breakpoint — six columns is half a wide grid and the whole of a narrow one.
  // See layout.js `columnsForPx`.
  size: { w: 12, h: 2, minPx: 380, minH: 2 },
  load: () => import("./widgets/FleetSummary.jsx").then(m => m.FleetSummary),
});

// ---- The twelve glance tiles ----------------------------------------------
// Each placeable alone, so a dashboard can carry exactly the figures somebody cares about. At w:2
// they read 6, 4, 3 and 2 across the breakpoint ladder — the band's original shape, now as twelve
// things that can be moved and removed independently.
//
// The split is by question, not by source: the first six ask "what is happening on the fleet", the
// second six "what needs me".
const TILE = (type, label, icon, group, comp) => registerWidget({
  type, label, icon, group,
  describe: () => label,
  size: { w: 2, h: 1, minW: 2, minH: 1 },
  load: () => import("./widgets/tiles.jsx").then(m => m[comp]),
});

TILE("tile.running", "Running", "server", "Fleet", "TileRunning");
TILE("tile.playersNow", "Players now", "users", "Fleet", "TilePlayersNow");
TILE("tile.playersWeek", "Players \u00b7 7d", "user-round-check", "Fleet", "TilePlayersWeek");
TILE("tile.played", "Played \u00b7 24h", "hourglass", "Fleet", "TilePlayed");
TILE("tile.uptime", "Uptime", "shield-check", "Fleet", "TileUptime");
TILE("tile.timeToReady", "Time to ready", "timer", "Fleet", "TileTimeToReady");

TILE("tile.drift", "Drift", "git-compare-arrows", "Needs me", "TileDrift");
TILE("tile.crashes", "Crashes \u00b7 24h", "server-crash", "Needs me", "TileCrashes");
TILE("tile.updates", "Updates", "circle-arrow-up", "Needs me", "TileUpdates");
TILE("tile.oldestBackup", "Oldest backup", "database-backup", "Needs me", "TileOldestBackup");
TILE("tile.scheduleFails", "Schedule fails", "calendar-x", "Needs me", "TileScheduleFails");
TILE("tile.services", "Services", "boxes", "Needs me", "TileServices");

registerWidget({
  type: "fleet.capacity",
  label: "Node capacity",
  icon: "gauge",
  group: "Nodes",
  // Admin-only, and fleet-wide rather than per-node: the strip renders EVERY node at once, so the
  // aggregate check is the right one — a viewer on one node has no business seeing the rest.
  cap: "nav.cluster",
  describe: () => "Node capacity",
  size: { w: 12, h: 4, minPx: 380, minH: 3 },
  load: () => import("./widgets/CapacityStrip.jsx").then(m => m.CapacityStrip),
});

registerWidget({
  type: "alerts.latest",
  label: "Alerts",
  icon: "bell-ring",
  group: "Activity",
  cap: "nav.alerts",
  describe: () => "Alerts",
  size: { w: 6, h: 4, minPx: 380, minH: 3 },
  load: () => import("./widgets/FeedWidgets.jsx").then(m => m.AlertsLatest),
});

registerWidget({
  type: "activity.recent",
  label: "Recent activity",
  icon: "history",
  group: "Activity",
  cap: "nav.audit",
  describe: () => "Recent activity",
  size: { w: 6, h: 4, minPx: 380, minH: 3 },
  load: () => import("./widgets/FeedWidgets.jsx").then(m => m.ActivityRecent),
});

// Runs — cluster-wide, so it takes no `hostId` and is not a bound widget: a run is the thing a
// person started, and the nodes' shares of it are inside. `host.jobs.queued`/`host.jobs.running`
// answer the other question ("what is THIS node doing") and are bound for that reason.
//
// No `cap`: the reads behind it are viewer-gated on every node, the same as the servers and jobs a
// viewer can already see. Cancelling is the operator half, and the board asks per node for it.
registerWidget({
  type: "fleet.runs",
  label: "Runs",
  icon: "layers",
  group: "Activity",
  describe: () => "Runs",
  // Measured in a browser: a run card holds its head, its meter and its chips down to 300px, where
  // the chips wrap to a second row and everything still reads. At 260 the scope line ("6 servers on
  // 3 nodes") starts being clipped, which is the one thing on the card that cannot be guessed from
  // the rest of it.
  size: { w: 6, h: 4, minPx: 300, minH: 3 },
  load: () => import("../../components/batch/RunsBoard.jsx").then(m => m.RunsBoard),
});

registerWidget({
  type: "servers.rail",
  label: "Servers",
  icon: "server",
  group: "Servers",
  describe: () => "Servers",
  size: { w: 12, h: 4, minPx: 380, minH: 3 },
  load: () => import("./widgets/ServersRail.jsx").then(m => m.ServersRail),
});

registerWidget({
  type: "library.catalog",
  label: "Game catalog",
  icon: "library",
  group: "Servers",
  cap: "nav.library",
  describe: () => "Game catalog",
  size: { w: 12, h: 4, minPx: 380, minH: 3 },
  load: () => import("./widgets/CatalogRail.jsx").then(m => m.CatalogRail),
});

// ---- Layout ----------------------------------------------------------------

// Deliberate empty room. The grid is a flow, so a gap exists only as a consequence of a widget not
// fitting its row — this is the one way to say "leave this space alone" and have the flow respect it.
//
// `repeatable`, because a dashboard may want several and every other type is a single: pinning the
// catalog twice would be two copies of one card, but two spacers are two different spaces. The store
// gives each its own `slot` param so they are distinct targets rather than one widget added twice.
registerWidget({
  type: "layout.spacer",
  label: "Empty space",
  icon: "square-dashed",
  group: "Layout",
  repeatable: true,
  describe: () => "Empty space",
  // No floor at all: emptiness reads fine at any size, and a spacer that refused to be narrow
  // could not do the one job it has.
  size: { w: 2, h: 1, minH: 1 },
  load: () => import("./widgets/Spacer.jsx").then(m => m.Spacer),
});

// ---- Bound widgets ---------------------------------------------------------
// These carry PARAMETERS, so they are pinned from the page that supplies them and never offered by
// the Add-widget catalog — nothing in a list can know which leaf's journal you meant.

registerWidget({
  type: "leaf.logs",
  label: "Leaf journal",
  icon: "scroll-text",
  group: "Nodes",
  // Per NODE, not fleet-wide: an admin on one node and a viewer on another must not see the second
  // node's journal because the first made them an admin somewhere. persona.js calls this
  // "aggregate for reach, scoped for action".
  cap: "host.manage",
  scope: "host",
  params: ["hostId", "leafId"],
  describe: (p) => (p.leafId || "leaf") + " · journal",
  size: { w: 12, h: 5, minPx: 380, minH: 3 },
  load: () => import("../leaf/LeafLogs.jsx").then(m => m.LeafLogs),
});

registerWidget({
  type: "server.console",
  label: "Server console",
  icon: "terminal-square",
  group: "Servers",
  cap: "server.operate",
  scope: "server",
  params: ["serverId"],
  describe: (p) => (p.serverId || "server") + " · console",
  size: { w: 6, h: 5, minPx: 380, minH: 3 },
  load: () => import("./widgets/ServerWidgets.jsx").then(m => m.ServerConsoleWidget),
});

registerWidget({
  type: "host.logs",
  label: "Node journal",
  icon: "scroll-text",
  group: "Nodes",
  cap: "host.manage",
  scope: "host",
  params: ["hostId"],
  describe: (p) => (p.hostId || "node") + " \u00b7 journal",
  size: { w: 12, h: 5, minPx: 380, minH: 3 },
  load: () => import("./widgets/NodeWidgets.jsx").then(m => m.HostLogsWidget),
});

registerWidget({
  type: "host.jobs.queued",
  label: "Node queue",
  icon: "hourglass",
  group: "Nodes",
  cap: "host.manage",
  scope: "host",
  params: ["hostId"],
  describe: (p) => (p.hostId || "node") + " · queued",
  // One card, so the floor is where a ROW stops reading rather than where a set of lanes stops
  // fitting. Measured in a browser against a 30-character instance name — every server on the host
  // that shipped this is named short, and a floor measured against those would hold only there: the
  // card reads clean down to 310 and the name starts ellipsizing at 300.
  size: { w: 6, h: 5, minPx: 310, minH: 3 },
  load: () => import("./widgets/NodeWidgets.jsx").then(m => m.HostQueuedJobsWidget),
});

registerWidget({
  type: "host.jobs.running",
  label: "Node running",
  icon: "loader",
  group: "Nodes",
  cap: "host.manage",
  scope: "host",
  params: ["hostId"],
  describe: (p) => (p.hostId || "node") + " · running",
  // Ten pixels narrower than the queue, measured the same way and against the same name: a running
  // row ends in a spinner where a queued one ends in "3rd of 8", and that chip is the whole of the
  // difference. Clean down to 300, ellipsizing at 290.
  size: { w: 6, h: 5, minPx: 300, minH: 3 },
  load: () => import("./widgets/NodeWidgets.jsx").then(m => m.HostRunningJobsWidget),
});

registerWidget({
  type: "host.services",
  label: "Node services",
  icon: "boxes",
  group: "Nodes",
  cap: "host.manage",
  scope: "host",
  params: ["hostId"],
  describe: (p) => (p.hostId || "node") + " \u00b7 services",
  size: { w: 12, h: 5, minPx: 380, minH: 3 },
  load: () => import("./widgets/NodeWidgets.jsx").then(m => m.HostServicesWidget),
});

const SERVER_WIDGET = (type, label, icon, comp, size) => registerWidget({
  type, label, icon,
  group: "Servers",
  // Per SERVER, which resolves to per host: an operator on one node must not reach another node's
  // server because they hold the verb somewhere. WidgetHost looks the server's host up to decide.
  cap: "server.operate",
  scope: "server",
  params: ["serverId"],
  describe: (p) => (p.serverId || "server") + " \u00b7 " + label.toLowerCase(),
  size,
  load: () => import("./widgets/ServerWidgets.jsx").then(m => m[comp]),
});

SERVER_WIDGET("server.card", "Server", "server", "ServerCardWidget", { w: 3, h: 4, minW: 2, minH: 3 });
SERVER_WIDGET("server.players", "Players", "users", "ServerPlayersWidget", { w: 6, h: 4, minPx: 380, minH: 3 });
SERVER_WIDGET("server.performance", "Performance", "activity", "ServerPerformanceWidget", { w: 12, h: 5, minPx: 380, minH: 4 });
