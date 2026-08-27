// formatting.js — the shared pure formatters: time, bytes, uptime, metric tones, and the two
// bindings that turn an audit row into something on screen. No React and no imports, so pages and
// components both read it.

// ---------- Time helpers ----------

function parseTs(ts) { return new Date(ts.replace(" ", "T")); }

function fmtRelative(date, now = new Date()) {
  const diff = (now - date) / 1000;
  if (diff < 60)    return Math.max(0, Math.floor(diff)) + "s ago";
  if (diff < 3600)  return Math.floor(diff / 60) + "m ago";
  if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
  return Math.floor(diff / 86400) + "d ago";
}

// How long until something happens — the forward twin of fmtRelative, for a scheduled job rather than a
// recorded event. A time that has already passed reads "due" rather than a negative duration: the
// scheduler computes next-fire on its own cadence, so a moment either side of the boundary is normal and
// "-4s" would look like a fault. Null in → null out, so the caller renders its own honest gap.
function fmtUntil(date, now = new Date()) {
  if (!date || isNaN(date.getTime())) return null;
  const diff = (date - now) / 1000;
  if (diff <= 0)    return "due";
  if (diff < 60)    return "in " + Math.ceil(diff) + "s";
  if (diff < 3600)  return "in " + Math.round(diff / 60) + "m";
  if (diff < 86400) return "in " + Math.round(diff / 3600) + "h";
  return "in " + Math.round(diff / 86400) + "d";
}

