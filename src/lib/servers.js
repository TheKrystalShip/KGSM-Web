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

export { fleetSummary, hostAvailabilityLabel, instancesOfBlueprint, offeringHosts, playerTally, PHASE_LABEL, serverStatusLabel, STATUS_LABEL };
