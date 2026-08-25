// stores/hosts.js — Hosts store (diagnostics) + metrics/capabilities subscriptions.

import { api } from "../apiClient.js";
import { reconcileConnectionId } from "../config.js";
import * as merge from "../merge.js";
import { createStore } from "../store.js";

const hostsStore = createStore({
  list: [],
  status: "loading",
  error: null,
  everLoaded: false,
});

hostsStore.patch = (id, partial) =>
  hostsStore.setState(s => ({ ...s, list: s.list.map(x => (x.id === id ? { ...x, ...partial } : x)) }));
hostsStore.find = (id) => hostsStore.getState().list.find(x => x.id === id) || null;
hostsStore.add = (host) =>
  hostsStore.setState(s => ({ ...s, list: [...s.list, host] }));
hostsStore.update = (id, partial) => hostsStore.patch(id, partial);
hostsStore.remove = (id) =>
  hostsStore.setState(s => ({ ...s, list: s.list.filter(x => x.id !== id) }));

hostsStore.refresh = () => {
  hostsStore.setState(s => ({ ...s, status: "loading", error: null }));
  return api.fanOut("/hosts").then(results => {
    const okr = results.filter(r => r.ok);
    if (results.length && !okr.length) {
      const err = results[0].err;
      const allAuthFailed = results.every(r => r.err && r.err.code === 401);
      hostsStore.setState(s => ({ ...s, status: "error", error: err, everLoaded: allAuthFailed ? true : s.everLoaded }));
      throw err;
    }
    okr.forEach(r => { const h = (r.data || [])[0]; if (r.conn && h && h.id) reconcileConnectionId(r.conn.url, h.id); });
    const list = merge.mergeHosts(okr.map(r => r.data));
    hostsStore.setState(s => ({ ...s, list, status: "ready", error: null, everLoaded: true }));
    return list;
  });
};

// Host metrics live tick (diagnostics deep-dive only)
hostsStore.mergeMetrics = (id, t) => {
  if (!t) return;
  const at = new Date().toISOString();
  hostsStore.setState(s => ({
    ...s,
    list: s.list.map(h => {
      if (h.id !== id) return h;
      const cap = h.capabilities || {};
      const next = { ...h };
      if (t.cpu) next.cpu = { ...(h.cpu || {}), ...t.cpu };
      if (t.ram) next.ram = t.ram;
      if (t.disks) next.disks = t.disks;
      if (t.sensors) next.sensors = t.sensors;
      // fans adopts undefined-vs-value like gpus/slice: a measured empty must be able to clear the card.
      if (t.fans !== undefined) next.fans = t.fans;
      // gpus/slice adopt the tick's value INCLUDING null (a measured absence — the card must go away),
      // but not undefined: a node whose api predates the field must not clear a newer REST read.
      if (t.gpus !== undefined) next.gpus = t.gpus;
      if (t.slice !== undefined) next.slice = t.slice;
      if (t.boot_time != null) next.boot_time = t.boot_time;
      if (t.hostname) next.hostname = t.hostname;
      next.network = { ...(h.network || {}), interfaces: t.interfaces || (h.network && h.network.interfaces) || [] };
      next.capabilities = { ...cap, metrics: { ...(cap.metrics || {}), last_sample_at: at } };
      return next;
    }),
  }));
};

hostsStore.clearMetricsStamp = (id) => {
  hostsStore.setState(s => ({
    ...s,
    list: s.list.map(h => {
      const m = h.id === id && h.capabilities && h.capabilities.metrics;
      if (!m || m.last_sample_at == null) return h;
      const { last_sample_at, ...rest } = m;
      return { ...h, capabilities: { ...h.capabilities, metrics: rest } };
    }),
  }));
};

function subscribeHostMetrics(hostId) {
  if (!hostId) return () => {};
  const topic = "hosts/" + hostId + "/metrics";
  const dispose = api.stream.subscribe([topic], (m) => {
    if (m && m.type === "host.metrics" && m.data) hostsStore.mergeMetrics(hostId, m.data);
  });
  return () => { dispose(); hostsStore.clearMetricsStamp(hostId); };
}

