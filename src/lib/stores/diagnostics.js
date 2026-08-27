// stores/diagnostics.js — Host logs, log sources, services, leaf provisioning/config.

import { adaptService, adaptLeafConfigApply } from "../adapters.js";
import { api } from "../apiClient.js";
import { createStore } from "../store.js";

// ---- Host logs ----
const LOGS_WINDOW = 300;
const LOGS_MAX = 2000;

// KEYED BY HOST, like every other target-scoped store here. Two nodes' merged journals can be on
// screen at once — two pinned to the dashboard, or one pinned while a node's Logs tab is open — and
// a single slot had each refresh blank the other with nothing to show for it.
const logsStore = createStore({ byHost: {} });

const _emptyLogs = () => ({ list: [], status: "loading", error: null, everLoaded: false });
logsStore.entry = (hostId) => logsStore.getState().byHost[hostId] || null;

const _patchLogs = (hostId, fn) =>
  logsStore.setState(s => ({ ...s, byHost: { ...s.byHost, [hostId]: fn(s.byHost[hostId] || _emptyLogs()) } }));

logsStore.prepend = (hostId, line) => {
  if (!line || !line.id || !hostId) return;
  if (!logsStore.getState().byHost[hostId]) return;   // nobody is holding this node's journal
  _patchLogs(hostId, e => {
    if (e.list.length && e.list[0].id === line.id) return e;
    if (e.list.some(x => x.id === line.id)) return e;
    const list = [line, ...e.list];
    return { ...e, list: list.length > LOGS_MAX ? list.slice(0, LOGS_MAX) : list };
  });
};

// Per-host generations, so a slow response for one node cannot land on top of a newer one for the
// SAME node while leaving every other node's journal alone.
const _logsGen = new Map();
logsStore.refresh = (hostId) => {
  if (!hostId) return Promise.resolve([]);
  const gen = (_logsGen.get(hostId) || 0) + 1;
  _logsGen.set(hostId, gen);
  _patchLogs(hostId, e => ({ ...e, status: "loading", error: null }));
  return api.host(hostId).get("/hosts/" + hostId + "/logs?limit=" + LOGS_WINDOW).then(page => {
    if (_logsGen.get(hostId) !== gen) return [];
    const rows = (page && page.rows) || [];
    _patchLogs(hostId, e => ({ ...e, list: rows, status: "ready", error: null, everLoaded: true }));
    return rows;
  }, err => {
    if (_logsGen.get(hostId) === gen) _patchLogs(hostId, e => ({ ...e, status: "error", error: err }));
    throw err;
  });
};

logsStore.drop = (hostId) => {
  _logsGen.delete(hostId);
  logsStore.setState(s => {
    if (!s.byHost[hostId]) return s;
    const byHost = { ...s.byHost };
    delete byHost[hostId];
    return { ...s, byHost };
  });
};

function subscribeHostLogs(hostId) {
  if (!hostId) return () => {};
  const topic = "hosts/" + hostId + "/logs";
  const dispose = api.stream.subscribe([topic], (m) => {
    if (m && m.type === "log.line" && m.data) logsStore.prepend(hostId, m.data);
  });
  return () => { dispose(); logsStore.drop(hostId); };
}

// ---- One leaf's journal ----
// The per-leaf logs tab reads its OWN window rather than filtering the host-wide one: the merged
// feed is capped across every leaf at once, so a quiet leaf next to a chatty one can hold almost
// none of it — filtering that would show an empty console for a service that has been logging all
// day. Asking journald for the one source spends the whole window on the leaf you opened.
//
// KEYED BY (host, leaf), not scoped to one. Two journals can be on screen at once — two pinned to
// the dashboard, or one pinned while its own page is open — and a single-slot store would have each
// refresh blank the other, silently, with each console showing the wrong service's lines or none at
// all. The hydrate and the live subscription are shared per key by lib/keyedResource.js.
const leafLogsStore = createStore({ byKey: {} });

const leafLogsKey = (hostId, leaf) => (hostId || "_") + "/" + (leaf || "_");
const _emptyLeafLogs = () => ({ list: [], status: "loading", error: null });

leafLogsStore.entry = (hostId, leaf) =>
  leafLogsStore.getState().byKey[leafLogsKey(hostId, leaf)] || null;

const _patchLeafLogs = (key, fn) =>
  leafLogsStore.setState(s => ({ ...s, byKey: { ...s.byKey, [key]: fn(s.byKey[key] || _emptyLeafLogs()) } }));

