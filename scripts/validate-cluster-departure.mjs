// The connection set follows the cluster roster, in both directions.
//
// A node that has LEFT the cluster is gone from this browser: no stream, no fan-out
// slot, no name in the connectivity banner, no line in the reach footnote. A node
// that is still a member but UNWELL keeps all of those, because being unreachable is
// not the same as having left, and the surfaces that report it are telling the truth.
//
// Pure module test: the real config/connect modules over a jsdom localStorage, no
// server and no network.
//
//   node scripts/validate-cluster-departure.mjs

import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost:5173/" });
globalThis.window = dom.window;
globalThis.localStorage = dom.window.localStorage;

const REGISTRY_KEY = "krystal:hosts:registry";

// The node the browser is signed in through — always present, never in its own roster.
localStorage.setItem(REGISTRY_KEY, JSON.stringify([
  { id: "hotrod", url: "https://kgsm.thekrystalship.com", name: "hotrod", via: "manual" },
]));

const config = await import("../src/lib/config.js");
const connect = await import("../src/lib/connect.js");
const { CONNECTIONS } = config;
const { reconcileRosterToRegistry } = connect;

let fail = 0;
const assert = (c, label, extra = "") => {
  console.log(`${c ? "✓" : "✗"} ${label}${extra ? " — " + extra : ""}`);
  if (!c) fail++;
};
const ids = () => CONNECTIONS.map(c => c.id).filter(Boolean).sort();
const stored = () => JSON.parse(localStorage.getItem(REGISTRY_KEY) || "[]").map(e => e.id).sort();
const node = (nodeId, over = {}) => ({
  nodeId,
  label: nodeId,
  clientUrl: `https://${nodeId}.test`,
  membership: "alive",
  status: "reachable",
  enabled: true,
  ...over,
});

const LOCAL = { localHostId: "hotrod" };

// 1. A peer the roster names joins the driven set.
let r = reconcileRosterToRegistry([node("hotrod-b")], LOCAL);
assert(r.added === 1 && r.removed === 0, "an alive, reachable peer joins the connection set", `added=${r.added}`);
assert(ids().join() === "hotrod,hotrod-b", "both nodes are driven", ids().join());
assert(stored().join() === "hotrod,hotrod-b", "and the registry records it", stored().join());

// 2. Repeating the same roster changes nothing.
r = reconcileRosterToRegistry([node("hotrod-b")], LOCAL);
assert(r.added === 0 && r.removed === 0, "a repeated roster converges rather than churns");

// 3. A MEMBER that has gone unreachable is kept — it is unwell, not gone.
r = reconcileRosterToRegistry([node("hotrod-b", { status: "unreachable", membership: "suspect" })], LOCAL);
assert(r.removed === 0, "an unreachable member keeps its connection");
assert(ids().join() === "hotrod,hotrod-b", "so the surfaces can still report it as degraded", ids().join());

// 4. A node the roster no longer names has LEFT — it goes.
r = reconcileRosterToRegistry([], LOCAL);
assert(r.removed === 1, "a node absent from the roster is dropped", `removed=${r.removed}`);
assert(ids().join() === "hotrod", "only the node we are signed in through remains", ids().join());
assert(stored().join() === "hotrod", "and the stored registry forgets it too", stored().join());

// 5. The node we are signed in through is never dropped by its own roster.
r = reconcileRosterToRegistry([], LOCAL);
assert(r.removed === 0 && ids().join() === "hotrod", "the local node survives an empty roster");

// 6. An admin's disable switch stops the fan-out, matching what a viewer's roster shows.
reconcileRosterToRegistry([node("hotrod-b")], LOCAL);
r = reconcileRosterToRegistry([node("hotrod-b", { enabled: false })], LOCAL);
assert(r.removed === 1 && ids().join() === "hotrod", "a disabled peer is not driven", ids().join());

// 7. An address a person typed is theirs to remove; a roster is not a statement about it.
config.addConnections([{ id: "elsewhere", url: "https://elsewhere.test", name: "Typed by hand" }]);
r = reconcileRosterToRegistry([], LOCAL);
assert(r.removed === 0, "a manually-added node survives a roster that does not mention it");
assert(ids().join() === "elsewhere,hotrod", "it is still driven", ids().join());

// 8. Removal notifies the holders of per-node resources.
let told = null;
config.subscribeConnectionsRemoved((removed) => { told = removed.map(c => c.id); });
reconcileRosterToRegistry([node("hotrod-c")], LOCAL);
reconcileRosterToRegistry([], LOCAL);
assert(told && told.join() === "hotrod-c", "departure is announced so streams and sessions are released",
  told ? told.join() : "nothing");

console.log(fail ? `\n!! ${fail} failed` : "\nall checks passed");
process.exit(fail ? 1 : 0);
