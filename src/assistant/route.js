import React from "react";

// The standalone assistant's routing — two screens, so the whole scheme fits here.
//
// The Control Panel's `lib/router.js` is a route vocabulary for a cluster (nodes, servers, tabs,
// severities) resolved through a per-node RBAC policy. This surface has one leaf, one conversation
// and one settings page, so it carries its own bridge rather than importing that one: the panel's
// router would drag its persona and connection model in behind it, which is exactly the edge
// `npm run check:assistant` exists to keep cut.
//
// The URL is the source of truth, in the HASH — the leaf serves this SPA with
// `UseDefaultFiles`/`UseStaticFiles` and no SPA fallback, so a path-shaped `/settings` would 404 on
// a refresh. `#/settings` costs the leaf nothing and survives Back, Forward, refresh and a shared
// link.
//
// The landing tab is omitted from the URL, so the plain `#/settings` the chat's own entry points
// produce is the canonical address of the page as it opens.

const SETTINGS_TABS = ["appearance", "memory", "notifications"];
const DEFAULT_TAB = SETTINGS_TABS[0];

// `{ kind: "chat" }` or `{ kind: "settings", tab }`. An unknown word is the chat, and an unknown tab
// is the landing one: a stale or hand-typed URL should land somewhere rather than nowhere.
function parseHash(hash) {
  const parts = String(hash || "").replace(/^#\/?/, "").split("/").filter(Boolean);
  if (parts[0] !== "settings") return { kind: "chat", tab: null };
  return { kind: "settings", tab: SETTINGS_TABS.includes(parts[1]) ? parts[1] : DEFAULT_TAB };
}

function routeToHash(route) {
  if (!route || route.kind !== "settings") return "#/";
  return route.tab && route.tab !== DEFAULT_TAB ? `#/settings/${route.tab}` : "#/settings";
}

// The route as state, plus the one way to change it: writing the hash. Navigation goes through the
// URL rather than through a setter, so the address bar and the rendered screen cannot disagree and
// Back works without any bookkeeping of our own.
function useRoute() {
  const [route, setRoute] = React.useState(() => parseHash(window.location.hash));
  React.useEffect(() => {
    const onHash = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    // The boot sequence strips an OAuth landing's fragment before this mounts, so re-read once:
    // what we captured in the initializer may already be a hash behind.
    onHash();
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const go = React.useCallback((next) => { window.location.hash = routeToHash(next); }, []);
  return [route, go];
}

export { DEFAULT_TAB, SETTINGS_TABS, parseHash, routeToHash, useRoute };
