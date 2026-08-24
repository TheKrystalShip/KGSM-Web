# Wiring `kgsm-web` ↔ `kgsm-api`

Audit of the contract between the Control Panel SPA (`kgsm-web`) and the per-host
aggregator API (`kgsm-api`), and the plan to connect them. Neither side is
authoritative today — this is the reconciliation record. Generated 2026-06-20.

> **⚠ Realtime transport migrated WebSocket→SSE (2026-07-02, `sse-migration-plan.md`).**
> `GET /api/v1/stream` is now fetch-based `text/event-stream` (topics via `?topics=` at
> connect, bearer in the `Authorization` header, one primary stream per host + per-view
> dynamic streams, reactive rotate-on-401). The dated slice logs below describe the
> transport **as it was built over WebSocket at the time** — read them as history; the
> current contract rows (Realtime URL, "Realtime (SSE)") are updated.

> Source of truth for the backend shapes: the live `kgsm-api` controllers + DTOs
> (camelCase JSON, ISO-8601 `Z` timestamps, error envelope `{error:{code,message,details?}}`).
> Source for the frontend's expectations: `src/lib/apiClient.js` (the active mock
> seam) + `src/lib/data.js` fixtures. **Ignore `reference/scaffold-api-seam/`** —
> it's a stale earlier design (uses `/catalog`, path-based actions); the backend
> and the active mock already settle those the other way.

---

## 0. The shape of the problem

The SPA was ported from a no-build prototype whose fixtures model a **richer,
imagined** domain (per-server `players`, `ip`, `uptime`, host per-process tables,
sensors) than the backend **honestly** emits. The backend deliberately omits
anything it can't measure — that "never fabricate a metric or status" rule is *the*
ecosystem invariant (it's why the previous kgsm-api was scrapped for synthesizing
CPU from `Random`).

**So the cardinal rule for this wiring:** the adapter maps backend → frontend, and
where the backend has no value, the UI renders **unknown / —**, *never* `0` or a
fabricated default. `players: x ?? 0` in the adapter would re-introduce exactly the
fabrication the ecosystem bans. (`players` is the worked example: the count is
sourced now — `onlinePlayers` on the server DTO — and is **null** for a server whose
presence this host can't see, which the UI renders "—" and a fleet total excludes
and counts separately, never sums as 0.)

## 1. Architecture: per-host, not a mismatch

