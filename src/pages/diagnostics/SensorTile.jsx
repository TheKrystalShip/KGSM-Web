import React from "react";
import { KPI } from "../../components/KPI.jsx";
import { useStore } from "../../lib/store.js";
import { hostsStore } from "../../lib/stores.js";
import {
  fetchSensorHistory, fetchSensorSummary, fetchGpuHistory, fetchGpuSummary,
} from "../../lib/stores/hosts.js";
import { api } from "../../lib/apiClient.js";

// SensorTile — ONE channel as a glance card: the reading now, its range over the window, and a trace
// with the line it is judged against drawn where that line falls.
//
// The number answers "what is it"; the trace answers "where is it going", which a number cannot. The
// line matters because headroom is the actual question — 72 °C means nothing until you know whether
// this device is rated to 80 or to 95, and different devices on one host are rated differently.
//
// Binds to a host and a channel id, reads both itself, and so renders identically on a page and pinned.
// The id resolves against every channel the host reports — an hwmon temperature, a tachometer, or a GPU
// by its UUID — because they are one namespace to a person pinning a row, and no two of them collide.

const TRACE_HEIGHT = 34;

function traceGeometry(points, warn) {
  const vals = points.map((p) => p.value).filter((v) => typeof v === "number" && Number.isFinite(v));
  if (vals.length < 2) return null;

  // The warn line is inside the domain so the headroom to it is to scale. Without that the trace
  // fills the box whatever the values are, and a channel at 45° looks exactly like one at 84°.
  const candidates = warn != null ? vals.concat([warn]) : vals;
  const lo = Math.min(...candidates);
  const hi = Math.max(...candidates);
  const span = hi - lo || 1;
  const W = 240, P = 3;
  const x = (i) => P + (i / (vals.length - 1)) * (W - P * 2);
  const y = (v) => TRACE_HEIGHT - P - ((v - lo) / span) * (TRACE_HEIGHT - P * 2);

  return {
    line: vals.map((v, i) => x(i).toFixed(1) + "," + y(v).toFixed(1)).join(" "),
    area: "M" + x(0).toFixed(1) + "," + (TRACE_HEIGHT - P) +
      " L" + vals.map((v, i) => x(i).toFixed(1) + "," + y(v).toFixed(1)).join(" L") +
      " L" + x(vals.length - 1).toFixed(1) + "," + (TRACE_HEIGHT - P) + " Z",
    lastX: x(vals.length - 1),
    lastY: y(vals[vals.length - 1]),
    warnY: warn != null ? y(warn) : null,
  };
}

// What the id points at on this host, flattened to the one shape the card draws. `kind` survives into
// the fetches because the two row sets are stored and addressed separately.
function resolve(host, id) {
  const sensor = (host.sensors || []).find((s) => s.id === id);
  if (sensor) {
    return {
      kind: "sensor", unit: "°C", metric: "tempC",
      name: sensor.name || sensor.chip, value: sensor.value_c,
      warn: sensor.limit_high_c ?? null, danger: sensor.limit_critical_c ?? null,
    };
  }
  const fan = (host.fans || []).find((f) => f.id === id);
  if (fan) {
    return {
      kind: "fan", unit: "RPM", metric: "rpm",
      name: fan.name || fan.chip, value: fan.rpm, warn: null, danger: null,
    };
  }
  const gpu = (host.gpus || []).find((g) => g.uuid === id);
  if (gpu) {
    // A card present but silent about its temperature is a different fact from a card that is gone, and
    // the tile says which. Never a substituted zero.
    return {
      kind: "gpu", unit: "°C", metric: "tempC",
      name: gpu.name, value: gpu.temp_c ?? null,
      warn: gpu.temp_limit_c ?? null, danger: gpu.temp_shutdown_c ?? null,
      missing: gpu.temp_c == null ? "This device reports no temperature" : null,
    };
  }
  return null;
}

