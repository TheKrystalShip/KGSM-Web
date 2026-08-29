// ClusterNodeList — the Cluster page's primitive list: one row per connected
// node (hostsStore), in the exact Fleet-Capacity row idiom (`dash-fleet-row*`,
// see DashFleetStrip) so it's pixel-consistent with the dashboard. A row that
// has a federation match additionally shows the membership/status badges and,
// for an admin managing that host's peer roster, inline enable/disable/remove
// actions (ported from ClusterPanel's PeerRow/AddPeerForm). Hover-synced with
// ClusterConstellation via the hovered/onHover/onSelect the page owns.

import React from "react";
import { BriefCard } from "../../components/BriefCard.jsx";
import { alertsTone, anchoredAlerts } from "../../components/ContextualAlerts.jsx";
import { HostMeters, hostHealth } from "../../components/HostCardBody.jsx";
import { Icon } from "../../components/Icon.jsx";
import { api } from "../../lib/apiClient.js";
import { clusterStore } from "../../lib/stores.js";
import { MembershipBadge, membershipRowTone, StatusChip } from "./clusterBadges.jsx";
import { HostMenu } from "./diagComponents.jsx";

// NodeRowActions — enable/disable/remove for a federation-known peer, shown
// only to an admin managing the local host's peer roster (canAct upstream).
function NodeRowActions({ hostId, node }) {
  const [busy, setBusy] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);

  const stop = (fn) => (e) => { e.stopPropagation(); fn(e); };

  const toggle = stop(() => {
    if (busy) return;
    setBusy(true);
    api.members(hostId).setEnabled(node.fed.peerId, !node.fed.enabled)
      .then(() => clusterStore.refresh(hostId))
      .catch(() => {})
      .finally(() => setBusy(false));
  });
  const remove = stop(() => {
    if (busy) return;
    setBusy(true);
    api.members(hostId).remove(node.fed.peerId)
      .then(() => clusterStore.refresh(hostId))
      .catch(() => {})
      .finally(() => { setBusy(false); setConfirming(false); });
  });

  if (confirming) {
    return (
      <span className="cluster-node-row__actions">
        <button className="host-btn host-btn--danger host-btn--sm" onClick={remove} disabled={busy}>Confirm</button>
        <button className="host-btn host-btn--ghost host-btn--sm" onClick={stop(() => setConfirming(false))} disabled={busy}>Cancel</button>
      </span>
    );
  }
  return (
    <span className="cluster-node-row__actions">
      <button className="icon-btn" title={node.fed.enabled ? "Disable peer" : "Enable peer"} aria-label={node.fed.enabled ? "Disable peer" : "Enable peer"} onClick={toggle} disabled={busy}>
        <Icon name={node.fed.enabled ? "power-off" : "power"} size={13} />
      </button>
      <button className="icon-btn" title="Remove peer" aria-label="Remove peer" onClick={stop(() => setConfirming(true))} disabled={busy}>
        <Icon name="trash-2" size={13} />
      </button>
    </span>
  );
}

// GhostNodeRow — a federation peer this SPA holds no connected-host session
// for. Same dash-fleet-row layout as a connected node, but the meter slot is
// replaced by an honest "discovered, not connected" state (never fabricated
// capacity) and the dot's tone comes from federation membership, the only
// axis a ghost has.
function GhostNodeRow({ n, hovered, onHover, onSelect, hostId, canManagePeers }) {
  const isHovered = hovered === n.key;
  const canAct = canManagePeers && !!n.fed.peerId;
  const tone = membershipRowTone(n.fed.membership);
  const latencyLabel = n.latencyMs != null ? Math.round(n.latencyMs) + "ms" : "—";
  return (
    <div
      key={n.key}
      className={"cluster-node-row cluster-node-row--ghost" + (isHovered ? " cluster-node-row--hovered" : "")}
      onMouseEnter={() => onHover(n.key)}
      onMouseLeave={() => onHover(null)}
    >
      <div className={"dash-fleet-row dash-fleet-row--" + tone + " dash-fleet-row--ghost"} onClick={() => onSelect(n.key)}>
        <span className="dash-fleet-row__id">
          <span className={"dash-fleet-row__dot dash-fleet-row__dot--" + tone}></span>
          <span className="dash-fleet-row__name">{n.fed.label}</span>
        </span>
        <span className="dash-fleet-row__offline dash-fleet-row__offline--ghost">
          <Icon name="radar" size={13} /> Discovered · not connected
        </span>
        <span className="dash-fleet-row__end">
          <span className="dash-fleet-row__latency">{latencyLabel}</span>
        </span>
      </div>
      <div className="cluster-node-row__badges">
        <MembershipBadge membership={n.fed.membership} />
        <StatusChip status={n.fed.status} enabled={n.fed.enabled} />
        {n.fed.clientUrl && <span className="cluster-node-row__url">{n.fed.clientUrl}</span>}
        {canAct && <NodeRowActions hostId={hostId} node={n} />}
      </div>
    </div>
  );
}

