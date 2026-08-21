import { verbGuard } from "../ServerActions.jsx";
import { widgetPermitted } from "../widgets/WidgetHost.jsx";
import { ROUTE_TABS } from "../../lib/labels.js";
import { leafIcon } from "../../lib/leaves.js";
import { can, canOn, serverOperable } from "../../lib/persona.js";
import { backupServer, runServerAction } from "../../lib/serverActions.js";
import { THEME_OPTS, resolveTheme, themeStore } from "../../lib/theme.js";
import { dashboardStore } from "../../lib/widgets/dashboardStore.js";
import { allWidgets } from "../../lib/widgets/registry.js";

// palette/sources.js — everything the command palette can reach, as one flat list of entries.
//
// THE RULE THIS FILE EXISTS TO KEEP: the palette never invents a code path. A lifecycle verb here
// runs `runServerAction` and is gated by `verbGuard` — the same two the button on a server card
// uses — so a verb refused on the card is refused here in the same sentence, an optimistic update
// rolls back the same way, and the audit row is written from the same place. The palette is a second
// DOOR onto capability that already exists, never a second implementation of it.
//
// It is also what keeps the thing cheap: every source below is a store the SPA already holds and
// every gate is one that already exists. Nothing here fetches.
//
// ⚠ Permission is applied HERE, not at render. An entry a role may not act on is never built, so it
// cannot be matched, ranked, arrowed onto or run. "Aggregate for reach, scoped for action"
// (persona.js) applies as everywhere: navigation asks `can`, anything touching one node asks
// `canOn`.

// ---- the descriptor -------------------------------------------------------
//
//   id       stable, unique — React's key and the selection anchor across re-ranks
//   kind     what it is, for the chin's wording
//   group    the section label it sorts under
//   title    what is matched and marked
//   sub      context, matched at a discount and never marked
//   icon     lucide name
//   weight   the TYPE's standing at equal text score
//   boost    this instance's standing (a running server over a stopped one)
//   state    optional { tone, label } → the status pill on the right
//   hint     optional short right-aligned mono text
//   disabled + reason — drawn dimmed WITH the sentence, never hidden (verbGuard's contract)
//   arm      this needs two presses
//   chin     what the chin says ↵ will do
//   warn     the chin says it in the warning colour
//   scope    a serverId this entry can be scoped into with →
//   run      () => void

// The UI's run-state vocabulary is online/offline/starting/unknown (adapters.js), plus the
// installing/updating states stores/servers.js derives from a running job. Anything mid-transition
// gets the busy tone; "offline" and "unknown" are both quiet rather than alarming, because a server
// nobody has started is not a problem.
const TONE_FOR = (status) => {
  if (status === "online") return "run";
  if (status === "offline" || status === "unknown") return "stop";
  return "busy";
};

// ---- Navigation -----------------------------------------------------------
// The panel's own routes. Capabilities are the literal strings persona uses, the same way the widget
// registry names them — there is no exported CAP map and inventing one here would be a second list
// to keep in step.
const ROUTES = [
  { id: "nav.home", title: "Home", icon: "layout-dashboard", cap: "nav.dashboard", go: (n) => n.home() },
  { id: "nav.servers", title: "Servers", icon: "server", cap: "nav.servers", go: (n) => n.servers() },
  { id: "nav.library", title: "Catalog", icon: "library", cap: "nav.library", go: (n) => n.library() },
  { id: "nav.alerts", title: "Alerts", icon: "triangle-alert", cap: "nav.alerts", go: (n) => n.alerts() },
  { id: "nav.cluster", title: "Cluster", icon: "boxes", cap: "nav.cluster", go: (n) => n.cluster() },
  { id: "nav.audit", title: "Audit log", icon: "scroll-text", cap: "nav.audit", go: (n) => n.audit() },
  { id: "nav.settings", title: "Settings", icon: "settings", cap: "nav.settings", go: (n) => n.settings() },
];

const VERBS = [
  { verb: "start", label: "Start", icon: "play" },
  { verb: "stop", label: "Stop", icon: "square" },
  { verb: "restart", label: "Restart", icon: "rotate-cw" },
  { verb: "update", label: "Update", icon: "circle-arrow-up" },
];

// Stopping or restarting something people are connected to is the case the always-arm rule exists
// for, and the chin is where the reason gets stated in full.
function consequenceOf(verb, server) {
  const n = server.onlinePlayers;
  if ((verb === "stop" || verb === "restart") && n != null && n > 0) {
    return n === 1 ? "1 player will be disconnected" : n + " players will be disconnected";
  }
  return null;
}

