import { Icon } from "./Icon.jsx";
import { alertHost } from "./ContextualAlerts.jsx";
import { ServerActionButton, verbGuard } from "./ServerActions.jsx";
import { askAssistantUsable } from "../lib/capabilities.js";
import { serverOperable } from "../lib/persona.js";
import { useStore } from "../lib/store.js";
import { hostsStore, serversStore } from "../lib/stores.js";
import { fmtRelative, parseTs } from "../lib/formatting.js";

// AlertCard.jsx — the shared alert card component, extracted from AlertsPage.jsx.
// Used by AlertsPage and ContextualAlerts (InlineAlertCard).

// A firing alert carries `actions[]` — what the BACKEND says this condition is worth
// offering to do about it (kgsm-api's AlertActionCatalog, which the Web Push catalog
// reads from the same place, so a crash never suggests Stop on a phone and Restart
// here). This map is presentation only: the backend's operation name → the lifecycle
// verb ServerActionButton draws. An unrecognized kind renders nothing rather than
// guessing, so the backend can offer a new operation before this SPA knows it.
const ACTION_VERB = {
  "server.update": "update",
  "server.start": "start",
  "server.stop": "stop",
  "server.restart": "restart",
};

function AlertSeverityTag({ severity }) {
  const label = { danger: "Critical", warn: "Warning", info: "Info" }[severity] || severity;
  return <span className={"alert-sev alert-sev--" + severity}>{label}</span>;
}

// The suggested actions for one firing alert, resolved against the server as it is
// right now. Returns [] when there is nothing to draw.
//
// An offer is a POLICY, not a permission — the backend says the condition is the kind
// of thing this verb answers, and nothing more. So everything that decides whether the
// button would actually work is re-derived here:
//
//   · tier   — serverOperable; a viewer sees the card without the control, never a
//              button that 403s.
//   · state  — verbGuard, the SAME answer the hero and the tile use. A running server
//              with an update pending renders Update DISABLED, saying "Server must be
//              stopped before updating", because that is exactly what kgsm-api's
//              CommandGate would answer. Hiding it would leave the operator wondering
//              where the button went.
//   · job    — the server's in-flight command, so a press shows its spinner here too.
//
// Nothing resolves for a resolved alert: the backend sends no actions on one.
function useAlertActions(item, onRun) {
  const servers = useStore(serversStore, s => s.list);
  const offers = item.actions || [];
  if (!offers.length || !onRun) return [];

  const server = item.serverId ? servers.find(s => s.id === item.serverId) : null;
  if (!server || !serverOperable(server)) return [];

  const pendingVerb = server.job && server.job.state === "running" ? server.job.verb : null;

  return offers
    .map(offer => ({ offer, verb: ACTION_VERB[offer.kind] }))
    // An unrecognized kind is skipped, not guessed at, so the backend can offer a new
    // operation before this SPA knows how to draw it.
    .filter(a => a.verb)
    .map(({ offer, verb }) => ({
      key: offer.kind,
      verb,
      pendingVerb,
      guard: verbGuard(server, verb),
      run: (v) => onRun(offer.target || item.serverId, v),
    }));
}

function AlertCard({ item, onAsk, onOpenServer, onOpenHost, onOpenAudit, onRun, now }) {
  const resolved = item.status === "resolved";
  const sys = item.resolution && item.resolution.by === "system";
  const stamp = resolved ? item.resolvedAt : item.raisedAt;
  const when = stamp
    ? fmtRelative(parseTs(stamp), now)
    : null;
  const hostId = alertHost(item);
  const host = hostId ? hostsStore.find(hostId) : null;
  const actions = useAlertActions(item, onRun);
  const hasActions = actions.length > 0;

  return (
    <div className={"alert-card alert-card--" + item.severity
      + (resolved ? " alert-card--resolved" : "")
      + (item.escalated ? " alert-card--escalated" : "")
      + (item.justResolved ? " alert-card--just-resolved" : "")}>
      <span className="alert-card__icon"><Icon name={resolved ? "check" : item.icon} size={16} strokeWidth={resolved ? 2.4 : 1.9} /></span>
      <div className="alert-card__body">
        <div className="alert-card__titlerow">
          <span className="alert-card__title">{item.title}</span>
          {item.escalated
            ? <span className="alert-card__state alert-card__state--escalated"><Icon name="hand" size={11} strokeWidth={2.4} /> Needs you</span>
            : (!resolved && <AlertSeverityTag severity={item.severity} />)}
          {resolved && (sys
            ? <span className="alert-card__state alert-card__state--auto"><Icon name="shield-check" size={12} strokeWidth={2.4} /> Auto-resolved</span>
            : <span className="alert-card__state alert-card__state--completed"><Icon name="check" size={11} strokeWidth={2.6} /> Resolved</span>)}
        </div>
        <div className="alert-card__detail">{item.detail}</div>

        {item.escalated && (
          <div className="alert-card__escalation">
            <Icon name="circle-slash" size={11} strokeWidth={2.3} />
            <span>Auto-recovery gave up after {item.attempts} attempts — this one needs a human.</span>
          </div>
        )}

        {resolved && sys && (
          <div className="alert-card__resolution">
            <Icon name="shield-check" size={11} strokeWidth={2.4} />
            <span>Cleared{item.resolution.source ? " by " + item.resolution.source : ""}{item.resolution.reason ? " — " + item.resolution.reason : ""}</span>
            {item.resolution.actionId && (
              <button className="alert-card__action-link" onClick={() => onOpenAudit && onOpenAudit(item)} title="See the action in the audit log">
                View action <Icon name="arrow-up-right" size={10} strokeWidth={2.6} />
              </button>
            )}
          </div>
        )}

        <div className="alert-card__meta">
          <span className={"audit-row__host" + (hostId ? "" : " audit-row__host--panel")} title={hostId ? "Host: " + (host ? host.name : hostId) : "Panel-wide alert"}>
            <Icon name={hostId ? "server" : "layers"} size={10} strokeWidth={2.2} />
            {hostId ? (host ? host.name : hostId) : "panel"}
          </span>
          {item.source && <span className="alert-card__source">{item.source}</span>}
          {item.source && when && <span>·</span>}
          {when && <span>{when}</span>}
        </div>
      </div>

      {!resolved && (
        <div className="alert-card__actions">
          {/* The condition's own answer leads, and takes the primary weight from
              "Ask assistant" \u2014 asking about an update you can apply in one press
              is the second thing you'd want, not the first. */}
          {actions.map(a => (
            <ServerActionButton key={a.key} verb={a.verb} variant="alert"
              disabled={a.guard.disabled} reason={a.guard.reason}
              pendingVerb={a.pendingVerb} onRun={a.run} />
          ))}
          <button className={"alert-btn" + (hasActions ? "" : " alert-btn--primary")}
            disabled={!askAssistantUsable(item)}
            title={!askAssistantUsable(item) ? "Assistant unavailable on this alert\u2019s host" : undefined}
            onClick={() => { if (askAssistantUsable(item)) onAsk(item); }}><Icon name="bot" size={13} /> Ask assistant</button>
          {item.serverId
            ? <button className="alert-btn" onClick={() => onOpenServer(item.serverId, item.anchor && item.anchor.tab)}><Icon name="external-link" size={13} /> Open server</button>
            : (hostId && onOpenHost && <button className="alert-btn" onClick={() => onOpenHost(hostId)}><Icon name="external-link" size={13} /> Open host</button>)}
        </div>
      )}
    </div>
  );
}

export { AlertCard, AlertSeverityTag, useAlertActions };
