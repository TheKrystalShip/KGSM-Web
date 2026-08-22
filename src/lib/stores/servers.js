// stores/servers.js — Game servers, jobs, command actions, game name resolution.

import { adaptPhantom } from "../adapters.js";
import { api, realtimeStore } from "../apiClient.js";
import * as merge from "../merge.js";
import { createStore } from "../store.js";
import { libraryStore } from "./library.js";

// ---- Game servers -------------------------------------------------------

// A job is what is being DONE to a server; status is what the server IS. The backend keeps them apart
// (its status vocabulary is run-state only — running/starting/stopped/unknown), and this module is the
// ONE place they are joined: while a job owns a server, the row's status reads as that job's state, so
// every surface — the hero pill, the tiles, the sidebar dot, the filters — shows the operation in
// progress without each of them re-deriving it.
//
// Every verb here is one whose run-state alone reads WRONG for as long as the job lasts: a server being
// shut down is still genuinely "running" (the process is up, draining and saving its world), an
// instance being updated is genuinely "stopped", and one being restarted reads as whichever side of
// the bounce it happens to be on — none of that is what an operator who just pressed the button needs
// to see. An instance being installed is the sharpest case of all: the engine writes its config before
// it downloads a byte, so it joins the roster measurably-stopped while several minutes of download
// remain, and its run-state says "offline" about a server that has never existed. `start` is the one
// lifecycle verb absent, because the backend already has an honest run-state for it: "starting", the
// watchdog's own boot window, which says more than a job would.
const JOB_STATUS = {
  install: "installing", update: "updating", stop: "stopping", restart: "restarting",
  // The two backup verbs. Archiving or replacing a world is minutes on a large one, and the engine
  // now brackets both, so a run driven from the CLI or the scheduler arrives here as a job like any
  // other — and a row that reads plain "Online" through it invites somebody to restart the server
  // out from under an archive being written.
  backup_create: "backing-up", backup_restore: "restoring",
};

// How long a job we know about locally survives a server frame that carries none. The backend carries the
// active job on every server read, so an in-flight job normally re-arrives with each frame; this window
// only covers the gap between issuing a command and the first frame that includes it (a frame built
// before the command landed would otherwise wipe the state the operator just triggered).
const JOB_GRACE_MS = 15000;

const jobIsLive = (job) => !!job && !!job.state && job.state !== "done";

// A job OWNS the row's status only once it is actually working. A queued one has not started: the
// server is still exactly what it was, and reading a queued stop as "Stopping…" would put a
// transitional pill on a server that is running normally and may stay queued for as long as the work
// ahead of it takes. What a queued job changes is the BUTTONS — the verb is committed, and the row
// says so by naming its place in the line — not the state it reports about the server.
const jobOwnsStatus = (job) => jobIsLive(job) && job.state !== "queued";

// A row belongs to an install that has not landed yet. This — not "no backend row has arrived" — is
// what makes a tile a phantom: the engine publishes the instance the moment it writes its config,
// roughly a minute before the download finishes, so a row can be fully hydrated and still be a server
// nobody can start. The job settling is what ends it.
const installInFlight = (job) => jobIsLive(job) && job.verb === "install";

// Merge a partial into a row and re-derive its display status. `status` in the partial is the
// authoritative run-state the backend just reported — it is kept verbatim as `runStatus` so the derived
// value can never be mistaken for it, and so the real state comes back the moment the job settles.
// `at` stamps when we last had evidence the job is live (see pickJob).
//
// An install in flight also forces the row to render as a phantom, wherever it came from — a backend
// frame, a REST re-hydrate, a browser that opened the panel halfway through someone else's install.
// Deriving it here rather than at each call site is what makes that one rule instead of three.
function applyPatch(row, partial) {
  const next = partial ? { ...row, ...partial } : { ...row };
  next.runStatus = partial && "status" in partial ? partial.status : (row.runStatus ?? row.status);
  const live = jobIsLive(next.job);
  if (live && next.job.at == null) next.job = { ...next.job, at: Date.now() };
  next.status = (jobOwnsStatus(next.job) && JOB_STATUS[next.job.verb]) || next.runStatus;
  if (installInFlight(next.job)) next._phantom = true;
  return next;
}

