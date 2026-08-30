// clusterActions.jsx — the admin controls a member row carries, and the two decisions
// they open: what happens to a member, and who holds a capability.
//
// Both decisions are deliberate acts with no automatic equivalent. Nothing promotes
// itself — an automatic failover during a partition produces two members issuing
// conflicting statements about who may do what — and nothing removes a member on its
// behalf. So this is where a person decides, on either card: nodes and anchors are
// different things to look at and the same thing to manage.

import React from "react";
import { Icon } from "../../components/Icon.jsx";
import { Modal } from "../../components/Modal.jsx";
import { api } from "../../lib/apiClient.js";
import { clusterStore } from "../../lib/stores.js";
import { MemberState } from "./clusterBadges.jsx";

// The controls on a member row. Disable is one click because it is reversible from the
// same button; removal opens the dialog, because it is the choice that can be the wrong
// one and it is where the two acts are told apart.
function MemberRowActions({ hostId, member }) {
  const [busy, setBusy] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);
  const stop = (fn) => (e) => { e.stopPropagation(); fn(); };

  const toggle = stop(() => {
    if (busy) return;
    setBusy(true);
    api.members(hostId).setEnabled(member.peerId, member.enabled === false)
      .then(() => clusterStore.refresh(hostId))
      .catch(() => {})
      .finally(() => setBusy(false));
  });

  return (
    <span className="cluster-node-row__actions">
      <button
        className="icon-btn"
        title={member.enabled === false ? "Enable member" : "Disable member"}
        aria-label={member.enabled === false ? "Enable member" : "Disable member"}
        onClick={toggle}
        disabled={busy}
      >
        <Icon name={member.enabled === false ? "power" : "power-off"} size={13} />
      </button>
      <button
        className="icon-btn"
        title="Remove member"
        aria-label="Remove member"
        onClick={stop(() => setRemoving(true))}
        disabled={busy}
      >
        <Icon name="trash-2" size={13} />
      </button>
      {removing && (
        <MemberRemoveDialog hostId={hostId} member={member} onClose={() => setRemoving(false)} />
      )}
    </span>
  );
}

