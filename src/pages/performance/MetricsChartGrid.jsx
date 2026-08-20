import { Icon } from "../../components/Icon.jsx";
import { detectAnomalies } from "../../components/TimeSeriesChart.jsx";
import { KiB, MiB, GiB, fmtBytes, fmtBps, seriesStats } from "./perfHelpers.js";
import { MetricChartCard } from "./PerfCards.jsx";

// MetricsChartGrid — the shared CPU / Memory / Disk I/O / Network chart grid,
// rendered from a per-metric time-series map. Both the server Performance tab's
// Historical view and the assistant's "resource trend" evidence card feed it the
// same shape the kgsm-monitor history emits:
//   { cpuPctCore: [{ts, value, min?, max?}], memBytes: [...], ioReadBps: [...], … }
// so a chart looks and behaves identically wherever it appears — full-screen
// pop-out, per-window stats, log toggle, series-mute legend, and a synced hover
// crosshair. The caller owns the <ChartHoverProvider> (so it controls the
// crosshair/zoom scope and can surface a zoom pill); this renders only the
// <div class="chart-grid">.
//
// `compact` trims it for the narrow chat column: a single-column grid, shorter
// charts, and no always-on empty Network card (only metrics with real data
// render, so a chat card never shows a placeholder chart).
//
// `network={false}` says network is not a dimension for this KIND of entity at
// all — a KGSM leaf has no per-instance meter by design, since the eBPF meter is
// attached to kgsm.slice and never sees a unit in system.slice. That is a
// different fact from a server whose meter simply has nothing recorded yet, and
// the two get different treatment: no card at all versus the honest empty one.
function MetricsChartGrid({ series, tier, step, range, events = [], domain, compact = false, network = true }) {
  const isRollup = tier === "rollup";
  const chartHeight = compact ? 96 : 120;

  const cpuSeries = series.cpuPctCore || [];
  const memSeries = series.memBytes || [];
  const ioReadSeries = series.ioReadBps || [];
  const ioWriteSeries = series.ioWriteBps || [];
  const netRxSeries = series.rxBps || [];
  const netTxSeries = series.txBps || [];
  // GPU, present only for an entity that reaches the card at all — most leaves never do, and a
  // server has no GPU dimension. No card rather than an empty one, which is the same choice the
  // chat-compact view makes everywhere else.
  const gpuMemSeries = series.gpuMemBytes || [];
  const gpuSmSeries = series.gpuSmPct || [];

  const cpuVals = cpuSeries.map(p => p.value);
  const cpuMin = isRollup ? cpuSeries.map(p => p.min ?? p.value) : null;
  const cpuMax = isRollup ? cpuSeries.map(p => p.max ?? p.value) : null;

  const memVals = memSeries.map(p => p.value);
  const memPeak = memVals.length ? Math.max(...memVals) : 0;
  const memUseGiB = memPeak >= GiB;
  const memDiv = memUseGiB ? GiB : MiB;
  const memUnit = memUseGiB ? "GiB" : "MiB";
  const mem = memVals.map(v => v / memDiv);
  const memMinBand = isRollup ? memSeries.map(p => (p.min ?? p.value) / memDiv) : null;
  const memMaxBand = isRollup ? memSeries.map(p => (p.max ?? p.value) / memDiv) : null;

  const ioAvail = ioReadSeries.length > 0 || ioWriteSeries.length > 0;
  const ioPeak = ioAvail
    ? Math.max(1, ...ioReadSeries.map(p => p.value || 0), ...ioWriteSeries.map(p => p.value || 0))
    : 1;
  const ioUseMiB = ioPeak >= MiB;
  const ioDiv = ioUseMiB ? MiB : KiB;
  const ioUnit = ioUseMiB ? "MiB/s" : "KiB/s";
  const ioRead = ioReadSeries.map(p => (p.value || 0) / ioDiv);
  const ioWrite = ioWriteSeries.map(p => (p.value || 0) / ioDiv);

  // Network rx/tx — same shape as Disk I/O. Absent when the server has no
  // per-instance meter (container / un-metered host) or history hasn't accrued;
  // the full page still renders an honest empty card, chat omits it.
  const netAvail = netRxSeries.length > 0 || netTxSeries.length > 0;
  const netPeak = netAvail
    ? Math.max(1, ...netRxSeries.map(p => p.value || 0), ...netTxSeries.map(p => p.value || 0))
    : 1;
  const netUseMiB = netPeak >= MiB;
  const netDiv = netUseMiB ? MiB : KiB;
  const netUnit = netUseMiB ? "MiB/s" : "KiB/s";
  const netRx = netRxSeries.map(p => (p.value || 0) / netDiv);
  const netTx = netTxSeries.map(p => (p.value || 0) / netDiv);
  const netTimes = (netRxSeries.length ? netRxSeries : netTxSeries).map(p => p.ts);
  const netRxStats = netRxSeries.length ? seriesStats(netRxSeries.map(p => p.value)) : null;
  const netTxStats = netTxSeries.length ? seriesStats(netTxSeries.map(p => p.value)) : null;

  // Video memory is charted in GiB throughout rather than switching units on the peak like host
  // memory does: a model's footprint is the thing being watched, it is always gigabytes, and a
  // card that silently changed unit between windows would make two ranges incomparable at a glance.
  const gpuMemVals = gpuMemSeries.map(p => p.value);
  const gpuMem = gpuMemVals.map(v => v / GiB);
  const gpuMemTimes = gpuMemSeries.map(p => p.ts);
  const gpuMemStats = gpuMemVals.length ? seriesStats(gpuMemVals) : null;

  // Utilisation is sampled over a window, so a backend that did no work reports NOTHING for that
  // bucket. The null is passed through untouched — TimeSeriesChart opens a gap where a measurement
  // is absent, and coercing it to 0 here would draw an idle model as measured-and-busy-at-zero.
  const gpuSmVals = gpuSmSeries.map(p => p.value);
  const gpuSmTimes = gpuSmSeries.map(p => p.ts);
  const gpuSmMeasured = gpuSmVals.filter(v => typeof v === "number" && Number.isFinite(v));
  const gpuSmStats = gpuSmMeasured.length ? seriesStats(gpuSmMeasured) : null;
  const gpuSmLast = [...gpuSmVals].reverse().find(v => typeof v === "number" && Number.isFinite(v));

  const cpuAnoms = detectAnomalies(cpuVals);
  const memAnoms = detectAnomalies(mem);

  // Real per-bucket timestamps (kept from the backend `ts`) for the hover tooltip,
  // and per-window stats over the raw values.
  const cpuTimes = cpuSeries.map(p => p.ts);
  const memTimes = memSeries.map(p => p.ts);
  const ioTimes  = (ioReadSeries.length ? ioReadSeries : ioWriteSeries).map(p => p.ts);
  const cpuStats = seriesStats(cpuVals);
  const memStats = seriesStats(memVals);
  const ioReadStats  = ioReadSeries.length ? seriesStats(ioReadSeries.map(p => p.value)) : null;
  const ioWriteStats = ioWriteSeries.length ? seriesStats(ioWriteSeries.map(p => p.value)) : null;

  // The full page keeps the honest empty Network card so the grid never has a
  // hole; the compact chat card drops it (only metrics with data appear), and an
  // entity that has no network dimension never shows it either way.
  const showNet = network && (netAvail || !compact);

  return (
    <div className={"chart-grid" + (compact ? " chart-grid--compact" : "")}>
      {cpuVals.length > 0 && (
        <MetricChartCard icon="cpu" title="CPU" anomalyCount={cpuAnoms.length} chartHeight={chartHeight}
          value={<span className="chart-card__val">{cpuVals[cpuVals.length - 1].toFixed(0)}<small>% core</small></span>}
          stats={cpuStats && [
            { label: "avg", value: cpuStats.avg.toFixed(0) + "%" },
            { label: "peak", value: cpuStats.max.toFixed(0) + "%" },
            { label: "min", value: cpuStats.min.toFixed(0) + "%" },
          ]}
          series={[{ key: "cpu", label: "CPU", color: "var(--krystal-teal)", fill: true, values: cpuVals, fmt: v => v.toFixed(0) + "% core" }]}
          anomalies={cpuAnoms} range={range} times={cpuTimes} domain={domain} events={events} stepSec={step}
          band={cpuMin && cpuMax ? { min: cpuMin, max: cpuMax, color: "var(--krystal-teal)" } : undefined}
          legendNote={isRollup ? "shaded band = min/max per bucket" : undefined} />
      )}

      {mem.length > 0 && (
        <MetricChartCard icon="hard-drive" title="Memory" anomalyCount={memAnoms.length} chartHeight={chartHeight}
          value={<span className="chart-card__val">{fmtBytes(memVals[memVals.length - 1])}</span>}
          stats={memStats && [
            { label: "avg", value: fmtBytes(memStats.avg) },
            { label: "peak", value: fmtBytes(memStats.max) },
            { label: "min", value: fmtBytes(memStats.min) },
          ]}
          series={[{ key: "mem", label: "Memory", color: "#FBBF24", fill: true, values: mem, fmt: v => fmtBytes(v * memDiv) }]}
          anomalies={memAnoms} range={range} times={memTimes} domain={domain} events={events} stepSec={step}
          band={memMinBand && memMaxBand ? { min: memMinBand, max: memMaxBand, color: "#FBBF24" } : undefined}
          legendNote={`${memUnit} used${isRollup ? " · band = min/max" : ""}`} />
      )}

      {gpuMem.length > 0 && (
        <MetricChartCard icon="cpu" title="GPU memory" chartHeight={chartHeight}
          value={<span className="chart-card__val">{fmtBytes(gpuMemVals[gpuMemVals.length - 1])}</span>}
          stats={gpuMemStats && [
            { label: "avg", value: fmtBytes(gpuMemStats.avg) },
            { label: "peak", value: fmtBytes(gpuMemStats.max) },
            { label: "min", value: fmtBytes(gpuMemStats.min) },
          ]}
          series={[{ key: "gpumem", label: "GPU memory", color: "#A78BFA", fill: true, values: gpuMem,
                     fmt: v => fmtBytes(v * GiB) }]}
          range={range} times={gpuMemTimes} domain={domain} events={events} stepSec={step}
          legendNote="video memory held" />
      )}

      {gpuSmVals.length > 0 && (
        <MetricChartCard icon="cpu" title="GPU compute" chartHeight={chartHeight}
          value={gpuSmLast === undefined
            ? <span className="chart-card__val" style={{ color: "var(--fg-3)" }}>—</span>
            : <span className="chart-card__val">{gpuSmLast.toFixed(0)}<small>%</small></span>}
          stats={gpuSmStats && [
            { label: "avg", value: gpuSmStats.avg.toFixed(0) + "%" },
            { label: "peak", value: gpuSmStats.max.toFixed(0) + "%" },
          ]}
          series={[{ key: "gpusm", label: "GPU compute", color: "#A78BFA", fill: true, values: gpuSmVals,
                     fmt: v => v.toFixed(0) + "%" }]}
          range={range} times={gpuSmTimes} domain={domain} events={events} stepSec={step}
          yMin={0} yMax={100}
          legendNote="gaps are idle — utilisation is sampled, and an unworked window reports nothing" />
      )}

      {ioAvail && (
        <MetricChartCard icon="network" title="Disk I/O" allowLog unit={ioUnit} chartHeight={chartHeight}
          value={<span className="chart-card__val">
            <small style={{ marginRight: 6 }}>r</small>{fmtBps(ioReadSeries.length ? ioReadSeries[ioReadSeries.length - 1].value : null)}
            <small> / </small>
            <small style={{ marginRight: 6 }}>w</small>{fmtBps(ioWriteSeries.length ? ioWriteSeries[ioWriteSeries.length - 1].value : null)}
          </span>}
          stats={[
            ...(ioReadStats ? [{ label: "r peak", value: fmtBps(ioReadStats.max) }] : []),
            ...(ioWriteStats ? [{ label: "w peak", value: fmtBps(ioWriteStats.max) }] : []),
          ]}
          series={[
            { key: "r", label: "Read", color: "var(--info)", fill: false, values: ioRead, fmt: v => fmtBps(v * ioDiv) },
            { key: "w", label: "Write", color: "var(--krystal-teal)", fill: false, values: ioWrite, fmt: v => fmtBps(v * ioDiv) },
          ]}
          range={range} times={ioTimes} domain={domain} events={events} stepSec={step} />
      )}

      {showNet && (
        <MetricChartCard icon="arrow-down-up" title="Network" allowLog unit={netUnit} chartHeight={chartHeight}
          value={netAvail
            ? <span className="chart-card__val"><small style={{ marginRight: 6 }}>rx</small>{fmtBps(netRxSeries.length ? netRxSeries[netRxSeries.length - 1].value : null)}<small> / </small><small style={{ marginRight: 6 }}>tx</small>{fmtBps(netTxSeries.length ? netTxSeries[netTxSeries.length - 1].value : null)}</span>
            : <span className="chart-card__val" style={{ color: "var(--fg-3)" }}>—</span>}
          stats={[
            ...(netRxStats ? [{ label: "rx peak", value: fmtBps(netRxStats.max) }] : []),
            ...(netTxStats ? [{ label: "tx peak", value: fmtBps(netTxStats.max) }] : []),
          ]}
          series={[
            { key: "rx", label: "Receive", color: "var(--info)", fill: false, values: netRx, fmt: v => fmtBps(v * netDiv) },
            { key: "tx", label: "Transmit", color: "var(--krystal-teal)", fill: false, values: netTx, fmt: v => fmtBps(v * netDiv) },
          ]}
          range={range} times={netTimes} domain={domain} events={events} stepSec={step}
          empty={netAvail ? null : (
            <div className="perf-nochart">
              <Icon name="info" size={16} strokeWidth={1.8} />
              <span>No network history for this range — recorded only while the server runs with a per-instance meter (native eBPF); a container or un-metered host has none, and data accrues over time.</span>
            </div>
          )} />
      )}
    </div>
  );
}

export { MetricsChartGrid };
