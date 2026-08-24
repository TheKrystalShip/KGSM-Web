import { Icon } from "./Icon.jsx";

// KPI — the canonical glance card used across the panel: dashboard summary,
// host diagnostics overview, and the server-detail overview stats. One
// component, one set of visuals, so those surfaces never drift apart.
//
// Chrome borrows the briefing-card family (titled header + divider + body) so
// the whole product reads as one set of cards. The card stays calm when healthy
// — `tone` only colors the number when something crosses a threshold — so a
// healthy surface reads quiet and a problem one grabs the eye.
//
// Props:
//   icon, label            — header (icon + uppercase title)
//   value, unit            — the big number and its small trailing unit
//   sub                    — quiet context line under the value
//   tone                   — ok | info | warn | danger | muted (colors value;
//                            surfaces add their own top-hairline accent in CSS)
//   pin                    — optional header NODE (the panel's <PinButton/>), left of
//                            the "View →" affordance
//   onView                 — optional "View →" affordance in the header
//   barPct, barColor       — optional progress meter under the value, for a figure
//                            that IS a share of a whole (the leaf overviews' "N of M
//                            reachable" stats). A count is not one, so a count's card
//                            leaves it out rather than drawing the same fact twice.
//   className              — extra class(es) on the card root (e.g. tagging a
//                            tile as a live-metric gauge for the diag panel)
//   led                    — optional status LED in the header ("live" = solid
//                            green, "down" = solid red); a per-card signal light
//   ledLabel               — optional compact age shown just LEFT of the LED
//                            (e.g. "2m"), for the time since the feed dropped
//   compact                — the dense variant, for a band of twelve rather than
//                            four. Same card, smaller type, and the header's
//                            "View →" becomes the arrow alone: at a sixth of the
//                            row the word is what overflows first, and the card
//                            is clickable in full either way.
const KPI_TONE_COLOR = {
  ok:     "var(--success-fg)",
  info:   "var(--krystal-teal)",
  warn:   "var(--warning-fg)",
  danger: "var(--danger-fg)",
  muted:  "var(--fg-1)",
  off:    "var(--fg-4)",
};

function KPI({ icon, label, value, unit, sub, tone = "muted", pin, onView, barPct, barColor, className, led, ledLabel, compact = false }) {
  return (
    <div className={"chat-brief kpi kpi--" + tone + (compact ? " kpi--compact" : "") + (className ? " " + className : "")}>
      <div className="chat-brief__head">
        <span className="chat-brief__title">{icon && <Icon name={icon} size={compact ? 11 : 12} />} {label}</span>
        {led && (
          <span className="led-group" title={led === "down" ? "No signal" : "Live"}>
            {ledLabel && <span className="led-group__age">{ledLabel}</span>}
            <span className={"status-led status-led--" + led} aria-label={led === "down" ? "No signal" : "Live"}></span>
          </span>
        )}
        {pin}
        {onView && (
          <button className="dash-section__more" onClick={onView} aria-label={compact ? "View " + label : undefined}>
            {!compact && "View "}<Icon name="arrow-right" size={11} strokeWidth={2.2} />
          </button>
        )}
      </div>
      <div className="chat-brief__body kpi__body">
        <div className="tile__val" style={{ color: KPI_TONE_COLOR[tone] }}>
          {value}{unit && <small> {unit}</small>}
        </div>
        {sub && <div className="kpi__sub">{sub}</div>}
        {barPct !== undefined && barPct !== null && (
          <div className="kpi__bar">
            <i style={{ width: Math.max(0, Math.min(100, barPct)) + "%", background: barColor || "var(--krystal-teal)" }}></i>
          </div>
        )}
      </div>
    </div>
  );
}

// Back-compat alias: earlier code referenced Kpi.
const Kpi = KPI;

export { KPI, Kpi };
