// ClusterPanel — the Cluster page's federation panel: the local node plus the
// backend peer roster it federates with, rendered with honest membership/
// status/latency badges and admin peer CRUD. Pure presentational + narrow
// local state (add-form open/busy, per-row busy/confirm flags); all truth
// comes from clusterStore/hostsStore — nothing here is fabricated.
//
// Browser reachability is a SEPARATE, purely local axis: `node.status` is the
// backend's node-to-node reachability, but a cross-node action runs in THIS
// browser and needs the peer directly reachable *from here* — which also
// needs the peer's KGSM_API_CORS_ORIGINS to allow this SPA's origin. That can
// fail independently of backend-reported status, so it's probed client-side
// and held in component-local state, never written into clusterStore.

import React from "react";
import { Icon } from "../../components/Icon.jsx";
import { api } from "../../lib/apiClient.js";
import { canOn } from "../../lib/persona.js";
import { useStore } from "../../lib/store.js";
import { clusterStore, hostsStore } from "../../lib/stores.js";
import { MembershipBadge, StatusChip } from "./clusterBadges.jsx";

// probeReachability — can THIS BROWSER reach the peer directly? A network or
// CORS failure throws (the common case for a misconfigured peer) and is
// treated the same as a non-2xx response: both mean "not usable from here",
// never "the node is down" (that's `node.status`, a different axis).
function probeReachability(clientUrl) {
  const base = clientUrl.replace(/\/+$/, "");
  return fetch(base + "/api/v1", { method: "GET", mode: "cors" })
    .then((res) => (res.ok ? "ok" : "warn"))
    .catch(() => "warn");
}

// ReachWarn — inline, honest indicator for the browser-reachability probe.
// "checking" renders a subtle muted dot, "ok"/undefined render nothing, and
// only "warn" shows the amber flag — distinct from (and shown alongside)
// StatusChip's node-to-node axis.
function ReachWarn({ reach }) {
  if (reach === "warn") {
    return (
      <span
        className="cluster-reach cluster-reach--warn"
        title="Your browser can't reach this peer directly — check the peer allows this origin (KGSM_API_CORS_ORIGINS) and is reachable."
      >
        <Icon name="shield-alert" size={12} strokeWidth={2.2} />
      </span>
    );
  }
  if (reach === "checking") {
    return <span className="cluster-reach cluster-reach--checking" title="Checking browser reachability…"></span>;
  }
  return null;
}

function AddPeerForm({ hostId, onDone, onCancel }) {
  const [url, setUrl] = React.useState("");
  const [nickname, setNickname] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState(null);

  const submit = () => {
    const u = url.trim();
    if (!u || busy) return;
    setBusy(true);
    setErr(null);
    api.members(hostId).add(u, nickname.trim() || null)
      .then(() => { clusterStore.refresh(hostId); onDone(); })
      .catch((e) => setErr((e && e.message) || "Couldn't add that peer."))
      .finally(() => setBusy(false));
  };

  return (
    <div className="cluster-addform">
      <label className="host-field">
        <span className="host-field__label">Peer URL</span>
        <input
          className="host-field__input host-field__input--mono"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://peer.example:8097"
          spellCheck="false"
          autoFocus
          disabled={busy}
        />
      </label>
      <label className="host-field">
        <span className="host-field__label">Nickname <span className="host-field__opt">optional</span></span>
        <input
          className="host-field__input"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          placeholder="e.g. Frankfurt box"
          disabled={busy}
        />
      </label>
      {err && (
        <div className="cluster-addform__err">
          <Icon name="triangle-alert" size={13} />{err}
        </div>
      )}
      <div className="cluster-addform__foot">
        <button className="host-btn host-btn--ghost host-btn--sm" onClick={onCancel} disabled={busy}>Cancel</button>
        <button className="host-btn host-btn--primary host-btn--sm" onClick={submit} disabled={busy || !url.trim()}>
          <Icon name={busy ? "loader" : "plus"} size={13} strokeWidth={2.4} className={busy ? "cluster-spin" : ""} />
          {busy ? "Adding…" : "Add peer"}
        </button>
      </div>
    </div>
  );
}

