import React from "react";
import { Icon } from "../components/Icon.jsx";
import { detectAnomalies, ChartHoverProvider } from "../components/TimeSeriesChart.jsx";
import { PinButton } from "../components/widgets/PinButton.jsx";
import { adaptServerMetrics, subscribeServerMetrics, fetchServerMetricsHistory, fetchServerEvents } from "../lib/stores.js";
import { BUFFER_CAP, STALE_MS, NO_SOURCE_MS, RANGE_MS, KiB, MiB, GiB, rowsToEvents, fmtBytes, fmtBps, seriesStats, fmtZoomRange } from "./performance/perfHelpers.js";
import { MetricChartCard, RangeSelector, EmptyPerf } from "./performance/PerfCards.jsx";
import { MetricsChartGrid } from "./performance/MetricsChartGrid.jsx";

// PerformanceTab — per-server resource metrics with live + historical ranges.
// Pure helpers/constants live in performance/perfHelpers.js; the chart card + the
// small presentational pieces live in performance/PerfCards.jsx (#8 split). This
// file keeps the two stateful data views + the range orchestrator.
//
// LIVE: the kgsm-monitor samples each running instance's cgroup/proc tree at
// ~1 Hz; kgsm-api re-publishes the per-server frame on the WS topic
// `servers/{id}/metrics` (`metrics.tick`), subscriber-gated on both ends.
// The live tab is a transient rolling window: it seeds from the REST `metrics`
// block, then appends each tick into a transient buffer (resets on unmount).
//
// HISTORICAL (M9): the kgsm-api metrics history store persists samples at 15s
// cadence into a dedicated metrics.db. Short ranges (≤24h) serve raw ~15s
// samples; long ranges (7d/30d) serve 5-min rollup buckets with min/max/n.
// Gaps are absent points (the backend never carry-forwards). The range
// selector fetches from GET /servers/{id}/metrics/history?range=X.

function PerformanceTab({ server, onAsk }) {
  // A stopped server has no live feed and nothing to measure — default to the most
  // recent history so its run-time data + lifecycle events stay visible. Live is
  // still selectable; it just renders an honest "not running" state, never a
  // fabricated flat-0 line (the monitor reports nothing for a stopped instance).
  const stopped = server.status === "offline";
  const [range, setRange] = React.useState(stopped ? "1h" : "live");

  return (
    <>
      <div className="players-toolbar">
        <RangeSelector range={range} setRange={setRange} />
        {/* This tab has no card header of its own — the charts below each have theirs — so the pin
            rides the range row. It pins the tab, not one chart. */}
        <PinButton type="server.performance" params={{ serverId: server && server.id }}
          label={((server && server.name) || "this server") + "'s performance"} />
      </div>
      {range === "live"
        ? <LiveMetrics server={server} stopped={stopped} />
        : <HistoricalMetrics server={server} range={range} />
      }
    </>
  );
}

// ---- Live rolling window (unchanged from before M9) ----

