import { Icon } from "./Icon.jsx";

// BriefCard — the shared "briefing card" shell used across the panel. A titled
// header (icon + label + optional count chip + optional action) sitting over a
// bordered surface-1 card. The dashboard's Alerts (NeedsAttention) and Recent
// activity cards, plus the server-detail Backups list, all render through this
// one component so the card family stays visually identical and never drifts.
//
// The body is passed as children — a `.chat-brief__list` of rows, a
// `.chat-brief__empty` placeholder, or any custom content (e.g. a grid).
//
// Props:
//   icon, title            — header (icon + label)
//   count, countTone       — optional pill after the title; countTone "neutral"
//                            for a quiet grey chip, omit for the default accent
//   countTitle             — optional tooltip on that pill, for a count that has to
//                            qualify itself (a window, a floor)
//   meta                   — optional muted sub-strip under the header (cadence,
//                            retention, "5 of 10 slots used", …)
//   pin                    — optional header-right NODE, rendered before the action.
//                            The panel passes <PinButton …/>; this file must not import it —
//                            BriefCard is in the standalone assistant's bundle and PinButton
//                            reaches persona through the dashboard store (check:assistant).
//   onViewAll, viewAllLabel— convenience right-side affordance ("View all →")
//   action                 — custom header-right node; when provided it wins
//                            over onViewAll (pass null for nothing)
//   collapsible, open,     — controlled collapse: the whole header becomes the
//   onToggle                 toggle and the body is unmounted when shut. Left
//                            uncontrolled the card renders exactly as before.
//   className, children
function BriefCard({ icon, title, count, countTone, countTitle, meta, pin, onViewAll, viewAllLabel = "View all", action,
  collapsible = false, open = true, onToggle, className = "", children }) {
  const right = action !== undefined
    ? action
    : (onViewAll
        ? (
          <button className="dash-section__more" onClick={onViewAll}>
            {viewAllLabel} <Icon name="arrow-right" size={11} strokeWidth={2.2} />
          </button>
        )
        : null);
  const shut = collapsible && !open;
  const head = (
    <>
      <span className="chat-brief__title">
        {icon && <Icon name={icon} size={13} />} {title}
        {count != null && count !== false && (
          <span className={"chat-brief__count" + (countTone ? " chat-brief__count--" + countTone : "")}
            title={countTitle}>{count}</span>
        )}
      </span>
      {pin}
      {right}
      {collapsible && <Icon name="chevron-down" size={16} className="chat-brief__chev" />}
    </>
  );
  return (
    <div className={"chat-brief" + (shut ? " chat-brief--shut" : "") + (className ? " " + className : "")}>
      {collapsible
        ? (
          <button type="button" className="chat-brief__head chat-brief__head--toggle"
            onClick={onToggle} aria-expanded={open}>
            {head}
          </button>
        )
        : <div className="chat-brief__head">{head}</div>}
      {!shut && meta && <div className="chat-brief__meta">{meta}</div>}
      {!shut && children}
    </div>
  );
}

export { BriefCard };
