import React from "react";
import { Icon } from "../components/Icon.jsx";
import { SubTabs } from "../components/SubTabs.jsx";
import { canOn } from "../lib/persona.js";
import { instancesOfBlueprint, offeringHosts } from "../lib/servers.js";
import { useStore } from "../lib/store.js";
import { hostsStore, serversStore } from "../lib/stores.js";
import { artBg } from "../lib/art.js";
import { ROUTE_TABS } from "../lib/labels.js";
import { GameOverview } from "./library/GameOverview.jsx";
import { GameServersTab } from "./library/GameServersTab.jsx";

const GameBlueprintTab = React.lazy(() => import("./library/GameBlueprintTab.jsx"));
const BlueprintFileCard = React.lazy(() => import("./library/BlueprintFileCard.jsx"));

// GamePage — the "blueprint" detail page for a single catalog game. A game in the
// library is a TEMPLATE you can run, not a running server, so this page is the
// catalog's hub: the hero identifies it and carries the one primary action, and
// four tabs split the three audiences the page serves.
//
//   overview   what it is, and whether the cluster has room for it
//   blueprint  everything the blueprint declares, structured and read-only
//   servers    the instances already running from it
//   file       the raw .bp.yaml, in Monaco — operator reads, admin writes
//
// The tab lives in the URL (#/library/<id>/<tab>), the same contract the server
// detail page uses, so Back/Forward and deep links work across tabs too.

function GamePage({ game, tab: tabProp, onTabChange, onCreate, onOpenServer, onAction }) {
  const servers = useStore(serversStore, s => s.list);
  // Which hosts offer this blueprint — derived live from the hosts store, so a
  // catalog sync (a host matching its offering to the fleet) re-renders here.
  const allHosts = useStore(hostsStore, s => s.list);
  const offered = offeringHosts(game, allHosts);
  const hostRestricted = offered.length > 0 && offered.length < allHosts.length;
  // Creating a server is its own capability, scoped per host: it's offered iff
  // the user can create on at least one host that offers this blueprint
  // (architecture.html §3·f·1). A read-only viewer never sees the entry point —
  // and the install modal's host picker is filtered to the same set.
  const canCreate = offered.some(h => canOn("server.create", h.id));
  // The blueprint FILE is the engine's operational definition of how a server is
  // launched, so it sits at operator — the same line the API draws on
  // GET /library/{id}/file. The card gates the write half itself.
  const canReadFile = offered.some(h => canOn("server.operate", h.id));
  // Instances of THIS blueprint — shared helper so the detail page and the
  // library grid/counts always agree (robust to per-instance ids like "rust-ab12").
  const instances = instancesOfBlueprint(game, servers);

  // Names and order are shared with the breadcrumb (lib/labels.js); the instance count and the
  // operator-only File tab are this page's to decide.
  const tabs = ROUTE_TABS.game
    .filter(t => t.id !== "file" || canReadFile)
    .map(t => (t.id === "servers" && instances.length ? { ...t, badge: instances.length, badgeTone: "info" } : t));
  // Keeps a stale or forbidden tab in the URL from rendering an empty body.
  const tab = tabProp || "overview";
  const safeTab = tabs.some(t => t.id === tab) ? tab : "overview";
  const setTab = onTabChange || (() => {});

  // kgsm-api serves cover/hero as absolute, directly-renderable URLs — the detail
  // page prefers the hero (a screenshot/detail image) then the cover, then the
  // themed gradient placeholder when neither is present.
  const bg = artBg(game.hero, game.cover);

  const createBtn = canCreate ? (
    <button className="chip" style={{ background: "var(--krystal-teal)" }} onClick={() => onCreate(game)}>
      <Icon name="plus" size={14} strokeWidth={2.4} /> Create server
    </button>
  ) : null;

  return (
    <>
      {/* Hero — blueprint identity. Reuses the server-hero chrome so a game
          and a server read as the same kind of object header. */}
      <section className="hero">
        <div className="hero__art" style={{ backgroundImage: bg, backgroundSize: "cover", backgroundPosition: "center" }}></div>
        <div className="hero__veil"></div>
        <div className="hero__content">
          <h1 className="hero__name">{game.name}</h1>
          <div style={{ display: "flex", alignItems: "center", gap: 14, color: "var(--fg-3)", fontSize: 13, flexWrap: "wrap" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Icon name={game.type === "container" ? "container" : "cpu"} size={13} /> {game.category}
            </span>
            {hostRestricted && <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--warning-fg)" }}><Icon name="server" size={13} /> {offered.map(h => h.name).join(", ")} only</span>}
          </div>
          <div className="action-row">
            {createBtn}
          </div>
        </div>
      </section>

      <div className="subtabs-row">
        <SubTabs tabs={tabs} active={safeTab} onChange={setTab} />
      </div>

      {safeTab === "overview" && (
        <GameOverview game={game} hosts={offered} instances={instances} />
      )}

      {safeTab === "blueprint" && (
        <React.Suspense fallback={null}>
          <GameBlueprintTab game={game} offeringHosts={offered} allHosts={allHosts} />
        </React.Suspense>
      )}

      {safeTab === "servers" && (
        <GameServersTab game={game} instances={instances} canCreate={canCreate}
          onCreate={onCreate} onOpenServer={onOpenServer} onAction={onAction} createBtn={createBtn} />
      )}

      {safeTab === "file" && (
        <React.Suspense fallback={null}>
          <BlueprintFileCard game={game} offeringHosts={offered} />
        </React.Suspense>
      )}
    </>
  );
}

export { GamePage, instancesOfBlueprint };
export default GamePage;
