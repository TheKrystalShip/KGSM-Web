import { Icon } from "./Icon.jsx";
import { ServerActionButton, verbGuard } from "./ServerActions.jsx";
import { PinButton } from "./widgets/PinButton.jsx";
import { ServerConnect } from "./ServerConnect.jsx";
import { serverCapUsable } from "../lib/capabilities.js";
import { capacityHint, capacityDetail } from "../lib/capacity.js";
import { serverOperable } from "../lib/persona.js";
import { heroArtBg } from "../lib/art.js";
import { serverStatusLabel } from "../lib/servers.js";
import { hostsStore } from "../lib/stores.js";
import { useJobPhase } from "../lib/hooks/useJobPhase.js";

// Server hero card — top status, name, action chips, IP.

function StatusPill({ server, status, uptime, watchdogDown }) {
  // --glass swaps the pill's fill for the frosted dark backing so it stays legible
  // over the full-bleed key-art (the tone colour stays in the text + dot).
  // The watchdog reports a server's liveness; with it down we can't confirm the
  // status (or trust the uptime), so the pill reads "unknown".
  if (watchdogDown) {
    return (
      <span className="hero__status hero__status--unknown hero__status--glass" title="Watchdog down — server state can’t be confirmed">
        <span className="dot"></span>
        status unknown
      </span>
    );
  }
  const cls = {
    online: "hero__status",
    offline: "hero__status hero__status--offline",
    updating: "hero__status hero__status--updating",
    // On its way down — the process is still up, so this is deliberately NOT the offline tone.
    stopping: "hero__status hero__status--stopping",
    // Down and coming back — in transition like the two above, neither online nor offline.
    restarting: "hero__status hero__status--restarting",
    crashed: "hero__status hero__status--offline",
    // Launched, not yet joinable — the backend flips this to "running" once the
    // game finishes booting (server.patch, same SSE frame as every other status).
    starting: "hero__status hero__status--starting",
    // Being installed. The instance joins the roster as soon as the engine writes its config, so this
    // page is reachable while several minutes of download remain — the run-state underneath says
    // "stopped" and would read as an ordinary offline server.
    installing: "hero__status hero__status--updating",
    // Busy with its own data. The server may be up throughout — this says the
    // instance is occupied, which is why it borrows the updating tone rather than
    // any run-state one.
    "backing-up": "hero__status hero__status--updating",
    restoring: "hero__status hero__status--updating",
    // The library its files live in is not mounted. Its own tone rather than the offline one: a
    // stopped server can be started and this one cannot, and reading them as the same state is what
    // sends somebody hunting for a fault in a server whose disk is simply unplugged.
    "library-offline": "hero__status hero__status--library-offline",
  }[status] || "hero__status";
  return (
    <span className={cls + " hero__status--glass"}>
      <span className="dot"></span>
      {serverStatusLabel(server)}
      {uptime && uptime !== "—" && <span className="timer">{uptime}</span>}
    </span>
  );
}

function ServerHero({ server, onAction }) {
  // Can the signed-in user operate this server's host? Players (viewer / consumer
  // preview) get the Join + connect surface only — no lifecycle controls, no rename.
  const canOps = serverOperable(server);
  // Pending work in three states: idle · queued · running. One derivation, shared with the tile and
  // an alert card's suggested action.
  const job = useJobPhase(server);
  // Lifecycle actions are watchdog-mediated — when the host's watchdog is down
  // the supervisor can't start/stop/restart/update, so the chips lock out.
  const watchdogDown = !serverCapUsable(server, "watchdog");
  // Whether each verb can run, and why not — from the one shared guard, so an alert
  // card offering "Update" and this chip refusing it can never both be right. The
  // two-step confirm (confirm: true on the verb) still arms on first click →
  // "Confirm?" → fires on the second, so a lit chip needs two deliberate presses.
  const guard = { start: verbGuard(server, "start"), update: verbGuard(server, "update"),
                  stop: verbGuard(server, "stop"), restart: verbGuard(server, "restart") };
  // The same capacity read the card does, against the same owning node — one helper, so the hero and
  // the tile cannot warn differently about one server.
  const capacity = capacityHint(server, hostsStore.find(server.hostId));
  const startWarn = capacity && capacity.tight && !guard.start.disabled ? capacityDetail(capacity) : null;
  // The cinematic background prefers the LANDSCAPE banner (`hero` = RAWG
  // background_image_additional), then falls back to the 2:3 portrait `cover`,
  // then to the hero's dark gradient placeholder when neither is available.
  const bg = heroArtBg(server.hero, server.cover);
  return (
    <section className="hero hero--cinematic">
      <div className="hero__art" style={{ backgroundImage: bg, backgroundSize: "cover", backgroundPosition: "center" }}></div>
      <div className="hero__scrim"></div>
      <div className="hero__statuspos">
        <StatusPill server={server} status={server.status} uptime={server.uptime} watchdogDown={watchdogDown} />
      </div>
      <div className="hero__body">
        <div className="hero__heading">
          <h1 className="hero__name">
            {server.name}
            {canOps && <button className="hero__edit" aria-label="Rename"><Icon name="pencil" size={16} /></button>}
          </h1>
          {/* Runtime is honest backend metadata (native vs container) — surface it
              as a small glass tag beside the name. Absent → renders nothing. */}
          {server.runtime && (
            <span className="hero__tag hero__tag--glass" title="Supervision type">
              <Icon name={server.runtime === "container" ? "box" : "cpu"} size={12} strokeWidth={2} /> {server.runtime}
            </span>
          )}
          {/* Which named root the files live in. "unregistered" is the engine's own word for a
              server on a disk nothing declares — carried through as-is, since it is a real state
              somebody needs to see and not a missing value. */}
          {server.library && (
            <span className="hero__tag hero__tag--glass hero__tag--verbatim" title={server.libraryPath || "Library"}>
              <Icon name="hard-drive" size={12} strokeWidth={2} /> {server.library}
            </span>
          )}
          {/* Pins the server's CARD, not the hero: a banner this size belongs at the top of a page,
              and ServerTile is the component built for a grid. Reads as "keep this one in front of
              me", which is what somebody pinning from here means. */}
          <PinButton type="server.card" params={{ serverId: server.id }} label={server.name} />
        </div>
        {/* Frosted control bar: lifecycle actions (operators) on the left, a
            divider, then the connect/Join group on the right. Players see only
            the connect group. */}
        <div className="hero__bar">
          {canOps && (
            <>
              <div className="hero__group">
                <ServerActionButton verb="start"   variant="glass" disabled={guard.start.disabled}   reason={guard.start.reason}   {...job} warn={startWarn} onRun={onAction} />
                <ServerActionButton verb="update"  variant="glass" disabled={guard.update.disabled}  reason={guard.update.reason}  {...job} onRun={onAction} />
                <ServerActionButton verb="stop"    variant="glass" disabled={guard.stop.disabled}    reason={guard.stop.reason}    {...job} onRun={onAction} />
                <ServerActionButton verb="restart" variant="glass" disabled={guard.restart.disabled} reason={guard.restart.reason} {...job} onRun={onAction} />
              </div>
              <span className="hero__bardiv" aria-hidden="true"></span>
            </>
          )}
          <div className="hero__group hero__group--connect">
            <ServerConnect server={server} variant="hero-bar" />
          </div>
        </div>
        {canOps && watchdogDown && (
          <div className="hero__watchdog-note">
            <Icon name="power-off" size={13} /> Watchdog unavailable — start, stop, restart and update are paused on this host.
          </div>
        )}
      </div>
    </section>
  );
}

export { ServerHero };