function fmtTime(date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

function fmtTimeFull(ts) {
  const d = new Date(ts.replace(" ", "T"));
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Choose a traffic-light tone (success/warn/danger) for a numeric value
// against amber/red thresholds.
function statusTone(value, amber, red) {
  if (value >= red) return "danger";
  if (value >= amber) return "warn";
  return "success";
}

// A KPI's tone for a measured value against the lines it is judged by. Healthy is MUTED, not green:
// a glance card earns attention by turning amber, and a band where every tile is lit has nothing left
// to say when one of them matters.
//
// `lines` is the host's own rule for this metric when it publishes one (see lib/hostThresholds.js);
// the fallbacks are for the quantities no rule covers. A value that isn't a number is muted rather
// than compared, since "unmeasured" is not "fine".
function metricTone(value, lines, fallbackWarn = null, fallbackDanger = null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "muted";
  const warn = lines && lines.warn != null ? lines.warn : fallbackWarn;
  const danger = lines && lines.danger != null ? lines.danger : fallbackDanger;
  if (danger != null && value >= danger) return "danger";
  if (warn != null && value >= warn) return "warn";
  return "muted";
}

// ---------- Uptime ----------

// How long something has been up, in the two coarsest units that say anything —
// a host's boot time or a leaf unit's activation stamp. A stamp in the future or
// an unparseable one is an em-dash, never a negative duration.
function uptimeShort(bootTime) {
  const ms = Date.now() - new Date(bootTime).getTime();
  if (ms < 0 || !isFinite(ms)) return "—";
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

// ---------- Event presentation ----------

// An audit row's presentation keys on a DIMENSION the row carries — the severity its producer
// stamped, the outcome it reports, the shape of its dotted name — and never on the name itself. A
// table with one entry per event type holds a missing entry for every event nobody has added yet,
// and a missing entry paints a destructive act neutral, which is a lie. Keyed by dimension the
// table is closed while the vocabulary stays open: an event this build has never heard of lands on
// an entry that already exists, because the entry describes a KIND of thing rather than a thing.

// Severity is the producer's judgement and nothing here second-guesses it — the scheduler knows its
// prune is routine and the engine knows an uninstall is not, and that knowledge exists nowhere
// else. Outcome only separates a good routine fact from a neutral one, so a success lifts a routine
// row to green and changes nothing louder; a `success` in the severity field says the same thing
// about the same row and reads the same green.
//
// A row carrying no severity is `info` — the honest floor for an event nobody declared, never a
// weight guessed from what its name looks like it means.
const SEVERITY_TONE = { info: "info", success: "success", warn: "warn", danger: "danger" };

function auditTone(ev) {
  const tone = SEVERITY_TONE[ev && ev.severity] || "info";
  return tone === "info" && ev && ev.outcome === "success" ? "success" : tone;
}

// One node of the icon trie: the glyph this depth draws, and the namespaces nested beneath it.
const ns = (icon, kids) => ({ icon, kids: kids || null });

// Icon, from the shape of the dotted name. The name is structured data, so its own hierarchy
// carries the specificity: every node below is a NAMESPACE, and a new event inside one that already
// exists needs nothing added here.
//
// A segment matches a key when it STARTS WITH that key, which is what lets one node cover a verb
// however it is spelled — `uninstall`, `uninstalled` and `uninstall_failed` all walk the same
// branch. Keys are whole words for that reason: a stem short enough to bite a neighbouring
// namespace would route its rows to the wrong glyph. An irregular past tense is out of a stem's
// reach, so it is a second key onto the same glyph. The longest key matching a segment wins at that
// level, and the walk stops at the deepest node it reaches — an unrecognised segment falls back to
// the namespace above it, and a name in no namespace at all falls to the root glyph. Plain, and
// never invisible.
const ICON_TRIE = ns("circle-dot", {
  server: ns("server", {
    install:   ns("package-plus"),
    uninstall: ns("trash-2"),
    start:     ns("play"),
    stop:      ns("square"),
    ready:     ns("circle-check"),
    restart:   ns("rotate-cw"),
    update:    ns("download"),
    move:      ns("folder-symlink"),
    rename:    ns("pencil"),
    crash:     ns("alert-triangle"),
    fail:      ns("octagon-x"),
  }),
  backup: ns("database", {
    restore:  ns("rotate-ccw"),
    delete:   ns("trash-2"),
    prune:    ns("archive-x"),
    pin:      ns("pin"),
    unpin:    ns("pin-off"),
    download: ns("download"),
  }),
  // The two doors an instance's ports pass through are the same fact about different hardware, so
  // they never share a glyph: `ports` is the host's own firewall rule, `upnp` is the router's NAT
  // forward, and a host can hold one without the other.
  network: ns("globe", {
    // The two doors an instance's ports pass through, and they never share a glyph: ports is the
    // HOST firewall rule, upnp is the ROUTER's NAT forward, and a host can hold one without the
    // other. Only the firewall door draws its two directions apart — a router forward looks the same
    // whichever way it went, and the tone is what says which.
    ports: ns("lock", {
      open:  ns("lock-open"),
      close: ns("lock"),
    }),
    upnp:  ns("router"),
  }),
  player: ns("users", {
    join:  ns("log-in"),
    leave: ns("log-out"),
    left:  ns("log-out"),
    kick:  ns("user-x"),
    ban:   ns("shield-off"),
    unban: ns("shield-check"),
  }),
  config:    ns("sliders-horizontal"),
  console:   ns("terminal"),
  file:      ns("file-pen"),
  blueprint: ns("file-code", { revert: ns("rotate-ccw") }),
  library:   ns("folder", { add: ns("folder-plus"), remove: ns("folder-minus") }),
  command:   ns("octagon-x", { refuse: ns("ban"), cancel: ns("circle-slash") }),
  service:   ns("plug", { disconnect: ns("unplug"), config: ns("settings"), restart: ns("rotate-cw") }),
  host:      ns("gauge"),
  assistant: ns("sparkles", { action: ns("hand"), claim: ns("message-square-x") }),
  auth:      ns("key-round", { login: ns("log-in"), logout: ns("log-out"), session: ns("user-minus"), cluster: ns("network") }),
  user:      ns("user", {
    provision: ns("user-plus"),
    approve:   ns("user-check"),
    disable:   ns("user-x"),
    tier:      ns("shield-alert"),
    delete:    ns("user-minus"),
    password:  ns("key-round"),
  }),
  identity:  ns("link", { unlink: ns("unlink") }),
  engine:    ns("cpu"),
  reactor:   ns("workflow"),
  scheduler: ns("calendar-clock"),
  firewall:  ns("shield"),
  monitor:   ns("activity"),
  watchdog:  ns("radar"),
  leaf:      ns("plug"),
});

function eventIcon(action) {
  let cursor = ICON_TRIE;
  for (const segment of String(action || "").split(".")) {
    const kids = cursor.kids;
    if (!kids) break;
    let match = null;
    for (const key in kids) {
      if (segment.startsWith(key) && (match === null || key.length > match.length)) match = key;
    }
    if (match === null) break;
    cursor = kids[match];
  }
  return cursor.icon;
}

// A dotted name spelled for a person: dots and underscores are word breaks and the first letter is
// capitalised, so `server.update.failed` reads "Server update failed". It is the name the producer
// chose with nothing added to it, which is what makes it right for an event this build has never
// seen as well as for one it has.
function humanizeAction(action) {
  const words = String(action || "").split(/[._]/).filter(Boolean).join(" ");
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "";
}

function actionCategory(action) {
  return String(action || "").split(".")[0];
}

// Display labels for the category words. Categories are a small closed set of nouns and this only
// spells them: an unlisted one reads as its own word, capitalised, so the filter can never withhold
// a category for want of a label.
const CATEGORY_LABEL = {
  player:    "Players",
  backup:    "Backups",
  config:    "Configuration",
  file:      "Files",
  blueprint: "Blueprints",
  library:   "Libraries",
  command:   "Commands",
  service:   "Services",
  host:      "Hosts",
  user:      "Accounts",
  identity:  "Identities",
};

function categoryLabel(category) {
  const word = String(category || "");
  return CATEGORY_LABEL[word] || (word ? word.charAt(0).toUpperCase() + word.slice(1) : "");
}

// The categories the audit filter offers, alphabetical by label so the list holds still as rows
// arrive. `vocabulary` — every dotted name the feed can produce — is the authority when the API
// serves one, because the category filter is pushed down and a category with no row in the loaded
// window may still have rows behind the cursor. Without one, the loaded rows are what can honestly
// be claimed, so the list offers exactly the categories in hand.
function auditCategories(rows, vocabulary) {
  const names = Array.isArray(vocabulary) && vocabulary.length
    ? vocabulary
    : (rows || []).map(row => row && row.action);
  const set = new Set();
  for (const name of names) {
    const category = actionCategory(name);
    if (category) set.add(category);
  }
  return Array.from(set).sort((a, b) => categoryLabel(a).localeCompare(categoryLabel(b)));
}

// ---------- Byte & rate formatting ----------

// Binary units for live resource readouts. Null / non-finite → an em-dash;
// callers that want a distinct "not measured" treatment check for null first
// and never let these coerce a missing metric into "0 B".
const KIB = 1024, MIB = 1024 * 1024, GIB = 1024 * 1024 * 1024;

function formatBytes(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= GIB) return (n / GIB).toFixed(2) + " GiB";
  if (n >= MIB) return (n / MIB).toFixed(1) + " MiB";
  if (n >= KIB) return (n / KIB).toFixed(0) + " KiB";
  return Math.round(n) + " B";
}

// The compact form the leaf/services surfaces read in: binary-scaled like the above but
// labelled in the units an operator says out loud ("52 MB"), and null-in / null-out so a
// caller can tell "not measured" from a reading and render its own em-dash.
function fmtBytes(n) {
  if (n == null) return null;
  if (n >= GIB) return (n / GIB).toFixed(1) + " GB";
  if (n >= MIB) return Math.round(n / MIB) + " MB";
  if (n >= KIB) return Math.round(n / KIB) + " KB";
  return n + " B";
}

function formatBps(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= MIB) return (n / MIB).toFixed(1) + " MiB/s";
  if (n >= KIB) return (n / KIB).toFixed(0) + " KiB/s";
  return Math.round(n) + " B/s";
}

// ---------- The card ramp ----------

// One scale for every figure on a server card — memory, disk and both network directions read
// "4.2G", "985M", "12K", "355B". Two properties make it what a card needs:
//
//   • It RESCALES in both directions. A raw byte count is unreadable at a glance ("123245" tells you
//     nothing until you have counted the digits), so the unit follows the value up and back down.
//   • It is NEVER wider than four characters, which is what lets a chip reserve a fixed box and stop
//     the row from shuffling every time a value gains a digit. Two rules keep that promise: only
//     values under 10 carry a decimal, and a value that would round to four digits is promoted to the
//     next unit instead (1023 B is "1.0K", never "1023B").
//
// Precision is deliberately traded for stillness — the exact figure goes in the chip's tooltip and on
// the Performance tab. Null-in / em-dash out, so a caller can never turn "not measured" into "0B".
// Runs to P because the four-character promise has to hold at the TOP of the ramp too: the largest
// unit has nothing to be promoted into, so whatever it is prints five characters past 999.5 of it.
// Ending at P puts that ceiling beyond the largest byte count a double represents exactly.
const TIGHT_UNITS = [["P", KIB * KIB * GIB], ["T", KIB * GIB], ["G", GIB], ["M", MIB], ["K", KIB], ["B", 1]];

function fmtBytesTight(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  let i = TIGHT_UNITS.findIndex(([, div]) => n >= div);
  if (i < 0) i = TIGHT_UNITS.length - 1;   // below one byte (0 included) is still bytes
  let [unit, div] = TIGHT_UNITS[i];
  let value = n / div;
  if (value >= 999.5 && i > 0) {
    [unit, div] = TIGHT_UNITS[i - 1];
    value = n / div;
  }
  // 9.95 and not 9.995: toFixed(1) rounds to the nearest TENTH, so 9.9949 prints as "10.0" — five
  // characters, one more than the box reserves. Above the cutoff the integer form takes over ("10K").
  return (value < 9.95 && unit !== "B" ? value.toFixed(1) : String(Math.round(value))) + unit;
}

// ---------- Footprint ----------

function fmtFootprintMb(mb) {
  if (mb == null || !Number.isFinite(mb)) return "\u2014";
  if (mb >= 1024) {
    const gb = mb / 1024;
    return (Number.isInteger(gb) ? gb : Math.round(gb * 10) / 10) + " GB";
  }
  return Math.round(mb) + " MB";
}

/// 1 → "1st". Used where a position in a queue has to read as a place rather than a count — "3rd of
/// 8" says which server moves next, where "3 of 8" reads like a progress bar.
///
/// The teens are the exception a last-digit rule gets wrong: 11th, 12th and 13th, not 11st.
function ordinal(n) {
  if (!Number.isFinite(n)) return "";
  const abs = Math.abs(Math.trunc(n));
  const tens = abs % 100;
  if (tens >= 11 && tens <= 13) return abs + "th";
  const ones = abs % 10;
  return abs + (ones === 1 ? "st" : ones === 2 ? "nd" : ones === 3 ? "rd" : "th");
}

export {
  CATEGORY_LABEL,
  actionCategory,
  auditCategories,
  auditTone,
  categoryLabel,
  eventIcon,
  humanizeAction,
  formatBytes,
  formatBps,
  fmtBytesTight,
  fmtBytes,
  fmtFootprintMb,
  fmtRelative,
  fmtTime,
  fmtTimeFull,
  fmtUntil,
  ordinal,
  parseTs,
  metricTone,
  statusTone,
  uptimeShort,
};
