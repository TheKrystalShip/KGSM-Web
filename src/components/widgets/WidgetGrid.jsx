import React from "react";

import { WidgetHost } from "./WidgetHost.jsx";
import { GAP_PX, columnsAt, resolveSpan, spanFloor } from "../../lib/widgets/layout.js";
import { getWidget } from "../../lib/widgets/registry.js";

// WidgetGrid — the dashboard's 12-column flow.
//
// A widget declares a column span and a row span; the grid packs them in array order. There is no
// x/y: ORDER IS POSITION. A layout therefore cannot *describe* a hole — but one still appears
// whenever the next widget is too wide for what is left of a row, and that hole is a place a person
// can drop something. So the drag offers two kinds of target: an existing cell (land on it, push it
// along) and a GAP (land in the space itself). Without the second, a widget dragged onto obvious
// empty space took the nearest card's place instead, which is the one gesture the grid has to get
// right.
//
// `grid-auto-flow` stays at its default. `dense` back-fills gaps by pulling later items forward,
// which moves widgets the person did not touch — the layout would rearrange itself as a side effect
// of resizing something else. Filling a gap is a thing somebody DOES, not something the grid does
// behind them.
//
// Drag and resize are pointer-based, the model DashLayout already proved for the vertical bands:
// snapshot the geometry on pointer-down, transform live without re-rendering, decide the outcome
// from the snapshot, commit once on release. Native HTML5 drag-and-drop fires dragenter/dragleave
// erratically over a grid and cannot animate.
//
// TWO THINGS THE SNAPSHOT MODEL DEMANDS, both of which are silent when missed:
//
// The geometry is in VIEWPORT coordinates, and the surface these scroll inside is `.app__main`
// (`overflow-y: auto` at 100vh — the page does NOT scroll on `window`, so `window.scrollY` is always
// zero here). Every comparison therefore folds the live scroll delta in, and the scroller's own
// `scroll` event re-runs the gesture: a wheel scroll emits no pointermove, so without it the dragged
// widget freezes on screen while everything else slides past it.
//
// And a preview written straight onto the element is a DOM mutation React does not know about.
// React diffs against its own previous render, not against the DOM — so when a gesture ends on the
// span it started from, the new render is identical, React writes nothing, and whatever the preview
// left behind stands. Clearing the inline style at the end of a gesture therefore leaves the cell
// with no span at all (`grid-column: auto` — one column). The gesture must hand the element back in
// exactly the state React believes it to be in.

const ROW_PX = 84;   // one row unit, matching --widget-row in kit/widgets.css

// The surface these actually scroll inside — `.app__main`, not the window. Falls back to `window`
// so a surface that does scroll the page still works.
function getScrollParent(node) {
  for (let el = node && node.parentElement; el; el = el.parentElement) {
    const oy = getComputedStyle(el).overflowY;
    if ((oy === "auto" || oy === "scroll" || oy === "overlay") && el.scrollHeight > el.clientHeight) return el;
  }
  return window;
}
function scrollTopOf(sc) { return sc === window ? window.scrollY : sc.scrollTop; }

// The live column count AND the grid's measured width. Both are measured from the grid element
// rather than the window, because the panel's content width also changes with the sidebar
// collapsing and the assistant dock opening — neither of which fires a window resize. The width is
// what turns a widget's pixel floor into a column count (layout.js), so it has to be real.
function useGridMetrics(ref) {
  const [m, setM] = React.useState(() => ({
    cols: columnsAt(typeof window === "undefined" ? 1400 : window.innerWidth),
    gridPx: 0,
  }));
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      // The breakpoints are expressed against viewport width, which is what the CSS ladder in
      // responsive.css keys off — so the two never disagree about which step we are on.
      const cols = columnsAt(window.innerWidth);
      const gridPx = el.clientWidth;
      setM(prev => (prev.cols === cols && Math.abs(prev.gridPx - gridPx) < 1
        ? prev : { cols, gridPx }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); };
  }, [ref]);
  return m;
}

