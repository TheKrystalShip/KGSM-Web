import React from "react";
import { api } from "./apiClient.js";

// hostThresholds.js — the lines a host judges its own metrics by, read once and shared.
//
// The rules are the monitor's, published per host, and they are what decides whether a number is
// worth colouring. Reading them here rather than writing the numbers into each surface is what keeps
// a tile and the alert it would raise from disagreeing: an operator who moves the memory line moves
// what the panel calls amber, with no second copy to find.
//
// Cached per host because several surfaces on one page ask for the same document — the resource
// tiles, the thermal panel, and any pinned sensor card. The TTL is short enough that an edit made on
// the monitor's own thresholds page shows up without a reload.

const TTL_MS = 60000;

// hostId -> { at, doc } | { promise }
const _cache = new Map();

function load(hostId) {
  const held = _cache.get(hostId);
  if (held && held.promise) return held.promise;
  if (held && Date.now() - held.at < TTL_MS) return Promise.resolve(held.doc);

  const promise = api.host(hostId)
    .get("/hosts/" + encodeURIComponent(hostId) + "/thresholds")
    .then(
      (doc) => { _cache.set(hostId, { at: Date.now(), doc }); return doc; },
      // A host that will not answer has no published lines, which is a different thing from lines of
      // zero: every caller falls back to its own default and none of them draws a line nobody set.
      () => { _cache.set(hostId, { at: Date.now(), doc: null }); return null; });

  _cache.set(hostId, { promise });
  return promise;
}

/// The host's threshold document, or null until it arrives and null if it cannot be read.
function useHostThresholds(hostId) {
  const [doc, setDoc] = React.useState(null);
  React.useEffect(() => {
    let alive = true;
    if (!hostId) { setDoc(null); return undefined; }
    load(hostId).then((d) => { if (alive) setDoc(d); });
    return () => { alive = false; };
  }, [hostId]);
  return doc;
}

/// One metric's warn/danger pair out of a threshold document, or null when the host publishes no
/// enabled rule for it. `danger` is null on a rule that states only a warning.
function ruleLines(doc, metric) {
  const rule = ((doc && doc.rules) || []).find((r) => r.metric === metric && r.enabled);
  return rule ? { warn: rule.warn, danger: rule.danger ?? null } : null;
}

export { useHostThresholds, ruleLines };
