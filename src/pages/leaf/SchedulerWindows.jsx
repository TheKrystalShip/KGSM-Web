// SchedulerWindows — the Scheduler leaf's Windows tab: every maintenance window on this host in one
// board, and the three things an operator does to one without editing it.
//
// It lives on the Scheduler leaf because the daemon is what holds these targets. The windows themselves
// belong to the instances — they are written in kgsm config and edited on the server's own Settings page
// — but when each next fires, and how each last ran, is the leaf's own arithmetic over its own clock,
// and this is where the whole fleet's worth of it is legible at once.
//
// Read straight through the leaf resource rather than a store: the board is a snapshot of a daemon's
// live state, and a cached copy is a copy that can be stale about when a server is next going down.
//
// Postpone, Skip and Run now move a target the daemon holds in memory. The fire after the one acted on
// lands where it always would have, kgsm config is untouched, and a restart of the daemon brings a
// deferred fire back — which is what makes them "not tonight" and "just this once" rather than edits.
// Changing what a window IS is the instance's own settings page, at operator; moving the fleet's
// appointments about is admin on this node.

import React from "react";

import { CardTable } from "../../components/CardTable.jsx";
import { Icon } from "../../components/Icon.jsx";
import { Modal } from "../../components/Modal.jsx";
import { Select } from "../../components/Select.jsx";
import { fmtUntil } from "../../lib/formatting.js";
import { sessionStore } from "../../lib/sessionStore.js";
import { controlLeafWindow, fetchLeafSchedules } from "../../lib/stores.js";
import { OutcomeChip, TaskChips, flattenWindows } from "./schedulerBoard.jsx";
import { LeafAbsent, LeafLoading, LeafNotice, LeafUnreadable, useLeafResource } from "./leafOverviewKit.jsx";

// The three the control socket takes, with the words each is asked and answered in. `run-now` is spelled
// as the daemon reads it; the label is not, because nobody says "run-now".
const VERBS = {
  postpone: {
    label: "Postpone", icon: "clock-arrow-down", tone: "accent",
    title: "Postpone this window?",
    confirm: "Postpone",
    said: "Postponed.",
  },
  skip: {
    label: "Skip", icon: "skip-forward", tone: "accent",
    title: "Skip the next run?",
    confirm: "Skip it",
    said: "The next run is skipped.",
  },
  // Run now is the one that is not a deferral: it puts the window's whole sequence against a live
  // server on the daemon's next poll, so the dialog it opens is toned like the act it is.
  "run-now": {
    label: "Run now", icon: "play", tone: "warn",
    title: "Run this window now?",
    confirm: "Run it now",
    said: "Brought forward — it runs on the daemon's next poll.",
  },
};

// How far a postponement moves a fire. The node refuses anything past 720 minutes, on the grounds that
// further out is a schedule change and belongs where it survives a restart of the daemon.
const POSTPONE_SPANS = [
  { value: "15", label: "15 minutes" },
  { value: "30", label: "30 minutes" },
  { value: "60", label: "1 hour" },
  { value: "120", label: "2 hours" },
  { value: "240", label: "4 hours" },
  { value: "720", label: "12 hours" },
];

