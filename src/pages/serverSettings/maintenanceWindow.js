// The maintenance-window grammar as an editor reads it: one packed expression split into the fields a
// person edits, and put back together again.
//
// Text only. Whether a window is well-formed and when it fires are the node's answers — the parser and
// the clock the scheduler itself fires on live in kgsm-lib, and the API previews a candidate window
// with them — so nothing here decides either. What is here is the split and the join, which an editor
// needs because a person edits a cadence, a clock time and a weekday, not a string.

// The order tasks run in, which is a property of what they are: an archive taken after an update
// captures the new build instead of the rollback point. The node writes them back in this order too,
// so composing in it is what lets a draft be compared against what is saved.
const TASK_ORDER = ["backup", "update", "restart"];

const DOW = [
  { value: "sun", label: "Sunday" },
  { value: "mon", label: "Monday" },
  { value: "tue", label: "Tuesday" },
  { value: "wed", label: "Wednesday" },
  { value: "thu", label: "Thursday" },
  { value: "fri", label: "Friday" },
  { value: "sat", label: "Saturday" },
];

const UNITS = [
  { value: "m", label: "Minutes", one: "minute", many: "minutes" },
  { value: "h", label: "Hours", one: "hour", many: "hours" },
  { value: "d", label: "Days", one: "day", many: "days" },
];

// The span a window may come round in, expressed in each unit a person can type it in. The node
// refuses anything outside it and says so; these bounds are what stop the number input offering the
// refusal in the first place.
const INTERVAL_BOUNDS = {
  m: { min: 10, max: 43200 },
  h: { min: 1, max: 720 },
  d: { min: 1, max: 30 },
};

const CADENCES = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

let seq = 0;

// A draft carries every field both kinds need, so switching kind keeps what was typed in the other and
// nothing has to be re-entered to look at the alternative.
function newWindowDraft() {
  return {
    uid: "mw" + ++seq,
    kind: "appointment",
    cadence: "daily",
    time: "04:00",
    dow: "sun",
    dom: 1,
    every: 6,
    unit: "h",
    tasks: ["backup"],
    raw: null,
  };
}

// Split one expression into the fields. `raw` holds the expression verbatim when the schedule half is
// not something these controls can express — the window still shows, still says what the node thinks
// is wrong with it, and can still be corrected or removed, which a dropped row could not.
function draftFromExpression(expression) {
  const draft = newWindowDraft();
  const text = String(expression ?? "").trim();
  const slash = text.indexOf("/");
  const schedule = slash === -1 ? text : text.slice(0, slash);
  const tasks = slash === -1 ? "" : text.slice(slash + 1);

  draft.tasks = orderTasks(tasks.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean));

  const at = schedule.indexOf("@");
  if (at === -1) {
    const interval = /^(\d+)([mhd])$/.exec(schedule);
    if (!interval) return { ...draft, raw: text };
    draft.kind = "interval";
    draft.every = Number(interval[1]);
    draft.unit = interval[2];
    return draft;
  }

  const head = schedule.slice(0, at);
  const time = schedule.slice(at + 1);
  if (!/^\d{1,2}:\d{2}$/.test(time)) return { ...draft, raw: text };

  draft.kind = "appointment";
  draft.time = time.length === 4 ? "0" + time : time;

  const [cadence, part] = head.split(".");
  if (cadence === "daily" && part === undefined) {
    draft.cadence = "daily";
    return draft;
  }
  if (cadence === "weekly" && DOW.some((d) => d.value === part)) {
    draft.cadence = "weekly";
    draft.dow = part;
    return draft;
  }
  if (cadence === "monthly" && /^([1-9]|[12]\d|3[01])$/.test(part || "")) {
    draft.cadence = "monthly";
    draft.dom = Number(part);
    return draft;
  }
  return { ...draft, raw: text };
}

// The fields back into one expression. A raw draft was never split, so it goes back exactly as it came.
function expressionOf(draft) {
  if (!draft) return "";
  if (draft.raw !== null && draft.raw !== undefined) return draft.raw;

  let schedule;
  if (draft.kind === "interval") {
    schedule = String(draft.every ?? "") + draft.unit;
  } else if (draft.cadence === "weekly") {
    schedule = "weekly." + draft.dow + "@" + draft.time;
  } else if (draft.cadence === "monthly") {
    schedule = "monthly." + String(draft.dom ?? "") + "@" + draft.time;
  } else {
    schedule = "daily@" + draft.time;
  }
  return schedule + "/" + orderTasks(draft.tasks).join(",");
}

// The window in words, for the row somebody reads before they read the six controls under it.
function describeWindow(draft) {
  if (!draft) return "";
  if (draft.raw !== null && draft.raw !== undefined) return draft.raw;

  if (draft.kind === "interval") {
    const unit = UNITS.find((u) => u.value === draft.unit) || UNITS[1];
    const n = Number(draft.every);
    return "Every " + (n === 1 ? unit.one : n + " " + unit.many);
  }
  if (draft.cadence === "weekly") {
    const day = DOW.find((d) => d.value === draft.dow);
    return "Every " + (day ? day.label : draft.dow) + " at " + draft.time;
  }
  if (draft.cadence === "monthly") return "Day " + draft.dom + " of the month at " + draft.time;
  return "Every day at " + draft.time;
}

function orderTasks(tasks) {
  const held = new Set(tasks || []);
  return TASK_ORDER.filter((t) => held.has(t));
}

function boundsOf(unit) {
  return INTERVAL_BOUNDS[unit] || INTERVAL_BOUNDS.h;
}

export {
  CADENCES, DOW, TASK_ORDER, UNITS,
  boundsOf, describeWindow, draftFromExpression, expressionOf, newWindowDraft, orderTasks,
};
