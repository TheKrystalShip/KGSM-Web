// merge.js — pure roll-up of per-host data into the single aggregated view the
// SPA renders (Slice B, N-host fan-out).
//
// kgsm-api is PER-HOST: each connected host answers only for itself. The SPA is
// the multi-host client — it fans a read out across every connection and merges
// the results here. These functions are PURE (arrays in, array out) so they're
// unit-tested with synthetic 2-host inputs; N≥2 can't be exercised against a
// single live backend, so the tests are the contract.
//
// Every row already carries its owning host (adaptServer.hostId, adaptHost.id,
// audit row hostId, alert hostId) stamped by the backend that served it — merge
// never invents attribution, it only unions and de-dups.

// Concatenate per-host arrays and de-dup by `id`, last-writer-wins. Used for the
// flat, host-tagged collections (servers, hosts, alerts) where each id is owned
// by exactly one host so there's no real collision — the de-dup is defensive.
function concatById(lists) {
  const byId = new Map();
  for (const list of lists) for (const row of (list || [])) {
    if (row && row.id != null) byId.set(row.id, row);
  }
  return [...byId.values()];
}

export const mergeServers = (lists) => concatById(lists);
export const mergeHosts = (lists) => concatById(lists);
export const mergeAlerts = (lists) => concatById(lists);

// Library is the one collection where the SAME id legitimately appears on
// multiple hosts: a game can be installable on host A AND host B. We de-dup by
// game id and UNION the per-host availability into `hosts` (the offering the
// LibraryPage reads to show "available on" + scope install targets). Each input
// list is tagged with the source hostId (the fan-out stamps `_srcHost`).
//
// A catalog entry is NOT one host's to dictate. Its art and RAWG text are that
// host's own cache state — a node whose hydration has not reached a game (no
// Steam capsule, no RAWG key) answers `cover: null, hero: null` for it, honestly.
// So the merge fills FIELD BY FIELD: the first host to carry a value for a field
// wins that field, and a host with nothing to say about it says nothing. Taking
// one host's whole entry instead would let whichever node the fan-out happened to
// reach first blank the art for the entire fleet. Absent is null or an empty
// list; a cover/hero URL is host-absolute and stays verbatim, so a filled field
// points at the node whose disk actually holds the bytes.
function absent(v) { return v == null || (Array.isArray(v) && v.length === 0); }

function fillGaps(entry, other) {
  let out = entry;
  for (const k of Object.keys(other)) {
    if (!absent(out[k]) || absent(other[k])) continue;
    if (out === entry) out = { ...entry };
    out[k] = other[k];
  }
  return out;
}

function mergeLibrary(taggedLists) {
  const byId = new Map();   // gameId -> { entry, hosts:Set }
  for (const { hostId, list } of taggedLists) {
    for (const g of (list || [])) {
      if (!g || g.id == null) continue;
      const cur = byId.get(g.id);
      if (!cur) { byId.set(g.id, { entry: g, hosts: new Set(hostId ? [hostId] : []) }); continue; }
      if (hostId) cur.hosts.add(hostId);
      cur.entry = fillGaps(cur.entry, g);
    }
  }
  // When sources carried a hostId, set the unioned offering. When none did (a
  // lone connection routed id-less), leave the entry as-is rather than clobbering
  // its offering with an empty set.
  return [...byId.values()].map(({ entry, hosts }) => (hosts.size ? { ...entry, hosts: [...hosts] } : { ...entry }));
}

// Audit is the hard one: each host keeps its own append-only log with its own
// keyset cursor, so N logs don't share a cursor space. v1 strategy (advisor-
// blessed): pull a bounded recent window from each host, concat, sort newest-
// first, de-dup by id. "Load older" drills per-host (a true cross-host k-way
// cursor is a later refinement); the page discloses the window is recent-only
// when any host still has older rows. parseTs turns the row's ts into a sortable
// number (NaN-safe → sorts last).
function mergeAuditRows(taggedRows, parseTs) {
  const seen = new Set();
  const rows = [];
  for (const r of taggedRows) {
    if (!r || r.id == null || seen.has(r.id)) continue;
    seen.add(r.id);
    rows.push(r);
  }
  const ts = (r) => { const n = parseTs ? parseTs(r.ts || r.raisedAt) : Date.parse(r.ts || r.raisedAt); return isFinite(n) ? n : -Infinity; };
  return rows.sort((a, b) => ts(b) - ts(a));
}

export { concatById, mergeAuditRows, mergeLibrary };
