import React from "react";
import { Icon } from "./Icon.jsx";
import { serverJoin } from "../lib/persona.js";
import { copyText } from "../lib/clipboard.js";

// ServerConnect — the "go play on this server" surface. It does two things, and
// the split is deliberate: a Steam title gets a one-click LAUNCH
// (steam://run/<appid>, which every Steam game a player owns supports), and every
// game gets the connect address to copy, because joining happens in the game's own
// server browser. The panel never claims to have connected anyone — launching is
// fire-and-forget (the browser hands the steam:// handler off with no callback),
// and the address is the honest instruction underneath it. Both are gated on the
// server being online: there is nothing to join otherwise.
//
// variant "tile"      → compact launch + copy pair for a server card.
// variant "hero-bar"  → address pill + copy + Play CTA for the server detail hero.

// The sentence a surface shows in place of an address, when there is one. Exported because the
// command palette offers the same copy as an entry and has to refuse it in the same words — a
// palette saying "Offline" over a server the card calls "Restarting…" would be two answers to one
// question, the same reason `verbGuard` and `moderationOffers` are shared rather than restated.
function offlineHint(server) {
  const status = server && server.status;
  // Launched but not yet joinable, shutting down, and bouncing each read as their own word:
  // "Offline" would be a claim about a server that hasn't landed yet, or has not left.
  if (status === "starting") return "Server is starting…";
  if (status === "stopping") return "Server is shutting down…";
  if (status === "restarting") return "Server is restarting…";
  return "Server is offline";
}

const NO_ADDRESS = "The connect address isn’t available yet";

/// Why this server cannot be joined right now, or null when it can.
function joinRefusal(server, join) {
  if (!join || !join.online) return offlineHint(server);
  if (!join.address) return NO_ADDRESS;
  return null;
}

