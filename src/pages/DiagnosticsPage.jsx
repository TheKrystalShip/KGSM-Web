import React from "react";
import { anchoredAlerts, alertsTone } from "../components/ContextualAlerts.jsx";
import { HostConnection } from "../components/ConnectivityBanner.jsx";
import { hostMetricsFreshness } from "../components/HostCardBody.jsx";
import { HostDeniedNotice } from "../components/host-helpers.jsx";
import { Icon } from "../components/Icon.jsx";
import { FleetSkeleton } from "../components/Skeletons.jsx";
import { useAlerts } from "../components/NeedsAttention.jsx";
import { SubTabs } from "../components/SubTabs.jsx";
import { api } from "../lib/apiClient.js";
import { canOn } from "../lib/persona.js";
import { sessionStore } from "../lib/sessionStore.js";
import { useStore } from "../lib/store.js";
import { clusterStore, hostsStore, serversStore, subscribeHostMetrics } from "../lib/stores.js";
import { pingStore, startPingLoop } from "../lib/stores/ui.js";
import { ROUTE_TABS } from "../lib/labels.js";

// Imports from extracted modules
import { AddNodeModal } from "./diagnostics/AddNodeModal.jsx";
import { ClusterConstellation } from "./diagnostics/ClusterConstellation.jsx";
import { ClusterNodeList } from "./diagnostics/ClusterNodeList.jsx";
import { buildClusterNodes } from "./diagnostics/clusterNodes.js";
import { HostEditorModal, RemoveHostDialog } from "./diagnostics/diagComponents.jsx";
import { DiagOverview } from "./diagnostics/DiagOverview.jsx";
import { DiagResources } from "./diagnostics/DiagResources.jsx";
import { DiagServices } from "./diagnostics/DiagServices.jsx";
import { DiagLogs } from "./diagnostics/DiagLogs.jsx";

// Re-export from shared modules so existing consumers don't break.
export { CapacityMeter, HostCapacityStrip, hostCapacityMeters } from "../components/host-helpers.jsx";

