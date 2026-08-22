import React from "react";
import { createPortal } from "react-dom";

import { Icon } from "../Icon.jsx";
import { useNav } from "../NavContext.jsx";
import { SERVER_ACTION } from "../ServerActions.jsx";
import { PinButton } from "../widgets/PinButton.jsx";
import { usePortalPopover } from "../../hooks/usePortalPopover.js";
import { cancelRun } from "../../lib/batchRun.js";
import { fmtRelative, ordinal } from "../../lib/formatting.js";
import { canOn } from "../../lib/persona.js";
import { useStore } from "../../lib/store.js";
import { batchesStore, hostsStore, runsFrom, serversStore } from "../../lib/stores.js";

// OpsTray — what the whole cluster is doing right now, and how it is going.
//
// A RUN is what a person started: one verb, one cluster-wide selection, one outcome. A BATCH is one
// node's share of it. Each node records its own share, knows nothing of the others, and stores the
// run id it was handed verbatim — so grouping on that id is what reassembles the run, including one
// this browser never dispatched, from another tab or another person.
//
// ── Hydrate, then follow ──────────────────────────────────────────────────
//
// The board reads `batchesStore`, which fans `GET /batches?active=true` across every connected node
// and follows the `batches` topic afterwards. Hydration is the whole point: a tray assembled from
// stream frames alone shows nothing to a client that opened after the run started, which is exactly
// the person this exists for.
//
// ── Not the Notifications tray ────────────────────────────────────────────
//
// That one is per-browser `localStorage` and is explicitly what YOU did in THIS browser. This is
// server-side truth about the fleet: it survives the tab, it holds work nobody here started, and it
// is not a second toast history. They sit apart in the sidebar's foot for that reason.
//
// ── What a node's silence means ───────────────────────────────────────────
//
// A node the hydrate could not read is stated. Its share of a run is UNKNOWN, which is not the same
// as absent — drawing a three-node run as a two-node one would be this surface inventing the shape of
// somebody's action.

/// A batch verb, in the vocabulary every lifecycle button already uses. The batch verb set is the
/// same closed one a single command takes; anything else is rendered under its own wire word, since
/// the node said it and repeating it is honest where inventing a friendly name is not.
const verbMeta = (verb) => SERVER_ACTION[verb] || { label: verb || "Mixed", icon: "circle-dot", tone: "update" };

/// Where one server stands inside a batch. The words are the API's states in an operator's language,
/// and `unknown` keeps its hedge: the process holding that job ended and the engine never said what
/// became of it, so it is neither a success nor a failure.
const MEMBER = {
  pending:   { word: "queued",          tone: null,      icon: "hourglass" },
  running:   { word: "running",         tone: null,      icon: "loader" },
  succeeded: { word: "done",            tone: "success", icon: "check" },
  failed:    { word: "failed",          tone: "danger",  icon: "circle-x" },
  refused:   { word: "refused",         tone: "warn",    icon: "shield-x" },
  cancelled: { word: "cancelled",       tone: null,      icon: "ban" },
  unknown:   { word: "outcome unknown", tone: "warn",    icon: "circle-help" },
};
const memberMeta = (state) => MEMBER[state] || { word: state || "—", tone: null, icon: "circle-dot" };

// The order a run's progress reads in, and the one the meter draws in. Live work first, then how the
// finished members ended.
const COUNT_ORDER = [
  ["running", "running"],
  ["pending", "queued"],
  ["succeeded", "done"],
  ["failed", "failed"],
  ["refused", "refused"],
  ["cancelled", "cancelled"],
  ["unknown", "unknown"],
];

function plural(n, one, many) { return n === 1 ? one : (many || one + "s"); }

/// "2nd of 6", or "2nd" while the node has not stated how many members its share has.
const place = (position, total) => ordinal(position) + (Number.isFinite(total) ? " of " + total : "");

const nodeNameOf = (hosts, hostId) => {
  const h = (hosts || []).find((x) => x.id === hostId);
  return (h && h.name) || hostId || "an unknown node";
};

