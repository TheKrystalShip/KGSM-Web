import { Icon } from "./Icon.jsx";
import { AccountAvatar } from "./AccountAvatar.jsx";
import { LEAF_ICON, leafIcon, leafKind } from "../lib/leaves.js";

// AuditActor — the avatar circle for an audit event's actor. Three cases, in this order:
//
//   a KGSM leaf acting on its own  → the SAME icon the Services board gives that leaf, so one
//                                    glyph means one service on every surface
//   any other autonomous action    → the generic system cog
//   a person                       → an AccountAvatar
//
// The leaf case is checked first because it is the specific one: the generic cog would otherwise
// swallow every named service into one anonymous glyph, and it is `bot` — a leaf in its own right —
// that reads worst when it cannot be told apart from "the system did it".

// leafActorId — the leaf behind an actor, or null. An autonomous actor's `name` IS the leaf id
// (kgsm-api parses `system:watchdog` into `{kind:"system", name:"watchdog"}`), so membership of the
// leaf vocabulary is the whole test. A `discord` provider is excluded up front: that name belongs to
// a real person, and a human who happens to be called "monitor" must never be drawn as the metrics
// leaf. The actor's KIND is deliberately not part of the test — an engine row whose actor carries no
// provider prefix parses to `kind:"user"`/`provider:"system"` (kgsm's OS-user fallback), which is
// what a leaf that stamps a bare name looks like by the time it reaches here.
function leafActorId(actor) {
  if (!actor || actor.provider === "discord") return null;
  const id = String(actor.name || "").trim().toLowerCase();
  return LEAF_ICON[id] ? id : null;
}

// The circle a non-human actor wears — same geometry as AccountAvatar so a mixed feed keeps one
// baseline, with the muted surface/foreground pair that says "not a person".
function ServiceAvatar({ icon, size, title }) {
  return (
    <span style={{
      width: size, height: size, borderRadius: 999,
      background: "var(--surface-3)", color: "var(--fg-3)",
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      flexShrink: 0,
    }} title={title}>
      <Icon name={icon} size={size * 0.55} />
    </span>
  );
}

function AuditActor({ actor, size = 28 }) {
  const leaf = leafActorId(actor);
  if (leaf) {
    return (
      <ServiceAvatar icon={leafIcon(leaf)} size={size}
                     title={leaf + " — KGSM " + (leafKind(leaf) || "service")} />
    );
  }
  if (actor && actor.kind === "system") return <ServiceAvatar icon="cog" size={size} title="System" />;
  // A rule the reactor evaluated. Nobody performed it, so it takes the not-a-person surface rather
  // than an account avatar — which would draw initials for a rule id and read as somebody's name.
  if (actor && actor.kind === "rule") {
    return <ServiceAvatar icon="scale" size={size} title={(actor.name || "a rule") + " — reactor rule"} />;
  }
  return <AccountAvatar user={actor} size={size} />;
}

export { AuditActor };