// Remove and disable are different acts on different scopes, and the moment somebody
// is about to pick one is where the difference is worth stating.
//
// REMOVE takes the member out of this node's roster. A member that is still running
// refutes its own removal: it gossips, this node hears a live member it does not have
// a row for, and it comes back. So removal answers "this member is gone" and nothing
// else — the one case where it is final is a member that has already announced its own
// departure, which the dialog reads off the roster rather than assuming.
//
// DISABLE is local and permanent until undone here. This node stops calling the member
// and stops accepting its calls; no gossip and no returning member reverses it. So it
// answers "I no longer trust this member", which survives exactly the situation removal
// does not.
function MemberRemoveDialog({ hostId, member, onClose }) {
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState(null);
  const label = member.label || member.nodeId;
  const departed = member.membership === "left";

  const run = (fn) => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    fn()
      .then(() => { clusterStore.refresh(hostId); onClose(); })
      .catch((e) => { setErr((e && e.message) || "That didn't go through."); setBusy(false); });
  };

  return (
    <Modal onClose={onClose} canClose={!busy}>
      <div className="modal host-remove">
        <div className="host-remove__icon host-remove__icon--danger">
          <Icon name="trash-2" size={20} />
        </div>
        <h2 className="host-remove__title">Remove {label}?</h2>
        <p className="host-remove__text">
          {departed ? (
            <><b>{label}</b> has announced its departure. Removing it clears the record this node
            still holds, and there is nothing running to come back.</>
          ) : (
            <>This takes <b>{label}</b> out of this node&apos;s roster. If it is still running it
            rejoins on its next gossip round.</>
          )}
          {member.enabled !== false && (
            <> Disabling it stops this node calling it instead, holds only here, and nothing in the
            cluster undoes it.</>
          )}
        </p>
        {err && (
          <p className="cluster-dialog__err"><Icon name="triangle-alert" size={13} />{err}</p>
        )}
        <div className="host-remove__foot">
          <button className="host-btn host-btn--ghost" onClick={onClose} disabled={busy}>Cancel</button>
          {member.enabled !== false && (
            <button
              className="host-btn"
              onClick={() => run(() => api.members(hostId).setEnabled(member.peerId, false))}
              disabled={busy}
            >
              <Icon name="power-off" size={14} /> Disable
            </button>
          )}
          <button
            className="host-btn host-btn--danger"
            onClick={() => run(() => api.members(hostId).remove(member.peerId))}
            disabled={busy}
          >
            <Icon name={busy ? "loader" : "trash-2"} size={14} className={busy ? "cluster-spin" : ""} />
            {busy ? "Working…" : "Remove"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// Moving a capability. The candidates are the cluster's members verbatim, each with the
// membership it actually has, because the backend accepts a member that is unreachable
// on purpose: reassigning is what an admin does when the holder is GONE, and refusing on
// liveness would block the operation at the only moment it is needed. Showing the state
// rather than filtering on it leaves that judgement where it belongs.
//
// The local node is absent because a member is never in its own roster, and the backend
// requires the target to be one — so the option it cannot accept is not offered.
//
// Nobody is a real choice and is written as one. It converges as a decision, which is a
// different thing from an assignment nobody has heard about yet.
function CapabilityAssignDialog({ hostId, capability, currentMemberId, members, onClose }) {
  const [choice, setChoice] = React.useState(currentMemberId || "");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState(null);
  const candidates = (members || []).filter(m => m.nodeId);

  const submit = () => {
    if (busy || choice === (currentMemberId || "")) return;
    setBusy(true);
    setErr(null);
    api.members(hostId).assign(capability, choice)
      .then(() => { clusterStore.refresh(hostId); onClose(); })
      .catch((e) => { setErr((e && e.message) || "That didn't go through."); setBusy(false); });
  };

  return (
    <Modal onClose={onClose} canClose={!busy}>
      <div className="modal cluster-assign">
        <h2 className="cluster-assign__title">Holder of <b>{capability}</b></h2>
        <div className="cluster-assign__list" role="radiogroup" aria-label={"Which member holds " + capability}>
          {candidates.map(m => (
            <label
              key={m.nodeId}
              className={"cluster-assign__opt" + (choice === m.nodeId ? " cluster-assign__opt--on" : "")}
            >
              <input
                type="radio"
                name="cluster-assign"
                checked={choice === m.nodeId}
                onChange={() => setChoice(m.nodeId)}
                disabled={busy}
              />
              <span className="cluster-assign__name">{m.label || m.nodeId}</span>
              <span className="cluster-assign__id">{m.nodeId}</span>
              <MemberState membership={m.membership} status={m.status} enabled={m.enabled} />
            </label>
          ))}
          <label className={"cluster-assign__opt" + (choice === "" ? " cluster-assign__opt--on" : "")}>
            <input
              type="radio"
              name="cluster-assign"
              checked={choice === ""}
              onChange={() => setChoice("")}
              disabled={busy}
            />
            <span className="cluster-assign__name">Nobody</span>
            <span className="cluster-assign__id">not served</span>
          </label>
        </div>
        {err && (
          <p className="cluster-dialog__err"><Icon name="triangle-alert" size={13} />{err}</p>
        )}
        <div className="host-remove__foot">
          <button className="host-btn host-btn--ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button
            className="host-btn host-btn--primary"
            onClick={submit}
            disabled={busy || choice === (currentMemberId || "")}
          >
            <Icon name={busy ? "loader" : "anchor"} size={14} className={busy ? "cluster-spin" : ""} />
            {busy ? "Assigning…" : "Assign"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export { MemberRowActions, MemberRemoveDialog, CapabilityAssignDialog };
