# PLAN — batch operations over a selected set of servers

The panel can arrange (widgets) and reach (palette). It cannot act on more than one server at a
time. Every mutation in `lib/serverActions.js` takes one server, every palette verb names one, and
`ServersPage` has search, status tabs, node and game filters, sort, group-by and favourites — and no
selection model.

**A selection is cluster-wide; the work is owned by the nodes.** Seventeen servers spread over three
nodes, six of them needing an update — two on node 1, three on node 2, one on node 3 — is one
selection, one confirm and one result. Underneath, each node is handed its own share and runs it.

Two words, used precisely throughout:

- a **run** is what a person starts: one verb, one cluster-wide set of servers, one outcome.
- a **batch** is one node's share of a run — the durable unit, held and executed by that node's API.

**A batch is owned by the node it was fired at.** The browser names a verb and a set of servers, and
its job ends there: each node's API records its batch, paces it, and runs it to completion whether or
not anyone is watching. A ten-server update paced two at a time is a half-hour run, and nothing about
it should require a tab to stay open.

The batch is a **dispatcher, not a new kind of event**. Each member still becomes an ordinary
command, with its own job, its own engine invocation and its own audit row, so audit, the reactor,
the bot and push all see exactly what they see when an operator clicks Stop ten times quickly. What
the batch adds is the record that ties those ten together, the pacing between them, and the fact
that it survives the client.

This spans two repos: **`kgsm-api`** owns the batch, **`kgsm-web`** selects and watches.

---

## 1. What can actually be batched

Every per-server mutation `kgsm-api` exposes, and whether a set of servers is a sensible target.

| Action | Endpoint | Tier | Job | Batch |
|---|---|---|---|---|
| start · stop · restart · update | `POST /servers/{id}/commands` | Operator | ✅ | **yes — the core** |
| back up now | `POST /servers/{id}/backups` | Operator | ✅ | **yes** |
| send console input | `POST /servers/{id}/console` | Operator | ✗ | **yes — broadcast** |
| patch settings | `PATCH /servers/{id}/settings` | Operator | ✗ | **yes — sparse body** |
| set note | `PUT /servers/{id}/note` | Operator | ✗ | yes, low value |
| uninstall | `DELETE /servers/{id}` | Operator | ✅ | mechanically yes — **excluded** |
| install | `POST /servers` | Operator | ✅ | no — needs a name, port and node each |
| patch `.config.ini` | `PATCH /servers/{id}/config` | Operator | ✗ | no — keys are per-game |
| write a file | `PUT /servers/{id}/files` | Operator | ✗ | no — content is per-server |
| kick · ban · unban | `POST /servers/{id}/players/{p}/…` | Operator | ✗ | no — targets a player, not a server |
| backup restore · delete · pin | `…/backups/{backupId}/…` | Operator | mixed | no — addresses one backup |

### The four worth building (Tier 1)

**start · stop · restart · update.** `CommandVerb` (`kgsm-api/src/Api/Contracts/CommandDto.cs:68`) is
a closed set of exactly these. This is the whole ask: bring the fleet down for maintenance, bring it
back after, patch everything that reports an update.

**Back up now.** Already fleet-shaped in intent — "back everything up before I touch anything" is
the sentence that precedes a batch update. `requestBackup` / `backupServer` exist
(`kgsm-web/src/lib/serverActions.js:76`, `:86`) and the palette already offers the scoped version.
Backup takes a job, so it rides the same batch machinery as the four verbs.

### The three worth a second pass (Tier 2)

**Broadcast to consoles.** One line to N servers — "restarting in 10 minutes". `sendConsoleInput`
(`kgsm-web/src/lib/stores/servers.js:313`) exists; the endpoint is Operator-gated. The missing half of
a graceful restart, needing no new engine work. Its shape differs from a verb, though: no job, no
guard, and a per-game command syntax the panel does not know. It is also the one Tier-2 action fast
enough that durability buys it little — it belongs in its own slice.

