import React from "react";
import { BriefCard } from "./BriefCard.jsx";
import { alertInScope } from "./ContextualAlerts.jsx";
import { Icon } from "./Icon.jsx";
import { KrystalAlerts } from "../lib/alertsApi.js";
import { useAlertActions } from "./AlertCard.jsx";
import { ServerActionButton } from "./ServerActions.jsx";
import { askAssistantUsable } from "../lib/capabilities.js";
import { watchedRules } from "../lib/fleetOps.js";
import { fmtRelative } from "../lib/formatting.js";
import { useStore } from "../lib/store.js";
import { serversStore } from "../lib/stores.js";
import { fleetOpsStore } from "../lib/stores/fleet.js";

// NeedsAttention — compact FIRING-alerts panel, plus the client hooks over the
// server alert feed (KrystalAlerts, see alertsApi.js).
//
// Model A: the server is the authority and conditions resolve themselves. We
// only render KrystalAlerts.list() — the browser never marks an alert done.
// This panel is the at-a-glance view used on the dashboard (with a "View all"
// link to the Alerts page) and in the assistant empty state.

// Subscribe a component to feed changes (server pushes / local action echoes).
function useAlerts() {
  const [, force] = React.useReducer(x => x + 1, 0);
  React.useEffect(() => KrystalAlerts.subscribe(force), []);
  return KrystalAlerts;
}

// Split the feed for a host scope (["all"]/undefined → every alert; a host id →
// that host's alerts plus panel-wide ones). Model A buckets:
//   firing   — conditions true right now (the work surface)
//   resolved — cleared within the last 24h (the rear-view; ages off after)
// `active` is kept as an alias of `firing` for the sidebar badge + dashboard.
//
// `firing` is returned in canonical priority order — escalated ("Needs you")
// first, then by severity, then most-recent — so EVERY surface (Alerts page,
// dashboard card, sidebar badge) shows the same alerts in the same order from
// this one place. The dashboard's top-3 therefore always leads with whatever
// needs a human, instead of falling off the end in raw feed order.
// `serverId`, when given, scopes strictly to that game server's alerts (used by
// the server-detail Performance tab). Otherwise `hostId` applies the host scope.
function alertBuckets(hostId, serverId) {
  let list = KrystalAlerts.list();
  if (serverId) {
    list = list.filter(a => a.serverId === serverId);
  } else if (hostId && hostId !== "all") {
    list = list.filter(a => alertInScope(a, hostId));
  }
  const now = Date.now();
  const DAY = 24 * 3600 * 1000;
  const sevRank = { danger: 0, warn: 1, info: 2 };
  const firing = list
    .filter(a => a.status === "firing")
    .sort((a, b) =>
      (b.escalated ? 1 : 0) - (a.escalated ? 1 : 0) ||
      (sevRank[a.severity] ?? 9) - (sevRank[b.severity] ?? 9) ||
      (new Date(b.raisedAt) - new Date(a.raisedAt)));
  const resolved = list
    .filter(a => a.status === "resolved" && a.resolvedAt && (now - new Date(a.resolvedAt).getTime()) <= DAY)
    .sort((a, b) => new Date(b.resolvedAt) - new Date(a.resolvedAt));
  return { all: list, firing, resolved, active: firing };
}

// One compact row. The whole row is the "ask the assistant" target, and the condition's
// own suggested action sits at the end of it — this card is the dashboard's at-a-glance
// surface, so an update you can apply in one press should not require opening a page
// first. The button stops the click from reaching the row (ServerActionButton already
// does), so pressing Update never also opens the assistant.
function BriefAlertRow({ item, onPick, onRun, actionLabel }) {
  const askOk = askAssistantUsable(item);
  const actions = useAlertActions(item, onRun);
  return (
    <div className={"chat-brief__item chat-brief__item--" + item.severity + (item.escalated ? " chat-brief__item--escalated" : "") + (askOk ? "" : " chat-brief__item--noask")} onClick={() => askOk && onPick && onPick(item)}>
      <span className="chat-brief__icon"><Icon name={item.icon} size={14} /></span>
      <div className="chat-brief__body">
        <span className="chat-brief__item-title">
          <span className="chat-brief__titletext">{item.title}</span>
          {item.escalated && <span className="chat-brief__needs-you"><Icon name="hand" size={9} strokeWidth={2.6} /> Needs you</span>}
        </span>
        <span className="chat-brief__detail">{item.detail}</span>
      </div>
      {actions.map(a => (
        <ServerActionButton key={a.key} verb={a.verb} variant="alert"
          disabled={a.guard.disabled} reason={a.guard.reason}
          pendingVerb={a.pendingVerb} onRun={a.run} />
      ))}
      <span className={"chat-brief__ask" + (askOk ? "" : " chat-brief__ask--off")}>{askOk ? actionLabel : "Unavailable"} <Icon name="arrow-right" size={12} strokeWidth={2.2} /></span>
    </div>
  );
}


