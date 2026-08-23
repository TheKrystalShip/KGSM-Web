import React from "react";
import { AccountAvatar } from "./AccountAvatar.jsx";
import { Icon } from "./Icon.jsx";
import { NotificationsPanel } from "./NotificationsPanel.jsx";
import { OpsTray } from "./batch/OpsTray.jsx";
import { KRYSTAL_LABELS } from "../lib/labels.js";
import { can } from "../lib/persona.js";
import { sessionStore } from "../lib/sessionStore.js";
import { coverArtBg } from "../lib/art.js";
import { OAuthIcon, signInMethodLabel } from "./host-helpers.jsx";
import { useStore } from "../lib/store.js";

// Sidebar component — brand, primary nav, quick actions.

// Catalog nav label — read from the shared label map so it can't drift from the
// dashboard's "Recently added" band or the breadcrumb. See labels.js KRYSTAL_LABELS.
const CATALOG_LABEL = KRYSTAL_LABELS.catalog || "Catalog";

// ClusterChip — the ambient reachability signal, and the only node-shaped thing
// in the chrome. It REPORTS: how many nodes the panel drives, how many are
// online, and how many are degraded (offline, refusing this session, or needing
// a re-auth). Clicking it opens Cluster.
//
// It sets nothing. The panel shows the whole cluster on every surface, so there
// is no scope to pick here — a node is chosen where it belongs to the object
// being acted on (which node an install lands on, whose blueprint file to open),
// never as a mode the rest of the app inherits.
function ClusterChip({ hosts, onOpen, collapsed }) {
  const sessions = useStore(sessionStore, s => s.byHost);
  const online = hosts.filter(h => h.online).length;
  const degraded = hosts.filter(h => {
    const rec = sessions[h.id];
    // `reauthDue`, not `expired`: the routine token renewal writes `expired` for
    // one round-trip, and the chip must not tick a node into "degraded" for it.
    return !h.online || (rec && (rec.status === "denied" || rec.reauthDue));
  }).length;
  const tone = !hosts.length ? "muted" : degraded === hosts.length ? "down" : degraded ? "warn" : "ok";
  const summary = hosts.length === 1
    ? (online ? "1 node · online" : "1 node · offline")
    : hosts.length + " nodes · " + online + " online";

  return (
    <button
      className={"cluster-status cluster-status--" + tone}
      onClick={onOpen}
      data-tip={collapsed ? summary + (degraded ? " · " + degraded + " degraded" : "") : undefined}
      aria-label={"Cluster: " + summary}>
      <span className="cluster-status__lead"><Icon name="layers" size={16} /></span>
      {collapsed ? (
        <span className="cluster-status__code">{hosts.length || "—"}</span>
      ) : (
        <>
          <span className="cluster-status__name">Cluster</span>
          <span className="cluster-status__sep"></span>
          <span className="cluster-status__meta">{summary}</span>
          {degraded > 0 && <span className="cluster-status__flag">{degraded} degraded</span>}
        </>
      )}
    </button>
  );
}

// The dot pulses while something is happening to (or on) the server — live, or mid-transition.
const BUSY_STATUS = {
  online: true, updating: true, stopping: true, starting: true, restarting: true,
  "backing-up": true, restoring: true, moving: true,
};

function ServerListItem({ server, active, onClick }) {
  const dotColor = {
    online: "var(--success)",
    updating: "var(--warning)",
    // Still up, on its way down — the in-transition tone, not the offline grey.
    stopping: "var(--warning)",
    restarting: "var(--warning)",
    starting: "var(--warning)",
    // Occupied with its own data — the same in-transition tone; the run-state
    // underneath may be either.
    "backing-up": "var(--warning)",
    restoring: "var(--warning)",
    moving: "var(--warning)",
    offline: "var(--fg-4)",
    crashed: "var(--danger)",
    // Unreachable rather than down — the same distinction the hero pill draws.
    "library-offline": "var(--warning)",
  }[server.status] || "var(--fg-4)";
  return (
    <div className={"server-row" + (active ? " server-row--active" : "")} onClick={onClick}>
      <div className="server-row__icon" style={{ backgroundImage: coverArtBg(server.cover), backgroundSize: "cover", backgroundPosition: "center" }}></div>
      <span className="server-row__name">{server.name}</span>
      <span className="server-row__dot" style={{
        background: dotColor,
        animation: BUSY_STATUS[server.status] ? "kr-pulse 1.8s ease-in-out infinite" : "none",
      }}></span>
    </div>
  );
}

