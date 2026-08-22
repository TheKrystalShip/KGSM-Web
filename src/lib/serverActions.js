// serverActions.js — running a lifecycle verb against a server, from anywhere.
//
// The optimistic patch, the rollback and the error wording are not presentation: they are what the
// action IS, and every surface that offers a Start button has to do all three or it lies about what
// happened. Holding them in the shell as a callback meant only a component the shell could reach
// was allowed to offer one — which stops working the moment a card can be pinned to the dashboard,
// with no shell above it to be handed anything.
//
// So this is a module, not a context: it needs nothing from React, and a call site imports it the
// same way it imports the store it is already reading.

import { api } from "./apiClient.js";
import { sessionStore } from "./sessionStore.js";
import { awaitJob, commandServer, serversStore } from "./stores.js";
import { toast } from "./toasts.js";

// A verb that came back 401 after the seam already replayed it means that host's session is
// genuinely gone rather than merely lapsed. Marking it expired is all this does — the seam's
// 30-second grace then decides whether it healed. Reacting harder would log somebody out over one
// unlucky request.
function noteAuthFailure(hostId) {
  if (hostId) sessionStore.expire(hostId);
}

// A 401 is already answered by the reauth modal. Anything else has a reason the caller can act on —
// a port clash, a command already in flight — and is worth saying out loud.
function reportFailure(err, verb, server) {
  if (err && err.code === 401) noteAuthFailure(server.hostId);
  else toast.fromError(err, "Couldn't " + verb + " " + (server.name || server.id));
}

/// Watch the job a command was accepted for, and say so if it ends in failure.
///
/// A REFUSED command and a FAILED one arrive by completely different routes, and only the first was
/// ever reported. A command the API rejects outright — a bad verb, a busy server — rejects the POST,
/// and `reportFailure` above answers it. A command the API ACCEPTS returns 202 and then does the work
/// off-request: the engine's own refusals live there, and their reason reaches the client on the
/// settled job's `error` rather than as a rejected promise. Without this, a start the engine turned
/// down looked exactly like one that never happened — the button spun "Starting…", the settle frame
/// cleared it, and the server sat at offline with the reason nowhere on screen.
///
/// The engine's sentence is shown VERBATIM as the detail. It is the half that says what to do about
/// it — "stop another instance, lower this instance's memory_cap_mb, or start it anyway with
/// --force" — and rewording it here would replace an answer with a paraphrase.
///
/// Scoped to the command THIS browser issued, deliberately. The `jobs` topic carries every job on the
/// host — the CLI's, the assistant's, another operator's — and toasting those would break what the
/// notifications tray is: what YOU did in THIS browser, and how it went. That is also why this hangs
/// off the POST's own response rather than off the stream.
function reportJobOutcome(resp, verb, server) {
  const jobId = resp && resp.job && resp.job.id;
  if (!jobId) return resp;

  return awaitJob(jobId, server.hostId).then((outcome) => {
    // Only a SETTLED failure is reported. `unknown` means the stream went away before the job
    // settled — the command may well have succeeded, and calling that a failure would invent an
    // outcome nobody observed.
    if (outcome && outcome.status === "failed") {
      toast.error("Couldn't " + verb + " " + (server.name || server.id), {
        detail: (outcome.job && outcome.job.error) || "The engine gave no reason.",
        serverId: server.id,
      });
    }
    return resp;
  }, () => resp); // watching an outcome must never turn a fired command into a failed one
}

/// Run a lifecycle verb. `target` is a server object or an id.
///
/// Returns the in-flight promise so a caller that wants to wait can, but the UI feedback is already
/// handled here — the common case is fire-and-forget.
/// `opts.force` overrides the ENGINE's node-capacity check (kgsm's --force), and reaches it as the
/// command body's `force`. It is only ever set by a person confirming a warned Start: the panel
/// predicts that a start looks too tight, says so on the button, and a second press is the operator
/// saying the prediction is wrong. Nothing sets it automatically — an automatic override would
/// silently remove the protection for everyone.
function runServerAction(action, target, opts) {
  const server = typeof target === "string" ? serversStore.find(target) : target;
  if (!server || !action) return Promise.resolve();
  // Only start has a capacity check to override; the API rejects the flag on any other verb, so it
  // is dropped here rather than sent and refused.
  const force = !!(opts && opts.force) && action === "start";

  // Start is the one verb with a status of its own to show. Patch it from the CLICK rather than from
  // the first frame that reports it, so the button never looks inert — and put it back if the
  // command is refused, since then nothing is starting.
  if (action === "start") {
    const prevStatus = server.status;
    serversStore.patch(server.id, { status: "starting" });
    return commandServer(server, action, "ui", force)
      .then(resp => reportJobOutcome(resp, "start", server))
      .catch(err => {
        reportFailure(err, "start", server);
        const cur = serversStore.find(server.id);
        if (cur && cur.status === "starting") serversStore.patch(server.id, { status: prevStatus });
      });
  }

  // These three run long enough to need showing: an update for minutes, a shutdown for as long as
  // the game takes to drain and save, a restart for both plus the boot. Same reasoning as start —
  // own the server with the job from the click, and drop it again if the command is refused.
  if (action === "update" || action === "stop" || action === "restart") {
    serversStore.patch(server.id, { job: { verb: action, state: "running" } });
    return commandServer(server, action)
      .then(resp => reportJobOutcome(resp, action, server))
      .catch(err => {
        reportFailure(err, action, server);
        serversStore.patch(server.id, { job: null });
      });
  }

  return commandServer(server, action)
    .then(resp => reportJobOutcome(resp, action, server))
    .catch(err => reportFailure(err, action, server));
}

/// Ask a node to take a backup of one server. Returns the raw response, job and all.
///
/// The POST alone, deliberately: a surface with its own busy state and its own error line — the
/// Backups tab — wants to own the waiting and the reporting, and wrapping those in here would make
/// it await the job twice.
function requestBackup(target) {
  const server = typeof target === "string" ? serversStore.find(target) : target;
  if (!server) return Promise.reject(new Error("no such server"));
  return api.host(server.hostId).post("/servers/" + server.id + "/backups", { origin: "ui" });
}

/// Take a backup and see it through, reporting failure itself.
///
/// For a surface with nowhere to render an error — the command palette has a row and a chin, and
/// both are gone the moment it closes. Same reasoning as `runServerAction` above: an action offered
/// where there is no component to catch the outcome has to carry the outcome with it.
function backupServer(target) {
  const server = typeof target === "string" ? serversStore.find(target) : target;
  if (!server) return Promise.resolve();
  return requestBackup(server)
    .then((resp) => {
      const job = resp && resp.job;
      return job && job.id ? awaitJob(job.id, server.hostId) : null;
    })
    .catch((err) => { reportFailure(err, "back up", server); });
}

export { backupServer, noteAuthFailure, requestBackup, runServerAction };
