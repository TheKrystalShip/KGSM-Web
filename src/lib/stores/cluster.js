// stores/cluster.js — the converged cluster-roster store for the Cluster page.
//
// Two backend surfaces feed the same shape: the admin roster
// (GET /members, full management rows) and the viewer-safe converged
// roster (GET /members/roster). refresh() tries admin first and
// falls back to the viewer roster on a 403 — the store never fabricates a
// value either code path doesn't provide (honest null/"unknown").

import { api } from "../apiClient.js";
import { CONNECTIONS } from "../config.js";
import { reconcileRosterToRegistry } from "../connect.js";
import { createStore } from "../store.js";
import { hostsStore } from "./hosts.js";

const clusterStore = createStore({
  nodes: [],
  // Which member holds each of the cluster's capabilities. A capability belongs to the
  // cluster rather than to any member, so it is not a field on a roster row — a member
  // is a node or an anchor, and being an anchor does not say WHICH capability it holds.
  capabilities: [],
  status: "idle",
  error: null,
  everLoaded: false,
  admin: false,
});

// Admin MemberView row → normalized node. A cluster member is a node or an
// anchor; `kind` carries which, so a surface can tell them apart without
// guessing from whether servers came back.
function fromPeerRow(row) {
  return {
    nodeId: row.memberId,
    kind: row.kind || "node",
    label: row.nickname || row.memberId,
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

// Viewer ClusterMemberView row → normalized node.
function fromClusterNodeRow(row) {
  return {
    nodeId: row.memberId,
    kind: row.kind || "node",
    label: row.label || row.memberId,
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
  return api.members(hostId).list()
    .then(rows => ({ nodes: rows.map(fromPeerRow), admin: true }))
    .catch(err => {
      if (!isForbidden(err)) throw err;
      return api.members(hostId).roster().then(rows => ({ nodes: rows.map(fromClusterNodeRow), admin: false }));
    });
}

// One roster read, applied. Every path that obtains a roster lands here, so the node
// set the app drives is updated by the same act that updates what the Cluster page
// shows — an admin removing a peer sees it leave the fan-out on the click, rather
// than at whatever point the discovery timer next happens to fire.
// The assignments are read wherever the roster is, and never gate it: a cluster whose
// capability list could not be read is still a cluster whose members are known, and
// failing the roster over it would lose more than it reports. A failed read keeps what is
// already held — "I could not ask" is not "nobody holds it", and blanking would make the
// page claim the cluster has no auth anchor.
//
// Called from applyRoster rather than from refresh(), because discovery reaches the roster
// without going through refresh: a browser that boots, discovers the cluster and never
// opens the management panel would otherwise hold members and no assignments, and the page
// that most needs to name the holder is the one that would never have it.
function loadCapabilities(hostId) {
  return api.members(hostId).capabilities()
    .then(rows => {
      if (Array.isArray(rows)) clusterStore.setState(st => ({ ...st, capabilities: rows }));
    })
    .catch(() => {});
}

function applyRoster(hostId, { nodes, admin }) {
  clusterStore.setState(s => ({ ...s, nodes, status: "ready", error: null, everLoaded: true, admin }));
  // Fired alongside, not awaited: the roster is the answer this returns and a slower second
  // read must not hold it up. The store updates when it lands.
  loadCapabilities(hostId);
  return reconcileRosterToRegistry(nodes, { localHostId: hostId });
}

// The member holding `capability`, or null when nobody does or nothing has been read
// yet. Absent and held-by-nobody are different answers and both come back as null here
// on purpose: a surface that needs to tell them apart reads the assignment itself.
clusterStore.holderOf = (capability) => {
  const found = clusterStore.getState().capabilities.find(c => c.capability === capability);
  return found && found.held ? found.memberId : null;
};

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