leafLogsStore.prepend = (hostId, leaf, line) => {
  if (!line || !line.id) return;
  // One live topic carries every source, so a frame is narrowed to this leaf on the way in.
  if (line.source !== leaf) return;
  const key = leafLogsKey(hostId, leaf);
  if (!leafLogsStore.getState().byKey[key]) return;   // nobody is holding this journal
  _patchLeafLogs(key, e => {
    if (e.list.some(x => x.id === line.id)) return e;
    const list = [line, ...e.list];
    return { ...e, list: list.length > LOGS_MAX ? list.slice(0, LOGS_MAX) : list };
  });
};

// Per-key generation counters, so a slow response for one leaf cannot land on top of a newer one
// for the SAME leaf while leaving every other leaf's journal alone.
const _leafLogsGen = new Map();
leafLogsStore.refresh = (hostId, leaf) => {
  if (!hostId || !leaf) return Promise.resolve([]);
  const key = leafLogsKey(hostId, leaf);
  const gen = (_leafLogsGen.get(key) || 0) + 1;
  _leafLogsGen.set(key, gen);
  _patchLeafLogs(key, e => ({ ...e, status: "loading", error: null }));
  const path = "/hosts/" + hostId + "/logs?source=" + encodeURIComponent(leaf) + "&limit=" + LOGS_WINDOW;
  return api.host(hostId).get(path).then(page => {
    if (_leafLogsGen.get(key) !== gen) return [];
    const rows = (page && page.rows) || [];
    _patchLeafLogs(key, e => ({ ...e, list: rows, status: "ready", error: null }));
    return rows;
  }, err => {
    if (_leafLogsGen.get(key) === gen) _patchLeafLogs(key, e => ({ ...e, status: "error", error: err }));
    throw err;
  });
};

// Drop a journal nothing is reading. Called by the last release of a key, so a dashboard that has
// held six journals over an afternoon is not still carrying six 2000-line windows.
leafLogsStore.drop = (hostId, leaf) => {
  const key = leafLogsKey(hostId, leaf);
  _leafLogsGen.delete(key);
  leafLogsStore.setState(s => {
    if (!s.byKey[key]) return s;
    const byKey = { ...s.byKey };
    delete byKey[key];
    return { ...s, byKey };
  });
};

function subscribeLeafLogs(hostId, leaf) {
  if (!hostId || !leaf) return () => {};
  const topic = "hosts/" + hostId + "/logs";
  const dispose = api.stream.subscribe([topic], (m) => {
    if (m && m.type === "log.line" && m.data) leafLogsStore.prepend(hostId, leaf, m.data);
  });
  return () => { dispose(); leafLogsStore.drop(hostId, leaf); };
}

function subscribeHostServices(hostId) {
  if (!hostId) return () => {};
  const topic = "hosts/" + hostId + "/services";
  const dispose = api.stream.subscribe([topic], (m) => {
    if (m && m.type === "service.patch" && m.data) servicesStore.applyRow(hostId, m.data);
  });
  return () => { dispose(); servicesStore.drop(hostId); };
}

// ---- Host log sources ----
// Keyed for the same reason as the journals it describes: the source picker on one node's Logs tab
// must not be replaced by another node's list.
const logSourcesStore = createStore({ byHost: {} });

const _emptySources = () => ({ sources: [], status: "loading", error: null });
logSourcesStore.entry = (hostId) => logSourcesStore.getState().byHost[hostId] || null;

const _patchSources = (hostId, fn) =>
  logSourcesStore.setState(s => ({ ...s, byHost: { ...s.byHost, [hostId]: fn(s.byHost[hostId] || _emptySources()) } }));

const _logSourcesGen = new Map();
logSourcesStore.refresh = (hostId) => {
  if (!hostId) return Promise.resolve([]);
  const gen = (_logSourcesGen.get(hostId) || 0) + 1;
  _logSourcesGen.set(hostId, gen);
  _patchSources(hostId, e => ({ ...e, status: "loading", error: null }));
  return api.host(hostId).get("/hosts/" + hostId + "/logs/sources").then(sources => {
    if (_logSourcesGen.get(hostId) !== gen) return [];
    const list = Array.isArray(sources) ? sources : [];
    _patchSources(hostId, e => ({ ...e, sources: list, status: "ready", error: null }));
    return list;
  }, err => {
    if (_logSourcesGen.get(hostId) === gen) _patchSources(hostId, e => ({ ...e, status: "error", error: err }));
    throw err;
  });
};

// ---- Host services ----
// Keyed by host: the Services board of two nodes can be open at once, and the leaf page reads this
// same store for the row it renders its header from.
const servicesStore = createStore({ byHost: {} });

const _emptyServices = () => ({ list: [], status: "loading", error: null, everLoaded: false });
servicesStore.entry = (hostId) => servicesStore.getState().byHost[hostId] || null;

const _patchServices = (hostId, fn) =>
  servicesStore.setState(s => ({ ...s, byHost: { ...s.byHost, [hostId]: fn(s.byHost[hostId] || _emptyServices()) } }));

