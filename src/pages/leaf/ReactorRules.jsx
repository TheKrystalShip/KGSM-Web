// ReactorRules — the rules this host's reactor runs: a list, a rule's own page, and the interview
// that writes one.
//
// ── Three screens, one vocabulary ───────────────────────────────────────────────────────────────
//
// The LIST answers what can be asked from outside a rule: what wakes it, what it would do, and
// whether it is allowed to. A rule's HOME reads it back as six sentences, each with an Edit that
// opens exactly that stop. The INTERVIEW runs start to finish only for a rule that does not exist
// yet. The six questions are the same in all three and in the same order, which is what lets one
// surface teach the next.
//
// ── The leaf is the authority, and the only writer ─────────────────────────────────────────────
//
// Rules live in the leaf's own directory, one file each. Saving sends the rule to the leaf, which
// validates it against what this build can honour and keeps it only if it passes — so a refusal
// arrives while the person is still looking at what they wrote, and nothing restarts.
//
// ── The vocabulary is the leaf's ───────────────────────────────────────────────────────────────
//
// Signals, operators, outcomes, actions, subject sources and the events a rule may wake on all come
// from `/catalog` and `/triggers`. A list kept here would go on offering a signal after the build
// that measured it was replaced, and refuse one a later build added.

import React from "react";

import { BriefCard } from "../../components/BriefCard.jsx";
import { Icon } from "../../components/Icon.jsx";
import { Toggle } from "../../components/settings-primitives.jsx";
import {
  deleteLeafReactorRule, fetchLeafReactorCatalog, fetchLeafReactorStatus, fetchLeafReactorTriggers,
  previewLeafReactorRule, saveLeafReactorRule,
} from "../../lib/stores.js";
import { sessionStore } from "../../lib/sessionStore.js";
import { LeafAbsent, LeafLoading, LeafNotice, LeafUnreadable, useLeafResource } from "./leafOverviewKit.jsx";
import { RuleInterview, fmtMinutes, fmtSeconds } from "./reactor/RuleInterview.jsx";
import { Sentence } from "./reactor/StepEditor.jsx";
import {
  blankRule, catalogAction, catalogOutcome, catalogSource, problemsFor, toDocument,
} from "./reactor/ruleModel.js";

const MODE_LABEL = { off: "Off", observe: "Observe", propose: "Propose", act: "Act" };

// What a switched-off rule would go back to doing, as the end of "It would ___ when it is switched
// back on." The same words the interview offers when the authority is chosen, so the sentence a
// person read there is the one they are shown here.
//
// Read from `configuredMode`, never from `mode`: the latter reports what the leaf will actually do,
// which for a rule that is off is nothing at all. Reading only that would offer to switch a rule on
// without being able to say what it would then be allowed to do.
const RESUMES_AS = {
  observe: "record what it concludes, and do nothing",
  propose: "put an offer in the panel and wait for a person",
  act: "act without asking, and record that it did",
};

// The pill a rule wears in the list and on its own page. Retired outranks the switch: a rule kept
// only so its old decisions still resolve is not a rule that is merely paused.
function ruleStanding(rule) {
  if (rule.retired) return { text: "Retired", muted: true };
  if (rule.enabled === false) return { text: "Off", muted: true };
  return { text: MODE_LABEL[rule.mode] || rule.mode, muted: false };
}

// What wakes a rule, in words. The ids are only useful once you are inside one.
function wakesWords(rule) {
  const wakes = rule.wakes || [];
  if (!wakes.length) return "every sweep";
  if (wakes.length === 1) return wakes[0];
  return wakes.length + " kinds of event";
}

