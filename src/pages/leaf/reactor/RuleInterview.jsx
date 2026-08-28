// RuleInterview.jsx — a rule as six questions and a save, one on screen at a time.
//
// The rail carries the ANSWERS rather than its own labels: once a stop has been answered it stops
// asking and starts reporting, so the sidebar becomes the rule as a summary while it is written.
//
// Every stop is reachable from the start. Locked-until-answered protects nobody here — the leaf
// refuses a rule it cannot honour and says why — and it walks a person who already knows the model
// through a sequence they do not need.
//
// Every vocabulary on screen comes from the leaf's catalog. This file holds none of it.

import React from "react";

import { Icon } from "../../../components/Icon.jsx";
import { Select } from "../../../components/Select.jsx";
import { StepEditor, Sentence } from "./StepEditor.jsx";
import {
  bindableSignals, blankRow, catalogAction, catalogOutcome, catalogSignal, catalogSource, ID_SHAPE,
  idFromName,
} from "./ruleModel.js";

const STOPS = [
  { n: 1, q: "When does it wake?",
    sub: "Nothing is judged until something asks it to. Name the events, or have it look on a cadence." },
  { n: 2, q: "What does it judge?",
    sub: "A rule reaches a verdict about one thing at a time. This decides what that thing is." },
  { n: 3, q: "What must it know?",
    sub: "Anything a step compares against that the reactor cannot see in front of it." },
  { n: 4, q: "How does it decide?",
    sub: "Steps are taken in order and the first that fits decides. The fallback catches everything else." },
  { n: 5, q: "What would it do?",
    sub: "Only the first leaves the host untouched. The other two say what they cost." },
  { n: 6, q: "How loud is it?",
    sub: "How far it may go on its own, how long it waits, and how long it stays quiet afterwards." },
  { n: 7, q: "Name it and save", sub: "" },
];

const fmtSeconds = (s) => (s == null ? "—" : s < 60 ? s + "s" : s < 5400 ? Math.round(s / 60) + "m" : (s / 3600).toFixed(1) + "h");
const fmtMinutes = (m) => (m == null ? "the host-wide window" : m < 90 ? m + "m" : (m / 60).toFixed(1) + "h");

// What the rail shows once a stop has an answer. Data the rule carries, never a description of it.
function answerOf(n, rule, catalog, triggers) {
  const wakes = rule.wakes || [];
  switch (n) {
    case 1:
      return wakes.length
        ? wakes.map(t => eventWords(t, triggers)).join(", ")
        : "every sweep";
    case 2: {
      const src = catalogSource(catalog, rule.subjects && rule.subjects.source);
      return src ? src.label : (rule.subjects && rule.subjects.source) || "—";
    }
    case 3: {
      const bound = rule.signals || [];
      return bound.length ? bound.map(b => b.alias).join(", ") : "nothing extra";
    }
    case 4: {
      const n2 = (rule.rows || []).length;
      return n2 === 0 ? "a fallback only" : n2 + " step" + (n2 === 1 ? "" : "s") + " and a fallback";
    }
    case 5: {
      const a = catalogAction(catalog, rule.action);
      return a ? a.label : rule.action || "—";
    }
    case 6:
      return [rule.mode, fmtSeconds(rule.settleSeconds), fmtMinutes(rule.suppressionMinutes)].join(" · ");
    default:
      return rule.name ? rule.name : "—";
  }
}

// An event named for a person, with how often it has fired here. The leaf's own count, so a rule
// built on something that happens twice a week reads differently from one built on two hundred.
function eventWords(type, triggers) {
  const t = (triggers || []).find(x => x.type === type);
  return t ? type : type;
}

function answered(n, rule) {
  switch (n) {
    case 1: return (rule.wakes || []).length > 0 || (rule.subjects || {}).source !== "from_event";
    case 2: return !!(rule.subjects && rule.subjects.source);
    case 3: return true;
    case 4: return !!(rule.default && rule.default.say);
    case 5: return !!rule.action;
    case 6: return !!rule.mode;
    default: return ID_SHAPE.test(rule.id || "") && !!rule.name;
  }
}

