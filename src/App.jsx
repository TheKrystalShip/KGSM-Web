import React from "react";
import { AssistantDockProvider, useAssistantDock } from "./components/AssistantDockContext.jsx";
import { alertsTone, anchoredAlerts } from "./components/ContextualAlerts.jsx";
import { ColdStartDown } from "./components/ErrorBoundary.jsx";
import { ConnectivityBanner } from "./components/ConnectivityBanner.jsx";
import { NodeAccessNotice } from "./components/host-helpers.jsx";
import { NavProvider } from "./components/NavContext.jsx";
import { KrystalFooter } from "./components/Footer.jsx";
import { InstallModal } from "./components/InstallModal.jsx";
import { Toasts } from "./components/Toasts.jsx";
import { toast } from "./lib/toasts.js";
import { alertBuckets, useAlerts } from "./components/NeedsAttention.jsx";
import { Sidebar } from "./components/Sidebar.jsx";
import { api, connectionStore } from "./lib/apiClient.js";
import { KRYSTAL_LABELS } from "./lib/labels.js";
import { canOn, homeKind, resolveRoute, serverOperable } from "./lib/persona.js";
import { KrystalRouter } from "./lib/router.js";
import { runServerAction } from "./lib/serverActions.js";
import { sessionStore } from "./lib/sessionStore.js";
import { useStore } from "./lib/store.js";
import { hostsStore, installServer, libraryStore, serversStore, servicesStore, startDataLayer, stopDataLayer } from "./lib/stores.js";
import { AddHostPage } from "./pages/HostAccess.jsx";
import { CommandPalette } from "./components/palette/CommandPalette.jsx";
import { FirstRunWelcome, hasSeenWelcome } from "./pages/FirstRunWelcome.jsx";
import AssistantFabIcon from "./components/AssistantFabIcon.jsx";
import { Modal } from "./components/Modal.jsx";
import { AuthGate } from "./components/AuthGate.jsx";
import { readPendingSession } from "./lib/authFlow.js";

// Extracted modules
import { readStoredUser, writeStoredUser } from "./lib/authStorage.js";
import { Breadcrumb } from "./components/Breadcrumb.jsx";
import { BootLanding } from "./components/BootLanding.jsx";
import { MobileNavToggle } from "./components/MobileNavToggle.jsx";
import { useRouteSync } from "./hooks/useRouteSync.js";
import { useMobileSwipe } from "./hooks/useMobileSwipe.js";
import { AppRouter } from "./components/AppRouter.jsx";

// The widget catalog, registered at shell load. It MUST be eager: a pin lives on a card anywhere in
// the panel and draws nothing for a type the registry does not hold, so registering it from the
// (lazy) dashboard would mean no card is pinnable until you have visited the dashboard once. Every
// entry's component is a dynamic import, so this costs the metadata and not the code.
import "./pages/dashboard/catalog.js";

// ChatPage is lazy-loaded for both the dock and the full-screen modal.
const ChatPage = React.lazy(() => import("./pages/ChatPage.jsx"));

// App — the chooser: the way in, or the app.
//
// Wraps the inner app in AssistantDockProvider so dock state is available via
// useAssistantDock() throughout the tree.

// Somebody signed in and holding nothing. Read straight from storage rather than from a
// store, because it is a fact about THIS TAB that has to be true on the first render —
// before any hook, since deciding it later would mean mounting the shell for somebody
// every one of its screens would refuse.
const pendingApproval = () => !!readPendingSession();

function App() {
  const [user, setUser] = React.useState(() => readStoredUser());
  const hosts = useStore(hostsStore, s => s.list);
  const [route, setRouteRaw] = React.useState(() => {
    const hashRoute = KrystalRouter.routeFromHash();
    return hashRoute ? resolveRoute(hashRoute) : resolveRoute({ kind: "home" });
  });
  const setRoute = React.useCallback((r) => {
    setRouteRaw(prev => resolveRoute(typeof r === "function" ? r(prev) : r));
  }, []);

  // Re-read the stored identity. The gate calls this after every transition it makes,
  // instead of the full page reload the app used to do on each of them — which is only
  // possible because the shell is no longer mounted behind the gate, so there are no
  // hooks below a flipping condition to trip React's rules.
  const refreshUser = React.useCallback(() => setUser(readStoredUser()), []);

  // Everything in front of the app: which node, which door, and the wait for approval.
  // AppInner is not mounted while this is on screen, so none of the shell's hooks —
  // and none of the data layer they drive — runs for somebody who has not signed in.
  if (!user || pendingApproval()) {
    return <AuthGate user={user} onUser={refreshUser} />;
  }

  // NavProvider sits outside everything that renders a card, so a component can navigate by asking
  // rather than by being handed a callback — which is what lets the same card render on its own page
  // and pinned to the dashboard.
  return (
    <NavProvider setRoute={setRoute}>
      <AssistantDockProvider hosts={hosts} setRoute={setRoute}>
        <AppInner user={user} setUser={setUser} route={route} setRoute={setRoute} />
      </AssistantDockProvider>
    </NavProvider>
  );
}

