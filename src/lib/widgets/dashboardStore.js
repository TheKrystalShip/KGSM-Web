// widgets/dashboardStore.js — the dashboard's layout, and the only thing that writes it.
//
// The layout is a PREFERENCE (stores/prefs.js): held locally so the first render has it, mirrored to
// the node so it outlives this browser and follows the person to their other devices when they turn
// sync on. Reads here stay synchronous — the dashboard decides what to mount from this on its very
// first render, and a round trip would mean an empty grid on every cold load.

import { can } from "../persona.js";
import { sessionStore } from "../sessionStore.js";
import { createStore } from "../store.js";
import { PREF_KEYS, prefsStore } from "../stores/prefs.js";
import { getWidget, hasWidget } from "./registry.js";
import { findTarget, makeWidget, normalizeLayout, sameTarget, widgetId } from "./layout.js";

// The key this layout was written under before it was a preference. Read once, to carry an existing
// arrangement across; never written again.
const LEGACY_LAYOUT_KEY = "krystal:dash:widgets";
// The band order this replaces. Read once, to carry an existing arrangement across, then left
// alone — the old key is not written again, and deleting it would break a rollback.
const LEGACY_ORDER_KEY = "krystal:dash:order";

// ---- The default layout --------------------------------------------------
//
// ONE list, filtered by what the role may actually see, rather than three hand-kept per-role lists
// that drift apart. A viewer is never seeded a widget their capability immediately hides, and a
// capability added to a role later starts appearing in new dashboards with no second list to
// update.
//
// Order is the reading order of the page it replaces: what is happening, what needs me, then the
// things to browse.
// The twelve tiles are listed individually rather than as one block, because that is what the
// dashboard IS now — twelve things somebody can reorder and remove one at a time. At w:2 they read
// six across on a wide screen, which is the shape the band always had.
const SUMMARY_TILES = [
  "tile.running", "tile.playersNow", "tile.playersWeek", "tile.played", "tile.uptime", "tile.timeToReady",
  "tile.drift", "tile.crashes", "tile.updates", "tile.oldestBackup", "tile.scheduleFails", "tile.services",
];

const DEFAULT_LAYOUT = [
  ...SUMMARY_TILES.map(type => ({ type, w: 2, h: 1 })),
  { type: "fleet.capacity", w: 12, h: 1 },
  { type: "alerts.latest", w: 6, h: 4 },
  { type: "activity.recent", w: 6, h: 4 },
  { type: "servers.rail", w: 12, h: 4 },
  { type: "library.catalog", w: 12, h: 4 },
];

// Capabilities the seed needs to check. Kept beside the list because a seeded widget the viewer
// cannot see is the one bug this filter exists to prevent.
const SEED_CAP = {
  "fleet.capacity": "nav.cluster",
  "alerts.latest": "nav.alerts",
  "activity.recent": "nav.audit",
  "library.catalog": "nav.library",
};

function defaultLayout() {
  return DEFAULT_LAYOUT
    .filter(d => hasWidget(d.type))
    .filter(d => !SEED_CAP[d.type] || can(SEED_CAP[d.type]))
    .map(d => makeWidget(d.type, {}, d));
}

// ---- Storage -------------------------------------------------------------

