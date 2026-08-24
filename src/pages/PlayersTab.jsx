import React from "react";
import { CardTable } from "../components/CardTable.jsx";
import { BriefCard } from "../components/BriefCard.jsx";
import { Icon } from "../components/Icon.jsx";
import { PlayerModeration } from "../components/PlayerModeration.jsx";
import { PinButton } from "../components/widgets/PinButton.jsx";
import { usePlayerRoster } from "../lib/hooks/usePlayerRoster.js";
import { moderatePlayer } from "../lib/stores.js";

// PlayersTab — the permanent player roster for one server. The presence contract:
//
//   REST  GET /servers/{id}/players → { detection, players[], moderation }
//   WS    topic "players" → { type:"players.join"|"players.leave"|"players.ban", data:{ serverId, player } }
//         or { type:"players.reset", data:{ serverId } }
//
// The history IS the roster — no separate "currently online" view. Every player
// who has ever connected appears here with a status indicator. Honest "unknown"
// when the API can't determine status (missed events during downtime).
//
// REST hydrates the full roster, then the WS topic follows live transitions —
// tail-then-follow, same ordering guarantee as ConsolePanel's useLiveConsole.
//
// Status vocabulary: "online" | "offline" | "banned" | "unknown"

// Prefer the player's name; fall back to their address, then the player identity.
function playerLabel(p) {
  return (p && (p.playerName || p.playerAddr || p.playerIdentity)) || "Unknown player";
}

// A secondary identifier line: whichever of addr/id are present and not already
// shown as the label.
function playerSecondary(p) {
  if (!p) return "";
  const label = playerLabel(p);
  const bits = [];
  if (p.playerAddr && p.playerAddr !== label) bits.push(p.playerAddr);
  if (p.playerId && p.playerId !== label && p.playerId !== p.playerAddr) bits.push(p.playerId);
  return bits.join(" · ");
}

// Relative + absolute time formatting.
function fmtTime(iso) {
  if (!iso) return { rel: "—", abs: "" };
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { rel: "—", abs: "" };
  const diffS = Math.max(0, (Date.now() - d.getTime()) / 1000);
  const rel = diffS < 60 ? Math.floor(diffS) + "s ago"
    : diffS < 3600 ? Math.floor(diffS / 60) + "m ago"
    : diffS < 86400 ? Math.floor(diffS / 3600) + "h ago"
    : Math.floor(diffS / 86400) + "d ago";
  return { rel, abs: d.toLocaleString() };
}

// Status indicator — colored dot with tooltip.
function StatusDot({ status }) {
  const colors = {
    online: "var(--krystal-teal)",
    unknown: "var(--fg-3)",
    offline: "var(--fg-4)",
    // --danger, not a bespoke red: it is the semantic token every theme defines,
    // so the banned dot has a colour in all of them.
    banned: "var(--danger)",
  };
  const labels = {
    online: "Online",
    unknown: "Unknown",
    offline: "Offline",
    banned: "Banned",
  };
  const color = colors[status] || colors.unknown;
  const label = labels[status] || "Unknown";
  return (
    <span className="player-status" title={label}>
      <span className="player-status__dot" style={{ background: color }} />
      <span className="player-status__label">{label}</span>
    </span>
  );
}

function PlayersEmpty({ icon, title, sub }) {
  return (
    <div className="chat-brief__empty chat-brief__empty--neutral">
      <Icon name={icon} size={20} />
      <span className="chat-brief__empty-title">{title}</span>
      <span className="chat-brief__empty-sub">{sub}</span>
    </div>
  );
}

