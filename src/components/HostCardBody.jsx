import React from "react";
import { Icon } from "./Icon.jsx";
import { capUsable } from "../lib/capabilities.js";
import { sessionStore } from "../lib/sessionStore.js";
import { hostsStore } from "../lib/stores.js";
import { fmtRelative } from "../lib/formatting.js";
import { hostCapacityMeters } from "./host-helpers.jsx";

// HostCardBody — shared host-monitoring primitives.
//
// FleetHostCard (the Fleet grid card) and DashFleetStrip (the Dashboard
// "Fleet capacity" rows) are two different LAYOUTS of the same underlying
// thing: one host's live health. Each used to re-derive the worst-meter tone
// and re-render the mini-meter bars by hand, so the two could silently drift
// (e.g. one teaching about metrics-down hosts, the other not). These two
// primitives are the single source of truth they both read from.

// hostHealth(host) → the health snapshot that drives a card/row's border,
// status dot and meter area. Mirrors the capability checks the rest of the
// panel uses: denied (no Discord role) → danger, offline → off, live-metrics
// capability down → warn, otherwise the worst of the live meters.
function hostHealth(host) {
  const denied = !!sessionStore.isDenied(host.id);
  // The host's live-metrics capability can fail independently of the host
  // being online — degrade gracefully when it's not usable.
  const metricsUsable = capUsable(host, "metrics");
  const metricsDown = !denied && host.online && !metricsUsable;
  const hasTelemetry = host.online && !denied && metricsUsable && !!host.ram && host.ram.total_gb > 0;
  const meters = hasTelemetry ? hostCapacityMeters(host) : [];
  // The one meter worth naming. Tone ranks first; a TIE is broken by how far past
  // each meter's own amber line it sits, because the three lines are 60/70/80 and a
  // raw percentage comparison would name CPU 71% over memory 84% — both amber, but
  // only one of them is nearly out of room.
  const rank = { success: 0, warn: 1, danger: 2 };
  const over = (m) => (m.warnAt ? m.pct / m.warnAt : m.pct / 100);
  const worst = meters.length
    ? meters.reduce((w, m) => (rank[m.tone] > rank[w.tone] || (rank[m.tone] === rank[w.tone] && over(m) > over(w)) ? m : w), meters[0])
    : null;
  const tone = denied ? "danger"
    : !host.online ? "off"
    : metricsDown ? "warn"
    : (worst ? worst.tone : "success");
  return { denied, metricsUsable, metricsDown, hasTelemetry, meters, worst, tone };
};

// HostMeters — the mini-meter bar row (CPU / RAM / disk). Pixel-identical
// wherever it appears; the parent supplies the wrapper element
// (.fleet-card__meters vs .dash-node__meters) and its layout.
//
// `detail` adds the absolute reading under each bar — "load 2.1 · 16 cores",
// "18.2 / 62.7 GB", "/ · 392 / 953 GB" — which is the number an operator
// actually reasons with, plus the meter's flag (swap rising, SMART) when it
// carries one. Off by default: the fleet card is a glance surface with no room
// for it, the dashboard's node drawer is opened precisely to read it.
function HostMeters({ meters, detail = false }) {
  return (
    <React.Fragment>
      {meters.map(m => (
        <div key={m.key} className={"fleet-meter fleet-meter--" + m.tone}>
          <div className="fleet-meter__top"><span>{m.label}</span><b>{m.value}</b></div>
          <div className="fleet-meter__track"><i style={{ width: Math.max(2, Math.min(100, m.pct)) + "%" }}></i></div>
          {detail && (m.detail || m.flag) && (
            <div className="fleet-meter__sub">
              {m.detail}
              {m.flag && <span className="fleet-meter__flag"><Icon name="triangle-alert" size={10} strokeWidth={2.4} />{m.flag}</span>}
            </div>
          )}
        </div>
      ))}
    </React.Fragment>
  );
}

// hostMetricsFreshness(host) → how trustworthy this host's live metrics are
// right now, the single source of truth for the diagnostics "frozen" treatment.
//
//   state "live"   — fresh sample within the expected cadence; render normally.
//   state "frozen" — we HAVE numbers but they've stopped updating (the metrics
//                    capability is down/degraded, or the last sample is older
//                    than ~3 expected intervals). Show the last reading dimmed
//                    and clearly marked, never as if it were live.
//   state "none"   — no numbers to show at all (denied / never reported).
//
// Keys off capabilities.metrics.last_sample_at (the backend's per-source
// freshness stamp) + info.interval_s for the staleness threshold.
function hostMetricsFreshness(host) {
  const rec = host && host.capabilities && host.capabilities.metrics;
  const intervalS = (rec && rec.info && rec.info.interval_s) || 10;
  const lastAt = rec && rec.last_sample_at ? new Date(rec.last_sample_at) : null;
  const ageMs = lastAt ? (Date.now() - lastAt.getTime()) : null;
  // Stale once we've missed ~3 expected samples, with a 30s floor so a fast
  // 5s cadence doesn't flip to "frozen" on a single hiccup.
  const staleMs = Math.max(intervalS * 3, 30) * 1000;
  const hasData = !!(host && host.cpu && Array.isArray(host.cpu.per_core) && host.cpu.per_core.length);
  const usable = capUsable(host, "metrics");
  const stale = !usable || (ageMs != null && ageMs > staleMs);
  const state = !hasData ? "none" : stale ? "frozen" : "live";
  return {
    state,
    frozen: state === "frozen",
    lastAt,
    ageMs,
    intervalS,
    staleMs,
    // "6m ago" style label for the last good sample.
    label: lastAt ? fmtRelative(lastAt, new Date()) : null,
    message: rec ? (rec.message || null) : null,
    since: rec ? (rec.since || null) : null,
  };
};

// serverMetricsFreshness(server) → the metrics-feed freshness for the HOST a
// server runs on. Metrics is a per-host capability, so a server's live
// performance numbers are only as fresh as its host's metrics exporter. Every
// per-server surface (tiles, charts) reads this so they all go dark together
// when the host feed drops. No host (unhydrated) → treat as live, never break.
function serverMetricsFreshness(server) {
  if (!server) return { state: "live", frozen: false, label: null };
  const host = server.hostId ? hostsStore.find(server.hostId) : null;
  if (!host || !hostMetricsFreshness) return { state: "live", frozen: false, label: null };
  return hostMetricsFreshness(host);
};

export { HostMeters, hostHealth, hostMetricsFreshness, serverMetricsFreshness };
