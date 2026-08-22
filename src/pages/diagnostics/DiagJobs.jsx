// DiagJobs.jsx — `QueuedJobs` and `RunningJobs`: what one node is about to do, and what it is doing.
//
// A server's own card answers "what is happening to THIS server". It cannot answer "what is this
// node about to do", which is the question a batch creates: ten servers handed to one node, paced
// two at a time, is half an hour of committed work spread over ten cards that each show a fragment
// of it.
//
// ── Two components, not one card with two lanes ───────────────────────────
//
// Queued and Running are independent facts about a node and are built as independent components:
// each owns its own data, its own card, its own pin and its own widget entry, so either can be put
// on a dashboard, sized and placed without the other. An operator watching a long update wants the
// running card three columns wide and may not want the queue at all.
//
// Nothing is shared but the row vocabulary below (verbs, the batch denominator, the row shell).
// Neither imports the other, and neither renders a layout — the Jobs sub-tab arranges them, and the
// dashboard grid arranges them when they are pinned. That is what makes them composable: a component
// that positions its sibling only works where its sibling is.
//
// Both read the ROSTER (`server.job`, the API's `activeJob`), because that is the only source that
// survives a page load: there is deliberately no `GET /jobs`, so a queue assembled from stream frames
// alone would show an empty node to anyone who arrived after a batch was accepted — an idle node,
// drawn for one that is working. `QueuedJobs` additionally reads the batch store, for the denominator
// in "3rd of 8"; `RunningJobs` needs nothing else, and does not take that dependency for symmetry.
//
// ── Live work only; what happened is the audit log's ──────────────────────
//
// These show what a node holds right now. A settled command is not shown at all: it is an audit row
// — durable, fleet-wide, and readable by somebody who was not looking when it happened, which is
// everything a card fed by one browser's open tab is not.

import React from "react";

import { BriefCard } from "../../components/BriefCard.jsx";
import { Icon } from "../../components/Icon.jsx";
import { useNav } from "../../components/NavContext.jsx";
import { PinButton } from "../../components/widgets/PinButton.jsx";
import { ordinal } from "../../lib/formatting.js";
import { useStore } from "../../lib/store.js";
import { batchesStore, serversStore } from "../../lib/stores.js";

// Every verb a job can carry, including the four the lifecycle buttons do not offer — an install, an
// uninstall and the two backup verbs all take a job and all sit in this queue, so a map that stopped
// at start/stop/restart/update would leave a real row unnamed. A verb this map does not know renders
// under its own wire word rather than as "unknown": the node said it, and repeating it is honest
// where inventing a friendly name for it is not.
const JOB_VERB = {
  start:          { label: "Start",          active: "Starting",     icon: "play" },
  stop:           { label: "Stop",           active: "Stopping",     icon: "square" },
  restart:        { label: "Restart",        active: "Restarting",   icon: "rotate-cw" },
  update:         { label: "Update",         active: "Updating",     icon: "download" },
  install:        { label: "Install",        active: "Installing",   icon: "package-plus" },
  uninstall:      { label: "Uninstall",      active: "Uninstalling", icon: "trash-2" },
  backup_create:  { label: "Back up",        active: "Backing up",   icon: "database" },
  backup_restore: { label: "Restore backup", active: "Restoring",    icon: "rotate-ccw" },
};
const verbMeta = (verb) => JOB_VERB[verb] || { label: verb || "—", active: verb || "—", icon: "circle-dot" };

// The batch's member count, or null until a node has stated one. The label then degrades to the
// position alone rather than guessing at a denominator — the same rule the queued button follows.
function totalOf(byId, batchId) {
  const b = batchId ? byId[batchId] : null;
  if (!b) return null;
  if (b.counts && Number.isFinite(b.counts.total)) return b.counts.total;
  return Number.isFinite(b.total) ? b.total : null;
}

// "3rd of 8", or "3rd" while the denominator is unknown. A COUNT, never a clock: it says which of
// eight queued servers moves next and offers no time, because how long a verb takes is not something
// anything here has measured.
function placeOf(position, total) {
  if (!Number.isFinite(position)) return null;
  return ordinal(position) + (Number.isFinite(total) ? " of " + total : "");
}

