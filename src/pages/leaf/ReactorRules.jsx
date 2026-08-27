// ReactorRules — the rules this host's reactor runs: what each one asks, what it would do, and the
// editing of them.
//
// ── Two questions, two sources ─────────────────────────────────────────────────────────────────
//
// What is STORED comes from the api, which owns the file. What is RUNNING comes from the leaf, which
// is the authority on what it could honour. They are not the same set: a rule the leaf refuses is in
// the file and in neither of the leaf's lists, so an editor built on the leaf alone would silently
// drop the rule somebody is halfway through fixing. The stored set is what is edited; the leaf's
// `problems` is what says which of it did not take.
//
// ── The vocabulary is the leaf's ───────────────────────────────────────────────────────────────
//
// Signals, operators, outcomes, actions, subject sources and the events a rule may wake on all come
// from `/catalog` and `/triggers`. A list kept here would go on offering a signal after the build
// that measured it was replaced, and refuse one a later build added.
//
// ── Order is the semantics ─────────────────────────────────────────────────────────────────────
//
// A rule is an ordered list of steps and the first whose comparisons all hold decides. Nothing here
// re-sorts them: a surface that ordered them by outcome, or alphabetically, would show a rule that
// behaves differently from the one running.
//
// ── Applying restarts the reactor ──────────────────────────────────────────────────────────────
//
// The leaf reads its rules at startup, so saving is a file write plus a restart, admin-gated,
// through the scoped grant the leaf-config path already uses.

import React from "react";

import { BriefCard } from "../../components/BriefCard.jsx";
import { Icon } from "../../components/Icon.jsx";
import {
  fetchLeafReactorCatalog, fetchLeafReactorRules, fetchLeafReactorStatus,
  fetchLeafReactorTriggers, previewLeafReactorRule, saveLeafReactorRules, servicesStore,
} from "../../lib/stores.js";
import { sessionStore } from "../../lib/sessionStore.js";
import { LeafAbsent, LeafFacts, LeafLoading, LeafNotice, LeafUnreadable, useLeafResource } from "./leafOverviewKit.jsx";
import { RuleEditor, RuleFlow, RulePreviewPanel } from "./reactor/RuleEditor.jsx";
import { blankRule, ID_SHAPE, catalogAction, catalogSource, idFromName, problemsFor, sameRule } from "./reactor/ruleModel.js";

const fmtSeconds = (s) => (s == null ? "—" : s < 60 ? s + "s" : s < 5400 ? Math.round(s / 60) + "m" : (s / 3600).toFixed(1) + "h");
const fmtMinutes = (m) => (m == null ? "—" : m < 90 ? m + "m" : (m / 60).toFixed(1) + "h");