// Which job a fresh backend frame leaves on the row. The frame is authoritative when it names one;
// when it names none, a job we learned about moments ago is kept until the window lapses — after that
// the backend's "nothing in flight" wins, so a settle we somehow never saw can't strand the row.
function pickJob(existing, incoming) {
  if (incoming) return { ...incoming, at: Date.now() };
  if (jobIsLive(existing) && Date.now() - (existing.at || 0) < JOB_GRACE_MS) return existing;
  return null;
}

const serversStore = createStore({
  list: [],
  status: "loading",
  error: null,
  everLoaded: false,
});

serversStore.patch = (id, partial) =>
  serversStore.setState(s => ({ ...s, list: s.list.map(x => (x.id === id ? applyPatch(x, partial) : x)) }));
serversStore.add = (server) =>
  serversStore.setState(s => ({ ...s, list: [...s.list, applyPatch(server, null)] }));
serversStore.find = (id) =>
  serversStore.getState().list.find(x => x.id === id) || null;
serversStore.remove = (id) =>
  serversStore.setState(s => ({ ...s, list: s.list.filter(x => x.id !== id) }));

// Apply one roster metric frame (the `servers/metrics` topic — see adapters.adaptServerMetricsRoster).
// The whole roster lands in ONE setState so a frame costs one render pass, not one per server.
//
// It touches the metric fields and nothing else. Run-state, jobs and every derived display value stay
// exactly as the `servers` topic left them: a metric feed never gets to say what a server IS, and a
// server the frame omits keeps what it already holds rather than being blanked — the monitor having
// nothing to say about an instance is not a reading of zero.
//
// Scoped to the node whose stream delivered the frame, since ids are only unique per host.
serversStore.mergeRosterMetrics = (rows, hostId) => {
  if (!Array.isArray(rows) || !rows.length) return;
  const byId = new Map(rows.map(r => [r.id, r]));
  serversStore.setState(s => ({
    ...s,
    list: s.list.map(x => {
      if (hostId && x.hostId && x.hostId !== hostId) return x;
      const row = byId.get(x.id);
      if (!row) return x;
      const m = row.metrics;
      return {
        ...x,
        metrics: m,
        cpu: m ? Math.round(m.cpu) : null,
        ram: m ? { used: Math.round(m.memBytes / 1e7) / 100, max: null } : null,
        rxBps: m ? m.rxBps : null,
        txBps: m ? m.txBps : null,
        diskBytes: row.diskBytes,
      };
    }),
  }));
};

serversStore.addPhantom = (id, { blueprint, cover, hero, displayName, hostId } = {}) => {
  if (serversStore.find(id)) return;
  serversStore.add(adaptPhantom({ id, blueprint, cover, hero, displayName, hostId }));
};