function PeerRow({ node, hostId, canManage, reach }) {
  const [busy, setBusy] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const canAct = canManage && !!node.peerId;

  const toggle = () => {
    if (busy) return;
    setBusy(true);
    api.members(hostId).setEnabled(node.peerId, !node.enabled)
      .then(() => clusterStore.refresh(hostId))
      .catch(() => {})
      .finally(() => setBusy(false));
  };
  const remove = () => {
    if (busy) return;
    setBusy(true);
    api.members(hostId).remove(node.peerId)
      .then(() => clusterStore.refresh(hostId))
      .catch(() => {})
      .finally(() => { setBusy(false); setConfirming(false); });
  };

  return (
    <div className="cluster-row">
      <div className="cluster-row__id">
        <span className="cluster-row__label">{node.label}</span>
        <span className="cluster-row__nodeid">{node.nodeId}</span>
      </div>
      <MembershipBadge membership={node.membership} />
      <span className="cluster-row__status">
        <StatusChip status={node.status} enabled={node.enabled} />
        <ReachWarn reach={reach} />
      </span>
      <span className="cluster-row__latency">{node.latencyMs != null ? node.latencyMs + " ms" : "—"}</span>
      <span className="cluster-row__url" title={node.clientUrl || ""}>{node.clientUrl || "—"}</span>
      {canAct && (
        <div className="cluster-row__actions">
          {confirming ? (
            <>
              <button className="host-btn host-btn--danger host-btn--sm" onClick={remove} disabled={busy}>Confirm remove</button>
              <button className="host-btn host-btn--ghost host-btn--sm" onClick={() => setConfirming(false)} disabled={busy}>Cancel</button>
            </>
          ) : (
            <>
              <button
                className="icon-btn"
                title={node.enabled ? "Disable peer" : "Enable peer"}
                aria-label={node.enabled ? "Disable peer" : "Enable peer"}
                onClick={toggle}
                disabled={busy}
              >
                <Icon name={node.enabled ? "power-off" : "power"} size={14} />
              </button>
              <button
                className="icon-btn"
                title="Remove peer"
                aria-label="Remove peer"
                onClick={() => setConfirming(true)}
                disabled={busy}
              >
                <Icon name="trash-2" size={14} />
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ClusterPanel({ hostId }) {
  const st = useStore(clusterStore, (s) => s);
  const localHost = useStore(hostsStore, (s) => s.list).find((h) => h.id === hostId);
  const [adding, setAdding] = React.useState(false);
  // reach: nodeId -> "checking"|"ok"|"warn" — purely local, browser-side probe
  // state. NOT clusterStore: it reflects THIS browser's environment (CORS/
  // network), not backend truth, so it never belongs in the shared store.
  const [reach, setReach] = React.useState({});

  React.useEffect(() => {
    if (hostId) clusterStore.refresh(hostId);
  }, [hostId]);

  const nodeIds = st.nodes.map((n) => n.nodeId).join(",");

  // Probe each peer's clientUrl directly from the browser, keyed on the
  // roster's node-id set (not the array reference, which churns every poll).
  // `live` guards every setState against a race with unmount or a roster
  // change firing a new effect before a stale probe resolves.
  React.useEffect(() => {
    let live = true;
    const targets = st.nodes.filter((n) => n.clientUrl);
    if (targets.length > 0) {
      setReach((prev) => {
        const next = { ...prev };
        targets.forEach((n) => { next[n.nodeId] = "checking"; });
        return next;
      });
      targets.forEach((n) => {
        probeReachability(n.clientUrl).then((result) => {
          if (!live) return;
          setReach((prev) => ({ ...prev, [n.nodeId]: result }));
        });
      });
    }
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the nodeIds string on purpose; st.nodes is read fresh from closure, not tracked by identity
  }, [nodeIds]);

  if (!hostId) return null;

  const canManage = canOn("host.manage", hostId) && !!st.admin;
  const loading = (st.status === "loading" || st.status === "idle") && !st.everLoaded;

  return (
    <section className="cluster-panel">
      <div className="cluster-panel__head">
        <div>
          <h2 className="cluster-panel__title">Cluster</h2>
          <p className="cluster-panel__sub">This node and the peers it federates with.</p>
        </div>
        {canManage && !adding && (
          <button className="host-btn host-btn--ghost host-btn--sm" onClick={() => setAdding(true)}>
            <Icon name="plus" size={13} strokeWidth={2.4} />Add peer
          </button>
        )}
      </div>

      {canManage && adding && (
        <AddPeerForm hostId={hostId} onDone={() => setAdding(false)} onCancel={() => setAdding(false)} />
      )}

      {localHost && (
        <div className="cluster-row cluster-row--local">
          <div className="cluster-row__id">
            <span className="cluster-row__label">{localHost.name}</span>
            <span className="cluster-row__nodeid">{localHost.hostname}</span>
          </div>
          <span className="cluster-chip cluster-chip--local">
            <Icon name="map-pin" size={11} strokeWidth={2.2} />local
          </span>
        </div>
      )}

      {loading && (
        <div className="cluster-panel__loading">
          <Icon name="loader" size={14} className="cluster-spin" />Loading cluster…
        </div>
      )}

      {st.status === "error" && (
        <div className="cluster-panel__error">
          <Icon name="triangle-alert" size={14} />
          <span>Couldn't load cluster peers.</span>
          <button className="host-btn host-btn--ghost host-btn--sm" onClick={() => clusterStore.refresh(hostId)}>Retry</button>
        </div>
      )}

      {st.status === "ready" && st.nodes.length === 0 && (
        <div className="cluster-panel__empty">
          <Icon name="waypoints" size={22} />
          <div>This node isn't federated with any peers yet.</div>
        </div>
      )}

      {st.status === "ready" && st.nodes.length > 0 && (
        <div className="cluster-panel__rows">
          {st.nodes.map((n) => (
            <PeerRow key={n.nodeId} node={n} hostId={hostId} canManage={canManage} reach={reach[n.nodeId]} />
          ))}
        </div>
      )}
    </section>
  );
}

export { ClusterPanel };
export default ClusterPanel;
