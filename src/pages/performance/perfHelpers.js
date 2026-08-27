// perfHelpers — pure constants + formatters for the Performance tab. No React, so the tab file
// holds only its two stateful views (Live / Historical) and the orchestrator between them.

import { actionCategory, auditTone, humanizeAction } from "../../lib/formatting.js";

export const BUFFER_CAP = 150;
export const STALE_MS   = 10000;
export const NO_SOURCE_MS = 9000;

// The recorded windows the history store serves. `live` is a separate thing entirely — a subscription to
// a metrics tick, not a query — so it is kept out of this list and prepended only where such a feed
// actually exists. A surface with no live source must never offer the button: a "Live" range that
// quietly re-read history would be claiming a feed that isn't there.
export const HISTORY_RANGES = [
  { key: "1h",   label: "1h" },
  { key: "24h",  label: "24h" },
  { key: "7d",   label: "7d" },
  { key: "30d",  label: "30d" },
];

export const RANGES = [{ key: "live", label: "Live" }, ...HISTORY_RANGES];

export const RANGE_MS = { "1h": 3600e3, "24h": 86400e3, "7d": 7 * 86400e3, "30d": 30 * 86400e3 };

// The audit rows worth pinning to a metrics timeline: what happened to the server itself and who
// was on it, the two things a reading of its CPU and memory is read against. Both are NAMESPACES,
// so an event either of them grows is flagged with nothing added here. A flag's colour is the tone
// its producer's severity gives it and its label is the event's own name spelled for a person.
const FLAGGED_CATEGORIES = new Set(["server", "player"]);

export function rowsToEvents(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter(r => r && FLAGGED_CATEGORIES.has(actionCategory(r.action)))
    .map(r => ({ t: Date.parse(r.ts), label: humanizeAction(r.action), tone: auditTone(r) }))
    .filter(e => isFinite(e.t));
}

export const KiB = 1024, MiB = 1024 * 1024, GiB = 1024 * 1024 * 1024;

export function fmtBytes(n) {
  if (n == null || !isFinite(n)) return "—";
  if (n >= GiB) return (n / GiB).toFixed(2) + " GiB";
  if (n >= MiB) return (n / MiB).toFixed(1) + " MiB";
  if (n >= KiB) return (n / KiB).toFixed(0) + " KiB";
  return Math.round(n) + " B";
}
export function fmtBps(n) {
  if (n == null || !isFinite(n)) return "—";
  if (n >= MiB) return (n / MiB).toFixed(1) + " MiB/s";
  if (n >= KiB) return (n / KiB).toFixed(0) + " KiB/s";
  return Math.round(n) + " B/s";
}

// Summary stats over the visible window (#2). Nulls are skipped, never coerced
// to 0 — an all-null window has no honest avg/peak, so the strip is omitted.
export function seriesStats(vals) {
  let mn = Infinity, mx = -Infinity, sum = 0, n = 0;
  for (const v of vals) {
    if (v == null || !isFinite(v)) continue;
    if (v < mn) mn = v; if (v > mx) mx = v; sum += v; n++;
  }
  return n ? { min: mn, max: mx, avg: sum / n } : null;
}

// Compact "HH:MM–HH:MM" (or with date across days) for the zoom-window pill.
export function fmtZoomRange([ms0, ms1]) {
  const p2 = n => String(n).padStart(2, "0");
  const multiDay = (ms1 - ms0) > 86400e3 || new Date(ms0).getDate() !== new Date(ms1).getDate();
  const f = ms => {
    const d = new Date(ms);
    const t = `${p2(d.getHours())}:${p2(d.getMinutes())}`;
    return multiDay ? `${d.toLocaleString(undefined, { month: "short" })} ${d.getDate()} ${t}` : t;
  };
  return f(ms0) + "–" + f(ms1);
}
