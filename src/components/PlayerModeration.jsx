import React from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon.jsx";
import { useConfirmAction } from "./ServerActions.jsx";

// PlayerModeration — the per-row kick/ban/unban controls in the player roster.
//
// The contract that shapes this file: **the browser never names who gets
// moderated.** Every call sends only the roster's `playerIdentity`; the API
// resolves that against its own record of who has been on this server and builds
// the game's command from it. So there is deliberately no address or name in any
// request here, and nothing in this component should start adding one.
//
// What the game supports comes from the roster response's `moderation` block
// ({ kick, ban, unban, targetKind }) — the backend derives it from the
// blueprint's declared command templates. We render only what it reports, so a
// game with no ban command shows no ban button rather than one that 409s on
// click. `targetKind` names the identity the game addresses (ip | name | id); a
// player who carries no identity of that kind can't be moderated at all, and we
// say so on a disabled control instead of letting the click fail.
//
// Two presentations of the same action set: square icon buttons (`.icon-btn`,
// the panel's ghost row action) on desktop, and a "⋯" menu on phones, where the
// menu keeps both icon AND label. CSS picks which trigger is visible; both drive
// the same `onRun`.
//
// An action the game declares is always RENDERED, and disabled when the moment
// is wrong — a control that vanishes tells the operator nothing, while a
// disabled one that says why is the difference between "this game can't" and
// "not right now". The three gates, broadest first: the server has to be running
// (moderation is a console command — a stopped server has no console, and the
// engine refuses the call outright), the player has to carry an identity of the
// kind the game addresses, and a kick needs them actually connected.

// Which field of a roster row satisfies the game's declared target kind. Mirrors
// the API's own resolution so the control state matches what the call would do —
// this is a pre-emptive courtesy, NOT the authority. The API re-resolves from
// its own record on every request and is free to refuse.
function hasTargetIdentity(player, targetKind) {
  if (!player || !targetKind) return false;
  if (targetKind === "ip") return !!player.playerAddr;
  if (targetKind === "name") return !!player.playerName;
  if (targetKind === "id") return !!player.playerId;
  return false;
}

const KIND_LABEL = { ip: "an IP address", name: "a player name", id: "an account id" };

/// What may be done to this player right now, and why not.
///
/// The counterpart to `verbGuard` for lifecycle: ONE answer to "can this run", so every surface
/// offering moderation refuses in the same words. The palette can moderate a scoped server's roster,
/// and a row that said "Kick" where this menu says "the server isn't running" would be two answers to
/// one question.
///
/// Returns `[{ action, reason }]` — reason `null` when it can run. An action the game does not
/// declare is absent entirely; an action it declares is always PRESENT and carries its reason, because
/// a control that vanishes tells an operator nothing while a disabled one that says why distinguishes
/// "this game can't" from "not right now".
function moderationOffers(serverRunning, player, moderation) {
  if (!moderation || !player) return [];
  const banned = player.status === "banned";
  const online = player.status === "online";

  // A banned player gets the counterpart action, never both — offering "ban" on someone already
  // banned states a change that wouldn't happen.
  const offered = [];
  if (banned) { if (moderation.unban) offered.push("unban"); }
  else {
    if (moderation.kick) offered.push("kick");
    if (moderation.ban) offered.push("ban");
  }
  if (!offered.length) return [];

  const usable = hasTargetIdentity(player, moderation.targetKind);
  const identityReason = "This game moderates by "
    + (KIND_LABEL[moderation.targetKind] || "an identity") + ", which this player has none of.";

  // Broadest gate first, so the reason names the thing the operator would have to change first.
  return offered.map((action) => ({
    action,
    reason: !serverRunning ? "The server isn't running, so there's no console to send this to."
      : !usable ? identityReason
        : action === "kick" && !online ? "This player isn't connected — there's nobody to disconnect."
          : null,
  }));
}

const ACTION = {
  kick: { label: "Kick", icon: "user-x", tone: "warn", confirm: true,
    pending: "Kicking…", title: "Kick — disconnect this player" },
  ban: { label: "Ban", icon: "ban", tone: "danger", confirm: true,
    pending: "Banning…", title: "Ban — disconnect and block this player" },
  // Restoring access is not destructive, so it doesn't need a misclick guard.
  unban: { label: "Unban", icon: "user-check", tone: "safe", confirm: false,
    pending: "Unbanning…", title: "Unban — lift this player's ban" },
};

const MENU_WIDTH = 196;

function ModerationButton({ action, disabled, reason, pending, onRun }) {
  const def = ACTION[action];
  const { armed, trigger } = useConfirmAction(() => onRun(action));

  const click = (e) => {
    e.stopPropagation();
    if (disabled || pending) return;
    if (def.confirm) trigger(); else onRun(action);
  };

  const cls = "icon-btn pmod-btn pmod-btn--" + def.tone
    + (armed ? " is-armed" : "")
    + (pending ? " is-pending" : "");

  // An icon-only control has to carry its meaning in the tooltip and the
  // accessible name, and both have to follow the state — an armed button that
  // still announces "Ban" hides the fact that the next click commits.
  const title = pending ? def.pending
    : armed ? "Click again to confirm"
      : disabled && reason ? reason
        : def.title;
  const label = pending ? def.pending
    : armed ? "Confirm " + def.label.toLowerCase()
      : def.label;

  return (
    <button type="button" className={cls} disabled={disabled || pending}
      title={title} aria-label={label} onClick={click}>
      {pending ? <span className="act-spin" />
        : <Icon name={armed ? "check" : def.icon} size={15} strokeWidth={armed ? 2.6 : 1.9} />}
    </button>
  );
}

