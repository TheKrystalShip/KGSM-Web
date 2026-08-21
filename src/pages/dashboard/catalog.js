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

registerWidget({
  type: "fleet.summary",
  label: "Fleet summary",
  icon: "layout-dashboard",
  group: "Fleet",
  describe: () => "Fleet summary",
  size: { w: 12, h: 2, minW: 4, minH: 2 },
  load: () => import("./widgets/FleetSummary.jsx").then(m => m.FleetSummary),
});

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
  load: () => import("./widgets/ServerConsoleWidget.jsx").then(m => m.ServerConsoleWidget),
});