// AppInner — the real app body. Consumes dock state from context.
function AppInner({ user, setUser, route, setRoute }) {
  const dock = useAssistantDock();
  const { assistantOpen, setAssistantOpen, assistantSeed,
    assistantHost, assistantHostList, setAssistantHostId,
    dockWidth, dockResize, pushingPanel, railMode, desktop, effPush, tw, canPush,
    openAssistant, openView, handleAssistantNavigate, setManualPin,
    review, exitReview } = dock;
  const hosts = useStore(hostsStore, s => s.list);

  // --- Auth ---

  const handleLogout = React.useCallback(async () => {
    // Revoke this device's session SERVER-SIDE on every node the SPA holds one
    // (best-effort, awaited so the reload below doesn't abort the requests) — this
    // needs the live bearer, so it runs BEFORE we drop the local credentials. At
    // N=1 that's just the one host; at N≥2 each connected node's calling session is
    // revoked. (The Settings → "Log out everywhere" path additionally revokes {all}
    // on a node, which fans session.revoke to peers over the cluster bus.)
    const ids = sessionStore.readRegistry().map(h => h && h.id).filter(Boolean);
    await Promise.all(ids.map(id => api.logout(id).catch(() => {})));
    writeStoredUser(null);
    // Drop EVERY per-host credential — the access token (sessionStorage) AND the
    // long-lived refresh token (localStorage) — so a reload can't silently rotate a
    // fresh session back in. The host registry stays, so the user lands on the
    // host's login rather than the add-host screen.
    sessionStore.signOut();
    window.location.reload();
  }, []);

  // --- Data stores ---
  const servers = useStore(serversStore, s => s.list);
  const libraryList = useStore(libraryStore, s => s.list);
  const hostsLoaded = useStore(hostsStore, s => s.everLoaded);
  const sessionsByHost = useStore(sessionStore, s => s.byHost);
  // Read for the breadcrumb's leaf crumb only — the leaf page is what hydrates this board, so this
  // reads whichever node's board is currently held and shows nothing when none is.
  const servicesByHost = useStore(servicesStore, s => s.byHost);

  const authzSettled = hosts.every(h => {
    const s = sessionsByHost[h.id];
    return s && s.status !== "none" && s.status !== "bootstrapping";
  });

  const authzReady = hostsLoaded && authzSettled;

  const [tab] = React.useState(null);
  const [installing, setInstalling] = React.useState(null);
  const [chatFullscreen, setChatFullscreen] = React.useState(false);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState(() => {
    try { return localStorage.getItem("krystal:sidebar:collapsed") === "1"; } catch { return false; }
  });
  const [landingResolved, setLandingResolved] = React.useState(false);
  // The one-time tour of the composable dashboard. Read once, at mount, so it cannot flicker back on
  // when the modal writes the key and closes. It renders below, inside the app frame — past the
  // sign-in screen, the approval wait, the add-a-host screen, the cold-start failure and the boot
  // landing, all of which return earlier — so it only ever meets somebody who can reach the
  // dashboard, never somebody mid-login.
  const [showWelcome, setShowWelcome] = React.useState(() => !hasSeenWelcome());

  // The data layer runs exactly as long as the shell is mounted, which is exactly as long
  // as there is somebody signed in to run it for. It used to start at module load, so a
  // browser sitting on the sign-in screen hydrated four stores and dialled one SSE stream
  // per connection on behalf of nobody — every call 401ing, every stream backing off
  // against a host that had not been chosen yet.
  React.useEffect(() => {
    startDataLayer();
    return () => stopDataLayer();
  }, []);

  useRouteSync(route, setRoute, landingResolved);

  React.useEffect(() => {
    try { localStorage.setItem("krystal:sidebar:collapsed", collapsed ? "1" : "0"); } catch {}
  }, [collapsed]);

  React.useEffect(() => { setDrawerOpen(false); }, [route, tab]);

  React.useEffect(() => {
    const el = document.querySelector(".app__main");
    if (el) el.scrollTo({ top: 0, behavior: "smooth" });
  }, [route.kind, route.id, route.tab]);

  useMobileSwipe(drawerOpen, setDrawerOpen, assistantOpen, setAssistantOpen);

  // --- Connection ---
  const conn = useStore(connectionStore, s => s);
  const retryConnection = React.useCallback(() => {
    connectionStore.setState(s => ({ ...s, retrying: true, status: s.everLoaded ? s.status : "connecting" }));
    return api.fanOut("/servers").catch(() => {});
  }, []);
  React.useEffect(() => { retryConnection(); }, [retryConnection]);
  // An action that came back 401 after the seam already replayed it means that host's
  // session is genuinely gone rather than merely lapsed. Marking it expired is all this
  // does: the seam's 30-second grace then decides whether it healed, and if it did not,
  // the effect below drops the identity and AuthGate takes over. Reacting harder here
  // would log somebody out over one unlucky request.
  const noteAuthFailure = React.useCallback((hostId) => {
    if (hostId) sessionStore.expire(hostId);
  }, []);

  // "Sign in again" on the per-node notice, and the end of a session that could not be
  // renewed: both land on the node's sign-in, because that is the only thing that fixes
  // either of them.
  const signInAgain = React.useCallback(() => {
    writeStoredUser(null);
    setUser(null);
  }, [setUser]);

  React.useEffect(() => {
    if (landingResolved) return;
    if (!authzReady) return;
    const deepRoute = KrystalRouter.routeFromHash();
    setRoute(deepRoute || { kind: homeKind() });
    setLandingResolved(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resolves the landing route once hosts + roles are known; deps are stable setters + the async gate
  }, [authzReady, landingResolved]);

  // A session that ran out and could not be renewed sends somebody back to that node's
  // sign-in. `reauthDue` rather than raw `expired` is what makes this survivable: the
  // access token lapses every ~15 minutes by design and the seam rotates it silently, so
  // reacting to the lapse itself would throw everybody out four times an hour. The seam
  // only surfaces one it failed to heal, 30 seconds later.
  //
  // Dropping the stored identity is the whole mechanism — App re-renders, sees no user,
  // and shows AuthGate, which lands on the node this browser last used. There is no
  // re-authorize modal any more: the one that existed could not re-authenticate (it
  // waited 650ms and re-read /me with the token that had already failed), and the honest
  // answer to a dead session is the door.
  React.useEffect(() => {
    const sessions = Object.values(sessionsByHost);
    if (!sessions.length) return;
    if (!sessions.every(s => s && (s.reauthDue || s.status === "denied"))) return;
    writeStoredUser(null);
    setUser(null);
  }, [sessionsByHost, setUser]);

  const activeServer = route.kind === "server"
    ? servers.find(s => s.id === route.id) || null
    : null;
  const activeGame = route.kind === "game"
    ? (libraryList.find(g => g.id === route.id) || null)
    : null;

  // The verb itself — the optimistic patch, the rollback, the wording — lives in
  // lib/serverActions.js, because a pinned card has no shell above it to be handed a callback. This
  // only resolves WHICH server the shell means when a caller names none.
  const handleAction = (action, targetId) => {
    const s = targetId ? servers.find(x => x.id === targetId) || activeServer : activeServer;
    if (!s) return;
    runServerAction(action, s);
  };

  const openGame = (game) => setRoute({ kind: "game", id: game.id });
  const handleInstall = (game) => { setInstalling(game); };

  const confirmInstall = (cfg) => {
    installServer(cfg).then((data) => {
      const job = data && data.job;
      if (job && job.serverId) {
        serversStore.addPhantom(job.serverId, {
          blueprint:   cfg.game.id,
          cover:       cfg.game.cover  ?? null,
          hero:        cfg.game.hero   ?? null,
          displayName: cfg.game.name   ?? cfg.game.id,
          hostId:      cfg.hostId      ?? null,
        });
      }
      setInstalling(null);
      setRoute({ kind: "servers" });
    }, err => {
      if (err && err.code === 401) noteAuthFailure(cfg.hostId);
      // The modal is left open on purpose — the config is still on screen and
      // the failure is usually something to change and retry.
      else toast.fromError(err, "Couldn't install " + ((cfg.game && cfg.game.name) || "the server"));
    });
  };

  // The server the detail page renders is the store's row as-is. The console is its own feed —
  // ConsolePanel hydrates a REST tail and follows the per-server topic itself — so the shell holds
  // no console state and a line arriving does not re-render the whole app.
  const serverForRender = activeServer;

  // --- Render ---
  useAlerts();

  // Which node, which door, and the wait for approval are all AuthGate's — this component
  // is not mounted until there is a session with a tier behind it.

  // The sidebar badge counts the CLUSTER's firing alerts — an alert on any node
  // needs a human, so hiding it behind a scope would hide the work.
  const alertCounts = alertBuckets("all");
  const attentionCount = alertCounts.active.length;
  const attentionTone = alertCounts.active.some(i => i.severity === "danger") ? "danger"
    : alertCounts.active.some(i => i.severity === "warn") ? "warn" : "info";

  const diagActive = anchoredAlerts(an => an.surface === "diagnostics");
  const diagnosticsCount = diagActive.length;
  const diagnosticsTone = alertsTone(diagActive);

  const serverAlertsActive = anchoredAlerts(an => an.surface === "server");
  const serversCount = serverAlertsActive.length;
  const serversTone = alertsTone(serverAlertsActive);

  if (route.kind === "addHost" || (hostsLoaded && hosts.length === 0)) {
    return <AddHostPage
      user={user}
      firstRun={hosts.length === 0}
      onAdded={() => setRoute({ kind: "home" })}
      onCancel={hosts.length ? () => setRoute({ kind: "home" }) : null}
      onLogout={handleLogout} />;
  }

  if (conn.status === "down" && !conn.everLoaded) {
    return <ColdStartDown retrying={conn.retrying} onRetry={retryConnection} onLogout={handleLogout} />;
  }

  if (!landingResolved) {
    return <BootLanding />;
  }

  const sidebarCollapsed = desktop ? collapsed : false;
  const railReserve = railMode && !assistantOpen ? 56 : 0;
  const appInset = pushingPanel ? dockWidth : railReserve;

  const sidebarCtx = {
    serverName: serverForRender ? serverForRender.name : null,
    // The server's operator tabs are hidden from a player, and the page falls back to the overview
    // for one — so the breadcrumb has to know, or it would name a tab that isn't on screen.
    serverOperable: serverForRender ? serverOperable(serverForRender) : false,
    gameName: activeGame ? activeGame.name : null,
    hostName: route.hostId ? ((hosts.find(h => h.id === route.hostId) || {}).name || null) : null,
    // The leaf's display name is the services board's to give, and that board is host-scoped — a row
    // read while it still holds another host's list would name the wrong machine's leaf.
    leafName: (route.leaf && route.hostId && servicesByHost[route.hostId]
      ? (servicesByHost[route.hostId].list.find(s => s.id === route.leaf) || {}).displayName : null) || null,
    catalogLabel: KRYSTAL_LABELS.catalog || "Catalog",
  };

  return (
    <div className="app" style={{ "--dock-push": appInset + "px", ...(collapsed ? { "--sidebar-w": "64px" } : {}) }}>
      <Sidebar
        route={route}
        onNavigate={setRoute}
        serversCount={serversCount}
        serversTone={serversTone}
        clusterCount={diagnosticsCount}
        clusterTone={diagnosticsTone}
        attentionCount={attentionCount}
        attentionTone={attentionTone}
        user={user}
        onLogout={handleLogout}
        hosts={hosts}
        open={drawerOpen}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setCollapsed(c => !c)}
      />

      {drawerOpen && <div className="drawer-scrim" onClick={() => setDrawerOpen(false)} />}
      <MobileNavToggle onOpen={() => setDrawerOpen(true)} />

      <main className="app__main">
        <div className="content">
          <ConnectivityBanner conn={conn} onRetry={retryConnection} />
          {/* Per-node access, reported rather than gated: a node refusing this
              session takes its own rows off the aggregated surfaces, not the
              panel. Sessions are per node, so the rest of the cluster works. */}
          <NodeAccessNotice
            onReauth={signInAgain}
            onManage={(h) => setRoute({ kind: "cluster", hostId: h.id })} />
          <Breadcrumb
            route={route}
            onNavigate={setRoute}
            ctx={sidebarCtx} />
          <AppRouter
            route={route}
            setRoute={setRoute}
            user={user}
            activeGame={activeGame}
            serverForRender={serverForRender}
            handleAction={handleAction}
            openGame={openGame}
            handleInstall={handleInstall}
            handleLogout={handleLogout}
            setInstalling={setInstalling}
          />
        </div>
        <KrystalFooter />
      </main>

      <aside className={"assistant-dock" + (assistantOpen ? " assistant-dock--open" : "") + (pushingPanel ? " assistant-dock--push" : "") + (dockWidth < 550 ? " assistant-dock--compact" : "")}
        style={{ width: window.innerWidth <= 768 ? undefined : dockWidth }}>
        {assistantOpen && <div className="assistant-dock__resize" onPointerDown={dockResize} title="Drag to resize"></div>}
        {assistantOpen && (
          <React.Suspense fallback={<div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--fg-3)" }}><span className="oauth-spinner" /></div>}>
          <ChatPage
            user={user}
            docked
            showPin={tw.dockBehavior === "auto" && desktop}
            pinned={effPush}
            pinDisabled={!canPush}
            onTogglePin={() => setManualPin(!effPush)}
            seed={assistantSeed}
            onClose={() => setAssistantOpen(false)}
            onExpand={desktop ? () => { setAssistantOpen(false); setChatFullscreen(true); } : undefined}
            onNavigate={handleAssistantNavigate}
            onOpenServer={(id, tab) => setRoute({ kind: "server", id, tab })}
            onOpenView={openView}
            getServerState={dock.getServerState}
            assistantHost={assistantHost}
            assistantHosts={assistantHostList}
            onSelectAssistantHost={setAssistantHostId}
            review={review}
            onExitReview={exitReview}
          />
          </React.Suspense>
        )}
      </aside>

      {chatFullscreen && (
        <Modal onClose={() => setChatFullscreen(false)} scrimClassName="chat-modal-scrim">
          <div className="chat-modal" role="dialog" aria-modal="true" aria-label="Assistant">
            <ChatPage
              user={user}
              docked={false}
              seed={null}
              onClose={() => setChatFullscreen(false)}
              assistantHost={assistantHost}
              assistantHosts={assistantHostList}
              onSelectAssistantHost={setAssistantHostId}
              onOpenServer={(id, tab) => setRoute({ kind: "server", id, tab })}
              onOpenView={openView}
              onNavigate={handleAssistantNavigate}
              getServerState={dock.getServerState}
            />
          </div>
        </Modal>
      )}

      {railMode && !assistantOpen && (
        <button className="assistant-rail" onClick={openAssistant} title="Open assistant" aria-label="Open assistant">
          <span className="assistant-rail__icon"><AssistantFabIcon size={18} /></span>
        </button>
      )}
      {!assistantOpen && (
        <button className="assistant-fab" onClick={openAssistant} title="Open assistant" aria-label="Open assistant">
          <AssistantFabIcon size={22} />
        </button>
      )}

      <Toasts />

      {/* Mounted once, renders nothing until ⌘K. It owns the hotkey itself rather than being
          handed one, so nothing in the shell has to know it exists. */}
      <CommandPalette />

      {showWelcome && (
        <FirstRunWelcome user={user} onClose={() => setShowWelcome(false)} />
      )}

      {installing && (
        <InstallModal
          game={installing}
          // The nodes that can actually take this install: online, the user may
          // create there, and the session isn't refused. `server.create` is the
          // capability that gates installing (persona.js) — every other create
          // surface gates on the same one.
          hosts={hosts.filter(h => {
            const s = sessionsByHost[h.id];
            return h.online && canOn("server.create", h.id) && (!s || !s.denied);
          })}
          onInstall={confirmInstall}
          onClose={() => setInstalling(null)}
        />
      )}
    </div>
  );
}

export { App };
