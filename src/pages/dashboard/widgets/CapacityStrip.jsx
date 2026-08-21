import React from "react";

import { useAssistantDock } from "../../../components/AssistantDockContext.jsx";
import { useNav } from "../../../components/NavContext.jsx";
import { useStore } from "../../../lib/store.js";
import { clusterStore, hostsStore, pingStore } from "../../../lib/stores.js";
import { buildClusterNodes } from "../../diagnostics/clusterNodes.js";
import { DashFleetStrip } from "../DashFleetStrip.jsx";

// CapacityStrip — one mini-meter row per cluster node (connected host + federation "ghost" peers).
//
// Built from the same merge the Cluster page renders from, so the two surfaces cannot drift.
// Capacity cannot be averaged across machines, so it is always one row per node, and no node is
// marked "local": which address this browser was pointed at first says nothing about the cluster, so
// the rows sort by name and read as equals.

function CapacityStrip() {
  const nav = useNav();
  const { askAboutHost } = useAssistantDock();
  const hosts = useStore(hostsStore, s => s.list);
  const pings = useStore(pingStore, s => s.byHost);
  const clusterNodesRaw = useStore(clusterStore, s => s.nodes);

  const nodes = React.useMemo(
    () => buildClusterNodes(hosts, clusterNodesRaw, pings, null),
    [hosts, clusterNodesRaw, pings]);

  return (
    <DashFleetStrip
      nodes={nodes}
      onOpenDiagnostics={() => nav.cluster()}
      onOpenHost={(id) => nav.openHost(id)}
      onOpenServersForNode={(hostId) => nav.serversOnNode(hostId)}
      onOpenNodeLogs={(hostId) => nav.openHostLogs(hostId)}
      onAskAboutNode={askAboutHost}
    />
  );
}

export { CapacityStrip };
export default CapacityStrip;
