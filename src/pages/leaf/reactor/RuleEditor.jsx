// RuleEditor.jsx — a rule as an ordered list of steps, read and written.
//
// The first step whose clauses all hold decides, so the steps are drawn as a sequence down a rail
// and reordering them is a drag. ORDER IS THE SEMANTICS: swapping two steps changes what the rule
// concludes, which is why nothing here ever re-sorts them.
//
// Every vocabulary on screen — signals, operators, outcomes, actions, subject sources, triggers —
// comes from the leaf. This file holds none of it.

import React from "react";

import { Icon } from "../../../components/Icon.jsx";
import { Select } from "../../../components/Select.jsx";
import {
  aliasesFor, blankClause, blankRow, catalogOutcome, catalogSignal, catalogSource,
  clauseParts, operatorsFor, signalOfAlias,
} from "./ruleModel.js";

// A step's sentence, with its placeholders shown as the slots they are. The figures are filled in
// when the rule runs, so an editor that rendered the template raw would show `{footprint.spanDays}`
// as prose and one that hid the braces would suggest the words are fixed.
function Sentence({ text }) {
  const parts = String(text || "").split(/(\{[^}]*\})/g);
  return (
    <span className="rule-step__say">
      {parts.map((part, i) =>
        part.startsWith("{") && part.endsWith("}")
          ? <code key={i}>{part}</code>
          : <React.Fragment key={i}>{part}</React.Fragment>)}
    </span>
  );
}

function ClauseChip({ rule, catalog, clause }) {
  const parts = clauseParts(rule, catalog, clause);
  return (
    <span className="rule-clause" title={parts.known ? undefined : "This build does not measure that."}>
      <span className="rule-clause__signal">{parts.signal}</span>
      <span className="rule-clause__op">{parts.op}</span>
      {parts.value != null && <span className="rule-clause__value">{parts.value}</span>}
      {parts.unit && <span className="rule-clause__unit">{parts.unit}</span>}
    </span>
  );
}

function Step({ rule, catalog, row, isDefault }) {
  const outcome = catalogOutcome(catalog, row.then);
  const clauses = row.when || [];

  return (
    <div className={"rule-step rule-step--" + row.then + (isDefault ? " rule-step--default" : "")}>
      <div className="rule-step__head">
        {isDefault || clauses.length === 0
          ? <span className="rule-clauses__and">otherwise</span>
          : (
            <span className="rule-clauses">
              {clauses.map((c, i) => (
                <React.Fragment key={i}>
                  {i > 0 && <span className="rule-clauses__and">and</span>}
                  <ClauseChip rule={rule} catalog={catalog} clause={c} />
                </React.Fragment>
              ))}
            </span>
          )}
        <span className={"rule-step__outcome rule-step__outcome--" + row.then}>
          {outcome ? outcome.label : row.then}
        </span>
      </div>
      <Sentence text={row.say} />
    </div>
  );
}

/** A rule as it reads: its steps in evaluation order, the last one concluding when none matched. */
function RuleFlow({ rule, catalog }) {
  return (
    <div className="rule-flow">
      {(rule.rows || []).map((row, i) => (
        <Step key={i} rule={rule} catalog={catalog} row={row} />
      ))}
      <Step rule={rule} catalog={catalog} row={rule.default || { then: "doesNotHold", say: "" }} isDefault />
    </div>
  );
}

// ---- editing ----

