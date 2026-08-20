// fleetStats.js — the dashboard's windowed figures, derived from the audit feed.
//
// Pure functions over the rows `auditStore` already holds, so the summary band costs no extra
// request. They share one honesty rule, and it is the reason each result carries a `covered`
// field rather than a bare number: the store keeps a CAPPED page of history (AUDIT_CAP rows,
// newest first), so on a busy cluster the oldest row it holds can be newer than the window
// asked for. A figure computed over a partial window is not wrong, but calling it "24h" when
// it covers six is — so every function reports the span it actually saw and the caller says so.
//
// Nothing here infers a player or a server it did not see an event for. A count these can't
// establish is null, never zero.

import { parseTs } from "./formatting.js";

const HOUR = 3600000;

// An event's instant in epoch-ms, or null when it carries none this can read. `parseTs` takes a
// string and returns a Date, so a row with a missing or malformed `ts` must not reach it — and a
// row that cannot be placed in time is skipped rather than counted at the epoch.
function tsOf(ev) {
  if (!ev || typeof ev.ts !== "string") return null;
  const ms = +parseTs(ev.ts);
  return Number.isFinite(ms) ? ms : null;
}

// How far back the loaded rows actually reach, and whether that covers the window. `rows` is the
// audit list newest-first, so the last one is the oldest held. A store that hasn't loaded, or a
// cluster with no history at all, covers nothing.
function coverage(rows, windowMs, now) {
  if (!rows || !rows.length) return { from: null, covered: false, fullSpan: false };
  const oldest = tsOf(rows[rows.length - 1]);
  if (oldest == null) return { from: null, covered: false, fullSpan: false };
  const wantFrom = now - windowMs;
  // A page that ran to the end of the log covers the window even when its oldest row is newer:
  // there is nothing older to have missed. The store can't tell us that, so the conservative
  // reading is the one taken — a short page reports a short span.
  return { from: Math.max(oldest, wantFrom), covered: oldest <= wantFrom, fullSpan: oldest <= wantFrom };
}

// Rows of one action inside the window, newest first (the store's own order).
function inWindow(rows, windowMs, now, match) {
  const from = now - windowMs;
  const out = [];
  for (const ev of rows || []) {
    const ts = tsOf(ev);
    // A row this can't place in time is skipped, never treated as the window's edge — one malformed
    // timestamp would otherwise end the walk and silently shorten every figure below it.
    if (ts == null) continue;
    if (ts < from) break; // newest-first: the first row past the edge ends the walk
    if (match(ev)) out.push(ev);
  }
  return out;
}

const playerIdOf = (ev) => (ev.meta && (ev.meta.playerId || ev.meta.sessionKey || ev.meta.playerName)) || null;
const sessionKeyOf = (ev) => (ev.meta && (ev.meta.sessionKey || ev.meta.playerId)) || null;

// ---------- Concurrency ----------

// The most people connected at once during the window, reconstructed BACKWARDS from the count
// that is true right now.
//
// Walking backwards is what makes this measurable at all: the live total is a fact the roster
// reports, and each join/leave says how the total differed a moment before it. Walking forwards
// would need a starting total nobody recorded, and assuming zero would report every peak as the
// number of joins since the log began.
//
// `current` must be the same total the tile shows (nulls excluded — an unobservable server
// contributes neither to the total nor to this reconstruction, because it emits no events either).
function playersPeak(rows, current, windowMs, now) {
  const cov = coverage(rows, windowMs, now);
  if (current == null) return { peak: null, ...cov };

  let count = current;
  let peak = current;
  const events = inWindow(rows, windowMs, now,
    ev => ev.action === "player.join" || ev.action === "player.leave");

  for (const ev of events) {
    // Undo this event to learn the count immediately before it.
    if (ev.action === "player.join") count -= 1;
    else count += 1;
    if (count > peak) peak = count;
  }

  // A negative walk means the window opened mid-session for someone whose join we never saw; the
  // peak is still the largest total actually reconstructed, so it stands.
  return { peak: Math.max(peak, current), ...cov };
}

// ---------- Distinct people ----------

// How many different people joined anything during the window, and how many servers saw one.
// Identity is the engine's player id where it has one — `sessionKey` and the name are fallbacks in
// that order, matching the roster's own name-first dedup — so one person on two servers counts once.
function uniquePlayers(rows, windowMs, now) {
  const cov = coverage(rows, windowMs, now);
  const people = new Set();
  const servers = new Set();
  for (const ev of inWindow(rows, windowMs, now, ev => ev.action === "player.join")) {
    const id = playerIdOf(ev);
    if (id) people.add(id);
    if (ev.serverId) servers.add(ev.serverId);
  }
  return { count: people.size, servers: servers.size, ...cov };
}

