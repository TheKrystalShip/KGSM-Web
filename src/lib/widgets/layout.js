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

// A stored span resolved against the columns actually available.
//
// Two rules. The clamp is obvious. The snap is not, and is what keeps the narrow end of the ladder
// honest: a half-width card (w:6) clamped into an 8-column grid is six of eight — a 75% widget with
// a quarter column of dead space beside it, which no other width produces and which reads as a
// layout bug rather than a choice. Anything past half the grid takes the whole row instead.
//
// `minW` is the widget's own floor, from the registry: a console squeezed to two columns is not a
// smaller console, it is an unreadable one.
function resolveSpan(w, cols, minW) {
  let out = Math.min(Math.max(1, w | 0), cols);
  if (minW) out = Math.max(out, Math.min(minW, cols));
  if (out > cols / 2) out = cols;
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
  BREAKPOINTS, COLUMNS,
  columnsAt, findTarget, makeWidget, normalizeLayout, resolveSpan, sameTarget, widgetId,
};
