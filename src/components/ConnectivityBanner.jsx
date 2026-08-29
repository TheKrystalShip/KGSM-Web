import { Icon } from "./Icon.jsx";
import { api, connectionStore, realtimeStore } from "../lib/apiClient.js";
import { useStore } from "../lib/store.js";
import { hostsStore } from "../lib/stores.js";
import { nodeLabel } from "../lib/nodeLabel.js";

// The connection-status surfaces, split out of ErrorBoundary.jsx because they are the only part of
// it that reads the NODE data layer — the connection stores, the host roster, the reconnect action.
// An error boundary is needed by every surface; a banner about which of a cluster's nodes are
// reachable is needed only by the one that drives a cluster, and importing the two together drags
// apiClient into a surface that has no nodes at all.

// ---- 2. Connectivity banner (the single connection-status slot) -----------
// One banner, three layered cases by precedence so they never stack:
//   1) browser offline  — global; no network means every host link is down.
//   2) backend UNREACHABLE — warm REST drop; affects all hosts ("Can't reach
//      Krystal"). Owns this case so the per-host list below stays quiet.
//   3) per-host link DROPPED — one or more hosts lost their live channel while
//      the backend is fine; names them so the operator knows what's stale.
// The realtime channel is PER HOST, so there is no global "live" UI — the
// healthy state shows nothing here, and each host's own surface carries its
// indicator (see HostConnection).
function joinNames(names) {
  if (names.length === 1) return names[0];
  if (names.length === 2) return names[0] + " and " + names[1];
  return names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
}

function ConnectivityBanner({ onRetryRest }) {
  const restStatus = useStore(connectionStore, s => s.status);
  const restRetrying = useStore(connectionStore, s => s.retrying);
  const rt = useStore(realtimeStore, s => s);
  const hosts = useStore(hostsStore, s => s.list);
  const nameOf = (id) => nodeLabel(id, hosts);

  // 1) Browser offline — supersedes everything.
  if (!rt.online) {
    return (
      <div className="conn-banner conn-banner--down" role="status">
        <span className="conn-banner__pulse conn-banner__pulse--down"></span>
        <Icon name="wifi-off" size={15} />
        <span className="conn-banner__text">
          <b>You’re offline.</b> Live updates are paused for every host — what you see may be out of date. We’ll reconnect and catch up automatically when your network returns.
        </span>
      </div>
    );
  }
  // 2) Backend unreachable (warm REST drop) — affects all hosts.
  if (restStatus === "down") {
    return (
      <div className="conn-banner" role="status">
        <span className="conn-banner__pulse"></span>
        <Icon name="wifi-off" size={15} />
        <span className="conn-banner__text">
          <b>Can't reach Krystal.</b> Live updates are paused — what you see may be out of date, and changes might not save.
        </span>
        <button className="conn-banner__retry" onClick={onRetryRest} disabled={restRetrying}>
          <Icon name="rotate-cw" size={13} className={restRetrying ? "is-spinning" : ""} />
          {restRetrying ? "Reconnecting…" : "Retry now"}
        </button>
      </div>
    );
  }
  // 3) One or more host links dropped while the backend is fine.
  const dropped = Object.keys(rt.hosts).filter(id => rt.hosts[id].mode === "reconnecting");
  if (!dropped.length) return null;
  const names = dropped.map(nameOf);
  const one = names.length === 1;
  return (
    <div className="conn-banner" role="status">
      <span className="conn-banner__pulse"></span>
      <Icon name="refresh-cw" size={15} className="is-spinning" />
      <span className="conn-banner__text">
        <b>Lost the live connection to {joinNames(names)}.</b> Showing last-known data and refreshing on a timer while we reconnect — new console output from {one ? "it" : "those hosts"} is paused.
      </span>
      <button className="conn-banner__retry" onClick={() => dropped.forEach(id => api.reconnectHost(id))}>
        <Icon name="rotate-cw" size={13} /> Reconnect now
      </button>
    </div>
  );
}

// ---- 2b. Per-host connection indicator ------------------------------------
// Each host has its own WebSocket, so connection state is shown ON THAT HOST'S
// surfaces — never globally. `full` (the Fleet deep-dive header) always renders
// live/reconnecting/offline with a retry control; the compact form (Fleet grid
// cards) stays SILENT when live and only speaks up when a link is degraded, so
// healthy cards aren't cluttered.
function HostConnection({ hostId, full }) {
  const rt = useStore(realtimeStore, s => s);
  const restDown = useStore(connectionStore, s => s.status === "down");
  const h = rt.hosts[hostId];
  const mode = !rt.online ? "offline"
    : (restDown || (h && h.mode === "reconnecting")) ? "reconnecting"
    : "live";
  if (!full && mode === "live") return null;

  const META = {
    live:         { tone: "live", label: "Live" },
    reconnecting: { tone: "warn", label: "Reconnecting" },
    offline:      { tone: "down", label: "Offline" },
  }[mode];
  const retrySecs = h ? Math.ceil((h.nextRetryInMs || 0) / 1000) : 0;

  return (
    <span className={"host-conn host-conn--" + META.tone + (full ? " host-conn--full" : "")}
      title={"Live data channel for this host: " + META.label}>
      <span className={"host-conn__dot host-conn__dot--" + META.tone}></span>
      <span className="host-conn__label">{META.label}</span>
      {full && mode === "reconnecting" && (
        <>
          <span className="host-conn__meta">{retrySecs > 0 ? "retry in " + retrySecs + "s" : "retrying…"}{h && h.polling ? " · polling" : ""}</span>
          <button className="host-conn__btn" onClick={() => api.reconnectHost(hostId)}>
            <Icon name="rotate-cw" size={12} /> Reconnect
          </button>
        </>
      )}
      {full && mode === "offline" && (
        <span className="host-conn__meta">your device has no network</span>
      )}
    </span>
  );
}

export { ConnectivityBanner, HostConnection };
