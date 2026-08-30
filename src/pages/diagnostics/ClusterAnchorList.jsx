// ClusterAnchorList.jsx — the Anchors card.
//
// A cluster's members are nodes and anchors, and they get separate cards because they are
// separate things. A node runs the engine and game servers, so its row is CPU, memory and a
// live link. An anchor provides ONE capability to the whole cluster and has none of those by
// design — putting it in a card headed "Nodes", beside meters it will never fill, describes
// a node that is failing to report rather than a member doing exactly its job.
//
// The card is absent when there is nothing to say. Most installs are one machine with no
// anchor at all, and an empty card headed "Anchors" invites somebody to go and look for the
// thing that is missing.

import React from "react";
import { BriefCard } from "../../components/BriefCard.jsx";
import { Icon } from "../../components/Icon.jsx";
import { CapabilityAssignDialog, MemberRowActions } from "./clusterActions.jsx";
import { DepartedChip, MembershipBadge, membershipRowTone, StatusChip } from "./clusterBadges.jsx";

// A capability nothing serves. It sits here rather than on the Nodes card because a
// capability is what an anchor holds — and it is the one state this page can report that
// nothing else surfaces: the holder was reaped by the failure timers while the assignment
// survived it, so every member stands by against somebody who will never answer, the
// capability is not served, and nothing errors because from the inside nothing failed.
//
// The member it names is precisely the one that is NOT in the list below, which is why the
// notice has to exist separately from the rows.
function OrphanedCapabilities({ capabilities, canReassign, onReassign }) {
  const orphaned = (capabilities || []).filter(c => c.orphaned);
  if (!orphaned.length) return null;
  return (
    <div className="cluster-orphan" role="status">
      <Icon name="alert-triangle" size={15} />
      <span className="cluster-orphan__text">
        {orphaned.map(c => (
          <span key={c.capability} className="cluster-orphan__line">
            <span>
              <b>{c.capability}</b> is assigned to <b>{c.memberId}</b>, which is no longer a member of
              this cluster. Nothing serves it until it is reassigned
              {canReassign ? "." : ", which an administrator can do."}
            </span>
            {canReassign && (
              <button className="host-btn host-btn--sm" onClick={() => onReassign(c)}>Reassign</button>
            )}
          </span>
        ))}
      </span>
    </div>
  );
}

function AnchorRow({ entry, capability, hovered, onHover, onSelect, hostId, canManage, onReassign }) {
  const fed = entry.fed;
  const isHovered = hovered === entry.key;
  const tone = membershipRowTone(fed.membership);
  const latencyLabel = entry.latencyMs != null ? Math.round(entry.latencyMs) + "ms" : "—";

  return (
    <div
      className={"cluster-node-row" + (isHovered ? " cluster-node-row--hovered" : "")}
      onMouseEnter={() => onHover(entry.key)}
      onMouseLeave={() => onHover(null)}
    >
      <div className={"dash-fleet-row dash-fleet-row--" + tone} onClick={() => onSelect(entry.key)}>
        <span className="dash-fleet-row__id">
          <span className={"dash-fleet-row__dot dash-fleet-row__dot--" + tone}></span>
          <span className="dash-fleet-row__name">{fed.label || fed.nodeId}</span>
        </span>
        <span className="cluster-anchor-row__holds">
          <Icon name="anchor" size={13} />
          {/* What it holds, never what it is. "Anchor" is the card's own heading; the row's
              job is to say WHICH capability, because a cluster can have more than one and an
              anchor holding none is a promotion candidate rather than a broken member. */}
          {capability
            ? <>Holds the cluster&apos;s <b>{capability}</b></>
            : "Holds no capability yet"}
        </span>
        <span className="dash-fleet-row__end">
          <span className="dash-fleet-row__latency">{latencyLabel}</span>
        </span>
      </div>
      <div className="cluster-node-row__badges">
        <DepartedChip membership={fed.membership} />
        <MembershipBadge membership={fed.membership} />
        <StatusChip status={fed.status} enabled={fed.enabled} />
        {fed.clientUrl && <span className="cluster-node-row__url">{fed.clientUrl}</span>}
        {canManage && capability && (
          <button
            className="host-btn host-btn--sm cluster-node-row__cap"
            onClick={(e) => { e.stopPropagation(); onReassign({ capability, memberId: fed.nodeId }); }}
          >
            Move {capability}
          </button>
        )}
        {canManage && !!fed.peerId && <MemberRowActions hostId={hostId} member={fed} />}
      </div>
    </div>
  );
}

function ClusterAnchorList({ anchors, capabilities, members, hovered, onHover, onSelect, hostId, canManage, admin }) {
  const [assigning, setAssigning] = React.useState(null);
  const orphaned = (capabilities || []).filter(c => c.orphaned);
  if (!anchors.length && !orphaned.length) return null;

  const canReassign = canManage && admin && !!hostId;
  const capabilityOf = (memberId) => {
    const held = (capabilities || []).find(c => c.held && c.memberId === memberId);
    return held ? held.capability : null;
  };

  return (
    <BriefCard
      icon="anchor"
      title="Anchors"
      count={anchors.length}
      countTone="neutral"
    >
      <OrphanedCapabilities capabilities={capabilities} canReassign={canReassign} onReassign={setAssigning} />
      <div className="dash-fleet__rows">
        {anchors.map(entry => (
          <AnchorRow
            key={entry.key}
            entry={entry}
            capability={capabilityOf(entry.fed.nodeId)}
            hovered={hovered}
            onHover={onHover}
            onSelect={onSelect}
            hostId={hostId}
            canManage={canReassign}
            onReassign={setAssigning}
          />
        ))}
      </div>
      {assigning && (
        <CapabilityAssignDialog
          hostId={hostId}
          capability={assigning.capability}
          currentMemberId={assigning.memberId}
          members={members}
          onClose={() => setAssigning(null)}
        />
      )}
    </BriefCard>
  );
}

export { ClusterAnchorList };
