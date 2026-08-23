import { uptimeShort } from "./formatting.js";
// servers.js — shared server-related pure helpers, extracted from page files.

// ---------- Blueprint matching ----------

// Servers created from a catalog blueprint — the SINGLE match rule, shared by the
// blueprint detail page AND the library cards/counts so they can never drift.
// Match on the backend blueprint id; the rawg_slug branch is a fallback, guarded
// non-null on both sides or two slug-less servers (rawg_slug:null) would match
// EVERY blueprint via null === null (a data-corruption bug).
function instancesOfBlueprint(game, servers) {
  return (servers || []).filter(s =>
    (s.blueprint && s.blueprint === game.id) ||
    (s.rawg_slug && game.rawg_slug && s.rawg_slug === game.rawg_slug) ||
    s.id === game.id);
}

// ---------- Presence ----------

// How many people are on a set of servers, and how honestly that number can be stated.
//
// `players` is null for a server this host can't see the presence of — the game declares no
// join/leave detection, or the supervisor couldn't be asked. Those add NOTHING to the sum: a null
// summed as 0 is a figure nobody measured, sitting inside a total that reads as measured. They are
// counted separately instead, so a surface can say how much of the fleet it can't see.
//
// A measurably stopped server is never counted as unseen: nobody is connected to a process that
// isn't running, so its unknown presence takes nothing away from the total.
function playerTally(servers) {
  const list = servers || [];
  return {
    total: list.reduce((n, s) => n + (s.players ? s.players.current : 0), 0),
    unseen: list.filter(s => !s.players && s.status !== "offline").length,
  };
}

// The dashboard's one-line state of the fleet: what's up, who's on, and what can't be seen.
function fleetSummary(servers) {
  const list = servers || [];
  const online = list.filter(s => s.status === "online").length;
  const { total, unseen } = playerTally(list);
  return `${online} of ${list.length} servers online · `
    + `${total} ${total === 1 ? "player" : "players"} connected right now`
    + (unseen > 0 ? ` · ${unseen} ${unseen === 1 ? "server can't" : "servers can't"} report who's on.` : ".");
}

// ---------- Host availability ----------

// A blueprint is offered by one or more connected hosts. `game.hosts` (a list
// of host ids) names them; ABSENT means "offered everywhere" (identical catalog
// across the fleet — the common case). Only a subset is worth surfacing.
function offeringHosts(game, allHosts) {
  const ids = Array.isArray(game.hosts) ? game.hosts : null;
  if (!ids) return allHosts || [];
  return (allHosts || []).filter(h => ids.includes(h.id));
}

// Short label shown on the card / detail page — null when the game is on every
// host (nothing to flag). One host → "Primary only"; a subset → "2 of 3 hosts".
function hostAvailabilityLabel(game, allHosts) {
  const all = allHosts || [];
  const off = offeringHosts(game, all);
  if (!all.length || off.length >= all.length || off.length === 0) return null;
  if (off.length === 1) return off[0].name + " only";
  return off.length + " of " + all.length + " hosts";
}


// ---------- How long a server has been in its current run-state ----------

// The duration the status pill carries as its second segment, or null when nothing dates the run —
// in which case the pill renders as the single-segment one that has always shipped.
//
// Both timestamps come off the DTO, joined by the backend from the run-state AUTHORITY: the watchdog's
// persisted spawn time for a running instance, and its durable run ledger for a stopped one. That is
// deliberately not the audit feed — the feed is a capped page, so deriving a duration from it would
// quietly stop dating any server that has been down longer than the page reaches back, and would report
// a different answer depending on how much history happened to be loaded.
//
// Only the two settled states are dated. A transitional one (Starting, Updating…, Restarting…) is
// measured in seconds and reporting its age is noise, not information.
function serverRunDuration(server) {
  if (!server) return null;
  const ts = server.status === "online" ? server.startedAt
    : server.status === "offline" ? server.stoppedAt
      : null;
  if (!ts) return null;
  const ms = Date.now() - new Date(ts).getTime();
  // A timestamp in the future, or one that does not parse, dates nothing — say so by not splitting,
  // rather than rendering "—" inside a pill where it would read as a measured value.
  if (!isFinite(ms) || ms < 0) return null;
  return uptimeShort(ts);
}


// ---------- Can this node run that blueprint ----------

// The node with the most free memory, as { host, freeGb }, or null when nothing reports it.
// One figure for the whole page: the headroom is a fact about a MACHINE, so stating it per card would
// print the same number once per blueprint. The page header says it once and the cards compare to it.
function fleetHeadroom(allHosts) {
  let best = null;
  for (const h of allHosts || []) {
    const freeGb = h && h.ram ? h.ram.free_gb : null;
    if (freeGb == null) continue;
    if (!best || freeGb > best.freeGb) best = { host: h, freeGb };
  }
  return best;
}

