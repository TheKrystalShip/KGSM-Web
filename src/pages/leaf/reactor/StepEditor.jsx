// StepEditor.jsx — one step of a rule's ladder, given a screen instead of a row.
//
// Three blocks in the order the sentence runs: what has to be true, what that means, and what gets
// written down. The last is the one that matters most at 2am — the sentence a step records is all
// the context somebody has when they read it in the audit log — so it gets the catalog of every
// token this step can carry, with the value each would render beside it.

import React from "react";

import { Icon } from "../../../components/Icon.jsx";
import { Select } from "../../../components/Select.jsx";
import {
  blankClause, operatorsFor, placeholdersFor, signalOfAlias,
} from "./ruleModel.js";

// The measurements a clause may name, grouped by family so a list of two dozen reads as five short
// ones. The family is the id's first segment, which is how the leaf already namespaces them.
function grouped(rule, catalog) {
  const bound = ((rule && rule.signals) || []).map(b => ({
    alias: b.alias, label: b.alias, family: "What this rule looked up",
  }));

  const bare = ((catalog && catalog.signals) || [])
    .filter(s => !(s.args || []).some(a => a.required))
    .map(s => ({ alias: s.id, label: s.label, family: FAMILY[s.id.split(".")[0]] || s.id.split(".")[0] }));

  const out = new Map();
  for (const item of [...bound, ...bare]) {
    if (!out.has(item.family)) out.set(item.family, []);
    out.get(item.family).push(item);
  }
  return [...out.entries()];
}

// The leaf namespaces its signals; these are the same groups said for a person. A namespace with no
// entry here shows as its own name rather than being hidden, so a signal family this build adds
// still appears.
const FAMILY = {
  subject: "The subject",
  world: "The supervisor",
  footprint: "What has been measured",
  declaration: "What the blueprint declares",
  drift: "The gap between them",
  trend: "How it is moving",
  history: "What has happened before",
  episode: "What is still open",
};

function ConditionRow({ rule, catalog, clause, onChange, onRemove }) {
  const ops = operatorsFor(rule, catalog, clause.signal);
  const op = (catalog.operators || []).find(o => o.id === clause.op);
  const signal = signalOfAlias(rule, catalog, clause.signal);
  const needsValue = op ? op.needsComparand : true;
  const set = (patch) => onChange({ ...clause, ...patch });

  return (
    <div className="rule-edit__clause">
      <Select value={clause.signal}
        onChange={(e) => set({ signal: e.target.value, op: "gt", value: 0, text: null, vsSignal: null })}>
        <option value="">choose a measurement…</option>
        {grouped(rule, catalog).map(([family, items]) => (
          <optgroup key={family} label={family}>
            {items.map(i => <option key={i.alias} value={i.alias}>{i.label}</option>)}
          </optgroup>
        ))}
      </Select>

      <Select value={clause.op} onChange={(e) => set({ op: e.target.value })}>
        {ops.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
      </Select>

      {needsValue ? (
        signal && signal.kind === "text"
          ? <input className="lcf-input" type="text" value={clause.text ?? ""}
              aria-label="Compare against"
              onChange={(e) => set({ text: e.target.value, value: null, vsSignal: null })} />
          : (
            <span className="rule-unit">
              <input className="lcf-input" type="number" value={clause.value ?? ""}
                aria-label="Compare against"
                onChange={(e) => set({
                  value: e.target.value === "" ? null : Number(e.target.value),
                  text: null, vsSignal: null,
                })} />
              {signal && signal.unit && <span>{signal.unit}</span>}
            </span>
          )
      ) : <span className="rule-edit__none">nothing to compare against</span>}

      <button type="button" className="lib-btn rule-icon-btn"
        onClick={onRemove} aria-label="Remove this condition">
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}

/** Every token this step can carry, with what it would render right now. */
function PlaceholderCatalog({ rule, catalog, row, values, onInsert }) {
  const groups = placeholdersFor(rule, catalog, row);
  if (!groups.length) return null;

  return (
    <div className="phcat">
      <div className="phcat__h">
        <span className="phcat__ht">What this step can say</span>
      </div>
      {groups.map(group => (
        <React.Fragment key={group.title}>
          <div className="phgrp">{group.title}<span className="phgrp__d">{group.why}</span></div>
          {group.rows.map(r => (
            <button type="button" key={r.token} className="phrow" onClick={() => onInsert(r.token)}>
              <span className="phrow__t">{r.token}</span>
              <span className="phrow__d">{r.what}</span>
              <span className="phrow__v">
                {values && Object.prototype.hasOwnProperty.call(values, r.token)
                  ? String(values[r.token])
                  : <em>—</em>}
              </span>
            </button>
          ))}
        </React.Fragment>
      ))}
    </div>
  );
}

/** A sentence with its placeholders drawn as the slots they are. */
function Sentence({ text }) {
  const parts = String(text || "").split(/(\{[^}]*\})/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith("{") && part.endsWith("}")
          ? <code key={i} className="rule-tok">{part}</code>
          : <React.Fragment key={i}>{part}</React.Fragment>)}
    </>
  );
}