// One row of the "⋯" menu. Arming keeps the menu OPEN and swaps the label in
// place, so the second tap lands on the same target the first one did — a menu
// that closed on arming would ask the operator to re-open it and aim again.
// `why` is this item's own reason for being disabled — rendered as a second line
// rather than a tooltip, since a touch screen never shows one.
function ModerationMenuItem({ action, why, pending, onRun, onDone }) {
  const def = ACTION[action];
  const { armed, trigger } = useConfirmAction(() => { onRun(action); onDone(); });
  const disabled = !!why;

  const click = (e) => {
    e.stopPropagation();
    if (disabled || pending) return;
    if (def.confirm) trigger();
    else { onRun(action); onDone(); }
  };

  return (
    <button type="button"
      className={"pmod-menu__item pmod-menu__item--" + def.tone + (armed ? " is-armed" : "")}
      disabled={disabled || pending} onClick={click}>
      <Icon name={armed ? "check" : def.icon} size={14} strokeWidth={armed ? 2.6 : 2.2} />
      <span className="pmod-menu__text">
        <span>{pending ? def.pending : armed ? "Tap again to confirm" : def.label}</span>
        {why ? <span className="pmod-menu__why">{why}</span> : null}
      </span>
    </button>
  );
}

// The menu panel. Rendered into <body> and positioned from the trigger's rect:
// the roster's card frame and its cells both clip their overflow, so an
// absolutely-positioned panel inside the row would be cut off — most visibly on
// the last row, which is where a ban is as likely to be aimed as any other.
function ModerationMenu({ anchorRef, items, shared, pending, onRun, onClose }) {
  const [pos, setPos] = React.useState(null);
  const panelRef = React.useRef(null);
  // Rough panel height, used only to decide which side of the trigger to open
  // on: a base row each, plus the extra lines the reasons add.
  const height = 12 + items.length * 38 + (shared ? 34 : 0)
    + items.filter((i) => !shared && i.reason).length * 30;

  React.useLayoutEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Flip above the trigger when there isn't room below, so the panel is never
    // pushed off the bottom of a short viewport.
    const below = window.innerHeight - r.bottom;
    const top = below < height + 12 ? Math.max(8, r.top - height - 6) : r.bottom + 6;
    const left = Math.max(8, Math.min(r.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8));
    setPos({ top, left });
  }, [anchorRef, height]);

  React.useEffect(() => {
    const onDocDown = (e) => {
      if (panelRef.current && panelRef.current.contains(e.target)) return;
      if (anchorRef.current && anchorRef.current.contains(e.target)) return;
      onClose();
    };
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    // The panel is anchored to a rect taken once, so any scroll or resize would
    // leave it pointing at nothing. Closing is honest; re-aiming a stale panel is not.
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", onClose, true);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [anchorRef, onClose]);

  if (!pos) return null;

  return createPortal(
    <div className="pmod-menu" role="menu" ref={panelRef}
      style={{ top: pos.top + "px", left: pos.left + "px", width: MENU_WIDTH + "px" }}>
      {shared ? <div className="pmod-menu__note">{shared}</div> : null}
      {items.map((i) => (
        <ModerationMenuItem key={i.action} action={i.action} why={shared ? null : i.reason}
          pending={pending === i.action} onRun={onRun} onDone={onClose} />
      ))}
    </div>,
    document.body
  );
}

// player: the roster row · moderation: the capability block · serverRunning: is
// the instance up · pending: the action currently in flight for THIS player (or
// null) · onRun(action)
function PlayerModeration({ player, moderation, serverRunning, pending, onRun }) {
  const [open, setOpen] = React.useState(false);
  const triggerRef = React.useRef(null);
  const close = React.useCallback(() => setOpen(false), []);

  const items = moderationOffers(serverRunning, player, moderation);

  // Close the menu if this row's action set empties out from under it (a ban
  // landing turns "kick/ban" into "unban" while the panel is open).
  React.useEffect(() => { if (!items.length) setOpen(false); }, [items.length]);

  if (!items.length) return null;

  // A reason every action shares belongs at the top of the menu once, not
  // repeated under each item.
  const shared = items.every((i) => i.reason && i.reason === items[0].reason) ? items[0].reason : null;

  return (
    <span className="pmod">
      <span className="pmod__inline">
        {items.map((i) => (
          <ModerationButton key={i.action} action={i.action} disabled={!!i.reason} reason={i.reason}
            pending={pending === i.action} onRun={onRun} />
        ))}
      </span>

      <span className="pmod__compact">
        <button type="button" ref={triggerRef}
          className={"icon-btn pmod-kebab" + (open ? " icon-btn--on" : "")}
          aria-haspopup="menu" aria-expanded={open}
          aria-label={"Moderate " + (player.playerName || player.playerIdentity)}
          onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>
          <Icon name="ellipsis" size={15} />
        </button>
        {open && (
          <ModerationMenu anchorRef={triggerRef} items={items} shared={shared}
            pending={pending} onRun={onRun} onClose={close} />
        )}
      </span>
    </span>
  );
}

export { PlayerModeration, hasTargetIdentity, moderationOffers };