// One row. The title is the server, because that is what an operator is looking for, and the detail
// is the work. A row whose server is still on the roster opens it — the queue is a way INTO the thing
// it names, not a terminus — and one whose server has gone (an uninstall settles by removing it) is
// inert rather than a click that leads nowhere.
function JobRow({ tone, icon, title, detail, right, onOpen }) {
  const cls = "chat-brief__item"
    + (tone ? " chat-brief__item--" + tone : "")
    + (onOpen ? "" : " chat-brief__item--static");
  return (
    <div className={cls} onClick={onOpen || undefined}>
      <span className="chat-brief__icon"><Icon name={icon} size={14} /></span>
      <div className="chat-brief__body">
        <span className="chat-brief__item-title"><span className="chat-brief__titletext">{title}</span></span>
        <span className="chat-brief__detail">{detail}</span>
      </div>
      {right}
    </div>
  );
}

function LaneEmpty({ icon, title }) {
  return (
    <div className="chat-brief__empty chat-brief__empty--neutral">
      <Icon name={icon} size={20} strokeWidth={1.9} />
      <div className="chat-brief__empty-title">{title}</div>
    </div>
  );
}

// The rows both cards draw, out of the roster. A shared hook rather than two copies of the same
// filter: which servers a node holds and whether they carry a job is one question, and two components
// answering it differently would be two components disagreeing about the same node.
function useNodeJobs(hostId, state) {
  const nav = useNav();
  const servers = useStore(serversStore, s => s.list);

  const rows = React.useMemo(
    () => servers.filter(s => s.hostId === hostId && s.job && s.job.state === state),
    [servers, hostId, state]);

  const openOf = React.useCallback((serverId) => (
    servers.some(s => s.id === serverId) ? () => nav.openServer(serverId) : null
  ), [servers, nav]);

  return { rows, openOf };
}

/// What this node has taken and not started yet.
///
/// Ordered by position WITHIN a batch, and grouped by batch to get there. A position is a batch's own
/// 1-based ordinal, so two batches queued at once both count from one — sorting the merged list on
/// that number alone would interleave them into an order this panel has never been told, and which
/// the node's worker does not necessarily follow. Each batch's line stays contiguous and in its own
/// order; a hand-issued queued job carries no position and sits at the end.
function QueuedJobs({ host }) {
  const hostId = host && host.id;
  const batches = useStore(batchesStore, s => s.byId);
  const { rows, openOf } = useNodeJobs(hostId, "queued");

  const queued = React.useMemo(() => [...rows].sort((a, b) =>
    (a.job.batchId || "\uffff").localeCompare(b.job.batchId || "\uffff")
    || (a.job.queuedPosition ?? Infinity) - (b.job.queuedPosition ?? Infinity)
    || String(a.name || a.id).localeCompare(String(b.name || b.id))), [rows]);

  return (
    <BriefCard className="jobq-card" icon="hourglass" title="Queued" count={queued.length} countTone="neutral"
      pin={<PinButton type="host.jobs.queued" params={{ hostId }} label="this node's queued jobs" />}>
      {queued.length === 0 ? (
        <LaneEmpty icon="hourglass" title="Nothing queued" />
      ) : (
        <div className="chat-brief__list">
          {queued.map(s => {
            const meta = verbMeta(s.job.verb);
            const place = placeOf(s.job.queuedPosition, totalOf(batches, s.job.batchId));
            return (
              <JobRow key={s.id} icon={meta.icon} title={s.name || s.id}
                detail={meta.label + (s.job.batchId ? " · part of a batch" : "")}
                right={place ? <span className="jobq-place">{place}</span> : null}
                onOpen={openOf(s.id)} />
            );
          })}
        </div>
      )}
    </BriefCard>
  );
}

/// What this node has in flight right now.
function RunningJobs({ host }) {
  const hostId = host && host.id;
  const { rows, openOf } = useNodeJobs(hostId, "running");

  const running = React.useMemo(() => [...rows]
    .sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id))), [rows]);

  return (
    <BriefCard className="jobq-card" icon="loader" title="Running" count={running.length} countTone="neutral"
      pin={<PinButton type="host.jobs.running" params={{ hostId }} label="this node's running jobs" />}>
      {running.length === 0 ? (
        <LaneEmpty icon="loader" title="Nothing running" />
      ) : (
        <div className="chat-brief__list">
          {running.map(s => {
            const meta = verbMeta(s.job.verb);
            return (
              <JobRow key={s.id} icon={meta.icon} title={s.name || s.id}
                detail={meta.active + "…" + (s.job.batchId ? " · part of a batch" : "")}
                right={<span className="act-spin" aria-hidden="true"></span>}
                onOpen={openOf(s.id)} />
            );
          })}
        </div>
      )}
    </BriefCard>
  );
}

export { QueuedJobs, RunningJobs };
