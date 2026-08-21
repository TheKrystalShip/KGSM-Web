// palette/score.js — how a typed query is matched against an entry, and where the match landed.
//
// SUBSEQUENCE, not substring: "mcsv" has to find "minecraft_survival", because people type the shape
// of a name rather than a slice of it. A substring match still wins when there is one — it is a
// stronger signal — so the two live in one function with the contiguous case first.
//
// The score is the whole reason this file exists. Two hundred entries all match something; ordering
// is what makes the one you meant the one under the cursor, and every bonus below is about a
// different way a match can be more or less like what a person had in mind:
//
//   * earlier in the string beats later — you type the start of a name, not the middle
//   * a word boundary beats the middle of a word — "sur" in "minecraft_survival" is a real hit,
//     the "sur" inside "measure" is a coincidence
//   * contiguous beats scattered, and each additional adjacent character is worth more than the
//     last, so a tight run pulls decisively ahead of a lucky spread of letters
//
// Pure, and it imports NOTHING. That is deliberate: it makes the ranking assertable straight out of
// the module graph (`vite.ssrLoadModule`) with no browser and no React, which matters because this
// repo has no unit-test runner and ranking is exactly the kind of logic that rots silently.

// What counts as the start of a word. Server ids are full of underscores and dots, and a person
// typing "survival" means the second half of `minecraft_survival` — so those separators have to
// score like a space does.
const WORD_BREAK = /[\s._\-/:·]/;

/// Match `query` against `text`.
///
/// Returns `null` for no match at all, otherwise `{ score, ranges }` where ranges are
/// [start, end) index pairs into `text` — what the UI draws as hit marks.
///
/// An empty query matches everything at score 0, so an unfiltered list keeps its natural order.
function fuzzy(query, text) {
  const q = String(query || "").toLowerCase().trim();
  const raw = String(text || "");
  if (!q) return { score: 0, ranges: [] };
  if (!raw) return null;
  const t = raw.toLowerCase();

  // ---- contiguous ----
  // A run of the exact characters, in order, with nothing between them. Always preferred: it is the
  // difference between "start" finding the verb and "start" finding s-t-a-r-t scattered through
  // "stationeers restart".
  const at = t.indexOf(q);
  if (at >= 0) {
    let s = 600 + q.length * 10;
    if (at === 0) s += 400;                                   // typed from the beginning
    else if (WORD_BREAK.test(t[at - 1])) s += 250;            // beginning of a word
    s -= Math.min(200, at * 3);                               // the later it starts, the weaker
    return { score: s, ranges: [[at, at + q.length]] };
  }

  // ---- subsequence ----
  const ranges = [];
  let ti = 0;
  let s = 0;
  let run = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi];
    let found = -1;
    while (ti < t.length) {
      if (t[ti] === c) { found = ti; break; }
      ti++;
    }
    if (found < 0) return null;                               // a character with nowhere to go

    const last = ranges.length ? ranges[ranges.length - 1] : null;
    if (last && last[1] === found) {
      last[1] = found + 1;                                    // extends the run
      run += 1;
      s += 14 + run * 5;                                      // adjacency compounds
    } else {
      ranges.push([found, found + 1]);
      run = 0;
      s += 4;
      if (found === 0 || WORD_BREAK.test(t[found - 1])) s += 34;   // landed on a word start
    }
    ti = found + 1;
  }

  // A match spread over many separate places is a weak one however many characters it found.
  s -= Math.min(90, (ranges.length - 1) * 14);
  return { score: Math.max(1, s), ranges };
}

/// Split `text` into `{ text, hit }` segments from the ranges `fuzzy` returned, so the caller can
/// render the matched characters without doing index arithmetic in JSX.
function segments(text, ranges) {
  const raw = String(text || "");
  if (!ranges || !ranges.length) return [{ text: raw, hit: false }];
  const out = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start > cursor) out.push({ text: raw.slice(cursor, start), hit: false });
    out.push({ text: raw.slice(start, end), hit: true });
    cursor = end;
  }
  if (cursor < raw.length) out.push({ text: raw.slice(cursor), hit: false });
  return out;
}

/// Rank entries against a query.
///
/// The TITLE is what is matched and marked. A subtitle is matched too but at a heavy discount and it
/// is never marked: "hotrod" appears under most of the fleet, so letting it score like a name would
/// put every server in the list whenever somebody typed a node.
///
/// `entry.weight` is the type's own standing (an action outranks a theme at equal text score), and
/// `entry.boost` is per-instance — a running server ahead of a stopped one.
///
/// `boostOf` is habit: an optional `id => number` (recents.js) that adds what an entry has earned by
/// being used. It is an argument rather than an import because this file resolves a query against a
/// list and nothing else — reading a browser's storage from inside the matcher would make ranking
/// untestable outside a browser, which is the one thing this file is built to avoid.
///
/// Ties break on the original order, which is the order the sources declared: deliberate, and stable
/// across keystrokes so the selection does not jump between two equally good matches.
function rank(query, entries, limit = 60, boostOf = null) {
  const q = String(query || "").trim();
  const out = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const m = fuzzy(q, e.title);
    let s;
    let ranges;
    if (m) {
      s = m.score;
      ranges = m.ranges;
    } else if (q && e.sub) {
      const ms = fuzzy(q, e.sub);
      if (!ms) continue;
      s = ms.score * 0.35;                                    // found, but not by name
      ranges = [];
    } else {
      continue;
    }
    const habit = boostOf ? (boostOf(e.id) || 0) : 0;
    out.push({ entry: e, score: s + (e.weight || 0) + (e.boost || 0) + habit, ranges, i });
  }
  out.sort((a, b) => (b.score - a.score) || (a.i - b.i));
  return out.slice(0, limit);
}

export { fuzzy, rank, segments };