function ClusterNodeList({ nodes, hovered, onHover, onSelect, hostId, canManage, admin, clusterError, menuProps }) {
  const canManagePeers = canManage && admin;

  return (
    <BriefCard
      icon="server-cog"
      title="Nodes"
      count={nodes.length}
      countTone="neutral"
      meta={clusterError ? "Federation roster unavailable — showing connected nodes only." : null}
    >
      <div className="dash-fleet__rows">
        {nodes.map(n => {
          if (n.ghost) {
            return (
              <GhostNodeRow key={n.key} n={n} hovered={hovered} onHover={onHover} onSelect={onSelect} hostId={hostId} canManagePeers={canManagePeers} />
            );
          }
          const alerts = anchoredAlerts(an => an.surface === "diagnostics" && an.hostId === n.host.id);
          const { denied, metricsDown, meters, tone } = hostHealth(n.host);
          const isHovered = hovered === n.key;
          const canAct = canManagePeers && n.fed && !!n.fed.peerId;
          const latencyLabel = n.ping && n.ping.ms != null ? Math.round(n.ping.ms) + "ms" : "—";
          return (
            <div
              key={n.key}
              className={"cluster-node-row" + (isHovered ? " cluster-node-row--hovered" : "")}
              onMouseEnter={() => onHover(n.key)}
              onMouseLeave={() => onHover(null)}
            >
              <button className={"dash-fleet-row dash-fleet-row--" + tone} onClick={() => onSelect(n.key)}>
                <span className="dash-fleet-row__id">
                  <span className={"dash-fleet-row__dot dash-fleet-row__dot--" + tone}></span>
                  <span className="dash-fleet-row__name">{n.host.name}</span>
                  <span className="dash-fleet-row__region">{n.host.region}</span>
                </span>
                {meters.length ? (
                  <div className="dash-fleet-row__meters">
                    <HostMeters meters={meters} />
                  </div>
                ) : denied ? (
                  <span className="dash-fleet-row__offline dash-fleet-row__offline--denied"><Icon name="lock" size={13} /> No access on this node</span>
                ) : metricsDown ? (
                  <span className="dash-fleet-row__offline dash-fleet-row__offline--metrics"><Icon name="activity" size={13} /> Metrics unavailable</span>
                ) : (
                  <span className="dash-fleet-row__offline"><Icon name={n.host._pending ? "loader" : "moon"} size={13} /> {n.host._pending ? "Awaiting telemetry" : "Disconnected"}</span>
                )}
                <span className="dash-fleet-row__end">
                  <span className="dash-fleet-row__latency">{latencyLabel}</span>
                  {alerts.length > 0
                    ? <span className={"fleet-card__alerts fleet-card__alerts--" + alertsTone(alerts)}><Icon name="triangle-alert" size={11} strokeWidth={2.4} />{alerts.length}</span>
                    : <Icon name="chevron-right" size={16} className="dash-fleet-row__go" />}
                </span>
              </button>
              <div className="cluster-node-row__badges">
                {n.isLocal && (
                  <span className="cluster-chip cluster-chip--local">
                    <Icon name="map-pin" size={10} strokeWidth={2.2} />local
                  </span>
                )}
                {n.fed && <MembershipBadge membership={n.fed.membership} />}
                {n.fed && <StatusChip status={n.fed.status} enabled={n.fed.enabled} />}
                {canAct && <NodeRowActions hostId={hostId} node={n} />}
                <span className="cluster-node-row__spacer" />
                <HostMenu host={n.host} {...menuProps} />
              </div>
            </div>
          );
        })}
        {nodes.length === 0 && (
          <div className="chat-brief__empty">No nodes connected.</div>
        )}
      </div>
    </BriefCard>
  );
}

export { ClusterNodeList };