// ---------- Time played ----------

// Total time people spent connected during the window, in hours.
//
// A session is a join paired with the leave that carries the same key on the same server. Three
// cases, and the third is why this reports `unpaired`:
//   · join and leave both inside  → the whole session
//   · join inside, still connected → join → now (a session in progress is time already spent)
//   · leave inside, join outside   → SKIPPED, and counted as unpaired
// The last one cannot be dated without inventing a start, and clamping it to the window edge would
// manufacture exactly as much time as the window happens to be long.
function sessionHours(rows, windowMs, now) {
  const cov = coverage(rows, windowMs, now);
  const events = inWindow(rows, windowMs, now,
    ev => ev.action === "player.join" || ev.action === "player.leave");

  // Newest-first, so a leave is met before its join. Hold the leave, then close it on the join.
  const openLeaves = new Map(); // key -> leave ts
  // Keys already charged as "still connected". A key can only be open once, so a second join with no
  // leave between them is an event the engine repeated — counting it again would bill one person twice.
  const stillOn = new Set();
  let ms = 0;
  let sessions = 0;
  let unpaired = 0;
  // Server + player, joined on a separator neither can contain, so two people whose ids concatenate
  // to the same string on different servers cannot be paired with each other's sessions.
  const key = (ev) => (ev.serverId || "") + "\u0000" + (sessionKeyOf(ev) || "");

  for (const ev of events) {
    const k = key(ev);
    const ts = tsOf(ev);
    if (ts == null) continue;
    if (ev.action === "player.leave") {
      // A second leave with no join between them is a repeat the engine emitted; keep the newest.
      if (!openLeaves.has(k)) openLeaves.set(k, ts);
    } else if (openLeaves.has(k)) {
      ms += Math.max(0, openLeaves.get(k) - ts);
      openLeaves.delete(k);
      sessions++;
    } else if (!stillOn.has(k)) {
      // A join with no leave after it: still connected. Time to now is time really spent.
      stillOn.add(k);
      ms += Math.max(0, now - ts);
      sessions++;
    }
  }

  unpaired = openLeaves.size;
  return { hours: ms / HOUR, sessions, unpaired, ...cov };
}

// ---------- How long a server takes to come up ----------

// The gap between a server being started and it reporting itself ready — the moment people can
// actually connect. Averaged across the window, with the slowest named.
//
// Only a start that HAS a ready is measured. A start still booting, or one whose ready fell off the
// end of the loaded page, has no duration yet — averaging it in at zero would report a fleet as
// faster the more of it is currently starting.
function timeToReady(rows, windowMs, now) {
  const cov = coverage(rows, windowMs, now);
  const events = inWindow(rows, windowMs, now,
    ev => ev.action === "server.start" || ev.action === "server.ready" || ev.action === "server.restart");

  const pendingReady = new Map(); // serverId -> ready ts (newest-first: ready comes before its start)
  const durations = [];
  for (const ev of events) {
    const id = ev.serverId;
    const ts = tsOf(ev);
    if (!id || ts == null) continue;
    if (ev.action === "server.ready") {
      pendingReady.set(id, ts);
    } else if (pendingReady.has(id)) {
      const sec = Math.max(0, (pendingReady.get(id) - ts) / 1000);
      pendingReady.delete(id);
      durations.push({ id, name: (ev.target && ev.target.name) || id, sec });
    }
  }

  if (!durations.length) return { avgSec: null, slowest: null, samples: 0, ...cov };
  const avgSec = durations.reduce((n, d) => n + d.sec, 0) / durations.length;
  const slowest = durations.reduce((w, d) => (d.sec > w.sec ? d : w), durations[0]);
  return { avgSec, slowest, samples: durations.length, ...cov };
}

// ---------- Crashes ----------

// Unplanned stops in the window, newest first. The watchdog catches these at the process level, so
// it is game-agnostic — and it is also why a host whose watchdog is down cannot report a count at
// all (the caller checks the capability; a zero from a blind fleet would be a lie).
function crashes(rows, windowMs, now) {
  const cov = coverage(rows, windowMs, now);
  const list = inWindow(rows, windowMs, now, ev => ev.action === "server.crash");
  return { count: list.length, last: list[0] || null, ...cov };
}

export { coverage, crashes, playersPeak, sessionHours, timeToReady, uniquePlayers };