**Bulk settings.** `PATCH /servers/{id}/settings` is deliberately sparse — only non-null fields
apply — so an identical body applied N times is the whole feature. The fields: `autoUpdate`,
`autostart`, `cpuPriority`, `memoryCapMb`, and the restart/backup schedule keys (`scheduledRestart`,
`restartTime`, `restartDay`, `backupSchedule`, `backupTime`, `backupDay`, `backupRetention`,
`timezone`). Settings writes are fast and take no job, so these run inline rather than through the
batch worker.

**Set a note.** Trivial once selection exists; worth taking only if the surface is already there.

### What is deliberately excluded

**Uninstall.** It batches mechanically and should not be offered. The blast radius of a
mis-selected filter is every world on the box, and unlike stop it is not reversible. Uninstall stays
one server at a time, where the name has to be looked at.

**Anything whose body differs per server** — install, config keys, file writes. A batch is one
intent applied N times; the moment the intent has per-target parameters it is N separate tasks
wearing one button.

---

## 2. What already exists

### In `kgsm-api`

- **The whole single-command path.** `POST /servers/{id}/commands`
  (`src/Api/Controllers/ServersController.cs:118`) → `CommandGate.Inadmissible` → `JobRegistry.TryStart`
  → `CommandRunner.ExecuteAsync`. A batch member is exactly this, called from a worker instead of a
  request thread.
- **`CommandGate`** (`src/Api/Services/Commands/CommandGate.cs`) — the authority on whether a verb is
  admissible against an observed status, and the source of every synchronous `409`.
- **`JobRegistry`** (`src/Api/Services/Commands/JobRegistry.cs`) — one in-flight job per server,
  claimed atomically at `:84`. It already refuses to stack work on a busy instance, which is exactly
  the guard a batch needs at dispatch time.
- **A durable-queue precedent.** `ClusterOutbox` / `InboxMessage` in `AppDbContext` (`:69`, `:75`) plus
  `Services/Cluster/OutboxDrainer.cs` — an EF-persisted work table drained by a `BackgroundService`.
  Fifteen `BackgroundService` workers run today (`NotificationDeliveryWorker`, `AlertEngine`,
  `LibraryHydrationWorker`, …), so the batch worker is a known shape, not a new one.
- **`TryStartObserved`** (`JobRegistry.cs:65`) — the API already adopts runs the *engine* started that
  it did not issue, ageing them out after six hours. This is the mechanism restart reconciliation
  leans on (§4b).

### In `kgsm-web`

- **`verbGuard(server, verb)`** — `components/ServerActions.jsx:47`. The one answer every surface gives
  about whether a verb can run, with the sentence for when it cannot. It mirrors `CommandGate`; the
  preflight renders from it without a round-trip, and the API re-decides on arrival.
- **`consequenceOf(verb, server)`** — `components/palette/sources.js:84`. "3 players will be
  disconnected." Summed over a selection, it is the batch's confirm line.
- **`jobsStore`** — `lib/stores/servers.js:211`. Per-job state off the `jobs` stream topic.
- **`favoritesStore`** — `lib/stores/ui.js:16`. An existing per-user set of server ids with
  `toggle`/`set`/`has`; the shape a selection store copies.
- **`serverOperable(server)` / `canOn("server.operate", hostId)`** — `lib/persona.js`. Per-host, so a
  selection spanning nodes the user operates unevenly is answerable per row.
- **`registerWidget`** — `lib/widgets/registry.js:38`. The ops tray is a dashboard widget on day one.
- **The filtered + ordered list** — `pages/ServersPage.jsx:233`/`:243`. Selection is a set over this.

## 3. What has to be new

### 3a. `kgsm-api` — the batch

**`POST /api/v1/servers/commands`** (Operator). Body `{ verb, serverIds[], runId, origin }`. Responds
`202` with `{ batchId, runId, admitted: [serverId], refused: [{ serverId, reason }] }` — the API's
own preflight, evaluated through `CommandGate` and the in-flight check, so the browser is told what
will actually run before it commits. Refusals are named on arrival, not discovered one at a time. A
`serverId` this node does not own is refused, not forwarded.