function SchedulerWindows({ hostId, leafId }) {
  // The leaf page's gate is the aggregate one — admin anywhere reaches it — so the tier that decides
  // whether these windows can be moved is the one held on THIS node. Reading the board is operator.
  const live = !!hostId && sessionStore.isLive(hostId);
  const tier = live ? sessionStore.tierOf(hostId) : null;
  const canEdit = tier === "admin";

  const { state, data, error, reload } = useLeafResource(hostId, leafId, (h) => fetchLeafSchedules(h));

  // What a person pressed, held until they confirm it: { verb, row }.
  const [pending, setPending] = React.useState(null);
  const [notice, setNotice] = React.useState(null);
  const [refusal, setRefusal] = React.useState(null);

  // "in 3h" is the column's whole point, so it ticks rather than freezing at the moment of the fetch.
  const [, setClock] = React.useState(0);
  React.useEffect(() => {
    const t = setInterval(() => setClock(c => c + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const act = (verb, row, minutes) => {
    setNotice(null);
    setRefusal(null);
    const body = { instance: row.instance, window: row.id };
    if (verb === "postpone") body.minutes = minutes;
    return controlLeafWindow(hostId, verb, body).then(
      (res) => {
        setPending(null);
        const next = res && res.nextFireUtc ? new Date(res.nextFireUtc) : null;
        const said = (res && res.message) || VERBS[verb].said;
        setNotice(next && !isNaN(next.getTime())
          ? said + " Next fire " + next.toLocaleString() + "."
          : said);
        reload();
      },
      (e) => {
        // The refusal renders at the top of the tab, so the dialog closes with it — a notice behind a
        // modal is a notice nobody reads.
        setPending(null);
        setRefusal(messageOf(e, "The scheduler didn’t take that."));
      },
    );
  };

  if (!live) return <LeafNotice title="Not signed in to this node">Sign in here to see its maintenance windows.</LeafNotice>;
  if (state === "loading") return <LeafLoading what="Reading this host’s maintenance windows…" />;
  if (state === "none") return <LeafAbsent leafId={leafId} what="a scheduler" />;
  if (state === "error") return <LeafUnreadable what="Maintenance windows" error={error} onRetry={reload} />;

  const read = Array.isArray(data) ? data.length : 0;
  const rows = flattenWindows(data);
  const now = new Date();
  const invalid = rows.filter(r => !r.valid).length;

  const columns = [
    {
      key: "instance", label: "Server", width: "minmax(0,1.1fr)", sort: r => r.instance,
      render: r => (
        <span className="mw-board__server">
          <span className="mw-board__name" title={r.instance}>{r.instance}</span>
          {/* An appointment is read in the instance's own zone, so "04:00" means nothing without it —
              scheduling downtime into somebody's evening is what an unstated zone buys. An interval is
              timezone-free by construction, so its row says nothing about one. */}
          {r.kind === "appointment" && (
            <span className="mw-board__tz">{r.timezone || "host default"}</span>
          )}
        </span>
      ),
    },
    {
      key: "words", label: "Schedule", width: "minmax(0,1.5fr)", sort: r => r.words,
      render: r => (
        <span className="mw-board__sched">
          <span className="mw-board__words" title={r.id}>{r.words}</span>
          {/* An invalid window is shown as invalid carrying the node's own reason. A window with no
              next fire and no error is simply not due, which is a different silence. */}
          {r.error && <span className="mw-board__error">{r.error}</span>}
        </span>
      ),
    },
    {
      key: "tasks", label: "Tasks", width: "minmax(0,1.1fr)", sort: r => r.tasks.join(","),
      render: r => <TaskChips tasks={r.tasks} taskRuns={r.taskRuns} />,
    },
    {
      // Sorts on the raw instant, not the rendered text — a null sinks to the bottom either way.
      key: "next", label: "Next", width: "110px", align: "right", sort: r => r.next, defaultDir: "asc",
      render: r => (r.next
        ? <span title={r.next.toLocaleString()}>{fmtUntil(r.next, now)}</span>
        : !r.valid
          ? <span className="cluster-chip cluster-chip--danger">invalid</span>
          : <span className="svc-fact svc-fact--unit">not due</span>),
    },
    {
      key: "lastRun", label: "Last run", width: "150px", align: "right", sort: r => r.ranAt,
      render: r => (r.run
        ? <OutcomeChip outcome={r.run.outcome} when={r.ranAt} now={now}
          message={[...r.taskRuns.values()].map(t => t.name + ": " + t.outcome + (t.message ? " (" + t.message + ")" : "")).join(" · ")} />
        : <span className="svc-fact svc-fact--unit">never</span>),
    },
  ];

  if (canEdit) {
    columns.push({
      key: "actions", label: "", width: "96px", align: "right",
      render: r => (
        <span className="mw-board__acts">
          {Object.keys(VERBS).map((verb) => (
            <button key={verb} type="button" className="lcf-iconbtn"
              disabled={!r.valid}
              aria-label={VERBS[verb].label + " " + r.instance + " " + r.words}
              title={r.valid
                ? VERBS[verb].label
                : "The scheduler won’t fire this window, so there is nothing to move"}
              onClick={() => { setNotice(null); setRefusal(null); setPending({ verb, row: r }); }}>
              <Icon name={VERBS[verb].icon} size={14} />
            </button>
          ))}
        </span>
      ),
    });
  }

  return (
    <div className="thr-tab">
      {refusal && <LeafNotice title="That didn’t happen">{refusal}</LeafNotice>}
      {notice && <div className="thr-notice thr-notice--ok">{notice}</div>}

      {!canEdit && (
        <div className="thr-notice">
          These are the appointments this host keeps. Postponing, skipping or running one needs admin on
          this node{tier ? " — you’re " + tier + " here." : "."}
        </div>
      )}

      <div className="mw-board">
        <CardTable
          icon="calendar-clock" title="Maintenance windows" count={rows.length}
          columns={columns}
          rows={rows}
          getKey={r => r.key}
          rowClass={r => (r.valid ? "" : "mw-board__row--invalid")}
          defaultSort={{ key: "next", dir: "asc" }}
          empty={read
            ? "The scheduler reads " + read + " instance" + (read === 1 ? "" : "s") + " on this host and none of them has a maintenance window."
            : "The scheduler isn’t reading any instance on this host."} />
      </div>

      {invalid > 0 && (
        <div className="thr-notice">
          {invalid} of {rows.length} window{rows.length === 1 ? "" : "s"} won’t fire.
        </div>
      )}

      {pending && (
        <WindowActionDialog verb={pending.verb} row={pending.row}
          onClose={() => setPending(null)}
          onConfirm={(minutes) => act(pending.verb, pending.row, minutes)} />
      )}
    </div>
  );
}

// The confirmation in front of moving one window. It names the server, the appointment and the tasks,
// because all three are what somebody is about to change their mind about — and Run now is not a
// preview: it puts the window's whole sequence against a live server on the daemon's next poll.
function WindowActionDialog({ verb, row, onConfirm, onClose }) {
  const v = VERBS[verb];
  const [minutes, setMinutes] = React.useState("60");
  const [busy, setBusy] = React.useState(false);

  const go = () => {
    setBusy(true);
    Promise.resolve(onConfirm(Number(minutes))).finally(() => setBusy(false));
  };

  return (
    <Modal onClose={busy ? undefined : onClose} canClose={!busy}>
      <div className="modal host-remove">
        <div className={"host-remove__icon host-remove__icon--" + v.tone}><Icon name={v.icon} size={20} /></div>
        <h2 className="host-remove__title">{v.title}</h2>
        <p className="host-remove__text">
          <b>{row.instance}</b> · {row.words} · {row.tasks.length ? row.tasks.join(", ") : "no tasks"}
        </p>
        {verb === "postpone" && (
          <label className="thr-field mw-dialog__span">
            <span className="thr-field__label">Push it back by</span>
            <Select value={minutes} disabled={busy} options={POSTPONE_SPANS}
              onChange={(e) => setMinutes(e.target.value)} />
          </label>
        )}
        <div className="host-remove__foot">
          <button className="host-btn host-btn--ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="host-btn host-btn--primary" onClick={go} disabled={busy}>
            <Icon name={v.icon} size={14} /> {busy ? "Asking…" : v.confirm}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function messageOf(e, fallback) {
  const m = e && (e.userMessage || e.message || (e.body && e.body.error && e.body.error.message));
  return m || fallback;
}

export { SchedulerWindows };
