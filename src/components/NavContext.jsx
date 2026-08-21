import React from "react";

// NavContext — navigation as something a component can ASK FOR, rather than something its parent
// has to hand it.
//
// The panel's pages take their navigation as callbacks: AppRouter passes DashboardPage fourteen of
// them, ServerDetailPage eight. That works while every card is rendered by the page that knows
// where it sits. It stops working the moment a card can be PINNED — a leaf journal on the dashboard
// has no leaf page above it to supply an onOpenServer, and threading one through the widget grid
// would mean the grid knowing every callback every widget might ever want.
//
// So navigation moves to context, the same way dock state did (AssistantDockContext). The provider
// sits above the router and closes over the shell's setRoute; anything below can navigate without
// being wired for it.
//
// MIGRATION, not a rewrite. AppRouter keeps its explicit props, and a component that already takes
// one prefers it:
//
//     const nav = useNav();
//     const open = onOpenServer || nav.openServer;
//
// which renders correctly on its page and correctly pinned, with no call site changed. A prop is
// dropped only once every consumer of that component reads the context instead.

const NavContext = React.createContext(null);

// The no-provider fallback. Navigating without a provider is a wiring bug, not a user-facing
// failure, so this reports it in dev and does nothing — a dead click beats a crashed dashboard.
const NAV_UNWIRED = {
  go() {
    if (import.meta.env && import.meta.env.DEV) {
      try { console.warn("kgsm-web nav: navigation was requested outside a NavProvider — the click did nothing."); } catch { /* no console */ }
    }
  },
};

function useNav() {
  return React.useContext(NavContext) || NAV_UNWIRED;
}

// The provider. `setRoute` is the shell's, so this introduces no state of its own — it is a stable
// vocabulary over the one the router already speaks.
function NavProvider({ setRoute, children }) {
  const nav = React.useMemo(() => {
    const go = (route) => setRoute(route);
    return {
      go,
      home:          ()                  => go({ kind: "home" }),
      servers:       (status)            => go({ kind: "servers", status }),
      serversOnNode: (hostId)            => go({ kind: "servers", node: hostId }),
      openServer:    (id, tab)           => go({ kind: "server", id, tab }),
      library:       (filter)            => go({ kind: "library", filter }),
      openGame:      (id, tab)           => go({ kind: "game", id, tab }),
      audit:         (opts)              => go({ kind: "audit", ...(opts || {}) }),
      alerts:        (serverId)          => go({ kind: "attention", serverId }),
      cluster:       ()                  => go({ kind: "cluster" }),
      openHost:      (hostId, tab)       => go({ kind: "cluster", hostId, tab }),
      openHostLogs:  (hostId)            => go({ kind: "cluster", hostId, tab: "logs" }),
      openLeaf:      (hostId, leaf, tab) => go({ kind: "leaf", hostId, leaf, tab }),
      leafConfig:    (hostId, leaf)      => go({ kind: "leafConfig", hostId, leaf }),
      settings:      (tab)               => go({ kind: "settings", tab }),
    };
  }, [setRoute]);

  return <NavContext.Provider value={nav}>{children}</NavContext.Provider>;
}

export { NavProvider, useNav };
