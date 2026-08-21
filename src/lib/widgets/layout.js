// widgets/layout.js — the dashboard layout: what a widget instance IS, how a stored layout is
// validated, and how a span resolves at a given width.
//
// A layout is an ORDERED array of descriptors. Order is position — the grid packs in array order,
// so there is no x/y to keep consistent and no hole to bookkeep.

// ---- The descriptor ------------------------------------------------------
//
//   { i, type, params, w, h, title }
//
//   i       instance id, minted at pin time. The React key. Keying by array index would let a
//           component inherit the state of whichever neighbour it swapped with on a reorder — a
//           console would keep the scrollback of a different server.
//   type    registry key.
//   params  what this instance is bound to ({ hostId, leaf } for a journal). Frozen at pin time:
//           pinning the watchdog's journal pins THAT journal, not "whichever leaf I last opened".
//   w, h    column span in twelfths, row span in row units.
//   title   user override, or null for the registry's own.

let _seq = 0;
// Ids only have to be unique within one layout, and are minted in a browser, so a counter plus the
// clock is enough. crypto.randomUUID is not reachable on a plain-http origin, which the panel can
// be served from on a LAN.
function widgetId() {
  _seq = (_seq + 1) % 0x1000;
  return "w_" + Date.now().toString(36) + "_" + _seq.toString(36);
}

function makeWidget(type, params, size) {
  return {
    i: widgetId(),
    type,
    params: params || {},
    w: (size && size.w) || 12,
    h: (size && size.h) || 3,
    title: null,
  };
}

// ---- The grid ------------------------------------------------------------

const COLUMNS = 12;

// The gutter between cells, matching --widget-gap in kit/widgets.css. It lives here because the
// pixel floor below has to convert a width in pixels into a count of columns, and that sum needs the
// gap: n columns are n tracks PLUS n-1 gutters.
const GAP_PX = 16;

// The narrowest span worth leaving beside a widget. A KPI tile is two columns, so a remainder of two
// can still hold something; anything less can hold nothing and is dead space.
const MIN_USEFUL_COLS = 2;

// The breakpoint ladder, widest first. These are the panel's existing breakpoints (responsive.css),
// and the column counts are chosen so the summary band's hand-tuned tile ladder falls out of the
// span rule rather than being restated: a KPI at w:2 reads 6, 4, 3 and 2 across, which is exactly
// what .dash-summary collapses to today.
const BREAKPOINTS = [
  { minWidth: 1281, cols: 12 },
  { minWidth: 1025, cols: 8 },
  { minWidth: 769, cols: 6 },
  { minWidth: 0, cols: 4 },
];

function columnsAt(width) {
  for (const bp of BREAKPOINTS) if (width >= bp.minWidth) return bp.cols;
  return BREAKPOINTS[BREAKPOINTS.length - 1].cols;
}

// How many columns it takes to be at least `px` wide, at this breakpoint.
//
// A component's real constraint is a WIDTH, not a column count: a console needs about 380px before
// its toolbar stops fitting, and how many columns that buys depends entirely on how wide the grid
// is. Expressing the floor in columns instead bakes one breakpoint's answer into every breakpoint —
// six columns is half a wide grid and the whole of a narrow one, so the same number means two
// different things at the two ends of the ladder.
//
// `gridPx` is the grid's own measured width. Without it (before the first layout pass) there is
// nothing to convert against, so the caller falls back to the column floor.
function columnsForPx(px, cols, gridPx) {
  if (!px || !gridPx || !cols) return 1;
  const colPx = (gridPx - GAP_PX * (cols - 1)) / cols;
  if (!(colPx > 0)) return 1;
  // n columns measure n*colPx + (n-1)*gap, so n >= (px + gap) / (colPx + gap).
  const n = Math.ceil((px + GAP_PX) / (colPx + GAP_PX));
  return Math.min(cols, Math.max(1, n));
}

// The floor for one registry entry, in columns: the wider of its pixel floor and any column floor
// it declares. `minPx` is the honest one and what new entries should use; `minW` stays for the
// widgets whose constraint really is "two columns, whatever that measures" — a KPI tile.
function spanFloor(entry, cols, gridPx) {
  const size = (entry && entry.size) || {};
  const byPx = size.minPx ? columnsForPx(size.minPx, cols, gridPx) : 1;
  const byCol = size.minW ? Math.min(size.minW, cols) : 1;
  return Math.min(cols, Math.max(1, byPx, byCol));
}

// A stored span resolved against the columns actually available.
//
// Two rules. The clamp is obvious. The snap is not: it exists so a widget never leaves a remainder
// too narrow for anything to sit in — a single spare column beside a wide card is dead space no
// arrangement can use, and it reads as a layout bug rather than a choice. A remainder that CAN hold
// something is left alone, because the dashboard can now drop a widget into it.
//
// `floor` is the widget's own minimum in columns, from `spanFloor`: a console squeezed to two
// columns is not a smaller console, it is an unreadable one.
function resolveSpan(w, cols, floor) {
  let out = Math.min(Math.max(1, w | 0), cols);
  if (floor) out = Math.max(out, Math.min(floor, cols));
  if (out < cols && cols - out < MIN_USEFUL_COLS) out = cols;
  return out;
}

// ---- Validation ----------------------------------------------------------
//
// A stored layout is untrusted input: it comes from localStorage or from another device via the
// preference store, it may have been written by an older build, and it may name widget types this
// build no longer has. Anything unreadable is DROPPED rather than repaired into a guess — a widget
// nobody can identify has no honest render.
//
// `isKnownType` is passed in rather than imported so this module stays free of the registry (which
// imports components, and would drag the whole page graph into anything that only wanted to read a
// layout).
function normalizeLayout(raw, isKnownType) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const it of raw) {
    if (!it || typeof it !== "object") continue;
    if (typeof it.type !== "string" || !it.type) continue;
    if (isKnownType && !isKnownType(it.type)) continue;
    const i = typeof it.i === "string" && it.i ? it.i : widgetId();
    if (seen.has(i)) continue;
    seen.add(i);
    out.push({
      i,
      type: it.type,
      params: (it.params && typeof it.params === "object") ? it.params : {},
      w: Number.isFinite(it.w) ? Math.min(COLUMNS, Math.max(1, it.w | 0)) : 12,
      h: Number.isFinite(it.h) ? Math.max(1, it.h | 0) : 3,
      title: typeof it.title === "string" && it.title ? it.title : null,
    });
  }
  return out;
}

// Is this descriptor already on the layout? Identity is (type + params), NOT the instance id: the
// pin button on a card has to answer "is this thing pinned" without knowing which instance would
// represent it.
function sameTarget(a, b) {
  if (!a || !b || a.type !== b.type) return false;
  const pa = a.params || {}, pb = b.params || {};
  const ka = Object.keys(pa), kb = Object.keys(pb);
  if (ka.length !== kb.length) return false;
  return ka.every(k => String(pa[k]) === String(pb[k]));
}

function findTarget(layout, target) {
  return (layout || []).find(w => sameTarget(w, target)) || null;
}

export {
  BREAKPOINTS, COLUMNS, GAP_PX, MIN_USEFUL_COLS,
  columnsAt, columnsForPx, findTarget, makeWidget, normalizeLayout, resolveSpan, sameTarget,
  spanFloor, widgetId,
};
