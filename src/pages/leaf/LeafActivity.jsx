// LeafActivity — the last few things a leaf actually did, pulled out of the audit feed the panel
// already holds.
//
// It reuses the shared audit row, so an action reads identically here and on the full audit page.
//
// ── Why the attribution is a per-leaf predicate rather than one field ──────────────────────────────
//
// The obvious implementation — filter on `origin == leafId` — is wrong, and measurably so. The audit's
// two provenance axes describe different things, and which one names a given leaf depends on what that
// leaf's relationship to the action was:
//
//   * `origin` names the SURFACE a person acted through. The bot is "discord", not "bot"; the panel is
//     "ui"; the assistant is "assistant". A leaf only appears here when a human went through it.
//   * `actor.name` names WHO acted, and for an unattended action that is the daemon itself — the
//     watchdog's crash-restarts and the scheduler's timed runs land here, with no origin at all on some
//     of them.
//   * The firewall appears as NEITHER. It is the executor, never the actor: a port opens because the
//     assistant or the panel asked, so those rows carry that origin. What identifies them as the
//     firewall's work is the ACTION, `network.ports.*`.
//
// So each leaf brings its own predicate, measured against the real feed rather than assumed. A leaf with
// no honest predicate — the monitor, which performs no auditable action at all — gets no card, because
// an empty lane would read as "this leaf has been idle" when the truth is "this leaf never appears here".
//
// ── The window ────────────────────────────────────────────────────────────────────────────────────
//
// This filters the audit page the store already holds (the most recent ~200 rows cluster-wide), which is
// why the card says "recent" and shows no total. A leaf that has been quiet while others were busy can
// fall out of that window entirely, so a count here would be a count of what this browser happens to
// have loaded — a number that looks authoritative and isn't. The card links to the full log for the
// real answer.

import React from "react";

import { AuditEventRow } from "../../components/AuditEventRow.jsx";
import { BriefCard } from "../../components/BriefCard.jsx";
import { useStore } from "../../lib/store.js";
import { auditEventHost, auditInScope, auditStore, hostsStore } from "../../lib/stores.js";
import { LeafBriefEmpty } from "./leafOverviewKit.jsx";

// Each entry: how to recognize this leaf's rows, and what to say when there are none. A leaf absent from
// this map renders no card at all.
const LEAF_ACTIVITY = {
  watchdog: {
    match: (ev) => (ev.actor && ev.actor.name) === "watchdog",
    // Not "supervision": the daemon also ingests player presence, and those rows carry its name too.
    // Naming only the supervision half would make a screen of joins and leaves look mislabelled.
    meta: "What the watchdog reported on its own — crash restarts, adoptions, and the player sessions "
      + "it tracks.",
    emptyTitle: "Nothing in the recent window",
    empty: "The watchdog hasn’t reported anything lately. Operator-issued starts and stops are attributed "
      + "to the person who asked, not to the daemon that carried them out.",
  },
  scheduler: {
    match: (ev) => (ev.actor && ev.actor.name) === "scheduler",
    meta: "Work the scheduler did inside a maintenance window, on its own clock.",
    emptyTitle: "Nothing in the recent window",
    empty: "No maintenance window has fired recently. Check the board above for when the next one is due.",
  },
  bot: {
    // The surface, not the actor: a Discord slash command is attributed to the person who typed it,
    // and "discord" is what says it came through this leaf.
    match: (ev) => ev.origin === "discord",
    meta: "Actions people took through Discord — attributed to them, routed through this bot.",
    emptyTitle: "Nothing in the recent window",
    empty: "Nobody has run a command through Discord lately.",
  },
  firewall: {
    // The executor, identified by what was done rather than by who asked for it.
    match: (ev) => typeof ev.action === "string" && ev.action.startsWith("network.ports."),
    meta: "Ports opened and closed on this host — whoever asked, this leaf is what applied them.",
    emptyTitle: "Nothing in the recent window",
    empty: "No port has been opened or closed recently.",
  },
  api: {
    // Everything that reached the engine through this API, whichever of its own surfaces asked.
    match: (ev) => ev.origin === "ui" || ev.origin === "api",
    meta: "Actions that reached the engine through this API — the Control Panel and direct callers.",
    emptyTitle: "Nothing in the recent window",
    empty: "Nothing has been done through the Control Panel or the API lately.",
  },
};

const MAX_ROWS = 5;

function LeafActivity({ hostId, leafId, onViewAll }) {
  const spec = LEAF_ACTIVITY[leafId] || null;
  const auditList = useStore(auditStore, s => s.list);
  const hosts = useStore(hostsStore, s => s.list);

  // Relative timestamps on the rows, kept live the way every other audit surface does.
  const [, setClock] = React.useState(0);
  React.useEffect(() => {
    const t = setInterval(() => setClock(c => c + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const rows = React.useMemo(() => {
    if (!spec) return [];
    return auditList
      .filter(ev => auditInScope(ev, hostId))
      .filter(spec.match)
      .slice(0, MAX_ROWS);
  }, [auditList, hostId, spec]);

  if (!spec) return null;

  const now = new Date();
  return (
    <BriefCard icon="scroll-text" title="Recent activity" meta={spec.meta}
      onViewAll={onViewAll} viewAllLabel="Full log">
      {rows.length === 0 ? (
        <LeafBriefEmpty title={spec.emptyTitle}>{spec.empty}</LeafBriefEmpty>
      ) : (
        <div className="chat-brief__list">
          {rows.map(ev => (
            <AuditEventRow
              key={ev.id}
              ev={ev}
              now={now}
              hosts={hosts}
              resolveHost={auditEventHost}
              avatarSize={24}
              showMeta={false}
              onClick={onViewAll} />
          ))}
        </div>
      )}
    </BriefCard>
  );
}

export { LeafActivity, LEAF_ACTIVITY };
