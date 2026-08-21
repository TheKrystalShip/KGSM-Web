// dashboard/catalog.js — the widget types this build offers.
//
// It lives under pages/ rather than lib/ because every entry names a PAGE component. `lib/` never
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
  size: { w: 12, h: 2, minW: 4, minH: 2 },
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
  size: { w: 12, h: 4, minW: 6, minH: 3 },
  load: () => import("./widgets/CapacityStrip.jsx").then(m => m.CapacityStrip),
});

registerWidget({
  type: "alerts.latest",
  label: "Alerts",
  icon: "bell-ring",
  group: "Activity",
  cap: "nav.alerts",
  describe: () => "Alerts",
  size: { w: 6, h: 4, minW: 4, minH: 3 },
  load: () => import("./widgets/FeedWidgets.jsx").then(m => m.AlertsLatest),
});

registerWidget({
  type: "activity.recent",
  label: "Recent activity",
  icon: "history",
  group: "Activity",
  cap: "nav.audit",
  describe: () => "Recent activity",
  size: { w: 6, h: 4, minW: 4, minH: 3 },
  load: () => import("./widgets/FeedWidgets.jsx").then(m => m.ActivityRecent),
});

registerWidget({
  type: "servers.rail",
  label: "Servers",
  icon: "server",
  group: "Servers",
  describe: () => "Servers",
  size: { w: 12, h: 4, minW: 4, minH: 3 },
  load: () => import("./widgets/ServersRail.jsx").then(m => m.ServersRail),
});

registerWidget({
  type: "library.catalog",
  label: "Game catalog",
  icon: "library",
  group: "Servers",
  cap: "nav.library",
  describe: () => "Game catalog",
  size: { w: 12, h: 4, minW: 4, minH: 3 },
  load: () => import("./widgets/CatalogRail.jsx").then(m => m.CatalogRail),
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
  size: { w: 12, h: 5, minW: 6, minH: 3 },
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
  size: { w: 6, h: 5, minW: 4, minH: 3 },
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
  size: { w: 12, h: 5, minW: 6, minH: 3 },
  load: () => import("./widgets/NodeWidgets.jsx").then(m => m.HostLogsWidget),
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
  size: { w: 12, h: 5, minW: 6, minH: 3 },
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
SERVER_WIDGET("server.players", "Players", "users", "ServerPlayersWidget", { w: 6, h: 4, minW: 4, minH: 3 });
SERVER_WIDGET("server.performance", "Performance", "activity", "ServerPerformanceWidget", { w: 12, h: 5, minW: 6, minH: 4 });