/// "6 servers on 3 nodes" — the node count stated whenever a run crosses more than one, because that
/// is the fact an operator cannot read off a list of names.
function scopeOf(run) {
  const n = run.counts.total;
  const servers = run.countsPartial ? "servers" : n + " " + plural(n, "server");
  return run.nodes.length > 1 ? servers + " on " + run.nodes.length + " nodes" : servers;
}

/// The counts, in words. Every figure is a node's own `counts` block summed across the run — nothing
/// here is re-derived from the member rows, which would state a total for a batch that reported none.
function Progress({ run }) {
  const chips = COUNT_ORDER.filter(([k]) => run.counts[k] > 0);
  return (
    <div className="opsrun__progress">
      {!run.countsPartial && run.counts.total > 0 && (
        <div className="opsrun__meter" role="presentation">
          {chips.map(([k]) => (
            <span key={k} className={"opsrun__seg opsrun__seg--" + k}
              style={{ flexGrow: run.counts[k] }} />
          ))}
        </div>
      )}
      <span className="opsrun__chips">
        {chips.length === 0 && <span className="opsrun__chip">no members</span>}
        {chips.map(([k, word]) => (
          <span key={k} className={"opsrun__chip opsrun__chip--" + k}>{run.counts[k]} {word}</span>
        ))}
        {/* A share nobody has reported is named rather than left out of the arithmetic. */}
        {run.countsPartial && <span className="opsrun__chip opsrun__chip--unknown">a node&rsquo;s share not yet reported</span>}
      </span>
    </div>
  );
}

/// What the cancel actually stopped. The two halves are always both stated: a pending member that was
/// stopped, and a running one that could not be — a kgsm invocation under way is not interruptible,
/// and an operator who reads "cancelled" and then watches a server stop anyway has been misled about
/// the one thing they were trying to prevent.
function CancelOutcome({ result, hosts, nameOf }) {
  const names = (rows) => rows.map((r) => nameOf(r.serverId)).join(", ");
  return (
    <div className="opsrun__cancelled">
      {result.cancelled.length > 0 && (
        <div className="opsrun__cancelled-line">
          <Icon name="ban" size={12} strokeWidth={2.2} />
          Stopped {result.cancelled.length} before {plural(result.cancelled.length, "it", "they")} ran — {names(result.cancelled)}
        </div>
      )}
      {result.stillRunning.length > 0 && (
        <div className="opsrun__cancelled-line opsrun__cancelled-line--warn">
          <Icon name="triangle-alert" size={12} strokeWidth={2.2} />
          {result.stillRunning.length} already running and {plural(result.stillRunning.length, "was", "were")} not stopped — {names(result.stillRunning)}
          {" · "}each finishes on its own
        </div>
      )}
      {result.untouched.length > 0 && (
        <div className="opsrun__cancelled-line opsrun__cancelled-line--warn">
          <Icon name="plug-zap" size={12} strokeWidth={2.2} />
          {result.untouched.map((u) => nodeNameOf(hosts, u.hostId)).join(", ")} didn&rsquo;t answer the cancel — that share is unchanged
        </div>
      )}
      {result.cancelled.length === 0 && result.stillRunning.length === 0 && result.untouched.length === 0 && (
        <div className="opsrun__cancelled-line">
          <Icon name="info" size={12} strokeWidth={2.2} />
          Nothing was left to stop.
        </div>
      )}
    </div>
  );
}