// SidebarAccount — the signed-in user, pinned in the sidebar foot above
// Settings. Replaces the old top-bar account menu now that the top bar is
// gone; its popover opens UPWARD (it lives at the very bottom of the panel).
function SidebarAccount({ user, onSettings, onLogout, collapsed }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  return (
    <div className="sidebar__account-wrap" ref={ref}>
      {open && (
        <div className="sidebar__account-menu" role="menu">
          <div className="sidebar__account-menu__head">
            <div className="sidebar__account-menu__name">{user.display || user.name}</div>
            <div className="sidebar__account-menu__provider">
              <OAuthIcon provider={user.provider} size={11} />
              Signed in with {signInMethodLabel(user.provider)}
            </div>
          </div>
          <button className="sidebar__account-menu__item" onClick={() => { setOpen(false); onSettings && onSettings(); }}><Icon name="key" size={14} />API tokens</button>
          <button className="sidebar__account-menu__item"><Icon name="circle-help" size={14} />Help &amp; docs</button>
          <button className="sidebar__account-menu__item sidebar__account-menu__item--danger" onClick={onLogout}><Icon name="log-out" size={14} />Sign out</button>
        </div>
      )}
      <button
        className={"sidebar__account" + (open ? " sidebar__account--open" : "")}
        onClick={() => setOpen(o => !o)} aria-haspopup="menu" aria-expanded={open}
        data-tip={collapsed && !open ? (user.display || user.name) : undefined}>
        <AccountAvatar user={user} size={28} />
        {!collapsed && (
          <>
            <span className="sidebar__account__text">
              <span className="sidebar__account__name">{user.display || user.name}</span>
              <span className="sidebar__account__sub">Signed in with {signInMethodLabel(user.provider)}</span>
            </span>
            <Icon name="chevrons-up-down" size={14} className="sidebar__account__caret" />
          </>
        )}
      </button>
    </div>
  );
}

