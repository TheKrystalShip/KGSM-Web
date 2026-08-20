import React from "react";

// TimeSeriesChart — bare-SVG multi-series line chart with optional fill,
// grid lines, anomaly bands, a comparison series (dashed), a "current value"
// dot at the rightmost point, and a hover crosshair + tooltip.
//
// props.series    : [{ key, color, fill?, values: (number|null)[], label?, fmt? }]
//                   label/fmt are used by the hover tooltip (fmt(scaledValue)
//                   → display string); they default to key / a plain number.
//                   A non-finite value (null / undefined / NaN) is an ABSENT
//                   measurement: it is left out of the y-domain, breaks the line
//                   and its fill, and reads "—" in the tooltip. It is never a zero.
// props.times     : optional number[] (epoch ms | s | ISO) parallel to the
//                   primary series — the tooltip's timestamp header.
// props.compare   : optional { label, values: number[] }  — drawn as a
//                   faded dashed line behind the main series.
// props.anomalies : optional [{ start, end, peakIdx, peakValue, ... }]
//                   — windows highlighted in a soft amber band on the chart.
// props.height    : px
// props.range     : "live" | "1h" | "24h" | "7d" | "30d"
// props.yMin / yMax : optional bounds; auto-computed if missing
//
// SYNCED HOVER: wrap a group of charts in <ChartHoverProvider> and hovering any
// one broadcasts the cursor's data-fraction (0..1 across the time domain) to
// every chart in the group, so a single crosshair tracks the SAME instant
// across the whole grid — the way Grafana correlates a CPU spike with the I/O
// spike at that timestamp. Outside a provider each chart keeps its own local
// hover state, so it still gets a tooltip standalone.

// Geometry — kept in module scope because the hover overlay maps pointer-x →
// data index using the SAME insets the SVG draws with.
const VB_W = 600;
const PAD_L = 30, PAD_R = 12, PAD_T = 8, PAD_B = 22;

const ChartHoverContext = React.createContext(null);

// A measurement is present only when it is a finite number. null / undefined / NaN
// mean "not measured", and every consumer below drops such a point rather than
// drawing it — an absent sample must never appear on the axis as a zero.
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

// Shared bus for a group of charts: one crosshair instant (frac) AND one zoom
// window (zoom = [ms0, ms1] | null) across all of them, so dragging a region on
// any chart narrows the time domain on the whole grid in lockstep. Hover is owned
// here (uncontrolled); zoom is threaded from the owner (PerformanceTab) so it can
// render the reset affordance and clear it on range/server change.
function ChartHoverProvider({ children, zoom = null, onZoom }) {
  const [frac, setFrac] = React.useState(null);
  const value = React.useMemo(
    () => ({ frac, setFrac, zoom, setZoom: onZoom || null }),
    [frac, zoom, onZoom]);
  return <ChartHoverContext.Provider value={value}>{children}</ChartHoverContext.Provider>;
}

function toMs(ts) {
  if (ts == null) return null;
  if (typeof ts === "number") return ts < 1e12 ? ts * 1000 : ts;   // seconds vs ms
  const p = Date.parse(ts);
  return isNaN(p) ? null : p;
}

const pad2 = (n) => String(n).padStart(2, "0");