function ReactorRules({ hostId, leafId }) {
  // The leaf page's gate is the aggregate one — admin anywhere reaches it — so the tier that decides
  // whether these are editable is the one held on THIS node. Reading is operator; changing what a
  // daemon is permitted to do to your servers is admin.
  const live = !!hostId && sessionStore.isLive(hostId);
  const canEdit = live && sessionStore.tierOf(hostId) === "admin";

  const { state, data, error, reload } =
    useLeafResource(hostId, leafId, (h) => fetchLeafReactorStatus(h));

  const [catalog, setCatalog] = React.useState(null);
  const [triggers, setTriggers] = React.useState([]);
  const [draft, setDraft] = React.useState(null);
  const [opened, setOpened] = React.useState(null);
  const [preview, setPreview] = React.useState(null);
  const [problems, setProblems] = React.useState([]);
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState(null);

  React.useEffect(() => {
    if (!hostId) return;
    fetchLeafReactorCatalog(hostId).then(setCatalog, () => setCatalog(null));
    fetchLeafReactorTriggers(hostId).then(
      (res) => setTriggers((res && res.triggers) || []), () => setTriggers([]));
  }, [hostId]);

  if (state === "loading") return <LeafLoading what="Reading the reactor’s rules…" />;
  if (state === "none") return <LeafAbsent leafId={leafId} what="a reactor" />;
  if (state === "error") return <LeafUnreadable what="Reactor rules" error={error} onRetry={reload} />;

  const honours = data.honours || "observe";
  const all = [...(data.rules || []), ...(data.retired || [])];
  const leafProblems = data.problems || [];

  const save = (rule) => {
    if (busy || !canEdit) return;
    setBusy(true); setProblems([]);

    saveLeafReactorRule(hostId, rule).then(
      () => {
        setDraft(null);
        setOpened(null);
        setNotice({ ok: true, text: rule.name + " is running." });
        reload();
      },
      (e) => {
        const found = (e && e.body && e.body.problems) || [];
        setProblems(found.length
          ? found
          : [(e && (e.userMessage || e.message)) || "The rule could not be saved."]);
      },
    ).finally(() => setBusy(false));
  };

  // Switching a rule on or off writes the whole rule back through the same path an edit takes. There
  // is no shortcut endpoint on purpose: the leaf validates what it is given, so a rule cannot be
  // switched on into a state that build would refuse, and the change is audited like any other.
  //
  // Unlike an edit it leaves the screen where it is — a switch is not a departure — and it sends the
  // CONFIGURED authority back untouched, which is what lets a paused rule resume as what it was.
  const setEnabled = (rule, on) => {
    if (busy || !canEdit) return;
    setBusy(true);

    saveLeafReactorRule(hostId, { ...toDocument(rule), enabled: on }).then(
      () => {
        setNotice({
          ok: true,
          text: on
            ? (rule.name || rule.id) + " is running again."
            : (rule.name || rule.id) + " is switched off. Nothing is judged by it until it is on.",
        });
        reload();
      },
      (e) => {
        const found = (e && e.body && e.body.problems) || [];
        setNotice({
          ok: false,
          text: found.length
            ? found.join(" ")
            : (e && (e.userMessage || e.message)) || "The rule could not be changed.",
        });
      },
    ).finally(() => setBusy(false));
  };

  const remove = (ruleId) => {
    if (busy || !canEdit) return;
    setBusy(true);
    deleteLeafReactorRule(hostId, ruleId).then(
      () => { setOpened(null); setNotice({ ok: true, text: ruleId + " is gone." }); reload(); },
      (e) => setNotice({ ok: false, text: (e && (e.userMessage || e.message)) || "It could not be removed." }),
    ).finally(() => setBusy(false));
  };

  const runPreview = (rule) => {
    setPreview({ pending: true });
    previewLeafReactorRule(hostId, rule).then(
      (res) => setPreview(res),
      (e) => setPreview({
        problems: [(e && (e.userMessage || e.message)) || "The preview failed."], verdicts: [],
      }));
  };

  // ---- the interview, for a new rule or a stop of an existing one ----
  if (draft) {
    return (
      <BriefCard icon="scale" title={draft.locked ? "Editing " + draft.id : "A new rule"}>
        <RuleInterview
          rule={draft} catalog={catalog || {}} triggers={triggers} honours={honours}
          preview={preview} busy={busy} problems={problems}
          onChange={setDraft}
          onPreview={() => runPreview(draft)}
          onSave={() => save(draft)}
          onCancel={() => { setDraft(null); setProblems([]); setPreview(null); }} />
      </BriefCard>
    );
  }

  // ---- one rule's home ----
  if (opened) {
    const rule = all.find(r => r.id === opened);
    if (!rule) { setOpened(null); return null; }
    return (
      <RuleHome
        rule={rule} catalog={catalog} canEdit={canEdit} busy={busy}
        problems={problemsFor(leafProblems, rule.id)}
        onBack={() => setOpened(null)}
        onEdit={() => setDraft({ ...toDocument(rule), locked: true })}
        onEnabled={(on) => setEnabled(rule, on)}
        onRetire={() => save({ ...toDocument(rule), retired: !rule.retired })}
        onRemove={() => remove(rule.id)} />
    );
  }

  // ---- the list ----
  return (
    <>
      {notice && (
        <LeafNotice title={notice.ok ? "Saved" : "Not saved"}
          onRetry={() => setNotice(null)} retryLabel="Dismiss">
          {notice.text}
        </LeafNotice>
      )}

      {leafProblems.length > 0 && (
        <LeafNotice title={leafProblems.length + " rule(s) could not be honoured"}
          onRetry={reload} retryLabel="Re-read">
          <ul>{leafProblems.map((p, i) => <li key={i}>{p}</li>)}</ul>
        </LeafNotice>
      )}

      <BriefCard icon="scale" title="Rules"
        count={(data.rules || []).filter(r => r.enabled !== false).length + " running"}
        countTone="neutral"
        meta={"This build honours up to " + (MODE_LABEL[honours] || honours)}
        action={canEdit ? (
          <button type="button" className="lib-btn lib-btn--primary"
            onClick={() => setDraft(blankRule(""))} disabled={busy || !catalog}>
            <Icon name="plus" size={14} /> New rule
          </button>
        ) : null}>

        {all.length === 0
          ? <div className="chat-brief__empty">This host judges nothing.</div>
          : (
            <div className="rule-list">
              <div className="rule-list__h">
                <span className="rule-row__cells">
                  <span>Rule</span>
                  <span className="rule-list__hide">Wakes on</span>
                  <span className="rule-list__hide">Would</span>
                </span>
                <span className="rule-row__end">
                  <span>Authority</span>
                  <span>On</span>
                </span>
              </div>
              {all.map(rule => {
                const action = catalogAction(catalog, rule.actionName);
                const standing = ruleStanding(rule);
                return (
                  // A row, not a button: the switch lives in it, and an interactive control inside a
                  // button is neither valid nor reachable by keyboard. Opening the rule is its own
                  // button spanning the columns that describe it.
                  <div key={rule.id} className="rule-row">
                    <button type="button" className="rule-row__cells rule-row__open"
                      onClick={() => setOpened(rule.id)}>
                      <span>
                        <span className="rule-row__n">{rule.name || rule.id}</span>
                        <span className="rule-row__id">{rule.id}</span>
                      </span>
                      <span className="rule-row__c rule-list__hide">{wakesWords(rule)}</span>
                      <span className="rule-row__c rule-list__hide">
                        {action ? action.label : rule.actionName}
                      </span>
                    </button>
                    <span className="rule-row__end">
                      <span className={"rule-pill" + (standing.muted ? " rule-pill--muted" : "")}>
                        {standing.text}
                      </span>
                      {/* A retired rule has no switch: it is kept for the record, and restoring it is
                          a different decision made on its own page. */}
                      {canEdit && !rule.retired ? (
                        <Toggle on={rule.enabled !== false} disabled={busy}
                          onChange={(on) => setEnabled(rule, on)}
                          label={(rule.enabled !== false ? "Switch off " : "Switch on ") + rule.id} />
                      ) : <span />}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
      </BriefCard>
    </>
  );
}

/** A rule read back as the six questions it answers, each with a way in. */
function RuleHome({ rule, catalog, canEdit, busy, problems, onBack, onEdit, onEnabled, onRetire, onRemove }) {
  const source = catalogSource(catalog, rule.subjectSource);
  const action = catalogAction(catalog, rule.actionName);
  const rows = rule.rows || [];

  const answers = [
    ["It wakes when", (rule.wakes || []).length
      ? (rule.wakes || []).join(" or ")
      : "every sweep comes round", null],
    ["and judges", source ? source.label : rule.subjectSource, source ? source.description : null],
    ["looking up", (rule.signals || []).length
      ? (rule.signals || []).map(s => s.alias).join(", ")
      : "nothing beyond what it can already read", null],
    ["and would", action ? action.label : rule.actionName, action ? action.consequence : null],
    ["after waiting", fmtSeconds(rule.settleSeconds) + ", then staying quiet for "
      + fmtMinutes(rule.suppressionMinutes), "Filed as " + rule.severity + "."],
  ];

  const standing = ruleStanding(rule);
  const off = !rule.retired && rule.enabled === false;

  return (
    <BriefCard icon="scale" title={rule.name || rule.id}
      className="rule-card"
      count={standing.text}
      countTone={standing.muted ? "muted" : "neutral"}
      meta={rule.id}
      action={(
        <span className="rule-acts">
          <button type="button" className="lib-btn" onClick={onBack}>Back</button>
          {canEdit && (
            <>
              {!rule.retired && (
                <span className="rule-switch">
                  <span className="rule-switch__l">Running</span>
                  <Toggle on={!off} disabled={busy} onChange={onEnabled}
                    label={off ? "Switch on " + rule.id : "Switch off " + rule.id} />
                </span>
              )}
              <button type="button" className="lib-btn" onClick={onRetire} disabled={busy}>
                {rule.retired ? "Restore" : "Retire"}
              </button>
              <button type="button" className="lib-btn lib-btn--primary" onClick={onEdit} disabled={busy}>
                Edit
              </button>
            </>
          )}
        </span>
      )}>

      {/* Said here rather than left to the pill, because this is the screen somebody is on when they
          decide whether to switch it back on, and "Off" alone does not say what that would start. */}
      {off && (
        <div className="rule-paused">
          Switched off, so nothing is judged by it. It would
          {" " + (RESUMES_AS[rule.configuredMode] || RESUMES_AS.observe) + " "}
          when it is switched back on.
        </div>
      )}

      {problems.map((p, i) => (
        <div key={i} className="rule-problems__row">
          <Icon name="triangle-alert" size={14} /> <span>{p}</span>
        </div>
      ))}

      <div className="rule-home">
        {answers.map(([q, a, sub]) => (
          <div className="rule-ans" key={q}>
            <div className="rule-ans__q">{q}</div>
            <div className="rule-ans__a">
              {a}
              {sub && <span className="rule-ans__sub">{sub}</span>}
            </div>
            {canEdit && (
              <button type="button" className="lib-btn rule-ans__e" onClick={onEdit}>Edit</button>
            )}
          </div>
        ))}

        <div className="rule-ans">
          <div className="rule-ans__q">deciding</div>
          <div className="rule-ans__a">
            {rows.length
              ? "in " + (rows.length + 1) + " steps, first match wins"
              : "on one fallback alone"}
            <div className="rule-steps rule-steps--read">
              {rows.map((row, i) => (
                <div className="rule-line rule-line--read" key={i}>
                  <span className="rule-line__n">{i + 1}</span>
                  <span className="rule-line__say"><Sentence text={row.say} /></span>
                  <span className={"rule-pill rule-pill--" + row.then}>
                    {(catalogOutcome(catalog, row.then) || {}).label || row.then}
                  </span>
                </div>
              ))}
              <div className="rule-line rule-line--read rule-line--floor">
                <span className="rule-line__n" />
                <span className="rule-line__say">
                  <span className="rule-line__otherwise">Anything else — </span>
                  <Sentence text={(rule.default || {}).say} />
                </span>
                <span className={"rule-pill rule-pill--" + ((rule.default || {}).then || "doesNotHold")}>
                  {(catalogOutcome(catalog, (rule.default || {}).then) || {}).label || "No"}
                </span>
              </div>
            </div>
          </div>
          {canEdit && (
            <button type="button" className="lib-btn rule-ans__e" onClick={onEdit}>Edit</button>
          )}
        </div>
      </div>

      {canEdit && (
        <div className="rule-home__foot">
          <button type="button" className="lib-btn rule-btn--danger" onClick={onRemove} disabled={busy}>
            Delete this rule
          </button>
          <span className="rule-edit__hint">
            Retiring keeps it nameable on the decisions it already made. Deleting does not.
          </span>
        </div>
      )}
    </BriefCard>
  );
}

export { ReactorRules };
