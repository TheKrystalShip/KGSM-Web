// fleetKpis.js — the twelve dashboard glance figures, derived in one place.
//
// Each is a pure function over data the app already holds, so a tile is a render of one of these
// and nothing else. They live apart from any component because each tile is independently
// pinnable: twelve tiles that each recomputed inside their own body would be twelve copies of these
// rules, free to drift.
//
// The split is by question, not by source. The first six ask "what is happening on the fleet", the
// second six "what needs me". Nothing here restates an instantaneous machine reading — the capacity
// strip already renders per-node CPU, RAM, disk and round-trip. What that never shows is TIME,
// which is why half of these are windowed.
//
// THE RULE THROUGHOUT: a figure that cannot be measured is null, and the tile says so. Never a zero
// standing in for "nobody could tell me", because a zero from a blind fleet reads as a clean bill of
// health.

import { capUsable } from "../../lib/capabilities.js";
import { availabilityRollup, driftRollup, scheduleRollup, servicesRollup } from "../../lib/fleetOps.js";
import { crashes, playersPeak, sessionHours, timeToReady, uniquePlayers } from "../../lib/fleetStats.js";

const HOUR = 3600000;
const DAY = 24 * HOUR;

// ---- Row 1 · the fleet and the people ------------------------------------

// Servers running — the one figure that is purely a count of now, and the anchor the rest hang off.
// The bar is the whole fleet in one line: running, mid-transition, stopped.
const TRANSITIONAL = ["starting", "restarting", "stopping", "updating", "installing"];
function running(servers) {
  const count = servers.filter(s => s.status === "online").length;
  const transitional = servers.filter(s => TRANSITIONAL.includes(s.status)).length;
  return {
    count, transitional,
    total: servers.length,
    pct: servers.length ? (count / servers.length) * 100 : 0,
  };
}

// Players online now, and the most at once in the last day. Both exclude servers whose presence this
// host cannot see: a server that reports no roster emits no join/leave either, so counting it as
// zero would understate the live figure and the reconstruction alike.
function players(servers, audit, now) {
  const current = servers.reduce((n, s) => n + (s.players ? s.players.current : 0), 0);
  const unseen = servers.filter(s => !s.players && s.status !== "offline").length;
  return { current, unseen, peak: playersPeak(audit, current, DAY, now) };
}

// How many different people played this week — the figure a community host actually cares about,
// and the only one here that says whether the thing is being used at all.
const weeklyPlayers = (audit, now) => uniquePlayers(audit, 7 * DAY, now);

// Time spent connected in the last day, summed across everybody. Sessions whose start fell outside
// the loaded feed are excluded rather than clamped, so this is a floor whenever `unpaired` is set.
const played = (audit, now) => sessionHours(audit, DAY, now);

// Availability — uptime as a fraction of the time something WANTED each server up, folded by the
// backend from the engine's own lifecycle events. A deliberately stopped server lowers the
// denominator instead of the score, so an idle fleet reads "—" rather than a flattering 100%.
function availability(ops) {
  const roll = availabilityRollup(ops);
  const pct = roll.pct == null ? null : roll.pct * 100;
  return {
    ...roll, pct,
    tone: pct == null ? "muted" : pct >= 99.9 ? "ok" : pct >= 99 ? "warn" : "danger",
  };
}

// How long a server takes to become connectable — start → ready, averaged. Catches a boot
// regression after an update, which nothing else here would show until somebody complained.
const timeToReadyRollup = (audit, now) => timeToReady(audit, 7 * DAY, now);

// ---- Row 2 · what needs me ------------------------------------------------

// Desired-state drift — instances the supervisor was told to run that are not running. Deliberately
// separate from the crash count beside it: a crash the watchdog recovered from leaves no drift, and
// drift with no recent crash is the case nobody ever notices.
function drift(ops) {
  const roll = driftRollup(ops);
  return { ...roll, tone: roll.count === 0 ? (roll.unknownNodes ? "muted" : "ok") : "danger" };
}

// Crashes in the last day. Detection is the watchdog's job, so a node whose watchdog is down makes
// the whole count unstateable — reporting zero from a blind fleet would be a lie.
function crashes24h(audit, hosts, now) {
  const roll = crashes(audit, DAY, now);
  const blind = hosts.length > 0 && hosts.some(h => !capUsable(h, "watchdog"));
  return {
    ...roll, blind,
    tone: blind ? "muted" : roll.count === 0 ? "ok" : roll.count < 3 ? "warn" : "danger",
  };
}

