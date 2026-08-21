import React from "react";

// keyedResource.js — one hydrate and one subscription per KEY, however many components want it.
//
// A store that holds one target at a time works while exactly one surface reads it. It stops working
// the moment a card can be pinned: two leaf journals side by side, or a journal on the dashboard
// while its own page is open, are then two readers fighting over one slot — each `refresh` blanking
// the other's data, with no error to show for it.
//
// The fix is two halves. The store becomes keyed (`byKey[…]`), which is what lets two targets exist
// at once; and this, which is what stops N mounts of the same target from hydrating N times or one
// unmount from disposing the subscription another still wants.
//
// The transport underneath is already ref-counted — `api.stream.subscribe` opens one SSE stream per
// topic no matter how many listeners — so this is about the REST hydrate and the store slot, not
// about sockets.

// key -> { count, dispose }
const _live = new Map();

/// Acquire a keyed resource. Returns a release function.
///
/// The first acquirer for a key runs `hydrate()` and `follow()`; every later one just increments.
/// The last to release runs the disposer `follow()` returned.
function acquire(key, hydrate, follow) {
  const held = _live.get(key);
  if (held) {
    held.count++;
    return () => release(key);
  }
  let dispose = null;
  try { if (hydrate) hydrate(); } catch { /* a failed hydrate is the store's error state, not a throw here */ }
  try { dispose = follow ? follow() : null; } catch { dispose = null; }
  _live.set(key, { count: 1, dispose });
  return () => release(key);
}

function release(key) {
  const held = _live.get(key);
  if (!held) return;
  held.count--;
  if (held.count > 0) return;
  _live.delete(key);
  if (typeof held.dispose === "function") { try { held.dispose(); } catch { /* already gone */ } }
}

/// The hook form. `key` is null when there is nothing to bind to (a half-bound widget), and then
/// nothing is acquired at all.
///
/// `hydrate` and `follow` are held in a ref rather than taken as dependencies: every call site
/// passes inline arrows closing over the ids, which would be new identities on every render and
/// re-acquire forever. The KEY is the dependency, which is the honest one — it is what decides
/// whether this is the same resource.
function useKeyedResource(key, hydrate, follow) {
  const fns = React.useRef({ hydrate, follow });
  fns.current = { hydrate, follow };

  React.useEffect(() => {
    if (!key) return undefined;
    return acquire(key, () => fns.current.hydrate && fns.current.hydrate(),
      () => fns.current.follow && fns.current.follow());
  }, [key]);
}

/// How many holders a key has. For tests and the harness — a leak here is invisible otherwise.
const holdersOf = (key) => (_live.get(key) || { count: 0 }).count;

export { acquire, holdersOf, release, useKeyedResource };
