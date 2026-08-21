// AppRouter — the page routing switch. Maps route.kind to the right page
// component, threading through all the callbacks and props.

import React from "react";
import { Icon } from "../components/Icon.jsx";
import { ContentError, ErrorBoundary } from "../components/ErrorBoundary.jsx";
import { KrystalRouter } from "../lib/router.js";
import { serversStore } from "../lib/stores.js";
import { useAssistantDock } from "./AssistantDockContext.jsx";
import { ServerGate } from "../pages/ServerGate.jsx";

const AlertsPage = React.lazy(() => import("../pages/AlertsPage.jsx"));
const AuditLogPage = React.lazy(() => import("../pages/AuditLogPage.jsx"));
const DashboardPage = React.lazy(() => import("../pages/DashboardPage.jsx"));
const ClusterPage = React.lazy(() => import("../pages/DiagnosticsPage.jsx"));
const GamePage = React.lazy(() => import("../pages/GamePage.jsx"));
const Library = React.lazy(() => import("../pages/LibraryPage.jsx"));
const LeafConfigPage = React.lazy(() => import("../pages/leafConfig/LeafConfigPage.jsx"));
const LeafPage = React.lazy(() => import("../pages/leaf/LeafPage.jsx"));
const LibraryCreatePage = React.lazy(() => import("../pages/library/LibraryCreatePage.jsx"));
const ServerDetailPage = React.lazy(() => import("../pages/ServerDetailPage.jsx"));
const ServersPage = React.lazy(() => import("../pages/ServersPage.jsx"));
const SettingsPage = React.lazy(() => import("../pages/SettingsPage.jsx"));

