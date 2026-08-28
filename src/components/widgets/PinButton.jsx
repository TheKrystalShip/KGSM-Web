import React from "react";

import { Icon } from "../Icon.jsx";
import { useWidgetContext } from "./WidgetHost.jsx";
import { useStore } from "../../lib/store.js";
import { dashboardStore } from "../../lib/widgets/dashboardStore.js";
import { getWidget } from "../../lib/widgets/registry.js";

// PinButton — "put this card on my dashboard", on the card itself.
//
// The pin is the primary way a dashboard gets built: you are already looking at the thing you want,
// and the binding comes from where you are standing. The Add-widget catalog is the secondary route,
// and it can only ever offer the widgets that need no binding — nothing in a list can know which
// leaf's journal you meant.
//
// It is a TOGGLE, not an add: filled means this exact target is already on the dashboard, and
// pressing it takes it off. A separate "unpin" living only on the dashboard would mean pressing the
// same control twice does nothing the second time, with no way to tell from here.
//
// ── Two things about where this can be imported ───────────────────────────
//
// It self-suppresses inside a widget. A pinned card offering to pin itself is a dead control, and
// the host already draws its own remove button while arranging. Doing it HERE rather than in each
// card shell is what keeps the shells from having to know widgets exist.
//
// The card shells take the pin as a NODE (`pin={<PinButton …/>}`), not as a descriptor, and that
// is deliberate: `BriefCard` is reachable from the standalone assistant's bundle, and this module
// reaches `persona` through the dashboard store. A `pin={{type, params}}` prop would force
// `BriefCard` to import this, which fails `npm run check:assistant`. The node form keeps the shells
// pure and the panel-only dependency at the call site, where it belongs.

function PinButton({ type, params, label }) {
  const inWidget = useWidgetContext();
  const layout = useStore(dashboardStore, s => s.layout);
  const hydrated = useStore(dashboardStore, s => s.hydrated);

  // The layout is loaded by the dashboard on mount. A card on some other page is very often the
  // FIRST thing to ask, so ask for it here too rather than rendering a button whose filled/empty
  // state is a guess about a layout nobody has read.
  React.useEffect(() => { if (!hydrated) dashboardStore.hydrate(); }, [hydrated]);

  // Identity is (type + params), not an instance id: this button knows what it points at, never
  // which widget would represent it. Computed before any early return — hooks and the returns that
  // skip them cannot be interleaved, and this is a scan of a handful of descriptors.
  const p = params || {};
  const pinned = layout.some(w => w.type === type
    && Object.keys(p).length === Object.keys(w.params || {}).length
    && Object.keys(p).every(k => String((w.params || {})[k]) === String(p[k])));

  const entry = getWidget(type);
  // Inside a widget the host already draws a remove control, and a card offering to pin itself
  // again is dead. A type this build does not register would pin a widget that renders as "no
  // longer available" the moment the dashboard opens — draw nothing for either.
  if (inWidget || !entry) return null;

  const what = label || entry.label || "this card";

  return (
    <button
      type="button"
      className={"pin-btn" + (pinned ? " pin-btn--on" : "")}
      aria-pressed={pinned}
      title={pinned ? "Remove " + what + " from your dashboard" : "Pin " + what + " to your dashboard"}
      aria-label={pinned ? "Remove " + what + " from your dashboard" : "Pin " + what + " to your dashboard"}
      onClick={(e) => {
        // The header is often inside something clickable (a collapsible card's toggle), and pinning
        // is not opening.
        e.stopPropagation();
        e.preventDefault();
        if (pinned) dashboardStore.unpinTarget(type, params || {});
        else dashboardStore.pin(type, params || {}, entry.size);
      }}
    >
      <Icon name="pin" size={12} strokeWidth={pinned ? 2.4 : 2} />
    </button>
  );
}

export { PinButton };