serversStore.refresh = () => {
    serversStore.setState(s => ({ ...s, status: "loading", error: null }));
    return api.fanOut("/servers").then(results => {
      const okr = results.filter(r => r.ok);
      if (results.length && !okr.length) { const err = results[0].err; serversStore.setState(s => ({ ...s, status: "error", error: err })); throw err; }
      const list = merge.mergeServers(okr.map(r => r.data));
      serversStore.setState(s => {
        const cur = new Map(s.list.map(x => [x.id, x]));
        const next = list.map(srv => {
          const c = cur.get(srv.id);
          // A row we hold no live state for, or one still owned by an install: take the backend's
          // shape wholesale. A phantom's own status is a display value, never a run-state, so it is
          // the one row whose `status` must NOT carry over — but its job does, through the same grace
          // window every other path uses, so a read that raced the job's registration can't strand an
          // install that this client already knows is running.
          if (!c || c._phantom) return applyPatch({ ...srv, job: pickJob(c?.job, srv.job) }, null);
          // The stream is the fresher authority for the live fields, so a re-hydrate keeps what it put
          // there — including the run-state, which is why `runStatus` and not the derived `status` is
          // what carries over.
          return applyPatch({
            ...srv,
            status: c.runStatus ?? c.status,
            uptime: c.uptime,
            job: pickJob(c.job, srv.job),
            network: c.network,
          }, null);
        });
        const phantoms = s.list.filter(x => x._phantom && !next.some(r => r.id === x.id));
        return { ...s, list: [...next, ...phantoms], status: "ready", error: null, everLoaded: true };
      });
      resolveGameNames();
      return list;
    });
  };

serversStore.fetchDetail = (id, hostId) => {
  if (!id) return Promise.resolve(null);
  if (!hostId) return Promise.resolve(null);
  return api.host(hostId).get("/servers/" + id).then(be => {
    if (be && serversStore.find(id))
      serversStore.patch(id, { network: be.network || null, cover: be.cover ?? null, hero: be.hero ?? null });
    return be;
  }, () => null);
};

// Keep the store live from the server's `servers` channel
api.stream.subscribe(["servers"], (m) => {
  if (m.type === "server.patch" && m.data && m.data.id) {
    if (serversStore.find(m.data.id)) {
      const { id, ...patch } = m.data;
      const existing = serversStore.find(id);
      // A phantom the operator still has to see out owns its tile: an uninstall in flight (the row is
      // on its way out — there is nothing in the frame worth merging), and an install that failed and
      // is waiting to be dismissed. Everything else merges, including an install still running.
      if (existing?._phantom && (existing.job?.verb === "uninstall" || existing.status === "install-failed"))
        return;
      // The frame carries whatever job the backend has in flight for this server, so it is what
      // decides here — a running update survives every patch that lands mid-run, and the row goes
      // idle again the moment the backend says nothing owns it.
      const job = pickJob(existing?.job, patch.job);
      serversStore.patch(id, {
        ...patch,
        network: existing?.network ?? patch.network ?? null,
        cover:   existing?.cover   ?? patch.cover   ?? null,
        hero:    existing?.hero    ?? patch.hero    ?? null,
        // The handover, in one expression: the tile stays a phantom for exactly as long as the row's
        // own job says an install is running, and becomes an ordinary server on the first frame that
        // says otherwise. That frame is also the one carrying the real data, so nothing flips to a
        // finished card the backend hasn't described yet.
        _phantom: installInFlight(job),
        job,
      });
    } else {
      serversStore.add(m.data);
    }
    resolveGameNames();
  } else if (m.type === "server.removed" && m.data && m.data.id) {
    serversStore.setState(s => ({ ...s, list: s.list.filter(x => x.id !== m.data.id) }));
  }
});

// ---- Jobs (command outcomes) --------------------------------------------
// How many SETTLED jobs are kept per node. Live work is never dropped: one job in flight per server
// bounds queued and running by the roster itself, so only the settled tail can grow — and it grows
// for as long as a tab is open, fed by every node this browser is connected to. A node-wide run is
// the largest thing worth still seeing the end of (this cluster's biggest node runs seventeen
// servers), so the tail holds one of those plus the hand-issued commands around it, and nothing
// older. What happened before that is the audit log's question, not this store's.
const SETTLED_KEPT_PER_HOST = 25;

// `settled` is the ids of settled jobs in the order they settled, oldest first. It is the EVICTION
// order and nothing else — no surface lists settled work, because a settled command is an audit row.
// It bounds `byId`, which `awaitJob` reads while a command is in flight. A separate list rather than
// a sort key on the job, because `settledAt` is the NODE's clock and several nodes feed this store.
const jobsStore = createStore({ byId: {}, settled: [] });