// How a blueprint's recommended memory compares to that headroom, or null when either side is
// unknown — a blueprint declaring no recommendation gets no verdict rather than one computed against
// a guess.
//
// ⚠ This is a COMPARISON of two measured numbers, never a promise. Free memory moves the moment
// anything else starts, so the loud case says "tight" rather than "won't fit", and no card ever
// refuses to deploy on the strength of it.
const FIT_TIGHT_RATIO = 0.85;
function blueprintFit(game, headroom) {
  const recMb = game && game.specs ? game.specs.recommendedRamMb : null;
  if (recMb == null || !headroom) return null;
  const needGb = recMb / 1024;
  return {
    needGb,
    freeGb: headroom.freeGb,
    hostName: headroom.host ? headroom.host.name : null,
    tight: needGb > headroom.freeGb * FIT_TIGHT_RATIO,
  };
}

// ---------- What a busy server's pill says ----------

// The word for a run-state, including the derived busy ones the store folds a job
// into (stores/servers.js owns that derivation; this only names the result).
const STATUS_LABEL = {
  starting:    "Starting",
  updating:    "Updating…",
  stopping:    "Stopping…",
  restarting:  "Restarting…",
  installing:  "Installing…",
  "backing-up": "Backing up…",
  restoring:   "Restoring…",
  uninstalling: "Uninstalling…",
  moving:      "Moving…",
  // Its disk is not mounted. Deliberately not a run-state word: the server is neither running nor
  // stopped, it is unreachable, and the engine refuses every verb on it until the library returns.
  "library-offline": "Disk offline",
};

// The step a long run is on, when the engine reports one. An install and an update
// do the same work — download the game, lay it down — and the engine emits the same
// phases for both, so the same three words serve either. It is the difference
// between a card that says "Updating…" for twenty minutes and one that says what it
// is actually doing.
const PHASE_LABEL = {
  preparing:   "Preparing…",
  downloading: "Downloading…",
  deploying:   "Deploying…",
};

// What the pill reads for a server: the phase when the engine has reported one for
// the run that owns it, else the status's own word, else the raw status (an unknown
// state is shown as-is rather than hidden — the backend is allowed to grow one).
//
// The phase only speaks for a LIVE job: a settled one leaves its last phase on the
// row, and "Downloading…" under an idle server would be a sentence about something
// that finished.
function serverStatusLabel(server) {
  if (!server) return "";
  const job = server.job;
  const live = !!job && !!job.state && job.state !== "done";
  if (live && PHASE_LABEL[job.phase]) return PHASE_LABEL[job.phase];
  return STATUS_LABEL[server.status] || server.status;
}

// ---------- Identity: the label and the id ----------

// The longest label kgsm-api stores. Mirrored here so a form can say so while typing; the backend
// measures what it will actually store (after stripping control characters) and REJECTS rather than
// truncating, so this is a courtesy and never the authority.
const DISPLAY_NAME_MAX = 200;

// The engine's id length limit.
const INSTANCE_ID_MAX = 64;

// The candidate id a label would install under — a mirror of kgsm-api's `InstanceIdSlug`, so a create
// form can show what it is about to ask for instead of leaving the id a surprise. Lower-cased ASCII
// alphanumerics, every other run collapsing to a single "-", never leading or trailing one, capped at
// the engine's 64.
//
// It is ADVISORY. The backend re-derives it and the engine decides — it validates the charset and it
// owns the roster, so a slug that collides falls through to the engine's own `blueprint`/`blueprint-NN`
// rather than being disambiguated here. Null for a label that yields nothing usable (empty, or written
// entirely in characters the id charset has no place for), which is the same "let the engine mint one".
function instanceIdSlug(displayName) {
  if (!displayName) return null;
  let out = "";
  let pendingSeparator = false;
  const append = (ch) => {
    if (out.length >= INSTANCE_ID_MAX) return;
    if (pendingSeparator && out.length < INSTANCE_ID_MAX - 1) { out += "-"; pendingSeparator = false; }
    out += ch;
  };
  for (const c of displayName) {
    if ((c >= "a" && c <= "z") || (c >= "0" && c <= "9")) append(c);
    else if (c >= "A" && c <= "Z") append(c.toLowerCase());
    else pendingSeparator = out.length > 0;
  }
  return out.length === 0 ? null : out;
}

// Whether a string is an id the engine will accept: `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`. The same
// courtesy as the slug — the engine checks this itself, and it alone knows whether the id is taken.
function isValidInstanceId(id) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id || "");
}

export { blueprintFit, DISPLAY_NAME_MAX, fleetHeadroom, fleetSummary, hostAvailabilityLabel, INSTANCE_ID_MAX, instanceIdSlug, isValidInstanceId, serverRunDuration, instancesOfBlueprint, offeringHosts, playerTally, PHASE_LABEL, serverStatusLabel, STATUS_LABEL };