function SensorTile({ hostId, sensorId, range = "1h", pin, onView }) {
  const hosts = useStore(hostsStore, (s) => s.list);
  const [points, setPoints] = React.useState(null);
  const [summary, setSummary] = React.useState(null);
  const [policy, setPolicy] = React.useState(null);

  const host = (hosts || []).find((h) => h.id === hostId) || null;
  const ch = host ? resolve(host, sensorId) : null;
  const kind = ch && ch.kind;
  const isFan = kind === "fan";
  const isGpu = kind === "gpu";
  const metric = ch && ch.metric;

  React.useEffect(() => {
    let alive = true;
    if (!hostId || !sensorId || !kind) return undefined;
    const req = isGpu
      ? fetchGpuHistory(hostId, sensorId, range)
      : fetchSensorHistory(hostId, sensorId, range);
    req
      .then((r) => {
        if (!alive) return;
        const series = (r && r.series) || {};
        setPoints(series[metric] || []);
      })
      .catch(() => { if (alive) setPoints(null); });
    return () => { alive = false; };
  }, [hostId, sensorId, range, kind, isGpu, metric]);

  React.useEffect(() => {
    let alive = true;
    if (!hostId || !kind) return undefined;
    const req = isGpu ? fetchGpuSummary(hostId, range) : fetchSensorSummary(hostId, range);
    req
      .then((r) => {
        if (!alive) return;
        // Matched on the metric as well as the id: a GPU carries several series under one UUID, and the
        // first row for it is whichever the store returned, not the one this card draws.
        setSummary(((r && r.entries) || [])
          .find((e) => e.entityId === sensorId && e.metric === metric) || null);
      })
      .catch(() => { if (alive) setSummary(null); });
    return () => { alive = false; };
  }, [hostId, sensorId, range, kind, isGpu, metric]);

  React.useEffect(() => {
    let alive = true;
    if (!hostId || isFan) return undefined;
    api.host(hostId).get("/hosts/" + encodeURIComponent(hostId) + "/thresholds").then(
      (d) => {
        if (!alive) return;
        const rule = ((d && d.rules) || []).find((r) => r.metric === "HostTempC" && r.enabled);
        setPolicy(rule ? { warn: rule.warn, danger: rule.danger } : null);
      },
      () => { if (alive) setPolicy(null); });
    return () => { alive = false; };
  }, [hostId, isFan]);

  // A widget whose target is gone says so, rather than mounting an empty card that reads as a
  // healthy sensor at no temperature.
  if (!host || !ch || ch.value == null) {
    const sub = !host ? "Node unavailable"
      : !ch ? "This channel is no longer reported"
      : ch.missing || "This channel is no longer reported";
    return (
      <KPI icon="thermometer" label={ch ? ch.name : "Sensor"} tone="muted" value="—"
        sub={sub} pin={pin} onView={onView} />
    );
  }

  const warn = isFan ? null : ch.warn ?? (policy ? policy.warn : null) ?? null;
  const danger = isFan ? null : ch.danger ?? (policy ? policy.danger : null) ?? null;
  const value = ch.value;

  let tone = "muted";
  if (!isFan && danger != null && value >= danger) tone = "danger";
  else if (!isFan && warn != null && value >= warn) tone = "warn";

  const geo = points && points.length ? traceGeometry(points, warn) : null;
  const accent = tone === "danger" ? "var(--danger-fg)" : tone === "warn" ? "var(--warning-fg)" : "var(--krystal-teal)";

  const stats = summary
    ? [
        "min " + (isFan ? Math.round(summary.min).toLocaleString() : summary.min.toFixed(0)),
        "avg " + (isFan ? Math.round(summary.avg).toLocaleString() : summary.avg.toFixed(0)),
        "max " + (isFan ? Math.round(summary.max).toLocaleString() : summary.max.toFixed(0)),
      ].join(" · ")
    : "no range recorded yet";

  const trace = geo ? (
    <svg className="sensor-tile__trace" viewBox={"0 0 240 " + TRACE_HEIGHT}
      preserveAspectRatio="none" aria-hidden="true">
      <path d={geo.area} fill={accent} opacity="0.13" />
      {geo.warnY != null && (
        <line x1="3" x2="237" y1={geo.warnY} y2={geo.warnY} stroke="var(--warning-fg)"
          strokeWidth="1" strokeDasharray="3 3" opacity="0.5" vectorEffect="non-scaling-stroke" />
      )}
      <polyline points={geo.line} fill="none" stroke={accent} strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={geo.lastX} cy={geo.lastY} r="2.6" fill={accent}
        stroke="var(--surface-2)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  ) : null;

  const limitLine = !isFan && warn != null
    ? (ch.warn != null ? "Device limit " : "Host policy ") + warn + "°"
      + (danger != null ? " · critical " + danger + "°" : "")
    : null;

  return (
    <KPI
      icon={isFan ? "fan" : "thermometer"}
      label={ch.name}
      value={isFan ? value.toLocaleString() : value.toFixed(1)}
      unit={ch.unit}
      sub={stats}
      tone={tone}
      pin={pin}
      onView={onView}
      chart={
        <>
          {trace}
          {limitLine && <div className="sensor-tile__limit">{limitLine}</div>}
        </>
      }
      className="sensor-tile"
    />
  );
}

export { SensorTile };