**`BatchEntity` + `BatchMemberEntity` in `AppDbContext`.** One batch row (id, **runId**, verb, actor,
origin, created, state) and one row per member (batch id, server id, state, job id, error, settled).
Member state is `pending | running | succeeded | failed | refused | cancelled | unknown`. Persisted
for the reason this whole revision exists: the run outlives the request that started it, and it must
also outlive the process that accepted it.

**`runId` is the client-generated correlation id** that makes a cluster-wide run reassemblable
(§4c). Every node in one run is handed the same value and stores it verbatim; no node learns about
any other. A nullable column and nothing more.

> ⚠ `EnsureCreated` only creates tables on a *fresh* database. Both tables need the same one-shot
> creation on an already-deployed DB that `ClusterOutbox` and the session registry needed — never a
> wipe of the shared audit log.

**`BatchWorker : BackgroundService`.** Drains pending members, honours the concurrency window (§4a),
and dispatches each through the same `CommandRunner` path a single command uses. It claims a member
before running it and settles it after, so a crash leaves an unambiguous row.

**Every member gets its `Job` when the batch is accepted, not when the worker reaches it.** A job is
how the whole system already talks about pending work — `JobState.Queued`
(`src/Api/Contracts/CommandDto.cs:141`) is on the wire today, `activeJob` already rides the server
DTO, and the `jobs` topic already carries transitions. Creating the ten jobs up front means queued
work is visible everywhere running work is visible, and no surface needs a second concept to learn.
Creating them at dispatch would leave eight of ten servers looking untouched while a batch is
plainly under way.

Three things follow, and all three are the point rather than side effects:

- **The in-flight slot is claimed at accept.** `JobRegistry.TryStart` already enforces one job per
  server, so a queued stop now blocks a competing start — which is correct: a manual start must not
  race a stop the operator has already committed to.
- **That refusal has to name what it is waiting for.** "A job is already in flight" is misleading
  when the job has not started; the reason reads *"a stop is queued for this server"*. A refusal
  that does not name the action invites the caller to re-send the identical command.
- **`JobState` gains `Cancelled`** — cancelling a batch settles its queued jobs, and there is no
  honest existing state for a job that never ran. `adaptJob`'s `JOB_TERMINAL` map
  (`kgsm-web/src/lib/adapters.js:603`) takes it alongside `succeeded`/`failed`.

**The job DTO gains `batchId` and `queuedPosition`.** Position is what makes a queue legible — ten
servers all reading "queued" tell an operator nothing about which moves next. It is a **count, not a
clock**: no ETA is offered, because an update's duration is not something this API has measured. The
position is real; a predicted time would not be.

**No `GET /jobs` endpoint.** Every job names a server, the client holds every server, and pending
work is reachable through `activeJob` and the batch reads. A third way to ask the same question is a
third thing to keep consistent.

**`GET /api/v1/batches?active=true` and `GET /api/v1/batches/{id}`** (Viewer). How a client that
reconnects — or a *different* client, or a different person — picks up a run in progress. Without
this the durability is real but invisible, which is the same defect wearing a nicer hat. Every row
carries its `runId`, so a client fanning this read across the cluster can reassemble a run it never
dispatched.

**`DELETE /api/v1/batches/{id}`** (Operator) — cancels **pending** members only. A kgsm invocation
already in flight is not interruptible, and the response says which members it could not stop rather
than implying a clean halt.

**Stream.** `jobs` frames carry a nullable `batchId`; a `batches` topic carries the batch's own
rollup transitions. A client therefore needs no polling, and a job's membership is an attribute of
the job rather than a second event vocabulary.

**What deliberately does not change:** the engine sees N ordinary commands. Audit rows come from the
engine echo and do not carry a batch id — the batch record is its own ledger of what it did, and
teaching the audit pipeline about batches would put a panel concept into an event stream every other
consumer reads. `origin` stays `"ui"`; the batch row holds the association.

### 3b. `kgsm-web` — selection and watching

**A selection store** (`lib/stores/selection.js`). Ids plus the host each belongs to. Three rules:

