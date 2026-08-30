// clusterNodes.js — merges the connected-node roster (hostsStore.list — the
// primitive with capacity meters + the per-node deep-dive) with federation
// data (clusterStore.nodes — gossip membership/status/latency) into the ONE
// node shape both the constellation and the node list render from.
//
// The two lists have a shared key and the match is EXACT. A node's cluster identity
// defaults to the same stable id its host card carries — kgsm-api resolves
// `Api__NodeId` from `Api__HostId` precisely so a node does not have a second
// independent name — so `host.id === member.memberId` for the same machine.
//
// The lists are still separate because they answer different questions and neither
// contains the other: hosts are what THIS BROWSER can drive, gathered by fanning out
// across its connections, and carry capacity; the roster is what ONE node says the
// cluster's membership is, and a member is never in its own roster. Only the client
// holds both, which is why the join happens here — and why it stops being needed once
// the panel takes its node set from the cluster (`../../cluster-panel-plan.md` §4·e).
//
// A host that matches nothing still renders: federation data is enrichment, never a
// gate. It is shown without a membership badge rather than with a guessed one.

// matchFederationNode(host, clusterNodes) — the federation NODE that is this host, by id.
//
// Exact, because a fuzzy match on this data pairs the wrong members. A substring test
// across id, label and address reads "hotrod-auth" as "hotrod": a machine's anchor is
// conventionally named after the machine, so the anchor was absorbed into that node's row
// and disappeared from the page, taking the node's own federation data with it.
//
// Anchors are skipped as well as keyed out. A connected host is a node, so an anchor is
// never its counterpart whatever the ids say.
function matchFederationNode(host, clusterNodes) {
  const id = host && host.id;
  if (!id) return null;
  for (const n of clusterNodes) {
    if (n.kind && n.kind !== "node") continue;
    if (n.nodeId === id) return n;
  }
  return null;
}

// buildClusterNodes(hosts, clusterNodes, pingByHost, localId) — one entry per
// connected host: { key, host, fed, ping, latencyMs, isLocal, ghost:false },
// PLUS one "ghost" entry per federation node that matched no connected host:
// { key: "fed:"+nodeId, host:null, fed, ping:null, latencyMs, isLocal:false,
// ghost:true } — a peer the backend gossips about that this browser has no
// live host session for. A federation node is counted at most once: the same
// node that enriches a connected host is never also emitted as a ghost
// (tracked by nodeId as each host is matched). `latencyMs` is the ONE honest
// latency reading either side of the merge exposes to the constellation:
// connected → the client-measured ping (never the federation's own number,
// which measures a different link); ghost → the federation-reported latency
// (the only number that exists for a peer with no host session). Sorted
// local-first, then connected hosts by name, then ghosts by name — ghosts
// read as secondary, ordered last.
function buildClusterNodes(hosts, clusterNodes, pingByHost, localId) {
  const fedList = clusterNodes || [];
  const matchedIds = new Set();
  const nodes = (hosts || []).map(host => {
    const fed = matchFederationNode(host, fedList);
    if (fed) matchedIds.add(fed.nodeId);
    const ping = (pingByHost && pingByHost[host.id]) || null;
    return {
      key: host.id,
      host,
      fed: fed || null,
      ping,
      latencyMs: ping && ping.ms != null ? ping.ms : null,
      isLocal: host.id === localId,
      ghost: false,
    };
  });
  nodes.sort((a, b) => (b.isLocal - a.isLocal) || a.host.name.localeCompare(b.host.name));

  const ghosts = fedList
    .filter(n => !matchedIds.has(n.nodeId))
    .map(n => ({
      key: "fed:" + n.nodeId,
      host: null,
      fed: n,
      ping: null,
      latencyMs: n.latencyMs != null ? n.latencyMs : null,
      isLocal: false,
      ghost: true,
    }))
    .sort((a, b) => (a.fed.label || a.fed.nodeId).localeCompare(b.fed.label || b.fed.nodeId));

  return [...nodes, ...ghosts];
}

// A member is a node or an anchor, and the two are rendered by different cards because
// they are different things: a node runs the engine and game servers, so its row is CPU,
// memory and a live link; an anchor provides one capability to the whole cluster and has
// none of those by design. Splitting a built list rather than building two keeps the
// topology whole — the constellation plots every member, since latency is a fact about a
// member and not about a kind.
const isAnchorEntry = (entry) => !!(entry.fed && entry.fed.kind === "anchor");

function nodeEntries(entries) {
  return (entries || []).filter(e => !isAnchorEntry(e));
}

function anchorEntries(entries) {
  return (entries || []).filter(isAnchorEntry);
}

export { buildClusterNodes, matchFederationNode, nodeEntries, anchorEntries };
