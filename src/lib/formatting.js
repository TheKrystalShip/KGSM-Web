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

// Icon + tone per audit action, keyed by the dotted action the API emits. An action
// with no entry still renders — a neutral dot with the raw action as its own label —
// so a backend that grows a new one is never a broken row. That fallback is the
// forward-compat floor, not the target: an action nobody maps reads as indistinct
// from every other unmapped one, which is exactly how a port opening and a router
// forward came to look like the same grey dot.
//
// Tone is the reader's severity cue, so it tracks what the action DOES rather than
// whether it succeeded: a door opening is `info`, a door closing is `warn`, and the
// two firewall/router pairs share their tones because they are the same fact about
// two different doors.
const ACTION_META = {
  "server.install":        { label: "Server installed",   icon: "package-plus",  tone: "success" },
  "server.start":          { label: "Server started",     icon: "play",          tone: "success" },
  // Its own row, not a repeat of the start above it: that one says the process spawned, this says
  // the game will accept a connection, and on a big world the two are minutes apart.
  "server.ready":          { label: "Ready to play",      icon: "circle-check",  tone: "success" },
  "server.stop":           { label: "Server stopped",     icon: "square",        tone: "danger"  },
  "server.restart":        { label: "Server restarted",   icon: "rotate-cw",     tone: "update"  },
  "server.update":         { label: "Server updated",     icon: "download",      tone: "info"    },
  "server.crash":          { label: "Server crashed",     icon: "alert-triangle",tone: "danger"  },
  "server.update_available":{label: "Update available",   icon: "circle-arrow-up",tone: "info"   },
  "server.rename":         { label: "Server renamed",     icon: "pencil",        tone: "info"    },
  "server.delete":         { label: "Server deleted",     icon: "trash-2",       tone: "danger"  },
  // network.* — the two doors an instance's ports pass through, deliberately distinct:
  // ports.* is the HOST firewall rule, upnp.* is the router's NAT forward. A host can
  // hold one without the other, so they never share an icon.
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
  "player.allow.add":      { label: "Allowlist updated",  icon: "user-check",    tone: "info"    },
  "player.allow.remove":   { label: "Allowlist updated",  icon: "user-x",        tone: "warn"    },
  "backup.create":         { label: "Backup created",     icon: "database",      tone: "success" },
  "backup.restore":        { label: "Backup restored",    icon: "rotate-ccw",    tone: "warn"    },
  "backup.delete":         { label: "Backup deleted",     icon: "trash-2",       tone: "danger"  },
  "backup.prune":          { label: "Backups pruned",     icon: "archive-x",     tone: "info"    },
  "backup.download":       { label: "Backup downloaded",  icon: "download",      tone: "info"    },
  "file.write":            { label: "File saved",         icon: "file-pen",      tone: "info"    },
  "file.edit":             { label: "File edited",        icon: "file-pen",      tone: "info"    },
  "file.upload":           { label: "File uploaded",      icon: "upload",        tone: "info"    },
  "file.delete":           { label: "File deleted",       icon: "trash-2",       tone: "danger"  },
  "blueprint.write":       { label: "Blueprint edited",   icon: "file-code",     tone: "info"    },
  "blueprint.revert":      { label: "Blueprint reverted", icon: "rotate-ccw",    tone: "warn"    },
  "config.set":            { label: "Setting changed",    icon: "sliders-horizontal", tone: "info" },
  "console.input":         { label: "Console command",    icon: "terminal",      tone: "warn"    },
  "service.connect":       { label: "Leaf connected",     icon: "plug",          tone: "success" },
  "service.disconnect":    { label: "Leaf disconnected",  icon: "unplug",        tone: "warn"    },
  "service.config":        { label: "Leaf reconfigured",  icon: "settings",      tone: "info"    },
  "settings.change":       { label: "Settings changed",   icon: "settings",      tone: "info"    },
  "host.connect":          { label: "Host connected",     icon: "power",         tone: "success" },
  "host.disconnect":       { label: "Host disconnected",  icon: "power-off",     tone: "warn"    },
  "host.update":           { label: "Host updated",       icon: "package",       tone: "info"    },
  "host.add":              { label: "Host added",         icon: "server-cog",    tone: "success" },
  "host.remove":           { label: "Host removed",       icon: "trash-2",       tone: "danger"  },
  "auth.login":            { label: "Signed in",          icon: "log-in",        tone: "info"    },
  "auth.logout":           { label: "Signed out",         icon: "log-out",       tone: "info"    },
  "auth.session.revoke":   { label: "Session revoked",    icon: "user-minus",    tone: "info"    },
  "auth.session.revoke.all":{label: "All sessions revoked",icon: "users",        tone: "warn"    },
  // An admin ending SOMEONE ELSE's session — louder than the two self-service rows
  // above, which is why the API stamps it warn-severity upstream too.
  "auth.session.revoke.admin":{label:"Session revoked (admin)",icon:"shield-off",tone: "danger"  },
  "auth.cluster_session":  { label: "Cluster sign-in",    icon: "network",       tone: "info"    },
  "auth.token.create":     { label: "API token created",  icon: "key",           tone: "info"    },
  "discord.webhook.update":{ label: "Discord updated",    icon: "message-circle",tone: "info"    },
};

function actionCategory(action) {
  return action.split(".")[0];
}

// The audit page's category filter reads this; an unlabelled category falls back to
// its own key, so a new one is a plain word rather than a missing option.
const CATEGORY_LABEL = {
  server:    "Server",
  player:    "Players",
  network:   "Network",
  backup:    "Backups",
  file:      "Files",
  blueprint: "Blueprints",
  config:    "Configuration",
  console:   "Console",
  service:   "Services",
  settings:  "Settings",
  auth:      "Auth",
  discord:   "Discord",
  host:      "Hosts",
};

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
  CATEGORY_LABEL,
  actionCategory,
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