// Host capabilities live patch (app-wide, always-on)
hostsStore.mergeCapabilities = (id, caps) => {
  if (!caps || typeof caps !== "object") return;
  hostsStore.setState(s => ({
    ...s,
    list: s.list.map(h => {
      if (h.id !== id) return h;
      const cur = h.capabilities || {};
      const next = { ...cur };
      for (const k of Object.keys(caps)) next[k] = { ...(cur[k] || {}), ...caps[k] };
      return { ...h, capabilities: next };
    }),
  }));
};

const _capSubs = new Map();
function _subscribeHostCapabilities(hostId) {
  const topic = "hosts/" + hostId + "/capabilities";
  return api.stream.subscribe([topic], (m) => {
    if (m && m.type === "capabilities.patch" && m.data) hostsStore.mergeCapabilities(hostId, m.data);
  });
}
function syncCapabilitySubscriptions() {
  const ids = new Set((hostsStore.getState().list || []).map(h => h && h.id).filter(Boolean));
  for (const id of ids) if (!_capSubs.has(id)) _capSubs.set(id, _subscribeHostCapabilities(id));
  for (const [id, dispose] of _capSubs) if (!ids.has(id)) { try { dispose(); } catch {} _capSubs.delete(id); }
}
hostsStore.subscribe(syncCapabilitySubscriptions);

// Per-server metrics live tick (Performance deep-dive only)
function subscribeServerMetrics(serverId, onTick) {
  if (!serverId || typeof onTick !== "function") return () => {};
  const topic = "servers/" + serverId + "/metrics";
  return api.stream.subscribe([topic], (m) => {
    if (m && m.type === "metrics.tick" && m.data) onTick(m.data);
  });
}

// Per-server metrics HISTORY
async function fetchServerMetricsHistory(serverId, range, hostId) {
  if (!serverId || !hostId) return null;
  const r = range || "1h";
  return api.host(hostId).get("/servers/" + serverId + "/metrics/history?range=" + r);
}

// HOST metrics history — the monitor's host-entity series (cpuTotalPct, memUsedKb, load, disk I/O,
// and the slice split sliceCpuPctCore/sliceMemBytes), relayed verbatim by the api.
async function fetchHostMetricsHistory(hostId, range) {
  if (!hostId) return null;
  return api.host(hostId).get("/hosts/" + hostId + "/metrics/history?range=" + (range || "1h"));
}

// Every hwmon channel's range over a window — min/max/mean per channel in ONE request. A thermal panel
// draws a range per channel, and asking the per-entity endpoint once per channel would fetch a full
// window of points each time only to reduce it to three numbers.
async function fetchSensorSummary(hostId, range) {
  if (!hostId) return null;
  return api.host(hostId).get("/hosts/" + hostId + "/sensors/metrics/summary?range=" + (range || "24h"));
}

// Every GPU's range over the same window. A separate request from the hwmon one because the two are
// separate row sets keyed differently — a device by UUID, a channel by chip/device/tempN.
async function fetchGpuSummary(hostId, range) {
  if (!hostId) return null;
  return api.host(hostId).get("/hosts/" + hostId + "/gpus/metrics/summary?range=" + (range || "24h"));
}

// ONE device's series. Addressed by UUID, which survives the driver renumbering the cards.
async function fetchGpuHistory(hostId, uuid, range) {
  if (!hostId || !uuid) return null;
  return api.host(hostId).get(
    "/hosts/" + hostId + "/gpus/" + encodeURIComponent(uuid) + "/metrics/history?range=" + (range || "1h"));
}

// ONE channel's series, for a card that draws a trace. The channel id goes in a query parameter because
// a sensor id is chip/device/tempN and carries the separator a path segment would split on.
async function fetchSensorHistory(hostId, sensorId, range) {
  if (!hostId || !sensorId) return null;
  return api.host(hostId).get(
    "/hosts/" + hostId + "/sensors/metrics/history?sensor=" + encodeURIComponent(sensorId) +
    "&range=" + (range || "1h"));
}

