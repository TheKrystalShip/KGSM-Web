// ruleModel.js — the shapes the rule editor works in, and the reading of a rule into words.
//
// Everything here is pure and holds NO vocabulary of its own: the signals, operators, outcomes and
// actions all come from the leaf's catalog, because the running build is the only thing that knows
// what it can measure. A list kept in this file would go on offering a signal after the build that
// measured it was replaced, and refuse one a later build added.

// The smallest rule that can run: one event, one conclusion, one sentence. A new rule starts here
// rather than empty, because an editor that opens on nothing gives a person no shape to fill in.
const blankRule = (id) => ({
  id: id || "",
  name: "",
  wakes: [],
  subjects: { source: "from_event", args: {} },
  signals: [],
  rows: [],
  default: { when: [], then: "doesNotHold", say: "nothing to report about {subject}" },
  action: "none",
  severity: "info",
  settleSeconds: 120,
  suppressionMinutes: null,
  mode: "observe",
  retired: false,
});

const blankRow = () => ({ when: [], then: "holds", say: "" });

const blankClause = (signalId) => ({ signal: signalId || "", op: "gt", value: 0 });

// A rule id is minted once and never reused, retired rules included — it is the actor on every
// decision the rule made. Derived from the name as a starting point; the field stays editable until
// the rule is first saved.
const idFromName = (name) =>
  String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);

const ID_SHAPE = /^[a-z][a-z0-9_]*$/;

const catalogSignal = (catalog, id) =>
  (catalog && catalog.signals || []).find(s => s.id === id) || null;

const catalogOperator = (catalog, id) =>
  (catalog && catalog.operators || []).find(o => o.id === id) || null;

const catalogOutcome = (catalog, id) =>
  (catalog && catalog.outcomes || []).find(o => o.id === id) || null;

const catalogAction = (catalog, id) =>
  (catalog && catalog.actions || []).find(a => a.id === id) || null;

const catalogSource = (catalog, id) =>
  (catalog && catalog.subjectSources || []).find(s => s.id === id) || null;

// What a clause may name. A signal that needs nothing supplied is referred to by its own id; one
// that takes arguments is bound once at rule level under a name, so two mentions of the same
// lookback cannot come to mean different windows.
function aliasesFor(rule, catalog) {
  const bound = (rule && rule.signals || []).map(b => ({
    alias: b.alias,
    signalId: b.signal,
    bound: true,
  }));

  const bare = (catalog && catalog.signals || [])
    .filter(s => !(s.args || []).some(a => a.required))
    .map(s => ({ alias: s.id, signalId: s.id, bound: false }));

  const seen = new Set(bound.map(b => b.alias));
  return [...bound, ...bare.filter(b => !seen.has(b.alias))];
}

// The signal an alias resolves to, whichever way it was named.
function signalOfAlias(rule, catalog, alias) {
  const binding = (rule && rule.signals || []).find(b => b.alias === alias);
  return catalogSignal(catalog, binding ? binding.signal : alias);
}

// Which operators apply to what an alias measures. Asking whether a duration contains a piece of
// text is not a comparison anybody meant to make, and the catalog says which kinds each takes.
function operatorsFor(rule, catalog, alias) {
  const signal = signalOfAlias(rule, catalog, alias);
  const all = (catalog && catalog.operators) || [];
  if (!signal) return all;
  return all.filter(op => (op.kinds || []).includes(signal.kind));
}

// One comparison, as the parts of a sentence. The unit rides along because "below 2" and "below 2
// days" are different statements and only one of them is what the rule says.
function clauseParts(rule, catalog, clause) {
  const signal = signalOfAlias(rule, catalog, clause.signal);
  const op = catalogOperator(catalog, clause.op);

  let value = null;
  if (clause.vsSignal) {
    const other = signalOfAlias(rule, catalog, clause.vsSignal);
    value = other ? other.label : clause.vsSignal;
  } else if (clause.text != null) {
    value = clause.text;
  } else if (clause.value != null) {
    value = String(clause.value);
  }

  return {
    signal: signal ? signal.label : clause.signal,
    op: op ? op.label : clause.op,
    value,
    unit: value != null && !clause.vsSignal && clause.text == null && signal ? signal.unit : null,
    known: !!signal,
  };
}

// Two rules the same, field for field. Used to decide whether there is anything to save — an editor
// that offered to save an untouched rule would restart the leaf for nothing.
const sameRule = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// A rule the leaf refused is in the file and in none of the leaf's lists, so the editor reads the
// STORED set and asks the leaf's status only for what is running and what it could not honour.
function problemsFor(problems, ruleId) {
  if (!Array.isArray(problems) || !ruleId) return [];
  return problems.filter(p => typeof p === "string" && p.startsWith(ruleId + " "));
}

export {
  blankRule, blankRow, blankClause, idFromName, ID_SHAPE,
  catalogSignal, catalogOperator, catalogOutcome, catalogAction, catalogSource,
  aliasesFor, signalOfAlias, operatorsFor, clauseParts, sameRule, problemsFor,
};
