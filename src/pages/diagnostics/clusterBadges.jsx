// clusterBadges.jsx — what a member's state looks like, in one place, so no Cluster-page
// surface assembles its own. The Nodes card, the Anchors card and the assignment dialog
// render `MemberState`; the constellation and the fleet strip take the tone mapping the
// same vocabulary produces, so a dot and a badge can never disagree about one member.
//
// The individual chips are the pieces MemberState composes and are deliberately not
// exported: a surface picking two of the three is how a departed member came to state its
// departure three times, in three vocabularies, one of which read as a fault.

import { Icon } from "../../components/Icon.jsx";

// membership (a gossip/liveness axis) -> badge tone + label. Never invented —
// an unrecognized/missing value falls back to the honest "unknown" tone.
const MEMBERSHIP_META = {
  alive:   { tone: "ok",          label: "alive" },
  joining: { tone: "provisional", label: "joining" },
  suspect: { tone: "warn",        label: "suspect" },
  dead:    { tone: "danger",      label: "dead" },
  left:    { tone: "muted",       label: "left" },
  unknown: { tone: "muted",       label: "unknown" },
};

function membershipMeta(membership) {
  return MEMBERSHIP_META[membership] || MEMBERSHIP_META.unknown;
}

// membershipRowTone(membership) — maps the membership badge's tone vocabulary
// ("ok/provisional/warn/danger/muted") onto the dash-fleet-row/-dot modifier
// vocabulary ("success/warn/danger/off") a fleet row's status dot uses, so a
// ghost row (a federation peer with no connected host, hence no measured
// health tone of its own) still gets a meaningful dot color from the ONE axis
// it has: federation membership.
const ROW_TONE_BY_MEMBERSHIP_TONE = { ok: "success", provisional: "warn", warn: "warn", danger: "danger", muted: "off" };
function membershipRowTone(membership) {
  return ROW_TONE_BY_MEMBERSHIP_TONE[membershipMeta(membership).tone] || "off";
}

function MembershipBadge({ membership }) {
  const meta = membershipMeta(membership);
  return (
    <span className={"cluster-badge cluster-badge--" + meta.tone}>
      <span className="cluster-badge__dot"></span>
      {meta.label}
    </span>
  );
}

// status (a separate reachability axis) -> chip. `enabled === false` wins over
// status — a disabled peer is shown as disabled regardless of reachability.
function StatusChip({ status, enabled }) {
  if (enabled === false) {
    return (
      <span className="cluster-chip cluster-chip--disabled">
        <Icon name="power-off" size={11} strokeWidth={2.2} />disabled
      </span>
    );
  }
  if (status === "reachable") {
    return (
      <span className="cluster-chip cluster-chip--ok">
        <Icon name="wifi" size={11} strokeWidth={2.2} />reachable
      </span>
    );
  }
  if (status === "unreachable") {
    return (
      <span className="cluster-chip cluster-chip--danger">
        <Icon name="wifi-off" size={11} strokeWidth={2.2} />unreachable
      </span>
    );
  }
  return (
    <span className="cluster-chip cluster-chip--muted">
      <Icon name="circle-help" size={11} strokeWidth={2.2} />unknown
    </span>
  );
}

// A member that has LEFT is not a member having trouble — it is a tombstone the mesh is
// still carrying so a removal is visible while it propagates, rather than a row that
// disappears here and returns a minute later. It reads as its own thing for that reason:
// "dead" invites someone to go and fix it, and there is nothing to fix.
function DepartedChip({ membership }) {
  if (membership !== "left") return null;
  return (
    <span className="cluster-chip cluster-chip--muted">
      <Icon name="log-out" size={11} strokeWidth={2.2} />removed
    </span>
  );
}

// What state a member is in, as ONE statement, so no surface assembles its own.
//
// A member that is still one has two axes and both are worth showing: what the mesh converged on,
// and what this node's own probe found. They answer different questions and a member can be alive
// to the mesh while this node cannot reach it.
//
// A member that has LEFT has no standing on either. It is unreachable because it went, and printing
// that beside its departure describes a fault to go and fix — which is the reading the departed chip
// exists to prevent, reintroduced by the chips beside it. So departure is the whole answer.
//
// The one thing that still holds for a departed member is an admin's own off switch: the row keeps
// it, so a member that is re-added comes back switched off, and that is a fact about the future
// rather than about a member that is gone.
function MemberState({ membership, status, enabled }) {
  if (membership === "left") {
    return (
      <>
        <DepartedChip membership={membership} />
        {enabled === false && <StatusChip status={status} enabled={enabled} />}
      </>
    );
  }
  return (
    <>
      <MembershipBadge membership={membership} />
      <StatusChip status={status} enabled={enabled} />
    </>
  );
}

export { MEMBERSHIP_META, membershipMeta, membershipRowTone, MemberState };