const _servicesGen = new Map();
servicesStore.refresh = (hostId) => {
  if (!hostId) return Promise.resolve([]);
  const gen = (_servicesGen.get(hostId) || 0) + 1;
  _servicesGen.set(hostId, gen);
  _patchServices(hostId, e => ({ ...e, status: "loading", error: null }));
  return api.host(hostId).get("/hosts/" + hostId + "/services").then(rows => {
    if (_servicesGen.get(hostId) !== gen) return [];
    const list = Array.isArray(rows) ? rows : [];
    _patchServices(hostId, e => ({ ...e, list, status: "ready", error: null, everLoaded: true }));
    return list;
  }, err => {
    if (_servicesGen.get(hostId) === gen) _patchServices(hostId, e => ({ ...e, status: "error", error: err }));
    throw err;
  });
};

servicesStore.applyRow = (hostId, row) => {
  if (!row || !row.id || !hostId) return;
  if (!servicesStore.getState().byHost[hostId]) return;   // nobody is holding this node's board
  _patchServices(hostId, e => {
    const seen = e.list.some(x => x.id === row.id);
    const list = seen ? e.list.map(x => (x.id === row.id ? { ...x, ...row } : x)) : [...e.list, row];
    return { ...e, list };
  });
};

servicesStore.drop = (hostId) => {
  _servicesGen.delete(hostId);
  servicesStore.setState(s => {
    if (!s.byHost[hostId]) return s;
    const byHost = { ...s.byHost };
    delete byHost[hostId];
    return { ...s, byHost };
  });
};

// ---- Leaf provisioning + config ----
function setLeafProvisioned(hostId, leaf, connected) {
  if (!hostId) return Promise.reject(new Error("setLeafProvisioned: hostId required"));
  const action = connected ? "connect" : "disconnect";
  return api.host(hostId).post("/hosts/" + hostId + "/services/" + leaf + "/" + action).then(raw => {
    const row = adaptService(raw);
    if (row && row.id) servicesStore.applyRow(hostId, row);
    return row;
  });
}

function fetchLeafConfig(hostId, leaf) {
  if (!hostId || !leaf) return Promise.resolve(null);
  return api.host(hostId).get("/hosts/" + hostId + "/services/" + leaf + "/config");
}

// The commands a leaf answers to, from the manifest it ships. A 404 is the ordinary answer — most
// leaves take no commands at all — so it resolves null rather than rejecting; a real failure still
// rejects, because "we couldn't ask" and "there are none" are different facts and the tab says which.
function fetchLeafCommands(hostId, leaf) {
  if (!hostId || !leaf) return Promise.resolve(null);
  return api.host(hostId).get("/hosts/" + hostId + "/services/" + leaf + "/commands")
    .catch(err => {
      if (err && err.code === 404) return null;
      throw err;
    });
}

// One leaf's resource history, from the monitor's `leaf` entity kind by way of the api's proxy. The
// response is the same shape a server's history has, down to the metric names — they are the same
// quantities in the same units — which is what lets the leaf page render it through the very chart grid
// the Performance tab uses. No adapter: the series map IS the view shape, and inventing a point to fill
// a gap is exactly what the backend refuses to do.
function fetchLeafMetricsHistory(hostId, leaf, range) {
  if (!hostId || !leaf) return Promise.resolve(null);
  const r = range || "1h";
  return api.host(hostId).get("/hosts/" + hostId + "/services/" + leaf + "/metrics/history?range=" + r);
}

// A leaf's own Overview payload — the one question each leaf answers about the work it does, as opposed
// to the systemd facts every leaf shares. One helper because the failure vocabulary is identical across
// them: a 404 is "this host doesn't serve that leaf" and resolves null (the page says so and offers no
// retry); anything else rejects, because "we couldn't ask" is worth trying again and must not be
// rendered as "there is nothing".
function fetchLeafOverview(hostId, leaf, path) {
  if (!hostId || !leaf) return Promise.resolve(null);
  return api.host(hostId).get("/hosts/" + hostId + "/services/" + leaf + "/" + path)
    .catch(err => {
      if (err && err.code === 404) return null;
      throw err;
    });
}

// The engine's identity card — version and directory layout, measured by the api invoking kgsm itself.
// Its own route rather than a /services/{leaf}/ path because the engine is not in the leaf catalog,
// but the failure vocabulary matches fetchLeafOverview's: 404 (no engine configured on this host)
// resolves null, and anything else rejects as worth retrying.
function fetchEngineInfo(hostId) {
  if (!hostId) return Promise.resolve(null);
  return api.host(hostId).get("/hosts/" + hostId + "/engine")
    .catch(err => {
      if (err && err.code === 404) return null;
      throw err;
    });
}

