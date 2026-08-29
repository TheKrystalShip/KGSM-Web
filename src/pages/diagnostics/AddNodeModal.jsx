import React from "react";
import { Icon } from "../../components/Icon.jsx";
import { Modal } from "../../components/Modal.jsx";
import { Select } from "../../components/Select.jsx";
import { api } from "../../lib/apiClient.js";
import { addConnection, connectHost, normalizeHostUrl, registryEntry, setAppUser } from "../../lib/connect.js";
import { clusterStore } from "../../lib/stores.js";

// AddNodeModal — the Cluster page's single "Add node" flow. Bringing another
// kgsm-api node into this panel means two independent things at once:
//   1. FEDERATE the backends — POST /peers on ONE node so the two kgsm-api
//      nodes join one gossip mesh/trust domain. That write edits a specific
//      node's peer list, so the flow names it: a sole manageable node is it,
//      and with several the modal asks rather than picking. Admin-only
//      (`canFederate`, the caller's `canOn("host.manage", …)` plus the
//      cluster's own admin standing).
//   2. CONNECT this browser — register the node in the client-side connection
//      registry and resolve a session on it, exactly like `AddHostPage`.
// The two steps are independent and each is reported on honestly: a failure
// in one never masks or blocks the other, and a node that federates but can't
// be reached from this browser right now is shown as exactly that — federated,
// not yet connected — rather than silently dropped or faked as connected.
function AddNodeModal({ federateHosts = [], canFederate, onClose }) {
  const [url, setUrl] = React.useState("");
  // The node whose peer list this federation joins. Preselected only when it is
  // the only choice; beyond that it is named here.
  const [localHostId, setLocalHostId] = React.useState(
    () => (federateHosts.length === 1 ? federateHosts[0].id : null));
  const [nickname, setNickname] = React.useState("");
  const [federate, setFederate] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [step, setStep] = React.useState(null); // null | "federating" | "connecting"
  const [fedError, setFedError] = React.useState(null);
  const [connError, setConnError] = React.useState(null);
  const [federated, setFederated] = React.useState(false); // this URL federated successfully this session
  const [ghosted, setGhosted] = React.useState(false); // federated but unreachable from here

  const normalized = normalizeHostUrl(url);
  // Federating with no node named is not a thing to guess at, so the form waits.
  const needsFederateNode = canFederate && federate && !localHostId;
  const valid = !!normalized && !needsFederateNode;

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setFedError(null);
    setConnError(null);
    setGhosted(false);

    // 1. Federate first (admin + checkbox on + not already done for this URL).
    //    Federation and connection are independent — a federate failure is
    //    surfaced but never blocks the connect attempt that follows.
    let didFederate = federated;
    if (canFederate && federate && localHostId && !federated) {
      setStep("federating");
      try {
        await api.members(localHostId).add(normalized, nickname.trim() || null);
        didFederate = true;
        setFederated(true);
        clusterStore.refresh(localHostId);
      } catch (e) {
        setFedError((e && e.message) || "Couldn't federate with that node.");
      }
    }

    // 2. Connect this browser to it.
    setStep("connecting");
    const res = await connectHost(normalized);
    if (res.status === "ok") {
      addConnection(registryEntry(res.origin, nickname.trim() || res.name, res.hostId));
      setAppUser(res.user); // app-shell identity from /me
      window.location.reload(); // re-eval config → boot connected
      return;
    }
    if (res.status === "needs_auth") {
      // id is null pre-login; a live sibling's post-reload vouch picks this up
      // if (and only if) the node is now a federated peer — otherwise the app
      // honestly surfaces the needs-auth/denied state after reload.
      addConnection(registryEntry(res.origin, nickname.trim() || res.name, null));
      window.location.reload();
      return;
    }

    setBusy(false);
    setStep(null);
    if (res.status === "not_kgsm") {
      setConnError("That address isn't a kgsm-api.");
    } else if (didFederate) {
      // Honest "degrade to ghost": the node still joined the cluster (it'll
      // surface via gossip) even though this browser can't reach it right now.
      setGhosted(true);
    } else {
      setConnError("Couldn't reach that node.");
    }
  };

  const busyLabel = step === "federating" ? "Federating…" : "Connecting…";
  const primaryLabel = busy ? busyLabel : (ghosted ? "Retry connect" : "Add node");

  return (
    <Modal onClose={onClose} canClose={!busy}>
      <div className="modal host-editor">
        <div className="host-editor__head">
          <div className="host-editor__head-icon"><Icon name="waypoints" size={18} /></div>
          <div>
            <h2 className="host-editor__title">Add node</h2>
            <p className="host-editor__sub">Bring another kgsm-api node into this panel — federate it into the cluster and connect this browser to it.</p>
          </div>
          <button className="host-editor__close" onClick={onClose} disabled={busy} aria-label="Close"><Icon name="x" size={16} /></button>
        </div>

        <div className="host-editor__body">
          <label className="host-field">
            <span className="host-field__label">Node URL</span>
            <input
              className="host-field__input host-field__input--mono"
              value={url}
              onChange={(e) => { setUrl(e.target.value); setFederated(false); setGhosted(false); setConnError(null); setFedError(null); }}
              placeholder="https://node.example:8097"
              spellCheck="false" autoCapitalize="off" autoCorrect="off"
              disabled={busy}
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
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

          {canFederate ? (
            <>
              <label className="cluster-addnode-check">
                <input type="checkbox" checked={federate} disabled={busy || federated} onChange={(e) => setFederate(e.target.checked)} />
                <span>Join my cluster (federate)</span>
              </label>
              {federate && federateHosts.length > 1 && (
                <label className="host-field">
                  <span className="host-field__label">Federate through</span>
                  <Select
                    value={localHostId || ""}
                    disabled={busy || federated}
                    onChange={(e) => setLocalHostId(e.target.value || null)}>
                    <option value="">Choose a node…</option>
                    {federateHosts.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                  </Select>
                  <span className="host-field__hint">This node adds the peer; the cluster gossips it to the rest.</span>
                </label>
              )}
            </>
          ) : (
            <div className="cluster-addnode-note">
              <Icon name="info" size={13} />
              <span>Connect-only — federating this node's backend into the cluster needs admin on the local node.</span>
            </div>
          )}

          {fedError && (
            <div className="cluster-addform__err">
              <Icon name="triangle-alert" size={13} />
              <span>Federation: {fedError} Connection is independent and still ran.</span>
            </div>
          )}
          {connError && (
            <div className="cluster-addform__err">
              <Icon name="triangle-alert" size={13} />{connError}
            </div>
          )}
          {ghosted && (
            <div className="cluster-addnode-note cluster-addnode-note--warn">
              <Icon name="radar" size={13} />
              <span>Federated — it joined the cluster and will show up as a discovered peer via gossip. This browser couldn't reach it directly just now; retry the connection once it's reachable.</span>
            </div>
          )}
        </div>

        <div className="host-editor__foot">
          <button className="host-btn host-btn--ghost" onClick={onClose} disabled={busy}>{ghosted || connError ? "Close" : "Cancel"}</button>
          <button className="host-btn host-btn--primary" onClick={submit} disabled={!valid || busy}>
            <Icon name={busy ? "loader" : "plus"} size={14} strokeWidth={2.4} className={busy ? "cluster-spin" : ""} />
            {primaryLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export { AddNodeModal };
export default AddNodeModal;