function AppRouter({ route, setRoute, user, activeGame, serverForRender,
  handleAction, openGame, handleInstall,
  handleLogout, setInstalling }) {

  // Assistant/dock state is provided by AssistantDockProvider (an ancestor of this
  // router), so read it from context here rather than threading it down from the
  // shell. Data (servers/hosts/scope) is likewise read by the pages themselves from
  // the singleton stores — this router only owns ROUTING (route → page + callbacks).
  const { askAboutAlert, askCreateBlueprint, openReview } = useAssistantDock();

  return (
    <ErrorBoundary
      resetKey={KrystalRouter.routeToHash(route)}
      fallback={(reset, error) => <ContentError error={error} onRetry={reset} onHome={() => setRoute({ kind: "home" })} />}>
    <React.Suspense fallback={<div style={{ textAlign: "center", padding: "64px 0", color: "var(--fg-3)" }}><span style={{ display: "inline-block", animation: "act-spin 1.4s linear infinite" }}><Icon name="loader-2" size={26} strokeWidth={1.7} /></span><div style={{ marginTop: 12, fontSize: 13, fontWeight: 600, color: "var(--fg-2)" }}>{"Loading\u2026"}</div></div>}>
    <div className="page" key={KrystalRouter.routeToHash(route)}>
    {/* The dashboard takes no navigation props: every card on it is a widget, and a widget reaches
        the router through NavContext rather than through whatever the page above it was handed. */}
    {route.kind === "home" && <DashboardPage user={user} />}
    {route.kind === "attention" && <AlertsPage
      key={route.serverId || "all"}
      initialServerId={route.serverId}
      onOpenServer={(id, tab) => setRoute({ kind: "server", id, tab })}
      onOpenHost={(hostId) => setRoute({ kind: "cluster", hostId })}
      onOpenAudit={() => setRoute({ kind: "audit" })}
      onAsk={askAboutAlert}
      onRun={(id, action) => handleAction(action, id)}
    />}
    {route.kind === "servers" && <ServersPage
      key={(route.status || "all") + ":" + (route.node || "all")}
      initialStatus={route.status}
      initialNode={route.node}
      onOpenServer={(id) => setRoute({ kind: "server", id })}
      onAction={(id, action) => handleAction(action, id)}
      onLibrary={() => setRoute({ kind: "library" })}
    />}
    {route.kind === "library" && <Library key={route.filter || "all"} onOpenGame={openGame} onDeploy={handleInstall} initialFilter={route.filter}
      onCreateBlueprint={() => setRoute({ kind: "library-create" })} />}
    {route.kind === "library-create" && <LibraryCreatePage
      onBrowse={() => setRoute({ kind: "library" })}
      onOpenGame={(id) => setRoute({ kind: "game", id })}
      onAskAssistant={askCreateBlueprint}
    />}
    {route.kind === "game" && (activeGame
      ? <GamePage
          game={activeGame}
          tab={route.tab || "overview"}
          onTabChange={(t) => setRoute({ kind: "game", id: route.id, tab: t === "overview" ? undefined : t })}
          onCreate={(g) => setInstalling(g)}
          onOpenServer={(id) => setRoute({ kind: "server", id })}
          onAction={(id, action) => handleAction(action, id)}
        />
      : <div style={{ padding: "60px 0", textAlign: "center", color: "var(--fg-3)" }}>
          That game isn’t in the library. <button className="dash-servers-empty__link" onClick={() => setRoute({ kind: "library" })}>Back to the library</button>
        </div>)}
    {route.kind === "audit"   && <AuditLogPage key={(route.severity || "all") + "|" + (route.serverId || "all")} initialSeverity={route.severity} initialServer={route.serverId} />}
    {route.kind === "cluster" && <ClusterPage
      focusHostId={route.hostId}
      tab={route.tab || "overview"}
      onTabChange={(t) => setRoute({ kind: "cluster", hostId: route.hostId, tab: t === "overview" ? undefined : t })}
      onFocusHost={(id) => setRoute({ kind: "cluster", hostId: id || undefined })}
      onAsk={askAboutAlert}
      onRunAlertAction={(id, action) => handleAction(action, id)}
      onOpenServer={(id) => setRoute({ kind: "server", id })}
      onOpenServerSettings={(id) => setRoute({ kind: "server", id, tab: "settings" })}
      onViewAlerts={() => setRoute({ kind: "attention" })}
      onViewAudit={() => setRoute({ kind: "audit" })}
      onOpenLeaf={(hostId, leaf, leafTab) => setRoute({ kind: "leaf", hostId, leaf, tab: leafTab })}
    />}
    {route.kind === "leafConfig" && <LeafConfigPage
      hostId={route.hostId}
      leafId={route.leaf}
      onSelectLeaf={(leaf) => setRoute({ kind: "leafConfig", hostId: route.hostId, leaf })}
      onBackToHost={() => setRoute({ kind: "cluster", hostId: route.hostId, tab: "services" })}
    />}
    {route.kind === "leaf" && <LeafPage
      hostId={route.hostId}
      leafId={route.leaf}
      tab={route.tab || "overview"}
      onSelectTab={(t) => setRoute({ kind: "leaf", hostId: route.hostId, leaf: route.leaf, tab: t === "overview" ? undefined : t })}
      onReviewConversation={(c) => openReview(route.hostId, c)}
      onAudit={() => setRoute({ kind: "audit" })}
    />}
    {route.kind === "settings" && <SettingsPage
      user={user} onLogout={handleLogout}
      tab={route.tab || "profile"}
      onTabChange={(tab) => setRoute({ kind: "settings", tab })} />}
    {route.kind === "server" && (serverForRender
      ? <ServerDetailPage server={serverForRender} onAction={handleAction}
          tab={route.tab || "overview"}
          onTabChange={(t) => setRoute({ kind: "server", id: route.id, tab: t === "overview" ? undefined : t })}
          onAsk={askAboutAlert}
          onOpenServer={(id) => setRoute({ kind: "server", id })}
          onViewServerAlerts={(id) => setRoute({ kind: "attention", serverId: id })}
          onViewServerAudit={(id) => setRoute({ kind: "audit", serverId: id })}
          onDeleted={() => setRoute({ kind: "servers" })}
        />
      : <ServerGate id={route.id}
          onBack={() => setRoute({ kind: "servers" })}
          onRetry={() => serversStore.refresh().catch(() => {})} />
    )}
    </div>
    </React.Suspense>
    </ErrorBoundary>
  );
}

export { AppRouter };
