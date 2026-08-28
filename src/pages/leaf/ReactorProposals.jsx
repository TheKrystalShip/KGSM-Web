// ReactorProposals — what this host is offering to do, and what recently became of its offers.
//
// An offer is a rule that fired in propose mode: it found a condition, described what it would do, and
// did nothing. Answering one is the only place in the panel where a person authorises an action that
// nothing asked them for.
//
// ── It borrows the alert card, and the borrowing is the point ───────────────────────────────────────
//
// An offer has the same shape as an alert — a severity, a title, a sentence, a couple of answers — so
// it renders through `.alert-card` and `alert-btn`, and the confirm arms through the same
// `useConfirmAction` every lifecycle verb in the panel uses. One affordance, drawn once.
//
// ── ⚠ What it does NOT borrow is the mechanism ─────────────────────────────────────────────────────
//
// An alert card's buttons issue an ordinary command; the gate is re-derived at render and that is the
// whole of it. An offer is the opposite: the action is STAGED, and confirming redeems a handle so the
// leaf re-derives the condition first. A server that came back up overnight answers "no longer
// applicable" instead of being restored over — which is what lets an offer wait a shift rather than
// five minutes.
//
// ── The four endings are four different facts ──────────────────────────────────────────────────────
//
// Confirmed, dismissed, lapsed and no-longer-applicable each say something different about the rule
// that staged them, which is why they are four figures rather than answered-and-not.
//
// ── ⚠ A handle is the capability ───────────────────────────────────────────────────────────────────
//
// Anything holding one can ask for the action it names. Nothing here puts one in a link, a title
// attribute or anything else that leaves the page.

import React from "react";

import { AlertSeverityTag } from "../../components/AlertCard.jsx";
import { BriefCard } from "../../components/BriefCard.jsx";
import { CardTable } from "../../components/CardTable.jsx";
import { Icon } from "../../components/Icon.jsx";
import { KPI } from "../../components/KPI.jsx";
import { useConfirmAction } from "../../components/ServerActions.jsx";
import { fmtRelative, parseTs } from "../../lib/formatting.js";
import { answerLeafReactorProposal, fetchLeafReactorProposals } from "../../lib/stores.js";
import {
  LeafAbsent, LeafBriefEmpty, LeafLoading, LeafUnreadable, useLeafResource,
} from "./leafOverviewKit.jsx";

// How an ending reads. The leaf's vocabulary is precise and none of it is guessable from the word:
// "no longer applicable" in particular sounds like a failure and is the safety property working.
//
// The order is the order they are shown in, and it runs from the answer somebody gave to the answer
// nobody did.
//
// Each carries the one line that says what its count MEANS for the rule, because a bare four-way
// split reads as bookkeeping — the point of counting them apart is that a rule whose offers mostly
// lapse and a rule whose offers mostly go stale need different things done to them.
const ENDINGS = [
  {
    id: "confirmed", label: "Confirmed", icon: "circle-check", tone: "ok",
    sub: "somebody said yes",
  },
  {
    id: "dismissed", label: "Dismissed", icon: "circle-slash", tone: "muted",
    sub: "somebody said no",
  },
  {
    id: "lapsed", label: "Lapsed", icon: "clock", tone: "warn",
    sub: "expired unanswered",
  },
  // ⚠ "Stale" rather than the wire's own "no longer applicable", and one word everywhere it is
  // shown. The long form does not fit a summary tile at any width the band uses, and a label that
  // wraps drops its number below its neighbours' — where a label shortened in one place and not the
  // other would leave a reader matching two names to one fact. The sub says what it means.
  {
    id: "no_longer_applicable", label: "Stale", icon: "circle-help", tone: "info",
    sub: "the condition had gone",
  },
];
const ENDING = Object.fromEntries(ENDINGS.map(e => [e.id, e]));
const endingOf = (s) =>
  ENDING[String(s || "").toLowerCase()] || { id: s, label: s || "—", icon: "dot", tone: "muted" };

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

function at(ts) {
  if (!ts) return null;
  const d = parseTs(ts);
  return isNaN(d.getTime()) ? null : d;
}

