import { serverMetricsFreshness } from "./HostCardBody.jsx";
import { Icon } from "./Icon.jsx";
import { ServerActionButton, verbGuard } from "./ServerActions.jsx";
import { ServerConnect } from "./ServerConnect.jsx";
import { serverCapUsable } from "../lib/capabilities.js";
import { serverOperable } from "../lib/persona.js";
import { favoritesStore, hostsStore, serversStore, useIsFavorite } from "../lib/stores.js";
import { artBg } from "../lib/art.js";
import { PHASE_LABEL, serverStatusLabel } from "../lib/servers.js";
import { formatBps, formatBytes, fmtBytesTight } from "../lib/formatting.js";
import { useRosterMetrics } from "../lib/hooks/useRosterMetrics.js";

// ServerCard — the reusable game-server tile (art header, live metrics,
// quick start/restart/stop). Shared by the Dashboard (online
// servers only) and the dedicated Servers page (all servers, filterable), so
// a card looks and behaves identically wherever it appears.

// The phase words a run reports, shared with every other surface that shows one
// (lib/servers.js). A phantom tile has no run-state to fall back on, so it names
// its own default; an ordinary tile goes through serverStatusLabel.

function ServerPhantomTile({ server }) {
  const art = artBg(server.hero, server.cover);
  const isUninstall = server.job?.verb === "uninstall";
  const isFailed = server.status === "install-failed";
  const phaseText = isFailed ? "Failed"
    : isUninstall ? "Uninstalling…"
    : (PHASE_LABEL[server.job?.phase]
        || (server.job?.state === "queued" ? "Queued…" : "Installing…"));
  const pillClass = isFailed ? "install-failed" : isUninstall ? "uninstalling" : "installing";

  return (
    <div className={"server-tile server-tile--phantom" + (isUninstall ? " server-tile--uninstalling" : "")}>
      <div className="server-tile__art" style={{ backgroundImage: art, backgroundSize: "cover", backgroundPosition: "center" }}>
        <span className="server-tile__game">{server.blueprint || server.game}</span>
      </div>
      <div className="server-tile__body">
        <div className="server-tile__head">
          <div className="server-tile__name">{server.name}</div>
          <span className={"server-tile__pill server-tile__pill--" + pillClass}>
            <span className="dot"></span>
            {phaseText}
          </span>
        </div>
        {!isFailed && <div className="server-tile__progress" />}
        {isFailed && (
          <button
            type="button"
            className="server-tile__dismiss"
            onClick={() => serversStore.remove(server.id)}>
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}

function ServerTile({ server, onOpen, onAction, showHost }) {
  // Pin state (client-local). The star both reads and writes the favorites
  // store; toggling it mirrors the card into the pinned Favorites section on the
  // Servers page without moving it out of its host group. Read before any early
  // return so the hook order is stable (Rules of Hooks).
  const isFav = useIsFavorite(server.id);
  // Live CPU / memory / network / disk for every card on screen, off ONE shared roster stream — the
  // `servers` topic carries status only, so without this the numbers below are as old as the last
  // status change. Shared and ref-counted, so a grid of cards costs one subscription.
  useRosterMetrics();
  // Players ride the server element itself (adaptServer), live off the same
  // server.patch stream as status — so a grid of cards costs no roster fetches
  // and every card agrees with the fleet total on the dashboard. null is "this
  // host cannot see who is on it", rendered "—", never 0.
  const playerCurrent = server.players ? server.players.current : null;
  if (server._phantom) return <ServerPhantomTile server={server} />;
  // kgsm-api serves cover/hero directly (the old client-side RAWG hook is gone).
  // Prefers landscape hero, then portrait cover, then themed gradient placeholder.
  const art = artBg(server.hero, server.cover);
  const host = showHost ? hostsStore.find(server.hostId) : null;

  const isOnline = server.status === "online";
  // Launched but not yet joinable — the metric labels below read it as running.
  const isStarting = server.status === "starting";
  const pendingVerb = server.job && server.job.state === "running" ? server.job.verb : null;
  // Live CPU/RAM are host-metrics — when the host's metrics feed is down they
  // go dark with a red status LED, matching the host diagnostics treatment.
  // Only meaningful while the server is online (offline servers report nothing).
  const mFresh = serverMetricsFreshness(server);
  const metricsOff = !!(mFresh && mFresh.frozen) && isOnline;
  // Lifecycle actions are watchdog-mediated — lock the quick row when down.
  const watchdogDown = !serverCapUsable(server, "watchdog");
  // One shared answer for whether each verb can run and why not (ServerActions.jsx),
  // so the tile, the hero and an alert card's suggested action never disagree.
  const guard = { start: verbGuard(server, "start"), stop: verbGuard(server, "stop"),
                  restart: verbGuard(server, "restart") };
  // Players (viewer / consumer preview) can't operate this host — the quick
  // lifecycle row is replaced with a Join / connect button instead.
  const canOps = serverOperable(server);
  // Open-on-click is scoped to the art, name and notice regions only — NOT the
  // whole tile. The quick-action buttons and the Join control live in the body
  // right next to those regions; making the whole tile clickable used to swallow
  // their clicks, so nothing above the buttons carries an open handler anymore.
  const open = () => onOpen(server.id);
  // The three run-dependent chips share one class and one way of explaining an em-dash: the host's feed
  // is down, or there is simply no running process to measure. Disk carries neither, since it is
  // measured either way.
  const liveMetricClass = "server-tile__metric" + (metricsOff ? " server-tile__metric--off" : "");
  const runningMetricTitle = (what) =>
    metricsOff ? "Live metrics unavailable" + (mFresh.label ? " · " + mFresh.label : "")
      : isOnline || isStarting ? what
      : what + " — only while the server is running";
  // Network is the one live figure that can be missing on a RUNNING server: the meter reads the
  // instance's own cgroup/netns, and an instance outside it isn't covered. Say so rather than letting
  // the em-dash read as "no traffic".
  const netTitle = server.rxBps == null && server.txBps == null
    ? runningMetricTitle("Network in / out") + (isOnline && !metricsOff ? " — not metered for this instance" : "")
    : "Network in " + formatBps(server.rxBps) + " · out " + formatBps(server.txBps);
  // The chips trade precision for a still row (see fmtBytesTight), so the tooltip carries the figure
  // they rounded — and says nothing at all when there was nothing to round.
  const exact = (bytes) => (bytes == null ? "" : " · " + formatBytes(bytes));
  return (
    <div className="server-tile">
      <div className="server-tile__art" onClick={open} style={{ backgroundImage: art, backgroundSize: "cover", backgroundPosition: "center" }}>
        <div className="server-tile__corner">
          {host && <span className="server-tile__host"><Icon name="server" size={10} strokeWidth={2.2} />{host.name}</span>}
          <button
            type="button"
            className={"server-tile__fav" + (isFav ? " is-on" : "")}
            onClick={(e) => { e.stopPropagation(); favoritesStore.toggle(server.id); }}
            aria-pressed={isFav}
            title={isFav ? "Remove from favorites" : "Add to favorites"}>
            <Icon name="star" size={14} strokeWidth={2.2} />
          </button>
        </div>
        <span className="server-tile__game">{server.game}</span>
      </div>
      <div className="server-tile__body">
        <div className="server-tile__head">
          <div className="server-tile__name" onClick={open}>{server.name}</div>
          {server.update_available && (
            <span className="server-tile__update" title="Update available">
              <Icon name="circle-arrow-down" size={14} />
            </span>
          )}
          <span className={"server-tile__pill " + (watchdogDown ? "server-tile__pill--unknown" : "server-tile__pill--" + server.status)}
            title={watchdogDown ? "Watchdog down — server state can't be confirmed" : undefined}>
            <span className="dot"></span>
            {watchdogDown ? "unknown" : serverStatusLabel(server)}
          </span>
        </div>
        {server.notice
          ? <div className="server-tile__notice" onClick={open}>{server.notice}</div>
          : <div className="server-tile__notice server-tile__notice--empty" onClick={open}>No server note</div>}
        {/* CPU / memory / network are readings of a RUNNING process — a stopped server has none to
            take, so they render "—" rather than a zero nobody measured. Disk is the exception and
            always shows: the space an instance occupies is a property of its files, so the backend
            measures it whether or not anything is running.
            The two halves are one edge-to-edge line on a card wide enough for it, and stack into two
            on a narrow one — see kit/dashboard.css. Splitting them in the MARKUP is what lets the
            second form put network and disk together without reordering anything. */}
        <div className="server-tile__meta">
          <div className="server-tile__metarow">
            <span className="server-tile__metric server-tile__metric--players"
              title={playerCurrent == null ? "This host can't see who is connected to this server" : "Players online"}>
              <Icon name="users" size={11} />
              <span className="server-tile__metric-val">{playerCurrent != null ? playerCurrent : "—"}</span>
            </span>
            <span className={liveMetricClass} title={runningMetricTitle("CPU, as a percentage of one core")}>
              <Icon name="cpu" size={11} />
              <span className="server-tile__metric-val">{server.cpu == null ? "—" : server.cpu + "%"}</span>
            </span>
            <span className={liveMetricClass} title={runningMetricTitle("Memory in use") + exact(server.metrics?.memBytes)}>
              <Icon name="memory-stick" size={11} />
              <span className="server-tile__metric-val">{fmtBytesTight(server.metrics?.memBytes)}</span>
            </span>
          </div>
          <div className="server-tile__metarow">
            <span className={liveMetricClass + " server-tile__metric--net"} title={netTitle}>
              <span className="server-tile__metric-pair">
                <Icon name="arrow-down" size={11} />
                <span className="server-tile__metric-val">{fmtBytesTight(server.rxBps)}</span>
              </span>
              <span className="server-tile__metric-pair">
                <Icon name="arrow-up" size={11} />
                <span className="server-tile__metric-val">{fmtBytesTight(server.txBps)}</span>
              </span>
            </span>
            <span className="server-tile__metric"
              title={"Disk used by this server's files — install, saves, backups and logs" + exact(server.diskBytes)}>
              <Icon name="hard-drive" size={11} />
              <span className="server-tile__metric-val">{fmtBytesTight(server.diskBytes)}</span>
            </span>
            {metricsOff && (
              <span className="server-tile__metric-led" title={"Live metrics unavailable" + (mFresh.label ? " · " + mFresh.label : "")}>
                <span className="status-led status-led--down"></span>
              </span>
            )}
          </div>
        </div>
        {canOps && (
          <div className="server-tile__quick">
            <ServerActionButton verb="start"   disabled={guard.start.disabled}   reason={guard.start.reason}   pendingVerb={pendingVerb} onRun={(v) => onAction(server.id, v)} />
            <ServerActionButton verb="restart" disabled={guard.restart.disabled} reason={guard.restart.reason} pendingVerb={pendingVerb} onRun={(v) => onAction(server.id, v)} />
            <ServerActionButton verb="stop"    disabled={guard.stop.disabled}    reason={guard.stop.reason}    pendingVerb={pendingVerb} onRun={(v) => onAction(server.id, v)} />
          </div>
        )}
        {/* Join / connect — shown to everyone (operators play too), below their
            lifecycle controls. */}
        <div className="server-tile__connect">
          <ServerConnect server={server} variant="tile" />
        </div>
      </div>
    </div>
  );
}

export { ServerTile };