// Where the rows break, and how much room is spare at the end of each.
//
// With non-dense flow a widget that does not fit the remainder wraps to the next row, so spare room
// only ever appears at a row's END — which is why this looks at tails and nothing else.
//
// A gap's INSERT INDEX is the first cell of the next row. That is the array slot whose occupant
// would sit in this gap if it were narrow enough, so moving something there is exactly "put it in
// that space".
function measureRows(nodes, gridRect, cols) {
  const colPx = (gridRect.width - GAP_PX * (cols - 1)) / cols;
  const rows = [];
  nodes.forEach((n, i) => {
    const r = n.getBoundingClientRect();
    const row = rows[rows.length - 1];
    // A new row starts where a cell's top clears the current row's — 1px of slack, because
    // fractional track sizes do not land on whole pixels.
    if (!row || r.top > row.top + 1) {
      rows.push({ top: r.top, bottom: r.bottom, right: r.right, first: i });
    } else {
      row.right = Math.max(row.right, r.right);
      row.bottom = Math.max(row.bottom, r.bottom);
    }
  });

  const gaps = [];
  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri];
    const px = gridRect.right - row.right - GAP_PX;
    // Less than most of a column is rounding, not a gap somebody can aim at.
    if (px < colPx * 0.6) continue;
    gaps.push({
      cols: Math.max(1, Math.round((px + GAP_PX) / (colPx + GAP_PX))),
      index: ri + 1 < rows.length ? rows[ri + 1].first : nodes.length,
      // Kept relative to the grid, because that is what the ghost is positioned against.
      left: row.right + GAP_PX - gridRect.left,
      top: row.top - gridRect.top,
      width: px,
      height: row.bottom - row.top,
    });
  }
  return gaps;
}

