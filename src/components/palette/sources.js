import { moderationOffers } from "../PlayerModeration.jsx";
import { verbGuard } from "../ServerActions.jsx";
import { joinRefusal } from "../ServerConnect.jsx";
import { widgetPermitted } from "../widgets/WidgetHost.jsx";
import { ROUTE_TABS } from "../../lib/labels.js";
import { leafIcon } from "../../lib/leaves.js";
import { can, canOn, serverJoin, serverOperable } from "../../lib/persona.js";
import { copyText } from "../../lib/clipboard.js";
import { toast } from "../../lib/toasts.js";
import { backupServer, runServerAction } from "../../lib/serverActions.js";
import { moderatePlayer } from "../../lib/stores.js";
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

/// The connect address, as an entry. Not gated on a capability: an address is what a PLAYER needs,
/// and the panel's own card offers it to anyone who can see the server.
///
/// It refuses in `ServerConnect`'s words (`joinRefusal`) rather than its own, so the palette and the
/// card cannot disagree about why a server can't be joined. The clipboard is reported honestly —
/// `copyText` resolves false when the browser refuses (an insecure origin is the ordinary case on a
/// LAN), and a row claiming "Copied" over an empty clipboard sends somebody to paste nothing.
///
/// The toast is the right surface here for the reason toasts exist: the palette CLOSES on run, so
/// there is no control left on screen to render the outcome beside.
function copyAddressEntry(server, { id, title, weight }) {
  const join = serverJoin(server);
  const refusal = joinRefusal(server, join);
  return {
    id,
    kind: "action", group: "Actions",
    title,
    sub: refusal ? null : join.address,
    icon: "copy",
    weight,
    disabled: !!refusal, reason: refusal,
    chin: refusal ? refusal : "Copy " + join.address + " to the clipboard",
    run: () => copyText(join.address).then((ok) => (ok
      ? toast.success("Address copied", { detail: join.address, serverId: server.id })
      : toast.error("Your browser blocked the copy", { detail: "The address is " + join.address, serverId: server.id }))),
  };
}

