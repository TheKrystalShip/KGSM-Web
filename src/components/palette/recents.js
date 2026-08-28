// palette/recents.js — what you actually use, remembered, and what that is worth at rank time.
//
// Two questions, one table. At rest the palette lists where you have just been; while you type, the
// things you reach for often sit above the things you never touch. Both read the same record — an
// entry id against how many times it has been run and when it was last run.
//
// FRECENCY, not recency: a count alone makes a page you opened fifty times last month outrank the
// server you restarted an hour ago, and a timestamp alone throws away everything learned before the
// last click. So the weight is a use count that saturates, multiplied by a decay — half its value a
// week later — and the product is what ranks.
//
// THE BOOST IS CAPPED, and the cap is the whole safety property. At `MAX_BOOST` it can reorder
// entries whose text scores are close and can outweigh any `weight` a source declares (those span
// 5–120), but it cannot lift a weak match past a strong one: a match at the start of a title is
// worth +400 on its own (score.js). Habit breaks ties; it never overrules what was typed.
//
// The table is this browser's, like favorites and the theme — it never round-trips to a host.

const KEY = "krystal:palette:recent";

// How many rows survive a prune, and how many are rendered at rest. Kept apart because the ranking
// half wants a long memory and the resting list wants a short one — five rows is a glance.
const KEEP = 40;
const SHOWN = 5;

const HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;
// Uses past this teach nothing more: the difference between once and five times is the signal, the
// difference between fifty and sixty is not.
const FULL_USES = 5;
const MAX_BOOST = 90;

/// The stored table, with every malformed row dropped rather than trusted.
function read() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out = {};
    for (const id of Object.keys(raw)) {
      const rec = raw[id];
      if (!rec || typeof rec !== "object") continue;
      const n = Number(rec.n);
      const t = Number(rec.t);
      if (!(n > 0) || !(t > 0)) continue;
      out[id] = { n, t };
    }
    return out;
  } catch { return {}; }
}

function write(table) {
  try { localStorage.setItem(KEY, JSON.stringify(table)); } catch {
    /* storage blocked — a palette that forgets still works, so this is never worth failing over */
  }
}

/// 0…1. Decay times a saturating use count, so an old habit fades and a new one takes hold.
function weightOf(rec, now) {
  const recency = Math.pow(0.5, Math.max(0, now - rec.t) / HALF_LIFE_MS);
  const uses = Math.min(1, rec.n / FULL_USES);
  return recency * (0.45 + 0.55 * uses);
}

/// Record one run. Pruning by WEIGHT rather than by age is what keeps a daily habit through a week
/// of not using it, while a one-off from the same afternoon falls out.
function noteUse(id) {
  if (!id) return;
  const now = Date.now();
  const table = read();
  const prev = table[id];
  table[id] = { n: (prev ? prev.n : 0) + 1, t: now };

  const ids = Object.keys(table);
  if (ids.length > KEEP) {
    ids.sort((a, b) => weightOf(table[b], now) - weightOf(table[a], now));
    for (const dead of ids.slice(KEEP)) delete table[dead];
  }
  write(table);
}

/// The resting list: most recently run first. Strictly by time — "Recent" is a claim about when,
/// and ordering it by frecency would put something from Tuesday above what was just run.
function recentIds() {
  const table = read();
  return Object.keys(table).sort((a, b) => table[b].t - table[a].t).slice(0, SHOWN);
}

/// A snapshot of every id's boost, as a lookup `rank` can call per entry.
///
/// Taken ONCE per open on purpose: the table changes as things are run, and a boost that moved
/// between keystrokes would reorder the list under a cursor that had not moved.
function boostSnapshot() {
  const table = read();
  const now = Date.now();
  const map = new Map();
  for (const id of Object.keys(table)) {
    const b = Math.round(MAX_BOOST * weightOf(table[id], now));
    if (b > 0) map.set(id, b);
  }
  return (id) => map.get(id) || 0;
}

export { MAX_BOOST, boostSnapshot, noteUse, recentIds, weightOf };