jobsStore.upsert = (job) => {
  if (!job || !job.id) return;
  jobsStore.setState(s => {
    const prev = s.byId[job.id];
    // A job's origin never changes, so a frame that carries none — the dev dispatch hook is the only
    // one — must not erase the node already recorded for it.
    const next = { ...prev, ...job, hostId: job.hostId ?? (prev && prev.hostId) ?? null };
    const byId = { ...s.byId, [job.id]: next };
    if (next.state !== "done" || (prev && prev.state === "done")) return { ...s, byId };

    // It settled just now: it joins the tail, and the tail is trimmed per node.
    const settled = [...s.settled, job.id];
    const kept = [];
    const seen = {};
    for (let i = settled.length - 1; i >= 0; i--) {
      const held = byId[settled[i]];
      if (!held) continue;
      const key = held.hostId || "_unattributed";
      seen[key] = (seen[key] || 0) + 1;
      if (seen[key] > SETTLED_KEPT_PER_HOST) delete byId[settled[i]];
      else kept.push(settled[i]);
    }
    kept.reverse();
    return { ...s, byId, settled: kept };
  });
};
jobsStore.get = (id) => (id ? jobsStore.getState().byId[id] || null : null);

// What a job frame leaves on its server's row. `batchId`/`queuedPosition` ride along because a queued
// job is only legible with them — ten servers all reading "queued" say nothing about which moves next.
const rowJob = (d) => ({
  verb: d.verb, state: d.state,
  batchId: d.batchId ?? null,
  queuedPosition: d.queuedPosition ?? null,
});

api.stream.subscribe(["jobs"], (m) => {
  if ((m.type === "job" || m.type === "job.patch") && m.data) {
    // The envelope knows which node delivered the frame; the job DTO has no such field and inventing
    // one would misstate where it came from. Carrying it onto the stored job is what makes a per-node
    // job list a filter rather than a lookup through the roster for every row — and it is the only
    // thing that still names the node once a job's server is gone, which an uninstall's is.
    jobsStore.upsert({ ...m.data, hostId: m.hostId ?? null });
    const { serverId, verb, state, phase, blueprint } = m.data;

    if (verb === "install") {
      if (state !== "done" && !serversStore.find(serverId)) {
        const lib = libraryStore.getState().list || [];
        const gameEntry = blueprint ? lib.find(g => g.id === blueprint) : null;
        serversStore.addPhantom(serverId, {
          blueprint,
          cover:       gameEntry?.cover ?? null,
          hero:        gameEntry?.hero  ?? null,
          displayName: gameEntry?.name  ?? blueprint,
          // The node is the one whose stream delivered this job — the install is
          // running there, measured, not inferred from list order. A frame with no
          // origin leaves the row's node unknown; the real one arrives with the
          // server.patch that replaces this placeholder.
          hostId:      m.hostId ?? null,
        });
      }
      if (state === "done") {
        // Clear the job on BOTH outcomes — a settled job never keeps owning the row. The tile itself
        // is handed over by the verify `server.patch` the backend pushes on the same settle, NOT
        // here: that frame is the one carrying the finished server, so the card can never flip to a
        // completed install the backend hasn't described yet. A failure keeps the phantom — there is
        // no finished server to hand over to — and holds the tile until it is dismissed.
        serversStore.patch(serverId, m.data.error
          ? { status: "install-failed", job: null }
          : { job: null });
      } else {
        serversStore.patch(serverId, { job: { ...rowJob(m.data), phase: phase ?? null } });
      }
    } else if (verb === "uninstall") {
      if (state === "done") {
        if (m.data.error) {
          serversStore.patch(serverId, { _phantom: false, job: null });
        }
      } else {
        serversStore.patch(serverId, { _phantom: true, job: rowJob(m.data) });
      }
    } else if (verb === "update") {
      if (state === "done") {
        // On a successful update, the game is now on the latest build. kgsm re-reads its own record
        // and the verify server.patch that follows ~200ms later carries the cleared state; this
        // optimistic patch only closes that window, so it clears the chip and nothing else.
        //
        // It deliberately does NOT touch update_checked_at. That timestamp is when the ENGINE last
        // fetched an upstream version, which is the scheduler's sweep, not this moment — stamping
        // "now" here would make the panel claim a freshness nobody measured, and the honest value
        // arrives on the verify patch regardless.
        if (!m.data.error) {
          serversStore.patch(serverId, { job: null, update_available: null });
        } else {
          serversStore.patch(serverId, { job: null });
        }
      } else {
        serversStore.patch(serverId, { job: rowJob(m.data) });
      }
    } else {
      serversStore.patch(serverId, { job: state === "done" ? null : rowJob(m.data) });
    }
  }
});