// How long an offer has left, in the words somebody deciding whether to deal with it now would use.
function fmtLeft(expiresAt, now) {
  const d = at(expiresAt);
  if (!d) return null;
  const ms = d.getTime() - now.getTime();
  if (ms <= 0) return "expired";
  if (ms < MINUTE_MS) return "under a minute left";
  if (ms < HOUR_MS) return Math.round(ms / MINUTE_MS) + "m left";
  return (ms / HOUR_MS).toFixed(1) + "h left";
}

// One open offer, as an alert-shaped row.
//
// ⚠ The arming is not theatre, and it is the panel's own: `useConfirmAction` is what every destructive
// lifecycle verb here uses, so confirming an offer feels like confirming anything else. A single click
// would make authorising a real action indistinguishable from clearing a notification.
function Offer({ offer, busy, onAnswer, now }) {
  const { armed, trigger } = useConfirmAction(() => onAnswer(offer.handle, true));
  const left = fmtLeft(offer.expiresAt, now);
  const severity = offer.severity === "danger" || offer.severity === "warn" ? offer.severity : "info";

  return (
    <div className={"alert-card reactor-offer alert-card--" + severity}>
      <span className="alert-card__icon"><Icon name="hand" size={16} strokeWidth={1.9} /></span>

      <div className="alert-card__body">
        <div className="alert-card__titlerow">
          <span className="alert-card__title">{offer.action}</span>
          <AlertSeverityTag severity={severity} />
        </div>

        {/* The sentence the decision was made with, and the thing a person actually decides on. */}
        <div className="alert-card__detail">{offer.reason}</div>

        {/* The meta strip is already monospace, so the rule id needs no wrapper of its own — and it
            must not take the source chip's, which uppercases. A rule id is a name the person typed
            and reads the same here as in the file, the table and the audit log. */}
        <div className="alert-card__meta">
          <span>{offer.rule}</span>
          {offer.ruleAuthor && <><span>·</span><span>written by {offer.ruleAuthor}</span></>}
          {left && <><span>·</span><span>{left}</span></>}
        </div>
      </div>

      <div className="alert-card__actions">
        <button className={"alert-btn alert-btn--primary" + (armed ? " is-armed" : "")}
          disabled={busy} onClick={trigger}
          title={armed ? "Click again to confirm" : "Authorise this action"}>
          {busy
            ? <><span className="act-spin"></span> Working</>
            : <><Icon name="check" size={13} strokeWidth={armed ? 2.6 : 2.2} /> {armed ? "Confirm?" : "Confirm"}</>}
        </button>
        <button className="alert-btn" disabled={busy} onClick={() => onAnswer(offer.handle, false)}>
          <Icon name="circle-slash" size={13} /> Dismiss
        </button>
      </div>
    </div>
  );
}

// What came of the last answer. The leaf page's own notice strip, the same one the monitor's
// thresholds and the scheduler's windows report a write through.
//
// ⚠ It exists because three of the outcomes are not "it worked", and one of them — no longer
// applicable — is the interesting one: the offer was real, the person authorised it, and the world had
// moved on.
function AnswerNotice({ answer }) {
  const good = answer.outcome === "performed" || answer.outcome === "dismissed";
  const title =
    answer.outcome === "performed" ? "Done"
      : answer.outcome === "dismissed" ? "Dismissed"
        : answer.outcome === "no_longer_applicable" ? "Stale"
          : answer.outcome === "failed" ? "It could not be done"
            : answer.outcome === "unreadable" ? "The condition could not be re-read"
              : answer.outcome === "already_answered" ? "Already answered"
                : answer.outcome === "expired" ? "Expired"
                  : "Not answered";

  return (
    <div className={"thr-notice" + (good ? " thr-notice--ok" : "")} role="status">
      <b>{title}</b>
      {answer.detail ? " — " + answer.detail : ""}
      {answer.proposal && answer.proposal.artifact ? " (" + answer.proposal.artifact + ")" : ""}
    </div>
  );
}