- **Cleared on filter change.** A hidden selected row is how a batch hits a server nobody meant.
- **Not persisted.** It is a gesture, not a preference.
- **A finished run narrows it to the failures.** Rows that succeeded drop out, rows that failed stay
  selected, and a clean run clears it entirely. Retry is then one click and can only ever address
  what actually needs retrying — a selection that still held the successes would re-run the verb
  against servers already done.

**Selection affordances on `ServersPage`.** A checkbox on the tile, shift-click for a range, and —
the one that matters — **"select all N matching"** over the active filter. The filters are already
good enough that `status=updates` + `game=factorio` *is* the selection; clicking twelve boxes to
re-express a filter that already ran is the friction being removed.

**A preflight, rendered locally, decided remotely.** Partition the selection with `verbGuard` and
show both halves immediately: *"Stop 9 servers on 3 nodes · 3 refused (2 already stopped, 1 watchdog
unavailable) · 17 players will be disconnected."* Each node's `refused[]` is the authority for its
own servers and may differ — one that went offline between render and submit is refused there and
nowhere else — so the result surface reconciles against every response rather than assuming the
local partition held. The node count is stated whenever a run crosses more than one.

**The batch arms once, here.** One confirm for the whole run: the safety is the preflight stating
the count, the refusals and the players lost, not a gesture repeated N times — repetition is the
friction this feature removes, and a confirm clicked twenty times is read zero times.

The preflight **escalates its wording when the selection is every online server**, leading with the
player total and saying so in those words. It does not escalate the *gesture*. Stop is reversible,
and the one verb that isn't — uninstall — is excluded from batching entirely (§1), so a typed
confirmation here would buy ceremony on exactly the emergency the feature exists for.

Two gates `verbGuard` does not currently cover and the preflight must add:

- **A server with a job already in flight.** `JobRegistry.TryStart` claims one slot per server and
  returns null otherwise. `verbGuard` reads status only; the card handles busy separately via
  `pendingVerb`. A preflight that skips this reports refusals as failures.
- **Per-host permission.** `serverOperable` is per host, so a selection spanning nodes can contain
  rows this user may not operate. They are refusals, not errors.

**A dispatcher** (`lib/batchRun.js`) — mints a `runId`, groups the selection by `hostId`, and fires
one POST per node (§4c). It paces nothing and retries nothing; the pacing is the worker's. The
per-connection `{ conn, ok, data | err }` result shape `fanOut` already uses
(`lib/apiClient.js:824`) is the right one to copy, so an unreachable node is a recorded outcome
rather than a rejected promise — but `fanOut` itself is GET-only and is not the thing to reuse.

**The ops tray is required, not optional.** It is how a person checks on a run after closing the
tab, so it hydrates from `GET /batches?active=true` across every connected node on mount, groups by
`runId`, and follows the stream after — not a view assembled from frames that only a client present
at dispatch could have seen. It shows runs; a run's per-node breakdown is available inside one.

### Queued work has to render as queued

Three surfaces derive pending work identically — `ServerCard.jsx:83`, `ServerHero.jsx:60`,
`AlertCard.jsx:56`:

```js
const pendingVerb = server.job && server.job.state === "running" ? server.job.verb : null;
```

A queued job therefore renders as **idle**: no spinner, no label, buttons live. That is harmless
while `Queued` lasts milliseconds, and wrong the moment a batch makes it last twenty minutes — a
server eighth in a stop queue looks like nothing is happening to it, and its Stop button invites a
command the API will refuse.

So pending work becomes three states, not two: **idle · queued · running**. `ServerActionButton`
(`components/ServerActions.jsx:127`) grows a queued rendering that is deliberately *not* the pending
one — no spinner, since nothing is spinning, and a label that states the position: *"Stop queued ·
3rd of 8"*. The verb's own buttons disable, because the work is already committed.

The optimistic patch in `runServerAction` (`lib/serverActions.js:37`) writes
`{ job: { verb, state: "running" } }` from the click. That is near enough to true for a single
command, which starts within the second. **A batch member must be patched `queued`** — writing
"running" for work sitting behind seven other servers is the fabrication rule broken in the one
place it is easiest to break it by copying a line.