// Tooltip time header — clock for short ranges, +date for multi-day.
function fmtTipTime(ts, range) {
  const ms = toMs(ts);
  if (ms == null) return null;
  const d = new Date(ms);
  if (range === "7d" || range === "30d") {
    const mon = d.toLocaleString(undefined, { month: "short" });
    return `${mon} ${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

const defaultFmt = (v) => (v == null || !isFinite(v) ? "—" : v >= 1000 ? Math.round(v) + "" : v.toFixed(1));

// Lifecycle-event marker colour, by the same tone vocabulary the audit log uses.
function toneColor(tone) {
  return ({ success: "var(--success)", danger: "var(--danger)", update: "var(--update)", info: "var(--info)", warn: "var(--warning)" })[tone] || "var(--fg-3)";
}

// Live x-axis labels for a rolling window. The window holds N points at ~1 Hz, so
// it spans ~(N-1) seconds — label the left edge with that span ("-90s" / "-2m"),
// the midpoint, and "now". Pass windowSec to override the 1 Hz assumption.
function liveXTicks(N, windowSec) {
  const spanS = windowSec != null ? windowSec : Math.max(0, N - 1);
  if (spanS < 5) return [{ i: 1, l: "now" }];   // seed-only / just-opened: don't label a sub-5s window
  const fmt = (s) => s <= 0 ? "now" : s >= 90 ? "-" + Math.round(s / 60) + "m" : "-" + Math.round(s) + "s";
  return [{ i: 0, l: fmt(spanS) }, { i: 0.5, l: fmt(spanS / 2) }, { i: 1, l: "now" }];
}

// Absolute clock ticks across an explicit [ms0, ms1] domain — used when a chart is
// zoomed (the preset "-30m/-15m" labels no longer describe the narrowed window).
function timeAxisTicks(ms0, ms1) {
  const spanH = (ms1 - ms0) / 3600e3;
  const multi = spanH > 24;
  const fmt = (ms) => {
    const d = new Date(ms);
    return multi
      ? `${d.toLocaleString(undefined, { month: "short" })} ${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
      : `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  };
  return [0, 0.25, 0.5, 0.75, 1].map(i => ({ i, l: fmt(ms0 + i * (ms1 - ms0)) }));
}

function TimeSeriesChart({ series, height = 120, range = "24h", yMin, yMax, yLabel, anomalies, compare, windowSec, band, times, domain, events, stepSec, yScale = "linear" }) {
  const W = VB_W;
  const H = height;
  const padL = PAD_L, padR = PAD_R, padT = PAD_T, padB = PAD_B;
  const plotW = W - padL - padR;
  const clipId = "tsc" + React.useId().replace(/:/g, "");   // per-chart clip (colon-free for url(#…))

  // Domain over measured points only — an absent sample carries no magnitude and
  // must not pull the axis toward zero.
  const allVals = series.flatMap(s => s.values).concat(compare?.values || []).filter(isNum);
  const min = yMin != null ? yMin : Math.min(...allVals, 0);
  const max = yMax != null ? yMax : Math.max(...allVals, 1);

  // Y scale — linear, or a zero-safe log (log1p, so an idle 0 sits at the axis and
  // an order-of-magnitude spike stays readable instead of flattening the baseline).
  const logY = yScale === "log";
  const tv = logY ? (v) => Math.log1p(Math.max(0, v)) : (v) => v;
  const tMin = tv(min), tMax = tv(max);
  const tSpan = (tMax - tMin) || 1;
  const yValueAt = (yPx) => {
    const f = 1 - (yPx - PAD_T) / (H - PAD_T - PAD_B);   // 0 at bottom … 1 at top
    const t = tMin + f * tSpan;
    return logY ? Math.expm1(t) : t;
  };

  const N = series[0]?.values.length || 0;

  // ---- Shared bus: hover crosshair + zoom window across the grid ----
  const shared = React.useContext(ChartHoverContext);
  const [localFrac, setLocalFrac] = React.useState(null);
  const frac = shared ? shared.frac : localFrac;
  const setFrac = shared ? shared.setFrac : setLocalFrac;
  const interactive = N >= 2;

  // Time axis (historical only): position points by real timestamp within a shared
  // domain, so downtime opens a proportional gap and lifecycle markers land at the
  // right wall-clock x. Live stays index-based (uniform ~1 Hz, gap-free).
  const tms = (times && times.length === N) ? times.map(toMs) : null;
  const useTimeAxis = range !== "live" && tms && N >= 2;
  const fullD0 = useTimeAxis ? (domain ? toMs(domain[0]) : tms[0]) : 0;
  const fullD1 = useTimeAxis ? (domain ? toMs(domain[1]) : tms[N - 1]) : 1;

  // Drag-to-zoom (#4): the effective domain is the shared zoom window when set,
  // else the full range. Zoom is a pure client-side view transform over the data
  // already fetched — for the raw tier (15s samples) it recovers real detail that
  // the full-range view compresses. Only meaningful on the time axis.
  const canZoom = useTimeAxis && shared && typeof shared.setZoom === "function";
  const zoomWin = (canZoom && shared.zoom) || null;
  const d0 = zoomWin ? zoomWin[0] : fullD0;
  const d1 = zoomWin ? zoomWin[1] : fullD1;
  const dspan = (d1 - d0) || 1;
  const sxT = (ms) => padL + ((ms - d0) / dspan) * plotW;
  const sx = (i) => useTimeAxis ? sxT(tms[i]) : padL + (i / Math.max(1, N - 1)) * plotW;
  const sy = (v) => padT + (1 - (tv(v) - tMin) / tSpan) * (H - padT - padB);

  // Gap breaks — a sample delta beyond 2.5× the step is downtime: break the line
  // there (never interpolate across a gap) and close the fill per-segment.
  const gapThr = useTimeAxis && stepSec ? stepSec * 1000 * 2.5 : Infinity;
  const breaks = new Set();
  if (isFinite(gapThr)) for (let i = 1; i < N; i++) if (tms[i] - tms[i - 1] > gapThr) breaks.add(i);

  // The drawable runs of a series: contiguous indices carrying a measured value.
  // An unmeasured point is dropped and ends the run, so the line and its fill open
  // a gap there instead of diving to the axis. Downtime (a `breaks` index) opens the
  // same gap in every series; an unmeasured value opens it only where it occurs.
  const runsOf = (values, applyGaps = true) => {
    const segs = []; let cur = [];
    for (let i = 0; i < values.length; i++) {
      if (!isNum(values[i])) { if (cur.length) { segs.push(cur); cur = []; } continue; }
      if (applyGaps && breaks.has(i) && cur.length) { segs.push(cur); cur = []; }
      cur.push(i);
    }
    if (cur.length) segs.push(cur);
    return segs;
  };

  const leftInset = padL / W;
  const plotFrac = plotW / W;
  const fracAt = (clientX, rect) => {
    let df = ((clientX - rect.left) / rect.width - leftInset) / plotFrac;
    return df < 0 ? 0 : df > 1 ? 1 : df;
  };

  // Drag selection (local — only the releasing chart commits to the shared zoom).
  const [drag, setDrag] = React.useState(null);   // { a, b } plot fractions, or null
  const onDown = (e) => { if (canZoom && e.button === 0) { const f = fracAt(e.clientX, e.currentTarget.getBoundingClientRect()); setDrag({ a: f, b: f }); } };
  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const f = fracAt(e.clientX, rect);
    setFrac(f);
    if (drag) setDrag(d => d ? { ...d, b: f } : d);
  };
  const commitZoom = () => {
    if (drag && canZoom) {
      const lo = Math.min(drag.a, drag.b), hi = Math.max(drag.a, drag.b);
      if (hi - lo > 0.02) shared.setZoom([d0 + lo * dspan, d0 + hi * dspan]);   // map within the CURRENT domain (zoom-in-zoom ok)
    }
    setDrag(null);
  };
  const onLeave = () => { setFrac(null); setDrag(null); };
  const onDouble = () => { if (canZoom && zoomWin) shared.setZoom(null); };

  // Nearest sample to the cursor — by index on the uniform live axis, by x-distance
  // on the time axis (so it honours gaps and uneven spacing).
  let hoverIdx = null;
  if (frac != null && N > 0 && !drag) {
    if (!useTimeAxis) hoverIdx = Math.min(N - 1, Math.max(0, Math.round(frac * (N - 1))));
    else {
      const targetX = padL + frac * plotW;
      let bd = Infinity;
      for (let i = 0; i < N; i++) { const dx = Math.abs(sx(i) - targetX); if (dx < bd) { bd = dx; hoverIdx = i; } }
    }
  }
  const hoverXPct = hoverIdx == null ? null : (sx(hoverIdx) / W) * 100;

  const gridYs = [0, 0.5, 1].map(p => padT + p * (H - padT - padB));

  const xTicks = range === "live" ? liveXTicks(N, windowSec)
    : zoomWin ? timeAxisTicks(d0, d1)
    : ({
    "1h":  [{ i: 0, l: "-60m" }, { i: 0.25, l: "-45" }, { i: 0.5, l: "-30" }, { i: 0.75, l: "-15" }, { i: 1, l: "now" }],
    "24h": [{ i: 0, l: "-24h" }, { i: 0.25, l: "-18" }, { i: 0.5, l: "-12" }, { i: 0.75, l: "-6" }, { i: 1, l: "now" }],
    "7d":  [{ i: 0, l: "-7d" },  { i: 0.5, l: "-3d" },  { i: 1, l: "now" }],
    "30d": [{ i: 0, l: "-30d" }, { i: 0.5, l: "-15d" }, { i: 1, l: "now" }],
  }[range] || []);

  const fmtY = (v) => {
    if (max > 1000) return Math.round(v) + "";
    if (max > 100)  return v.toFixed(0);
    return v.toFixed(1);
  };

  return (
    <div className="tschart" style={{ height: H }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: H, display: "block" }} preserveAspectRatio="none">
        <defs>
          <clipPath id={clipId}><rect x={padL} y={padT} width={plotW} height={H - padT - padB} /></clipPath>
        </defs>

        {/* Gridlines + Y labels */}
        {gridYs.map((y, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={y} y2={y} stroke="var(--border-subtle)" strokeWidth="1" />
            <text x={padL - 6} y={y + 3} fill="var(--fg-4)" fontSize="9" fontFamily="var(--font-mono)" textAnchor="end">
              {fmtY(yValueAt(y))}
            </text>
          </g>
        ))}

        {/* X labels */}
        {xTicks.map((t, i) => (
          <text key={i}
            x={padL + t.i * (W - padL - padR)}
            y={H - 6}
            fill="var(--fg-4)" fontSize="9" fontFamily="var(--font-mono)"
            textAnchor={i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"}>
            {t.l}
          </text>
        ))}

        {/* All data marks clip to the plot box — so a zoomed (narrowed) domain that
            pushes points past the edges crops cleanly instead of spilling. */}
        <g clipPath={`url(#${clipId})`}>
          {/* Anomaly bands — soft amber rectangles over the threshold-crossing windows. */}
          {anomalies && anomalies.map((a, i) => {
            const x1 = sx(a.start);
            const x2 = sx(a.end);
            return (
              <rect key={"an" + i}
                x={x1} y={padT}
                width={Math.max(2, x2 - x1)}
                height={H - padT - padB}
                fill="var(--warning)" opacity="0.13" />
            );
          })}

          {/* Comparison series — dashed, faded, sits below the main line. */}
          {compare && compare.values && (() => {
            const d = runsOf(compare.values, false)
              .map(seg => seg.map((i, k) => `${k === 0 ? "M" : "L"} ${sx(i)} ${sy(compare.values[i])}`).join(" "))
              .join(" ");
            return (
              <path d={d}
                fill="none"
                stroke="var(--fg-3)"
                strokeWidth="1.2"
                strokeDasharray="3 4"
                strokeLinejoin="round"
                strokeLinecap="round"
                opacity="0.6" />
            );
          })()}

          {/* Min/max band — filled polygon between the min and max arrays (rollup tier). */}
          {band && band.min && band.max && band.min.length === N && (() => {
            // One closed polygon per run of buckets that carry both bounds; a bucket
            // missing either one ends the polygon, so the band opens the same gap the
            // line does rather than spanning an unmeasured stretch.
            const segs = []; let cur = [];
            for (let i = 0; i < N; i++) {
              if (isNum(band.min[i]) && isNum(band.max[i])) cur.push(i);
              else if (cur.length) { segs.push(cur); cur = []; }
            }
            if (cur.length) segs.push(cur);
            const d = segs.map(seg => {
              const upper = seg.map(i => `${sx(i)} ${sy(band.max[i])}`).join(" L ");
              const lower = seg.map(i => `${sx(i)} ${sy(band.min[i])}`).reverse().join(" L ");
              return `M ${upper} L ${lower} Z`;
            }).join(" ");
            return <path d={d} fill={band.color || "var(--krystal-teal)"} opacity="0.10" />;
          })()}

          {/* Series — fills first so they sit under the lines. Both break at gaps
              (downtime and unmeasured points) instead of drawing a misleading line
              across the absent span. */}
          {series.map((s, idx) => {
            if (!s.fill) return null;
            const d = runsOf(s.values).map(seg =>
              seg.map((i, k) => `${k === 0 ? "M" : "L"} ${sx(i)} ${sy(s.values[i])}`).join(" ")
              + ` L ${sx(seg[seg.length - 1])} ${sy(min)} L ${sx(seg[0])} ${sy(min)} Z`
            ).join(" ");
            return <path key={"fill-" + idx} d={d} fill={s.color} opacity="0.12" />;
          })}
          {series.map((s, idx) => {
            const d = runsOf(s.values).map(seg =>
              seg.map((i, k) => `${k === 0 ? "M" : "L"} ${sx(i)} ${sy(s.values[i])}`).join(" ")
            ).join(" ");
            return <path key={"ln-" + idx} d={d} fill="none" stroke={s.color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />;
          })}

          {/* Lifecycle event guides (#3) — dashed vertical lines at real wall-clock x. */}
          {useTimeAxis && events && events.map((ev, i) => {
            const x = sxT(toMs(ev.t));
            if (x < padL - 0.5 || x > W - padR + 0.5) return null;
            return <line key={"ev" + i} x1={x} x2={x} y1={padT} y2={H - padB}
              stroke={toneColor(ev.tone)} strokeWidth="1" strokeDasharray="3 3" opacity="0.5" />;
          })}

          {/* Current-value dot on the last point (hidden by the clip when zoomed past it).
              A series whose last sample is unmeasured has no current value, so it gets
              no dot rather than one parked on the axis. */}
          {series.map((s, idx) => {
            const v = s.values[s.values.length - 1];
            if (!isNum(v)) return null;
            return (
              <circle key={"dot-" + idx} cx={sx(N - 1)} cy={sy(v)} r="3.5"
                fill={s.color} stroke="var(--surface-1)" strokeWidth="2" />
            );
          })}
        </g>
      </svg>

      {/* Hover overlay — captures the pointer, draws the synced crosshair, the
          per-series markers, and the tooltip. HTML (not SVG) so it isn't
          distorted by the chart's horizontal stretch and reads in card type.
          On the time axis it also owns drag-to-zoom (#4). */}
      {interactive && (
        <div className={"tschart__overlay" + (canZoom ? " tschart__overlay--zoomable" : "")}
          onMouseMove={onMove} onMouseLeave={onLeave}
          onMouseDown={onDown} onMouseUp={commitZoom} onDoubleClick={onDouble}>
          {/* Drag selection band (#4) */}
          {drag && Math.abs(drag.b - drag.a) > 0.001 && (() => {
            const lo = Math.min(drag.a, drag.b), hi = Math.max(drag.a, drag.b);
            const loPct = ((padL + lo * plotW) / W) * 100;
            const wPct = ((hi - lo) * plotW / W) * 100;
            return <div className="tschart__zoomsel" style={{ left: loPct + "%", width: wPct + "%", top: padT, height: H - padT - padB }} />;
          })()}
          {hoverIdx != null && (
            <>
              <div className="tschart__crosshair" style={{ left: hoverXPct + "%", top: padT, height: H - padT - padB }} />
              {series.map((s, i) => {
                const v = s.values[hoverIdx];
                if (v == null || !isFinite(v)) return null;
                return (
                  <div key={"hd" + i} className="tschart__dot"
                    style={{ left: hoverXPct + "%", top: sy(v), background: s.color }} />
                );
              })}
              <div className="tschart__tip"
                style={{ left: hoverXPct + "%", transform: `translateX(${hoverXPct > 55 ? "calc(-100% - 10px)" : "10px"})` }}>
                {times && fmtTipTime(times[hoverIdx], range) && (
                  <div className="tschart__tip-time">{fmtTipTime(times[hoverIdx], range)}</div>
                )}
                {series.map((s, i) => {
                  const v = s.values[hoverIdx];
                  return (
                    <div key={"tr" + i} className="tschart__tip-row">
                      <span className="tschart__tip-sw" style={{ background: s.color }} />
                      <span className="tschart__tip-lbl">{s.label || s.key}</span>
                      {/* An unmeasured sample reads "—"; a series formatter is only
                          ever handed a number. */}
                      <span className="tschart__tip-val">{!isNum(v) ? "—" : s.fmt ? s.fmt(v) : defaultFmt(v)}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* Event flags (#3) — hoverable markers above the crosshair overlay. Only the
          small flag is interactive, so the crosshair still tracks everywhere else. */}
      {useTimeAxis && events && events.length > 0 && (
        <div className="tschart__events">
          {events.map((ev, i) => {
            const xPct = (sxT(toMs(ev.t)) / W) * 100;
            if (xPct < (padL / W) * 100 - 0.5 || xPct > ((W - padR) / W) * 100 + 0.5) return null;
            return (
              <div key={"ef" + i} className="tschart__evt" style={{ left: xPct + "%" }}>
                <span className="tschart__evt-flag" style={{ background: toneColor(ev.tone) }}></span>
                <span className="tschart__evt-tip" style={{ transform: `translateX(${xPct > 60 ? "calc(-100% + 7px)" : "-7px"})` }}>
                  <b>{ev.label}</b>{fmtTipTime(toMs(ev.t), range)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// detectAnomalies — robust z-score over the visible window. Marks any
// point > (mean + sigma·std) for at least `minRun` consecutive points.
// Returns an array of windows {start, end, peakIdx, peakValue, mean, std, threshold}.
// Unmeasured points take no part in the statistics and never join a run — the
// window is described by what was actually sampled.
function detectAnomalies(values, opts = {}) {
  const { sigma = 2, minRun = 2 } = opts;
  if (!values || values.length < 5) return [];
  const measured = values.filter(isNum);
  if (measured.length < 5) return [];
  const mean = measured.reduce((a, b) => a + b, 0) / measured.length;
  const variance = measured.reduce((a, b) => a + (b - mean) ** 2, 0) / measured.length;
  const std = Math.sqrt(variance);
  // Flat-ish series — nothing to flag.
  if (std < Math.max(0.5, mean * 0.04)) return [];
  const threshold = mean + sigma * std;
  const out = [];
  let run = null;
  for (let i = 0; i < values.length; i++) {
    if (isNum(values[i]) && values[i] > threshold) {
      if (!run) run = { start: i, end: i, peakIdx: i, peakValue: values[i] };
      else {
        run.end = i;
        if (values[i] > run.peakValue) { run.peakIdx = i; run.peakValue = values[i]; }
      }
    } else if (run) {
      if (run.end - run.start + 1 >= minRun) out.push({ ...run, mean, std, threshold });
      run = null;
    }
  }
  if (run && run.end - run.start + 1 >= minRun) out.push({ ...run, mean, std, threshold });
  return out;
}

// Tiny sparkline used in dashboard server tiles. No labels, just the line.
function Sparkline({ values, color = "var(--krystal-teal)", height = 28 }) {
  const W = 200, H = height, padY = 3;
  const min = Math.min(...values), max = Math.max(...values);
  const span = (max - min) || 1;
  const N = values.length;
  const sx = (i) => (i / Math.max(1, N - 1)) * W;
  const sy = (v) => padY + (1 - (v - min) / span) * (H - padY * 2);
  const d = values.map((v, i) => `${i === 0 ? "M" : "L"} ${sx(i)} ${sy(v)}`).join(" ");
  const fillD = d + ` L ${sx(N - 1)} ${H} L 0 ${H} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: H, display: "block" }}>
      <path d={fillD} fill={color} opacity="0.14" />
      <path d={d} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export { Sparkline, TimeSeriesChart, detectAnomalies, ChartHoverProvider, ChartHoverContext };
