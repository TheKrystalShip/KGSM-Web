import { AuditActor } from "./AuditActor.jsx";
import { Icon } from "./Icon.jsx";
import { actionMeta, auditTone, fmtRelative, fmtTime, parseTs } from "../lib/formatting.js";

// AuditEventRow — the single presentational row for one audit event. Shared by
// three surfaces so activity looks the same everywhere it appears: the full
// AuditLogPage timeline, the compact "Recent activity" panel (RecentActivity, on
// the dashboard + server overview), and the assistant chat "Recent events"
// evidence card. Pure props-in: it renders the standard `ev` audit shape and
// never fetches or routes.
//
//   ev         one audit record { ts, action, actor:{name,kind}, summary, origin, serverId, hostId?, meta }
//   now        the wall-clock anchor relative times are measured against
//   hosts      host list, for resolving the provenance chip's display name
//   avatarSize actor-avatar diameter (the full page uses the 28px default; the
//              compact panels pass 24)
//   showMeta   render the meta "key=value" chips (the full page does; the compact
//              panels don't, to stay tidy in a narrow column)
//   onClick    optional row click (the compact panels deep-link to the audit log)
// Node attribution arrives as a FUNCTION rather than being resolved here, because deriving a host
// from a serverId needs the server roster — and a row that reaches the store barrel for it cannot be
// rendered by a surface that has no roster. The default reads what the event itself carries; the
// panel passes the store-aware `auditEventHost`. `showHost` is off for a surface that has only one
// host, where "which node" is not a question the reader has.
function AuditEventRow({ ev, now, hosts, avatarSize, showMeta = true, showHost = true, onClick,
                        resolveHost = (e) => (e && e.hostId) || null }) {
  const meta = actionMeta(ev.action);
  // The pill prints the dotted action, which is the searchable, filterable thing; the plain-English
  // label is its tooltip. Its colour is the row tone, not the action's own — see auditTone.
  const tone = auditTone(ev);
  const date = parseTs(ev.ts);
  // Render the meta dictionary as compact "key=value" chips (full page only).
  const metaEntries = showMeta ? Object.entries(ev.meta || {}) : [];
  // Host provenance: explicit hostId / derived from server / null = panel-wide.
  const hostId = resolveHost(ev);
  const host = hostId ? (hosts || []).find(h => h.id === hostId) : null;
  const clickable = typeof onClick === "function";

  return (
    <div className="audit-row" onClick={onClick} style={clickable ? { cursor: "pointer" } : undefined}>
      <AuditActor actor={ev.actor} {...(avatarSize ? { size: avatarSize } : {})} />
      <div className="audit-row__main">
        <div className="audit-row__line">
          <span className="audit-row__actor">{ev.actor.name}</span>
          {" "}
          <span className="audit-row__summary">{ev.summary}</span>
        </div>
        <div className="audit-row__meta">
          <span className={"audit-pill audit-pill--" + tone} title={meta.label}>
            <Icon name={meta.icon} size={11} strokeWidth={2.2} className="audit-pill__icon" />
            {ev.action}
          </span>
          {showHost && (
            <span className={"audit-row__host" + (hostId ? "" : " audit-row__host--panel")} title={hostId ? "Host: " + (host ? host.name : hostId) : "Panel-wide event"}>
              <Icon name={hostId ? "server" : "layers"} size={10} strokeWidth={2.2} />
              {hostId ? (host ? host.name : hostId) : "panel"}
            </span>
          )}
          {metaEntries.map(([k, v]) => (
            <span key={k} className="audit-row__chip"><b>{k}:</b> {String(v)}</span>
          ))}
          {ev.origin && (
            <span className="audit-row__origin"><Icon name="circle-arrow-out-up-right" size={10} strokeWidth={2.2} /> {ev.origin}</span>
          )}
        </div>
      </div>
      <div className="audit-row__when" title={date.toLocaleString()}>
        <span className="audit-row__time">{fmtTime(date)}</span>
        <span className="audit-row__rel">{fmtRelative(date, now)}</span>
      </div>
    </div>
  );
}

export { AuditEventRow };
