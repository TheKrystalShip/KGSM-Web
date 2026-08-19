// Breadcrumb — a projection of the resolved route + the policy. The root
// "Home" crumb appears only when the persona can reach the dashboard.
//
// This is the ONE breadcrumb: it is rendered by the shell above every page, so a page that draws its
// own would sit under a second trail rather than replace it. A page that goes deeper adds its crumbs
// here instead.
//
// A crumb carries the route it opens, not just a kind, so a trail can step through a parameterised
// place (a node, then that node's Services tab) — which is what makes it able to mirror a nested URL
// rather than approximate it.
//
// The trail follows the URL segment for segment, sub-tabs included: #/cluster/hotrod/services reads
// "Home / Cluster / Hotrod / Services", and every crumb but the last opens the prefix of the URL it
// sits at. A tab crumb appears only for a tab the URL actually names — a route's default tab is
// omitted from the hash and so has no crumb, and a stale or mistyped segment (which the page
// resolves back to its default) is left off rather than announced.

import React from "react";
import { can } from "../lib/persona.js";
import { tabLabel } from "../lib/labels.js";

function breadcrumbTrail(route, ctx) {
  const trail = [];
  if (can("nav.dashboard")) trail.push({ label: "Home", to: { kind: "home" } });
  // The tab crumb every tabbed route ends with. `to` is left off: it is the last crumb, and the
  // last crumb is where you already are.
  const tab = (kind, offered = true) => {
    const label = offered ? tabLabel(kind, route.tab) : null;
    if (label) trail.push({ label });
  };
  switch (route.kind) {
    case "home":      break;
    case "servers":   trail.push({ label: "Servers", to: { kind: "servers" } }); break;
    case "server":    trail.push(
                        { label: "Servers", to: { kind: "servers" } },
                        { label: ctx.serverName || "Server", to: { kind: "server", id: route.id } });
                      // Files / Backups / Settings / Performance are operator surfaces the page hides
                      // from a player, landing them on the overview — so there is no crumb to add.
                      tab("server", ctx.serverOperable || route.tab === "overview");
                      break;
    case "library":   trail.push({ label: ctx.catalogLabel }); break;
    case "library-create": trail.push({ label: ctx.catalogLabel, to: { kind: "library" } }, { label: "New blueprint" }); break;
    case "game":      trail.push(
                        { label: ctx.catalogLabel, to: { kind: "library" } },
                        { label: ctx.gameName || "Game", to: { kind: "game", id: route.id } });
                      tab("game");
                      break;
    case "attention": trail.push({ label: "Alerts" }); break;
    case "audit":     trail.push({ label: "Audit log" }); break;
    case "addHost":   trail.push({ label: "Cluster", to: { kind: "cluster" } }, { label: "Add a host" }); break;
    case "cluster":   if (route.hostId) {
                        trail.push(
                          { label: "Cluster", to: { kind: "cluster" } },
                          { label: ctx.hostName || route.hostId, to: { kind: "cluster", hostId: route.hostId } });
                        tab("cluster");
                      } else {
                        trail.push({ label: "Cluster" });
                      }
                      break;
    // The leaf page hangs off its node's Services tab, and the trail says so — each crumb opens the
    // place its word names, so walking back up the breadcrumb walks back up the URL.
    case "leaf":        trail.push(
                        { label: "Cluster", to: { kind: "cluster" } },
                        { label: ctx.hostName || route.hostId || "Host", to: { kind: "cluster", hostId: route.hostId } },
                        { label: "Services", to: { kind: "cluster", hostId: route.hostId, tab: "services" } },
                        // The leaf's display name comes from the services board; until that answers, its
                        // id is what we actually know — shown as-is rather than held blank.
                        { label: ctx.leafName || route.leaf || "Leaf", to: { kind: "leaf", hostId: route.hostId, leaf: route.leaf } });
                      tab("leaf");
                      break;
    // The configuration page's tabs are the node's leaves, so the crumb after "Configuration" is the
    // leaf being configured — named by the services board, falling back to the id in the URL.
    case "leafConfig":  trail.push(
                        { label: "Cluster", to: { kind: "cluster" } },
                        { label: ctx.hostName || route.hostId || "Host", to: { kind: "cluster", hostId: route.hostId } },
                        route.leaf
                          ? { label: "Configuration", to: { kind: "leafConfig", hostId: route.hostId } }
                          : { label: "Configuration" });
                      if (route.leaf) trail.push({ label: ctx.leafName || route.leaf });
                      break;
    case "settings":  trail.push({ label: "Settings", to: { kind: "settings" } }); tab("settings"); break;
    default:          break;
  }
  return trail;
}

function Breadcrumb({ route, ctx, onNavigate }) {
  const trail = breadcrumbTrail(route, ctx);
  return (
    <div className="content__breadcrumb">
      {trail.map((c, i) => {
        const last = i === trail.length - 1;
        const clickable = !last && !!c.to;
        return (
          <React.Fragment key={i}>
            {i > 0 && <span style={{ color: "var(--fg-4)" }}>/</span>}
            <span
              style={{
                color: last ? "var(--fg-1)" : "var(--fg-3)",
                fontWeight: last ? 600 : 500,
                cursor: clickable ? "pointer" : "default",
              }}
              onClick={clickable ? () => onNavigate(c.to) : undefined}>
              {c.label}
            </span>
          </React.Fragment>
        );
      })}
    </div>
  );
}

export { Breadcrumb };