/** One step, edited. */
function StepEditor({ rule, catalog, row, isDefault, values, onChange, onDone, onRemove }) {
  const [showAll, setShowAll] = React.useState(false);
  const set = (patch) => onChange({ ...row, ...patch });
  const clauses = row.when || [];

  const insert = (token) => set({ say: ((row.say || "") + " " + token).trim() });

  return (
    <div className="rule-step-edit">
      {!isDefault && (
        <div className="rule-blk">
          <div className="rule-blk__t">What has to be true</div>
          <div className="rule-blk__d">
            All of these, together. For an either/or, that is a second step above this one.
          </div>
          {clauses.map((c, i) => (
            <ConditionRow key={i} rule={rule} catalog={catalog} clause={c}
              onChange={(next) => set({ when: clauses.map((x, j) => (j === i ? next : x)) })}
              onRemove={() => set({ when: clauses.filter((_, j) => j !== i) })} />
          ))}
          <button type="button" className="lib-btn" style={{ marginTop: 12 }}
            onClick={() => set({ when: [...clauses, blankClause()] })}>
            <Icon name="plus" size={14} /> Condition
          </button>
        </div>
      )}

      <div className="rule-blk">
        <div className="rule-blk__t">
          {isDefault ? "When nothing above matched, it concludes" : "Then this step concludes"}
        </div>
        <div className="rule-blk__d">Only the first of these is something the rule acts on.</div>
        <div className="rule-outpick" role="radiogroup" aria-label="What this step concludes">
          {(catalog.outcomes || []).map(o => (
            <button type="button" key={o.id} role="radio" aria-checked={row.then === o.id}
              className="rule-outpick__o" onClick={() => set({ then: o.id })}>
              <span className="rule-outpick__t">{o.label}</span>
              <span className="rule-outpick__d">{o.description}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="rule-blk">
        <div className="rule-blk__t">And records</div>
        <div className="rule-blk__d">
          This sentence is what somebody reads in the audit log with no other context.
        </div>
        <input className="lcf-input" type="text" value={row.say || ""}
          aria-label="What this step records"
          onChange={(e) => set({ say: e.target.value })} />
        <div className="rule-reads"><Sentence text={row.say} /></div>

        <button type="button" className="lib-btn" style={{ marginTop: 10 }}
          onClick={() => setShowAll(v => !v)} aria-expanded={showAll}>
          {showAll ? "Hide placeholders" : "All placeholders"}
          <Icon name={showAll ? "chevron-up" : "chevron-down"} size={13} />
        </button>

        {showAll && (
          <PlaceholderCatalog rule={rule} catalog={catalog} row={row} values={values}
            onInsert={insert} />
        )}

        {row.then !== "unreadable" && (
          <div className="rule-edit__field" style={{ marginTop: 14 }}>
            <label className="rule-edit__label">When something it needs cannot be read</label>
            <input className="lcf-input" type="text" value={row.sayWhenUnreadable || ""}
              placeholder="the reader’s own words"
              onChange={(e) => set({ sayWhenUnreadable: e.target.value || null })} />
          </div>
        )}
      </div>

      <div className="rule-step-edit__foot">
        <button type="button" className="lib-btn lib-btn--primary" onClick={onDone}>Done</button>
        {!isDefault && (
          <>
            <span className="rule-spacer" />
            <button type="button" className="lib-btn rule-btn--danger" onClick={onRemove}>
              Delete this step
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export { StepEditor, Sentence, PlaceholderCatalog };
