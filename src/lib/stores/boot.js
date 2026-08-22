// stores/boot.js — starting and stopping the data layer.
//
// None of this runs at import. A browser on the node or sign-in screen has no identity
// and has not necessarily chosen a host yet, so hydrating stores and dialling one SSE
// stream per connection would be traffic on behalf of nobody: every call 401s, every
// stream backs off and retries forever, and none of it can succeed until somebody signs
// in. The shell calls startDataLayer() once it has a live session, and stopDataLayer()
// when it loses one.
//
// Both are idempotent, because the shell may mount twice (StrictMode) and a session can
// be lost and regained without a reload.

import { api } from "../apiClient.js";
import { serversStore } from "./servers.js";
import { libraryStore } from "./library.js";
import { hostsStore, syncCapabilitySubscriptions } from "./hosts.js";
import { auditStore } from "./audit.js";
import { batchesStore } from "./batches.js";
import { startDiscovery, stopDiscovery } from "./cluster.js";
import { prefsStore } from "./prefs.js";
import { startPingLoop, stopPingLoop } from "./ui.js";
import { assistantSession } from "../assistantSession.js";

// Tell the assistant session layer how THIS surface finds a leaf: by discovery, off the node's
// assistant capability. The session module holds no opinion, so it can also serve the standalone
// assistant — which has one leaf at a known address and no host store to read.
//
// Pure wiring, so it stays at import: it registers a resolver and asks nothing of anybody.
assistantSession.setOriginResolver((hostId) => {
  const host = hostsStore.find(hostId);
  const cap = host && host.capabilities && host.capabilities.assistant;
  if (!cap || cap.provisioned === false) return null;
  return (cap.info && cap.info.url) || null;
});

// ⚠ sessionStore is reached by a LAZY import, not a static one. It imports hostsStore from
// `../stores.js`, which is this folder's barrel, which imports this file — a static import
// here would close that cycle and break boot. Same landmine as apiClient's deferred
// imports; see `../CLAUDE.md`. Nothing depends on the bootstrap having started before the
// refreshes below, because every one of them goes through the egress funnel, which
// authorizes the host it is addressing on its own.
const withSessionStore = (fn) =>
  import("../sessionStore.js").then((m) => fn(m.sessionStore)).catch(() => {});

let started = false;

function startDataLayer() {
  if (started) return;
  started = true;
  try {
    const swallow = () => {};
    withSessionStore((s) => s.startBootstrap());
    api.startStreams();
    serversStore.refresh().catch(swallow);
    libraryStore.refresh().catch(swallow);
    auditStore.refresh().catch(swallow);
    // The runs the nodes are already executing. Hydrated at boot rather than when a tray is opened:
    // a run started before this browser existed is exactly what the tray is for, and its badge has
    // to be right before anybody thinks to look at it.
    batchesStore.refresh().catch(swallow);
    // ⚠ Preferences hydrate AFTER the host roster, not beside it. The home node is addressed by its
    // BACKEND id, and a seeded connection holds none until `GET /hosts` reconciles it — so hydrating
    // in parallel finds no node, concludes the account has no stored preferences, and the dashboard
    // seeds a default over the layout that was actually there. Reconciliation is what this waits on;
    // a roster that fails still resolves the hydrate, which then honestly reports no node.
    hostsStore.refresh().catch(swallow).finally(() => { prefsStore.hydrate().catch(swallow); });
    startPingLoop();
    // Resolve the cluster's node set, not just the addresses this browser holds.
    // A peer it registers joins the fan-out live; apiClient re-hydrates the stores
    // above when that happens, so the order here doesn't matter.
    startDiscovery();
    syncCapabilitySubscriptions();
  } catch {}
}

function stopDataLayer() {
  if (!started) return;
  started = false;
  try {
    api.stopStreams();
    stopDiscovery();
    stopPingLoop();
    withSessionStore((s) => s.stopBootstrap());
  } catch {}
}

export { startDataLayer, stopDataLayer };
