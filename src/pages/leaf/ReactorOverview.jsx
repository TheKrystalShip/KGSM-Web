// ReactorOverview — what the event-triggered leaf is watching, what it has made of it, and what it is
// deliberately waiting on.
//
// The reactor is the sibling of the scheduler: that one fires on the clock, this one fires on something
// happening. So the question this page answers is not "what is due" but "is it seeing the host at all,
// and has it concluded anything" — which turns out to be four readings, and only one of them is a count
// of work done.
//
// ── The three states that look alike and are not ──────────────────────────────────────────────────
//
// A reactor with nothing to report can be any of: deliberately silent (`enabled:false` — the daemon runs
// and records nothing, which is how you quiet it without stopping the unit), sweeping normally over a
// host that simply hasn't done anything worth judging, or wedged. The leaf reports `enabled` and
// `lastSweepAt` precisely so those come apart here, and the page never collapses them into one calm
// green tile.
//
// ── ⚠ Every counter is since the reactor's process started ────────────────────────────────────────
//
// Not since the beginning. A restart resets them, so each one says "since start" in its own sub-line —
// a zero on this page after a deploy is a restart, never evidence of a quiet host. The leaf names the
// fields that way on the wire for the same reason.
//
// ── Nothing here is recomputed ────────────────────────────────────────────────────────────────────
//
// Each rule's mode and suppression window arrive ALREADY RESOLVED: a rule named in two mode lists is
// reported at the safest of them, and a rule carrying no window of its own is reported at the host-wide
// one. Re-deriving either from the settings descriptor would show an authority a rule does not actually
// have, which on a page about what a daemon is permitted to do to your servers is the worst kind of
// wrong.

import { BriefCard } from "../../components/BriefCard.jsx";
import { CardTable } from "../../components/CardTable.jsx";
import { KPI } from "../../components/KPI.jsx";
import { fmtRelative, fmtUntil, parseTs } from "../../lib/formatting.js";
import { fetchLeafReactorStatus } from "../../lib/stores.js";
import {
  LeafAbsent, LeafBriefEmpty, LeafBriefItem, LeafFacts, LeafLoading, LeafUnreadable, useLeafResource,
} from "./leafOverviewKit.jsx";

// Polled for the same reason the monitor's page is: the sweep age is measured against a timestamp in the
// payload, so ticking a local clock over a frozen one ages a healthy reactor into a "stalled" warning
// within a minute of opening the page. Slower than the monitor's because the sweep interval is 30s at
// its shortest — sampling faster than the thing being sampled buys nothing.
const SWEEP_POLL_MS = 15_000;

// How many sweeps may be missed before the age is worth colouring. Two, because one boundary miss is
// ordinary jitter between the leaf's clock and this fetch, and calling that a fault would make the tile
// cry wolf on every healthy host.
const SWEEPS_BEHIND = 2;