/// Build every entry the palette can offer.
///
/// `scope` narrows to one server: its tabs and its verbs, and nothing else. That is what keeps ~200
/// entries usable — past a certain size a flat list stops being searchable and starts being a
/// haystack, so → stops searching the fleet and starts searching one thing.
function buildEntries({ servers, hosts, library, services, players, themePref, scope, nav, openAssistant, onInstall }) {
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

    push(copyAddressEntry(server, {
      id: "scope.copy",
      title: "Copy connect address",
      weight: 100,
    }));

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

    // ---- the people on it --------------------------------------------------
    // The reason this is reachable at all is SCOPE. Fleet-wide, "ban griefer123" has no target the
    // palette could name; inside one server the candidate set is small, known and live.
    //
    // Which actions each player is offered — and the sentence when one cannot run — comes from
    // `moderationOffers`, the same answer the roster's own menu uses. A palette that said "Kick"
    // where the menu says "the server isn't running" would be two answers to one question.
    const roster = (players && players.status === "ready") ? players : null;
    if (operable && roster) {
      const running = server.status === "online";
      for (const p of roster.players || []) {
        const name = p.playerName || p.playerAddr || p.playerIdentity;
        for (const offer of moderationOffers(running, p, roster.moderation)) {
          const verb = offer.action;
          push({
            id: "scope.mod." + verb + "." + p.playerIdentity,
            kind: "action", group: "Players",
            title: verb.charAt(0).toUpperCase() + verb.slice(1) + " " + name,
            sub: offer.reason ? null : (p.status === "online" ? "Connected now" : p.status),
            icon: verb === "kick" ? "user-x" : verb === "ban" ? "ban" : "user-check",
            weight: 90,
            boost: p.status === "online" ? 20 : 0,
            disabled: !!offer.reason, reason: offer.reason,
            // Unbanning restores access and is not destructive, so it needs no misclick guard —
            // the same call the roster's own menu makes without one.
            arm: verb !== "unban",
            chin: verb.charAt(0).toUpperCase() + verb.slice(1) + " " + name + " on " + server.id,
            warn: verb !== "unban",
            run: () => moderatePlayer(server, p.playerIdentity, verb),
          });
        }
      }
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

  // ---- views ---------------------------------------------------------------
  // The filtered destinations the router already addresses (?status=, ?filter=, ?severity=). Each is
  // a page somebody arrives at with a question already in mind — "what is down", "what needs
  // updating" — and reaching one otherwise means landing on the list and then narrowing it.
  //
  // A count is the SUB, and a count of zero means no entry: a row promising offline servers on a
  // fleet that is entirely up is a row that leads to an empty page.
  if (can("nav.servers")) {
    const counted = [
      { id: "offline", status: "offline", title: "Offline servers", icon: "power-off",
        n: (servers || []).filter((x) => x.status === "offline").length },
      { id: "updates", status: "updates", title: "Servers with updates", icon: "circle-arrow-up",
        n: (servers || []).filter((x) => x.update_available && x.status !== "updating").length },
      { id: "crashed", status: "crashed", title: "Crashed servers", icon: "triangle-alert",
        n: (servers || []).filter((x) => x.status === "crashed").length },
    ];
    for (const v of counted) {
      if (!v.n) continue;
      push({
        id: "view." + v.id, kind: "nav", group: "Views",
        title: v.title,
        sub: v.n === 1 ? "1 server" : v.n + " servers",
        icon: v.icon,
        weight: 38,
        chin: "Open " + v.title.charAt(0).toLowerCase() + v.title.slice(1),
        run: () => nav.servers(v.status),
      });
    }
  }

  // The catalog filtered to what is already running somewhere. No count: whether a blueprint counts
  // as installed is LibraryPage's own answer (an instance count per game), and restating it here
  // would be a second implementation of it that could disagree.
  if (can("nav.library")) {
    push({
      id: "view.installed", kind: "nav", group: "Views",
      title: "Installed games",
      sub: "Blueprints you are already running",
      icon: "library",
      weight: 36,
      chin: "Open the catalog, filtered to what is installed",
      run: () => nav.library("installed"),
    });
  }

  // Warnings and failures only. The audit page calls this severity "attention"; the entry says what
  // it contains, because "Alerts" is the board next door and naming it that here would point at the
  // wrong page.
  if (can("nav.audit")) {
    push({
      id: "view.audit.attention", kind: "nav", group: "Views",
      title: "Audit log · Warnings and failures",
      sub: null,
      icon: "scroll-text",
      weight: 34,
      chin: "Open the audit log, filtered to warnings and failures",
      run: () => nav.audit({ severity: "attention" }),
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

  // ---- connect addresses ---------------------------------------------------
  // Fleet-wide as well as scoped, because "copy factorio" is what somebody types when a friend asks
  // for the address — and unlike a verb, this is something a viewer can do.
  for (const s2 of servers || []) {
    push(copyAddressEntry(s2, {
      id: "copy." + s2.id,
      title: "Copy " + s2.id + " address",
      weight: 65,
    }));
  }

  // ---- nodes ---------------------------------------------------------------
  // The cluster's machines by name. Everything about a node is otherwise two hops away — Cluster,
  // then the card — which is exactly the walk this exists to remove. The leaves above are reached
  // through their node, so the node itself being absent was the gap in the middle.
  if (can("nav.cluster")) {
    for (const h of hosts || []) {
      const label = h.hostname && h.hostname !== h.id ? h.hostname : null;
      push({
        id: "node." + h.id,
        kind: "node", group: "Nodes",
        title: h.id,
        sub: label,
        icon: "server-cog",
        weight: 55,
        boost: h.online ? 20 : 0,
        state: { tone: h.online ? "run" : "stop", label: h.online ? "online" : "offline" },
        chin: "Open " + h.id,
        run: () => nav.openHost(h.id),
      });
      push({
        id: "node." + h.id + ".logs",
        kind: "nav", group: "Nodes",
        title: h.id + " · Logs",
        sub: "The host journal",
        icon: "scroll-text",
        weight: 46,
        chin: "Open " + h.id + " · Logs",
        run: () => nav.openHostLogs(h.id),
      });
      for (const tab of ROUTE_TABS.cluster) {
        if (tab.id !== "resources" && tab.id !== "services" && tab.id !== "jobs") continue;
        push({
          id: "node." + h.id + "." + tab.id,
          kind: "nav", group: "Nodes",
          title: h.id + " · " + tab.label,
          sub: null,
          icon: tab.icon,
          weight: 44,
          chin: "Open " + h.id + " · " + tab.label,
          run: () => nav.openHost(h.id, tab.id),
        });
      }
      if (can("nav.servers")) {
        const n = (servers || []).filter((x) => x.hostId === h.id).length;
        push({
          id: "node." + h.id + ".servers",
          kind: "nav", group: "Nodes",
          title: "Servers on " + h.id,
          sub: n === 1 ? "1 server" : n + " servers",
          icon: "server",
          weight: 42,
          chin: "List the servers on " + h.id,
          run: () => nav.serversOnNode(h.id),
        });
      }
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
      // Its journal and its settings — the two tabs anybody actually navigates to. Overview is the
      // entry above, and System is read on the way past rather than aimed at.
      for (const tab of ROUTE_TABS.leaf) {
        if (tab.id !== "logs" && tab.id !== "settings") continue;
        push({
          id: "leaf." + hostId + "." + svc.id + "." + tab.id,
          kind: "nav", group: "Leaves",
          title: (svc.displayName || svc.id) + " · " + tab.label,
          sub: hostId,
          icon: tab.icon,
          weight: 45,
          chin: "Open " + (svc.displayName || svc.id) + " · " + tab.label,
          run: () => nav.openLeaf(hostId, svc.id, tab.id),
        });
      }
    }
  }

  // The cluster's own tabs — the only way to reach a node's resources, services, jobs or journal by
  // name rather than by walking to Cluster and picking a tab.
  if (can("nav.cluster")) {
    for (const tab of ROUTE_TABS.cluster) {
      if (tab.id === "overview") continue;          // "Cluster" already goes there
      push({
        id: "cluster." + tab.id, kind: "nav", group: "Go to",
        title: "Cluster · " + tab.label, sub: null, icon: tab.icon,
        weight: 35,
        chin: "Open Cluster · " + tab.label,
        run: () => nav.openHost(undefined, tab.id),
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
      // Editing a blueprint is a DESTINATION, not an action — it needs an editor, and the palette
      // opens the one that exists rather than trying to be it.
      push({
        id: "game.bp." + g.id, kind: "nav", group: "Catalog",
        title: "Edit " + (g.name || g.id) + " blueprint",
        sub: "Opens the blueprint editor",
        icon: "file-code",
        weight: 12,
        chin: "Edit the " + (g.name || g.id) + " blueprint",
        run: () => nav.openGame(g.id, "blueprint"),
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
