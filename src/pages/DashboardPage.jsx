import React from "react";

import { Icon } from "../components/Icon.jsx";
import { ClusterReach } from "../components/host-helpers.jsx";
import { DashboardSkeleton, Skel } from "../components/Skeletons.jsx";
import { WidgetGrid } from "../components/widgets/WidgetGrid.jsx";
import { fleetSummary } from "../lib/servers.js";
import { useStore } from "../lib/store.js";
import { serversStore } from "../lib/stores.js";
import { dashboardStore } from "../lib/widgets/dashboardStore.js";
import { AddWidgetSheet } from "./dashboard/AddWidgetSheet.jsx";
import { DashboardEmpty } from "./dashboard/DashboardEmpty.jsx";
import "./dashboard/catalog.js";   // registering the types is the import's whole job

// DashboardPage — the post-login home, and a surface the user composes.
//
// The page owns almost nothing: a greeting, the Customize affordance, and the grid. Every card on it
// is a WIDGET — the same component its own page renders, pinned here — so this file has no idea what
// is on the dashboard and never needs to. Adding a card to the product does not touch it.
//
// The layout is per-browser (lib/widgets/dashboardStore.js); the widget types are registered by
// ./dashboard/catalog.js; the grid, its drag and its resize are in components/widgets/.

function DashboardPage({ user }) {
  const layout = useStore(dashboardStore, s => s.layout);
  const hydrated = useStore(dashboardStore, s => s.hydrated);
  const servers = useStore(serversStore, s => s.list);
  const dataLoading = useStore(serversStore, s => s.status === "loading" && !s.everLoaded);

  const [customize, setCustomize] = React.useState(false);
  const [adding, setAdding] = React.useState(false);

  // Hydrated on mount rather than at import: the seed filters by what this role may see, and there
  // is no role to read until there is a session.
  React.useEffect(() => { if (!hydrated) dashboardStore.hydrate(); }, [hydrated]);

  // What's up, who's on, and what can't be seen — one line. The counting rules that keep the player
  // figure honest live in lib/servers.js, beside the ones the Servers page reads.
  const summary = fleetSummary(servers);

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 5) return "Late one,";
    if (h < 12) return "Morning,";
    if (h < 18) return "Hey,";
    return "Evening,";
  })();

  return (
    <>
      <div className="dash-head dash-head--actions">
        <div className="dash-head__titles">
          <h1>{greeting} {user?.display || user?.name || "there"}.</h1>
          <div className="dash-head__sub">
            {dataLoading ? <Skel w={300} h={14} /> : summary}
          </div>
          <ClusterReach />
        </div>
        {!dataLoading && (
          <div className={"dash-customize" + (customize ? " dash-customize--on" : "")}>
            {customize && (
              <span className="dash-customize__hint">
                <Icon name="grip-vertical" size={13} strokeWidth={2} /> Drag to move, pull an edge to resize
              </span>
            )}
            {customize ? (
              <>
                <button className="dash-customize__btn" onClick={() => setAdding(true)}>
                  <Icon name="plus" size={14} strokeWidth={2.2} /> Add widget
                </button>
                <button className="dash-customize__btn" onClick={() => dashboardStore.reset()}
                  title="Back to the default dashboard">
                  <Icon name="rotate-ccw" size={14} strokeWidth={2} /> Reset
                </button>
                <button className="dash-customize__btn dash-customize__btn--done" onClick={() => setCustomize(false)}>
                  <Icon name="check" size={14} strokeWidth={2.4} /> Done
                </button>
              </>
            ) : (
              <button className="dash-customize__btn" onClick={() => setCustomize(true)}
                title="Add, move and resize what's on your dashboard">
                <Icon name="layout-dashboard" size={14} strokeWidth={2} /> Customize
              </button>
            )}
          </div>
        )}
      </div>

      {dataLoading
        ? <DashboardSkeleton />
        : layout.length === 0
          ? <DashboardEmpty onAdd={() => { setCustomize(true); setAdding(true); }}
              onRestore={() => dashboardStore.reset()} />
          : <WidgetGrid
              layout={layout}
              editing={customize}
              onMove={(from, to) => dashboardStore.move(from, to)}
              onResize={(id, w, h) => dashboardStore.resize(id, w, h)}
              onRemove={(id) => dashboardStore.unpin(id)}
            />}

      {adding && <AddWidgetSheet onClose={() => setAdding(false)} />}
    </>
  );
}

export { DashboardPage };
export default DashboardPage;
