// formatting.js — shared formatting helpers extracted from page files.
//
// These were previously co-located in AuditLogPage.jsx, DiagnosticsPage.jsx,
// and LibraryPage.jsx. They are pure functions / data maps with no React
// dependencies — consumed across pages and components.

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

// ---------- Action metadata ----------

// Icon + tone + label per audit action, keyed by the dotted action kgsm-api emits. The map covers
// the whole closed vocabulary (`AuditAction`) plus the `engine.*` passthroughs the API's generic
// shaping produces for an engine event it has no mapper for. An action with no entry still renders
// — a neutral dot with the raw action as its own label — so a backend that grows a new one is never
// a broken row. That fallback is the forward-compat floor, not the target: an action nobody maps
// reads as indistinct from every other unmapped one, which is exactly how a port opening and a
// router forward came to look like the same grey dot.
//
// Tone is what the action MEANS, on five steps:
//
//   success  something came into being or finished well — installed, ready, backed up, recovered
//   info     a neutral fact worth recording — a key set, a command sent, a player arriving, a sign-in
//   update   a transition, or a version moving — restart, update, a move between libraries
//   warn     something is now off, reduced, refused, or somebody's authority changed
//   danger   irreversible destruction, or a failure
//
// The two doors an instance's ports pass through — ports.* is the HOST firewall rule, upnp.* is the
// router's NAT forward — share their tones because they are the same fact about different doors,
// and never their icons, because a host can hold one without the other.
const ACTION_META = {
  "server.install":        { label: "Server installed",   icon: "package-plus",  tone: "success" },
  "server.start":          { label: "Server started",     icon: "play",          tone: "success" },
  // Its own row, not a repeat of the start above it: that one says the process spawned, this says
  // the game will accept a connection, and on a big world the two are minutes apart.
  "server.ready":          { label: "Ready to play",      icon: "circle-check",  tone: "success" },
  // A stop is a transition, not a loss: the server is off and can be started again. The row that
  // destroys one is server.uninstall, and it is the only server row that reads danger on its own.
  "server.stop":           { label: "Server stopped",     icon: "square",        tone: "warn"    },
  "server.restart":        { label: "Server restarted",   icon: "rotate-cw",     tone: "update"  },
  "server.update":         { label: "Server updated",     icon: "download",      tone: "update"  },
  "server.update_available":{label: "Update available",   icon: "circle-arrow-up",tone: "info"   },
  "server.move":           { label: "Server moved",       icon: "folder-symlink",tone: "update"  },
  "server.rename":         { label: "Server renamed",     icon: "pencil",        tone: "info"    },
  // Warn, and escalated to danger by the severity the supervisor stamps: a crash it is restarting
  // from is a warning, one it has given up on is a failure, and the two must not draw the same.
  "server.crash":          { label: "Server crashed",     icon: "alert-triangle",tone: "warn"    },
  "server.uninstall":      { label: "Server uninstalled", icon: "trash-2",       tone: "danger"  },
  "network.ports.open":    { label: "Ports opened",       icon: "lock-open",     tone: "info"    },
  "network.ports.close":   { label: "Ports closed",       icon: "lock",          tone: "warn"    },
  "network.upnp.open":     { label: "Router forwarded",   icon: "router",        tone: "info"    },
  "network.upnp.close":    { label: "Router forward removed", icon: "router",    tone: "warn"    },
  "network.upnp.reassert": { label: "Router forward restored", icon: "refresh-cw", tone: "warn"  },
  "player.join":           { label: "Player joined",      icon: "log-in",        tone: "info"    },
  "player.leave":          { label: "Player left",        icon: "log-out",       tone: "info"    },
  "player.kick":           { label: "Player kicked",      icon: "user-x",        tone: "warn"    },
  "player.ban":            { label: "Player banned",      icon: "shield-off",    tone: "danger"  },
  "player.unban":          { label: "Player unbanned",    icon: "shield-check",  tone: "info"    },
  "backup.create":         { label: "Backup created",     icon: "database",      tone: "success" },
  // Warn rather than success: a restore overwrites the live world with an older one, and the world
  // it replaced is not in the backup set.
  "backup.restore":        { label: "Backup restored",    icon: "rotate-ccw",    tone: "warn"    },
  "backup.delete":         { label: "Backup deleted",     icon: "trash-2",       tone: "danger"  },
  "backup.prune":          { label: "Backups pruned",     icon: "archive-x",     tone: "info"    },
  "backup.pin":            { label: "Backup pinned",      icon: "pin",           tone: "info"    },
  // The unpin is the half that can cost data later — it is what lets the next sweep take an archive
  // somebody deliberately protected.
  "backup.unpin":          { label: "Backup unpinned",    icon: "pin-off",       tone: "warn"    },
  "backup.download":       { label: "Backup downloaded",  icon: "download",      tone: "info"    },
  "file.write":            { label: "File saved",         icon: "file-pen",      tone: "info"    },
  "blueprint.write":       { label: "Blueprint edited",   icon: "file-code",     tone: "info"    },
  "blueprint.revert":      { label: "Blueprint reverted", icon: "rotate-ccw",    tone: "warn"    },
  // library.* — a named placement root. The subject is a library, never a server, so these rows
  // carry no serverId; a removal is the destructive one, since it is a disk leaving the fleet.
  "library.add":           { label: "Library added",      icon: "folder-plus",   tone: "success" },
  "library.remove":        { label: "Library removed",    icon: "folder-minus",  tone: "danger"  },
  "library.rename":        { label: "Library renamed",    icon: "folder-pen",    tone: "info"    },
  "library.failed":        { label: "Library change failed", icon: "folder-x",   tone: "danger"  },
  "config.set":            { label: "Setting changed",    icon: "sliders-horizontal", tone: "info" },
  "console.input":         { label: "Console command",    icon: "terminal",      tone: "info"    },
  // assistant.* — what the assistant reports about its own conduct, never a record of what it did:
  // an action it performs is the engine's own row, attributed to the person who asked.
  "assistant.action.proposed": { label: "Action proposed", icon: "hand",         tone: "info"    },
  "assistant.action.declined": { label: "Action refused",  icon: "shield-x",     tone: "warn"    },
  "assistant.claim.corrected": { label: "Claim corrected", icon: "message-square-x", tone: "warn" },
  "assistant.blueprint.authored": { label: "Blueprint authored", icon: "sparkles", tone: "success" },
  // command.* — a command the API issued that ended without doing the thing. The three are separate
  // questions: a fault to chase, a fleet that is full, and somebody calling off queued work.
  "command.failed":        { label: "Command failed",     icon: "octagon-x",     tone: "danger"  },
  "command.refused":       { label: "Command refused",    icon: "ban",           tone: "warn"    },
  "command.cancelled":     { label: "Command cancelled",  icon: "circle-slash",  tone: "warn"    },
  "service.connect":       { label: "Leaf connected",     icon: "plug",          tone: "success" },
  "service.disconnect":    { label: "Leaf disconnected",  icon: "unplug",        tone: "warn"    },
  "service.config":        { label: "Leaf reconfigured",  icon: "settings",      tone: "info"    },
  "service.restart":       { label: "Leaf restarted",     icon: "rotate-cw",     tone: "update"  },
  // host.threshold.* — one glyph, because a breach and its recovery are the same measurement
  // crossing the same line; the tone is what separates them. The breach's own severity carries how
  // far past the line it went, so a hard breach escalates to danger.
  "host.threshold.breach": { label: "Threshold breached", icon: "gauge",         tone: "warn"    },
  "host.threshold.clear":  { label: "Threshold cleared",  icon: "gauge",         tone: "success" },
  "auth.login":            { label: "Signed in",          icon: "log-in",        tone: "info"    },
  "auth.logout":           { label: "Signed out",         icon: "log-out",       tone: "info"    },
  "auth.session.revoke":   { label: "Session revoked",    icon: "user-minus",    tone: "info"    },
  "auth.session.revoke.all":{label: "All sessions revoked",icon: "users",        tone: "warn"    },
  // An admin ending SOMEONE ELSE's session — louder than the two self-service rows
  // above, which is why the API stamps it warn-severity upstream too.
  "auth.session.revoke.admin":{label:"Session revoked (admin)",icon:"shield-off",tone: "danger"  },
  "auth.cluster_session":  { label: "Cluster sign-in",    icon: "network",       tone: "info"    },
  // user.* / identity.* — somebody's authority. A tier change is the only way anyone's authority
  // ever changes, and a link means whoever controls that provider account can sign in as this one.
  "user.provision":        { label: "Account created",    icon: "user-plus",     tone: "info"    },
  "user.approve":          { label: "Account approved",   icon: "user-check",    tone: "info"    },
  "user.disable":          { label: "Account disabled",   icon: "user-x",        tone: "warn"    },
  "user.tier_change":      { label: "Role changed",       icon: "shield-alert",  tone: "warn"    },
  "user.delete":           { label: "Account deleted",    icon: "user-minus",    tone: "danger"  },
  "user.password":         { label: "Password set",       icon: "key-round",     tone: "warn"    },
  "identity.link":         { label: "Identity linked",    icon: "link",          tone: "warn"    },
  "identity.unlink":       { label: "Identity unlinked",  icon: "unlink",        tone: "info"    },
  // engine.* — the shape kgsm-api gives an engine event it holds no mapper for: the raw type,
  // prefixed, never dropped. These four are the ones the ecosystem's event catalog can produce
  // today, and three of them are failures that must not read as neutral.
  "engine.reactor_decided": { label: "Reactor decision",  icon: "workflow",      tone: "info"    },
  "engine.instance_download_failed": { label: "Download failed", icon: "octagon-alert", tone: "danger" },
  "engine.instance_deploy_failed":   { label: "Deploy failed",   icon: "octagon-alert", tone: "danger" },
  "engine.instance_announcement_sent": { label: "Announcement sent", icon: "megaphone", tone: "info" },
};