// A parsed timestamp or null. Anything unparseable is absent rather than rendered as "Invalid Date" — a
// broken stamp is not a sweep that happened.
function at(ts) {
  if (!ts) return null;
  const d = parseTs(ts);
  return isNaN(d.getTime()) ? null : d;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

// A duration in the coarsest unit that still says something.
function fmtSpan(ms) {
  if (ms == null || !isFinite(ms) || ms < 0) return "—";
  if (ms < MINUTE_MS) return Math.round(ms / 1000) + "s";
  if (ms < HOUR_MS) return Math.round(ms / MINUTE_MS) + "m";
  if (ms < 86_400_000) return (ms / HOUR_MS).toFixed(1) + "h";
  return (ms / 86_400_000).toFixed(1) + "d";
}

// A window the leaf states in seconds or minutes, in the unit a person reads it in.
const fmtSeconds = (s) => (s == null ? "—" : fmtSpan(s * 1000));
const fmtMinutes = (m) => (m == null ? "—" : fmtSpan(m * MINUTE_MS));

// What a rule is permitted to do, and how loudly to say it. `act` is toned amber not because it is
// wrong but because it is the one value that means this daemon changes servers on its own — a reader
// scanning the table should never have to look twice to find it.
const MODE_TONE = { observe: "muted", propose: "info", act: "warn" };

// What wakes a rule, in words. The distinction is real and unguessable from the id: an edge rule can
// miss its wake while the process is down, a state rule rediscovers its own condition every sweep and
// therefore cannot.
const SHAPE_NOTE = {
  edge: "woken by an event arriving",
  state: "rediscovered every sweep",
};

function ReactorOverview({ hostId, leafId }) {
  const { state, data, error, reload } =
    useLeafResource(hostId, leafId, (h) => fetchLeafReactorStatus(h), SWEEP_POLL_MS);

  if (state === "loading") return <LeafLoading what="Asking the reactor what it is doing…" />;
  if (state === "none") return <LeafAbsent leafId={leafId} what="a reactor" />;
  if (state === "error") return <LeafUnreadable what="Reactor status" error={error} onRetry={reload} />;

  const now = new Date();
  const gate = data.gate || {};
  const obs = data.observations || {};
  const dec = data.decisions || {};
  const rules = Array.isArray(data.rules) ? data.rules : [];
  const pending = Array.isArray(data.pending) ? data.pending : [];

  const enabled = data.enabled !== false;

  // The sweep age, and whether it is behind. Null `lastSweepAt` is a reactor whose first sweep hasn't
  // landed — reported as such rather than as an overdue one, because a daemon that started ten seconds
  // ago has not missed anything.
  const lastSweep = at(data.lastSweepAt);
  const sweepAgeMs = lastSweep ? now - lastSweep : null;
  const sweepEvery = gate.sweepIntervalSeconds || null;
  const sweepBehind = sweepAgeMs != null && sweepEvery
    ? sweepAgeMs > sweepEvery * 1000 * SWEEPS_BEHIND
    : false;

  const dropped = obs.droppedSinceStart || 0;

  // The attention lane. Each entry is a state the leaf reports about itself that somebody has to act on —
  // never a judgment this page formed about the host.
  const flags = [];
  if (!enabled) {
    flags.push({
      key: "disabled", tone: "warn", icon: "eye-off",
      title: "Observing is switched off",
      detail: "The daemon is running and recording nothing. Nothing here will update until "
        + "“Observe events” is turned back on in Settings.",
    });
  }
  if (dropped > 0) {
    flags.push({
      key: "dropped", tone: "danger", icon: "triangle-alert",
      title: dropped.toLocaleString() + " observation" + (dropped === 1 ? "" : "s") + " dropped",
      detail: "The buffer filled and these events were discarded, so the ledger is missing things that "
        + "really happened. Every rate the reactor derives from it under-reports — including the windows "
        + "its own rules are tuned from.",
    });
  }
  if (sweepBehind) {
    flags.push({
      key: "sweep", tone: "warn", icon: "clock-alert",
      title: "Last sweep was " + fmtSpan(sweepAgeMs) + " ago",
      detail: "Rules are meant to be evaluated every " + fmtSeconds(sweepEvery)
        + ". State-shaped rules rediscover their condition on the sweep, so while it is behind they are "
        + "not being asked at all.",
    });
  }
  // ⚠ Two different reasons for a null sweep, and only one of them clears on its own. A reactor with no
  // rules live never sweeps at all — the engine has nothing to evaluate and stops before its first pass —
  // so telling somebody to wait a sweep interval would be telling them to wait forever.
  if (enabled && lastSweep == null && rules.length === 0) {
    flags.push({
      key: "norules", tone: "warn", icon: "circle-off",
      title: "No rules are live",
      detail: "The reactor is observing and recording events, and evaluating them against nothing. It "
        + "will never sweep while every rule is switched off — turn one on under Rules.",
    });
  } else if (enabled && lastSweep == null) {
    flags.push({
      key: "firstsweep", tone: "info", icon: "hourglass",
      title: "No sweep has completed yet",
      detail: "The reactor is up and has not finished its first evaluation pass. This clears within one "
        + "sweep interval of a start.",
    });
  }

  // Every rule sitting at observe is worth stating once, plainly: it is the shipped posture and the
  // reason the page shows judgments rather than actions. Not a flag — nothing is wrong — so it goes in
  // the rules card's meta line instead.
  const acting = rules.filter(r => r.mode === "act" || r.mode === "propose").length;

  const startedAt = at(data.startedAt);

  return (
    <>
      <div className="dash-summary">
        {/* Not a health tile. A reactor deliberately quieted is a configuration, and painting it red
            would report a decision somebody made as a fault. */}
        <KPI icon={enabled ? "eye" : "eye-off"} label="Observing"
          value={enabled ? "On" : "Off"} tone={enabled ? "ok" : "warn"}
          sub={enabled
            ? "reading every producer’s journal"
            : "the daemon runs and records nothing"} />

        <KPI icon="timer" label="Last sweep"
          value={lastSweep ? fmtSpan(sweepAgeMs) : "—"}
          tone={sweepBehind ? "warn" : lastSweep ? "ok" : "muted"}
          sub={lastSweep
            ? "rules evaluated every " + fmtSeconds(sweepEvery)
            : rules.length === 0
              ? "no rules live — it never sweeps"
              : "no sweep has completed yet"} />

        {/* The honesty tile. A non-zero here is the one failure that otherwise looks exactly like a
            quiet host, so it is toned danger at 1 rather than at any threshold. */}
        <KPI icon={dropped ? "triangle-alert" : "inbox"} label="Observations"
          value={(obs.recordedSinceStart ?? 0).toLocaleString()}
          tone={dropped ? "danger" : "info"}
          sub={dropped
            ? dropped.toLocaleString() + " dropped — the ledger is incomplete"
            : "recorded since the reactor started"} />

        {/* Two numbers, because the gap between them is meaningful rather than a discrepancy: a
            decision is recorded every time an episode is evaluated and announced only when the verdict
            changes, so announced < recorded is the design working. */}
        <KPI icon="gavel" label="Decisions"
          value={(dec.recordedSinceStart ?? 0).toLocaleString()} tone="muted"
          sub={(dec.announcedSinceStart ?? 0).toLocaleString() + " announced · since start"} />
      </div>

      <div className="dash-feed">
        <BriefCard icon="hourglass" title="Settling now" count={pending.length || null} countTone="neutral"
          meta="Evaluations woken and waiting out their settle window — the reactor has noticed and is
                deliberately giving the condition a chance to resolve itself.">
          {pending.length === 0 ? (
            <LeafBriefEmpty title="Nothing waiting">
              No rule has been woken and left pending. This is the ordinary state: a settle window only
              opens when something the reactor watches for actually happens.
            </LeafBriefEmpty>
          ) : (
            <div className="chat-brief__list">
              {pending.map(p => {
                const due = at(p.dueAt);
                return (
                  <LeafBriefItem key={p.rule + ":" + p.subject} tone="info" icon="hourglass"
                    title={p.subject + " · " + p.rule}
                    detail={due
                      ? "evaluated " + fmtUntil(due, now) + " · " + due.toLocaleString()
                      : "no evaluation time reported"} />
                );
              })}
            </div>
          )}
        </BriefCard>

        <BriefCard icon="triangle-alert" title="Needs a look" count={flags.length || null}
          countTone={flags.some(f => f.tone === "danger") ? "danger" : "neutral"}
          meta="States the reactor reports about itself that somebody has to act on.">
          {flags.length === 0 ? (
            <LeafBriefEmpty title="Nothing flagged">
              It is observing, sweeping on time, and has dropped nothing.
            </LeafBriefEmpty>
          ) : (
            <div className="chat-brief__list">
              {flags.map(f => <LeafBriefItem key={f.key} {...f} />)}
            </div>
          )}
        </BriefCard>
      </div>

      <CardTable
        icon="scale" title="Rules" count={rules.length}
        columns={[
          {
            key: "id", label: "Rule", width: "minmax(0,1.5fr)", sort: r => r.id,
            render: r => (
              <>
                {r.id}
                <span className="leaf-facts__hint" style={{ display: "block" }}>
                  {SHAPE_NOTE[r.shape] || r.shape}
                </span>
              </>
            ),
          },
          {
            key: "mode", label: "Authority", width: "110px", sort: r => r.mode,
            render: r => (
              <span className={"cluster-chip cluster-chip--"
                + (MODE_TONE[r.mode] === "warn" ? "danger" : MODE_TONE[r.mode] === "info" ? "ok" : "muted")}>
                {r.mode}
              </span>
            ),
          },
          {
            key: "severity", label: "Severity", width: "100px", sort: r => r.severity,
            render: r => <span className="svc-fact svc-fact--unit">{r.severity}</span>,
          },
          {
            // The window a condition is left alone in before it is judged — the single largest source of
            // noise a rule engine avoids, and the number an operator argues with first.
            key: "settleSeconds", label: "Settle", width: "90px", align: "right",
            sort: r => r.settleSeconds,
            render: r => fmtSeconds(r.settleSeconds),
          },
          {
            key: "suppressionMinutes", label: "Stays quiet", width: "110px", align: "right",
            sort: r => r.suppressionMinutes,
            render: r => fmtMinutes(r.suppressionMinutes),
          },
        ]}
        rows={rules}
        getKey={r => r.id}
        defaultSort={{ key: "id", dir: "asc" }}
        empty="This reactor has no rules live. Nothing wakes, and nothing is judged." />

      <BriefCard icon="sliders-horizontal" title="Gate"
        meta="The tuning every rule runs under, as the daemon is actually running it. A rule carrying its
              own suppression window uses that instead — the Rules table above shows each one resolved.">
        <LeafFacts rows={[
          ["Evaluate rules every", fmtSeconds(gate.sweepIntervalSeconds)],
          ["Stay quiet for", fmtMinutes(gate.suppressionWindowMinutes),
            "Per rule and per subject, where the rule names no window of its own."],
          ["Decisions per hour", gate.maxActionsPerHour ? gate.maxActionsPerHour : "no ceiling",
            gate.maxActionsPerHour
              ? "Host-wide. What stops one host-level failure becoming one decision per server."
              : "The ceiling is disabled, so nothing bounds how much the reactor may decide in an hour."],
          ["Rules with authority to act", acting === 0 ? "none" : acting + " of " + rules.length,
            acting === 0
              ? "Every rule records what it would have done and changes nothing. This is the shipped "
                + "posture — a rule earns the right to act by being read while it only watched."
              : null],
          ["Ledger", data.ledgerPath || "—",
            "Working data, not a record: every row restates something a producer’s own journal holds."],
          ["Running", data.version || "—",
            startedAt ? "started " + fmtRelative(startedAt, now) : null],
        ]} />
      </BriefCard>
    </>
  );
}

export { ReactorOverview };