/// One node's share, opened. Members carry the node they belong to because the merge unions and
/// de-dups but never invents which node owns a server.
function NodeShare({ batch, hosts, nameOf, openOf }) {
  const total = batch.counts && Number.isFinite(batch.counts.total) ? batch.counts.total : null;
  const members = [...(batch.members || [])].sort(
    (a, b) => (a.queuedPosition ?? Infinity) - (b.queuedPosition ?? Infinity)
      || String(a.serverId).localeCompare(String(b.serverId)));
  return (
    <div className="opsrun__share">
      <div className="opsrun__share-head">
        <Icon name="server" size={11} strokeWidth={2.2} />
        {nodeNameOf(hosts, batch.hostId)}
        <span className="opsrun__share-state">{batch.state === "settled" ? "finished" : "running its share"}</span>
      </div>
      <div className="chat-brief__list">
        {members.map((m) => {
          const meta = memberMeta(m.state);
          const open = openOf(m.serverId);
          return (
            <div key={batch.id + "/" + m.serverId}
              className={"chat-brief__item" + (meta.tone ? " chat-brief__item--" + meta.tone : "") + (open ? "" : " chat-brief__item--static")}
              onClick={open || undefined}>
              <span className="chat-brief__icon"><Icon name={meta.icon} size={14} /></span>
              <div className="chat-brief__body">
                <span className="chat-brief__item-title"><span className="chat-brief__titletext">{nameOf(m.serverId)}</span></span>
                <span className="chat-brief__detail">{meta.word}{m.error ? " — " + m.error : ""}</span>
              </div>
              {m.state === "pending" && Number.isFinite(m.queuedPosition) && (
                // A COUNT, never a clock: which of this node's share moves next, with no time offered
                // because how long a verb takes is not something anything here has measured. The
                // denominator is the batch's own total, and the label degrades to the bare position
                // rather than guessing at one — the same rule the queued button follows.
                <span className="jobq-place" title={"Position " + place(m.queuedPosition, total) + " in this node's share"}>
                  {place(m.queuedPosition, total)}
                </span>
              )}
            </div>
          );
        })}
        {members.length === 0 && <div className="opsrun__share-empty">This node has not listed its members.</div>}
      </div>
    </div>
  );
}

function RunCard({ run, hosts, nameOf, openOf }) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState(null);
  const def = verbMeta(run.verb);

  // Per NODE, because that is how the permission is held: a run can contain servers this person may
  // not operate on one node while operating freely on another.
  const mine = run.batches.filter((b) => b.state !== "settled" && b.hostId && canOn("server.operate", b.hostId));
  const theirs = run.batches.filter((b) => b.state !== "settled").length - mine.length;

  const fire = () => {
    setBusy(true);
    cancelRun({ batches: mine })
      .then((r) => setResult(r))
      .finally(() => setBusy(false));
  };

  const when = Number.isFinite(run.startedAt) && run.startedAt > 0 ? fmtRelative(new Date(run.startedAt)) : null;

  return (
    <div className={"opsrun" + (run.state === "settled" ? " opsrun--settled" : "")}>
      <div className="opsrun__head">
        <span className={"opsrun__glyph opsrun__glyph--" + def.tone}><Icon name={def.icon} size={14} strokeWidth={2.2} /></span>
        <button type="button" className="opsrun__title" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span className="opsrun__verb">{run.verb ? def.label : "Mixed run"}</span>
          <span className="opsrun__scope">{scopeOf(run)}</span>
          <Icon name={open ? "chevron-up" : "chevron-down"} size={13} className="opsrun__chev" />
        </button>
        {run.state === "active" && mine.length > 0 && (
          <button type="button" className="opsrun__cancel" disabled={busy} onClick={fire}
            title="Stop the members that have not started. One already running cannot be interrupted.">
            <Icon name="ban" size={12} strokeWidth={2.4} />
            {busy ? "Cancelling…" : "Cancel"}
          </button>
        )}
      </div>

      <Progress run={run} />

      <div className="opsrun__meta">
        {run.actor ? <span><Icon name="user" size={11} strokeWidth={2.2} /> {run.actor}</span> : null}
        {when ? <span><Icon name="clock" size={11} strokeWidth={2.2} /> started {when}</span> : null}
        {run.state === "settled" ? <span className="opsrun__meta-done">finished</span> : null}
        {theirs > 0 && (
          <span className="opsrun__meta-warn" title="Cancel only reaches the nodes you may operate">
            {theirs} {plural(theirs, "node", "nodes")} you may not operate
          </span>
        )}
      </div>

      {result && <CancelOutcome result={result} hosts={hosts} nameOf={nameOf} />}

      {open && (
        <div className="opsrun__shares">
          {run.batches.map((b) => (
            <NodeShare key={b.id} batch={b} hosts={hosts} nameOf={nameOf} openOf={openOf} />
          ))}
        </div>
      )}
    </div>
  );
}

