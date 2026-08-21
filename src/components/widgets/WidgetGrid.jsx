import React from "react";

import { WidgetHost } from "./WidgetHost.jsx";
import { columnsAt, resolveSpan } from "../../lib/widgets/layout.js";
import { getWidget } from "../../lib/widgets/registry.js";

// WidgetGrid — the dashboard's 12-column flow.
//
// A widget declares a column span and a row span; the grid packs them in array order. There is no
// x/y: ORDER IS POSITION, so a layout cannot describe a hole and a reorder cannot leave one.
//
// `grid-auto-flow` stays at its default. `dense` back-fills gaps by pulling later items forward,
// which moves widgets the person did not touch — the layout would rearrange itself as a side effect
// of resizing something else.
//
// Drag and resize are pointer-based, the model DashLayout already proved for the vertical bands:
// snapshot the geometry on pointer-down, transform live without re-rendering, decide the outcome
// from the snapshot, commit once on release. Native HTML5 drag-and-drop fires dragenter/dragleave
// erratically over a grid and cannot animate.

const ROW_PX = 84;   // one row unit, matching --widget-row in dashboard.css
const GAP_PX = 16;

// The live column count. Measured from the grid element rather than the window, because the panel's
// content width also changes with the sidebar collapsing and the assistant dock opening — neither
// of which fires a window resize.
function useColumns(ref) {
  const [cols, setCols] = React.useState(() => columnsAt(typeof window === "undefined" ? 1400 : window.innerWidth));
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      // The breakpoints are expressed against viewport width, which is what the CSS ladder in
      // responsive.css keys off — so the two never disagree about which step we are on.
      const next = columnsAt(window.innerWidth);
      setCols(prev => (prev === next ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); };
  }, [ref]);
  return cols;
}

function WidgetGrid({ layout, editing, onMove, onResize, onRemove }) {
  const gridRef = React.useRef(null);
  const cols = useColumns(gridRef);

  const [dragId, setDragId] = React.useState(null);
  const [sizingId, setSizingId] = React.useState(null);
  const drag = React.useRef(null);
  const size = React.useRef(null);

  // ---- Reorder ----------------------------------------------------------
  // The dragged widget tracks the cursor 1:1. The drop index is decided by which snapshot CENTRE
  // the cursor is nearest — in both axes, since a 12-column grid puts neighbours beside each other
  // as often as below. Distance, not midpoint crossing: with mixed widths there is no single axis
  // the order runs along, so "nearest centre" is the only rule that behaves the same everywhere.
  function onGripDown(id, e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const grid = gridRef.current;
    if (!grid) return;
    const nodes = Array.from(grid.querySelectorAll(".widget-cell"));
    const from = layout.findIndex(w => w.i === id);
    if (from < 0) return;
    const rects = nodes.map(n => n.getBoundingClientRect());

    drag.current = {
      id, from, to: from, nodes, rects,
      startX: e.clientX, startY: e.clientY,
    };
    setDragId(id);
    const dn = nodes[from];
    if (dn) { dn.style.transition = "none"; dn.style.zIndex = "6"; }
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not captured; window listeners still fire */ }
    window.addEventListener("pointermove", onDragMove);
    window.addEventListener("pointerup", onDragUp, { once: true });
    window.addEventListener("pointercancel", onDragUp, { once: true });
    e.preventDefault();
  }

  function onDragMove(e) {
    const st = drag.current;
    if (!st) return;
    const dx = e.clientX - st.startX;
    const dy = e.clientY - st.startY;
    const node = st.nodes[st.from];
    if (node) node.style.transform = "translate(" + dx + "px, " + dy + "px)";

    // Nearest centre to where the cursor actually is.
    let best = st.from, bestD = Infinity;
    for (let i = 0; i < st.rects.length; i++) {
      const r = st.rects[i];
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const d = (e.clientX - cx) ** 2 + (e.clientY - cy) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best !== st.to) {
      st.to = best;
      // Preview the landing slot on the cell being displaced, so the drop is legible before release.
      st.nodes.forEach((n, i) => n.classList.toggle("widget-cell--drop", i === best && best !== st.from));
    }
  }

  function onDragUp() {
    const st = drag.current;
    window.removeEventListener("pointermove", onDragMove);
    window.removeEventListener("pointerup", onDragUp);
    window.removeEventListener("pointercancel", onDragUp);
    drag.current = null;
    setDragId(null);
    if (!st) return;
    st.nodes.forEach(n => {
      n.style.transform = ""; n.style.zIndex = ""; n.style.transition = "";
      n.classList.remove("widget-cell--drop");
    });
    if (st.to !== st.from && onMove) onMove(st.from, st.to);
  }

  // ---- Resize -----------------------------------------------------------
  // Snapped to whole columns and rows while dragging, so what is previewed is exactly what commits.
  // The preview writes the spans straight onto the element; React re-renders to the same numbers on
  // release, which is why nothing jumps at the end of the gesture.
  function onResizeDown(id, edge, e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const grid = gridRef.current;
    const item = layout.find(w => w.i === id);
    if (!grid || !item) return;
    const cell = grid.querySelector('.widget-cell[data-id="' + id + '"]');
    if (!cell) return;
    const entry = getWidget(item.type);
    const minW = (entry && entry.size && entry.size.minW) || 1;
    const minH = (entry && entry.size && entry.size.minH) || 1;
    const colPx = (grid.clientWidth - GAP_PX * (cols - 1)) / cols;
    // Rows are minmax(ROW_PX, auto), so a real track is at LEAST the nominal unit and often more —
    // a card taller than its span grows the rows it sits on. Measuring the tracks keeps one row of
    // drag equal to one row on screen; using the nominal 84px against a 130px track would move the
    // edge a third as far as the cursor and read as a stuck handle.
    const tracks = getComputedStyle(grid).gridTemplateRows.split(" ").map(parseFloat).filter(n => n > 0);
    const rowPx = tracks.length ? tracks.reduce((a, b) => a + b, 0) / tracks.length : ROW_PX;

    size.current = {
      id, edge, cell, minW, minH, colPx, rowPx,
      startX: e.clientX, startY: e.clientY,
      // The span the gesture starts from is the RESOLVED one, not the stored one: dragging a widget
      // that is currently clamped to full width should widen from what is on screen, not from a
      // stored 12 the person cannot see.
      startW: resolveSpan(item.w, cols, minW),
      startH: Math.max(1, item.h | 0),
      w: resolveSpan(item.w, cols, minW),
      h: Math.max(1, item.h | 0),
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
      st.w = Math.min(cols, Math.max(st.minW, st.startW + dCols));
    }
    if (st.edge !== "e") {
      const dRows = Math.round((e.clientY - st.startY) / (st.rowPx + GAP_PX));
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
    st.cell.style.gridColumn = "";
    st.cell.style.gridRow = "";
    // The width is stored in TWELFTHS, whatever it was dragged at. Storing the resolved span would
    // bake the current breakpoint into the layout: a widget sized on a phone would come back a
    // quarter of the width on a desktop.
    const stored = Math.max(1, Math.round(st.w * 12 / cols));
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
        const entry = getWidget(w.type);
        const minW = (entry && entry.size && entry.size.minW) || 1;
        const span = resolveSpan(w.w, cols, minW);
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
    </div>
  );
}

export { GAP_PX, ROW_PX, WidgetGrid };