function ServerConnect({ server, variant }) {
  const join = serverJoin(server);
  const [copied, setCopied] = React.useState(null); // null | "ok" | "fail"
  const online = join.online;
  // Launched but not yet joinable — only a truly "online" (finished booting)
  // server can be joined, so this stays gated the same as offline; only the
  // copy changes so it doesn't misreport a booting server as "Offline".
  const starting = server && server.status === "starting";
  const stopping = server && server.status === "stopping";
  const restarting = server && server.status === "restarting";
  // The word this surface shows in place of the address when there is nothing to join.
  const offWord = starting ? "Starting…" : stopping ? "Stopping…" : restarting ? "Restarting…" : "Offline";
  const offHint = offlineHint(server);

  // Only ever claims "Copied" once the write has actually resolved — a refused
  // clipboard says so instead, since a button that reports success over an empty
  // clipboard sends the player to paste nothing into a server browser.
  const copy = (e) => {
    if (e) e.stopPropagation();
    const text = join.address;
    if (!text) return;              // no known address → never copy a literal "null"
    copyText(text).then(ok => {
      setCopied(ok ? "ok" : "fail");
      setTimeout(() => setCopied(null), ok ? 1600 : 2600);
    });
  };

  // The copy button's tooltip carries the whole instruction, since "Play" alone
  // doesn't tell you how you actually get in.
  const copyHint = !join.address
    ? NO_ADDRESS
    : copied === "ok" ? "Copied"
    : copied === "fail" ? `Your browser blocked the copy — the address is ${join.address}`
    : join.isSteam
      ? `Copy ${join.address} — paste it into ${server.game}’s server browser once it opens`
      : `Copy ${join.address} — connect from ${server.game}’s own menu`;

  // ---- compact tile variant ----
  // Steam titles get Play + an icon-only copy beside it; everything else gets the
  // full-width copy button. The address resolves from the server row itself
  // (connectPort), so this works on the servers list with no detail fetch.
  if (variant === "tile") {
    const copyBtn = (compact) => (
      <button
        className={"connect-tile connect-tile--copy" + (compact ? " connect-tile--icon" : "") + (online && join.address ? "" : " connect-tile--off")}
        onClick={online ? copy : (e) => e.stopPropagation()}
        disabled={!online || !join.address}
        title={online ? copyHint : offHint}>
        <Icon name={copied === "ok" ? "check" : copied === "fail" ? "x" : "copy"} size={13} />
        {compact ? null : (copied === "ok" ? "Copied" : copied === "fail" ? "Blocked" : (online ? "Copy IP" : offWord))}
      </button>
    );
    if (join.isSteam) {
      return (
        <>
          <a
            className={"connect-tile" + (online ? "" : " connect-tile--off")}
            href={online ? join.launchUrl : undefined}
            onClick={(e) => { e.stopPropagation(); if (!online) e.preventDefault(); }}
            title={online ? `Launch ${server.game} in Steam` : offHint}>
            <Icon name="play" size={13} strokeWidth={2.4} />
            {online ? "Play" : offWord}
          </a>
          {copyBtn(true)}
        </>
      );
    }
    return copyBtn(false);
  }

  // ---- cinematic hero bar variant ----
  // Compact single row for the server-detail hero's frosted control bar: the connect
  // address as a glass mono pill, an icon-only copy, then the Play CTA pinned to the
  // FAR RIGHT (the bar's primary action, hard against the hero's right edge). No
  // always-visible note — the "this launches the game, then you connect" explanation
  // lives in the two tooltips so the bar stays clean. Non-Steam games drop the Play
  // button (address + copy only) and carry the hint on the pill.
  const launchHint = online
    ? `Open ${server.game} in Steam. It won’t join on its own — paste the address into the game’s server browser.`
    : starting ? "Server is starting up — hang tight, it’ll be joinable shortly."
    : stopping ? "Server is shutting down — it can be started again once it lands."
    : restarting ? "Server is restarting — it'll be joinable again shortly."
    : "Start the server to join";
  if (variant === "hero-bar") {
    return (
      <div className="connect connect--bar">
        <code
          className="connect__addr connect__addr--glass"
          title={join.isSteam ? undefined : `${server.game} isn’t on Steam — copy the address and connect from the game’s own menu.`}>
          {join.address || "—"}
        </code>
        <button
          className="connect__copy connect__copy--icon"
          onClick={copy}
          disabled={!join.address}
          title={copyHint}>
          <Icon name={copied === "ok" ? "check" : copied === "fail" ? "x" : "copy"} size={15} />
        </button>
        {join.isSteam && (
          <a
            className={"connect__join connect__join--sm" + (online ? "" : " is-disabled")}
            href={online ? join.launchUrl : undefined}
            onClick={(e) => { if (!online) e.preventDefault(); }}
            title={launchHint}>
            <Icon name="play" size={15} strokeWidth={2.4} />
            {online ? "Play" : offWord}
          </a>
        )}
      </div>
    );
  }

  // ---- full row variant ----
  return (
    <div className="connect">
      <div className="connect__row">
        {join.isSteam && (
          <a
            className={"connect__join" + (online ? "" : " is-disabled")}
            href={online ? join.launchUrl : undefined}
            onClick={(e) => { if (!online) e.preventDefault(); }}
            title={launchHint}>
            <Icon name="play" size={16} strokeWidth={2.4} />
            {online ? "Play on Steam" : (starting ? "Server starting…" : stopping ? "Server stopping…" : restarting ? "Server restarting…" : "Server offline")}
          </a>
        )}
        <code className="connect__addr">{join.address || "—"}</code>
        <button
          className="connect__copy"
          onClick={copy}
          disabled={!join.address}
          title={copyHint}>
          <Icon name={copied === "ok" ? "check" : copied === "fail" ? "x" : "copy"} size={14} />
          {copied === "ok" ? "Copied" : copied === "fail" ? "Blocked" : "Copy IP : port"}
        </button>
      </div>
      <div className="connect__note">
        <Icon name="info" size={12} />
        {join.isSteam
          ? <span>Opens {server.game} in Steam. Paste the address into the game’s server browser to join.</span>
          : <span>{server.game} isn’t on Steam — copy the address and connect from the game’s own menu.</span>}
      </div>
    </div>
  );
}

export { ServerConnect, joinRefusal, offlineHint };