function LiveMetrics({ server, stopped }) {
  const [buffer, setBuffer] = React.useState([]);
  const [lastTickAt, setLastTickAt] = React.useState(null);
  const [mountedAt, setMountedAt] = React.useState(() => Date.now());
  const [, setClock] = React.useState(0);

  React.useEffect(() => {
    const seed = adaptServerMetrics(server.metrics);
    // Stamp each point with its receipt time — the live feed carries no
    // per-sample timestamp, so the hover tooltip's wall-clock comes from here
    // (honest: time-of-receipt at ~1 Hz, not a fabricated sample time).
    setBuffer(seed ? [{ ...seed, t: Date.now() }] : []);
    setLastTickAt(seed ? Date.now() : null);
    setMountedAt(Date.now());
    return subscribeServerMetrics(server.id, (point) => {
      const now = Date.now();
      setLastTickAt(now);
      setBuffer(prev => {
        const arr = prev.concat([{ ...point, t: now }]);
        return arr.length > BUFFER_CAP ? arr.slice(arr.length - BUFFER_CAP) : arr;
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-seed the live buffer only on server switch, not on every metrics tick (which would reset the buffer)
  }, [server.id]);

  React.useEffect(() => {
    const id = setInterval(() => setClock(c => c + 1), 3000);
    return () => clearInterval(id);
  }, []);

  const hasData = buffer.length > 0;
  const latest = hasData ? buffer[buffer.length - 1] : null;
  const ageMs = lastTickAt != null ? Date.now() - lastTickAt : null;
  const stale = hasData && ageMs != null && ageMs > STALE_MS;
  const elapsed = Date.now() - mountedAt;

  if (stopped && !hasData) {
    return <EmptyPerf icon="power-off" title="Server isn’t running"
      sub="No live feed while stopped — the monitor measures nothing for a stopped instance. Pick a history range above to see recorded metrics and the server’s start/stop events." />;
  }

  if (!hasData) {
    return elapsed < NO_SOURCE_MS
      ? <EmptyPerf icon="line-chart" title="Connecting to live metrics…" spin
          sub="Subscribing to this server's metrics feed." />
      : <EmptyPerf icon="line-chart" title="No live per-server metrics"
          sub="The monitor isn't reporting this server on its host — its metrics capability may be down, or per-server sampling isn't available here." />;
  }

  const times = buffer.map(p => p.t);

  const cpu = buffer.map(p => p.cpu ?? 0);
  const memVals = buffer.map(p => p.memBytes).filter(v => v != null);
  const memPeak = memVals.length ? Math.max(...memVals) : 0;
  const memUseGiB = memPeak >= GiB;
  const memDiv = memUseGiB ? GiB : MiB;
  const memUnit = memUseGiB ? "GiB" : "MiB";
  const mem = buffer.map(p => p.memBytes != null ? p.memBytes / memDiv : 0);

  const ioAvail = buffer.some(p => p.ioReadBps != null || p.ioWriteBps != null);
  const ioPeak = Math.max(1, ...buffer.map(p => Math.max(p.ioReadBps || 0, p.ioWriteBps || 0)));
  const ioUseMiB = ioPeak >= MiB;
  const ioDiv = ioUseMiB ? MiB : KiB;
  const ioUnit = ioUseMiB ? "MiB/s" : "KiB/s";
  const ioRead = buffer.map(p => (p.ioReadBps || 0) / ioDiv);
  const ioWrite = buffer.map(p => (p.ioWriteBps || 0) / ioDiv);

  // Network rx/tx — sourced for native instances (eBPF meter on kgsm.slice),
  // null when unmetered (container / un-metered host). null across the whole
  // window → honest "not available", NOT a flat-zero chart (mirrors Disk I/O).
  const netAvail = buffer.some(p => p.rxBps != null || p.txBps != null);
  const netPeak = Math.max(1, ...buffer.map(p => Math.max(p.rxBps || 0, p.txBps || 0)));
  const netUseMiB = netPeak >= MiB;
  const netDiv = netUseMiB ? MiB : KiB;
  const netUnit = netUseMiB ? "MiB/s" : "KiB/s";
  const netRx = buffer.map(p => (p.rxBps || 0) / netDiv);
  const netTx = buffer.map(p => (p.txBps || 0) / netDiv);

  const cpuAnoms = detectAnomalies(cpu);
  const memAnoms = detectAnomalies(mem);
  const ioAnoms  = ioAvail ? detectAnomalies(ioWrite) : [];
  const netAnoms = netAvail ? detectAnomalies(netTx) : [];

  // Per-window summary stats (#2) — computed over the raw values, formatted per metric.
  const cpuStats = seriesStats(cpu);
  const memStats = seriesStats(memVals);
  const ioReadStats  = ioAvail ? seriesStats(buffer.map(p => p.ioReadBps)) : null;
  const ioWriteStats = ioAvail ? seriesStats(buffer.map(p => p.ioWriteBps)) : null;
  const netRxStats = netAvail ? seriesStats(buffer.map(p => p.rxBps)) : null;
  const netTxStats = netAvail ? seriesStats(buffer.map(p => p.txBps)) : null;

  const win = buffer.length;
  const streaming = !stale;

  return (
    <>
      <div className="players-toolbar" style={{ marginTop: 4 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 600, color: streaming ? "var(--krystal-teal)" : "var(--fg-3)" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: streaming ? "var(--krystal-teal)" : "var(--fg-4)", boxShadow: streaming ? "0 0 0 3px color-mix(in srgb, var(--krystal-teal) 22%, transparent)" : "none" }}></span>
          {streaming ? "live · 1 Hz" : "feed paused"}
        </span>
        <span style={{ flex: 1 }}></span>
        <span style={{ color: "var(--fg-3)", fontSize: 12.5, fontFamily: "var(--font-mono)" }}>
          live window · {win} sample{win === 1 ? "" : "s"}
        </span>
      </div>

      {stale && (
        <div className="perf-stale-banner">
          <Icon name="power-off" size={14} strokeWidth={1.9} />
          <span>Live feed paused — last reading {Math.round((ageMs || 0) / 1000)}s ago. Showing the last known window.</span>
        </div>
      )}

      <ChartHoverProvider>
      <div className="chart-grid" style={stale ? { opacity: 0.6 } : undefined}>
        <MetricChartCard icon="cpu" title="CPU" anomalyCount={cpuAnoms.length}
          value={<span className="chart-card__val">{(latest.cpu ?? 0).toFixed(0)}<small>% core</small></span>}
          stats={cpuStats && [
            { label: "avg", value: cpuStats.avg.toFixed(0) + "%" },
            { label: "peak", value: cpuStats.max.toFixed(0) + "%" },
            { label: "min", value: cpuStats.min.toFixed(0) + "%" },
          ]}
          series={[{ key: "cpu", label: "CPU", color: "var(--krystal-teal)", fill: true, values: cpu, fmt: v => v.toFixed(0) + "% core" }]}
          anomalies={cpuAnoms} range="live" times={times} />

        <MetricChartCard icon="hard-drive" title="Memory" anomalyCount={memAnoms.length}
          value={<span className="chart-card__val">{fmtBytes(latest.memBytes)}</span>}
          stats={memStats && [
            { label: "avg", value: fmtBytes(memStats.avg) },
            { label: "peak", value: fmtBytes(memStats.max) },
            { label: "min", value: fmtBytes(memStats.min) },
          ]}
          series={[{ key: "mem", label: "Memory", color: "#FBBF24", fill: true, values: mem, fmt: v => fmtBytes(v * memDiv) }]}
          anomalies={memAnoms} range="live" times={times}
          legendNote={`${memUnit} used · no per-server cap to chart against`} />

        <MetricChartCard icon="network" title="Disk I/O" anomalyCount={ioAnoms.length} allowLog unit={ioUnit}
          value={ioAvail
            ? <span className="chart-card__val"><small style={{ marginRight: 6 }}>r</small>{fmtBps(latest.ioReadBps)}<small> / </small><small style={{ marginRight: 6 }}>w</small>{fmtBps(latest.ioWriteBps)}</span>
            : <span className="chart-card__val" style={{ color: "var(--fg-3)" }}>—</span>}
          stats={[
            ...(ioReadStats ? [{ label: "r peak", value: fmtBps(ioReadStats.max) }] : []),
            ...(ioWriteStats ? [{ label: "w peak", value: fmtBps(ioWriteStats.max) }] : []),
          ]}
          series={[
            { key: "r", label: "Read", color: "var(--info)", fill: false, values: ioRead, fmt: v => fmtBps(v * ioDiv) },
            { key: "w", label: "Write", color: "var(--krystal-teal)", fill: false, values: ioWrite, fmt: v => fmtBps(v * ioDiv) },
          ]}
          anomalies={ioAnoms} range="live" times={times}
          empty={ioAvail ? null : (
            <div className="perf-nochart">
              <Icon name="info" size={16} strokeWidth={1.8} />
              <span>Disk I/O isn't accounted for this server on its host (cgroup io controller off).</span>
            </div>
          )} />

        <MetricChartCard icon="arrow-down-up" title="Network" anomalyCount={netAnoms.length} allowLog unit={netUnit}
          value={netAvail
            ? <span className="chart-card__val"><small style={{ marginRight: 6 }}>rx</small>{fmtBps(latest.rxBps)}<small> / </small><small style={{ marginRight: 6 }}>tx</small>{fmtBps(latest.txBps)}</span>
            : <span className="chart-card__val" style={{ color: "var(--fg-3)" }}>—</span>}
          stats={[
            ...(netRxStats ? [{ label: "rx peak", value: fmtBps(netRxStats.max) }] : []),
            ...(netTxStats ? [{ label: "tx peak", value: fmtBps(netTxStats.max) }] : []),
          ]}
          series={[
            { key: "rx", label: "Receive", color: "var(--info)", fill: false, values: netRx, fmt: v => fmtBps(v * netDiv) },
            { key: "tx", label: "Transmit", color: "var(--krystal-teal)", fill: false, values: netTx, fmt: v => fmtBps(v * netDiv) },
          ]}
          anomalies={netAnoms} range="live" times={times}
          empty={netAvail ? null : (
            <div className="perf-nochart">
              <Icon name="info" size={16} strokeWidth={1.8} />
              <span>Network isn't measured for this server — no per-instance meter on its host (e.g. a container or an un-metered host).</span>
            </div>
          )} />
      </div>
      </ChartHoverProvider>
    </>
  );
}

// ---- Historical metrics (M9 — fetch from the durable store) ----

function HistoricalMetrics({ server, range }) {
  const [data, setData] = React.useState(null);
  const [events, setEvents] = React.useState([]);
  const [nowMs, setNowMs] = React.useState(() => Date.now());
  const [zoom, setZoom] = React.useState(null);   // [ms0, ms1] | null — drag-to-zoom (#4)
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    setEvents([]);
    setZoom(null);   // a new range/server resets any zoom
    const now = Date.now();
    setNowMs(now);
    const sinceIso = new Date(now - (RANGE_MS[range] || RANGE_MS["1h"])).toISOString();
    fetchServerMetricsHistory(server.id, range, server.hostId)
      .then(d => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch(e => { if (!cancelled) { setError(e); setLoading(false); } });
    // Lifecycle markers are best-effort — a failure here must never break the charts.
    fetchServerEvents(server.id, server.hostId, sinceIso)
      .then(rows => { if (!cancelled) setEvents(rowsToEvents(rows)); })
      .catch(() => { if (!cancelled) setEvents([]); });
    return () => { cancelled = true; };
  }, [server.id, server.hostId, range]);

  // One shared time domain [now-range, now] for all charts → the synced crosshair
  // and the event flags line up by wall-clock across CPU/Memory/Disk.
  const domain = [nowMs - (RANGE_MS[range] || RANGE_MS["1h"]), nowMs];

  if (loading) {
    return <EmptyPerf icon="line-chart" title="Loading history…" spin
      sub={`Fetching ${range} of metrics history.`} />;
  }
  if (error) {
    return <EmptyPerf icon="alert-triangle" title="Couldn't load history"
      sub={error.userMessage || error.message || "An error occurred."} />;
  }
  if (!data || !data.series || Object.keys(data.series).length === 0) {
    return <EmptyPerf icon="line-chart" title="No history available"
      sub="The metrics history store has no data for this server in this range. Data accumulates over time as the server runs." />;
  }

  const step = data.step;
  const pointCount = (data.series.cpuPctCore || []).length;

  return (
    <>
      <div className="players-toolbar" style={{ marginTop: 4 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 600, color: "var(--fg-3)" }}>
          <Icon name="clock" size={14} strokeWidth={1.8} />
          {data.tier === "rollup" ? `${step / 60}min avg` : `~${step}s samples`} · {range}
        </span>
        {zoom && (
          <button className="perf-zoom-pill" onClick={() => setZoom(null)} title="Reset zoom (or double-click a chart)">
            <Icon name="zoom-in" size={12} strokeWidth={2} />
            {fmtZoomRange(zoom)}
            <Icon name="x" size={12} strokeWidth={2.2} />
          </button>
        )}
        <span style={{ flex: 1 }}></span>
        <span style={{ color: "var(--fg-3)", fontSize: 12.5, fontFamily: "var(--font-mono)" }}>
          {pointCount} point{pointCount === 1 ? "" : "s"}
        </span>
      </div>

      <ChartHoverProvider zoom={zoom} onZoom={setZoom}>
        <MetricsChartGrid series={data.series} tier={data.tier} step={step}
          range={range} events={events} domain={domain} />
      </ChartHoverProvider>
    </>
  );
}

export { PerformanceTab };