// The scheduler's whole board: every instance it reads, each maintenance window written on it, when each
// next fires, and how each last ran. Relayed by the api exactly as the leaf reports it — no adapter,
// because the leaf's nulls ARE the view shape (a null next fire on an invalid window and a null last run
// on one that has not come round are both honest gaps, and a default here would state a schedule nothing
// holds).
function fetchLeafSchedules(hostId) {
  return fetchLeafOverview(hostId, "scheduler", "schedules").then(r => (r && r.data) || null);
}

// Move one window's next run: `postpone` (with minutes), `skip`, or `run-now`. The window is named by
// its schedule expression, which is its identity — an instance holds several appointments and the
// daemon refuses an instruction naming none rather than picking one.
//
// None of the three edits a schedule. Each moves a target the daemon holds in memory, so the fire after
// the one acted on lands where it always would have and a restart of the daemon brings the deferred one
// back. The node answers 400 carrying the daemon's own words when it says no, which reaches the caller
// as a rejection rather than a success to be inspected.
function controlLeafWindow(hostId, verb, body) {
  return api.host(hostId).post(
    "/hosts/" + encodeURIComponent(hostId) + "/services/scheduler/windows/" + encodeURIComponent(verb),
    body);
}

// The watchdog's supervision table plus its own readiness. Kept whole rather than reduced to the rows:
// `ready:false` with a full table is a real state (the daemon is up but cannot spawn), and dropping the
// flag would leave the page unable to say so.
function fetchLeafSupervision(hostId) {
  return fetchLeafOverview(hostId, "watchdog", "supervision");
}

// The monitor's report on itself: sample cadence, what the newest frame covered, and what the history
// store measurably holds against what it was configured to hold. Relayed verbatim by the api, so there
// is no adapter — the two retention figures are deliberately both on the wire, and reconciling them here
// would destroy the one thing this payload is for.
function fetchLeafMonitorStats(hostId) {
  return fetchLeafOverview(hostId, "monitor", "stats");
}

// The Discord bot's live gateway/guild/channel state, one row per Discord server an admin set up with
// `/setup`. Relayed verbatim, and deliberately not reduced: a row whose `name` is null is a guild the
// client never populated — configured, connected, and unable to post — which is the failure this whole
// payload exists to expose, and collapsing it into a boolean here would erase it.
function fetchLeafBotStatus(hostId) {
  return fetchLeafOverview(hostId, "bot", "status");
}

// The speech engine's own account of itself. Relayed verbatim, and `resting` is the field the whole
// payload turns on: the leaf idle-exits to give back the ~1.6GB its models cost, and the api will not
// connect to a resting daemon because connecting is what starts one — so the live half is absent by
// design there, and reducing that to "unavailable" would report a working leaf as broken.
function fetchLeafSpeechStatus(hostId) {
  return fetchLeafOverview(hostId, "speech", "status");
}

// The reactor's account of what it is doing right now. Relayed verbatim, and the per-rule fields are the
// reason: the leaf reports each rule's mode and suppression window AS RESOLVED — the safest of the lists a
// rule is named in, and the host-wide window where the rule carries none — so re-deriving either here from
// the settings would show an authority a rule does not actually have.
function fetchLeafReactorStatus(hostId) {
  return fetchLeafOverview(hostId, "reactor", "status");
}

// The reactor's decision review over a window — what each rule concluded, the busiest hour a ceiling
// would have had to clear, how far apart a rule's repeats were, the rules that decided nothing, and the
// decisions themselves. Relayed verbatim, and `days` is deliberately optional: the LEAF owns both the
// default (a week, the span its review gate is stated over) and the ceiling on it (its own ledger
// retention), so a caller that names nothing gets the leaf's answer rather than one this file invented.
function fetchLeafReactorDecisions(hostId, days) {
  const q = days > 0 ? "?days=" + days : "";
  return fetchLeafOverview(hostId, "reactor", "decisions" + q);
}

function applyLeafConfig(hostId, leaf, body) {
  if (!hostId || !leaf) return Promise.reject(new Error("applyLeafConfig: hostId required"));
  return api.host(hostId).put("/hosts/" + hostId + "/services/" + leaf + "/config", body || {}).then(adaptLeafConfigApply);
}

export {
  logsStore, logSourcesStore, leafLogsStore, servicesStore,
  subscribeHostLogs, subscribeLeafLogs, leafLogsKey, subscribeHostServices, setLeafProvisioned,
  fetchLeafConfig, fetchLeafCommands, applyLeafConfig, fetchLeafMetricsHistory, fetchEngineInfo,
  fetchLeafSchedules, controlLeafWindow, fetchLeafSupervision, fetchLeafMonitorStats, fetchLeafBotStatus,
  fetchLeafSpeechStatus, fetchLeafReactorStatus, fetchLeafReactorDecisions,
};