// ---- Game metadata resolution (servers × library) ----------------------
function resolveGameNames() {
  const lib = libraryStore.getState().list || [];
  if (!lib.length) return;
  const byId = new Map(lib.map(g => [g.id, g]));
  const cur = serversStore.getState().list;
  let changed = false;
  const next = cur.map(srv => {
    const g = srv.blueprint ? byId.get(srv.blueprint) : null;
    if (!g) return srv;
    const name = g.name;
    const cover = g.cover ?? null;
    const hero = g.hero ?? null;
    if ((name && srv.game !== name) || (srv.cover ?? null) !== cover || (srv.hero ?? null) !== hero) {
      changed = true;
      return { ...srv, ...(name ? { game: name } : null), cover, hero };
    }
    return srv;
  });
  if (changed) serversStore.setState(s => ({ ...s, list: next }));
}
libraryStore.subscribe(resolveGameNames);
resolveGameNames();

// ---- Server write actions -----------------------------------------------
// `force` overrides the engine's node-capacity check and is start-only; the API refuses it on any
// other verb. Sent only when true, so a command body stays exactly what it was for every caller that
// does not ask — and a caller that does not ask keeps the protection.
function commandServer(server, verb, origin = "ui", force = false) {
  if (!server || !server.hostId) return Promise.reject(new Error("commandServer: server.hostId required"));
  const body = { verb, origin };
  if (force) body.force = true;
  return api.host(server.hostId).post("/servers/" + server.id + "/commands", body);
}

function sendConsoleInput(server, text, origin = "ui") {
  if (!server || !server.hostId) return Promise.reject(new Error("sendConsoleInput: server.hostId required"));
  return api.host(server.hostId).post("/servers/" + server.id + "/console", { input: text, origin });
}

// Moderate one player: action is "kick" | "ban" | "unban".
//
// We send the roster's playerIdentity and NOTHING else — no address, no name.
// The API resolves the identity against its own record of who has been on this
// server and builds the game's command from that, so a browser cannot name a
// target the roster never saw. Do not "helpfully" pass the address along here;
// the backend would rightly ignore it, and sending it invites the next reader
// to think the client is the authority on who gets banned.
function moderatePlayer(server, playerIdentity, action, origin = "ui") {
  if (!server || !server.hostId) return Promise.reject(new Error("moderatePlayer: server.hostId required"));
  if (!playerIdentity) return Promise.reject(new Error("moderatePlayer: playerIdentity required"));
  const path = "/servers/" + server.id + "/players/"
    + encodeURIComponent(playerIdentity) + "/" + action + "?origin=" + origin;
  return api.host(server.hostId).post(path, null);
}