function ClusterPage({ focusHostId, tab: tabProp, onTabChange, onFocusHost, onAsk, onRunAlertAction, onOpenServer, onOpenServerSettings, onViewAlerts, onViewAudit, onOpenLeaf }) {
  useAlerts();
  const hosts = useStore(hostsStore, s => s.list);
  const dataLoading = useStore(hostsStore, s => s.status === "loading" && !s.everLoaded);
  const servers = useStore(serversStore, s => s.list);
  const tab = tabProp || "overview";
  const setTab = onTabChange || (() => {});
  const [, setClock] = React.useState(0);
  React.useEffect(() => {
    if (!focusHostId) return;
    const t = setInterval(() => setClock(c => c + 1), 1000);
    return () => clearInterval(t);
  }, [focusHostId]);
  React.useEffect(() => subscribeHostMetrics(focusHostId), [focusHostId]);
  const [editing, setEditing] = React.useState(null);
  const [removing, setRemoving] = React.useState(null);
  const [addingNode, setAddingNode] = React.useState(false);

  // Constellation + node list: federation data enriches the node rows and ping
  // gives the link-latency radius. Both read here once and threaded to the two
  // BriefCards so they render from the exact same merged node array.
  const [hoveredNode, setHoveredNode] = React.useState(null);
  // Peer writes (federate, enable/disable, unfederate) edit ONE node's peer list,
  // which then propagates — so they name the node they act on: the one you have
  // open, else the only one you can manage. With several manageable and none
  // open, the acting node is unset and those controls wait to be told.
  const manageable = hosts.filter(h => canOn("host.manage", h.id));
  const localHostId = (focusHostId && manageable.some(h => h.id === focusHostId))
    ? focusHostId
    : (manageable.length === 1 ? manageable[0].id : null);
  const clusterNodesRaw = useStore(clusterStore, s => s.nodes);
  const clusterAdmin = useStore(clusterStore, s => s.admin);
  const clusterErrored = useStore(clusterStore, s => s.status === "error");
  // "Add node" federates through one node's peer roster (admin-only) as part of
  // the unified add flow. The modal names that node itself — a sole manageable
  // node is it, otherwise it asks — so the flow never guesses where to federate.
  const canFederate = manageable.length > 0 && !!clusterAdmin;
  const pingByHost = useStore(pingStore, s => s.byHost);
  React.useEffect(() => { startPingLoop(); }, []);
  // The roster has ONE owner: cluster discovery keeps clusterStore current for
  // the whole app, at boot and on its own cadence. This page reads it. The
  // per-node peer ACTIONS still re-read the node they mutated — that read is
  // scoped to the node it acted on, not to an ambient one.
  const clusterNodes = React.useMemo(
    () => buildClusterNodes(hosts, clusterNodesRaw, pingByHost, localHostId),
    [hosts, clusterNodesRaw, pingByHost, localHostId]);
  const selectNode = (key) => onFocusHost(key);

  const countFor = (hostId) => servers.filter(s => s.hostId === hostId).length;

  // Editing an existing node's name/region — the only path left through
  // HostEditorModal (bringing a NEW node in goes through AddNodeModal, which
  // federates + connects for real rather than dropping a client-side skeleton).
  const saveHost = (fields) => {
    const id = editing && editing.id;
    if (!id) { setEditing(null); return; }
    hostsStore.update(id, { name: fields.label, region: fields.region || "\u2014" });
    setEditing(null);
    const client = api.host ? api.host(id) : api;
    Promise.resolve(client.patch("/hosts/" + id, { label: fields.label, region: fields.region }))
      .then((updated) => {
        if (updated && updated.id) hostsStore.update(id, { name: updated.name, region: updated.region });
      })
      .catch(() => {});
  };
  const toggleHost = (host) => hostsStore.update(host.id, { online: !host.online, _pending: false });
  const confirmRemove = () => {
    if (!removing) return;
    const id = removing.id;
    hostsStore.remove(id);
    if (focusHostId === id) onFocusHost(null);
    setRemoving(null);
  };
  const menuProps = {
    onEdit: (host) => setEditing(host),
    onToggle: toggleHost,
    onRemove: (host) => setRemoving(host),
  };
  const modals = (
    <>
      {editing && <HostEditorModal host={editing} onSave={saveHost} onClose={() => setEditing(null)} />}
      {removing && <RemoveHostDialog host={removing} serverCount={countFor(removing.id)} onConfirm={confirmRemove} onClose={() => setRemoving(null)} />}
      {addingNode && <AddNodeModal federateHosts={manageable} canFederate={canFederate} onClose={() => setAddingNode(false)} />}
    </>
  );

  if (!hosts.length) {
    return (
      <>
        <div className="dash-head">
          <div className="dash-head__row">
            <h1>Cluster</h1>
            <button className="fb-editor__btn servers-toolbar__new" onClick={() => setAddingNode(true)}>
              <Icon name="plus" size={13} strokeWidth={2.4} />&nbsp;Add node
            </button>
          </div>
          <div className="dash-head__sub">No nodes connected yet.</div>
        </div>
        <div style={{ background: "var(--surface-1)", border: "1px solid var(--border-subtle)", borderRadius: "var(--r-sm)", padding: 60, textAlign: "center", color: "var(--fg-3)" }}>
          <Icon name="server-off" size={28} />
          <div style={{ marginTop: 12, fontSize: 14, color: "var(--fg-2)", fontWeight: 600 }}>No nodes configured</div>
          <div style={{ marginTop: 4, fontSize: 13 }}>Add a node to start aggregating servers and diagnostics.</div>
        </div>
        {modals}
      </>
    );
  }

  if (!focusHostId || !hosts.find(h => h.id === focusHostId)) {
    return (
      <>
        <div className="dash-head">
          <div className="dash-head__row">
            <h1>Cluster</h1>
            <button className="fb-editor__btn servers-toolbar__new" onClick={() => setAddingNode(true)}>
              <Icon name="plus" size={13} strokeWidth={2.4} />&nbsp;Add node
            </button>
          </div>
          <div className="dash-head__sub">Every node this panel talks to — latency topology, capacity and federation health in one place.</div>
        </div>

        {dataLoading ? <FleetSkeleton /> : (
          <>
            <ClusterConstellation
              nodes={clusterNodes}
              hovered={hoveredNode}
              onHover={setHoveredNode}
              onSelect={selectNode}
            />
            <ClusterNodeList
              nodes={clusterNodes}
              hovered={hoveredNode}
              onHover={setHoveredNode}
              onSelect={selectNode}
              hostId={localHostId}
              canManage={!!localHostId}
              admin={clusterAdmin}
              clusterError={clusterErrored}
              menuProps={menuProps}
            />
          </>
        )}
        {modals}
      </>
    );
  }

  const host = hosts.find(h => h.id === focusHostId);

  if (sessionStore.isDenied(host.id)) {
    return (
      <>
        <div className="diag-head">
          <div className="diag-head__title">
            <h1>{host.name}</h1>
            <div className="dash-head__sub">{host.hostname} · {host.region}</div>
          </div>
        </div>
        <HostDeniedNotice host={host} embedded
          onBack={() => onFocusHost(null)} />
        {modals}
      </>
    );
  }

  const headerChrome = (
    <div className="diag-head">
      <div className="diag-head__title">
        <h1>{host.name}</h1>
        <div className="dash-head__sub">{host.hostname} · {host.region} — host machine health, distinct from per-game-server metrics.</div>
      </div>
      {host.online && <HostConnection hostId={host.id} full />}
    </div>
  );

  if (!host.online || host.ram.total_gb === 0) {
    return (
      <>
        {headerChrome}
        <div style={{ background: "var(--surface-1)", border: "1px solid var(--border-subtle)", borderRadius: "var(--r-sm)", padding: 56, textAlign: "center", color: "var(--fg-3)" }}>
          <Icon name="plug-zap" size={26} />
          <div style={{ marginTop: 12, fontSize: 14, color: "var(--fg-2)", fontWeight: 600 }}>{host.name} is {host._pending ? "connecting" : host.online ? "awaiting telemetry" : "disconnected"}</div>
          <div style={{ marginTop: 4, fontSize: 13 }}>{(host._pending || host.online) ? "Waiting for the agent\u2019s first check-in \u2014 diagnostics appear once it reports in." : "Reconnect this host from its \u2026 menu to resume telemetry."}</div>
        </div>
        {modals}
      </>
    );
  }

  const hostAlerts = anchoredAlerts(an => an.surface === "diagnostics" && an.hostId === host.id);
  const fresh = hostMetricsFreshness(host);
  const resourceAlerts = hostAlerts.filter(a => a.anchor.tab === "resources");
  const serviceAlerts  = hostAlerts.filter(a => a.anchor.tab === "services");
  const badge = (items) => items.length ? { badge: items.length, badgeTone: alertsTone(items) } : {};
  // The strip's names and order are shared with the breadcrumb (lib/labels.js); what belongs to this
  // page is the alert count each tab carries.
  const tabBadges = { resources: badge(resourceAlerts), services: badge(serviceAlerts) };
  const tabs = ROUTE_TABS.cluster.map(t => ({ ...t, ...(tabBadges[t.id] || {}) }));

  return (
    <>
      {headerChrome}
      <SubTabs tabs={tabs} active={tab} onChange={setTab} />
      {tab === "overview"  && <DiagOverview host={host} fresh={fresh} onAsk={onAsk} onRun={onRunAlertAction} onViewAlerts={onViewAlerts} onViewAudit={onViewAudit} onViewServices={() => setTab("services")} />}
      {tab === "resources" && <DiagResources host={host} fresh={fresh} servers={servers} onOpenServerSettings={onOpenServerSettings} />}
      {tab === "services"  && <DiagServices host={host} onOpenLeaf={(leaf, leafTab) => onOpenLeaf && onOpenLeaf(host.id, leaf, leafTab)} />}
      {tab === "logs"      && <DiagLogs host={host} />}
      {modals}
    </>
  );
}

export { ClusterPage };
export default ClusterPage;