/// Build every entry the palette can offer.
///
/// `scope` narrows to one server: its tabs and its verbs, and nothing else. That is what keeps ~200
/// entries usable — past a certain size a flat list stops being searchable and starts being a
/// haystack, so → stops searching the fleet and starts searching one thing.
function buildEntries({ servers, library, services, themePref, scope, nav, openAssistant, onInstall }) {
  const out = [];
  const push = (e) => { if (e) out.push(e); };

  // ---- scoped: one server, everything about it -----------------------------
  if (scope) {
    const server = (servers || []).find((s) => s.id === scope);
    if (!server) return out;
    const operable = serverOperable(server);

    if (operable) {
      for (const v of VERBS) {
        const guard = verbGuard(server, v.verb);
        const consequence = consequenceOf(v.verb, server);
        push({
          id: "scope.verb." + v.verb,
          kind: "action", group: "Actions",
          title: v.label,
          sub: guard.disabled ? null : (consequence || "Lifecycle"),
          icon: v.icon,
          weight: 120,
          disabled: guard.disabled, reason: guard.reason,
          arm: true,
          chin: v.label + " " + server.id + (consequence ? " — " + consequence : ""),
          warn: !!consequence,
          run: () => runServerAction(v.verb, server),
        });
      }
    }

    // Backing up is a lifecycle-adjacent action rather than a verb: kgsm has no "backup" command,
    // so it does not go through verbGuard. It arms like everything else that changes the host.
    if (operable) {
      push({
        id: "scope.backup",
        kind: "action", group: "Actions",
        title: "Back up now",
        sub: "Takes a snapshot of this server as it is",
        icon: "database",
        weight: 110,
        arm: true,
        chin: "Back up " + server.id,
        run: () => backupServer(server),
      });
    }

    for (const tab of ROUTE_TABS.server) {
      push({
        id: "scope.tab." + tab.id,
        kind: "nav", group: "Tabs",
        title: tab.label,
        sub: null,
        icon: tab.icon,
        weight: 60,
        chin: "Open " + server.id + " · " + tab.label,
        run: () => nav.openServer(server.id, tab.id === "overview" ? undefined : tab.id),
      });
    }

    // The widgets that bind to a SERVER. Pinning one from here is the shortest path there is: the
    // alternative is walking to the server's page to find the card and press its pin.
    for (const w of allWidgets()) {
      if (w.hidden) continue;
      if (!w.params || w.params.length !== 1 || w.params[0] !== "serverId") continue;
      const params = { serverId: server.id };
      if (!widgetPermitted(w, params)) continue;
      const pinned = dashboardStore.isPinned(w.type, params);
      push({
        id: "scope.pin." + w.type,
        kind: "pin", group: "Dashboard",
        title: (pinned ? "Unpin " : "Pin ") + w.label.toLowerCase(),
        sub: pinned ? "On your dashboard" : "Adds a widget bound to " + server.id,
        icon: pinned ? "pin-off" : "pin",
        weight: 30,
        chin: (pinned ? "Remove " : "Pin ") + w.label.toLowerCase() + " " + (pinned ? "from" : "to") + " the dashboard",
        run: () => (pinned
          ? dashboardStore.unpinTarget(w.type, params)
          : dashboardStore.pin(w.type, params, w.size)),
      });
    }
    return out;
  }

  // ---- routes --------------------------------------------------------------
  for (const r of ROUTES) {
    if (r.cap && !can(r.cap)) continue;
    push({
      id: r.id, kind: "nav", group: "Go to",
      title: r.title, sub: null, icon: r.icon,
      weight: 40,
      chin: "Open " + r.title,
      run: () => r.go(nav),
    });
  }

  for (const tab of ROUTE_TABS.settings) {
    if (!can("nav.settings")) break;
    push({
      id: "settings." + tab.id, kind: "nav", group: "Settings",
      title: "Settings · " + tab.label, sub: null, icon: tab.icon,
      weight: 10,
      chin: "Open Settings · " + tab.label,
      run: () => nav.settings(tab.id),
    });
  }

  // The assistant is a DOCK rather than a route, so it is reached by opening it rather than by
  // navigating. Offered as a destination only — a query that matches nothing is answered by saying
  // so, never by quietly handing what somebody typed to a language model.
  if (openAssistant) {
    push({
      id: "nav.assistant", kind: "nav", group: "Go to",
      title: "Assistant", sub: null, icon: "bot",
      weight: 40,
      chin: "Open the assistant",
      run: () => openAssistant(),
    });
  }

  // ---- servers -------------------------------------------------------------
  for (const s of servers || []) {
    const running = s.status === "online";
    push({
      id: "server." + s.id, kind: "server", group: "Servers",
      title: s.id,
      sub: [s.blueprint, s.hostId].filter(Boolean).join(" · ") || null,
      icon: "server",
      weight: 100,
      boost: running ? 30 : 0,
      state: { tone: TONE_FOR(s.status), label: s.status },
      scope: s.id,
      chin: "Open " + s.id,
      run: () => nav.openServer(s.id),
    });
  }

  // ---- lifecycle verbs, fleet-wide ----------------------------------------
  // Offered unscoped as well, because "start minecraft" is a thing somebody types in one go.
  for (const s of servers || []) {
    if (!serverOperable(s)) continue;
    for (const v of VERBS) {
      const guard = verbGuard(s, v.verb);
      const consequence = consequenceOf(v.verb, s);
      push({
        id: "verb." + v.verb + "." + s.id,
        kind: "action", group: "Actions",
        title: v.label + " " + s.id,
        sub: guard.disabled ? null : "Lifecycle",
        icon: v.icon,
        weight: 70,
        disabled: guard.disabled, reason: guard.reason,
        arm: true,
        chin: v.label + " " + s.id + (consequence ? " — " + consequence : ""),
        warn: !!consequence,
        run: () => runServerAction(v.verb, s),
      });
    }
  }

  // ---- leaves --------------------------------------------------------------
  // Only what a node has actually reported. A leaf list is per host and arrives when that host's
  // services are read, so before then this contributes nothing rather than guessing at a roster.
  for (const [hostId, entry] of Object.entries(services || {})) {
    if (!entry || !entry.everLoaded || !canOn("host.manage", hostId)) continue;
    for (const svc of entry.list || []) {
      push({
        id: "leaf." + hostId + "." + svc.id,
        kind: "leaf", group: "Leaves",
        title: svc.displayName || svc.id,
        sub: [svc.role, hostId].filter(Boolean).join(" · ") || null,
        icon: leafIcon(svc.id),
        weight: 50,
        chin: "Open " + (svc.displayName || svc.id) + " on " + hostId,
        run: () => nav.openLeaf(hostId, svc.id),
      });
    }
  }

  // ---- library -------------------------------------------------------------
  if (can("nav.library")) {
    for (const g of library || []) {
      push({
        id: "game." + g.id, kind: "game", group: "Catalog",
        title: g.name || g.id,
        sub: "Blueprint",
        icon: "book-open",
        weight: 20,
        chin: "Open " + (g.name || g.id),
        run: () => nav.openGame(g.id),
      });
    }
  }

  // ---- install -------------------------------------------------------------
  // A LAUNCH, not an action: installing needs a form — a node, ports, a name — and a palette that
  // tried to take those would be a worse install modal. This opens the real one, already pointed at
  // the blueprint.
  if (onInstall && can("server.create")) {
    for (const g of library || []) {
      push({
        id: "install." + g.id, kind: "action", group: "Install",
        title: "Install " + (g.name || g.id),
        sub: "Opens the install form",
        icon: "download",
        weight: 25,
        chin: "Set up a new " + (g.name || g.id) + " server",
        run: () => onInstall(g),
      });
    }
  }

  // ---- dashboard -----------------------------------------------------------
  // The fleet-wide widgets, the same set the Add-widget sheet offers. A repeatable type never reads
  // as pinned, because another one is always addable.
  for (const w of allWidgets()) {
    if (w.hidden) continue;
    if (w.params && w.params.length) continue;
    if (!widgetPermitted(w, {})) continue;
    const pinned = !w.repeatable && dashboardStore.isPinned(w.type, {});
    push({
      id: "pin." + w.type,
      kind: "pin", group: "Dashboard",
      title: (pinned ? "Unpin " : "Pin ") + w.label,
      sub: pinned ? "On your dashboard" : null,
      icon: pinned ? "pin-off" : "pin",
      weight: 15,
      chin: (pinned ? "Remove " : "Pin ") + w.label + " " + (pinned ? "from" : "to") + " the dashboard",
      run: () => (pinned ? dashboardStore.unpinTarget(w.type, {}) : dashboardStore.pin(w.type, {}, w.size)),
    });
  }

  // ---- themes --------------------------------------------------------------
  // Client-only, so no capability gates it: a theme is a fact about this browser, not the fleet.
  for (const t of THEME_OPTS) {
    const current = t.id === themePref;
    push({
      id: "theme." + t.id, kind: "theme", group: "Appearance",
      title: t.label,
      sub: current ? "Current" : (t.cvd ? "Colour vision · " + t.cvd : t.tribute ? "Tribute · " + t.tribute : null),
      icon: "palette",
      weight: 5,
      boost: current ? 20 : 0,
      themeId: t.id,
      chin: "Use " + t.label,
      run: () => themeStore.set(t.id),
    });
  }

  return out;
}

/// Apply a theme to the document WITHOUT storing it, so arrowing through 49 of them previews each
/// one and writes nothing. `themeStore.set` is the commit; this is the look.
function previewTheme(id) {
  try { document.documentElement.dataset.theme = resolveTheme(id); } catch { /* no document */ }
}

/// Put back whatever the stored preference resolves to — what Escape and a non-theme selection do.
function restoreTheme() {
  try { document.documentElement.dataset.theme = themeStore.getState().resolved; } catch { /* no document */ }
}

export { buildEntries, previewTheme, restoreTheme };
