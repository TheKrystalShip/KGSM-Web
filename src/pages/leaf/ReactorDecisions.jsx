// ReactorDecisions — what the reactor made of what it saw, and the page the decision to let it act is
// taken on.
//
// This is not a log viewer with extra cards. The reactor's plan gates propose and act mode behind a
// review: nothing moves until a window of decisions has been read against what a person would actually
// have done. Until this page the review existed only as `kgsm-reactor --decisions` on a terminal on the
// host, which made the gate something declared rather than performed.
//
// ── Four readings, and each answers a question about a rule rather than about the host ─────────────
//
//   1. What each rule concluded. The share that did NOT fire is the one to read: a rule mostly
//      suppressed is telling you its window is too wide, one mostly unreadable is telling you it rests
//      on something this host cannot answer — which is a rule that will keep failing quietly once it
//      is allowed to act.
//   2. The busiest rolling hour of FIRED decisions. The figure a host-wide ceiling is either a safety
//      net or a gag against.
//   3. How far apart a rule's repeats about one subject were. What a suppression window is derived
//      from — and where there is no repeat, the honest answer is that the window rests on nothing yet.
//   4. The rules that decided nothing at all. The failure that looks most like success: enabled,
//      listed everywhere, silent forever.
//
// ── Nothing here is computed ───────────────────────────────────────────────────────────────────────
//
// Every number arrives from the leaf, which derives them from its ledger with the same code its
// terminal report renders. Re-deriving the busiest hour in the browser from the decisions list would
// be wrong the moment that list is capped — and it IS capped, which is why `total` is on the wire
// beside it.
//
// ── ⚠ It reports; it does not recommend ────────────────────────────────────────────────────────────
//
// No window, ceiling or threshold is suggested on this page, because none is suggested on the wire.
// The leaf refuses to propose values on the grounds that arithmetic plus a printed figure reads as an
// answer, and a surface that added its own recommendation would put back exactly what the leaf
// declined to say.

import React from "react";

import { BriefCard } from "../../components/BriefCard.jsx";
import { CardTable } from "../../components/CardTable.jsx";
import { Icon } from "../../components/Icon.jsx";
import { KPI } from "../../components/KPI.jsx";
import { fmtRelative, parseTs } from "../../lib/formatting.js";
import { fetchLeafReactorDecisions } from "../../lib/stores.js";
import { RangeSelector } from "../performance/PerfCards.jsx";
import {
  LeafAbsent, LeafBriefEmpty, LeafBriefItem, LeafFacts, LeafLoading, LeafUnreadable, useLeafResource,
} from "./leafOverviewKit.jsx";

// The windows offered. Seven is first because it is the span the review gate is stated over; the others
// exist because a host quiet for a week still has something to show over a month. Rendered through the
// performance tab's RangeSelector — the panel already has one segmented range control and a second one
// styled from scratch would be the same affordance drawn two ways.
//
// ⚠ The leaf clamps whatever it is sent to its own ledger retention, so a 30 on a host retaining 14 days
// answers 14 and says so in `windowDays`. That is the true reading and the page shows what came back.
const WINDOWS = [
  { key: 7, label: "7 days" },
  { key: 14, label: "14 days" },
  { key: 30, label: "30 days" },
];

// What each outcome means, in the words the review is read in. The leaf's vocabulary is precise and
// unguessable from the word alone — "settled" in particular reads like a synonym for "handled" and
// means very nearly the opposite: the condition resolved itself, so the rule correctly said nothing.
const OUTCOME = {
  fired: { tone: "danger", icon: "circle-alert", note: "the condition held and the gate let it through" },
  settled: { tone: "ok", icon: "circle-check", note: "the condition had resolved itself by the time it was judged" },
  suppressed: { tone: "muted", icon: "bell-off", note: "it fired too recently for this rule and subject" },
  ceilinged: { tone: "warn", icon: "hand", note: "the host had already decided as much this hour as it may" },
  superseded: { tone: "muted", icon: "layers", note: "a more severe rule already spoke for this episode" },
  unreadable: { tone: "warn", icon: "circle-help", note: "no judgment could be formed — the world would not say" },
};
const outcomeOf = (o) => OUTCOME[String(o || "").toLowerCase()] || { tone: "muted", icon: "dot", note: null };

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

