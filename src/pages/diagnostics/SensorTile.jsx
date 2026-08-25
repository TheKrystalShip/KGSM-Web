import React from "react";
import { KPI } from "../../components/KPI.jsx";
import { useStore } from "../../lib/store.js";
import { hostsStore } from "../../lib/stores.js";
import { fetchSensorHistory, fetchSensorSummary } from "../../lib/stores/hosts.js";
import { api } from "../../lib/apiClient.js";

// SensorTile — ONE hwmon channel as a glance card: the reading now, its range over the window, and a
// trace with the line it is judged against drawn where that line falls.
//
// The number answers "what is it"; the trace answers "where is it going", which a number cannot. The
// line matters because headroom is the actual question — 72 °C means nothing until you know whether
// this device is rated to 80 or to 95, and different devices on one host are rated differently.
//
// Binds to a host and a sensor id, reads both itself, and so renders identically on a page and pinned.

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

function SensorTile({ hostId, sensorId, range = "1h", pin, onView }) {
  const hosts = useStore(hostsStore, (s) => s.list);
  const [points, setPoints] = React.useState(null);
  const [summary, setSummary] = React.useState(null);
  const [policy, setPolicy] = React.useState(null);

  const host = (hosts || []).find((h) => h.id === hostId) || null;
  const sensor = host && (host.sensors || []).find((s) => s.id === sensorId);
  const fan = host && (host.fans || []).find((f) => f.id === sensorId);
  const isFan = !sensor && !!fan;
  const reading = sensor || fan || null;

  React.useEffect(() => {
    let alive = true;
    if (!hostId || !sensorId) return undefined;
    fetchSensorHistory(hostId, sensorId, range)
      .then((r) => {
        if (!alive) return;
        const series = (r && r.series) || {};
        setPoints(series.tempC || series.rpm || []);
      })
      .catch(() => { if (alive) setPoints(null); });
    return () => { alive = false; };
  }, [hostId, sensorId, range]);

  React.useEffect(() => {
    let alive = true;
    if (!hostId) return undefined;
    fetchSensorSummary(hostId, range)
      .then((r) => {
        if (!alive) return;
        setSummary(((r && r.entries) || []).find((e) => e.entityId === sensorId) || null);
      })
      .catch(() => { if (alive) setSummary(null); });
    return () => { alive = false; };
  }, [hostId, sensorId, range]);

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
  if (!host || !reading) {
    return (
      <KPI icon="thermometer" label="Sensor" tone="muted" value="—"
        sub={host ? "This channel is no longer reported" : "Node unavailable"} pin={pin} onView={onView} />
    );
  }

  const warn = isFan ? null : reading.limit_high_c ?? (policy ? policy.warn : null) ?? null;
  const danger = isFan ? null : reading.limit_critical_c ?? (policy ? policy.danger : null) ?? null;
  const value = isFan ? reading.rpm : reading.value_c;

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
    ? (reading.limit_high_c != null ? "Device limit " : "Host policy ") + warn + "\u00b0"
      + (danger != null ? " \u00b7 critical " + danger + "\u00b0" : "")
    : null;

  return (
    <KPI
      icon={isFan ? "fan" : "thermometer"}
      label={reading.name || reading.chip}
      value={isFan ? value.toLocaleString() : value.toFixed(1)}
      unit={isFan ? "RPM" : "\u00b0C"}
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