// Lifecycle events for ONE server
async function fetchServerEvents(serverId, hostId, sinceIso) {
  if (!serverId) return [];
  if (!hostId) return [];
  const qs = new URLSearchParams({ serverId, limit: "200" });
  if (sinceIso) qs.set("since", sinceIso);
  const page = await api.host(hostId).get("/audit?" + qs.toString());
  return (page && page.rows) || (page && Array.isArray(page.data) ? page.data : null) || (Array.isArray(page) ? page : []) || [];
}

// The host DETAIL response, for the blocks the list deliberately doesn't carry.
//
// `GET /hosts` and `GET /hosts/{id}` are not the same shape: the firewall's `network` block is
// detail-only (it costs a probe of the firewall authority, so it is not paid per host on a list). The
// store is hydrated from the list, so anything reading `host.network.firewall` off it reads an absent
// field — this is the call that actually asks.
//
// Returns the adapted host, NOT a store patch: the list is the fleet roll-up and a detail response
// carries fields a merge would have to invent for every other host. The one surface that needs the
// detail holds it itself.
//
// ⚠ The response is ALREADY adapted — `apiClient`'s response table maps `/hosts/{id}` through
// `adaptHost` on the way out (see `adaptResponse`). Adapting it a second time here silently destroys
// the very fields this call exists for: the second pass reads `label` and `identity` off a shape that
// no longer has them, so the host's name falls back to its id and its build, runtime, OS and region all
// read "not reported" — with no error anywhere. Take what the seam hands back.
async function fetchHostDetail(hostId) {
  if (!hostId) return null;
  return api.host(hostId).get("/hosts/" + hostId);
}

// ---- Libraries: the named roots a node places servers in ----------------
//
// There is no libraries store. The list rides `hostsStore` already — it is part of the host aggregate
// the API serves and the SPA refreshes — so a second cache would be a second answer to "where can this
// node put a server", and the two would disagree the first time a disk was unplugged. These three
// mutate and then re-read the host, which is what makes the storage card, the install modal and the
// node overview all move together off one measurement.
function addLibrary(hostId, path, name) {
  const body = { path, origin: "ui" };
  if (name) body.name = name;
  return api.host(hostId).post("/hosts/" + hostId + "/libraries", body)
    .then(r => hostsStore.refresh().then(() => r));
}

function renameLibrary(hostId, from, to) {
  return api.host(hostId)
    .patch("/hosts/" + hostId + "/libraries/" + encodeURIComponent(from), { name: to, origin: "ui" })
    .then(r => hostsStore.refresh().then(() => r));
}

// No force. The node refuses while servers still resolve to the library and names them; that refusal
// is the answer, and a flag that overrode it would produce in one click the state the engine exists to
// prevent.
//
// `drainTo` is the sanctioned way past it: every server in this library moves into that one, and the
// library is deregistered once the last has landed. Every one of them has to be stopped first — the
// node lists the running ones and moves nothing rather than stopping servers on somebody's behalf.
//
// ⚠ This request blocks for the whole copy, which is minutes per server. Nothing in the engine
// brackets a drain, so there is no per-server progress to follow and the caller waits it out.
function removeLibrary(hostId, name, drainTo) {
  const qs = "?origin=ui" + (drainTo ? "&drain=" + encodeURIComponent(drainTo) : "");
  return api.host(hostId)
    .del("/hosts/" + hostId + "/libraries/" + encodeURIComponent(name) + qs)
    .then(r => hostsStore.refresh().then(() => r));
}

export {
  hostsStore, syncCapabilitySubscriptions,
  subscribeHostMetrics, subscribeServerMetrics,
  fetchServerMetricsHistory, fetchHostMetricsHistory, fetchSensorSummary, fetchSensorHistory,
  fetchGpuSummary, fetchGpuHistory, fetchServerEvents, fetchHostDetail,
  addLibrary, renameLibrary, removeLibrary,
};