/// The board. Mounted in the sidebar's tray and pinnable as a widget — one component, so the two can
/// never drift.
function RunsBoard() {
  const nav = useNav();
  const byId = useStore(batchesStore, (s) => s.byId);
  const nodes = useStore(batchesStore, (s) => s.nodes);
  const hosts = useStore(hostsStore, (s) => s.list);
  const servers = useStore(serversStore, (s) => s.list);

  // Re-read on mount. The store is hydrated at boot so the badge is right before anybody looks, but a
  // tray opened twenty minutes later is asking about now.
  React.useEffect(() => { batchesStore.refresh().catch(() => {}); }, []);

  const runs = React.useMemo(() => runsFrom(byId), [byId]);
  const unreachable = React.useMemo(() => Object.values(nodes || {}).filter((n) => !n.ok), [nodes]);

  const nameOf = React.useCallback((serverId) => {
    const srv = servers.find((s) => s.id === serverId);
    return srv ? (srv.name || srv.id) : serverId;
  }, [servers]);
  const openOf = React.useCallback((serverId) => (
    servers.some((s) => s.id === serverId) ? () => nav.openServer(serverId) : null
  ), [servers, nav]);

  return (
    <div className="opsq">
      {unreachable.length > 0 && (
        // Never subtracted, never folded in. What is unknown is whether these nodes hold a share of
        // anything below — so the sentence says that, rather than implying they hold none. One
        // wording covers a node that refused the connection and one that answered without the
        // record; the per-node reason is on the title.
        <div className="opsq__unreachable"
          title={unreachable.map((n) => (n.hostId ? nodeNameOf(hosts, n.hostId) : n.label) + ": " + n.error).join("\n")}>
          <Icon name="plug-zap" size={13} strokeWidth={2.2} />
          <span>
            {unreachable.length} {plural(unreachable.length, "node")} couldn&rsquo;t be read
            {" (" + unreachable.map((n) => (n.hostId ? nodeNameOf(hosts, n.hostId) : n.label)).join(", ") + ")"}. Any run below may have a share
            there that is not counted here.
          </span>
        </div>
      )}

      {runs.length === 0 ? (
        <div className="chat-brief__empty chat-brief__empty--neutral">
          <Icon name="layers" size={20} strokeWidth={1.9} />
          <div className="chat-brief__empty-title">Nothing running</div>
          <div className="chat-brief__empty-sub">
            A run started from any browser on any node appears here while it works.
          </div>
        </div>
      ) : (
        <div className="opsq__runs">
          {runs.map((run) => (
            <RunCard key={run.key} run={run} hosts={hosts} nameOf={nameOf} openOf={openOf} />
          ))}
        </div>
      )}

    </div>
  );
}

/// The sidebar entry: a badge for what is running now, and the board in a popover.
///
/// It sits apart from Notifications on purpose. That tray is this browser's own history; this one is
/// the fleet's, and a person who reads them as one list would take a run somebody else started for
/// something they did themselves.
function OpsTray() {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  const { pos, menuRef } = usePortalPopover(open, setOpen, ref);
  const byId = useStore(batchesStore, (s) => s.byId);
  const active = React.useMemo(() => runsFrom(byId).filter((r) => r.state === "active").length, [byId]);

  return (
    <div className="opstray" ref={ref}>
      <div
        className={"nav-item" + (open ? " nav-item--active" : "")}
        onClick={() => setOpen((o) => !o)}
        role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen((o) => !o); } }}
        data-tip={"Runs" + (active > 0 ? " · " + active : "")}
        aria-label={"Runs" + (active > 0 ? ", " + active + " running" : "")}
      >
        <Icon name="layers" size={16} />
        <span className="nav-item__label">Runs</span>
        {active > 0 && <span className="nav-item__badge nav-item__badge--info">{active}</span>}
      </div>

      {open && pos && createPortal(
        <div className="opstray__pop" ref={menuRef} style={pos}>
          <div className="opstray__head">
            <Icon name="layers" size={13} strokeWidth={2.2} />
            Runs
            <span className="opstray__head-sub">across every node this panel can reach</span>
          </div>
          <div className="opstray__body"><RunsBoard /></div>
        </div>,
        document.body,
      )}
    </div>
  );
}

export { OpsTray, RunsBoard };