const MODE_LABEL = { off: "Off", observe: "Observe", propose: "Propose", act: "Act" };

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
  const [stored, setStored] = React.useState(null);
  const [draft, setDraft] = React.useState(null);
  const [editing, setEditing] = React.useState(null);
  const [previews, setPreviews] = React.useState({});
  const [busy, setBusy] = React.useState(false);
  const [applied, setApplied] = React.useState(null);
  const [failure, setFailure] = React.useState(null);

  const loadRules = React.useCallback(() => {
    if (!hostId) return;
    fetchLeafReactorRules(hostId).then(
      (res) => setStored(res || { managed: false }),
      () => setStored(null));
  }, [hostId]);

  React.useEffect(() => {
    if (!hostId) return;
    fetchLeafReactorCatalog(hostId).then(setCatalog, () => setCatalog(null));
    fetchLeafReactorTriggers(hostId).then(
      (res) => setTriggers((res && res.triggers) || []), () => setTriggers([]));
    loadRules();
  }, [hostId, loadRules]);

  // The set being edited. A host nobody has edited stores nothing, so the draft starts from what the
  // leaf is running — which is the four rules it ships, and the thing a person expects to see when
  // they open the page and start changing one.
  React.useEffect(() => {
    if (draft !== null || stored === null || state !== "ready") return;
    if (stored.managed && stored.document && Array.isArray(stored.document.rules)) {
      setDraft(stored.document.rules);
      return;
    }
    setDraft(fromStatus(data));
  }, [draft, stored, state, data]);

  if (state === "loading") return <LeafLoading what="Reading the reactor’s rules…" />;
  if (state === "none") return <LeafAbsent leafId={leafId} what="a reactor" />;
  if (state === "error") return <LeafUnreadable what="Reactor rules" error={error} onRetry={reload} />;

  const honours = data.honours || "observe";
  const problems = data.problems || [];
  const liveIds = new Set((data.rules || []).map(r => r.id));
  const rules = draft || [];
  const dirty = !!draft && !!stored && !sameRule(rules, storedRules(stored, data));

  const replace = (index, next) =>
    setDraft(rules.map((r, i) => (i === index ? next : r)));

  const save = () => {
    if (busy || !canEdit) return;
    setBusy(true); setApplied(null); setFailure(null);

    saveLeafReactorRules(hostId, rules).then(
      (res) => {
        setApplied(res);
        setEditing(null);
        loadRules();
        reload();
        // A restart moves the unit through activating; re-read the board so the header's chip and
        // the System tab reflect what actually came back up.
        servicesStore.refresh(hostId).catch(() => {});
      },
      (e) => setFailure((e && (e.userMessage || e.message)) || "The rules could not be saved."),
    ).finally(() => setBusy(false));
  };

  const preview = (index) => {
    const rule = rules[index];
    setPreviews(p => ({ ...p, [rule.id]: { pending: true } }));
    previewLeafReactorRule(hostId, rule).then(
      (res) => setPreviews(p => ({ ...p, [rule.id]: res })),
      (e) => setPreviews(p => ({
        ...p,
        [rule.id]: { problems: [(e && (e.userMessage || e.message)) || "The preview failed."], verdicts: [] },
      })));
  };

  const addRule = () => {
    const rule = blankRule("");
    setDraft([...rules, rule]);
    setEditing(rules.length);
  };

  return (
    <>
      {failure && (
        <LeafNotice title="The rules were not saved" onRetry={() => setFailure(null)} retryLabel="Dismiss">
          {failure}
        </LeafNotice>
      )}

      {applied && (
        <LeafNotice
          title={(applied.problems || []).length
            ? (applied.problems || []).length + " rule(s) could not be honoured"
            : "Saved"}
          onRetry={() => setApplied(null)}
          retryLabel="Dismiss">
          {(applied.problems || []).length
            ? <ul>{applied.problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
            : "Running: " + (applied.live || []).join(", ")}
        </LeafNotice>
      )}

      <BriefCard icon="scale" title="Rules"
        meta={rules.length + " stored · " + liveIds.size + " running"}
        action={canEdit ? (
          <>
            <button type="button" className="lib-btn" onClick={addRule} disabled={busy}>
              <Icon name="plus" size={14} /> Rule
            </button>
            <button type="button" className="lib-btn lib-btn--primary"
              onClick={save} disabled={busy || !dirty}>
              {busy ? "Saving…" : "Save"}
            </button>
          </>
        ) : null}>
        <LeafFacts rows={[
          ["Most this build honours", MODE_LABEL[honours] || honours],
          ["Rules file", stored && stored.path ? stored.path : "—",
            stored && stored.managed
              ? "Written by this panel and read by the leaf at startup."
              : "Nothing is stored here yet, so the leaf runs the rules it ships."],
        ]} />
      </BriefCard>

      {rules.map((rule, i) => (
        <RuleCard key={rule.id || "new-" + i}
          rule={rule}
          catalog={catalog}
          triggers={triggers}
          honours={honours}
          running={liveIds.has(rule.id)}
          problems={problemsFor(problems, rule.id)}
          editing={editing === i}
          canEdit={canEdit && !!catalog}
          busy={busy}
          preview={previews[rule.id]}
          onEdit={() => setEditing(editing === i ? null : i)}
          onChange={(next) => replace(i, next)}
          onRetire={() => replace(i, { ...rule, retired: !rule.retired })}
          onPreview={() => preview(i)} />
      ))}
    </>
  );
}

