import { Icon } from "./Icon.jsx";
import { can } from "../lib/persona.js";
import { useStore } from "../lib/store.js";
import { hostsStore, serversStore } from "../lib/stores.js";
import { artBg } from "../lib/art.js";
import { fmtFootprintMb } from "../lib/formatting.js";
import { blueprintFit, hostAvailabilityLabel, instancesOfBlueprint } from "../lib/servers.js";

// GameCard.jsx — the catalog game card, extracted from LibraryPage.jsx.
// Used by LibraryPage and DashboardPage.

// "Recently added" helpers (shared with LibraryPage).
const RECENT_WINDOW_DAYS = 30;
const NEW_WINDOW_DAYS = 14;

function libraryNow(list) {
  const times = (list || []).map(g => g.addedAt ? +new Date(g.addedAt) : 0).filter(Boolean);
  return times.length ? new Date(Math.max(...times)) : new Date();
}

function fmtAddedLabel(addedAt, now) {
  if (!addedAt) return "";
  const date = new Date(addedAt);
  const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dd = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diff = Math.round((d0 - dd) / 86400000);
  if (diff <= 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return diff + "d ago";
  if (diff < 14) return "1w ago";
  if (diff < 30) return Math.floor(diff / 7) + "w ago";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function GameCard({ game, onPick, onDeploy, addedNow, compact, headroom }) {
  const servers = useStore(serversStore, s => s.list);
  const allHosts = useStore(hostsStore, s => s.list);
  const instances = instancesOfBlueprint(game, servers);
  const count = instances.length;
  const onlineCount = instances.filter(s => s.status === "online").length;
  const bg = game.cover
    ? `linear-gradient(180deg, transparent 0%, rgba(11,15,20,0.55) 100%), url("${game.cover}")`
    : artBg(game.hero, null);

  if (compact) {
    return (
      <div className="game-card" onClick={() => onPick(game)}>
        <div className="game-card__art" style={{ backgroundImage: bg, backgroundSize: "cover", backgroundPosition: "center" }}>
          {count > 0 && (
            <span className="game-card__installed" title={count + " server" + (count === 1 ? "" : "s") + " created"}>
              <Icon name="server" size={11} strokeWidth={2.2} /> {count}
            </span>
          )}
        </div>
        <div className="game-card__body">
          <div className="game-card__title">{game.name}</div>
          <div className="game-card__meta">
            {game.players && (
              <span className="game-card__metarow"><Icon name="users" size={12} /> {game.players} players</span>
            )}
            {addedNow && game.addedAt && (
              <span className="game-card__added"><Icon name="clock" size={11} /> {fmtAddedLabel(game.addedAt, addedNow)}</span>
            )}
          </div>
        </div>
      </div>
    );
  }

  const now = addedNow || libraryNow([game]);
  const addedMs = game.addedAt ? +new Date(game.addedAt) : 0;
  const isNew = !count && addedMs && (+now - addedMs) <= NEW_WINDOW_DAYS * 86400000;
  const installed = count > 0;
  const hostLabel = hostAvailabilityLabel(game, allHosts);
  const canDeploy = !installed && !!onDeploy && can("server.create");
  // What this card can say in its one status slot, in precedence order.
  // `steamAccountRequired` is a real boolean from the blueprint, so an unknown (null) is NOT a gate —
  // only an explicit true is, and the card stays quiet rather than warning about a requirement nobody
  // stated.
  const gate = game.steamAccountRequired === true
    ? { label: "Steam account", title: "Installing " + game.name + " needs Steam credentials on this host" }
    : null;
  const fit = installed || gate ? null : blueprintFit(game, headroom);
  const fitTitle = !fit ? undefined
    : "Recommends " + fit.needGb.toFixed(fit.needGb < 10 ? 1 : 0) + " GB"
      + (fit.hostName ? " · " + fit.hostName : "") + " has " + fit.freeGb + " GB free right now"
      + " — a comparison of two measured figures, not a guarantee";

  return (
    <article
      className={"bp-card" + (installed ? " bp-card--installed" : "")}
      onClick={() => onPick(game)}
      role="button" tabIndex={0}
      onKeyDown={e => { if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) { e.preventDefault(); onPick(game); } }}
    >
      <div className="bp-card__art" style={{ backgroundImage: bg, backgroundSize: "cover", backgroundPosition: "center" }}>
        {hostLabel && (
          <span className="bp-card__host" title={"Only available on " + hostLabel.replace(/ only$/, "")}>
            <Icon name="server" size={11} strokeWidth={2.1} /> {hostLabel}
          </span>
        )}
        {installed ? (
          <span className="bp-card__run" title={count + " server" + (count === 1 ? "" : "s") + " from this blueprint"}>
            <span className={"bp-card__rundot" + (onlineCount ? " is-live" : "")}></span>
            {count} {count === 1 ? "server" : "servers"}
          </span>
        ) : isNew ? (
          <span className="bp-card__new">New</span>
        ) : null}
        <div className="bp-card__veil"></div>
        <h3 className="bp-card__name">{game.name}</h3>
      </div>

      <div className="bp-card__specs">
        <div className={"bp-spec" + (game.players == null ? " bp-spec--unknown" : "")}>
          {/* A blueprint that declares no capacity says so. Rendering the null left an icon with
              nothing beside it, which reads as a broken card rather than an unknown figure. */}
          <span className="bp-spec__val"><Icon name="users" size={12} strokeWidth={2} /> {game.players ?? "—"}</span>
          <span className="bp-spec__lbl">Players</span>
        </div>
        <div className="bp-spec">
          <span className="bp-spec__val"><Icon name="memory-stick" size={12} strokeWidth={2} /> {fmtFootprintMb(game.specs && game.specs.recommendedRamMb)}</span>
          <span className="bp-spec__lbl">RAM</span>
        </div>
        <div className="bp-spec">
          <span className="bp-spec__val"><Icon name="hard-drive" size={12} strokeWidth={2} /> {fmtFootprintMb(game.specs && game.specs.baseDiskMb)}</span>
          <span className="bp-spec__lbl">Disk</span>
        </div>
      </div>

      <div className="bp-card__foot">
        {installed ? (
          <span className="bp-card__status bp-card__status--on">
            {onlineCount > 0
              ? <><span className="bp-card__livedot"></span>{onlineCount} online</>
              : <>Idle · not running</>}
          </span>
        ) : (
          /* One slot, one precedence: a GATE outranks a fit, because a blueprint you cannot install
             without credentials is a different kind of answer from one that would be a squeeze.
             An installed card never shows a fit at all — the question is already settled. */
          gate ? (
            <span className="bp-card__status bp-card__status--gate" title={gate.title}>
              <Icon name="lock" size={11} /> {gate.label}
            </span>
          ) : fit ? (
            <span className={"bp-card__status bp-card__status--" + (fit.tight ? "tight" : "fits")}
              title={fitTitle}>
              <Icon name={fit.tight ? "triangle-alert" : "circle-check"} size={11} />
              {fit.tight ? "Tight fit" : "Room for this"}
            </span>
          ) : <span className="bp-card__status"></span>
        )}
        {canDeploy ? (
          <button
            type="button"
            className="bp-card__cta bp-card__cta--act"
            title={"Deploy a new " + game.name + " server"}
            onClick={e => { e.stopPropagation(); onDeploy(game); }}
          >
            Deploy <Icon name="arrow-right" size={13} strokeWidth={2.2} />
          </button>
        ) : (
          <span className="bp-card__cta">
            {(installed
              ? (can("server.operate") ? "Manage" : "View")
              : "View")} <Icon name="arrow-right" size={13} strokeWidth={2.2} />
          </span>
        )}
      </div>
    </article>
  );
}

export { fmtAddedLabel, GameCard, libraryNow, NEW_WINDOW_DAYS, RECENT_WINDOW_DAYS };