// The pill drawn for an action with no entry above.
const ACTION_META_FALLBACK = { label: "", icon: "circle-dot", tone: "info" };

function actionMeta(action) {
  return ACTION_META[action] || { ...ACTION_META_FALLBACK, label: action };
}

// How loud each tone reads. success and info sit together at the floor: neither is louder than the
// other, they just say different things about a routine fact.
const TONE_RANK = { success: 0, info: 0, update: 1, warn: 2, danger: 3 };
const SEVERITY_TONE = { success: "success", info: "info", warn: "warn", danger: "danger" };

// The tone one audit row renders in: the LOUDER of what its action means and what the record's own
// severity says. One action carries two outcomes often enough that a fixed tone per action would
// lie about one of them — an update that landed and one that could not, a crash being restarted
// from and one the supervisor gave up on, a threshold nudged and a threshold blown through. The
// API decides that weight per row, so a row never reads quieter than either half says.
//
// Severity is optional: the chat "Recent events" card builds its rows from the assistant's raw
// engine feed, which carries no shaped severity, and those fall back to the action's own tone.
function auditTone(ev) {
  const base = actionMeta(ev && ev.action).tone;
  const fromSeverity = SEVERITY_TONE[ev && ev.severity];
  if (!fromSeverity) return base;
  return TONE_RANK[fromSeverity] > TONE_RANK[base] ? fromSeverity : base;
}

function actionCategory(action) {
  return action.split(".")[0];
}

// The audit page's category filter reads this; an unlabelled category falls back to
// its own key, so a new one is a plain word rather than a missing option.
const CATEGORY_LABEL = {
  server:    "Server",
  player:    "Players",
  backup:    "Backups",
  network:   "Network",
  console:   "Console",
  config:    "Configuration",
  file:      "Files",
  blueprint: "Blueprints",
  library:   "Libraries",
  command:   "Commands",
  service:   "Services",
  host:      "Hosts",
  engine:    "Engine",
  assistant: "Assistant",
  auth:      "Auth",
  user:      "Accounts",
  identity:  "Identities",
};

// Every category the vocabulary can produce, in the order the filter offers them. Hardcoded rather
// than derived from what is loaded: the filter is pushed to the API, so a category absent from the
// page in hand may still have rows behind the cursor, and deriving would hide exactly those.
const AUDIT_CATEGORIES = [
  "server", "player", "backup", "network", "console", "config", "file", "blueprint",
  "library", "command", "service", "host", "engine", "assistant", "auth", "user", "identity",
];

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
  ACTION_META,
  AUDIT_CATEGORIES,
  CATEGORY_LABEL,
  actionCategory,
  actionMeta,
  auditTone,
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