// The rules the leaf is running, as the file would hold them. What a host with no stored file starts
// editing from — the definitions are already the whole rule, so nothing is invented here.
function fromStatus(status) {
  return [...((status && status.rules) || []), ...((status && status.retired) || [])].map(toDocument);
}

function storedRules(stored, status) {
  return stored && stored.managed && stored.document && Array.isArray(stored.document.rules)
    ? stored.document.rules
    : fromStatus(status);
}

// A rule as `/status` reports it, in the shape the file uses. The two carry the same fields under
// the same names; what differs is that status also reports what was resolved, which a file does not
// hold and must not be written back.
function toDocument(rule) {
  return {
    id: rule.id,
    name: rule.name,
    wakes: rule.wakes || [],
    subjects: { source: rule.subjectSource, args: rule.subjectArgs || {} },
    signals: (rule.signals || []).map(s => ({ alias: s.alias, signal: s.signal, args: s.args || {} })),
    rows: rule.rows || [],
    default: rule.default,
    action: rule.actionName,
    severity: rule.severity,
    settleSeconds: rule.settleSeconds,
    suppressionMinutes: rule.suppressionMinutes ?? null,
    mode: rule.mode,
    retired: !!rule.retired,
  };
}

function RuleCard({
  rule, catalog, triggers, honours, running, problems, editing, canEdit, busy, preview,
  onEdit, onChange, onRetire, onPreview,
}) {
  const source = catalogSource(catalog, rule.subjects && rule.subjects.source);
  const action = catalogAction(catalog, rule.action);
  const idOk = ID_SHAPE.test(rule.id || "");

  return (
    <BriefCard
      icon={rule.retired ? "archive" : rule.mode === "off" ? "circle-off" : "scale"}
      title={rule.name || rule.id || "Untitled rule"}
      count={rule.retired ? "retired" : running ? MODE_LABEL[rule.mode] || rule.mode : "not running"}
      countTone={rule.retired ? "muted" : running ? "neutral" : "warn"}
      meta={rule.id}
      action={canEdit ? (
        <>
          <button type="button" className="lib-btn" onClick={onPreview} disabled={busy || !idOk}>
            <Icon name="play" size={14} /> Preview
          </button>
          <button type="button" className="lib-btn" onClick={onRetire} disabled={busy}>
            {rule.retired ? "Restore" : "Retire"}
          </button>
          <button type="button" className="lib-btn" onClick={onEdit} disabled={busy}>
            {editing ? "Done" : "Edit"}
          </button>
        </>
      ) : null}>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {problems.map((p, i) => (
          <div key={i} className="chat-brief__item chat-brief__item--warn">
            <span className="chat-brief__icon"><Icon name="triangle-alert" size={14} /></span>
            <div className="chat-brief__body">
              <span className="chat-brief__detail">{p}</span>
            </div>
          </div>
        ))}

        {editing && !idOk && (
          <div className="rule-edit__field">
            <label className="rule-edit__label">Id</label>
            <input className="lcf-input" type="text" value={rule.id || ""}
              placeholder={idFromName(rule.name)}
              onChange={(e) => onChange({ ...rule, id: e.target.value })} />
            <span className="rule-edit__hint">Lower case, digits and underscores.</span>
          </div>
        )}

        {editing
          ? <RuleEditor rule={rule} catalog={catalog} triggers={triggers} honours={honours}
              onChange={onChange} />
          : (
            <>
              <LeafFacts rows={[
                ["Wakes on", (rule.wakes || []).length ? rule.wakes.join(", ") : "the sweep"],
                ["Decides about", source ? source.label : (rule.subjects && rule.subjects.source) || "—"],
                ["Would", action ? action.label : rule.action],
                ["Settles for", fmtSeconds(rule.settleSeconds)],
                ["Then stays quiet for", fmtMinutes(rule.suppressionMinutes)],
              ]} />
              {catalog && <RuleFlow rule={rule} catalog={catalog} />}
            </>
          )}

        {preview && (preview.pending
          ? <LeafLoading what="Asking the reactor what this would decide…" />
          : <RulePreviewPanel preview={preview} />)}
      </div>
    </BriefCard>
  );
}

export { ReactorRules };
