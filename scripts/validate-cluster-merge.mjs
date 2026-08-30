// The connected hosts and the cluster roster are joined by id, exactly.
//
// A node's cluster identity defaults to the same stable id its host card carries — kgsm-api
// resolves Api__NodeId from Api__HostId so a node has no second independent name — so the join
// is `host.id === member.memberId` and nothing has to be guessed.
//
// This exists because the guess was wrong in a way that removed a member from the page: a
// substring test across id/label/address read "hotrod-auth" as "hotrod", so a machine's anchor
// was absorbed into that machine's node row and vanished, taking the node's own federation data
// with it.
//
// Pure module test: no DOM, no server, no network.
//
//   node scripts/validate-cluster-merge.mjs

import { buildClusterNodes, matchFederationNode, nodeEntries, anchorEntries }
  from "../src/pages/diagnostics/clusterNodes.js";

let fail = 0;
const check = (ok, label, extra = "") => {
  console.log(`${ok ? "✓" : "✗"} ${label}${extra ? " — " + extra : ""}`);
  if (!ok) fail++;
};

const host = (id, over = {}) => ({ id, name: id, hostname: id, ...over });
const member = (nodeId, over = {}) => ({
  nodeId, label: nodeId, kind: "node", clientUrl: `https://${nodeId}.test`,
  membership: "alive", status: "reachable", latencyMs: 4, enabled: true, ...over,
});

// 1. The join every multi-node browser depends on.
check(matchFederationNode(host("hotrod"), [member("hotrod")])?.nodeId === "hotrod",
  "a host is matched to the member with its id");

// 2. The bug this replaced. A machine's anchor is named after the machine.
check(matchFederationNode(host("hotrod"), [member("hotrod-auth", { kind: "anchor" })]) === null,
  "an anchor is never taken for the node it is named after");

// 3. And not even when it claims to be a node — the id is the key, not the shape of it.
check(matchFederationNode(host("hotrod"), [member("hotrod-auth")]) === null,
  "a member whose id merely contains the host's is not a match");

// 4. A host the roster does not name renders anyway; enrichment is not a gate.
check(matchFederationNode(host("elsewhere"), [member("hotrod")]) === null,
  "an unmatched host yields no federation data rather than a guess");

// 5. A connection whose backend id has not been reconciled yet cannot be joined, and must not
//    fall back to matching by name — that is where the substring rule came from.
check(matchFederationNode({ name: "hotrod", hostname: "hotrod" }, [member("hotrod")]) === null,
  "a host with no id yet is not matched by its name");

// ---- the built list ----------------------------------------------------------------
const hosts = [host("hotrod")];
const roster = [
  member("hotrod-auth", { kind: "anchor" }),
  member("hotbox"),
  member("old-node", { membership: "left", status: "unreachable" }),
];
const built = buildClusterNodes(hosts, roster, {}, "hotrod");

check(built.length === 4, "every host and every member the roster names appears once", `got ${built.length}`);
check(built.filter(e => e.ghost).length === 3, "the three the browser holds no session for are ghosts");

const anchors = anchorEntries(built);
const nodes = nodeEntries(built);
check(anchors.length === 1 && anchors[0].fed.nodeId === "hotrod-auth",
  "the anchor is separable for its own card", anchors.map(a => a.fed.nodeId).join());
check(nodes.length === 3 && !nodes.some(n => n.fed && n.fed.kind === "anchor"),
  "and never appears among the nodes", nodes.length + " nodes");

// 6. A member the roster carries with the same id as a connected host enriches it rather than
//    being listed twice — the whole reason the join exists.
const joined = buildClusterNodes([host("hotbox")], [member("hotbox")], {}, "hotrod");
check(joined.length === 1 && !joined[0].ghost && joined[0].fed?.membership === "alive",
  "a matched member enriches its host instead of doubling it", `${joined.length} entries`);

console.log(fail ? `\n!! ${fail} failed` : "\nall checks passed");
process.exit(fail ? 1 : 0);