function Rail({ rule, catalog, triggers, at, onGo }) {
  return (
    <nav className="wiz-rail" aria-label="The questions this rule answers">
      {STOPS.map(s => {
        const done = answered(s.n, rule) && s.n !== at;
        return (
          <button type="button" key={s.n} className={"wiz-dot" + (done ? " wiz-dot--done" : "")}
            aria-current={at === s.n ? "true" : "false"} onClick={() => onGo(s.n)}>
            <span className="wiz-dot__n">{s.n}</span>
            <span>
              <span className="wiz-dot__q">{s.q}</span>
              <span className="wiz-dot__a">{answerOf(s.n, rule, catalog, triggers)}</span>
            </span>
          </button>
        );
      })}
    </nav>
  );
}

function Pick({ label, options, value, onChange }) {
  return (
    <div className="wiz-pick" role="radiogroup" aria-label={label}>
      {options.map(o => (
        <button type="button" key={o.id} role="radio" aria-checked={value === o.id}
          className="wiz-pick__o" onClick={() => onChange(o.id)}>
          <span className="wiz-pick__r" />
          <span>
            <span className="wiz-pick__t">{o.label}</span>
            {o.description && <span className="wiz-pick__d">{o.description}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

function RuleInterview({
  rule, catalog, triggers, honours, values, preview, busy, problems,
  onChange, onPreview, onSave, onCancel,
}) {
  const [at, setAt] = React.useState(1);
  const [editing, setEditing] = React.useState(null);
  const set = (patch) => onChange({ ...rule, ...patch });

  const rows = rule.rows || [];
  const stop = STOPS.find(s => s.n === at);
  const source = catalogSource(catalog, rule.subjects && rule.subjects.source);
  const wakesFromEvent = !source || source.fromEvent;

  const toggleWake = (type) => {
    const held = rule.wakes || [];
    set({ wakes: held.includes(type) ? held.filter(t => t !== type) : [...held, type] });
  };

  const editRow = (index) => setEditing(index);
  const patchRow = (index, next) =>
    index === "default"
      ? set({ default: next })
      : set({ rows: rows.map((r, i) => (i === index ? next : r)) });

  if (editing !== null) {
    const row = editing === "default" ? (rule.default || blankRow()) : rows[editing];
    return (
      <StepEditor rule={rule} catalog={catalog} row={row} isDefault={editing === "default"}
        values={values}
        onChange={(next) => patchRow(editing, next)}
        onDone={() => setEditing(null)}
        onRemove={() => { set({ rows: rows.filter((_, i) => i !== editing) }); setEditing(null); }} />
    );
  }

  return (
    <div className="wiz">
      <Rail rule={rule} catalog={catalog} triggers={triggers} at={at} onGo={setAt} />

      <div className="wiz-pane">
        <div className="wiz-pane__h">
          <div className="wiz-pane__q">{stop.q}</div>
          {stop.sub && <div className="wiz-pane__sub">{stop.sub}</div>}
        </div>

        <div className="wiz-pane__b">
          {at === 1 && (
            <>
              <Pick label="When it wakes" value={wakesFromEvent ? "events" : "sweep"}
                onChange={(v) => set(v === "sweep"
                  ? { wakes: [], subjects: { source: "instances_with_footprint", args: {} } }
                  : { subjects: { source: "from_event", args: {} } })}
                options={[
                  { id: "events", label: "When something happens",
                    description: "Only reached when one of the events you name arrives." },
                  { id: "sweep", label: "On a cadence",
                    description: "Re-judged every sweep. Right for something that creeps rather than happens." },
                ]} />
              {wakesFromEvent && (
                <div className="rule-edit__field" style={{ marginTop: 18 }}>
                  <label className="rule-edit__label">Which events</label>
                  <div className="rule-clauses" style={{ marginBottom: 8 }}>
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
                          {t.type} — {t.perWeek}/week
                        </option>
                      ))}
                  </Select>
                </div>
              )}
            </>
          )}

          {at === 2 && (
            <Pick label="What it judges" value={(rule.subjects && rule.subjects.source) || "from_event"}
              onChange={(v) => set({ subjects: { source: v, args: {} } })}
              options={(catalog.subjectSources || [])} />
          )}

          {at === 3 && (
            <>
              <p className="wiz-note">
                Most rules need nothing here. Add a lookup only when a step compares against something
                the reactor has to go and fetch.
              </p>
              {(rule.signals || []).map((b, i) => {
                const signal = catalogSignal(catalog, b.signal);
                return (
                  <div className="rule-bind" key={i}>
                    <div className="rule-bind__grid">
                      <div className="rule-edit__field">
                        <label className="rule-edit__label">Call it</label>
                        <input className="lcf-input lcf-input--mono" value={b.alias}
                          onChange={(e) => set({
                            signals: (rule.signals || []).map((x, j) =>
                              (j === i ? { ...x, alias: e.target.value } : x)),
                          })} />
                      </div>
                      <div className="rule-edit__field">
                        <label className="rule-edit__label">Look up</label>
                        <Select value={b.signal} onChange={(e) => set({
                          signals: (rule.signals || []).map((x, j) =>
                            (j === i ? { ...x, signal: e.target.value, args: {} } : x)),
                        })}>
                          {bindableSignals(catalog).map(s => (
                            <option key={s.id} value={s.id}>{s.label}</option>
                          ))}
                        </Select>
                      </div>
                    </div>
                    {(signal ? signal.args || [] : []).map(a => (
                      <div className="rule-edit__field" key={a.key} style={{ marginTop: 10 }}>
                        <label className="rule-edit__label">{a.label}</label>
                        {a.kind === "eventtype" ? (
                          <Select value={(b.args || {})[a.key] || ""} onChange={(e) => set({
                            signals: (rule.signals || []).map((x, j) =>
                              (j === i ? { ...x, args: { ...x.args, [a.key]: e.target.value } } : x)),
                          })}>
                            <option value="">choose an event…</option>
                            {(triggers || []).map(t => (
                              <option key={t.producer + "/" + t.type} value={t.type}>
                                {t.type} — {t.perWeek}/week
                              </option>
                            ))}
                          </Select>
                        ) : (
                          <input className="lcf-input" value={(b.args || {})[a.key] || ""}
                            onChange={(e) => set({
                              signals: (rule.signals || []).map((x, j) =>
                                (j === i ? { ...x, args: { ...x.args, [a.key]: e.target.value } } : x)),
                            })} />
                        )}
                      </div>
                    ))}
                    <button type="button" className="lib-btn rule-btn--danger" style={{ marginTop: 12 }}
                      onClick={() => set({ signals: (rule.signals || []).filter((_, j) => j !== i) })}>
                      Remove
                    </button>
                  </div>
                );
              })}
              <button type="button" className="lib-btn" style={{ marginTop: 12 }}
                onClick={() => {
                  const first = bindableSignals(catalog)[0];
                  if (!first) return;
                  set({ signals: [...(rule.signals || []), { alias: "lookup" + ((rule.signals || []).length + 1), signal: first.id, args: {} }] });
                }}>
                <Icon name="plus" size={14} /> Lookup
              </button>
            </>
          )}

          {at === 4 && (
            <>
              <div className="rule-firstmatch">
                <b>First match wins.</b> The reactor takes the first step whose conditions all hold.
              </div>
              <div className="rule-steps">
                {rows.map((row, i) => (
                  <button type="button" key={i} className={"rule-line rule-line--" + row.then}
                    onClick={() => editRow(i)}>
                    <span className="rule-line__n">{i + 1}</span>
                    <span className="rule-line__say"><Sentence text={row.say} /></span>
                    <span className={"rule-pill rule-pill--" + row.then}>
                      {(catalogOutcome(catalog, row.then) || {}).label || row.then}
                    </span>
                  </button>
                ))}
                <button type="button" className="rule-line rule-line--floor"
                  onClick={() => editRow("default")}>
                  <span className="rule-line__n" />
                  <span className="rule-line__say">
                    <span className="rule-line__otherwise">Anything else — </span>
                    <Sentence text={(rule.default || {}).say} />
                  </span>
                  <span className={"rule-pill rule-pill--" + ((rule.default || {}).then || "doesNotHold")}>
                    {(catalogOutcome(catalog, (rule.default || {}).then) || {}).label || "No"}
                  </span>
                </button>
              </div>
              <button type="button" className="lib-btn" style={{ marginTop: 14 }}
                onClick={() => { set({ rows: [...rows, blankRow()] }); setEditing(rows.length); }}>
                <Icon name="plus" size={14} /> Step
              </button>
            </>
          )}

          {at === 5 && (
            <Pick label="What it would do" value={rule.action}
              onChange={(v) => set({ action: v })}
              options={(catalog.actions || []).map(a => ({
                id: a.id, label: a.label, description: a.consequence || a.description,
              }))} />
          )}

          {at === 6 && (
            <>
              <Pick label="How far it may go" value={rule.mode} onChange={(v) => set({ mode: v })}
                options={[
                  { id: "off", label: "Off", description: "It is not run at all." },
                  { id: "observe", label: "Watch only",
                    description: "Records what it concludes. Nobody is told and nothing is done." },
                  { id: "propose", label: "Ask first",
                    description: honours === "observe"
                      ? "This build is permitted no further than watching."
                      : "Puts an offer in the panel and waits for a person." },
                  { id: "act", label: "Do it",
                    description: honours === "act"
                      ? "Acts without asking, and records that it did."
                      : "This build is not permitted to act on its own." },
                ]} />
              <div className="wiz-grid" style={{ marginTop: 18 }}>
                <div className="rule-edit__field">
                  <label className="rule-edit__label">Wait before judging</label>
                  <span className="rule-unit">
                    <input className="lcf-input" type="number" min="1" value={rule.settleSeconds || 0}
                      onChange={(e) => set({ settleSeconds: Number(e.target.value) })} />
                    <span>s</span>
                  </span>
                </div>
                <div className="rule-edit__field">
                  <label className="rule-edit__label">Then stay quiet for</label>
                  <span className="rule-unit">
                    <input className="lcf-input" type="number" min="0"
                      value={rule.suppressionMinutes ?? ""}
                      placeholder="host-wide"
                      onChange={(e) => set({
                        suppressionMinutes: e.target.value === "" ? null : Number(e.target.value),
                      })} />
                    <span>m</span>
                  </span>
                </div>
                <div className="rule-edit__field">
                  <label className="rule-edit__label">How serious</label>
                  <Select value={rule.severity || "info"}
                    onChange={(e) => set({ severity: e.target.value })}>
                    <option value="info">Worth knowing</option>
                    <option value="warn">Worth looking at</option>
                    <option value="danger">Worth interrupting someone</option>
                  </Select>
                </div>
              </div>
            </>
          )}

          {at === 7 && (
            <>
              <div className="wiz-grid">
                <div className="rule-edit__field">
                  <label className="rule-edit__label">Call this rule</label>
                  <input className="lcf-input" value={rule.name || ""}
                    onChange={(e) => set({
                      name: e.target.value,
                      id: rule.locked ? rule.id : idFromName(e.target.value),
                    })} />
                </div>
                <div className="rule-edit__field">
                  <label className="rule-edit__label">Filed as</label>
                  <input className="lcf-input lcf-input--mono" value={rule.id || ""}
                    disabled={!!rule.locked}
                    onChange={(e) => set({ id: e.target.value })} />
                  <span className="rule-edit__hint">
                    {rule.locked
                      ? "An id is the author recorded on every decision this rule has made, so it cannot change."
                      : "Lower case, digits and underscores. Permanent once saved."}
                  </span>
                </div>
              </div>

              <div className="wiz-try">
                <button type="button" className="lib-btn" onClick={onPreview} disabled={busy}>
                  <Icon name="play" size={14} /> Try it
                </button>
                <span className="rule-edit__hint">
                  What it would conclude right now. Nothing is written.
                </span>
              </div>

              {preview && !preview.pending && (
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
                        <span className={"rule-pill rule-pill--" + v.outcome}>{v.outcome}</span>
                        {" "}{v.reason}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {preview && preview.pending && (
                <div className="rule-edit__hint" style={{ marginTop: 12 }}>
                  Asking the reactor what this would decide…
                </div>
              )}
            </>
          )}

          {problems && problems.length > 0 && (
            <div className="rule-problems">
              {problems.map((p, i) => (
                <div key={i} className="rule-problems__row">
                  <Icon name="triangle-alert" size={14} /> <span>{p}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="wiz-pane__f">
          <button type="button" className="lib-btn" disabled={at === 1}
            onClick={() => setAt(Math.max(1, at - 1))}>Back</button>
          <span className="wiz-pane__count">Step {at} of {STOPS.length}</span>
          <button type="button" className="lib-btn" onClick={onCancel}>Cancel</button>
          {at === STOPS.length
            ? (
              <button type="button" className="lib-btn lib-btn--primary" onClick={onSave}
                disabled={busy || !ID_SHAPE.test(rule.id || "")}>
                {busy ? "Saving…" : "Save"}
              </button>
            )
            : (
              <button type="button" className="lib-btn lib-btn--primary"
                onClick={() => setAt(Math.min(STOPS.length, at + 1))}>Next</button>
            )}
        </div>
      </div>
    </div>
  );
}

export { RuleInterview, STOPS, fmtSeconds, fmtMinutes, answerOf };