`kgsm-api` is **per-host / single-tenant**: `GET /hosts` returns an array of *one*
(this host), there is no fleet endpoint, auth + WebSocket are per-host. The SPA is
a **multi-host fleet client** that fans out and aggregates client-side. This is the
documented design (`system-architecture.md` O5, kgsm-api CLAUDE.md "per-host
aggregator"), and the FE is already built for it: `api.host(id)`, per-host
`tier`/`authDenied`, per-host sockets, the 401/403/`login_required` state machine
in `sessionStore.js`. **Do not "reconcile" this — it's correct on both sides.**

**The one genuinely open piece — host discovery.** The mock pre-knows the fleet via
a single `GET /hosts`. In production there is no registry endpoint; each host is its
own kgsm-api at its own base URL. The FE `AddHostPage` drives the Discord bounce but
**never captures a base URL** today. So the SPA needs a **local host registry**
(base URL + label per host, in `localStorage`), seeded by the add-host flow; `GET
/hosts` becomes "call each registered host and concatenate." This blocks the
multi-host fan-out, *not* the first single-host slice (point `VITE_API_BASE` at one
host). **Decision owed** (see §7).

## 2. Transport & config gaps

| Concern | Frontend today | Backend | Action |
|---|---|---|---|
| Base URL | `VITE_API_BASE` exists in `.env.example` but is **read nowhere in `src/`**; mock always serves fixtures | listens at `/api/v1` | Build a real transport that reads `VITE_API_BASE` (+ `/api/v1`); keep mock as the no-base fallback |
| Realtime URL | ✅ `streamUrlOf(host, topics)` derived from the host base; fetch-based SSE client (`liveStream.js`) behind `api.stream` | `GET /api/v1/stream` (`text/event-stream`, topics via `?topics=`), bearer via `Authorization` header | DONE + **migrated WS→SSE 2026-07-02** (single host; multi-host fan-out = slice 8) |
| JSON casing | fixtures mix **snake_case** (`update_available`, `last_backup`, `user_id`, `per_core`, `boot_time`, `sample_age_s`, `open_ports`, `usage_pct`…) | **camelCase** everywhere (`PropertyNamingPolicy=CamelCase`) | Adapter normalizes; do **not** rename fixtures piecemeal — map at the seam |
| Errors | mock rejects with `{code:'ECONNREFUSED'}` ad-hoc | `{error:{code,message,details?}}`, stable `code` strings | Transport unwraps the envelope into the FE's error shape |
| Auth transport | per-host bearer injected by `api.host(id)` | `Authorization: Bearer <jwt>`; secure-by-default (everything needs a bearer) | Inject real bearer; use `KGSM_API_AUTH_DISABLED` on the backend to prove the data path *before* wiring OAuth |
| Timestamps | fixtures use bare local ISO (`2026-05-22T10:28:01`) | ISO-8601 **UTC `Z`** | Adapter parses `Z`; FE formatting already tolerant |

## 2b. Surfaces that bypass the adapter seam (must be wired individually)

The "swap the transport at the seam" strategy only fixes data that flows through a
store. A `grep` for `KRYSTAL_DATA`/`data.js` in `src/pages` + `src/components`
(2026-06-20) found **six surfaces that import fixtures directly** — these will *not*
be fixed by the adapter and each needs its own wiring (or honest-unavailable
treatment):

| File | Direct fixture read | Backend source | Bucket (see §9) |
|---|---|---|---|
| `pages/PerformanceTab.jsx:42` | `KRYSTAL_DATA.metricsByServer[id]` (48-pt time series) | none — BE emits point-in-time only | **C** (history) |
| `pages/PlayersTab.jsx:80` | — | `GET /servers/{id}/players` + the `players` topic (`usePlayerRoster`) | **A** (wired) |
| `pages/BackupsList.jsx:14` | `KRYSTAL_DATA.backups` | none — only `backup.*` audit | **C** |
| `pages/FileBrowser.jsx` | ~~`KRYSTAL_DATA.files`/`fileContent`~~ | `GET/PUT /servers/{id}/files…` (lazy tree + read + save) | **WIRED** (Tier 3 #12) |
| `pages/DashboardPage.jsx:230` | ~~`KRYSTAL_DATA.session.ping_ms`~~/`region` | ping = WS `ping`/`pong` (client-measured RTT, `pingStore`); region none | **WIRED**(ping)/**D**(region) |
| `pages/LibraryPage.jsx`, `components/Sidebar.jsx` | `KRYSTAL_LABELS.catalog` | static UI label, not domain data | n/a (keep) |

(`DiagnosticsPage.jsx:31` only *mentions* `KRYSTAL_DATA` in a comment — it reads
`hostsStore`, so it **is** behind the seam.) Note: a prior agent claim that
`ServerCard` reads `metricsByServer` directly was wrong — it does not import
`data.js`; it gets metrics via props/store.

## 3. Endpoint matrix (FE call → BE endpoint)

All BE routes are under `/api/v1`. ✅ aligned · ⚠️ remap needed · ❌ gap.

| FE call (`apiClient.js`) | Backend endpoint | Status | Notes |
|---|---|---|---|
| `GET /servers` | `GET /api/v1/servers` (Viewer) | ⚠️ | path prefix + **schema differs heavily** (§5) |
| `POST /servers/{id}/commands {verb,origin}` | `POST /api/v1/servers/{id}/commands {verb,origin?}` (Operator) | ✅ **DONE (slice 6)** | wired via `commandServer` with `origin:"ui"`; status + job ride the `servers`/`jobs` WS. `update` is a verb (Tier-1 ops); the chip lights only when the update-check probe found a newer version, and the server reads `Updating…` for the whole run |
| `GET /hosts` | `GET /api/v1/hosts` (Viewer) | ⚠️ | returns array-of-one per host; schema differs (§5); fan-out is FE-side |
| `GET /library` | `GET /api/v1/library?q=&category=` (Viewer) | ⚠️ | **path agrees** (not `/catalog`); schema differs (§5) |
| `GET /audit` | `GET /api/v1/audit?cursor=&limit=&severity=&serverId=&actor=&since=&category=` (Viewer) | ✅ **DONE (audit paging + filters slice)** | `adaptAudit` preserves the `{data,nextCursor}` envelope; the store **walks the keyset cursor** (1000-row cap) so events older than the first page are reachable (the real bug — LIVE fetched ONE page) + `loadMore()`; page discloses incompleteness + "Load older events", omits counts in LIVE. **Structured filters PUSH DOWN** (severity incl. `attention`→`warn,danger`, serverId, actor, range→`since`, category→action-prefix) so the cursor walks the FILTERED log; free-text search stays client-side. **kgsm-api extended:** multi-value severity + `since` + `category` params + a `Ts`→ticks value-converter (SQLite can't translate `DateTimeOffset >=`) |
| `GET /auth/discord/callback?host=&prompt=` | `GET /auth/discord/callback?code=&state=` (anon) | ⚠️ | **different flow** — FE has a simplified per-host callback; BE is real OAuth code/state. Also `GET /auth/discord/start`. Returns `{verdict,tier,token,refresh,userId}` (FE expects `user_id`, has no `refresh` handling) |
| `POST /auth/session/refresh {host}` | `POST /auth/session/refresh` + `Bearer <refresh-jwt>` → `{token}` (anon) | ⚠️ | FE sends `{host}` body; BE wants the refresh token as bearer |
| `GET /servers/{id}` (defined, unused) | `GET /api/v1/servers/{id}` (Viewer) | ✅ | both exist; detail adds `network` block |
| `PATCH /alerts/{id}` (defined, **unused**) | — (alerts read-only) | ✅ | FE never calls it; fine |
| `POST /api/v1/hosts/{id}/assistant/chat` (raw fetch, **outside seam**, Ollama-shaped) | `POST {leaf}/turn {prompt,think?,tools?,conversationId?}` (SSE, on the assistant leaf's own origin) | ✅ **DONE (slice 9a + 9b + 9c)** | rewritten onto `api.host(id).turn()` (SSE through the seam); streams `text.delta`/`tool.start`/`tool.result`/`error`/`done` → existing chat roles. **9b:** `command.proposed`→fork (a) (Confirm → `confirmCommand` = `POST /servers/{id}/commands {verb,origin:"assistant"}`)→SPA-composed `command.verified` from the job outcome. **9c (per-chat context):** the body now carries the local `conversationId` (the chat's `uid()`), forwarded by the API as `X-Relay-Conversation-Id` so the assistant keys memory `web:<userId>:<conversationId>` — each "New chat" is a fresh context window (was a single per-user thread that leaked across chats) |
| — (history was localStorage-only) | `GET {leaf}/conversations` → `[{id,title,createdAt,lastActivityAt,turnCount,think,autorun}]` (Viewer) | ✅ **DONE (slice 9d — reverse path)** | the caller's own past chats, server-side (so a fresh browser/device shows history, not just localStorage). API relays the assistant's list verbatim, scoped to the verified Discord id (`web:<userId>` — never client-supplied). `ChatPage` folds these into its conversation list (`mergeServerConversations`); join is by `id` == the chat's `uid()`. Each row carries the conversation's **effective** `think`/`autorun` (resolved at the leaf against its configured default), which is what the composer's two toggles read: the merge lets them overwrite a cached value where title and host only fill a gap, and the list is re-read whenever the surface returns to the foreground, so a chat opened on the panel and picked up in the installed app shows the switches the next turn will run on |
| — | `GET {leaf}/conversations/{id}` → `{id,entries:[{kind:turn\|checkpoint,createdAt,turn?,checkpointSummary?}]}` (Viewer) | ✅ **DONE (slice 9d)** | one chat's full transcript, oldest-first (turns + non-destructive compaction checkpoints). Turn DTO reuses the §5·a vocabulary (`prompt`/`final`/`think`/`thinking`/`tools[{tool,arguments,summary,result}]`/`usage`/`outcome`), so `ChatPage.scaffoldHistory` rebuilds the thread through the SAME render path a live turn uses — no second schema. Loaded lazily when a server-only chat is opened |
| — (a turn belonged to the POST that asked for it) | `POST {leaf}/events/attach {conversationId}` → `204`; `DELETE {leaf}/turns/{turnId}` → `204`; frames `turn.attach` / `turn.queue` (Viewer) | ✅ **DONE** | a turn is a SHARED SESSION at the leaf: every surface attached to that conversation receives the same verbatim frames, and any of them can stop it. `POST /turn` (SSE) is itself the first attach, so its wire shape is unchanged and kgsm-api's peer relay is untouched. `ChatPage` derives `busy` from the conversation rather than the surface; `scaffoldLiveTurn` renders a turn from a `turn.attach` snapshot (replacing, never merging); the sender skips the stream's copy of its own frames while its POST is open. One turn at a time per conversation — a second prompt queues (cap 3, then `409 queue_full`) and shows as a chip with a discard |
| — (no push channel; surfaces diverged until one refetched) | `GET {leaf}/events` → SSE `hello` / `conversation.switches` / `conversation.feedback` / `conversation.started` / `conversation.deleted` / `conversation.activity` (Viewer) | ✅ **DONE** | the caller's OWN conversation changes, pushed from the leaf so a chat open in two places agrees with itself. Held by `src/chat/useConversationStream.js` (reconnect with capped backoff; every reconnection re-reads the listing, since nothing is buffered while a stream is down). `conversation.switches` and `conversation.feedback` travel by value — the rest name a conversation and are answered by re-reading, so the transcript keeps ONE way to be obtained. A switch frame states where BOTH switches stand and the client diffs to know which moved, writing that line into the transcript on every surface; a verdict is applied by turn id, which addresses one bubble wherever it is rendered. The stream names itself in `hello`; `assistantClient` sends that id back as `X-Assistant-Origin` on every call and drops events stamped with it, so a surface never re-applies its own change |
| — (delete was localStorage-only → resurrected) | `DELETE {leaf}/conversations/{id}` → `204` (Viewer) | ✅ **DONE (slice 9d — soft-delete)** | **soft**-delete: the assistant appends a tombstone that hides the chat from `GET /conversations` while keeping the full transcript in the append-only history (the self-improvement corpus is never destroyed). Scoped to the verified Discord id (own-conversation only). `ChatPage.deleteChat` fires this for the chat's owning host so a deleted chat doesn't reappear from server history on the next "Chat history" open; idempotent + best-effort (a later turn on the same id un-hides it) |
| — (FE doesn't call) | `GET /api/v1/me` → `{user,tier,scopes}` | ➕ | FE currently derives tier from the callback; could/should use `/me` |
| `GET /alerts` (slice 3) | `GET /api/v1/alerts?status=&since=` → `{data:[Alert]}` | ✅ | `alertsStore.refresh()` hydrates firing + 24h resolved on LIVE boot (was fixtures+stream only) |
| `DiscordPage` (was 100% mock) | `GET/PATCH /api/v1/integrations/discord`, `POST …/test` (Admin) | ✅ **DONE (integrations slice)** | DiscordPage LIVE branch wired via `api.host(id)`: GET renders the server's 6-event catalog + masked webhook hint; toggles = sparse `{events:[{id,enabled}]}` PATCH; Save = `buildIntegrationPatch` (webhook only if user-typed); real `/test`. **Slack** provider (also built) not surfaced (FE has no Slack UI) |

**The assistant is a second backend, not a `kgsm-api` surface.** `{leaf}` above is the assistant's own
public origin, which the SPA reads from the host's assistant capability (`info.url`) and calls directly
with a session the **leaf** issued (`assistantClient.js` / `assistantSession.js`). `kgsm-api`'s
`/api/v1/assistant/*` is peer transport for reaching *another* node's assistant and logs a warning when
it serves the local one. A host that reports no public origin has no chat — the capability reads down
and the call is refused, rather than falling back to the relay. Confirming a staged command hands the
leaf's own token back to `POST {leaf}/confirm`, which performs the action and answers a verdict
(`settled｜accepted｜notSettled｜unknown｜failed｜refused`); the SPA renders that verdict and runs no
second execution path of its own. Contract: `kgsm-llm/docs/wire-contract.md`.

## 4. Realtime matrix (topic → message type) — **DONE (slice 5, 2026-06-21)**

FE subscribes via `api.stream.subscribe([topics], cb)` → emits `{type:"subscribe",
topics:[…]}`. BE outbound envelope: `{topic, type, data}` (FE handler reads `type`+`data`,
tolerant of extra `topic`). **The real WS transport is wired:** `src/lib/liveStream.js`
(self-contained WS lifecycle + backoff reconnect + re-subscribe-on-open) picked when
`LIVE`; `apiClient` adapts each frame via `adaptStreamMessage` (the WS parallel of
`adaptResponse`) and feeds the shared `dispatchMessage` seam, so the store subscribers are
identical in mock + live. Drives `realtimeStore` only (REST reachability stays on
`connectionStore`); on (re)open it `rehydrateAll()`s to catch missed deltas (§3·j).
**Single host** — multi-host fan-out (one socket per host) is slice 8.

| FE topic → type | BE topic → type | Status |
|---|---|---|
| `servers` → `server.patch` | `servers` → `server.patch` | ✅ `adaptServer` on the frame; **upsert by id** (patch existing OR add a new roster member) |
| `servers` → `server.removed {id}` | `servers` → `server.removed {id}` | ✅ tombstone drops the instance |
| `jobs` → `job`/`job.patch` | `jobs` → `job.patch` | ✅ `adaptJob` collapses every terminal state (`succeeded\|failed\|cancelled`) to `done` — whether anything more will happen — and keeps the terminal word itself as `outcome`, which is what tells a cancellation from a success. The frame's `hostId` (the node whose socket delivered it) is carried onto the stored job; the DTO has no such field |
| `console` → `console.line` | `servers/{id}/console` → `console.line` | ✅ per-server topic; `ConsolePanel` hydrates a REST window then follows it. The bare `console` topic in `GLOBAL_TOPICS` carries nothing — the feed is per-server |
| `alerts` → `alert.raise`/`alert.resolve`/`alert.retract` | same three | ✅ `alert.raise` runs through `adaptAlert` (derived icon); resolve/retract passthrough |
| `batches` → `batch.patch` | `batches` → `batch.patch` | ✅ the frame carries a whole `BatchView`, so a client that reconnects mid-run learns the shape of one from the next member that moves. `stores/batches.js` merges it under the node whose socket delivered it; the runs board groups by `runId` |
| `audit` → `audit.append` | `audit` → `audit.append` | ✅ live-prepend to `auditStore` (e2e-verified via a real kgsm emit) |
| `hosts/{id}/metrics` → `host.metrics` | `hosts/{id}/metrics` → `host.metrics` | ✅ **DONE (slice 7 follow-on, 2026-06-21)** — deep-dive subscribes while open; `adaptHostMetrics` reshapes the tick; `hostsStore.mergeMetrics` merges clobber-safe (keeps capabilities + firewall open_ports) + stamps receipt-time freshness; disposer unsubscribes (idles the pump) + clears the stamp |
| — (deferred) | `servers/{id}/metrics` → `metrics.tick` | ⏸ per-instance metrics — same shape; wire when the per-server tiles need live numbers |

> ⚠ **Metrics-slice landmine:** the `server.patch` handler merges the FULL adapted
> element, and `adaptServer(...).metrics === null` when a patch omits metrics. Once
> `metrics.tick` lands, a `server.patch` would then **clobber** cpu/ram set by a metric
> tick. The metrics slice must make `server.patch` not null out metric fields (e.g. omit
> metrics from the patch merge, or merge metrics only when present). Harmless today
> (metrics deferred, test host down).
| — (deferred) | `hosts/{id}/capabilities` → `capabilities.patch` | ⏸ capability flips — wire with metrics |

| — (deferred) | `servers/{id}/network` → `network.patch` | ⏸ **slice 6 deferred-with-cause** — no FE consumer renders a per-server ports card yet (`network.required` is read only by the still-mock assistant); wiring it would be dead code + needs the §4 clobber fix (a `server.patch` nulls `network`). Build the card / land the assistant slice first |

## 5. Schema diffs (the bulk of the work)

Field-level. **A = adapter remap; F = frontend change (drop/relabel/honest-unknown);
B = backend could add.** Honest-unknown is the default for every missing value.

### Server — large divergence
| FE fixture field | BE field | Resolution |
|---|---|---|
| `status: online/offline/updating/installing/error/crashed` | `status: running/stopped/unknown/starting` + `activeJob` | **A**: map `running→online`, `stopped→offline`, `starting→starting`, `unknown→unknown`. `updating` is synthesized in `stores/servers.js` from the in-flight **job** verb — which the backend carries on the server itself (`activeJob`) as well as announcing on the `jobs` topic, so it survives a cold read and a reload; `installing` renders as a phantom row (no server exists yet); `crashed` from a firing **alert**; `error` from job `failed` |
| `players:{current,max}` | `onlinePlayers` (nullable) | **A**: `current` = the count, counted off the same roster `/servers/{id}/players` serves and carried on the list + `server.patch`. `null` (presence unobservable) renders "—", never 0, and a fleet total counts those servers instead of summing them. `max` stays unsourced — no instance declares a capacity |
| `ip` ("host:port") | — | **F**: not exposed by kgsm; derive from host + `ports` if needed, else hide |
| `uptime` (string) | — | **F**: not exposed; FE already has "—" fallback |
| `cpu` (0–100) | `metrics.cpuPctCore` (can exceed 100) | **A**: different unit — relabel UI to per-core %, or divide by host cores. `null` → "—" |
| `ram:{used,max}` GB | `metrics.memBytes` (no per-instance max) | **A**: bytes→GB; **max is host-level** not per-instance — drop per-server max bar or source from host |
| `game` (display) | `blueprint` (id) | **A**: resolve display name from `/library` by blueprint id |
| `version`, `update_available` | `version` (nullable), no update check | **A**/**F**: `update_available` has no source → hide |
| `last_backup`, `notice`, `config`, `log` | — | **F**: no source today → hide/defer |
| — | `runtime`, `steamAppId`, `clientSteamAppId`, `isSteamAccountRequired`, `metrics.{ioReadBps,ioWriteBps,pids}`, `network` | **B→F**: surface where useful (runtime badge, IO, port card) |

### Host — large divergence
| FE | BE | Resolution |
|---|---|---|
| `name` | `label` | **A** |
| `online: boolean` | `status: "online"` (reaching the row = up) | **A** |
| `tier`, `authDenied` | (from auth layer, not `/hosts`) | **A**: keep FE's per-host session source |
| `cpu:{…}`, `ram:{…detailed}`, `per_core`, `load_avg`, `temp_c` | `cpuPct`, `mem:{used,total}`, `disks:[{mount,used,total}]` | **A**+**F**: BE is coarser — render what exists, honest-unknown the rest (no per-core/temp today) |
| `processes`, `sensors`, `network.interfaces` | — | **F**: no source → hide those diagnostics panels |
| `capabilities:{metrics,assistant,watchdog}` | same (richer: `provisioned/status/since/message/info`) | ✅ **A**: align field names (`sample_age_s` etc. → BE `info.intervalMs`) |
| `network.open_ports` | host detail `network.openPorts:[{port,proto,app,server}]` | **A** |

### Audit — moderate
| FE | BE | Resolution |
|---|---|---|
| response = bare array | `{data:[…], nextCursor}` | ✅ **DONE**: `adaptAudit`→`{rows,nextCursor}`; store walks the cursor + `loadMore()`; structured filters push down (severity/serverId/actor/since/category); page discloses incompleteness |
| `actor:{name,provider}` | `actor:{kind,name,provider}` | ✅ **DONE**: `AuditActor` uses `actor.kind` for system check; `kind` passed through |
| `action` enum (incl. `file.*`, `settings.*`, `discord.*`, `host.*`, `player.allow.*`) | closed vocab (`server.*`, `backup.*`, `network.ports.*`, `network.upnp.*`, `player.join/leave`, `auth.*`) | ✅ **already satisfied**: `AuditLogPage.jsx` `ACTION_META[…] \|\| {label:ev.action, icon:"circle-dot"}` renders an unknown action with a generic icon (forward-compat); some FE actions still have no BE source |
| `origin` (top-level) | `origin` (top-level nullable) | ✅ **DONE**: source chip reads `ev.origin` (was incorrectly `ev.meta.source`); included in search index |
| `severity`, `target`, `summary`, `meta`, `serverId`, `hostId` | same | ✅ |

### Alert — close (prototype-proven)
| FE | BE | Resolution |
|---|---|---|
| `icon` | — | **A**: derive icon from `severity`/`source` |
| `severity: danger/warn` | `severity: info/warn/danger` | **A**: handle `info` |
| `anchor:{surface,hostId,serverId,tab,ref}` | `anchor:{surface,hostId,tab,ref}` (no `serverId`) | **A**: use top-level `serverId` |
| `source`, `status`, `raisedAt`, `escalated`, `attempts`, `resolution{by,source,reason,actionId}`, `resolvedAt` | same | ✅ |
| `prompt`, `autoResolves` (mock-only) | — | **F**: mock-only, drop |

### Library — moderate
| FE `CatalogGame` | BE `LibraryEntry` | Resolution |
|---|---|---|
| `category`, `players` (display string), `addedAt`, `hosts[]` | — | **F**: honest-unknown / drop (no source); `players` ≈ `specs.maxPlayers` (null today) |
| `art`, `cover` | `cover` (reserved null), `rawgSlug` (reserved null) | **A**/**F**: FE keeps `art` gradient fallback; cover art deferred BE-side |
| `id`, `name` | `id`, `name` | ✅ |
| — | `type`, `steamAppId`, `clientSteamAppId`, `isSteamAccountRequired`, `ports:[{start,end,proto}]`, `specs` | **B→F**: surface type badge, ports, specs |

### Auth callback — flow + field
- FE expects `{verdict, tier, token, user_id}`; BE returns `{verdict, tier, token, refresh, userId}`.
- **A**: `userId` (not `user_id`); **handle `refresh`** (FE has no refresh-token store today — refresh sends `{host}` body, BE wants the refresh JWT as bearer).
- **Flow**: replace the FE's `?host=&prompt=` single-call callback with `GET /auth/discord/start` → Discord → `GET /auth/discord/callback?code=&state=`. The `prompt=none` silent-SSO intent maps onto `start?prompt=none`.

## 6. True gaps & rewrites (not simple remaps)
1. **Console** — no backend topic at all (deferred). `ConsolePanel` must degrade to "unavailable," not be wired.
2. **Assistant chat** — ✅ **slice 9a + 9b done.** Was a raw Ollama-shaped `fetch` to the wrong route; now `api.host(id).turn()` (SSE through the seam) streaming the §5·a frames. **9b** adds the command-confirm half: `command.proposed`→fork (a) (Confirm runs the M3 command path with `origin:"assistant"`)→SPA-composed `command.verified` from the job outcome.
3. **Host discovery / registry** — no base-URL capture in the FE (see §1, §7).
3b. **OAuth token handoff — BUILT (slice 4b; one manual browser login owed).** The
    callback now 302s to `KGSM_API_AUTH_FRONTEND_URL` with the session in the URL
    **fragment** (`#access=…&refresh=…` | `#error=…`), and the SPA captures+strips it
    at boot (`authRedirect.js`). Mechanically verified; the real Discord consent
    round-trip is owed-to-human. Refresh-token *rotation* (>15-min sessions) and
    multi-host token routing remain deferred.
4. **Honest-unknown UI** — ip/uptime/per-process/sensors have no source, and the player count has none for a server whose presence is unobservable: render "unknown" (preferred) or hide; never fabricate.

## 7. Open decisions
- **D1 — Host registry**: where the SPA stores each host's base URL. Recommend a
  `localStorage` host list (`{id,label,baseUrl}`), seeded by `AddHostPage`, with
  `GET /hosts` fanned out across it. (Doesn't block the single-host slice.)
- **D2 — Honest-gap rendering**: render "unknown/—" vs hide the element. Recommend
  **render unknown** (keeps layout, communicates honesty) except where it'd be noise.
- **D3 — Per-server CPU%**: show raw per-core `cpuPctCore` (BE-honest) vs normalize
  to host cores. Recommend show per-core, labeled.

## 7b. Live findings (probed against a running kgsm-api, 2026-06-20)
Backend was live at `http://127.0.0.1:8097` with `KGSM_API_AUTH_DISABLED` (so `/me`
→ `dev (auth disabled)`, admin). Real responses **confirmed the schemas in §5**.
Surprises found by probing:
- ~~**`GET /api/v1/audit` → HTTP 500**~~ **RESOLVED (slice 3, 2026-06-21).** Root cause
  confirmed: the running `:8097` instance (a manually-launched dev backend, env replicated
  from `/proc`) was pointed at `KGSM_API_DB=/tmp/upnp-e2e.db`, a leftover UPnP-e2e DB that
  had been **truncated to 0 bytes** → its schema was gone → `AuditQueries.PageAsync` 500'd
  (same family as the documented `EnsureCreated` stale-DB drift). Fix = **recreate the dev
  DB**: stop the stale process, delete the 0-byte file, relaunch the (rebuilt) binary with
  the *same* env. On the empty file `EnsureCreated` rebuilds the full schema (`AuditEntry`
  **+** `IntegrationEntity`, both in `AppDbContext`) → `/audit` returns `{data:[],nextCursor}`
  and a real emitted `instance-started` event flowed through to a `server.start` row (render
  path live-verified). New PID + exact command surfaced to the user.
- ~~**`GET /api/v1/integrations` → HTTP 500**~~ **RESOLVED (same DB recreate, side-effect).**
  `IntegrationEntity` lives in the same `AppDbContext`, so the fresh schema fixed it too;
  now `200` (`[{provider:"discord",…},{provider:"slack",…}]`). Integrations *wiring* is a
  later slice (not in scope here) — only the 500 is cleared.
- `GET /servers/{id}` detail correctly carries the `network` block
  (`firewall:"absent"`, `required:[{port,proto,open:null}]`). Host detail omits
  `network` honestly when the firewall is absent.
- **Frontend persona is tier `none` until auth lands** — with no per-host session,
  `resolveRoute` sends admin/operator surfaces (dashboard, fleet) to the viewer home
  (servers). So pre-auth, only the viewer-reachable read path (servers list + server
  detail) renders through the UI; the fleet/host read path is built + crash-safe but
  gated until the auth slice. (Backend auth being disabled doesn't change this — the
  FE must learn its tier, e.g. from `GET /me`.)

## 8. Sequenced plan
Prove the pipe on a read-only slice first (backend `KGSM_API_AUTH_DISABLED=1`), then auth, then realtime.

> **Slice 1 — DONE (2026-06-20).** Transport + adapter + live boot + honest-unknown
> rendering for the servers/hosts read path. Files: `src/lib/config.js` (new),
> `src/lib/adapters.js` (new), `apiClient.js` (live `get/post/patch` behind `LIVE`,
> envelope unwrap, reachability signal), `stores.js` (cold-boot when live), and
> honest-unknown guards in `ServerCard`/`StatTiles`/`DiagnosticsPage`/`HostCardBody`.
> Verified: `npm run build` green, mock smokes green (no regression), and
> `npm run smoke:live` against the live backend (adapters produce honest nulls — never
> 0; no fabricated meters; servers roster + detail render real data with `—`).
> Mock stays the default (no `VITE_API_BASE` → fixtures). **To run live:**
> `cp .env.example .env.local`, set `VITE_API_BASE=http://<host>:<port>`, `npm run dev`.

> **Slice 2a — Server/Dashboard A-remaps — DONE (2026-06-20).** Pure read-path
> adapter/derive work, no backend change. Files: `stores.js` (cross-store
> `resolveGameNames` — joins `server.blueprint` → `/library` name; subscribes
> `libraryStore` only and writes only on change, since `setState` always emits;
> re-runs after every `serversStore.refresh`), `GamePage.jsx` + `LibraryPage.jsx`
> (one shared `instancesOfBlueprint(game, servers)` helper, matched by blueprint id
> — **fixes a live data-corruption bug in BOTH surfaces**: two `rawgSlug:null`
> servers matched *every* blueprint via `null === null`, so every detail page and
> library card showed all servers / "2 servers"; extracting one helper also stops
> the two surfaces drifting), `ServerHero.jsx` + `kit.css`
> (className-based `native`/`container` runtime chip — honest API metadata; absent
> in mock so it renders nothing there). Verified: build + mock smoke green; live
> smoke adds three assertions (game-name join consistent — *2 servers / 29 catalog*;
> runtime chip on detail; GamePage shows `factorio-test` not `terraria-hardmode`).
> **Honest framing:** the live catalog returns `name === id` for every entry today
> (curation deferred upstream), so the game-name resolve is correct *wiring* with
> **no visible change yet** — it self-heals the moment curated titles land.
> **Deferred (named in the slice, deferred with cause):**
> • *Job-derived status* — `updating` is **live**: the backend carries the in-flight job on the
>   server (`activeJob`, kgsm-api 0.49.0), so a cold read has an honest source and the state
>   survives a reload. `crashed`/`error` still wait on alerts GET (slice 3). Don't fabricate.
> • *Server ports* — **not** a backend gap: `GET /servers/{id}` carries
>   `network.required[]`, but the FE never calls the detail endpoint (list omits
>   `network`; the detail GET is defined-but-unused, §3). Needs the detail-GET wired
>   first → its own slice (6, with `network.patch`).

> **Slice 4 — Auth/Me (FE half) — DONE (2026-06-21).** Wires the per-host tier from
> `GET /me` so the persona/route gate works against the live backend (no more forced
> "Preview as admin" lens). Files: `adapters.js` (`adaptMe` — honest passthrough,
> tier→`none` secure-by-default), `apiClient.js` (live transport injects the bearer of
> the node the call names — `liveBearer()`; null under
> `KGSM_API_AUTH_DISABLED`, so calls go out unauthenticated and that mode accepts
> them; adapt `/me`), `sessionStore.js` (LIVE `bootstrap` resolves tier from `/me`
> instead of the fake callback; **reactive bootstrap as hosts hydrate** — seed runs
> before the live host exists, the mirror of the game-name timing fix; `seed` never
> fabricates a tier/token in LIVE; `scheduleRefresh` guarded to token-only so an
> auth-disabled host doesn't fire a spurious refresh; `refresh` re-confirms via
> `/me`; new `tokenOf`). Verified: build + mock smoke green; live smoke drops the
> persona force and proves `GET /me` → `hotrod: admin` ungates fleet/host-deep-dive
> on its own (and the admin tier now renders the operator lifecycle controls).
> **THE BACKEND GAP (decision owed — see §6).** A real Discord login can't complete
> from the SPA: `/auth/discord/start` 302s to Discord, but the callback
> (`AuthController.cs:120`) returns `CallbackResult` **as JSON** with no handoff back
> to the SPA — the browser lands on the API origin showing raw JSON, and the minted
> access+refresh tokens never reach the SPA. So today the live FE only works against
> an **auth-disabled** backend. Closing this is a **kgsm-api change** (sign-off
> required, security-sensitive): the callback should `302` to an allowlisted SPA URL
> with tokens in the **fragment** (`#access=…&refresh=…` — fragments never hit server
> logs / Referer), or a popup + `postMessage`. The FE session layer above is already
> shaped for it (`bootstrap`/`tokenOf`/refresh) — only token *acquisition* is missing.

> **Slice 4b — OAuth fragment handoff — BUILT (2026-06-21; one manual browser
> login owed).** Closes the gap above (chosen mechanism: fragment redirect).
> **kgsm-api** (`feat/oauth-frontend-redirect` `56e5aa8`): `KGSM_API_AUTH_FRONTEND_URL`
> + the callback 302s to it with the session in the URL **fragment**
> (`#access=…&refresh=…` | `#error=…`), never the query; single fixed target (no
> open-redirect); CSRF gate unchanged; blank → unchanged JSON (215/215 tests green,
> +2 redirect tests). **kgsm-web**: `authRedirect.js` (capture+strip the fragment
> before the hash router reads it; `completeOAuthLogin` resolves the app-shell
> identity from `/me` before mount → no LoginPage flash), `main.jsx` (async boot),
> `sessionStore` (adopts the handed-back token for the lone host before its `/me`
> tier call — single-host; multi-host token routing still deferred), `LoginPage`
> (LIVE Discord button → full-page `…/auth/discord/start`; surfaces a captured
> `#error`). Verified MECHANICALLY: build + mock smoke green; live smoke parses/
> strips/one-shot-stashes the fragment + the error. **OWED — one human browser
> login** (real Discord consent can't be driven headlessly). **Still deferred:**
> refresh-token *rotation* — sessions are valid for the 15-min access TTL, then a
> re-login (the FE stores the refresh token but doesn't yet call the rotation
> endpoint; that's the fast-follow). Multi-host token routing (which host issued a
> token) — single-host only today.

> **Slice 7 — Diagnostics B-enrichment — DONE + LIVE-VALIDATED (2026-06-21).** Surfaces the rest
> of the monitor `Snapshot` the host deep-dive needs, the §9 "B" bucket (measured upstream, API
> didn't expose). **No upstream/monitor change** — it's all already in the cached snapshot.
> **kgsm-api** (additive, invariant-safe): enriched the **one shared** `MetricsMapping.ToHostMetrics`
> (so REST `Host` and the WS `host.metrics` tick stay byte-identical) — `MemCapacity` gains
> `available`/`swap{Used,Total}`, `DiskCapacity` gains `fs`, and `Host`/`HostMetricsDto` gain
> `perCore`/`load`/`diskIo`/`interfaces`/`hostname`/`uptimeSec`/`sampleTs`. **Present on BOTH list and
> detail** (zero extra scrape — the metrics are already cached; the `network` firewall block stays
> detail-only because *it* costs an on-demand probe). All null when metrics isn't operational
> (honest-unknown, explicit null not omitted). Tests 215, smoke **54** (+REST-detail +WS host-metrics
> telemetry assertions; the honesty-coupling check now guards all of them: any telemetry present ⇒
> capability operational). **kgsm-web**: `adaptHost` maps the new fields and keeps the **unsourced**
> ones honest-null — and the diagnostics rendering was audited so none renders a fabricated value next
> to the real data: temperature KPI hidden (no sensors), Network KPI drops the fabricated errors tone,
> RAM bar omits cached/buffers segments+legend, disk SMART pill hidden (no smartctl), iface ip/mac →
> "—", iface errors dropped. `chatTools` (the still-mock assistant, slice 9) made defensive for the
> same null fields. **Surfaced + fixed a latent crash:** the host deep-dive's `<SubTabs>` was used in
> `DiagnosticsPage` but only defined (unexported) in `App.jsx` — never hit before because the
> metrics-down host always bailed to "awaiting telemetry"; now that real telemetry renders, the path is
> live → extracted `SubTabs` to `src/components/SubTabs.jsx`, imported in both (avoids the App↔page
> import cycle). **Live-validated** on `hotrod`: started a real `kgsm-monitor` (host-only, on the API's
> configured socket) → `GET /hosts/hotrod` carried the 16-core grid / load / swap / ext4·vfat fs / iface
> throughput / hostname / uptime, capability operational; `smoke:live` green (host deep-dive renders
> 30k chars, all enrichment + honest-null assertions pass).
>
> **Slice 7 follow-on — `host.metrics` WS live-update — DONE + LIVE-VALIDATED (2026-06-21).** The
> deep-dive's numbers now update in place. **Frontend-only** (the API's `MetricsPump` already pushed
> the enriched `HostMetricsDto` on `hosts/{id}/metrics`, subscriber-gated — confirmed by a raw-socket
> probe: a real tick arrives the instant a client subscribes). (1) `adaptHostMetrics` reshapes the tick
> through the SAME `mapHostTelemetry` `adaptHost` uses (a live tick is byte-identical to the REST host
> it patches — the FE mirror of the one-shared-mapper invariant). (2) `hostsStore.mergeMetrics` merges
> **clobber-safe**: swaps telemetry, DEEP-merges `network` (replaces interfaces, KEEPS the firewall
> `open_ports` grid the tick omits), never touches `capabilities` except to stamp freshness. (3) The
> diagnostics deep-dive subscribes `hosts/{id}/metrics` via a `focusHostId`-keyed effect; the disposer
> **unsubscribes the socket topic** (re-idling the server pump — `stream.subscribe`'s disposer now drops
> any topic no remaining listener wants) **and clears the stamp**. (4) Freshness = `last_sample_at` stamped
> with **receipt time** (skew-immune); it's the deep-dive's only honest "frozen" signal (the FE doesn't
> subscribe `capabilities`, so a monitor death with the socket up ages the deep-dive to frozen at 30s).
> Cleared on leave so the stamp never leaks "frozen" to the per-server surfaces that share
> `hostMetricsFreshness`. `smoke:live` **+7 host.metrics assertions** (clobber-safety ×4, effect-subscribed
> merge, live re-render, disposer-clears) — all green ×2 runs; a raw-`WebSocket` probe proves the real
> enriched tick arrives on subscribe; `build` + `smoke-mount` (6) + `smoke-routes` (18 SSR) all green.
>
> **Slice 6 (partial) — Lifecycle commands + install — DONE + LIVE-VALIDATED (2026-06-21).** The two write
> paths that have a real FE surface today. **Frontend-only** (the M3 commands + M8·b install/uninstall
> endpoints, and the `jobs`/`servers` WS, already shipped). (1) **Commands** — `handleAction` dispatches
> through a new `commandServer(server,verb)` (stores.js) → `api.host(hostId).post("/servers/{id}/commands",
> {verb, origin:"ui"})`: the **host-scoped** client (bearer + 401→re-auth gate) with the M5 provenance
> `origin` stamped. The server's resulting status + the in-flight job already ride the `servers`/`jobs` WS
> (slice 5), so this is just the request shaping. The **`update` verb is deferred upstream** (M3 has no
> `update` → it would 400), so the ServerHero Update chip is **disabled in LIVE with an honest reason**
> (the mock keeps it as a demo affordance). (2) **Install** — `confirmInstall` gets a LIVE branch calling
> `installServer(cfg)` → `POST /servers {blueprint:cfg.game.id, name:cfg.name, origin:"ui"}`; it **does NOT
> fabricate a server row** (the mock fake-state-machine stays on the mock branch). The new instance surfaces
> on `servers` (server.patch) when the install job settles; the FE lands on the roster (per-instance install
> progress isn't shown — the job's serverId isn't in the roster until the server exists). Both writes route
> through the same host-scoped client. `smoke:live` **+3 command/install assertions** (request shaping for
> both — verified **non-destructively** via a fetch-capture returning a synthetic `202 {job}`, so no real
> start/install runs on the host — + the update-chip-disabled render), green ×3 runs against a live `hotrod`
> (kgsm-api auth-disabled + a host-only monitor on a `/tmp` socket, no root); `build` + mock smokes green.
> ⚠ one **pre-existing slice-7 smoke flake** observed on the FIRST run right after backend startup (not
> from this change): the host-deep-dive `noFab` regex (`0 cores|load 0\.0|CPU 0%`) tripped. **Mechanism
> UNconfirmed** — could NOT reproduce in 8+ subsequent runs; the measured host load was 0.25–0.32 and
> cpuPct ~2–14% (never near 0), so it is NOT a real low reading. The failing render was *shorter* (~25k vs
> ~26–27k clean), which *suggests* a metrics-capability-warmup transient where `adaptHost` briefly fell back
> to the telemetry skeleton (`cores:0`) → an on-screen "0 cores" the regex correctly catches — a possible
> slice-7 warmup-rendering gap worth verifying, not yet proven.
> **DEFERRED with cause (no FE consumer today — wiring = dead code, building = feature work):**
> • *open_ports command + `servers/{id}/network`/`network.patch` WS + a server-detail ports card* —
>   `GET /servers/{id}` carries `network.required[]` and the API pushes `network.patch`, but **nothing in
>   the FE renders a per-server ports card**: `network.required` is consumed only by the assistant
>   (`chatTools.js`, still mock → slice 9), and `open_ports` is only triggered from chat. The §4 clobber
>   landmine also applies to `network` (a `server.patch` nulls it) → the store-merge needs the same
>   "don't null on patch" fix `metrics.tick` will. Build the card (or land the assistant slice) first.
> • *uninstall (`DELETE /servers/{id}`)* — no FE trigger exists (no delete/danger-zone control). Add the UI
>   control first, then wire the one-line DELETE.
> The **engine round-trips** (a real start/stop→watchdog, a real install→download) are **owed** — they need
> the full watchdog+instance stack up and weren't run here (the request shaping is proven instead).

> **Slice 9a — assistant turn (streaming half) — DONE + LIVE-VALIDATED 2026-06-21.** `ChatPage` no
> longer does a raw Ollama-shaped `fetch` to the wrong route. New seam method **`api.host(id).turn(body,
> {onEvent,signal})`** (`apiClient.js`): POSTs `/assistant/turn` `{prompt}`, parses the SSE stream
> (`event:`+`data:` frames, keyed on the in-band `data.type`), and pumps the §5·a frames to `onEvent`. A
> pre-stream non-2xx throws `apiError` (the honest degrade — absent→404 / down→503 / relay-misconfig→502);
> an abort rethrows; a mid-stream drop just ends the pump (the streamed text stays — no fabricated `done`).
> Pre-call `ensure()` gate only (no replay — a turn isn't idempotent).
> **`ChatPage.sendLive()`** (LIVE branch, mock demo left intact) wraps a **pure exported reducer
> `reduceTurnFrame(messages, frame)`** in `setConvos`, translating frames onto the SAME message roles the
> thread already renders: `text.delta`→the assistant bubble; `tool.start`→a pending "reading…" pill spliced
> before the bubble; `tool.result`→that pill resolved to its `summary`; `error`→in-band failure (keeps any
> streamed text); `done`→reconcile to the authoritative full reply when present. The `tool.result` match is
> guarded to the **most-recent still-pending** pill of that id (reverse scan + `state==="pending"`): tool-call
> ids are **turn-local** (`tc_0_0` resets each turn), so without it a later turn's result retroactively
> rewrote an earlier turn's done pill (advisor-caught; single-turn coverage was blind to it). In LIVE the
> body is **`{prompt}` only** — the assistant owns context/memory/tools, so none of the mock's fabricated
> context-routing/evidence runs; `thinking.delta` ignored (think:false). A transcription-less voice note
> sends the mock's marker prompt (avoids a 400 on an empty prompt).
> **Scope chip — REMOVED 2026-06-26.** The composer's per-server "scope" selector (a `krystal-design`
> prototype leftover) was deleted with all its wiring: `ScopeChip`, `scopeId`/`setScope`/`serverRef`,
> `changeScope`, the docked page-context auto-scope effect, and App.jsx's now-dead `pageContext`. It never
> had a turn transport (`AssistantTurnRequest` carries no server field — the assistant resolves the server
> from the prompt), so removal is behaviourally inert. The "Now talking to X's assistant" host-switch
> notice (which reused the `role:"scope"` render path / `ChatScopeNotice`) is retained.
> **Validated:** real relay streams §5·a **verbatim** through `AssistantController` (curl, assistant
> operational); `LeafHealthMonitor` flips the `assistant` capability **operational** when the leaf's
> `/health` answers (so the FE gate opens naturally) — both proven live against a thin SSE stub at
> `KGSM_API_ASSISTANT_URL`. `smoke:live` Phase 6 (deterministic, leaf-independent): SSE parsed into the
> ordered frames, `text.delta` reassembled across a **mid-frame chunk boundary**, `tool.start`/`tool.result`
> paired by id, and the pre-stream 503 degrade surfaces as a thrown `apiError`. **The translation itself —
> the actual deliverable — is executed**, not just reasoned: a TWO-turn `reduceTurnFrame` sequence asserts
> text streams + the pill pairs by id, and turn-2's reused id resolves turn-2's pill without rewriting
> turn-1's (the bug above). Green with the assistant
> both **absent and operational** (hardened the dock-naive GamePage assertion — the now-rendering assistant
> dock's scope chip then listed every host server, which tripped a whole-document grep; chip since removed —
> see above). build + routes + mount
> green. **OWED:** the real-leaf (Ollama-backed `kgsm-llm` Service) round-trip.

> **Slice 9b — assistant command confirm (fork (a)) — DONE + VALIDATED 2026-06-21.** The turn's command half:
> `command.proposed` → Confirm → the M3 command path → an SPA-composed `command.verified`. **Frontend-only**
> (kgsm-llm relays `command.proposed` verbatim through kgsm-api's `AssistantController`; the M3
> `POST /servers/{id}/commands` + the `jobs` WS all already shipped). The contract is from
> `kgsm-llm/docs/wire-contract.md`: the SPA executes a confirmed proposal via the M3 path
> (NOT the assistant's `/confirm`), and `command.verified` is **not a backend frame** — the SPA composes it.
> - **Reducer:** `reduceTurnFrame` gains a `command.proposed` case → splices a confirm-first card BEFORE the
>   streaming bubble (the tool-pill-safe spot — bubble stays last for `text.delta`); on `done` the card is moved
>   BELOW the reply (scoped to this turn's contiguous run, so prior turns' cards stay put) so the turn reads
>   reply → action → verification. The card renders **from the proposal itself** (`confirm` + `subject.id`) — never
>   a store lookup (the model may propose a server with no roster row). The `token` is **inert** for the SPA (it
>   routes to M3, not `/confirm`; confirmed by the spec + the controller) → dropped.
> - **Verbs:** `start`/`stop`/`restart`/`open_ports` are API-backed (M3) → arm → Confirm → run. The rest the
>   model can propose (`update`/`install`/`uninstall`/`backup`/`set_config`) have **no API endpoint yet** (spec §6
>   matrix) → the card renders **disabled with an honest reason** rather than firing a 400.
> - **Execute (`stores.js`):** `commandServer(server,verb,origin="ui")` gains the origin arg; new
>   `confirmCommand(server,verb)` POSTs `origin:"assistant"` then awaits the job outcome. A small id-keyed
>   `jobsStore` (fed by the **existing** `jobs` WS subscriber, so no frame is missed) retains each adapted job;
>   `awaitJob(id, hostId)` is **race-free** (check current state, THEN subscribe — no await between) and the give-up
>   is **socket-liveness-gated, NOT wall-clock and NOT time-at-state** (a real start runs queued→running→…minutes,
>   no frames…→done, so a long silent gap is the NORMAL slow case — surrendering on elapsed time would flip a
>   succeeding command into a stale permanent "couldn't confirm"). While the host socket is UP we wait indefinitely
>   (the late `done` lands); honest "unknown" only when the socket is sustained-DOWN (the one state where the
>   un-replayable outcome frame genuinely can't arrive) — never a fabricated ✓. Timing + liveness probe injectable
>   for tests (`__setJobTiming`).
> - **`command.verified` composition (honest, conscious deviation):** `ok` from the job outcome (clean id
>   correlation — `adaptJob` keeps the id + `error`); the **headline composed from verb+server** (for a lifecycle
>   verb it's identical to the audit summary, and lifecycle audit rows carry no `jobId` → correlating one buys
>   fragility for nothing — so this is **job-outcome primary + locally-composed headline**, NOT the plan's literal
>   "3-source correlation"); `lines[]` honest-thin (the real job `error` on failure, nothing fabricated). `open_ports`
>   is intent-only (the client never receives the port list) → the headline stays generic (naming ports = fabrication).
> - **Landmark removed:** `App.handleAssistantAction` (the mock that both fabricated an `auditStore.prepend` row AND
>   called `commandServer` with `origin:"ui"` = a double-write with the wrong origin in LIVE) is now guarded
>   `if (LIVE) return;` — the LIVE chat path never calls it (it runs entirely through `confirmCommand`), so the
>   backend's kgsm-echo audit row is the single source.
> - **Validated:** `smoke:live` **+11** (reducer splice + done-reorder; verb gating; `composeVerified` ok/fail/
>   unknown/open_ports; **the full glue** — `confirmCommand` → POST `{verb,origin:"assistant"}` captured →
>   `job.patch` via `__dispatch` → `awaitJob` resolves → composed, AND `auditStore` **unchanged** = no double-write;
>   `awaitJob` race-freeness; **the `ChatCommand` component renders** both the runnable and the disabled paths) —
>   all green; build + mock smokes (18 routes / 6 mount) green; **smoke:live 124✓**. **Scope:** request shaping +
>   WS correlation are proven deterministically (fetch-capture + `__dispatch`); the **real engine round-trip**
>   (a confirmed proposal → watchdog start → real job settle) is **owed-to-human** (needs the full engine + a leaf
>   that proposes a command), same bar as slices 6/9a. Files: `stores.js`, `ChatPage.jsx`, `App.jsx`, `kit.css`,
>   `scripts/smoke-live.mjs`.

> **Integrations (Discord) — DONE + LIVE-VALIDATED 2026-06-21** (picked up while kgsm-llm work — and so
> slice 9b — proceeds in parallel). `DiscordPage` was 100% mock (hardcoded webhook string, fake toggles,
> dead buttons); now its LIVE branch is wired to the host's `kgsm-api /integrations/discord` (admin-gated),
> with the bundled demo kept for `!LIVE`. **GET** renders the **server-defined** catalog — the honest **6**
> events (online/offline/crash/update/installed/backup), dropping the mock's fabricated `join`/`lowdisk`
> (no player/threshold source upstream) — plus the masked webhook hint, channel label, and the `enabled`
> master. **Event toggles** are their own immediate sparse PATCH `{events:[{id,enabled}]}` (optimistic +
> revert-on-fail), which **never touch the webhook**. **Webhook is write-only:** GET returns only a masked
> hint (`…/webhooks/{id}/{tok}***`), never the URL — so the pure exported **`buildIntegrationPatch`** builds
> the Save body and includes `webhook` **only when the user typed a new non-empty value** (clearing is a
> separate explicit affordance → `""`); the masked hint can never round-trip and silently wipe the secret
> (the one place a naive form-serialize = data loss). **`/test`** is a real send. Mutating controls gate on
> the admin tier (`sessionStore.tierOf`); the `bot` block stays honestly null (the slash-command list is
> illustrative — control commands are kgsm-bot's surface, not this webhook). New `adaptIntegration`
> (passthrough + `events:[]` hardening) wired into `adaptResponse`. **Validated** against the live
> *persistent* backend (unlike 9a's fetch-capture): `smoke:live` Phase 7 = the `buildIntegrationPatch`
> footgun unit test (×6) + a real round-trip — toggle persists + restores, a valid-but-fake webhook
> set → GET confirms `configured:true` + a masked hint + **the raw secret never echoes back** → cleared,
> and an unconfigured `/test` → honest **409** (no channel spam). All mutations revert to baseline (the
> webhook set/clear is `try/finally`-guarded so a mid-phase throw can't leave residue on the persistent dev
> host). build + routes + mount green; smoke:live 83✓. **Scope of "validated":** the **contract +
> `buildIntegrationPatch`** are executed/asserted; the `DiscordLiveConfig` **component** render + optimistic
> toggle/revert are NOT exercised by any check (thin glue, correct by inspection — the footgun can't fire:
> the masked hint lives only in the input `placeholder`, never `value`, and `webhookDirty` keys off the
> typed value). **Remaining:** the **Slack** provider (built upstream, no FE surface yet) + the broader
> `/settings` page (not built upstream).

> **Audit paging + filters — DONE + LIVE-VALIDATED (2026-06-21). Crosses into kgsm-api.** Two problems.
> **(1) Paging:** in LIVE the audit log fetched **one** `/audit` page, so everything older than the newest
> ≤50 rows was permanently unreachable (`adaptAudit` flattened away `nextCursor`). Fix: `adaptAudit`
> preserves the `{rows, nextCursor}` keyset envelope (mock bypasses the adapter → bare array → `null`,
> normalized in the store); **`auditStore.refresh()` walks the cursor** (batch 200, cap 1000) so a typical
> per-host log loads whole; new **`loadMore()`** pulls the next older page (dedup-by-id, generation-guarded
> so a slow load can't append onto a list a fresh `refresh` replaced). The page reads `nextCursor != null`
> as the incompleteness signal → renders **"Load older events"** + a disclosure note, augments the
> empty-state. **(2) Filters PUSH DOWN to the backend** (decided with the user — the per-host log grows
> *unbounded*: `player.join`/`leave` are audited and there's no retention, so client-only filtering can't
> reach an old crash behind weeks of join/leave noise). `auditServerParams` maps the page's filter state →
> query params: **severity** (incl. `attention`→`warn,danger`), **serverId**, **actor**, **range**→`since`
> (ISO), **category**→action-prefix; a mount effect re-queries on change so the cursor walks the FILTERED
> log. **Only free-text search stays client-side** (no backend `q=`) — the disclosure covers it. **Counts
> are omitted in LIVE** (the loaded set is server-filtered + possibly partial, and there's no aggregation
> endpoint → a count would be a fabricated/relative total). **Consequences (accepted):** the actor dropdown
> lists only actors in the current filtered window (no distinct-actors source; selecting one still
> re-queries the whole log); filter chips show no count badges in LIVE.
>
> **kgsm-api side (the cross-repo half):** `GET /audit` gained `since` + `category` params and multi-value
> `severity` (comma → `IN`, so `attention` pushes down); plus a **`Ts`→UTC-ticks value converter** on
> `AuditEntry` — EF Core SQLite **cannot translate a `DateTimeOffset >=` comparison** (the `since` filter),
> so it's stored/compared as `long` (round-trips to a UTC `DateTimeOffset` on read; ordering unaffected —
> keyset is on RowId). Storage change ⇒ dev DB wiped (no migration; EnsureCreated). The **"tolerate unknown
> actions → generic icon"** FE item was **already satisfied** (`ACTION_META` fallback).
>
> **Validated:** FE build + routes(18) + mount(6) green, `smoke:live` **108✓** (+ adaptAudit envelope ×3,
> `auditServerParams` mapping ×6, real keyset `limit=1`, **live pushdown** via the store — serverId scopes,
> unknown→0, `since` future→0 / 1h-ago→recent, the **deep-link→effect→refresh glue** proving filters truly
> push down not client-only, walk-to-completion, `loadMore` no-op-when-complete + the real cursor WALK
> append/dedup/order, incomplete-UI render+disappear). kgsm-api: **0-warn build, 218 tests** (+3 audit:
> multi-severity / since / category), **smoke 54/54**. **Scope:** the real per-host log is < cap, so the
> multi-page initial walk + incomplete-UI are exercised via a *seeded* partial window; cursor + pushdown
> mechanics are proven against the live backend.

1. **Transport + adapter scaffold** — real `fetch` client behind the `api` seam,
   reads `VITE_API_BASE`+`/api/v1`, unwraps the error envelope; mock stays the
   no-base fallback. An `adapters/` module: BE DTO → FE shape, one mapper per resource.
2. **Slice 1 (read-only): hosts + servers** — wire `hostsStore`/`serversStore` GETs
   through the adapter; status-vocab remap; honest-unknown rendering. Verify against
   a live single host with auth disabled.
3. **Slice 2: audit + library + alerts (GET)** — **DONE (2026-06-21).** Audit + library
   already hydrated live (cold boot + passthrough adapters); the DB recreate (§7b) cleared
   the `/audit` 500 → both live-verified (audit render-path proven with a real emitted row).
   Alerts (deliberately empty in LIVE before) now hydrates from `GET /alerts?status=firing`
   **+** `?status=resolved&since=24h` via a new `alertsStore.refresh()` (self-hydrates on LIVE
   load; `rehydrateAll` re-pulls it on reconnect). `adaptAlerts` derives a display `icon`
   from the honest `source`/`severity` (API carries none — presentation, not a measured
   fact) and passes every sourced field through; `prompt`/`autoResolves` stay absent (demo-
   only). `adaptResponse` now matches on the base path (`split("?")[0]`) so filtered/paged
   reads still hit their adapter. Verified: build green, mock smoke green, `smoke:live` green
   (+icon-derive, +alerts-hydrate, +audit/alerts live render).
4. **Auth** — real OAuth (`start`/`callback`/`refresh` + bearer + refresh store),
   tier from `/me`, the 401/403/`login_required` machine on real responses.
5. **Realtime** — **DONE (2026-06-21).** Real WS client (`liveStream.js`) on
   `/api/v1/stream`, subscribe protocol, `adaptStreamMessage` reshape, topic/type remaps
   (`server.patch` upsert, `server.removed`, `job`↔`job.patch`, `audit.append`,
   `alert.*`), backoff reconnect + re-subscribe + rehydrate-on-open. Metrics topics
   deferred (no live monitor). Verified: audit.append e2e (kgsm emit→WS→store) +
   synthetic-inject for the other three remaps in `smoke:live`.
6. **Commands + ports + install/uninstall** — `commands {verb,origin}`, `open_ports`,
   `POST/DELETE /servers`; reconcile job/`network.patch` streams.
7. **Assistant** — ✅ **9a + 9b done** (streaming turn through the seam + the command-confirm half: `command.proposed`→fork (a)→SPA-composed `command.verified`).
8. **Multi-host fan-out** — host registry (D1), per-host sessions/sockets, cluster rollup. **Cluster federation** (the "add one, see all" + one-login-across-the-cluster build that completes this slice) lives in **`docs/cluster-plan.md`** (SPA-C0…C5, aligned to `kgsm-api/PLAN-peers.md`). **SPA-C0 built** (the Cluster page: `api.peers`/`clusterStore`/`ClusterPanel` over the real `/peers` roster, and the Fleet→Cluster canon rename). Both SPA-facing API deps are built: G1 (viewer node list `GET /peers/roster`, client seam wired) and G2 (vouch initiator `POST /auth/cluster-session/request`). Still to wire: SPA-C1 SSO (lazy vouch-on-401 — per-host auth is single-host today) and the C0.5 roster→registry mirror.
9. **Integrations + settings** — ✅ **Discord DONE** (DiscordPage → `/integrations/discord` GET/PATCH/test, admin-gated, live round-trip-validated). Remaining: **Slack** provider UI + the rest of Settings (`/settings` not built upstream).
10. **Degrade** — console unavailable; capability-driven panel hiding; honest-unknown everywhere.

---

## 9. Field-level supply map (the working checklist)

Built from three inventories (2026-06-20): the FE per-surface field consumption, the
FE mock layer (`data.js`/`stores.js`/`apiClient.js`), and the **authoritative** live
kgsm-api DTOs (`src/Api/Contracts/*.cs`) + the monitor contract
(`kgsm-monitor/src/Monitor.Contracts/Snapshot.cs`).

**The discriminating axis is where an honest source exists** — *not* "mock vs real":

- **A — API supplies today** → adapter remap only. Just wire it.
- **B — measured upstream, API doesn't expose yet** → additive API work, **no upstream
  change** (the value already exists in a monitor `Snapshot`, a kgsm event, or kgsm-lib).
- **C — no honest source anywhere yet** → needs kgsm / kgsm-lib / watchdog / monitor to
  *produce* it first (then becomes B). Render honest-unknown until then.
- **D — not measurable / N/A** → honest-unknown forever. Render `—`; never fabricate.

> **The big discovery:** the monitor `Snapshot` already measures `PerCore[]`,
> `LoadAvg`, swap (`SwapTotal/UsedKb`), disk `Fs`, disk IO, per-interface
> `Rx/Tx/RxPps/TxPps`, `Hostname`, `UptimeSec` — but the API surfaces only a coarse
> subset (`cpuPct`, `mem{used,total}`, `disks{mount,used,total}`). So most of
> DiagnosticsPage is **B (additive API mapping)**, not "needs upstream." That's the
> single biggest lever in this plan.

### Server (`ServerCard`, `ServersPage`, `StatTiles`, `DashboardPage`, detail)
| FE field | BE today | Bucket | Action |
|---|---|---|---|
| `id`, `name` | `id`, `name` | **A** | passthrough |
| `game` (display) | `blueprint` (id) | **A** | resolve display via `/library` lookup |
| `status` online/offline | `running/stopped/unknown` | **A** | remap (done) |
| `status` installing/updating | in-flight `job.verb` | **A** | synthesize from job stream |
| `status` crashed/error | firing alert / `job.failed` | **A** | synthesize from alerts + jobs |
| `cpu` | `metrics.cpuPctCore` | **A** | per-core unit; `null`→`—` (done) |
| `ram.used` | `metrics.memBytes` | **A** | bytes→GB (done) |
| `ram.max` | — (no per-instance limit) | **D** | drop per-server max bar |
| `version` | `version` (nullable) | **A** | passthrough |
| `runtime`, `steamAppId*`, `network` | same | **A** | surface (runtime badge, port card) |
| `job{verb,state}` | `jobs` WS `job.patch` | **A** | remap `job`↔`job.patch` |
| `last_backup` | `backup.create` audit rows | **B** | derive latest from audit (weak; or hide) |
| `players{current,max}` | `onlinePlayers` | **A** | wired; `null` (unobservable) stays honest-unknown |
| `uptime` | — (no per-instance uptime) | **C** | derive from `server.start` ts later; `—` now |
| `ip` | — (kgsm doesn't resolve) | **C** | host addr+port later; `—`/hide now |
| `update_available` | — (no update check) | **C** | hide until an update-probe exists |
| `notice` | — (no notice field) | **C** | needs an API field (settings); hide now |
| `config{...}`, `log[]` | — (no config/console API) | **C** | see surface rows below |
| `art` (gradient) | — | n/a | FE-local fallback, keep |
| `rawg_slug`/cover | `rawgSlug`/`cover` reserved null | **D** | FE gradient fallback |

### Host (`DiagnosticsPage`, `HostCardBody`, dashboard capacity)
| FE field | BE today | Bucket | Action |
|---|---|---|---|
| `id`, `name`, `online` | `id`, `label`, `status` | **A** | remap (done) |
| `tier`, `authDenied` | (auth layer) | **A** | keep FE per-host session source |
| `capabilities.*` | same (richer) | **A** | align `info` field names |
| `network.open_ports` | detail `network.openPorts[]` | **A** | remap |
| `cpu.usage_pct` | `cpuPct` | **A** | passthrough |
| `ram.total_gb/used_gb` | `mem{used,total}` | **A** | passthrough |
| `disks[].mount/total/used` | `disks[{mount,used,total}]` | **A** | passthrough |
| `cpu.per_core[]` | monitor `Cpu.PerCore` | **B** | **expose on Host DTO** |
| `cpu.load_avg[]` | monitor `Cpu.Load` | **B** | **expose** |
| `ram.swap_total/used_gb` | monitor `Mem.Swap*Kb` | **B** | **expose** |
| `ram.free_gb` | monitor `Mem.AvailableKb` | **B** | expose/derive |
| `disks[].fs` | monitor `MountUsage.Fs` | **B** | expose |
| disk IO, `network.interfaces[].{name,rx,tx,rx_pps,tx_pps}` | monitor `Disk.Io`, `Net.Ifaces` | **B** | **expose** (new Host fields) |
| `hostname` | monitor `Hostname` | **B** | expose |
| `boot_time` | monitor `UptimeSec` | **B** | expose/derive |
| `panel_version` | `ApiInfo.version` | **B** | expose on host |
| `cpu.model/cores/threads/freq_ghz` | — (static cpuinfo, not sampled) | **C** | small monitor+api add |
| `ram.cached_gb/buffers_gb` | — (not measured) | **C** | monitor add or `—` |
| `network.interfaces[].{ip,mac,errors}` | — (not measured) | **C** | monitor add or `—` |
| `disks[].device` | — (not measured) | **C** | monitor add or `—` |
| `disks[].smart` | — (needs smartctl) | **C/D** | likely `—` |
| `cpu.temp_c`, `sensors[]` | — (no sensors sampler) | **C** | monitor sensors slice or `—` |
| `processes[]` (pid/ppid/cpu/ram/threads/fds/state) | monitor sums per-server only, no list | **C** | new monitor contract field (significant) |
| `region` | — | **D** | FE registry concept; `—` |

### Audit (`AuditLogPage`, `StatTiles`, dashboard activity)
| FE | BE | Bucket | Action |
|---|---|---|---|
| bare array | `{data,nextCursor}` | **A** | unwrap (done); wire paging |
| `actor{name,provider}` | `actor{kind,name,provider}` | **A** | pass `kind` |
| `action` (broad enum) | closed vocab | **A** | tolerate unknown → generic icon |
| `severity/target/summary/meta/serverId/hostId` | same | **A** | passthrough |
| ✅ **live-verified (slice 3)**: dev DB recreated (§7b) → `/audit` 200; a real emitted `server.start` row flows through `adaptAudit` and renders | — | — | DONE |

### Alert (`AlertsPage`, `NeedsAttention`, `ContextualAlerts`) — **DONE (slice 3)**
| FE | BE | Bucket | Action |
|---|---|---|---|
| read from store only (no GET) | `GET /alerts?status=&since=` `{data}` | **A** | ✅ `alertsStore.refresh()` hydrates firing + 24h resolved |
| `icon` | — | **A** | ✅ derive from `source` (then `severity`) in `adaptAlerts` |
| `severity` danger/warn | `info/warn/danger` | **A** | handle `info` |
| `anchor.serverId` | top-level `serverId` | **A** | read top-level |
| `source/status/raisedAt/escalated/attempts/resolution/resolvedAt` | same | **A** | passthrough |
| `prompt`, `autoResolves` | — (mock-only) | **D** | drop |

### Library (`LibraryPage`, `GamePage`, `InstallModal`)
| FE | BE | Bucket | Action |
|---|---|---|---|
| `id`, `name` | `id`, `name` | **A** | passthrough |
| `category` | `type` (native/container) | **A** | relabel (type badge) |
| `ports`, `steamAppId*` | same | **A** | surface |
| `players` (string) | `specs.maxPlayers` (null) | **C** | metadata curation upstream; `—` now |
| `addedAt`, `hosts[]` | — | **D** | drop / FE registry |
| `cover`/`art` | `cover` reserved null | **D** | FE gradient fallback |

### Me / Auth (`LoginPage`, persona/tier)
| FE | BE | Bucket | Action |
|---|---|---|---|
| tier from callback | `GET /me {user,tier,scopes}` | **A** | wire `/me` for tier |
| callback `user_id` | `userId` | **A** | rename |
| no refresh store | `refresh` JWT + `POST /auth/session/refresh` (bearer) | **A** | add refresh-token store |
| `?host=&prompt=` callback | real `start`→`callback?code=&state=` | **A** | replace flow |

### Whole-surface gaps (no current backend source — call out, don't bury)
| Surface | Needs | Bucket | Note |
|---|---|---|---|
| `PerformanceTab` / `TimeSeriesChart` | metrics **history** | **C** (big) | BE emits point-in-time (`metrics.tick`, `Server.metrics`) only. Options: FE accumulates the live stream into a session-local ring (B-ish, no cold history), or BE/monitor add a history store (C). |
| `PlayersTab` | player roster + per-player ping/playtime | **C** | presence mid-build (`player.join/leave` audit exist; no roster/count). |
| `ConsolePanel`/`LogConsole` | `GET /servers/{id}/console?tail&before` + `/console/download` + the per-server topic | ✅ **DONE** | window hydrate + live follow; `before` takes the byte cursor the response reports, so reading back reaches the start of the run; download streams the whole run. Native-only — a container's console belongs to Docker. |
| `BackupsList` | backup list + restore command | **C** | only `backup.*` audit; no list/command API. |
| `ServerNotice` (server note) | `GET/PUT/DELETE /servers/{id}/note` + `note` on the `Server` DTO | ✅ **DONE** | operator-gated write, viewer read; note rides the list DTO + `server.patch` so the dashboard tile needs no detail fetch; byline from the backend's attribution, blank when it recorded none. |
| `FileBrowser` | `GET/PUT /servers/{id}/files…` | ✅ **DONE** | Tier 3 #12: lazy working-dir tree + raw read + etag save, operator-gated. `put` seam added. binary/too-large/symlink/jail handled honestly. |
| `ServerSettings`/`SettingsPage` | config/file read+write API | **C** | no `/settings` endpoint (config is `/servers/{id}/config`; settings panel still WIP). |
| `ChatPage` (assistant) | `POST /assistant/turn` SSE | ✅ **9a done** | rewritten onto `api.host(id).turn()` SSE through the seam (streaming half). 9b = command.proposed→verify. |
| `DiscordPage`/integrations | `/integrations` (built) | ✅ **DONE** | DiscordPage LIVE branch wired to `/integrations/discord` (GET catalog+masked hint / sparse PATCH / real test), admin-gated, round-trip-validated. Slack UI = follow-on. |

## 10. Per-surface rollup (what unblocks each screen)

Cheap-wins-first falls out of the buckets above:

- **Servers list + Server detail** — read path + game-name resolve + runtime chip **DONE** (slice 2a) + **live updates DONE** (slice 5: `server.patch` upsert / `server.removed` / `job.patch` over the real WS) + **lifecycle commands + install DONE** (slice 6: `commandServer`/`installServer` with `origin:"ui"`; `update` disabled in LIVE). Remaining: server-ports card + `open_ports`/`network.patch` and uninstall — **deferred, no FE consumer yet** (the ports card isn't built; `network.required` is read only by the still-mock assistant; uninstall has no UI trigger).
- **Realtime (SSE, migrated from WS 2026-07-02)** — **DONE (slice 5, 2026-06-21; transport swapped to SSE 2026-07-02).** `liveStream.js` fetch-based SSE stream on `/api/v1/stream`; `servers`/`jobs`/`audit`/`alerts` topics live with per-frame adaptation + drop→reconnect→re-subscribe→rehydrate. **`host.metrics` now live too** (slice 7 follow-on, 2026-06-21 — deep-dive-scoped subscribe + clobber-safe merge). Still deferred: `metrics.tick` (per-server, same shape, wire when per-server tiles need live numbers) + `capabilities.patch` (FE reads capability status from REST hydrate/rehydrate today); `network.patch` → slice 6; console = permanent gap.
- **Dashboard** — **wire-able now** (A: servers/hosts/library/audit rollups; now also live via the WS). `ping_ms` = B (client RTT); `region` = D.
- **Audit / Alerts / Library** — **DONE (slice 3, 2026-06-21).** Dev DB recreated → the audit/integrations 500s are cleared; audit + library live-verified; alerts hydrate from `GET /alerts` (firing + 24h resolved) with a derived display icon. Live `audit.append`/`alert.*` prepend now wired (slice 5). Remaining (later): audit keyset paging.
- **Auth / Me** — **DONE** (slices 4 + 4b): `/me`-driven per-host tier ungates fleet/dashboard; bearer injected when held; OAuth **fragment handoff** built across kgsm-api + kgsm-web (mechanically verified). **Owed:** one manual browser login; refresh-token *rotation* (15-min sessions until then); multi-host token routing.
- **Diagnostics (host)** — **B-enrichment DONE (slice 7, 2026-06-21), live-validated.** The
  per-core/load/swap/disk-fs/IO/iface/hostname/uptime block is now surfaced by kgsm-api (additive,
  against the **already-cached** monitor Snapshot — zero extra scrape; present on BOTH `/hosts` list
  and `/hosts/{id}` detail, unlike the firewall-probe `network` block which stays detail-only). The
  adapter maps it all and keeps the **unsourced** fields honest-null (sensors/temp, cpu model/threads/
  freq, ram cached/buffers, disk device/SMART, iface ip/mac/errors, process list) — the rendering was
  audited so none shows a fabricated `0`/`"ok"` next to the real data. Live-proven on `hotrod` with a
  real monitor up (16-core per-core grid, load, swap, ext4/vfat fs, iface throughput). Remaining as **C**
  (monitor slices, honest-unknown until then): sensors, process list, cpu model, disk device/SMART,
  iface ip/mac. **Live-updating numbers (`host.metrics` WS tick) — DONE (follow-on, 2026-06-21):** the
  deep-dive subscribes `hosts/{id}/metrics` while open; ticks merge clobber-safe (keep capabilities +
  firewall open_ports) and stamp receipt-time freshness, so cpu/ram/disk/net update in place and age to
  frozen at 30s if the feed stops. The disposer unsubscribes (re-idling the server pump) + clears the
  stamp on leave. Frontend-only — the API already emitted the enriched tick.
- **Performance** — **C (big)**: needs metrics history. Decide FE-accumulate vs BE-store before building.
- **Players** — **C**: gated on presence tracking (actively being built upstream).
- **Files** — **DONE (Tier 3 #12, 2026-06-24):** `FileBrowser` wired to `GET/PUT /servers/{id}/files…` — lazy tree (root on mount, children on expand), raw read into a textarea, etag Save + Reset, truncation banner, binary/too-large/symlink shown-but-not-openable with a reason, 412 reload-prompt. Operator-gated; `api.put` seam added. Backend live-validated on both real servers.
- **Console / Backups / Settings** — **C/deferred**: Backups DONE; Console/Settings have no API; degrade to honest-unavailable.
- **Assistant chat** — **9a + 9b DONE (2026-06-21):** `ChatPage` streams a real turn via `api.host(id).turn()` SSE through the seam (text/tool frames → existing roles; honest degrade). **9b** adds the command-confirm half: `command.proposed`→Confirm→`confirmCommand` (M3 path, `origin:"assistant"`)→SPA-composed `command.verified` from the job outcome (job-outcome primary + locally-composed honest headline; API-backed verbs run, the rest render disabled; the mock double-write landmark guarded off in LIVE). OWED: real-leaf (Ollama) + real engine round-trip.
- **Assistant history (reverse path)** — **9d DONE + LIVE-VALIDATED (2026-06-26):** chat history now lives server-side (assistant SQLite, keyed `web:<userId>:<chatId>`), not only in localStorage. On a usable host, `ChatPage` fetches `GET /assistant/conversations` and folds the caller's own past chats into its list (`mergeServerConversations`, join by `id`); opening a server-only chat lazily fetches `GET /assistant/conversations/{id}` and `scaffoldHistory` rebuilds the thread through the SAME message vocabulary a live turn produces (§5·a schema reuse — no second renderer; a compaction checkpoint renders as a quiet divider). API relays both verbatim, scoped to the verified Discord id. Live-validated end-to-end on hotrod (real gemma4:12b): two seeded chats listed newest-first with derived titles + turn counts; a 2-turn transcript returned §5·a-shaped incl. the `google_search` tool; per-chat isolation held. **Delete is now a server-side SOFT-delete** (`DELETE /assistant/conversations/{id}` → `204`): `deleteChat` fires it for the chat's owning host so a removed chat doesn't resurrect from server history; the assistant tombstones the row (hidden from the list) but keeps the transcript — the append-only corpus is never destroyed. **Card-casing fix (same date):** the assistant's stored §5·a card is now serialized camelCase (Web defaults), byte-identical to the live SSE card, so a replayed card renders through the same path as a live one.
- **Integrations** — **Discord DONE (2026-06-21):** DiscordPage rewritten from pure-mock onto the live `/integrations/discord` (GET the server-defined 6-event catalog + masked webhook hint; per-event sparse-PATCH toggles; `buildIntegrationPatch` Save that sends `webhook` only when user-typed; real `/test`; admin-gated). Round-trip-validated against the live persistent backend (toggle persist+restore, webhook set→secret-never-echoes→clear, unconfigured-test→409). Remaining: **Slack** provider UI; the broader `/settings` surface (not built upstream).

**Suggested order** (each is a clean component-by-component slice): ~~Server/Dashboard
**A** remaps~~ (slice 2a) → ~~**Auth/Me**~~ (slices 4/4b) → ~~recreate the backend DB to
clear the two 500s~~ + ~~**Audit/Alerts/Library** reads~~ (slice 3) → ~~realtime WS~~
(slice 5) → ~~**Diagnostics B-enrichment** (the monitor-Snapshot exposure, biggest
payoff)~~ (slice 7, 2026-06-21) → ~~host-metrics live-update (`host.metrics` WS tick)~~ (slice 7
follow-on, 2026-06-21) → ~~lifecycle commands + install~~ (slice 6 partial, 2026-06-21) →
~~**assistant streaming turn**~~ (slice 9a, 2026-06-21 — `ChatPage` onto `api.host(id).turn()` SSE) →
~~**integrations (Discord)**~~ (2026-06-21 — DiscordPage onto `/integrations/discord`, done while kgsm-llm
proceeds in parallel) → ~~**slice 9b** (`command.proposed`→fork (a)→`command.verified`)~~ (2026-06-21 —
kgsm-llm unblocked; command-confirm half through the M3 path) → **next:** the deferred slice-6 tail
(server-ports card + `open_ports`/`network.patch`, and uninstall) **once a FE surface exists**, OR the
**Slack** integration UI → presence/performance/console as their sources land.
