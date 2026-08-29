// stores/cluster.js — the converged cluster-roster store for the Cluster page.
//
// Two backend surfaces feed the same shape: the admin peer roster
// (GET /peers, full peer-management rows) and the viewer-safe converged
// roster (GET /peers/roster, node-only rows). refresh() tries admin first and
// falls back to the viewer roster on a 403 — the store never fabricates a
// value either code path doesn't provide (honest null/"unknown").

import { api } from "../apiClient.js";
import { CONNECTIONS } from "../config.js";
import { reconcileRosterToRegistry } from "../connect.js";
import { createStore } from "../store.js";
import { hostsStore } from "./hosts.js";

const clusterStore = createStore({
  nodes: [],
  status: "idle",
  error: null,
  everLoaded: false,
  admin: false,
});

// Admin PeerView row → normalized node.
function fromPeerRow(row) {
  return {
    nodeId: row.nodeId,
    label: row.nickname || row.nodeId,
    clientUrl: row.url,
    membership: row.membership || "unknown",
    status: row.status || "unknown",
    latencyMs: row.latencyMs ?? null,
    lastSeen: row.lastSeen || null,
    enabled: row.enabled !== false,
    apiVersion: row.apiVersion || null,
    peerId: row.id,
    isAdmin: true,
  };
}

// Viewer ClusterNodeView row → normalized node.
function fromClusterNodeRow(row) {
  return {
    nodeId: row.nodeId,
    label: row.label || row.nodeId,
    clientUrl: row.clientUrl,
    membership: row.membership || "unknown",
    status: row.status || "unknown",
    latencyMs: row.latencyMs ?? null,
    lastSeen: null,
    enabled: true,
    apiVersion: null,
    peerId: null,
    isAdmin: false,
  };
}

function isForbidden(err) {
  return !!err && (err.code === 403 || err.status === 403);
}

// Read one node's view of the roster: the admin peer list, falling back to the
// viewer-safe converged roster on a 403. Resolves { nodes, admin }.
function fetchRoster(hostId) {
  return api.peers(hostId).list()
    .then(rows => ({ nodes: rows.map(fromPeerRow), admin: true }))
    .catch(err => {
      if (!isForbidden(err)) throw err;
      return api.peers(hostId).roster().then(rows => ({ nodes: rows.map(fromClusterNodeRow), admin: false }));
    });
}

// One roster read, applied. Every path that obtains a roster lands here, so the node
// set the app drives is updated by the same act that updates what the Cluster page
// shows — an admin removing a peer sees it leave the fan-out on the click, rather
// than at whatever point the discovery timer next happens to fire.
function applyRoster(hostId, { nodes, admin }) {
  clusterStore.setState(s => ({ ...s, nodes, status: "ready", error: null, everLoaded: true, admin }));
  return reconcileRosterToRegistry(nodes, { localHostId: hostId });
}

clusterStore.refresh = (hostId) => {
  clusterStore.setState(s => ({ ...s, status: "loading", error: null }));
  return fetchRoster(hostId).then(roster => {
    applyRoster(hostId, roster);
    return roster.nodes;
  }).catch(err => {
    clusterStore.setState(s => ({ ...s, status: "error", error: err }));
    throw err;
  });
};

// ---- Cluster discovery --------------------------------------------------
// The node set the SPA drives is the CLUSTER's, not the list of addresses this
// browser happens to have been pointed at. Ask any node we can reach for the
// converged roster and register the peers it names; the connection set grows in
// place, so every surface fans out over them from the next read on.
//
// Runs for every tier — a viewer resolves the same roster through the
// viewer-safe path inside fetchRoster. Nodes are tried in order and the FIRST
// that answers wins: the roster is converged, so any reachable node's view is
// the cluster's view. All nodes failing is not an error state here — an
// unreachable cluster is already surfaced by the connection banner, and a
// roster we could not read must not clear or contradict one we already have.
//
// The connection set FOLLOWS the roster (see reconcileRosterToRegistry): an alive
// + reachable peer carrying both a nodeId and a client URL is registered, and a
// node the roster no longer names is dropped. A peer we cannot verify stays a
// visible ghost on the Cluster page rather than becoming a dead connection; a
// member that is merely unwell keeps its connection, because being unreachable is
// not the same as having left.
// Only a connection whose BACKEND id is reconciled can be asked (api.peers
// requires a concrete id) — the seed starts id-less and GET /hosts fills it in.
const addressable = () => CONNECTIONS.filter(c => c.id);

clusterStore.discover = () => {
  const conns = addressable();
  const attempt = (i) => {
    if (i >= conns.length) return Promise.resolve(0);
    return Promise.resolve()
      .then(() => fetchRoster(conns[i].id))
      .then(roster => applyRoster(conns[i].id, roster).added)
      .catch(() => attempt(i + 1));
  };
  return attempt(0);
};

// Re-run discovery on a slow cadence so a node federated elsewhere joins this
// browser's fan-out on its own, without anyone opening the Cluster page.
const DISCOVER_MS = 60000;
let _discoverTimer = null;
function startDiscovery() {
  if (_discoverTimer || !CONNECTIONS.length) return;
  const run = () => { clusterStore.discover().catch(() => {}); };
  // Nothing is addressable until the first GET /hosts reconciles an id, so wait
  // for that rather than spending the boot attempt on an empty set.
  if (addressable().length) run();
  else {
    const stop = hostsStore.subscribe(() => {
      if (!addressable().length) return;
      stop();
      run();
    });
  }
  _discoverTimer = setInterval(run, DISCOVER_MS);
}

function stopDiscovery() {
  if (!_discoverTimer) return;
  clearInterval(_discoverTimer);
  _discoverTimer = null;
}

export { clusterStore, startDiscovery, stopDiscovery };
