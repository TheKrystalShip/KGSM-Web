// SchedulerOverview — what this host is going to do to itself, and how the last round went.
//
// A maintenance window is one appointment plus an ordered set of tasks, and an instance holds a list of
// them. Windows are independent of each other by construction, so the one place they belong together is
// the one an operator thinks of them in: "what fires next on this box". That merged lane is the reason
// this page exists, because the per-server settings surface can only ever show one instance's list, and
// the leaf's Windows tab is the board a person goes to when they already know which appointment they
// mean. This is the glance.
//
// Every time shown is the leaf's own arithmetic, relayed through the api untouched. This file computes
// no schedule; it sorts and formats what the scheduler already decided. A null next fire on a valid
// window is "not due" and a null last run is "hasn't run in this daemon's lifetime" — two different
// silences, worded differently and never filled in.

import React from "react";

import { BriefCard } from "../../components/BriefCard.jsx";
import { KPI } from "../../components/KPI.jsx";
import { fmtRelative, fmtUntil } from "../../lib/formatting.js";
import { fetchLeafSchedules } from "../../lib/stores.js";
import { flattenWindows } from "./schedulerBoard.jsx";
import { LeafBriefEmpty, LeafBriefItem, LeafLoading, LeafAbsent, LeafUnreadable, useLeafResource } from "./leafOverviewKit.jsx";

// The icon a window is announced with: the heaviest thing it does. A window carrying an update is a
// download and a stop; one carrying only a backup touches nothing an operator has to plan around.
function windowIcon(tasks) {
  if (tasks.includes("update")) return "download";
  if (tasks.includes("restart")) return "rotate-cw";
  if (tasks.includes("backup")) return "database-backup";
  return "calendar-clock";
}

function SchedulerOverview({ hostId, leafId }) {
  const { state, data, error, reload } = useLeafResource(hostId, leafId, (h) => fetchLeafSchedules(h));

  // Relative times are the whole point of the upcoming lane, so they tick rather than freezing at the
  // moment of the fetch. A minute is the finest granularity anything here renders.
  const [, setClock] = React.useState(0);
  React.useEffect(() => {
    const t = setInterval(() => setClock(c => c + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  if (state === "loading") return <LeafLoading what="Reading the scheduler’s board…" />;
  if (state === "none") return <LeafAbsent leafId={leafId} what="a scheduler" />;
  if (state === "error") return <LeafUnreadable what="Schedule board" error={error} onRetry={reload} />;

  const instances = Array.isArray(data) ? data : [];
  const windows = flattenWindows(instances);
  const now = new Date();

  // Every window that has somewhere to be, soonest first. Each keeps its tasks, because "Ketchup in 9h"
  // is useless without knowing whether that is an archive or the server going down.
  const upcoming = windows.filter(w => w.next).sort((a, b) => a.next - b.next);
  const invalid = windows.filter(w => !w.valid);

  // A failure is worth surfacing; the other three words are not faults. `skipped` is a task that did not
  // apply and `aborted` is one an earlier failure took the turn from, so raising either would report
  // something the daemon did not record. An invalid window sits in the same lane for a different reason:
  // it is not failing, it is not running at all.
  const failed = windows.filter(w => w.run && w.run.outcome === "failed");

  const needsLook = [
    ...failed.map(w => {
      const culprit = [...w.taskRuns.values()].find(t => t.outcome === "failed") || null;
      return {
        key: w.key + ":failed", tone: "danger", icon: windowIcon(w.tasks),
        title: w.instance + " — " + (culprit ? culprit.name + " failed" : "the window failed"),
        detail: (culprit && culprit.message ? culprit.message : "the scheduler recorded no reason")
          + " · " + w.words
          + (w.ranAt ? " · " + fmtRelative(w.ranAt, now) : ""),
      };
    }),
    ...invalid.map(w => ({
      key: w.key + ":invalid", tone: "warn", icon: "calendar-x",
      title: w.instance + " — a window won’t fire",
      detail: (w.error || "the scheduler gave no reason") + " · " + w.id,
    })),
  ];

  const next = upcoming[0] || null;
  const withWindows = new Set(windows.map(w => w.instance)).size;

  return (
    <>
      <div className="dash-summary">
        {/* Not toned. No maintenance is a legitimate configuration on a host nobody wants restarted,
            so painting a zero amber would invent a policy this panel doesn't hold. */}
        <KPI icon="calendar-clock" label="Windows" value={windows.length} tone="muted"
          sub={instances.length
            ? "on " + withWindows + " of " + instances.length + " instance" + (instances.length === 1 ? "" : "s")
            : "no instances known"} />
        <KPI icon="timer" label="Next window"
          value={next ? fmtUntil(next.next, now) : "—"} tone={next ? "info" : "muted"}
          sub={next
            ? next.instance + " · " + (next.tasks.join(", ") || "no tasks")
            : "nothing is due to fire"} />
        <KPI icon="calendar-x" label="Won’t fire" value={invalid.length}
          tone={invalid.length ? "warn" : "muted"}
          sub={invalid.length ? "the scheduler can’t read them" : "every window parses"} />
        <KPI icon="triangle-alert" label="Failed last run" value={failed.length}
          tone={failed.length ? "danger" : "ok"}
          sub={failed.length ? "needs a look" : "no run recorded a failure"} />
      </div>

      <div className="dash-feed">
        <BriefCard icon="calendar-clock" title="Next up" count={upcoming.length || null} countTone="neutral"
          meta="Maintenance windows across this host, soonest first — as the scheduler computed them.">
          {upcoming.length === 0 ? (
            <LeafBriefEmpty title="Nothing scheduled">
              {instances.length
                ? "The scheduler reads " + instances.length + " instance" + (instances.length === 1 ? "" : "s")
                  + ", and none of them has a window due."
                : "The scheduler isn’t reading any instance on this host."}
            </LeafBriefEmpty>
          ) : (
            <div className="chat-brief__list">
              {upcoming.slice(0, 6).map(w => (
                <LeafBriefItem key={w.key} tone="info" icon={windowIcon(w.tasks)}
                  title={w.instance + " · " + (w.tasks.join(", ") || "no tasks")}
                  detail={fmtUntil(w.next, now) + " · " + w.words + " · " + w.next.toLocaleString()} />
              ))}
            </div>
          )}
        </BriefCard>

        <BriefCard icon="triangle-alert" title="Needs a look" count={needsLook.length || null}
          countTone={failed.length ? "danger" : needsLook.length ? "warn" : "neutral"}
          meta="A window the leaf ran and recorded as failed, or one it can’t read.">
          {needsLook.length === 0 ? (
            <LeafBriefEmpty title="Nothing flagged">
              Every window parses, and no run has been recorded as failing.
            </LeafBriefEmpty>
          ) : (
            <div className="chat-brief__list">
              {needsLook.map(f => <LeafBriefItem key={f.key} {...f} />)}
            </div>
          )}
        </BriefCard>
      </div>
    </>
  );
}

export { SchedulerOverview };
