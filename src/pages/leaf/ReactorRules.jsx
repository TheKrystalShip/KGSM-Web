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
        count={(data.rules || []).length + " running"}
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
                <span>Rule</span>
                <span className="rule-list__hide">Wakes on</span>
                <span className="rule-list__hide">Would</span>
                <span>Authority</span>
              </div>
              {all.map(rule => {
                const action = catalogAction(catalog, rule.actionName);
                return (
                  <button type="button" key={rule.id} className="rule-row"
                    onClick={() => setOpened(rule.id)}>
                    <span>
                      <span className="rule-row__n">{rule.name || rule.id}</span>
                      <span className="rule-row__id">{rule.id}</span>
                    </span>
                    <span className="rule-row__c rule-list__hide">{wakesWords(rule)}</span>
                    <span className="rule-row__c rule-list__hide">
                      {action ? action.label : rule.actionName}
                    </span>
                    <span>
                      <span className={"rule-pill" + (rule.retired ? " rule-pill--muted" : "")}>
                        {rule.retired ? "Retired" : MODE_LABEL[rule.mode] || rule.mode}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
      </BriefCard>
    </>
  );
}

/** A rule read back as the six questions it answers, each with a way in. */
function RuleHome({ rule, catalog, canEdit, busy, problems, onBack, onEdit, onRetire, onRemove }) {
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

  return (
    <BriefCard icon="scale" title={rule.name || rule.id}
      count={rule.retired ? "Retired" : MODE_LABEL[rule.mode] || rule.mode}
      countTone={rule.retired ? "muted" : "neutral"}
      meta={rule.id}
      action={(
        <>
          <button type="button" className="lib-btn" onClick={onBack}>Back</button>
          {canEdit && (
            <>
              <button type="button" className="lib-btn" onClick={onRetire} disabled={busy}>
                {rule.retired ? "Restore" : "Retire"}
              </button>
              <button type="button" className="lib-btn lib-btn--primary" onClick={onEdit} disabled={busy}>
                Edit
              </button>
            </>
          )}
        </>
      )}>

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
