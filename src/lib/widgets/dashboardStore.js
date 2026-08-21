// widgets/dashboardStore.js — the dashboard's layout, and the only thing that writes it.
//
// Persistence is per-browser localStorage today. The store interface is what the rest of the app
// talks to, so moving the record server-side (per device, with an account-level sync switch) is a
// change to `read`/`write` here and to nothing else.

import { can } from "../persona.js";
import { createStore } from "../store.js";
import { hasWidget } from "./registry.js";
import { findTarget, makeWidget, normalizeLayout, sameTarget } from "./layout.js";

const LAYOUT_KEY = "krystal:dash:widgets";
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
const DEFAULT_LAYOUT = [
  { type: "fleet.summary", w: 12, h: 2 },
  { type: "fleet.capacity", w: 12, h: 4 },
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
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}

function writeStored(layout) {
  try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch { /* full or blocked */ }
}

// The band order the dashboard used before it had widgets, mapped onto its widget types at full
// width. Somebody who arranged their bands keeps that arrangement instead of being reset to the
// default the first time they load a build that has widgets.
const LEGACY_BAND_TYPE = {
  summary: "fleet.summary",
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
dashboardStore.hydrate = () => {
  const stored = readStored();
  if (stored) {
    dashboardStore.setState({ layout: normalizeLayout(stored, hasWidget), hydrated: true });
    return;
  }
  const migrated = migrateLegacy();
  const layout = migrated || defaultLayout();
  dashboardStore.setState({ layout, hydrated: true });
  writeStored(layout);
};

const commit = (layout) => {
  dashboardStore.setState({ layout, hydrated: true });
  writeStored(layout);
};

dashboardStore.replace = (layout) => commit(layout);

/// Add a widget for a target, unless one is already pinned to it. Returns the instance id, or null
/// when it was already there — the caller uses that to decide what to say.
dashboardStore.pin = (type, params, size) => {
  const cur = dashboardStore.getState().layout;
  if (findTarget(cur, { type, params })) return null;
  const w = makeWidget(type, params, size);
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
