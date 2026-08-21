import { Icon } from "../../../components/Icon.jsx";
import { useNav } from "../../../components/NavContext.jsx";
import { useStore } from "../../../lib/store.js";
import { hostsStore } from "../../../lib/stores.js";
import { DiagLogs } from "../../diagnostics/DiagLogs.jsx";
import { DiagServices } from "../../diagnostics/DiagServices.jsx";

// The node deep-dive's two boards, pinnable.
//
// Both take a host OBJECT; a descriptor can only carry an id, because a layout is JSON that outlives
// the roster it was written against. These resolve the id against the live store — which also gives
// them somewhere honest to report the case their own page never faces: the node has been forgotten.
//
// The bodies are the SAME components the node page renders. Both read stores keyed by host, so a
// board pinned here and the tab it came from share one hydrate and one subscription.

function MissingNode({ hostId, everLoaded, what }) {
  return (
    <div className="proc-unavailable">
      <span className="proc-unavailable__icon">
        <Icon name={everLoaded ? "unlink" : "loader-2"} size={24} strokeWidth={1.9} />
      </span>
      <div className="proc-unavailable__title">
        {everLoaded ? "That node is gone" : "Finding " + hostId + "…"}
      </div>
      <div className="proc-unavailable__sub">
        {everLoaded
          ? `This panel no longer connects to “${hostId}”, so there are no ${what} to read. Remove this widget, or put the node back if it is only unreachable.`
          : "Waiting for the cluster roster."}
      </div>
      <span className="proc-unavailable__tag">
        <Icon name="activity" size={12} /> {everLoaded ? "no such node" : "loading"}
      </span>
    </div>
  );
}

function useHost(hostId) {
  const hosts = useStore(hostsStore, s => s.list);
  const everLoaded = useStore(hostsStore, s => s.everLoaded);
  return { host: hosts.find(h => h.id === hostId) || null, everLoaded };
}

function HostLogsWidget({ hostId }) {
  const { host, everLoaded } = useHost(hostId);
  if (!host) return <MissingNode hostId={hostId} everLoaded={everLoaded} what="journals" />;
  return <DiagLogs host={host} />;
}

function HostServicesWidget({ hostId }) {
  const nav = useNav();
  const { host, everLoaded } = useHost(hostId);
  if (!host) return <MissingNode hostId={hostId} everLoaded={everLoaded} what="services" />;
  return <DiagServices host={host} onOpenLeaf={(h, leaf, tab) => nav.openLeaf(h, leaf, tab)} />;
}

export { HostLogsWidget, HostServicesWidget };