function ReactorProposals({ hostId, leafId }) {
  const { state, data, error, reload } =
    useLeafResource(hostId, leafId, (h) => fetchLeafReactorProposals(h));

  const [busy, setBusy] = React.useState(null);
  const [answer, setAnswer] = React.useState(null);

  // The clock the expiry countdowns are measured against, ticking on its own so an offer's remaining
  // time decays while somebody is reading it rather than freezing at whatever it was when the page
  // loaded.
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const onAnswer = React.useCallback((handle, confirm) => {
    setBusy(handle);
    setAnswer(null);
    answerLeafReactorProposal(hostId, handle, confirm).then(
      (r) => { setBusy(null); setAnswer(r || null); reload(); },
      (e) => {
        setBusy(null);
        // ⚠ Kept as an outcome rather than thrown away, because a failed redemption is not the same as
        // nothing having happened: the leaf claims an offer before it performs. The reload beside it is
        // what says which.
        setAnswer({ outcome: "unreachable", detail: (e && e.message) || "the reactor did not answer" });
        reload();
      },
    );
  }, [hostId, reload]);

  if (state === "loading") return <LeafLoading what="Reading the reactor’s offers…" />;
  if (state === "none") return <LeafAbsent leafId={leafId} what="a reactor" />;
  if (state === "error") return <LeafUnreadable what="Proposals" error={error} onRetry={reload} />;

  const open = Array.isArray(data.open) ? data.open : [];
  const recent = Array.isArray(data.recent) ? data.recent : [];
  const ended = recent.filter(p => p.state && p.state !== "open");
  const observes = String(data.honours || "").toLowerCase() === "observe";
  const days = data.days ?? 7;

  const counts = ended.reduce((acc, p) => {
    const k = String(p.state || "").toLowerCase();
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

  return (
    <>
      {answer && <AnswerNotice answer={answer} />}

      {ended.length > 0 && (
        <div className="dash-summary">
          {ENDINGS.map(e => (
            <KPI key={e.id} icon={e.icon} label={e.label} value={counts[e.id] || 0}
              tone={counts[e.id] ? e.tone : "muted"} sub={e.sub} />
          ))}
        </div>
      )}

      <BriefCard icon="hand" title="Waiting for an answer" count={open.length || null}>
        {open.length === 0 ? (
          <LeafBriefEmpty title="Nothing is being offered">
            {observes
              ? "This build observes and never stages an action."
              : "A rule stages an offer when it fires in propose mode."}
          </LeafBriefEmpty>
        ) : (
          <div className="chat-brief__list">
            {open.map(o => (
              <Offer key={o.handle} offer={o} now={now} busy={busy === o.handle} onAnswer={onAnswer} />
            ))}
          </div>
        )}
      </BriefCard>

      {/* The window is the leaf's, clamped to its own ledger retention, and it is named because the
          figures above are a distribution over exactly this span. */}
      {ended.length > 0 && (
        <CardTable
          icon="scale" title={"Answered · " + days + " days"} count={ended.length}
          getKey={(r) => r.handle}
          columns={[
            {
              key: "state", label: "Ending", width: "13rem",
              render: (r) => {
                const e = endingOf(r.state);
                return (
                  <span className={"pill pill--" + e.tone}>
                    <Icon name={e.icon} size={12} /> {e.label}
                  </span>
                );
              },
            },
            { key: "rule", label: "Rule", width: "1fr", render: (r) => <code>{r.rule}</code> },
            { key: "subject", label: "Subject", width: "1fr", render: (r) => r.subject },
            {
              // "Action" rather than "Would have": three of the four endings did nothing and one of
              // them did, and a header assuming either would be wrong on most rows.
              key: "action", label: "Action", width: "1.4fr",
              render: (r) => (
                <>
                  <span className="reactor-cell">{r.action}</span>
                  {r.detail && <span className="reactor-cell reactor-cell--sub">{r.detail}</span>}
                </>
              ),
            },
            {
              // ⚠ Blank rather than "—" for a lapse: nobody answered, which is the whole content of
              // that ending, and a dash reads as a value that could not be read.
              key: "answeredBy", label: "Answered by", width: "12rem",
              render: (r) => (r.answeredBy || ""),
            },
            {
              key: "answeredAt", label: "When", width: "9rem",
              render: (r) => (at(r.answeredAt) ? fmtRelative(at(r.answeredAt), now) : ""),
              sort: (r) => (at(r.answeredAt) ? at(r.answeredAt).getTime() : 0),
              defaultDir: "desc",
            },
          ]}
          rows={ended}
          defaultSort={{ key: "answeredAt", dir: "desc" }}
        />
      )}
    </>
  );
}

export { ReactorProposals };
