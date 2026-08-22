// batch/preflight.js — what a run would do, worked out before it is fired.
//
// Rendered locally, decided remotely. Everything here is a PREDICTION the panel makes so it can
// explain itself: each node re-decides on arrival and its `refused[]` is the authority for its own
// servers. A row that goes offline between this partition and the submit is refused there and
// nowhere else, which is why the result surface reads the responses rather than assuming this held.
//
// It lives beside the components rather than in `lib/` because `verbGuard` does — one answer about
// whether a verb can run, shared by the hero, the tile, an alert card's suggested action and this.
// A second implementation here is exactly how a server comes to be refused in one place and offered
// in another.

import { verbGuard } from "../ServerActions.jsx";
import { capacityHint } from "../../lib/capacity.js";
import { serverOperable } from "../../lib/persona.js";

// The noun a verb is called by when a refusal has to name what is already happening. A refusal that
// does not name the action invites the caller to re-send the identical command.
const JOB_NOUN = {
  start: "start", stop: "stop", restart: "restart", update: "update",
  install: "install", uninstall: "uninstall",
  backup_create: "backup", backup_restore: "restore",
};

const article = (word) => (/^[aeiou]/i.test(word) ? "An " : "A ");

/// Why this server cannot take this verb right now, or null.
///
/// Three gates, in this order:
///
///   1. PERMISSION, which is not about the verb at all. A node's batch endpoint is Operator-gated for
///      the whole request, so a row on a node this person cannot operate has to be dropped before
///      dispatch rather than sent and 403'd — taking every other server on that node down with it.
///   2. WORK ALREADY IN FLIGHT, before the status gate, because it is the only one that names
///      something already under way. "A stop is queued for this server" tells an operator to wait,
///      where the status gate's "server is not running" describes the consequence of that same stop
///      and reads like a different problem.
///   3. THE STATUS GATE — `verbGuard`, mirroring kgsm-api's `CommandGate`.
///
/// The node re-decides all of this on arrival and may order it differently; its answer is what the
/// result screen reports.
function refusalFor(server, verb) {
  if (!serverOperable(server)) return "You can't operate servers on this node";

  const job = server.job;
  if (job && job.state && job.state !== "done") {
    const noun = JOB_NOUN[job.verb] || job.verb;
    return article(noun) + noun + (job.state === "queued" ? " is queued for this server" : " is already running on this server");
  }

  const guard = verbGuard(server, verb);
  if (guard.disabled) return guard.reason || "This verb can't run on this server right now";

  return null;
}

/// Split a selection into what would run and what would not, with the sentence for each refusal.
function partitionSelection(servers, verb) {
  const ready = [];
  const refused = [];
  for (const server of servers || []) {
    if (!server) continue;
    const reason = refusalFor(server, verb);
    if (reason) refused.push({ server, reason });
    else ready.push(server);
  }
  return { ready, refused };
}

/// How many players a run would disconnect, and how many servers could not say.
///
/// A sum that leaves out a server whose presence cannot be seen is a FLOOR, not a total — `unseen` is
/// what says so. Only stop and restart disconnect anybody.
function playersAffected(servers, verb) {
  if (verb !== "stop" && verb !== "restart") return { total: 0, unseen: 0 };
  let total = 0;
  let unseen = 0;
  for (const s of servers || []) {
    if (s.status !== "online") continue;
    const n = s.onlinePlayers;
    if (n == null) unseen++;
    else total += n;
  }
  return { total, unseen };
}

/// Does this selection take down every server that is currently running, anywhere in the fleet?
///
/// What the preflight's wording escalates on. Not the gesture: stop is reversible, and the one verb
/// that isn't — uninstall — is excluded from batching entirely, so a typed confirmation here would
/// buy ceremony on exactly the emergency the feature exists for.
function isWholeFleet(servers, fleet) {
  const online = (fleet || []).filter((s) => s.status === "online");
  if (!online.length) return false;
  const picked = new Set((servers || []).map((s) => s.id));
  return online.every((s) => picked.has(s.id));
}

/// Walk a start selection cumulatively and say what each member would be judged against.
///
/// `capacityHint` answers this for ONE server against a live `MemAvailable` reading, which is right
/// for a person clicking one button — by the time they click the next, the last server has taken what
/// it needs. It does not compose over a set: six members dispatched in quick succession each measure a
/// node that still looks nearly empty. So each member's requirement is subtracted from its node's free
/// figure before the next member is judged.
///
/// This is a FORECAST, and it states figures and no verdict. The engine decides at the instant it acts
/// — the watchdog's own reservation ledger does the authoritative arithmetic, for every caller — and
/// this exists so the refusal is not the first anyone hears of it. Every honesty rule `capacityHint`
/// holds still holds: a member that declares no requirement commits nothing, because the gate itself
/// allows such a start rather than inventing a figure, and a node with no reading yields no hint at all.
function capacityForecast(servers, hosts, verb) {
  if (verb !== "start") return { rows: [], tight: [], measured: 0 };
  const committedMb = new Map();
  const rows = [];
  for (const server of servers || []) {
    const host = (hosts || []).find((h) => h.id === server.hostId) || null;
    const alreadyMb = committedMb.get(server.hostId) || 0;
    // Subtract what this run has already committed on this node. Number.isFinite, not `>= 0`:
    // `null >= 0` is true in JavaScript, and an absent reading must stay absent rather than becoming
    // a free node with zero memory.
    const adjusted = host && host.ram && Number.isFinite(host.ram.free_mb)
      ? { ...host, ram: { ...host.ram, free_mb: host.ram.free_mb - alreadyMb } }
      : host;
    const hint = capacityHint(server, adjusted);
    rows.push({ server, hint, committedBeforeMb: alreadyMb });
    if (hint) committedMb.set(server.hostId, alreadyMb + hint.requiredMb);
  }
  return {
    rows,
    tight: rows.filter((r) => r.hint && r.hint.tight),
    measured: rows.filter((r) => r.hint).length,
  };
}

export { capacityForecast, isWholeFleet, partitionSelection, playersAffected, refusalFor };
