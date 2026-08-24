// stores/prefs.js — the account's preferences, held locally and mirrored to the node.
//
// LOCAL-FIRST, and that is the whole design. A preference is read on the very first render — the
// dashboard's layout decides what to mount — so waiting for a round trip would mean an empty
// dashboard on every cold load, and a failed round trip would mean an empty dashboard forever. So
// localStorage is the source the app reads, always and synchronously; the node is where the value
// is kept so it can outlive the browser and follow the person to their other devices.
//
// A write lands locally and returns. The PUT that follows is best-effort: it can fail, and when it
// does nothing is lost — the value is already where the app reads it, and the next successful write
// carries it up. Nothing here blocks, retries in a loop, or shows an error for a preference that is
// already saved where it matters.
//
// The panel can also be pointed at NO node, or at one that is down, and it must stay fully usable.
// That is not a degraded mode to apologise for; it is the offline case working.

import { api } from "../apiClient.js";
import { homeHostId } from "../config.js";
import { deviceId } from "../device.js";
import { createStore } from "../store.js";

// The keys the panel stores. Declared rather than free-form so the set is greppable and the API's
// per-slot cap is spent on things somebody chose.
const PREF_KEYS = {
  DASHBOARD_LAYOUT: "dashboard.layout",
  SERVER_FAVORITES: "servers.favorites",
};

const LOCAL_PREFIX = "krystal:pref:";
const localKey = (key) => LOCAL_PREFIX + key;

// ---- Local half ----------------------------------------------------------

function readLocal(key) {
  try {
    const raw = localStorage.getItem(localKey(key));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function writeLocal(key, value) {
  try { localStorage.setItem(localKey(key), JSON.stringify(value)); } catch { /* full or blocked */ }
}

// ---- The store -----------------------------------------------------------
//
// `sync` is the account's switch, and `status` is only about the MIRROR — "local" means nothing has
// been heard from a node, which is the honest state offline and before the first read. It is never a
// reason to withhold a value.
const prefsStore = createStore({
  values: {},            // key -> the value the app should read
  versions: {},          // key -> the version the node last confirmed, for the settings card
  sync: { enabled: false, sourceDevice: null, updated: null },
  status: "local",       // local | syncing | synced | error
  error: null,
  hydrated: false,
});

/// Read a preference. Synchronous, and never null because a node is unreachable — the local copy is
/// the answer, and `fallback` covers a key nothing has ever written.
prefsStore.get = (key, fallback = null) => {
  const held = prefsStore.getState().values[key];
  if (held !== undefined) return held;
  const local = readLocal(key);
  return local === null ? fallback : local;
};

/// Write a preference. Lands locally and returns; the node is told afterwards.
prefsStore.set = (key, value) => {
  writeLocal(key, value);
  prefsStore.setState(s => ({ ...s, values: { ...s.values, [key]: value } }));
  push(key, value);
};

// The mirror. Failures are swallowed on purpose — see the header. `status` records what happened so
// the settings card can say whether preferences are reaching the node, which is a different question
// from whether the app is working.
let _inflight = 0;
function push(key, value) {
  if (!hasNode()) return;
  _inflight++;
  prefsStore.setState(s => ({ ...s, status: "syncing" }));
  api.host(node()).put("/me/preferences/" + encodeURIComponent(key), { value })
    .then(row => {
      prefsStore.setState(s => ({
        ...s,
        versions: row && row.version != null ? { ...s.versions, [key]: row.version } : s.versions,
        status: --_inflight > 0 ? "syncing" : "synced",
        error: null,
      }));
    })
    .catch(err => {
      // The value is already where the app reads it. This records that the node did not take it, and
      // nothing else — no retry loop, no toast for a preference that is saved.
      prefsStore.setState(s => ({ ...s, status: --_inflight > 0 ? "syncing" : "error", error: err }));
    });
}

// The node that holds these preferences — the one serving the panel (config.homeHostId). Every
// routed call has to name a node, and at N≥2 a nameless one throws rather than landing on whichever
// happens to be first. Null means there is nothing to mirror to: no connection, or one whose backend
// id has not been reconciled yet.
const node = () => { try { return homeHostId(); } catch { return null; } };
const hasNode = () => node() != null;

/// Read the node's copy and adopt it. Called once the session is live.
///
/// The node WINS on hydrate, deliberately: its copy is the one that followed the person here, and
/// the local copy is this browser's cache of a previous answer. The exception is a key the node has
/// never heard of — a layout arranged offline, or before this store existed — which is pushed up
/// rather than discarded.
prefsStore.hydrate = async () => {
  if (!hasNode()) {
    prefsStore.setState(s => ({ ...s, hydrated: true, status: "local" }));
    return;
  }
  try {
    const res = await api.host(node()).get("/me/preferences");
    const rows = (res && res.preferences) || {};
    const values = {};
    const versions = {};
    for (const key of Object.keys(rows)) {
      values[key] = rows[key].value;
      versions[key] = rows[key].version;
      writeLocal(key, rows[key].value);
    }
    // Anything held here that the node has never seen goes up, so arranging a dashboard before the
    // store existed — or while offline — is not silently thrown away on the next load.
    for (const key of Object.values(PREF_KEYS)) {
      if (values[key] !== undefined) continue;
      const local = readLocal(key);
      if (local !== null) { values[key] = local; push(key, local); }
    }
    prefsStore.setState(s => ({
      ...s, values, versions,
      sync: (res && res.sync) || s.sync,
      hydrated: true,
      status: _inflight > 0 ? "syncing" : "synced",
      error: null,
    }));
  } catch (err) {
    // A node that cannot be read is not a reason to have no preferences. The local copies stand and
    // the app carries on; the settings card says the mirror is not reachable.
    prefsStore.setState(s => ({ ...s, hydrated: true, status: "error", error: err }));
  }
};

/// Move the account's sync switch.
///
/// Enabling makes THIS device the source and overwrites the others from it; disabling seeds every
/// known device from the synced record. Both are the node's to do — this only asks, then re-reads,
/// because the answer changes what every other device will see and guessing at it locally would show
/// somebody a switch position their account does not have.
prefsStore.setSync = async (enabled) => {
  if (!hasNode()) throw new Error("no node to sync with");
  const state = await api.host(node()).put("/me/preferences/sync", { enabled });
  prefsStore.setState(s => ({ ...s, sync: state || s.sync }));
  await prefsStore.hydrate();
  return state;
};

/// This browser's id, for the settings card to show which device it is looking at.
prefsStore.device = () => deviceId();

export { PREF_KEYS, prefsStore };
