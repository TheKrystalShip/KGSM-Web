import React from "react";
import { Icon } from "./Icon.jsx";
import { serverCapUsable } from "../lib/capabilities.js";
import { ordinal } from "../lib/formatting.js";

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
//   2. Job progress, in THREE states rather than two: idle · queued · running.
//      While the server's command job is running (tracked on serversStore via the
//      `jobs` channel) the acting button shows a spinner and its pending label.
//      While it is QUEUED — a batch took it and has not reached it yet — the
//      button shows no spinner, because nothing is spinning, and states its place
//      in the line instead. Either way the sibling actions disable: the work is
//      committed whether or not it has started.

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

  // Checked before the watchdog: the engine refuses every verb on an instance whose library is not
  // mounted, whatever the supervisor is doing, and naming the disk is what turns "nothing works" into
  // one thing to go and fix.
  if (server.libraryState === "offline") {
    return {
      disabled: true,
      reason: server.library
        ? "Library “" + server.library + "” isn’t mounted" + (server.libraryPath ? " at " + server.libraryPath : "")
        : "This server's library isn't mounted",
    };
  }

  // A move owns the instance's files for the whole of a copy, and the engine refuses every lifecycle
  // verb while one is under way. Checked here rather than per-verb because it blocks all four alike —
  // and because the engine starts the server itself partway through, so the run-state each verb reads
  // below is briefly about a server nobody asked to run.
  if (status === "moving") {
    return { disabled: true, reason: "Waiting for the move to another disk to finish" };
  }

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

// verb: lifecycle verb · variant: "chip" | "glass" | "quick" | "alert" | "cta" · disabled: base guard
// pendingVerb: the verb of the server's RUNNING job (or null) · onRun(verb)
// queuedVerb: the verb of a job the node has taken but not started · queuedPosition/queuedTotal:
//        where it sits in that batch's line. The position is a COUNT, never a clock — ten servers
//        reading "queued" say nothing about which moves next, and no completion time is offered
//        because nothing here has measured how long a verb takes. The total is simply omitted until
//        a node has stated it, so the label degrades to the position rather than guessing at a
//        denominator.
// reason: optional tooltip shown when disabled (e.g. why the watchdog blocks it)
// label: overrides the verb's idle label only (the pending and armed words are the
//        verb's own, so a renamed button still reports the same action in flight)
//
// "glass" is the cinematic server-hero button — a ghost button with a tone-coloured
// icon that lives inside the hero's frosted control bar. "alert" is the suggested
// action on an alert card, wearing that card's own button chrome. "cta" is the
// full-width primary button a server card promotes into its connect row. All share
// the chip's confirm-first + pending behaviour (is-armed / is-pending); only the
// chrome differs, which is the point — a verb pressed anywhere behaves the same.
// `warn` turns a normally-unarmed verb into an arming one and supplies the sentence it arms WITH.
// Start uses it for the node-capacity hint: the panel cannot know a start will be refused — the
// reading is a moment old and the requirement may be a vendor estimate — so it must not DISABLE the
// button. Disabling on a prediction strands an operator with no way forward, while letting a doomed
// start through costs nothing: the engine refuses it, which is what the gate is for.
//
// Arming instead says what the panel knows and hands the decision back. Confirming passes
// { force: true } to onRun, since somebody who has read the numbers and pressed again IS the
// override.
function ServerActionButton({ verb, variant = "quick", disabled, pendingVerb, queuedVerb, queuedPosition, queuedTotal, onRun, reason, label, warn }) {
  const def = SERVER_ACTION[verb];
  // A warned verb is armed whether or not it normally would be, and confirming it means "anyway".
  const arms = def.confirm || !!warn;
  const { armed, trigger } = useConfirmAction(() => onRun(verb, { force: !!warn }));
  const isPending = pendingVerb === verb;
  const isQueued = !!queuedVerb && queuedVerb === verb;
  // Committed, not merely busy: a queued verb has been accepted by the node and will run. Every
  // button locks, including the queued one — there is nothing left to decide, and a press would only
  // earn a refusal.
  const committed = !!pendingVerb || !!queuedVerb;
  const isDisabled = disabled || isQueued || (committed && !isPending);
  const size = variant === "quick" ? 11 : 13;
  const iconCls = variant === "chip" ? "chip__icon" : (variant === "glass" ? "gbtn__icon" : undefined);
  const labelCls = variant === "chip" ? "chip__label" : (variant === "quick" ? "act-label" : undefined);
  const place = Number.isFinite(queuedPosition)
    ? ordinal(queuedPosition) + (Number.isFinite(queuedTotal) ? " of " + queuedTotal : "")
    : null;
  // The full sentence, for the tooltip and for the variants with room for it.
  const queuedTitle = def.label + " queued" + (place ? " · " + place : "");
  // Measured in a browser, the sentence does not fit either of the two constrained variants, and an
  // ellipsis eats exactly the position the label exists to carry. Both drop the verb, which the button
  // already says — its own icon, its own slot in the row — and keep the place.
  //
  // The tile's quick row is three equal grid columns with ~82px of label each, which takes the place
  // and nothing else. The hero's button is wider and grows for this one state (see .gbtn.is-queued),
  // so it keeps the word.
  const queuedLabel = variant === "quick" ? (place || "Queued")
    : variant === "glass" ? "Queued" + (place ? " · " + place : "")
    : queuedTitle;

  const click = (e) => {
    e.stopPropagation();
    if (isDisabled || isPending) return;
    if (arms) trigger(); else onRun(verb);
  };

  const base = variant === "chip" ? "chip chip--" + def.tone
    : variant === "glass" ? "gbtn gbtn--" + def.tone
    : variant === "alert" ? "alert-btn alert-btn--primary"
    : variant === "cta" ? "server-tile__update-cta"
    : "";
  const cls = base
    + (armed ? " is-armed" : "")
    + (isPending ? " is-pending" : "")
    + (isQueued ? " is-queued" : "");

  let inner;
  if (isPending) {
    inner = <><span className="act-spin"></span><span className={labelCls}>{def.pending}</span></>;
  } else if (isQueued) {
    // Deliberately NOT the pending rendering: no spinner, because nothing is spinning. An hourglass
    // and a place in the line.
    inner = <><Icon name="hourglass" size={size} strokeWidth={2.2} className={iconCls} />
      <span className={labelCls}>{queuedLabel}</span></>;
  } else if (armed) {
    // A warned verb says what confirming MEANS. "Confirm?" on a start the node looks too full for
    // would hide the only thing worth knowing at that moment.
    inner = <><Icon name={warn ? "triangle-alert" : "check"} size={size} strokeWidth={2.6} className={iconCls} />
      <span className={labelCls}>{warn ? "Start anyway?" : "Confirm?"}</span></>;
  } else {
    inner = <><Icon name={def.icon} size={size} strokeWidth={2.2} className={iconCls} /><span className={labelCls}>{label || def.label}</span></>;
  }

  return (
    <button className={cls + (warn && !isPending ? " is-warned" : "")} disabled={isDisabled}
      aria-label={label || def.label}
      title={isQueued
        ? queuedTitle + " — the node has taken this and has not reached it yet"
        : armed
          ? (warn || "Click again to confirm")
          : (isDisabled && reason ? reason : (warn || label || def.label))}
      onClick={click}>
      {inner}
    </button>
  );
}

export { SERVER_ACTION, ServerActionButton, useConfirmAction, verbGuard };
