// leaves.js — the leaf/service vocabulary shared by every surface that shows a KGSM leaf:
// the Services board's cards, the leaf page, and the leaf configuration page. Pure data +
// pure functions, no React and no API.
//
// It lives in lib/ rather than beside any one of those surfaces because all three read it,
// and because `components/LeafCard.jsx` may not import from a page.

// ---- Run state ----------------------------------------------------------
// systemd's own word for the unit, folded to a tone + a label. `idle` (socket-activated,
// resting) is deliberately neutral — it is not a fault — and nothing is green by default:
// an unknown or missing unit is muted, never optimistic.
const SVC_STATE = {
  active:          { tone: "up",   label: "Running" },
  activating:      { tone: "warn", label: "Starting" },
  deactivating:    { tone: "warn", label: "Stopping" },
  reloading:       { tone: "warn", label: "Reloading" },
  maintenance:     { tone: "warn", label: "Maintenance" },
  failed:          { tone: "down", label: "Failed" },
  inactive:        { tone: "off",  label: "Stopped" },
  "not-installed": { tone: "off",  label: "Not installed" },
  masked:          { tone: "off",  label: "Masked" },
  unknown:         { tone: "off",  label: "Unknown" },
};

// The unit's state joined with the api's deep-health probe where it has one. A leaf that is
// up but failing its probe is a warning, not a success — and a leaf the api cannot probe
// keeps its systemd answer rather than being downgraded for a measurement nobody took.
function leafStatus(svc) {
  if (svc.state === "inactive" && svc.onDemand) return { tone: "idle", label: "Idle", note: "on-demand" };
  if (svc.state === "active" && svc.health && svc.health.status === "down")
    return { tone: "warn", label: "Running", note: "health check failing" };
  if (svc.state === "active" && svc.health && svc.health.status === "unknown")
    return { tone: "up", label: "Running", note: "health unknown" };
  return SVC_STATE[svc.state] || SVC_STATE.unknown;
}

// ---- Iconography & kind -------------------------------------------------
// Purely presentational, like LOG_SOURCE_META's labels — the backend serves neither an icon
// nor a category and neither is domain data. A leaf that isn't listed falls back to the
// generic icon and shows no kind at all, so a leaf joining the ecosystem later still renders
// correctly without a frontend change.
const LEAF_ICON = {
  watchdog: "shield",
  monitor: "gauge",
  assistant: "bot",
  firewall: "flame",
  scheduler: "calendar-clock",
  // The clock's counterpart: the scheduler fires on time, this one fires on something happening.
  reactor: "zap",
  bot: "message-circle",
  api: "server-cog",
  // Sound itself rather than a microphone or a speaker: this leaf does both directions, and a
  // mic would name only the half it hears with.
  speech: "audio-lines",
};
const leafIcon = (id) => LEAF_ICON[id] || "box";

// A two-word answer to "what is this thing", above the name. It complements the display name
// rather than repeating it, and it is not the leaf's `role` — that sentence is the card's body.
const LEAF_KIND = {
  watchdog: "supervisor",
  monitor: "metrics",
  assistant: "agent",
  firewall: "host ports",
  scheduler: "jobs",
  reactor: "event rules",
  bot: "chat surface",
  api: "control plane",
  // Both directions, because the name says only one of them: a reader seeing "Speech" would
  // assume it talks, and the same daemon is what listens.
  speech: "hearing & voice",
};
const leafKind = (id) => LEAF_KIND[id] || null;

export { SVC_STATE, leafStatus, LEAF_ICON, leafIcon, LEAF_KIND, leafKind };