### 3c. The job queue as a surface

Queued work being visible on a server's own card (§3b) answers "what is happening to *this* server".
It does not answer "what is this node about to do", which is the question a batch creates and which
nothing in the panel can currently be asked.

**One component, `JobQueue`, bound to a host.** The widget registry's rule is explicit — *"an entry
points at the component the PAGE renders. There are no widget-only forks"* — so it is written once
and mounted twice:

- **A node subtab.** `ROUTE_TABS.cluster` (`lib/labels.js:16`) gains `{ id: "jobs", label: "Jobs",
  icon: "list-checks" }` alongside overview / resources / services / logs, with a `DiagJobs.jsx`
  body beside the other four. A subtab rather than a band on the overview, because three lanes need
  room and `DiagOverview` is already dense — and because the widget below is how it reaches the
  overview for anyone who wants it there.
- **A dashboard widget**, `host.jobs`: `group: "Nodes"`, `cap: "host.manage"`, `scope: "host"`,
  `params: ["hostId"]` — the same shape `host.logs` and `host.services` already use
  (`pages/dashboard/catalog.js:173`, `:186`), so it is pinnable, repeatable per node, and needs no
  new registry machinery.

**Three lanes, and they are never merged:** *Queued* (ordered by `queuedPosition`), *Running*, and
*Recently settled*. Each job names its server, its verb, and — when it has one — its `batchId`, so a
row is a way into the run it belongs to.

**This is not an audit log, and it must not read as one.** The panel already draws this distinction
carefully between Alerts and Notifications, and the same care applies here:

| | holds | lives in | survives a restart |
|---|---|---|---|
| **Audit log** | what happened to the fleet | kgsm-api's SQLite, from the engine echo | yes |
| **Job queue** | what this node is doing and about to do | `JobRegistry`, in memory | **no** |

