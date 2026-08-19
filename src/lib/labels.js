// labels.js — shared UI labels: the single source of truth for nav/section names
// that appear in more than one place. Rename here and every reference updates
// (sidebar nav, the dashboard "Recently added" band, breadcrumbs…), so the
// surfaces can't drift.
export const KRYSTAL_LABELS = {
  catalog: "Catalog",
};

// The sub-tabs each tabbed route offers, in the order their strip shows them. A tab is a
// URL segment (`#/servers/<id>/performance`), so its name is read in two places: the strip
// the page draws, and the breadcrumb the shell draws above it. Both take it from here.
//
// Only the shape a tab always has lives here — id, label, icon. Whether a tab is *offered*
// stays with the page: badges count that page's alerts, and Files/Backups/Settings are
// operator surfaces a player never sees, which is a policy question the page answers.
export const ROUTE_TABS = {
  server: [
    { id: "overview",    label: "Overview",    icon: "layout-grid" },
    { id: "performance", label: "Performance", icon: "line-chart" },
    { id: "files",       label: "Files",       icon: "folder" },
    { id: "backups",     label: "Backups",     icon: "database" },
    { id: "settings",    label: "Settings",    icon: "settings" },
  ],
  game: [
    { id: "overview",  label: "Overview",  icon: "layout-grid" },
    { id: "blueprint", label: "Blueprint", icon: "sliders-horizontal" },
    { id: "servers",   label: "Servers",   icon: "server" },
    { id: "file",      label: "File",      icon: "file-code" },
  ],
  cluster: [
    { id: "overview",  label: "Overview",  icon: "layout-grid" },
    { id: "resources", label: "Resources", icon: "activity" },
    { id: "services",  label: "Services",  icon: "server-cog" },
    { id: "logs",      label: "Logs",      icon: "scroll-text" },
  ],
  // The leaf shell's own tabs. A leaf's extra tabs are registered with their bodies in
  // LeafPage and named by TAB_LABEL_FALLBACK below, since a body cannot live here.
  leaf: [
    { id: "overview", label: "Overview", icon: "layout-dashboard" },
    { id: "system",   label: "System",   icon: "server-cog" },
    { id: "logs",     label: "Logs",     icon: "scroll-text" },
    { id: "settings", label: "Settings", icon: "sliders-horizontal" },
  ],
  settings: [
    { id: "profile",       label: "Profile",       icon: "user" },
    { id: "security",      label: "Security",      icon: "key-round" },
    { id: "devices",       label: "Devices",       icon: "monitor-smartphone" },
    { id: "memory",        label: "Memory",        icon: "brain" },
    { id: "notifications", label: "Notifications", icon: "bell" },
  ],
};

// The tab a route lands on when its URL names none — the one segment the hash leaves out,
// so it is also the one tab the breadcrumb has no crumb for.
export const ROUTE_DEFAULT_TAB = {
  server: "overview",
  game: "overview",
  cluster: "overview",
  leaf: "overview",
  settings: "profile",
};

// Tabs a page registers next to their bodies rather than in the table above: the leaves'
// extra tabs. Named here so the breadcrumb can read a name it has no other way to reach.
const TAB_LABEL_FALLBACK = {
  conversations: "Conversations",
  users: "Users",
  thresholds: "Thresholds",
  commands: "Commands",
};

// The name of one tab, or null when the id belongs to no tab this route offers. Null is the
// honest answer for a stale or mistyped segment: the page falls back to its default tab, so a
// crumb naming the segment would announce a place that isn't on screen.
export function tabLabel(kind, id) {
  if (!id) return null;
  const found = (ROUTE_TABS[kind] || []).find(t => t.id === id);
  if (found) return found.label;
  return kind === "leaf" ? (TAB_LABEL_FALLBACK[id] || null) : null;
}