// The all-clear body: what the engine is armed against, instead of a tick.
//
// The card therefore ALWAYS renders a list — firing conditions when there are any, the armed rules
// when there are not — which is one behaviour rather than two, and no new component vocabulary.
//
// A rule the policy reports as switched OFF keeps its row and loses its dot. That is the whole point
// of the panel: an alert engine that is quiet and one that is not watching look identical from a
// green tick, and only the dot tells them apart.
const RULES_SHOWN = 5;

function WatchedRules({ rules, resolved }) {
  const shown = rules.slice(0, RULES_SHOWN);
  const more = rules.length - shown.length;
  const newest = resolved && resolved.length ? resolved[0] : null;
  return (
    <>
      <div className="alert-rules">
        {shown.map(r => (
          <div className="alert-rules__row" key={r.key}
            title={r.armed ? "Watching " + r.scopeLabel : "This rule is switched off in the host's threshold policy"}>
            <span className={"alert-rules__dot" + (r.armed ? "" : " alert-rules__dot--off")}></span>
            <span className="alert-rules__name">{r.label}</span>
            <span className="alert-rules__scope">{r.armed ? r.scopeLabel : "off"}</span>
          </div>
        ))}
      </div>
      <div className="chat-brief__foot">
        <span>
          {newest
            ? <><b>{resolved.length}</b> resolved in the last 24h · last {fmtRelative(new Date(newest.resolvedAt), new Date())}</>
            : "Nothing resolved in the last 24h"}
        </span>
        {more > 0 && <span>{more} more rule{more === 1 ? "" : "s"}</span>}
      </div>
    </>
  );
}

// `max` caps how many firing alerts are listed (header count still shows the
// true total). `emptyState` opts into the dashboard behaviour: instead of
// collapsing to null when nothing's firing, render the card with a calm
// "all clear" placeholder so it can sit balanced beside Recent activity. The
// assistant briefing keeps the original collapse-when-empty default.
//
// `hostId` pins the card to the node it is rendered FOR — the host diagnostics
// deep-dive, where the node being inspected is the subject on screen. Omitted
// (the default) the card is cluster-wide, as the dashboard and sidebar badge are.
//
// `serverId` (server-detail Performance tab) scopes strictly to one game
// server's alerts, ignoring the node entirely.
function NeedsAttention({ onPick, onRun, actionLabel = "Ask", onViewAll, className = "", max = Infinity, emptyState = false, hostId, serverId, title = "Alerts" }) {
  useAlerts();
  const [hidden, setHidden] = React.useState(false);
  const { active, resolved } = alertBuckets(hostId != null ? hostId : "all", serverId);
  const shown = active.slice(0, max);
  // What the engine is watching, for the all-clear state. Scoped to the surface that asked for a
  // balanced card (the dashboard): the host deep-dive and the server Performance tab ask about one
  // subject, and a fleet-wide rule list is not an answer about it.
  const ops = useStore(fleetOpsStore, s => s.byHost);
  const servers = useStore(serversStore, s => s.list);
  const watched = React.useMemo(
    () => (emptyState && !hostId && !serverId ? watchedRules(ops, servers.length) : { rules: [], unknownNodes: 0 }),
    [emptyState, hostId, serverId, ops, servers.length]);
  const rules = watched.rules;
  if (hidden) return null;
  if (active.length === 0 && !emptyState) return null;

  // Header-right affordance: "View all" when the dashboard passes onViewAll,
  // otherwise the dismiss "Hide" control (suppressed in the balanced empty-state
  // dashboard layout). Left undefined → BriefCard renders its onViewAll default.
  const action = onViewAll
    ? undefined
    : (!emptyState ? <button className="chat-brief__hide" onClick={() => setHidden(true)}>Hide</button> : null);
  return (
    <BriefCard
      className={className}
      icon="triangle-alert"
      title={title}
      count={active.length > 0 ? active.length : (rules.length > 0 ? "all clear" : null)}
      countTone={active.length > 0 ? undefined : "ok"}
      onViewAll={onViewAll}
      action={action}
    >
      {active.length === 0 ? (
        rules.length > 0 ? <WatchedRules rules={rules} resolved={resolved} /> : (
          <div className="chat-brief__empty">
            <Icon name="circle-check" size={20} />
            <span className="chat-brief__empty-title">No active alerts</span>
            <span className="chat-brief__empty-sub">Everything's running clean right now.</span>
          </div>
        )
      ) : (
      <div className="chat-brief__list">
        {shown.map(it => <BriefAlertRow key={it.id} item={it} onPick={onPick} onRun={onRun} actionLabel={actionLabel} />)}
      </div>
      )}
    </BriefCard>
  );
}

export { NeedsAttention, alertBuckets, useAlerts };