function fmtSpan(ms) {
  if (ms == null || !isFinite(ms) || ms < 0) return "—";
  if (ms < MINUTE_MS) return Math.round(ms / 1000) + "s";
  if (ms < HOUR_MS) return Math.round(ms / MINUTE_MS) + "m";
  if (ms < DAY_MS) return (ms / HOUR_MS).toFixed(1) + "h";
  return (ms / DAY_MS).toFixed(1) + "d";
}

function at(ts) {
  if (!ts) return null;
  const d = parseTs(ts);
  return isNaN(d.getTime()) ? null : d;
}

// A cell's second line. The shared table truncates a cell with `text-overflow: ellipsis`, which acts on
// a single text node — an inner block overflows past it instead, clipping mid-word with nothing to show
// the text was cut. So each line here truncates itself.
const SUBLINE = { display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

// The journal position, which is long and must stay readable in full: it is what a reviewer disagreeing
// with a verdict goes and reads the original line by, so ellipsising it away would remove the one field
// that makes the row checkable. It wraps instead.
const SOURCE = { whiteSpace: "normal", wordBreak: "break-all", lineHeight: 1.35 };

function ReactorDecisions({ hostId, leafId }) {
  const [days, setDays] = React.useState(WINDOWS[0].key);

  // Not polled. A decision is a judgment already reached, and the readings over a week do not change
  // meaningfully between two glances — where the Overview's sweep age decays against a wall clock and
  // has to. Changing the window re-fetches, which is the only refresh this page needs.
  const { state, data, error, reload } =
    useLeafResource(hostId, leafId, (h) => fetchLeafReactorDecisions(h, days));

  // The fetcher closes over `days`, and useLeafResource deliberately does not take the fetcher as a
  // dependency (every call site passes an inline arrow, which would re-fetch forever) — so a window
  // change has to ask for the reload itself.
  //
  // ⚠ Guarded on the PREVIOUS window rather than on "is this the first render". StrictMode runs an
  // effect twice on mount, and a first-render flag is already spent by the second run — which then
  // reloads a page that had just loaded, costing an extra read of the ledger on every mount. Comparing
  // the value is idempotent, so the second run correctly does nothing.
  const lastDays = React.useRef(days);
  React.useEffect(() => {
    if (lastDays.current === days) return;
    lastDays.current = days;
    reload();
  }, [days, reload]);

  if (state === "loading") return <LeafLoading what="Reading the reactor’s decisions…" />;
  if (state === "none") return <LeafAbsent leafId={leafId} what="a reactor" />;
  if (state === "error") return <LeafUnreadable what="Decision review" error={error} onRetry={reload} />;

  const now = new Date();
  const rules = Array.isArray(data.rules) ? data.rules : [];
  const repeats = Array.isArray(data.repeats) ? data.repeats : [];
  const silent = Array.isArray(data.silent) ? data.silent : [];
  const rows = Array.isArray(data.decisions) ? data.decisions : [];
  const ceiling = data.ceiling || null;
  const total = data.total ?? rows.length;

  // The leaf caps the log and never the readings, so a shorter list than the total is the page showing
  // the newest of more — not a disagreement between two numbers.
  const capped = total > rows.length;

  // The window the leaf actually answered, which is not always the one asked for.
  const answered = data.windowDays ?? days;

  const windowPicker = (
    <div className="players-toolbar">
      <RangeSelector range={days} setRange={setDays} ranges={WINDOWS} />
    </div>
  );

  // The empty window is a reading, and an ambiguous one — worth saying in full rather than as "no data".
  if (total === 0) {
    return (
      <>
        {windowPicker}
        <BriefCard icon="gavel" title="Decisions" meta={"The last " + answered + " days."}>
          <LeafBriefEmpty title="Nothing decided in this window">
            A reading rather than a gap, and it does not say which of two things happened: a rule
            decides nothing when its condition never occurred, and equally when the event that wakes it
            never arrived. Those are different, and only the population report
            (<code>kgsm-reactor --report</code>) separates them — a wake event absent from it is one no
            rule here can ever fire on.
          </LeafBriefEmpty>
        </BriefCard>
        {silent.length > 0 && <SilentCard silent={silent} />}
      </>
    );
  }

  return (
    <>
      {windowPicker}

      <div className="dash-summary">
        <KPI icon="gavel" label="Decisions" value={total.toLocaleString()} tone="muted"
          sub={capped
            ? "showing the newest " + rows.length.toLocaleString()
            : "every one in the window"} />

        {/* Fired is the only outcome that would have done something. Toned muted rather than danger:
            a fire in observe mode is the rule working, not an incident. */}
        <KPI icon="circle-alert" label="Would have acted"
          value={ceiling ? ceiling.fired.toLocaleString() : "0"} tone={ceiling ? "info" : "muted"}
          sub={ceiling
            ? ceiling.perDay.toFixed(1) + " per day over " + answered + " days"
            : "nothing fired — every evaluation stopped short"} />

        {/* The figure a ceiling is set from. Null when nothing fired, which is not a peak of zero:
            there is no pressure to measure and no basis for a ceiling either way. */}
        <KPI icon="chart-column" label="Busiest hour"
          value={ceiling ? ceiling.peakInHour : "—"} tone="muted"
          sub={ceiling
            ? "ended " + (at(ceiling.peakEndedAt) ? fmtRelative(at(ceiling.peakEndedAt), now) : "—")
            : "no fired decisions to measure pressure from"} />

        <KPI icon="ear-off" label="Silent rules" value={silent.length}
          tone={silent.length ? "warn" : "ok"}
          sub={silent.length
            ? "decided nothing at all this window"
            : "every rule reached at least one decision"} />
      </div>

      <div className="dash-feed">
        <BriefCard icon="repeat" title="How soon a rule repeats" count={repeats.length || null}
          countTone="neutral"
          meta="The gap between consecutive FIRED decisions about one subject — what a suppression
                window is derived from.">
          {repeats.length === 0 ? (
            <LeafBriefEmpty title="No rule fired twice about one subject">
              ⚠ A suppression window derived from this window would be derived from nothing. The
              configured windows stay placeholders until a repeat has actually been measured here.
            </LeafBriefEmpty>
          ) : (
            <div className="chat-brief__list">
              {repeats.map(r => (
                <LeafBriefItem key={r.rule + ":" + r.subject} tone="info" icon="repeat"
                  title={r.subject + " · " + r.rule + " · " + r.fires + " fires"}
                  detail={"shortest " + fmtSpan(r.shortestMs)
                    + " · median " + fmtSpan(r.medianMs)
                    + " · longest " + fmtSpan(r.longestMs)} />
              ))}
            </div>
          )}
        </BriefCard>

        {silent.length > 0
          ? <SilentCard silent={silent} />
          : (
            <BriefCard icon="ear" title="Every rule spoke" meta="No rule was silent for the whole window.">
              <LeafBriefEmpty title="Nothing silent">
                Each rule reached at least one decision, so none of them is enabled-and-inert.
              </LeafBriefEmpty>
            </BriefCard>
          )}
      </div>

      <BriefCard icon="scale" title="What each rule concluded" count={rules.length || null}
        countTone="neutral"
        meta="Read the share that did NOT fire. Mostly suppressed means the window is too wide; mostly
              unreadable means the rule rests on something this host cannot answer.">
        <LeafFacts rows={rules.map(rule => [
          rule.id,
          <span key={rule.id} style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {(rule.outcomes || []).map(o => (
              <span key={o.outcome}
                className={"cluster-chip cluster-chip--"
                  + (outcomeOf(o.outcome).tone === "danger" ? "danger"
                    : outcomeOf(o.outcome).tone === "ok" ? "ok" : "muted")}
                title={outcomeOf(o.outcome).note || o.outcome}>
                {o.outcome} {o.count}
              </span>
            ))}
          </span>,
          rule.total + " decision" + (rule.total === 1 ? "" : "s")
            + " · " + (rule.outcomes || [])
              .map(o => Math.round(100 * o.count / rule.total) + "% " + o.outcome).join(", "),
        ])} />
      </BriefCard>

      <CardTable
        icon="gavel" title="The decisions" count={rows.length}
        columns={[
          {
            key: "decidedAt", label: "Decided", width: "150px", sort: r => at(r.decidedAt),
            defaultDir: "desc",
            render: r => {
              const when = at(r.decidedAt);
              return when
                ? <span title={when.toLocaleString()}>{fmtRelative(when, now)}</span>
                : "—";
            },
          },
          {
            key: "outcome", label: "Outcome", width: "130px", sort: r => r.outcome,
            render: r => {
              const o = outcomeOf(r.outcome);
              return (
                <span className={"cluster-chip cluster-chip--"
                  + (o.tone === "danger" ? "danger" : o.tone === "ok" ? "ok" : "muted")}
                  title={o.note || r.outcome}>
                  <Icon name={o.icon} size={12} /> {r.outcome}
                </span>
              );
            },
          },
          {
            key: "subject", label: "Subject", width: "minmax(0,1.1fr)", sort: r => r.subject,
            render: r => (
              <>
                {r.subject}
                <span className="leaf-facts__hint" style={SUBLINE}>{r.ruleId}</span>
              </>
            ),
          },
          {
            // The reason is the review. Everything else on the row says WHAT was decided; this is the
            // only column that says why, which is the thing a reviewer is actually disagreeing with.
            key: "reason", label: "Why", width: "minmax(0,2fr)", sort: r => r.reason,
            render: r => (
              <>
                {r.reason}
                <span className="leaf-facts__hint" style={SUBLINE}>
                  would: {r.action} · open {fmtSpan(
                    at(r.decidedAt) && at(r.openedAt) ? at(r.decidedAt) - at(r.openedAt) : null)}
                  {" "}before it was judged
                </span>
              </>
            ),
          },
          {
            // Invariant 1 as a column: a decision is never the only record, and a reviewer who
            // disagrees needs the line it was made from rather than this leaf's word for it.
            key: "source", label: "From", width: "minmax(0,1.2fr)", sort: r => r.source,
            render: r => (
              <span className="svc-fact svc-fact--unit" style={SOURCE}
                title={r.source + (r.eventId ? " · event " + r.eventId : " · the line carried no id")}>
                {r.source}
              </span>
            ),
          },
        ]}
        rows={rows}
        getKey={r => r.source + ":" + r.ruleId + ":" + r.decidedAt}
        defaultSort={{ key: "decidedAt", dir: "desc" }}
        empty="No decisions in this window." />
    </>
  );
}

// The rules that decided nothing. Its own component because it renders both in the ordinary layout and
// on the empty-window path, where it is the only thing worth showing.
function SilentCard({ silent }) {
  return (
    <BriefCard icon="ear-off" title="Decided nothing" count={silent.length} countTone="neutral"
      meta="Enabled, listed everywhere, and silent for the whole window.">
      <div className="chat-brief__list">
        {silent.map(id => (
          <LeafBriefItem key={id} tone="warn" icon="ear-off" title={id}
            detail="Whether its condition never occurred or its waking event never arrived is a
                    question for the population report — guessing between them here would be a
                    fabrication." />
        ))}
      </div>
    </BriefCard>
  );
}

export { ReactorDecisions };