// ---- Job awaiting -------------------------------------------------------
let _jobPollMs = 3000;
let _jobDeadMs = 30000;
let _jobLiveProbe = null;
function __setJobTiming(opts) {
  if (!opts) { _jobPollMs = 3000; _jobDeadMs = 30000; _jobLiveProbe = null; return; }
  if (opts.pollMs != null) _jobPollMs = opts.pollMs;
  if (opts.deadMs != null) _jobDeadMs = opts.deadMs;
  if ("liveProbe" in opts) _jobLiveProbe = opts.liveProbe;
}
function awaitJob(jobId, hostId) {
  return new Promise((resolve) => {
    if (!jobId) { resolve({ status: "unknown" }); return; }
    let settled = false, poll = null, dispose = null, downTicks = 0;
    const maxDownTicks = Math.max(1, Math.ceil(_jobDeadMs / _jobPollMs));
    const finish = (val) => {
      if (settled) return;
      settled = true;
      if (poll) { clearInterval(poll); poll = null; }
      if (dispose) dispose();
      resolve(val);
    };
    const evaluate = () => {
      const j = jobsStore.get(jobId);
      if (j && j.state === "done") finish({ status: j.error ? "failed" : "succeeded", job: j });
    };
    const socketUp = () => {
      try {
        if (_jobLiveProbe) return !!_jobLiveProbe(hostId);
        if (!hostId) return true;
        const rt = realtimeStore.getState();
        if (!rt.online) return false;
        const h = rt.hosts[hostId];
        return h ? h.mode === "live" : true;
      } catch { return true; }
    };
    const tick = () => {
      if (settled) return;
      if (socketUp()) { downTicks = 0; return; }
      if (++downTicks >= maxDownTicks) finish({ status: "unknown" });
    };
    dispose = jobsStore.subscribe(evaluate);
    poll = setInterval(tick, _jobPollMs);
    evaluate();
  });
}

// Where a server lands is a decision, never a default: the caller names the node
// (the install modal's measured pick, or the assistant's), and an install with no
// node is rejected rather than dropped on whichever host sorted first.
function installServer(cfg) {
  const hostId = (cfg && cfg.hostId) || null;
  if (!hostId) return Promise.reject(new Error("installServer: hostId required"));
  const body = { blueprint: cfg.game.id, name: cfg.name, origin: (cfg && cfg.origin) || "ui" };
  const port = Number(cfg.port);
  if (Number.isInteger(port) && port >= 1 && port <= 65535) body.port = port;
  body.autostart = !!cfg.autostart;
  return api.host(hostId).post("/servers", body);
}

// ---- Settings (Phase 0) -------------------------------------------------
function fetchSettings(hostId, serverId) {
  return api.host(hostId).get("/servers/" + serverId + "/settings");
}
function patchSettings(hostId, serverId, patch) {
  return api.host(hostId).patch("/servers/" + serverId + "/settings", patch);
}
// The operator-authored server note. Writing goes through the dedicated endpoint (not the config
// PATCH, which refuses the note's keys) so the backend owns the encoding and the attribution stamp.
// An empty body is a CLEAR → DELETE; the backend rejects an empty PUT deliberately, so that an
// accidentally-emptied editor can never silently wipe a note. Both paths return the fresh
// { serverId, note }, which is patched straight into the store so the card and the dashboard tile
// update without waiting for the stream.
function saveServerNote(hostId, serverId, body) {
  const text = (body || "").trim();
  const req = text
    ? api.host(hostId).put("/servers/" + serverId + "/note", { body: text, origin: "ui" })
    : api.host(hostId).del("/servers/" + serverId + "/note?origin=ui");

  return req.then(res => {
    const note = res?.note ?? null;
    if (serversStore.find(serverId))
      serversStore.patch(serverId, { note, notice: note?.body ?? "" });
    return note;
  });
}

function deleteServer(hostId, serverId, origin) {
  const qs = origin ? "?origin=" + encodeURIComponent(origin) : "";
  return api.host(hostId).del("/servers/" + serverId + qs);
}

export {
  __setJobTiming, serversStore, jobsStore, resolveGameNames,
  commandServer, sendConsoleInput, moderatePlayer, awaitJob, installServer,
  fetchSettings, patchSettings, deleteServer, saveServerNote,
};