function ClauseRow({ rule, catalog, clause, onChange, onRemove }) {
  const aliases = aliasesFor(rule, catalog);
  const ops = operatorsFor(rule, catalog, clause.signal);
  const op = (catalog.operators || []).find(o => o.id === clause.op);
  const signal = signalOfAlias(rule, catalog, clause.signal);
  const needsValue = op ? op.needsComparand : true;

  const set = (patch) => onChange({ ...clause, ...patch });

  return (
    <div className="rule-edit__clause">
      <Select value={clause.signal} onChange={(e) => set({ signal: e.target.value, op: "gt" })}>
        <option value="">choose a measurement…</option>
        {aliases.map(a => {
          const s = catalogSignal(catalog, a.signalId);
          return (
            <option key={a.alias} value={a.alias}>
              {s ? s.label : a.alias}{a.bound ? " (" + a.alias + ")" : ""}
            </option>
          );
        })}
      </Select>

      <Select value={clause.op} onChange={(e) => set({ op: e.target.value })}>
        {ops.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
      </Select>

      {needsValue ? (
        signal && signal.kind === "text"
          ? <input className="lcf-input" type="text" value={clause.text ?? ""}
              onChange={(e) => set({ text: e.target.value, value: null, vsSignal: null })} />
          : <input className="lcf-input" type="number" value={clause.value ?? ""}
              onChange={(e) => set({
                value: e.target.value === "" ? null : Number(e.target.value),
                text: null, vsSignal: null,
              })} />
      ) : <span />}

      <button type="button" className="lib-btn rule-icon-btn"
        onClick={onRemove} aria-label="Remove this comparison">
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}

function StepEditor({ rule, catalog, row, index, count, onChange, onRemove, onMove, isDefault }) {
  const set = (patch) => onChange({ ...row, ...patch });
  const clauses = row.when || [];

  return (
    <div className={"rule-step rule-step--" + row.then + (isDefault ? " rule-step--default" : "")}>
      <div className="rule-step__head">
        <Select value={row.then} onChange={(e) => set({ then: e.target.value })}>
          {(catalog.outcomes || []).map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
        </Select>

        {!isDefault && (
          <div className="rule-edit__row-tools">
            <button type="button" className="lib-btn rule-icon-btn"
              disabled={index === 0} onClick={() => onMove(index - 1)} aria-label="Move this step earlier">
              <Icon name="chevron-up" size={14} />
            </button>
            <button type="button" className="lib-btn rule-icon-btn"
              disabled={index === count - 1} onClick={() => onMove(index + 1)} aria-label="Move this step later">
              <Icon name="chevron-down" size={14} />
            </button>
            <button type="button" className="lib-btn rule-icon-btn"
              onClick={onRemove} aria-label="Remove this step">
              <Icon name="trash-2" size={14} />
            </button>
          </div>
        )}
      </div>

      {!isDefault && (
        <>
          {clauses.map((c, i) => (
            <ClauseRow key={i} rule={rule} catalog={catalog} clause={c}
              onChange={(next) => set({ when: clauses.map((x, j) => (j === i ? next : x)) })}
              onRemove={() => set({ when: clauses.filter((_, j) => j !== i) })} />
          ))}
          <button type="button" className="lib-btn"
            onClick={() => set({ when: [...clauses, blankClause()] })}>
            <Icon name="plus" size={14} /> Comparison
          </button>
        </>
      )}

      <div className="rule-edit__field">
        <label className="rule-edit__label">What it records</label>
        <input className="lcf-input" type="text" value={row.say || ""}
          onChange={(e) => set({ say: e.target.value })} />
      </div>

      {row.then !== "unreadable" && (
        <div className="rule-edit__field">
          <label className="rule-edit__label">When something it needs can’t be read</label>
          <input className="lcf-input" type="text" value={row.sayWhenUnreadable || ""}
            placeholder="the reader’s own words"
            onChange={(e) => set({ sayWhenUnreadable: e.target.value || null })} />
        </div>
      )}
    </div>
  );
}

/** The whole rule, editable. Every option offered comes from the leaf's catalog. */
function RuleEditor({ rule, catalog, triggers, honours, onChange }) {
  const set = (patch) => onChange({ ...rule, ...patch });
  const rows = rule.rows || [];
  const source = catalogSource(catalog, rule.subjects && rule.subjects.source);
  const action = (catalog.actions || []).find(a => a.id === rule.action);

  const move = (from, to) => {
    if (to < 0 || to >= rows.length) return;
    const next = rows.slice();
    const [held] = next.splice(from, 1);
    next.splice(to, 0, held);
    set({ rows: next });
  };

  const toggleWake = (type) => {
    const held = rule.wakes || [];
    set({ wakes: held.includes(type) ? held.filter(t => t !== type) : [...held, type] });
  };

  return (
    <div className="rule-edit">
      <div className="rule-edit__grid">
        <div className="rule-edit__field">
          <label className="rule-edit__label">Name</label>
          <input className="lcf-input" type="text" value={rule.name || ""}
            onChange={(e) => set({ name: e.target.value })} />
        </div>

        <div className="rule-edit__field">
          <label className="rule-edit__label">Authority</label>
          <Select value={rule.mode} onChange={(e) => set({ mode: e.target.value })}>
            <option value="off">Off</option>
            <option value="observe">Observe</option>
            <option value="propose" disabled={honours === "observe"}>Propose</option>
            <option value="act" disabled={honours !== "act"}>Act</option>
          </Select>
        </div>

        <div className="rule-edit__field">
          <label className="rule-edit__label">Decides about</label>
          <Select value={(rule.subjects && rule.subjects.source) || "from_event"}
            onChange={(e) => set({ subjects: { source: e.target.value, args: {} } })}>
            {(catalog.subjectSources || []).map(s => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </Select>
          {source && <span className="rule-edit__hint">{source.description}</span>}
        </div>

        <div className="rule-edit__field">
          <label className="rule-edit__label">Would</label>
          <Select value={rule.action} onChange={(e) => set({ action: e.target.value })}>
            {(catalog.actions || []).map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
          </Select>
          {action && <span className="rule-edit__hint">{action.description}</span>}
        </div>

        <div className="rule-edit__field">
          <label className="rule-edit__label">Settles for (seconds)</label>
          <input className="lcf-input" type="number" min="1" value={rule.settleSeconds || 0}
            onChange={(e) => set({ settleSeconds: Number(e.target.value) })} />
        </div>

        <div className="rule-edit__field">
          <label className="rule-edit__label">Then quiet for (minutes)</label>
          <input className="lcf-input" type="number" min="0" value={rule.suppressionMinutes ?? ""}
            placeholder="the host-wide window"
            onChange={(e) => set({
              suppressionMinutes: e.target.value === "" ? null : Number(e.target.value),
            })} />
        </div>
      </div>

      {source && source.fromEvent && (
        <div className="rule-edit__field">
          <label className="rule-edit__label">Wakes on</label>
          <div className="rule-clauses">
            {(rule.wakes || []).map(t => (
              <button key={t} type="button" className="rule-clause" onClick={() => toggleWake(t)}>
                <span className="rule-clause__signal">{t}</span>
                <Icon name="x" size={12} />
              </button>
            ))}
          </div>
          <Select value="" onChange={(e) => e.target.value && toggleWake(e.target.value)}>
            <option value="">add an event…</option>
            {(triggers || [])
              .filter(t => !(rule.wakes || []).includes(t.type))
              .map(t => (
                <option key={t.producer + "/" + t.type} value={t.type}>
                  {t.type} — {t.producer}, {t.perWeek}/week
                </option>
              ))}
          </Select>
        </div>
      )}

      <div className="rule-flow">
        {rows.map((row, i) => (
          <StepEditor key={i} rule={rule} catalog={catalog} row={row} index={i} count={rows.length}
            onChange={(next) => set({ rows: rows.map((x, j) => (j === i ? next : x)) })}
            onRemove={() => set({ rows: rows.filter((_, j) => j !== i) })}
            onMove={(to) => move(i, to)} />
        ))}

        <button type="button" className="lib-btn"
          onClick={() => set({ rows: [...rows, blankRow()] })}>
          <Icon name="plus" size={14} /> Step
        </button>

        <StepEditor rule={rule} catalog={catalog} isDefault index={0} count={1}
          row={rule.default || { when: [], then: "doesNotHold", say: "" }}
          onChange={(next) => set({ default: next })}
          onRemove={() => {}} onMove={() => {}} />
      </div>
    </div>
  );
}

/** What the leaf said a proposed rule would decide, subject by subject. */
function RulePreviewPanel({ preview }) {
  if (!preview) return null;

  return (
    <div className="rule-preview">
      {(preview.problems || []).map((p, i) => (
        <div key={"p" + i} className="rule-preview__verdict">
          <span className="rule-preview__subject">refused</span>
          <span className="rule-preview__reason">{p}</span>
        </div>
      ))}

      {(preview.verdicts || []).map((v, i) => (
        <div key={i} className="rule-preview__verdict">
          <span className="rule-preview__subject">{v.subject}</span>
          <span className="rule-preview__reason">
            <span className={"rule-step__outcome rule-step__outcome--" + v.outcome}>{v.outcome}</span>
            {" "}{v.reason}
          </span>
        </div>
      ))}

      {preview.notEvaluated > 0 && (
        <div className="rule-preview__verdict">
          <span className="rule-preview__subject">not evaluated</span>
          <span className="rule-preview__reason">{preview.notEvaluated} more</span>
        </div>
      )}
    </div>
  );
}

export { RuleFlow, RuleEditor, RulePreviewPanel };