// Updates available, and how long the oldest has been outstanding. The age is what separates "a new
// build exists" from "this has been overdue a week"; it comes from the engine's own first notice and
// is null until the backend can date one — never derived from the check time.
function updates(servers) {
  const list = servers.filter(s => s.update_available && s.status !== "updating");
  const stamps = list
    .map(s => (s.update_available_since ? +new Date(s.update_available_since) : null))
    .filter(t => t != null && Number.isFinite(t));
  return { list, count: list.length, oldest: stamps.length ? Math.min(...stamps) : null };
}

// Backups, looking both ways: the worst-case gap behind us and the next run ahead.
//
// The "oldest" is the MOST-OVERDUE server, not the most recent — the one actually at risk is what
// should surface. A server the backend scanned and found EMPTY outranks every aged backup, because
// having none at all is a wider gap than having an old one; it carries no age, so it takes the tile
// outright rather than competing on the date axis (ranking it as infinitely old would be inventing a
// timestamp). Only `backup_count === 0` qualifies — null means unscanned, which is unknown and never
// counts as unprotected.
const backupTs = (s) => (s.last_backup?.createdAt ? +new Date(s.last_backup.createdAt) : null);
function backups(servers, ops, now) {
  const dated = servers.filter(s => backupTs(s) != null);
  const oldest = dated.reduce((worst, s) => (!worst || backupTs(s) < backupTs(worst)) ? s : worst, null);
  const never = servers.filter(s => s.backup_count === 0);
  const unscanned = servers.filter(s => s.backup_count == null && !s.last_backup).length;
  const ageMs = oldest ? (now - backupTs(oldest)) : 0;
  const sched = scheduleRollup(ops, now);
  return {
    oldest, never, unscanned, ageMs, sched,
    tone: never.length ? "danger"
      : !oldest ? "muted"
        : ageMs > 24 * HOUR ? "danger" : ageMs > 12 * HOUR ? "warn" : "ok",
  };
}

// Schedules that last ran badly — a silent failure class with no other surface here: a backup
// schedule can fail every night and nothing else on the page would move, because the server itself
// is perfectly healthy. Only an explicit false counts; a schedule that has never run is null.
function schedules(ops, now) {
  const roll = scheduleRollup(ops, now);
  return {
    ...roll,
    tone: roll.failures.length ? "danger" : roll.unknownNodes ? "muted" : "ok",
  };
}

// Leaves doing their job, counted by the same rule the Services board renders — so a
// socket-activated leaf resting between calls reads healthy here too, rather than as a fault.
function services(ops) {
  const roll = servicesRollup(ops);
  return {
    ...roll,
    tone: !roll.total ? "muted"
      : roll.unhealthy.length === 0 ? "ok"
        : roll.unhealthy[0].tone === "down" ? "danger" : "warn",
  };
}

// ---- Formatting -----------------------------------------------------------
// Beside the figures rather than in lib/formatting.js, because each is the shape ONE of these
// answers is read in and nothing else in the panel wants them.

// A duration in the largest unit that still says something: minutes below an hour, then hours, then
// days with the remaining hours.
function fmtDur(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return m + "m";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h";
  const d = Math.floor(h / 24), rh = h % 24;
  return rh ? `${d}d ${rh}h` : `${d}d`;
}

// Sub-minute stays in seconds: a server that boots in 40s and one that takes 3m are a different
// experience, and "1m" would flatten both.
function fmtSecs(sec) {
  if (sec == null) return "—";
  if (sec < 90) return Math.round(sec) + "s";
  const m = Math.round(sec / 60);
  return m < 60 ? m + "m" : Math.floor(m / 60) + "h " + (m % 60) + "m";
}

// The "· 2 nodes unknown" suffix for a figure some nodes could not contribute to. The count is then
// a floor, and every tile that can have one says so.
const partial = (n) => (n > 0 ? ` · ${n} node${n === 1 ? "" : "s"} unknown` : "");

export {
  DAY, HOUR,
  availability, backups, crashes24h, drift, fmtDur, fmtSecs, partial, played, players, running,
  schedules, services, timeToReadyRollup, updates, weeklyPlayers,
};