A settled job leaves the queue and lives on in audit. The component says where history lives rather
than implying it holds it — `JobRegistry` documents itself as ephemeral (*"a restart loses job
history"*), and a surface that showed an empty queue after a bounce without explaining why would
read as data loss.

**Settled jobs need a retention cap.** `jobsStore.byId` (`lib/stores/servers.js:211`) grows for the
life of the tab, fed by every connected node. A pinned widget in a tab left open for a week would
accumulate every job the cluster ever ran. Keep the last N settled per host and drop the rest; queued
and running are never dropped.

**A one-line fix this depends on.** The stream envelope already carries the node that delivered a
frame — `adaptStreamMessage(raw, conn.id)` stamps `hostId` on every message, with the comment *"an
event carries its origin so a listener never has to guess which node produced it"*
(`lib/apiClient.js:419`). The jobs subscriber then drops it: `jobsStore.upsert(m.data)`
(`lib/stores/servers.js:218`) stores the adapted job and discards the envelope. Carry it through —
`jobsStore.upsert({ ...m.data, hostId: m.hostId })` — and a per-host job list is a filter rather than
a lookup through `serversStore` for every row.

**The scheduled lane, later.** `SchedulerOverview` already reads next-fire times per instance from
the scheduler leaf (`fetchLeafSchedules`), and this component is the natural place to show them
beside the work that is actually queued — the surface a per-instance maintenance window would be
configured against. It is a **fourth lane and never part of Queued**: a restart predicted for 04:00
is not committed work, and a merged list would let a prediction read as a job somebody can cancel.
`SchedulerOverview` already keeps that separation for the same reason, and this is the second place
it has to hold.

### One refactor `serverActions.js` needs

`runServerAction` (`lib/serverActions.js:37`) calls `reportFailure` internally, which toasts. A batch
that reuses it reports twenty failures as twenty toasts, and the module's own header states the rule
that makes the naive fix wrong: the optimistic patch, the rollback and the error wording *are* what
the action is, and a surface that skips one lies about what happened.

So: extract the patch/rollback into a helper taking a **reporter**, defaulting to the toast one.
`runServerAction` keeps its exact behaviour; the batch passes a reporter that folds outcomes into the
run record. The three obligations stay together, and the batch is not a second implementation of them.

---

## 4. Three problems the codebase surfaces

### 4a. Nothing limits how much a host runs at once

`CommandRunner` fires each job with a bare `Task.Run`
(`kgsm-api/src/Api/Services/Commands/CommandRunner.cs:47`) and `JobRegistry` caps in-flight work
**per server**, not per host.

The engine's own overhead is not what the limit is for. Measured on this host (16 cores): one
`kgsm instances status` invocation costs 0.66s wall, and four concurrent cost 0.59s — four parallel
invocations are free. What needs pacing is the **work behind the verb**: a stop drains and saves a
game world, and an update runs steamcmd against one disk and one uplink.

`BatchWorker` therefore holds **4 concurrent for start/stop/restart, 2 for update**. Update is
halved rather than serialised because a six-server patch run should not take six times as long as
one; the disk contention that sets that ceiling is unmeasured, so measure a real update batch before
moving it. Both numbers live in one place, beside what they were measured against.

Holding the window in the worker rather than in a browser also makes it a property of the **host**:
two operators batching at once share it, which no client-side pacer could arrange.

### 4b. A restarted API has members it cannot honestly settle

`JobRegistry` is in-memory and says so — *"Ephemeral by design — a restart loses job history"*
(`JobRegistry.cs:7`). Persisting the batch fixes the queue, not the jobs inside it. On restart:

- **`pending` members are simply resumed.** Nothing ran; the worker picks them up.
- **`running` members have an unknown outcome.** The job record is gone and the kgsm invocation was a
  child of the process that died.

A member in that state is reconciled against the engine, never guessed: the API already adopts
engine-started runs it did not issue (`TryStartObserved`), and kgsm's own finish events settle them.
A member the engine cannot account for settles as **`unknown`** with the reason stated — not
`failed`, which claims a result nobody observed, and not silently retried, which could restart a
server somebody stopped. This is the ecosystem's never-fabricate rule landing on a new surface, and
`unknown` needs to be a first-class member state from the first commit rather than retrofitted.

### 4c. A run spans the cluster; a batch does not

The selection is cluster-wide by default — `ServersPage` already lists every node's servers and
treats `node` as one filter among several, so "select all matching" over `status=updates` naturally
crosses nodes. Six servers over three nodes is **one run, dispatched as three batches**, each
durable on the node that owns those servers, each addressed with `api.host(id)`'s exact routing.

**The run is held together by `runId`, generated by the client and stored by every node.** The SPA
mints one, sends it in each POST, and groups by it afterwards. Any client — a different browser, a
different person, one that was not open at dispatch — reassembles the run by fanning `GET /batches`
across the cluster and grouping the rows by that id. Nothing is held only in the browser that
started it.

Correlation, not coordination: **no node learns about any other**, and nothing relays through
`/api/v1/peers`. The mesh is masterless and a run should be owned by the machines that execute it,
so that losing the node you fired *from* cannot orphan work on the nodes it runs *on*. Electing a
coordinator would buy a tidier id at the cost of the property that matters.

Three consequences worth stating outright:

- **Dispatch can partially fail.** A node unreachable when the run is fired means its share never
  starts. The result says so in those terms — *"dispatched to 2 of 3 nodes · node2 unreachable · 3
  servers not started"* — and offers those servers as a retry. It is never folded in as failures,
  which would claim commands that were never issued.
- **The concurrency window is per node, and stays that way.** Six updates over three nodes run up to
  2+2+2 at once, not 2 in total. Nodes have their own disks and uplinks; a cluster-wide window would
  throttle a fleet to the pace of one machine. Do not "fix" this into a global limit.
- **Permission is evaluated per node.** `serverOperable` is per host, so a run can contain servers
  this person may not operate on one node while operating freely on another. Those are refusals,
  named as such, alongside the ones `CommandGate` returns.

Note that `adaptJob` (`kgsm-web/src/lib/adapters.js:604`) puts no `hostId` on the job itself — which
is why `awaitJob` takes the host separately. The **stream envelope has it** (`hostId`, stamped by
`adaptStreamMessage`); the jobs subscriber simply drops it today. Carry it onto the stored job
(§3c) rather than resolving a node through `serversStore` at each call site.

---

## 5. Slices

**S1 — `kgsm-api`: the batch. BUILT** (`kgsm-api` 0.122.0). Entities (with `runId`) + one-shot table
creation, the POST with its preflight response, `BatchWorker` with the concurrency window, jobs
created `queued` at accept with `batchId` + `queuedPosition`, `JobState.Cancelled`, the
queued-not-running refusal wording, the read endpoints, cancel, `batchId` on job frames and the
`batches` topic, restart reconciliation including `unknown`.

Verified live against an auth-disabled API: the preflight names each refusal individually and a batch
with nothing to admit settles on arrival; a four-server `start` carried a job id and a stable position
on every member from the moment of the `202`, then ran to `settled` with four successes.

The window and the restart reconciliation are proven by test rather than against the host, and
`ICommandExecutor` exists for that reason: **demonstrating a four-wide window by starting four real
game servers costs the host four game servers' worth of memory**, which is the failure the window is
there to prevent. A fake executor that blocks until released proves the ceiling holds — for the whole
run, not just the first pass — at no cost. Not yet exercised against a live host: cancel, and the
narrower `update` window, both covered by those tests.

**S2 — `kgsm-web`: selection and dispatch.** Selection store, tile checkbox, "select all matching",
the preflight sheet, the dispatcher (mint `runId`, group by host, fan out), the queued rendering
across the three `pendingVerb` surfaces, the reporter refactor, and one summary reconciled across
every node's response — including nodes that never answered.

**S3 — `JobQueue`.** The per-host component (§3c): the `jobs` node subtab, the `host.jobs` widget,
the `hostId` carry-through, the settled-job retention cap. It stands alone — a node's queue is worth
seeing whether or not a batch put anything in it — so it does not have to wait for S2.

**S4 — the ops tray.** What the whole cluster is doing right now: `GET /batches?active=true` fanned
across the connected nodes, grouped by `runId`, followed on the stream. The run-level view above
`JobQueue`'s per-node one. Deliberately separate from the Notifications tray, which is per-browser
and is explicitly *what you did in this browser* (`components/NotificationsPanel.jsx`). Registered as
a dashboard widget.

**S5 — back up the selection.** Reuses S1 and S2 wholesale; only the guard differs, since backup has
no `verbGuard` case and no engine verb behind it.

**S6 — bulk settings.** One sparse PATCH body applied N times, inline rather than through the worker.

**S7 — broadcast.** Own surface, own slice. The graceful-restart sequence (warn → count down →
restart) is a scheduler concern and does not belong here — but this is the piece it will call.

## 6. Decisions

| Question | Decision | Where |
|---|---|---|
| Who owns a batch once fired? | The node it was fired at — persisted, paced and completed by the API | §3a, §4c |
| Arm once, or per server? | Once, on the preflight | §3b |
| The selection after a run | Narrows to the failures; a clean run clears it | §3b |
| Is a whole-fleet stop special? | The preflight's wording escalates; the gesture does not | §3b |
| The concurrency window | 4 lifecycle / 2 update, held by the worker, **per node** | §4a, §4c |
| When does a member get its job? | At accept, `queued` — so pending work is visible wherever running work is | §3a |
| How is a queue made legible? | `queuedPosition` on the job DTO — a count, never a predicted time | §3a |
| Where is a node's queue seen? | `JobQueue` — a `jobs` node subtab and a pinnable `host.jobs` widget | §3c |
| Is the queue a history? | No. Audit holds what happened; the queue holds what is about to | §3c |
| Scheduled fires in the queue? | A separate lane — a prediction never sits in the committed list | §3c |
| A member whose outcome was lost | Settles `unknown`, reconciled against the engine — never guessed | §4b |
| A run spanning nodes | One run, N batches, correlated by a client-minted `runId`; no peer relay | §4c |
| A node unreachable at dispatch | Reported as undispatched and offered as a retry — never counted as failed | §4c |

Nothing here is open. The plan is ready to implement, starting at S1.