function PlayersTab({ server, readOnly, roster }) {
  const internalRoster = usePlayerRoster(server);
  const state = roster || internalRoster;

  // On every branch, including the ones with nobody on: a roster you want on your dashboard is
  // often an empty one you are waiting to fill.
  const pin = <PinButton type="server.players" params={{ serverId: server && server.id }}
    label={((server && server.name) || "this server") + "'s players"} />;

  // The action in flight, as { playerIdentity, action } — one at a time, so a
  // double-click can't fire two moderation calls at the same player.
  const [busy, setBusy] = React.useState(null);
  const [err, setErr] = React.useState(null);

  const runModeration = React.useCallback((player, action) => {
    if (busy) return;
    setBusy({ playerIdentity: player.playerIdentity, action });
    setErr(null);
    moderatePlayer(server, player.playerIdentity, action).then(
      () => {
        // No optimistic status write here. The engine emits the event, the API
        // updates its roster and pushes a players.* frame — so the row changes
        // because the action actually landed, not because we asked for it.
        setBusy(null);
      },
      (e) => {
        setBusy(null);
        setErr({
          who: player.playerName || player.playerIdentity,
          action,
          message: (e && (e.userMessage || e.message)) || "The action didn't go through.",
        });
      }
    );
  }, [busy, server]);

  if (state.status === "loading") {
    return (
      <BriefCard icon="users" title="Players" pin={pin}>
        <PlayersEmpty icon="loader-2" title="Loading roster…" sub="Fetching the player roster." />
      </BriefCard>
    );
  }

  if (state.status === "error") {
    return (
      <BriefCard icon="users" title="Players" pin={pin}>
        <PlayersEmpty icon="alert-triangle" title="Couldn't load the roster"
          sub={(state.error && (state.error.userMessage || state.error.message)) || "An error occurred."} />
      </BriefCard>
    );
  }

  if (state.detection === "unknown") {
    return (
      <BriefCard icon="users" title="Players" pin={pin}>
        <PlayersEmpty icon="circle-help" title="Presence not available for this game"
          sub="This game has no join/leave detection configured yet, so who's played can't be tracked here." />
      </BriefCard>
    );
  }

  const { players } = state;
  if (players.length === 0) {
    return (
      <BriefCard icon="users" title="Players" pin={pin}>
        <PlayersEmpty icon="users" title="No players yet"
          sub="Once someone connects, they'll show up here permanently." />
      </BriefCard>
    );
  }

  const columns = [
    { key: "player", label: "Player", width: "minmax(0, 2fr)", defaultDir: "asc",
      sort: (p) => playerLabel(p).toLowerCase(),
      render: (p) => (
        <span className="players-cell-player">
          <span className="player-avatar">{playerLabel(p)[0].toUpperCase()}</span>
          <span className="player-name">
            <span className="player-name__primary">{playerLabel(p)}</span>
            {playerSecondary(p) && <span className="player-name__role">{playerSecondary(p)}</span>}
          </span>
        </span>
      ) },
    { key: "status", label: "Status", width: "minmax(110px, auto)",
      sort: (p) => { const order = { online: 0, unknown: 1, offline: 2, banned: 3 }; return order[p.status] ?? 4; },
      render: (p) => <StatusDot status={p.status} /> },
    { key: "firstSeen", label: "First seen", width: "minmax(120px, auto)", align: "right", defaultDir: "desc",
      // The instant. Two timestamps written with different UTC offsets, or different
      // fractional-second precision, compare as text in an order that has nothing to do with
      // which came first; a player with no recorded time sorts last rather than earliest.
      sort: (p) => (p.firstSeen ? new Date(p.firstSeen) : null),
      render: (p) => {
        const { rel, abs } = fmtTime(p.firstSeen);
        return <span className="player-meta-cell" title={abs}>{rel}</span>;
      } },
    { key: "lastSeen", label: "Last seen", width: "minmax(120px, auto)", align: "right", defaultDir: "desc",
      sort: (p) => (p.lastSeen ? new Date(p.lastSeen) : null),
      render: (p) => {
        const { rel, abs } = fmtTime(p.lastSeen);
        return <span className="player-meta-cell" title={abs}>{rel}</span>;
      } },
  ];

  // Moderation is an operator action, so the read-only (player-facing) overview
  // never gets the column. The capability block decides the rest: a game that
  // declares no moderation commands gets no column at all rather than an empty
  // one implying the feature is merely unavailable right now.
  const mod = state.moderation;
  const canModerate = !readOnly && mod && (mod.kick || mod.ban || mod.unban);
  // Moderation is a console command, so it needs a console: only a server that
  // is actually up can take one. "starting" and "unknown" are not a running
  // server — the engine refuses both, and claiming otherwise on a control would
  // promise something the click can't deliver.
  const serverRunning = server && server.status === "online";
  if (canModerate) {
    columns.push({
      key: "actions", label: "", width: "minmax(84px, auto)", align: "right",
      render: (p) => (
        <PlayerModeration
          player={p}
          moderation={mod}
          serverRunning={serverRunning}
          pending={busy && busy.playerIdentity === p.playerIdentity ? busy.action : null}
          onRun={(action) => runModeration(p, action)} />
      ),
    });
  }

  return (
    <div className={"players-tab" + (canModerate ? " players-tab--actions" : "")}>
      <CardTable icon="users" title="Players" count={players.length} pin={pin}
        columns={columns} rows={players} getKey={(p) => p.playerIdentity}
        defaultSort={{ key: "status", dir: "asc" }} empty="No players match." />
      {err ? (
        <div className="players-tab__error" role="alert">
          <Icon name="triangle-alert" size={12} />
          <span>Couldn’t {err.action} {err.who} — {err.message}</span>
          <button type="button" className="players-tab__error-dismiss"
            onClick={() => setErr(null)} aria-label="Dismiss">
            <Icon name="x" size={12} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

export { PlayersTab, playerLabel, playerSecondary };
export { applyPlayerFrame } from "../lib/hooks/usePlayerRoster.js";