function WidgetGrid({ layout, editing, onMove, onResize, onRemove }) {
  const gridRef = React.useRef(null);
  const { cols, gridPx } = useGridMetrics(gridRef);

  const [dragId, setDragId] = React.useState(null);
  const [sizingId, setSizingId] = React.useState(null);
  const [ghost, setGhost] = React.useState(null);
  const drag = React.useRef(null);
  const size = React.useRef(null);

  const floorOf = React.useCallback(
    (type) => spanFloor(getWidget(type), cols, gridPx), [cols, gridPx]);

  // ---- Reorder ----------------------------------------------------------
  // The dragged widget tracks the cursor 1:1. The drop target is whichever candidate CENTRE the
  // cursor is nearest — every cell, plus every gap the dragged widget actually fits. Distance in
  // both axes, not midpoint crossing: with mixed widths there is no single axis the order runs
  // along, so "nearest centre" is the only rule that behaves the same everywhere.
  function onGripDown(id, e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const grid = gridRef.current;
    if (!grid) return;
    const nodes = Array.from(grid.querySelectorAll(".widget-cell"));
    const from = layout.findIndex(w => w.i === id);
    if (from < 0) return;
    const rects = nodes.map(n => n.getBoundingClientRect());
    const gridRect = grid.getBoundingClientRect();
    const span = resolveSpan(layout[from].w, cols, floorOf(layout[from].type));
    const scroller = getScrollParent(grid);

    drag.current = {
      id, from, target: { kind: "cell", i: from }, nodes, rects, gridRect,
      // Only the gaps this widget can actually occupy. Offering one it would overflow would promise
      // a landing the reflow then refuses, which is worse than not offering it.
      gaps: measureRows(nodes, gridRect, cols).filter(g => span <= g.cols),
      startX: e.clientX, startY: e.clientY,
      lastX: e.clientX, lastY: e.clientY,
      scroller, startScroll: scrollTopOf(scroller),
    };
    setDragId(id);
    const dn = nodes[from];
    if (dn) { dn.style.transition = "none"; dn.style.zIndex = "6"; }
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not captured; window listeners still fire */ }
    window.addEventListener("pointermove", onDragMove);
    window.addEventListener("pointerup", onDragUp, { once: true });
    window.addEventListener("pointercancel", onDragUp, { once: true });
    // A wheel or trackpad scroll emits no pointermove. Without this the widget stays pinned where
    // the screen was when the gesture began, while everything it is being aimed at slides away.
    scroller.addEventListener("scroll", onDragScroll, { passive: true });
    e.preventDefault();
  }

  // Re-run the gesture from the current cursor AND scroll position. Called on every pointermove and
  // on every scroll, because either one changes where the cursor is over the layout.
  function applyDrag(st) {
    // The snapshot is in the viewport frame of the moment the drag began. Scrolling moves the
    // content out from under it, so the delta goes into the transform (to keep the widget under the
    // cursor) and into the cursor position (to keep the hit-test honest against the snapshot).
    const scrolled = scrollTopOf(st.scroller) - st.startScroll;
    const dx = st.lastX - st.startX;
    const dy = (st.lastY - st.startY) + scrolled;
    const node = st.nodes[st.from];
    if (node) node.style.transform = "translate(" + dx + "px, " + dy + "px)";

    const px = st.lastX;
    const py = st.lastY + scrolled;

    let best = { kind: "cell", i: st.from }, bestD = Infinity;
    for (let i = 0; i < st.rects.length; i++) {
      const r = st.rects[i];
      const d = (px - (r.left + r.width / 2)) ** 2 + (py - (r.top + r.height / 2)) ** 2;
      if (d < bestD) { bestD = d; best = { kind: "cell", i }; }
    }
    for (let i = 0; i < st.gaps.length; i++) {
      const g = st.gaps[i];
      const cx = st.gridRect.left + g.left + g.width / 2;
      const cy = st.gridRect.top + g.top + g.height / 2;
      const d = (px - cx) ** 2 + (py - cy) ** 2;
      if (d < bestD) { bestD = d; best = { kind: "gap", i }; }
    }

    if (best.kind === st.target.kind && best.i === st.target.i) return;
    st.target = best;
    // Preview the landing. A cell target outlines the cell being displaced; a gap target outlines
    // the SPACE, so "it goes in here" and "it goes where that one is" do not look the same. The
    // outline is the gap rather than the widget's own footprint: the gap is the thing being aimed
    // at, and a small rectangle floating inside a large empty area reads as a second widget.
    st.nodes.forEach((n, i) =>
      n.classList.toggle("widget-cell--drop", best.kind === "cell" && i === best.i && i !== st.from));
    setGhost(best.kind === "gap" ? st.gaps[best.i] : null);
  }

  function onDragMove(e) {
    const st = drag.current;
    if (!st) return;
    st.lastX = e.clientX;
    st.lastY = e.clientY;
    applyDrag(st);
  }

  function onDragScroll() {
    const st = drag.current;
    if (st) applyDrag(st);
  }

  function onDragUp() {
    const st = drag.current;
    window.removeEventListener("pointermove", onDragMove);
    window.removeEventListener("pointerup", onDragUp);
    window.removeEventListener("pointercancel", onDragUp);
    if (st && st.scroller) st.scroller.removeEventListener("scroll", onDragScroll);
    drag.current = null;
    setDragId(null);
    setGhost(null);
    if (!st) return;
    st.nodes.forEach(n => {
      n.style.transform = ""; n.style.zIndex = ""; n.style.transition = "";
      n.classList.remove("widget-cell--drop");
    });
    if (!onMove) return;

    if (st.target.kind === "gap") {
      // `move` splices out before it splices in, so an index measured in the ORIGINAL array is one
      // too high once the dragged widget has left a slot ahead of it.
      const gi = st.gaps[st.target.i].index;
      const to = st.from < gi ? gi - 1 : gi;
      if (to !== st.from) onMove(st.from, to);
      return;
    }
    if (st.target.i !== st.from) onMove(st.from, st.target.i);
  }

  // ---- Resize -----------------------------------------------------------
  // Snapped to whole columns and rows while dragging, and the preview runs through the SAME
  // `resolveSpan` the render does — so what is previewed is exactly what commits, and the widget
  // does not jump to a different width the moment the handle is released.
  function onResizeDown(id, edge, e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const grid = gridRef.current;
    const item = layout.find(w => w.i === id);
    if (!grid || !item) return;
    const cell = grid.querySelector('.widget-cell[data-id="' + id + '"]');
    if (!cell) return;
    const entry = getWidget(item.type);
    const minW = spanFloor(entry, cols, gridPx);
    const minH = (entry && entry.size && entry.size.minH) || 1;
    const colPx = (grid.clientWidth - GAP_PX * (cols - 1)) / cols;
    // Rows are minmax(ROW_PX, auto), so a real track is at LEAST the nominal unit and often more —
    // a card taller than its span grows the rows it sits on. Measuring the tracks keeps one row of
    // drag equal to one row on screen; using the nominal 84px against a 130px track would move the
    // edge a third as far as the cursor and read as a stuck handle.
    const tracks = getComputedStyle(grid).gridTemplateRows.split(" ").map(parseFloat).filter(n => n > 0);
    const rowPx = tracks.length ? tracks.reduce((a, b) => a + b, 0) / tracks.length : ROW_PX;
    const scroller = getScrollParent(grid);

    size.current = {
      id, edge, cell, minW, minH, colPx, rowPx,
      // The span the gesture starts from is the RESOLVED one, not the stored one: dragging a widget
      // that is currently clamped to full width should widen from what is on screen, not from a
      // stored 12 the person cannot see.
      startX: e.clientX, startY: e.clientY,
      startW: resolveSpan(item.w, cols, minW),
      startH: Math.max(1, item.h | 0),
      w: resolveSpan(item.w, cols, minW),
      h: Math.max(1, item.h | 0),
      scroller, startScroll: scrollTopOf(scroller),
    };
    setSizingId(id);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* window listeners still fire */ }
    window.addEventListener("pointermove", onResizeMove);
    window.addEventListener("pointerup", onResizeUp, { once: true });
    window.addEventListener("pointercancel", onResizeUp, { once: true });
    e.preventDefault();
    e.stopPropagation();
  }

  function onResizeMove(e) {
    const st = size.current;
    if (!st) return;
    if (st.edge !== "s") {
      const dCols = Math.round((e.clientX - st.startX) / (st.colPx + GAP_PX));
      // Through resolveSpan, so the floor AND the snap apply live. Clamping to the floor alone let
      // the preview sit at a width the render would immediately change.
      st.w = resolveSpan(st.startW + dCols, cols, st.minW);
    }
    if (st.edge !== "e") {
      // The handle moves with the content, so a scroll mid-gesture is displacement too.
      const dy = (e.clientY - st.startY) + (scrollTopOf(st.scroller) - st.startScroll);
      const dRows = Math.round(dy / (st.rowPx + GAP_PX));
      st.h = Math.max(st.minH, st.startH + dRows);
    }
    st.cell.style.gridColumn = "span " + st.w;
    st.cell.style.gridRow = "span " + st.h;
  }

  function onResizeUp() {
    const st = size.current;
    window.removeEventListener("pointermove", onResizeMove);
    window.removeEventListener("pointerup", onResizeUp);
    window.removeEventListener("pointercancel", onResizeUp);
    size.current = null;
    setSizingId(null);
    if (!st) return;

    // The span is stored as it was dragged, in columns. It is NOT rescaled to twelfths: the render
    // CLAMPS a stored span to the available columns rather than scaling it — which is what gives a
    // w:2 KPI tile its 6/4/3/2-across ladder — so rescaling on the way in and clamping on the way
    // out are two different functions, and the round trip loses the gesture. At 8 columns a drag to
    // 4 became a stored 6 that rendered back at 6, and the resize did nothing at all.
    const stored = Math.max(1, st.w | 0);

    // Hand the element back in the state React believes it to be in, rather than clearing it.
    // The preview above wrote straight to the DOM, which React knows nothing about; React diffs
    // against its own previous render, so a gesture ending on the span it started from produces an
    // identical render, React writes nothing, and a cleared style stays cleared — leaving the cell
    // with no span at all, which is one column.
    st.cell.style.gridColumn = "span " + resolveSpan(stored, cols, st.minW);
    st.cell.style.gridRow = "span " + Math.max(1, st.h | 0);

    if (onResize) onResize(st.id, stored, st.h);
  }

  // Keyboard reorder, so arranging a dashboard never requires a pointer.
  function moveBy(id, delta) {
    const from = layout.findIndex(w => w.i === id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= layout.length) return;
    if (onMove) onMove(from, to);
    requestAnimationFrame(() => {
      const el = gridRef.current && gridRef.current.querySelector('.widget-cell[data-id="' + id + '"] .widget__grip');
      if (el) el.focus();
    });
  }

  return (
    <div
      ref={gridRef}
      className={"widget-grid" + (editing ? " widget-grid--edit" : "") + (dragId ? " widget-grid--dragging" : "")}
      style={{ "--widget-cols": cols }}
    >
      {layout.map((w) => {
        const span = resolveSpan(w.w, cols, floorOf(w.type));
        return (
          <div
            key={w.i}
            data-id={w.i}
            className={"widget-cell"
              + (dragId === w.i ? " widget-cell--dragging" : "")
              + (sizingId === w.i ? " widget-cell--sizing" : "")}
            style={{ gridColumn: "span " + span, gridRow: "span " + Math.max(1, w.h | 0) }}
            onKeyDown={editing ? (e) => {
              if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); moveBy(w.i, -1); }
              else if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); moveBy(w.i, 1); }
            } : undefined}
          >
            <WidgetHost
              descriptor={w}
              editing={editing}
              onRemove={onRemove ? () => onRemove(w.i) : null}
              onGripDown={onGripDown}
              onResize={onResizeDown}
            />
          </div>
        );
      })}

      {/* The space a gap drop would land in. Outside the grid FLOW (absolute), so previewing a
          target never reflows the thing being previewed. */}
      {ghost && (
        <div
          className="widget-gap-ghost"
          style={{ left: ghost.left, top: ghost.top, width: ghost.width, height: ghost.height }}
        />
      )}
    </div>
  );
}

export { GAP_PX, ROW_PX, WidgetGrid };
