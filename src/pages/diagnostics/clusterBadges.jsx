// clusterBadges.jsx — the two federation badge primitives shared by every
// Cluster-page surface (the node list, the constellation's tone mapping, and
// ClusterPanel). Kept in one place so the membership/status vocabulary and its
// tone mapping never drifts between surfaces.

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

export {
  MEMBERSHIP_META, membershipMeta, membershipRowTone, MembershipBadge, StatusChip, DepartedChip,
};
