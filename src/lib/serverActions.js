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

import { sessionStore } from "./sessionStore.js";
import { commandServer, serversStore } from "./stores.js";
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

/// Run a lifecycle verb. `target` is a server object or an id.
///
/// Returns the in-flight promise so a caller that wants to wait can, but the UI feedback is already
/// handled here — the common case is fire-and-forget.
function runServerAction(action, target) {
  const server = typeof target === "string" ? serversStore.find(target) : target;
  if (!server || !action) return Promise.resolve();

  // Start is the one verb with a status of its own to show. Patch it from the CLICK rather than from
  // the first frame that reports it, so the button never looks inert — and put it back if the
  // command is refused, since then nothing is starting.
  if (action === "start") {
    const prevStatus = server.status;
    serversStore.patch(server.id, { status: "starting" });
    return commandServer(server, action).catch(err => {
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
    return commandServer(server, action).catch(err => {
      reportFailure(err, action, server);
      serversStore.patch(server.id, { job: null });
    });
  }

  return commandServer(server, action).catch(err => reportFailure(err, action, server));
}

export { noteAuthFailure, runServerAction };
