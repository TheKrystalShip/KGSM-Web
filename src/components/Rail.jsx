import React from "react";
import { Icon } from "./Icon.jsx";

// Rail — a horizontal, scroll-snapped shelf inside a brief card. The dashboard's
// preview cards use it to reach their WHOLE collection instead of rendering only
// what fits one row.
//
// It is a real scroll container, not a transform carousel, and that is the whole
// point: swipe on touch is native scrolling (momentum, rubber-band, no
// swipe-vs-tap ambiguity against cards that are themselves click targets),
// trackpad and shift-wheel work for free, and tabbing to an off-screen card
// scrolls it into view. The arrows only call `scrollBy` — there is no slide
// index to keep, so nothing can desync from what is on screen.
//
// How many cards fit is decided in CSS, by container query units against
// `--rail-per-view` (see kit/rail.css) — deliberately a FRACTION, so the next
// card is always cut off at the right edge. That peek is the primary "there is
// more" affordance; the arrows and the edge fade are the secondary ones.
//
function Rail({ icon, title, count, pin, onViewAll, viewAllLabel = "View all", items, renderItem, itemKey, disabled = false, variant, ariaLabel }) {
  const trackRef = React.useRef(null);
  // atStart/atEnd drive the arrows' disabled state and which edge fades;
  // `scrollable` is false when everything already fits, which hides the arrows
  // entirely rather than showing two dead buttons.
  const [edge, setEdge] = React.useState({ start: true, end: true, scrollable: false });

  const measure = React.useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const x = el.scrollLeft;
    const next = { start: x <= 1, end: x >= max - 1, scrollable: max > 1 };
    setEdge(prev => (prev.start === next.start && prev.end === next.end && prev.scrollable === next.scrollable) ? prev : next);
  }, []);

  React.useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    // The rail's width changes with the sidebar and the assistant dock, neither
    // of which resizes the window — so observe the track, not `resize`.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", measure); ro.disconnect(); };
  }, [measure, items]);

  const page = (dir) => {
    const el = trackRef.current;
    if (!el || typeof el.scrollBy !== "function") return;
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Just under a full viewport, so the card that was peeking stays in sight and
    // the jump keeps its context.
    el.scrollBy({ left: dir * Math.max(160, el.clientWidth * 0.9), behavior: reduce ? "auto" : "smooth" });
  };

  const showArrows = edge.scrollable && !disabled;

  return (
    <div className={"chat-brief rail" + (variant ? " rail--" + variant : "")} data-disabled={disabled ? "" : undefined}>
      <div className="chat-brief__head">
        <span className="chat-brief__title">
          {icon ? <Icon name={icon} size={13} /> : null} {title}
          {count != null && <span className="chat-brief__count chat-brief__count--neutral">{count}</span>}
        </span>
        <div className="rail__nav">
          {pin}
          {showArrows && (
            <>
              <button
                type="button" className="rail__arrow"
                aria-label={"Scroll " + title + " left"} title="Scroll left"
                disabled={edge.start} onClick={() => page(-1)}
              >
                <Icon name="chevron-left" size={15} strokeWidth={2.2} />
              </button>
              <button
                type="button" className="rail__arrow"
                aria-label={"Scroll " + title + " right"} title="Scroll right"
                disabled={edge.end} onClick={() => page(1)}
              >
                <Icon name="chevron-right" size={15} strokeWidth={2.2} />
              </button>
            </>
          )}
          {onViewAll && (
            <button className="dash-section__more" onClick={onViewAll}>
              {viewAllLabel} <Icon name="arrow-right" size={11} strokeWidth={2.2} />
            </button>
          )}
        </div>
      </div>

      <div
        className="rail__track"
        ref={trackRef}
        role="group"
        aria-label={ariaLabel || title}
        tabIndex={0}
        // Claims the horizontal gesture so useMobileSwipe leaves it alone — a
        // card near the viewport edge sits inside the drawer's edge zone.
        data-hswipe={disabled ? undefined : ""}
        data-start={edge.start ? "" : undefined}
        data-end={edge.end ? "" : undefined}
      >
        {items.map((item, i) => (
          <div className="rail__item" key={itemKey ? itemKey(item) : (item.id ?? i)}>
            {renderItem(item)}
          </div>
        ))}
      </div>
    </div>
  );
}

export { Rail };
export default Rail;