function readStored() {
  const held = prefsStore.get(PREF_KEYS.DASHBOARD_LAYOUT, null);
  if (Array.isArray(held)) return held;
  // A layout written under the old key, before this was a preference. Taken once; the first write
  // below puts it where preferences live now.
  try {
    const raw = localStorage.getItem(LEGACY_LAYOUT_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}

function writeStored(layout) {
  prefsStore.set(PREF_KEYS.DASHBOARD_LAYOUT, layout);
}

// The band order the dashboard used before it had widgets, mapped onto its widget types at full
// width. Somebody who arranged their bands keeps that arrangement instead of being reset to the
// default the first time they load a build that has widgets.
const LEGACY_BAND_TYPE = {
  summary: SUMMARY_TILES[0],   // the band expands into all twelve; see takeSummary
  capacity: "fleet.capacity",
  feed: null,                    // one band held two cards; they arrive as the two of them
  recent: "library.catalog",
  servers: "servers.rail",
};

function migrateLegacy() {
  let order;
  try {
    const raw = localStorage.getItem(LEGACY_ORDER_KEY);
    order = raw ? JSON.parse(raw) : null;
  } catch { return null; }
  if (!Array.isArray(order) || !order.length) return null;

  const seedByType = new Map(defaultLayout().map(w => [w.type, w]));
  const out = [];
  const take = (type) => {
    const w = seedByType.get(type);
    if (w) { out.push(w); seedByType.delete(type); }
  };
  for (const id of order) {
    if (id === "feed") { take("alerts.latest"); take("activity.recent"); continue; }
    // The summary band was one draggable thing and is now twelve; it expands in place, so the
    // arrangement around it is kept and the figures land where the band was.
    if (id === "summary") { SUMMARY_TILES.forEach(take); continue; }
    const t = LEGACY_BAND_TYPE[id];
    if (t) take(t);
  }
  // Anything the saved order never mentioned keeps its default slot at the end rather than being
  // dropped: the old order was merge-safe about absent bands and this must not be less so.
  for (const w of seedByType.values()) out.push(w);
  return out.length ? out : null;
}

// ---- The store -----------------------------------------------------------

const dashboardStore = createStore({ layout: [], hydrated: false });

/// Load the layout. Called by the dashboard on mount rather than at import, because the seed reads
/// the persona and there is no role to read until there is a session.
// A layout written before the summary was split holds one `fleet.summary`. Expand it in place into
// the twelve tiles rather than leaving somebody with a block they cannot take apart — the figures
// are identical and they land exactly where the block was. The type stays registered either way, so
// nothing breaks if this is ever skipped.
function expandSummary(layout) {
  if (!layout.some(w => w.type === "fleet.summary")) return layout;
  const held = new Set(layout.map(w => w.type));
  const out = [];
  for (const w of layout) {
    if (w.type !== "fleet.summary") { out.push(w); continue; }
    for (const type of SUMMARY_TILES) {
      if (held.has(type)) continue;   // already placed by hand — don't add a second
      out.push(makeWidget(type, {}, { w: 2, h: 1 }));
    }
  }
  return out;
}

// A layout holding a tall `fleet.capacity` was sized against a floor the card no longer has: it
// states its own height from its node rows, so any span above the smallest leaves a cell it cannot
// fill. Shrink it in place — the card lands in the same position and every widget below it moves up.
function fitCapacity(layout) {
  if (!layout.some(w => w.type === "fleet.capacity" && w.h > 1)) return layout;
  return layout.map(w => (w.type === "fleet.capacity" && w.h > 1 ? { ...w, h: 1 } : w));
}

/// Load the layout.
///
/// ⚠ THE ORDER HERE IS LOAD-BEARING. Seeding the default is a WRITE, and a write goes to the node —
/// so seeding before the node has answered publishes a default over whatever was stored there, and
/// the arrangement is gone. The rule is: never seed while the answer is still outstanding.
///
///   a local copy            → render it immediately and write nothing. This is the local-first path
///                             and the common one; the node's copy is adopted below when it lands.
///   no local copy, no answer→ WAIT. The dashboard shows its skeleton rather than a default that
///                             would overwrite the real layout a moment later.
///   no local copy, answered → nothing is stored anywhere, so seed the default and keep it.
dashboardStore.hydrate = () => {
  const stored = readStored();
  if (stored) {
    const layout = fitCapacity(expandSummary(normalizeLayout(stored, hasWidget)));
    // No write. Re-persisting on load would take a version for a change nobody made, and — before
    // the node has answered — would race its copy.
    dashboardStore.setState({ layout, hydrated: true });
    return;
  }

  const migrated = migrateLegacy();
  if (migrated) {
    dashboardStore.setState({ layout: migrated, hydrated: true });
    writeStored(migrated);
    return;
  }

  // Nothing here. Only seed once the node has said it has nothing either.
  if (!prefsStore.getState().hydrated) return;
  const layout = defaultLayout();
  dashboardStore.setState({ layout, hydrated: true });
  writeStored(layout);
};

// The node's copy arrives after the first render — the data layer reads it once there is a session,
// and the dashboard has already mounted from the local copy by then. So adopt it when it lands.
//
// ONCE, and only if it differs. After that this browser's writes are the source: re-reading on every
// prefs change would fight the person arranging their own dashboard, since each write notifies this
// same store.
let _adopted = false;
prefsStore.subscribe(() => {
  if (_adopted || !prefsStore.getState().hydrated) return;
  _adopted = true;
  const fromNode = prefsStore.get(PREF_KEYS.DASHBOARD_LAYOUT, null);
  if (Array.isArray(fromNode)) {
    const layout = fitCapacity(expandSummary(normalizeLayout(fromNode, hasWidget)));
    if (JSON.stringify(layout) !== JSON.stringify(dashboardStore.getState().layout)) {
      dashboardStore.setState({ layout, hydrated: true });
    } else {
      dashboardStore.setState(st => ({ ...st, hydrated: true }));
    }
    return;
  }
  // The node has nothing. If the dashboard was waiting on this answer, it can seed now.
  if (!dashboardStore.getState().hydrated) dashboardStore.hydrate();
});

const commit = (layout) => {
  dashboardStore.setState({ layout, hydrated: true });
  writeStored(layout);
};

// ---- Following a role change ---------------------------------------------
//
// A dashboard NOBODY HAS ARRANGED follows the role; one somebody has arranged is theirs.
//
// The seed is `DEFAULT_LAYOUT` filtered by what the role may see, so an untouched dashboard is that
// list, in that order, at those sizes, with nothing added and nothing renamed. Recognising exactly
// that is what makes re-seeding safe: for any other layout the arrangement is a decision, and
// replacing it would throw the decision away. Nothing is lost by leaving one alone either —
// `WidgetHost` asks the capability on every render, so a card the new role may not see stops
// drawing whether or not the layout was rewritten.
function isUntouchedSeed(layout) {
  const seed = DEFAULT_LAYOUT.filter(d => hasWidget(d.type));
  let i = 0;
  for (const w of layout) {
    while (i < seed.length && seed[i].type !== w.type) i++;
    if (i === seed.length) return false;                        // a type the seed never places, or moved
    if (w.w !== seed[i].w || w.h !== seed[i].h || w.title) return false;
    if (w.params && Object.keys(w.params).length) return false;
    i++;
  }
  return true;
}

/// Re-seed for the role now held. A dashboard that has not loaded yet needs nothing: `hydrate` runs
/// on the next mount and reads the role then.
dashboardStore.retier = () => {
  const { layout, hydrated } = dashboardStore.getState();
  if (!hydrated || !isUntouchedSeed(layout)) return;
  commit(defaultLayout());
};

sessionStore.onTierChange(() => dashboardStore.retier());

dashboardStore.replace = (layout) => commit(layout);

/// Add a widget for a target, unless one is already pinned to it. Returns the instance id, or null
/// when it was already there — the caller uses that to decide what to say.
///
/// A REPEATABLE type is exempt, and gets its own `slot` param per copy. Identity here is
/// (type + params), which is what lets a pin button ask "is this thing pinned" without knowing which
/// instance answers for it — so without a discriminator every spacer would be the same widget:
/// `isPinned` would report the second one already present, and removing one would take them all.
dashboardStore.pin = (type, params, size) => {
  const cur = dashboardStore.getState().layout;
  const entry = getWidget(type);
  const bound = entry && entry.repeatable
    ? { ...(params || {}), slot: widgetId() }
    : (params || {});
  if (findTarget(cur, { type, params: bound })) return null;
  const w = makeWidget(type, bound, size);
  commit([...cur, w]);
  return w.i;
};

/// Remove by instance id.
dashboardStore.unpin = (id) =>
  commit(dashboardStore.getState().layout.filter(w => w.i !== id));

/// Remove by target — what the pin button on a card calls, since it knows what it points at and not
/// which instance represents it.
dashboardStore.unpinTarget = (type, params) =>
  commit(dashboardStore.getState().layout.filter(w => !sameTarget(w, { type, params })));

dashboardStore.isPinned = (type, params) =>
  !!findTarget(dashboardStore.getState().layout, { type, params });

dashboardStore.resize = (id, w, h) =>
  commit(dashboardStore.getState().layout.map(it =>
    it.i === id ? { ...it, w: Math.max(1, w | 0), h: Math.max(1, h | 0) } : it));

/// Move the widget at `from` to index `to`, both in the CURRENT array order.
dashboardStore.move = (from, to) => {
  const cur = dashboardStore.getState().layout;
  if (from === to || from < 0 || from >= cur.length || to < 0 || to >= cur.length) return;
  const next = cur.slice();
  next.splice(to, 0, next.splice(from, 1)[0]);
  commit(next);
};

/// Back to the seed. Writes it, so "reset" is a decision that survives a reload rather than a view
/// that reverts the next time the stored layout is read.
dashboardStore.reset = () => commit(defaultLayout());

export { DEFAULT_LAYOUT, dashboardStore, defaultLayout };
