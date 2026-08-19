import React from "react";
import { Icon } from "./Icon.jsx";
import { serverCapUsable } from "../lib/capabilities.js";

// ServerActions.jsx — confirm-first, job-aware lifecycle buttons.
//
// Shared by the server hero (big chips), the server tiles (quick row) and the
// alert cards (a firing condition's suggested action), so they never diverge.
// Two behaviours layered on a normal button:
//
//   1. Confirm-first (misclick guard). Verbs flagged `confirm` arm on the first
//      click — the button swaps in place to "Confirm?" — and only dispatch on a
//      second click. It reverts on its own after a short timeout. Start is NOT
//      gated by default (bringing a server up is safe); Stop/Restart/Update are.
//
//   2. Job progress. While the server's command job is in flight (tracked on
//      serversStore via the `jobs` channel), the acting button shows a spinner
//      and its pending label, and the sibling actions are disabled until done.

const SERVER_ACTION = {
  start:   { label: "Start",    pending: "Starting…",   icon: "play",      tone: "start",   confirm: false },
  update:  { label: "Update",   pending: "Updating…",   icon: "download",  tone: "update",  confirm: true  },
  stop:    { label: "Stop",     pending: "Stopping…",   icon: "square",    tone: "stop",    confirm: true  },
  restart: { label: "Restart",  pending: "Restarting…", icon: "rotate-cw", tone: "restart", confirm: true  },
};

// verbGuard(server, verb) -> { disabled, reason } — whether this verb can run against
// this server right now, and the sentence explaining it when it can't.
//
// ONE answer for every surface that draws a lifecycle button. The hero, the server
// tile and an alert card's suggested action all ask here, so the same server can
// never offer Update in one place and refuse it in another. The gates, in order:
//
//   1. The watchdog mediates every lifecycle verb — with it down the supervisor
//      can't start, stop, restart or update anything.
//   2. The observed run state. kgsm refuses to update a RUNNING instance (the files
//      are in use) and kgsm-api's CommandGate 409s that synchronously, so pre-disable
//      here and say why rather than letting the click fail.
//   3. For update only: whether there is anything to apply.
//
// It deliberately does NOT check tier — that gates whether the control renders at
// all (serverOperable), which is a different question from whether it would work.
function verbGuard(server, verb) {
  if (!server) return { disabled: true, reason: null };

  const status = server.status;
  const isOnline = status === "online";
  const isUpdating = status === "updating";
  const isStarting = status === "starting";
  const isStopping = status === "stopping";
  const isRestarting = status === "restarting";

  if (!serverCapUsable(server, "watchdog")) {
    return { disabled: true, reason: "Watchdog unavailable on this host — lifecycle actions are paused" };
  }

  if (verb === "start") {
    if (isOnline) return { disabled: true, reason: "Server is already running" };
    if (isStarting) return { disabled: true, reason: "Server is already starting" };
    if (isUpdating) return { disabled: true, reason: "Waiting for the update to finish" };
    if (isStopping) return { disabled: true, reason: "Waiting for the server to finish shutting down" };
    if (isRestarting) return { disabled: true, reason: "Waiting for the server to finish restarting" };
    return { disabled: false, reason: null };
  }

  // Stop is allowed while starting — a booting server can still be shut down.
  if (verb === "stop") {
    if (isRestarting) return { disabled: true, reason: "Waiting for the server to finish restarting" };
    if (!(isOnline || isStarting)) return { disabled: true, reason: "Server is not running" };
    return { disabled: false, reason: null };
  }

  // Restart stays online-only: there is nothing to restart until the server has finished starting.
  if (verb === "restart") {
    if (isRestarting) return { disabled: true, reason: "Server is already restarting" };
    if (!isOnline) return { disabled: true, reason: "Server is not running" };
    return { disabled: false, reason: null };
  }

  if (verb === "update") {
    if (isUpdating) return { disabled: true, reason: "Update already in progress" };
    if (!server.update_available) {
      return {
        disabled: true,
        // Never checked and checked-and-clean are different facts, and saying "on the
        // latest build" for the first would be claiming a check nobody ran.
        reason: server.update_checked_at ? "On the latest build" : "Checking for updates…",
      };
    }
    if (isStopping) return { disabled: true, reason: "Waiting for the server to finish shutting down" };
    if (isRestarting) return { disabled: true, reason: "Waiting for the server to finish restarting" };
    if (isOnline || isStarting) return { disabled: true, reason: "Server must be stopped before updating" };
    return { disabled: false, reason: null };
  }

  return { disabled: true, reason: null };
}

// Single click arms (returns to idle after `ms`); a click while armed fires.
function useConfirmAction(onConfirm, ms = 3500) {
  const [armed, setArmed] = React.useState(false);
  const timer = React.useRef(null);
  React.useEffect(() => () => clearTimeout(timer.current), []);
  const trigger = () => {
    if (armed) { clearTimeout(timer.current); setArmed(false); onConfirm(); }
    else { setArmed(true); timer.current = setTimeout(() => setArmed(false), ms); }
  };
  return { armed, trigger };
}

// verb: lifecycle verb · variant: "chip" | "glass" | "quick" | "alert" · disabled: base guard
// pendingVerb: the verb of the server's in-flight job (or null) · onRun(verb)
// reason: optional tooltip shown when disabled (e.g. why the watchdog blocks it)
//
// "glass" is the cinematic server-hero button — a ghost button with a tone-coloured
// icon that lives inside the hero's frosted control bar. "alert" is the suggested
// action on an alert card, wearing that card's own button chrome. Both share the
// chip's confirm-first + pending behaviour (is-armed / is-pending); only the
// chrome differs, which is the point — a verb pressed anywhere behaves the same.
function ServerActionButton({ verb, variant = "quick", disabled, pendingVerb, onRun, reason }) {
  const def = SERVER_ACTION[verb];
  const { armed, trigger } = useConfirmAction(() => onRun(verb));
  const jobRunning = !!pendingVerb;
  const isPending = pendingVerb === verb;
  const isDisabled = disabled || (jobRunning && !isPending);
  const size = variant === "quick" ? 11 : 13;
  const iconCls = variant === "chip" ? "chip__icon" : (variant === "glass" ? "gbtn__icon" : undefined);
  const labelCls = variant === "chip" ? "chip__label" : (variant === "quick" ? "act-label" : undefined);

  const click = (e) => {
    e.stopPropagation();
    if (isDisabled || isPending) return;
    if (def.confirm) trigger(); else onRun(verb);
  };

  const base = variant === "chip" ? "chip chip--" + def.tone
    : variant === "glass" ? "gbtn gbtn--" + def.tone
    : variant === "alert" ? "alert-btn alert-btn--primary"
    : "";
  const cls = base
    + (armed ? " is-armed" : "")
    + (isPending ? " is-pending" : "");

  let inner;
  if (isPending) {
    inner = <><span className="act-spin"></span><span className={labelCls}>{def.pending}</span></>;
  } else if (armed) {
    inner = <><Icon name="check" size={size} strokeWidth={2.6} className={iconCls} /><span className={labelCls}>Confirm?</span></>;
  } else {
    inner = <><Icon name={def.icon} size={size} strokeWidth={2.2} className={iconCls} /><span className={labelCls}>{def.label}</span></>;
  }

  return (
    <button className={cls} disabled={isDisabled} aria-label={def.label}
      title={armed ? "Click again to confirm" : (isDisabled && reason ? reason : def.label)} onClick={click}>
      {inner}
    </button>
  );
}

export { SERVER_ACTION, ServerActionButton, useConfirmAction, verbGuard };