function Sidebar({ route = {}, onNavigate, serversCount = 0, serversTone = "info", clusterCount = 0, clusterTone = "info", attentionCount = 0, attentionTone = "info", user, onLogout, hosts = [], open, collapsed, onToggleCollapse }) {
  // Routing is the ONE contract from App: `route` (the current route) in, a single
  // `onNavigate({ kind })` out. Active state derives from route.kind here rather
  // than a bespoke boolean per entry plumbed down from App.
  const go = (kind) => () => onNavigate && onNavigate({ kind });
  const isActive = (kind) => route.kind === kind;

  // Nav visibility reads the ONE policy (persona.js) — no bespoke booleans
  // plumbed from App. Each entry is shown iff the persona holds its capability
  // on some host (aggregate). The breadcrumb derives from the same policy, so
  // the two can never disagree (architecture.html §3·f·1).
  const canDashboard = can("nav.dashboard");
  const canAlerts = can("nav.alerts");
  const canAudit = can("nav.audit");
  const canCluster = can("nav.cluster");
  const showMonitoring = canAlerts || canAudit || canCluster;
  return (
    <aside className={"sidebar" + (open ? " sidebar--open" : "") + (collapsed ? " sidebar--rail" : "")}>
      <div className="sidebar__brand">
        <img src="/assets/tks-mark.png" width="32" height="32" alt="" style={{ objectFit: "contain" }} />
        <span className="sidebar__brand-wordmark">Krystal Ship</span>
        <button
          type="button"
          className="sidebar__collapse"
          onClick={onToggleCollapse}
          data-tip={collapsed ? "Expand" : "Collapse"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
          <Icon name={collapsed ? "panel-left-open" : "panel-left-close"} size={16} />
        </button>
      </div>
      <ClusterChip hosts={hosts} onOpen={go("cluster")} collapsed={collapsed} />
      <nav className="sidebar__nav">
        <div className="sidebar__group">
          <div className="sidebar__group-label">Workspace</div>
          {canDashboard && (
          <div className={"nav-item" + (isActive("home") ? " nav-item--active" : "")} onClick={go("home")} data-tip="Home" aria-label="Home">
            <Icon name="home" size={16} />
            <span className="nav-item__label">Home</span>
          </div>
          )}
          <div className={"nav-item" + (isActive("servers") ? " nav-item--active" : "")} onClick={go("servers")} data-tip={"Servers" + (serversCount > 0 ? " · " + serversCount : "")} aria-label="Servers">
            <Icon name="server" size={16} />
            <span className="nav-item__label">Servers</span>
            {serversCount > 0 && <span className={"nav-item__badge nav-item__badge--" + serversTone}>{serversCount}</span>}
          </div>
          <div className={"nav-item" + (isActive("library") ? " nav-item--active" : "")} onClick={go("library")} data-tip={CATALOG_LABEL} aria-label={CATALOG_LABEL}>
            <Icon name="library" size={16} />
            <span className="nav-item__label">{CATALOG_LABEL}</span>
          </div>
        </div>
        {showMonitoring && (
        <div className="sidebar__group">
          <div className="sidebar__group-label">Monitoring</div>
          {canAlerts && (
          <div className={"nav-item" + (isActive("attention") ? " nav-item--active" : "")} onClick={go("attention")} data-tip={"Alerts" + (attentionCount > 0 ? " · " + attentionCount : "")} aria-label="Alerts">
            <Icon name="triangle-alert" size={16} />
            <span className="nav-item__label">Alerts</span>
            {attentionCount > 0 && <span className={"nav-item__badge nav-item__badge--" + attentionTone}>{attentionCount}</span>}
          </div>
          )}
          {canCluster && (
          <div className={"nav-item" + (isActive("cluster") ? " nav-item--active" : "")} onClick={go("cluster")} data-tip={"Cluster" + (clusterCount > 0 ? " · " + clusterCount : "")} aria-label="Cluster">
            <Icon name="server-cog" size={16} />
            <span className="nav-item__label">Cluster</span>
            {clusterCount > 0 && <span className={"nav-item__badge nav-item__badge--" + clusterTone}>{clusterCount}</span>}
          </div>
          )}
          {canAudit && (
          <div className={"nav-item" + (isActive("audit") ? " nav-item--active" : "")} onClick={go("audit")} data-tip="Audit log" aria-label="Audit log">
            <Icon name="scroll-text" size={16} />
            <span className="nav-item__label">Audit log</span>
          </div>
          )}
        </div>
        )}
      </nav>
      <div className="sidebar__foot">
        {/* Two trays above the account, and they answer different questions. Runs is the FLEET's:
            work the nodes are executing, hydrated from every one of them and the same for everybody.
            Notifications is this browser's own — what YOU did in it, and how it went. Both sit out of
            Monitoring, which is what the AlertEngine says about the fleet. */}
        <OpsTray />
        <NotificationsPanel onOpenServer={(id) => onNavigate && onNavigate({ kind: "server", id })} />
        {user && <SidebarAccount user={user} onSettings={go("settings")} onLogout={onLogout} collapsed={collapsed} />}
        <div className={"nav-item" + (isActive("settings") ? " nav-item--active" : "")} onClick={go("settings")} data-tip="Settings" aria-label="Settings">
          <Icon name="settings" size={16} />
          <span className="nav-item__label">Settings</span>
        </div>
      </div>
    </aside>
  );
}

function TopNav({ tab, onTab, user, onLogout, onMenu, onHome, onAssistant, assistantOpen, onSettings }) {
  const [menuOpen, setMenuOpen] = React.useState(false);

  // Close menu on outside click.
  const wrapRef = React.useRef(null);
  React.useEffect(() => {
    if (!menuOpen) return;
    const h = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setMenuOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [menuOpen]);

  return (
    <div className="topbar">
      <button className="topbar__menu-btn" onClick={onMenu} aria-label="Open menu">
        <Icon name="menu" size={18} />
      </button>
      <span className="topbar__brand-inline" onClick={onHome} style={{ marginRight: 8, cursor: "pointer" }}>
        <img src="/assets/tks-mark.png" alt="" />
        <span>Krystal</span>
      </span>
      <span className="topbar__spacer"></span>
      <button
        className={"topbar__assistant" + (assistantOpen ? " topbar__assistant--on" : "")}
        onClick={onAssistant}
        title="Toggle assistant"
        aria-label="Toggle assistant">
        <Icon name="bot" size={16} />
        <span className="topbar__assistant__label">Assistant</span>
      </button>
      <div ref={wrapRef} style={{ position: "relative" }}>
        <span className="topbar__account" onClick={() => setMenuOpen(o => !o)}>
          <AccountAvatar user={user} size={24} />
          <span className="topbar__account__label">{user.display || user.name}</span>
          <Icon name="chevron-down" size={14} />
        </span>
        {menuOpen && (
          <div className="topbar__account-menu">
            <div className="topbar__account-menu__head">
              <div className="topbar__account-menu__name">{user.display || user.name}</div>
              <div className="topbar__account-menu__provider">
                <OAuthIcon provider={user.provider} size={11} />
                Signed in with {signInMethodLabel(user.provider)}
              </div>
            </div>
            <div className="topbar__account-menu__item" onClick={() => { setMenuOpen(false); onSettings && onSettings(); }}><Icon name="settings" size={14} />Settings</div>
            <div className="topbar__account-menu__item" onClick={() => { setMenuOpen(false); onSettings && onSettings(); }}><Icon name="key" size={14} />API tokens</div>
            <div className="topbar__account-menu__item"><Icon name="circle-help" size={14} />Help & docs</div>
            <div className="topbar__account-menu__item topbar__account-menu__item--danger" onClick={onLogout}>
              <Icon name="log-out" size={14} />Sign out
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export { AccountAvatar, ClusterChip, ServerListItem, Sidebar, SidebarAccount, TopNav };
