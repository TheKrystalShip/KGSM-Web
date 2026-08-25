// DiagHostHistory — the node's recorded CPU and memory, from the monitor's host-entity history.
// The leaf System tab's historical view pointed at the host itself: same store, same chart cards,
// same range selector. HISTORY ONLY — the live cards above this one are the live view, and a "live"
// range here would replay recorded points while claiming a feed.
//
// Where the history carries the slice series (sliceCpuPctCore / sliceMemBytes), each chart draws
// "game servers" as a second line, aligned to the host series by the shared persist timestamp — a
// bucket the slice wasn't measured in is a gap, never a zero.

import React from "react";

import { Icon } from "../../components/Icon.jsx";
import { ChartHoverProvider } from "../../components/TimeSeriesChart.jsx";
import { fetchHostMetricsHistory } from "../../lib/stores.js";
import { fmtBytes } from "../../lib/formatting.js";
import { MetricChartCard, RangeSelector } from "../performance/PerfCards.jsx";
import { HISTORY_RANGES, seriesStats } from "../performance/perfHelpers.js";

const GiB = 1073741824;
const KiB = 1024;

// Overlay a sparse secondary series onto the primary's timeline: same persist batch → same ts, so a
// bucket the secondary lacks reads null (a gap on the chart), never a substituted value.
function alignTo(primaryPoints, secondaryPoints, mapValue) {
  const byTs = new Map((secondaryPoints || []).map(p => [String(p.ts), p.value]));
  return primaryPoints.map(p => {
    const v = byTs.get(String(p.ts));
    return v == null ? null : mapValue(v);
  });
}

function DiagHostHistory({ host }) {
  const hostId = host && host.id;
  const [range, setRange] = React.useState("1h");
  const [data, setData] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [reloadKey, setReloadKey] = React.useState(0);

  React.useEffect(() => {
    if (!hostId) return undefined;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchHostMetricsHistory(hostId, range).then(
      (d) => { if (!cancelled) { setData(d); setLoading(false); } },
      (e) => { if (!cancelled) { setError(e); setLoading(false); } },
    );
    return () => { cancelled = true; };
  }, [hostId, range, reloadKey]);

  const series = (data && data.series) || {};
  const cpuPoints = series.cpuTotalPct || [];
  const memPoints = series.memUsedKb || [];
  const hasAny = cpuPoints.length > 0 || memPoints.length > 0;

  // Slice share of the WHOLE host: sliceCpuPctCore is percent of one core, the host line is percent
  // of every core — divide by the thread count to put them on one axis. No thread count → no honest
  // conversion → no overlay.
  const threads = (host && host.cpu && (host.cpu.threads || (host.cpu.per_core || []).length)) || null;
  const sliceCpuVals = threads
    ? alignTo(cpuPoints, series.sliceCpuPctCore, v => Math.round((v / (threads * 100)) * 1000) / 10)
    : [];
  const sliceMemVals = alignTo(memPoints, series.sliceMemBytes, v => v / GiB);
  const hasSliceCpu = sliceCpuVals.some(v => v != null);
  const hasSliceMem = sliceMemVals.some(v => v != null);

  const cpuVals = cpuPoints.map(p => p.value);
  const cpuTimes = cpuPoints.map(p => p.ts);
  const memVals = memPoints.map(p => p.value / KiB / 1024);   // KiB → GiB
  const memTimes = memPoints.map(p => p.ts);
  const cpuStats = cpuVals.length ? seriesStats(cpuVals) : null;
  const memStats = memVals.length ? seriesStats(memVals) : null;

  const body = () => {
    if (loading) return <div className="chat-brief__empty">Reading the node’s recorded history…</div>;
    if (error) {
      return (
        <div className="chat-brief__empty chat-brief__empty--neutral">
          <div className="chat-brief__empty-title">History unavailable</div>
          <div className="chat-brief__empty-sub">{(error && (error.userMessage || error.message)) || "This host didn’t answer."}</div>
          <button className="chip" style={{ marginTop: 10 }} onClick={() => setReloadKey(k => k + 1)}>
            <Icon name="rotate-cw" size={14} /> Try again
          </button>
        </div>
      );
    }
    if (!hasAny) {
      return (
        <div className="chat-brief__empty chat-brief__empty--neutral">
          <div className="chat-brief__empty-title">Nothing recorded in this window</div>
          <div className="chat-brief__empty-sub">The monitor holds no host samples for the selected range.</div>
        </div>
      );
    }
    return (
      <ChartHoverProvider>
        <div className="chart-grid">
          {cpuVals.length > 0 && (
            <MetricChartCard icon="cpu" title="CPU" chartHeight={120}
              value={<span className="chart-card__val">{cpuVals[cpuVals.length - 1].toFixed(0)}<small>%</small></span>}
              stats={cpuStats && [
                { label: "avg", value: cpuStats.avg.toFixed(0) + "%" },
                { label: "peak", value: cpuStats.max.toFixed(0) + "%" },
              ]}
              series={[
                { key: "host", label: "Host", color: "var(--krystal-teal)", fill: true, values: cpuVals, fmt: v => v.toFixed(1) + "%" },
                ...(hasSliceCpu ? [{ key: "slice", label: "Game servers", color: "#FBBF24", values: sliceCpuVals, fmt: v => v.toFixed(1) + "% of host" }] : []),
              ]}
              range={range} times={cpuTimes} stepSec={data.step} />
          )}
          {memVals.length > 0 && (
            <MetricChartCard icon="memory-stick" title="Memory" chartHeight={120}
              value={<span className="chart-card__val">{memVals[memVals.length - 1].toFixed(1)}<small>GiB</small></span>}
              stats={memStats && [
                { label: "avg", value: memStats.avg.toFixed(1) + " GiB" },
                { label: "peak", value: memStats.max.toFixed(1) + " GiB" },
              ]}
              series={[
                { key: "host", label: "Used", color: "var(--krystal-teal)", fill: true, values: memVals, fmt: v => fmtBytes(v * GiB) },
                ...(hasSliceMem ? [{ key: "slice", label: "Game servers", color: "#FBBF24", values: sliceMemVals, fmt: v => fmtBytes(v * GiB) }] : []),
              ]}
              range={range} times={memTimes} stepSec={data.step} />
          )}
        </div>
      </ChartHoverProvider>
    );
  };

  return (
    <div className="chat-brief" style={{ marginTop: 16 }}>
      <div className="chat-brief__head">
        <span className="chat-brief__title">
          <Icon name="line-chart" size={13} /> History
          {data && data.tier && <span className="chat-brief__count chat-brief__count--neutral">{data.tier}</span>}
        </span>
        <span style={{ flex: 1 }}></span>
        <RangeSelector range={range} setRange={setRange} ranges={HISTORY_RANGES} />
      </div>
      <div className="chat-brief__pad">
        {body()}
      </div>
    </div>
  );
}

export { DiagHostHistory };
