# src/lib/ — the data layer & policy

Everything that isn't a React view lives here: the backend seam, the reactive
stores, the honesty boundary, auth/RBAC policy, and the URL router. **Components
and pages never touch `fetch` or the API directly — they go through a store, and
stores go through `apiClient`.** The root `../CLAUDE.md` ("The data layer"
section) is the narrative; this is the per-file map.

## The one data path

```
component/page ──useStore──▶ domainStore ──▶ api.get/post/patch ──▶ adapters ──▶ store
                                (stores/)      (apiClient.js)      (adapters.js)
realtime: liveStream.js (fetch-SSE) ──adaptStreamMessage──▶ same stores
```

## File map

**Backend seam & realtime**
- `apiClient.js` — the **single** kgsm-api seam. `api.get/post/patch`, per-host
  `api.host(id)` (401-retry / silent renew), `api.fanOut` (multi-host roll-up),
  `api.stream` (subscribe). Owns `connectionStore`
  (REST reachability → cold-start/banner) and `realtimeStore` (per-host SSE
  state). **Every call site only ever sees `api`.** Every stream frame it
  dispatches carries `hostId` — the node whose socket delivered it — so a
  listener never has to guess which node produced an event.
- `liveStream.js` — fetch-based SSE. One
  primary stream per host + per-view dynamic streams; drives `realtimeStore` via
  `onMode`.
- `sse.js` — the low-level fetch-SSE reader used by `liveStream`.
- `alertsApi.js` — alerts fetch/stream glue.

**The assistant seam (a separate backend)**
- `assistantClient.js` — the seam onto an assistant **leaf**, spoken directly on its own
  public origin. `assistant.host(id)` mirrors `api.host(id)`'s shape against the leaf's own
  unprefixed routes (`/turn`, `/confirm`, `/conversations`, `/events`, `/admin/conversations/…`).
  It records the id the leaf's `/events` stream hands out and sends it on **every** call as
  `X-Assistant-Origin`, so the events a call causes come back stamped and the surface that made
  it can decline to re-apply its own change. The id is per-connection, not per-host: it is
  dropped when the stream ends, because stamping calls with a stream nothing is listening on
  would make a surface skip echoes it never received. Reconnection and the resync that must
  follow a gap belong to `chat/useConversationStream.js`, not here — the seam carries one
  stream and reports when it ends.
  Auth is reactive like the node seam, except the two non-replayable calls — a turn spends
  the user's prompt and a confirm burns a single-use token, so a lapsed access token is
  rotated **before** the call rather than healed from a 401.
  **Speech is here too**: `speech()` asks what the host's engine can do (`{ hear, speak }`) and
  `transcribe(pcm)` posts one voice note as raw bytes. Ask before offering a microphone — a recording
  made on a host that cannot listen is one nobody can read — and note the transcript comes **back**
  to the composer rather than becoming a turn.
  **No fallback:** a host whose capability names no public origin throws `ENOROUTE`. Routing
  the call through kgsm-api's relay instead would restore exactly the coupling this seam
  removes, and the relay is peer transport for another node's assistant.
- `assistantSession.js` — the per-host session with that leaf: its own storage prefixes, its
  own refresh rotation against the leaf's `/auth/session/refresh`, and the sign-in bounce.
  `originOf(hostId)` reads the address off the host's assistant capability, which is the only
  thing the aggregator contributes — discovery, not transport.
  **The sign-in is silent.** Every surface on a host is the same Discord application, so a browser
  signed into the panel has already authorized the assistant and `prompt=none` completes with
  nothing rendered. `ensureSession(hostId)` is the one decision point, ranked by cost: live ⇒
  nothing, a held refresh ⇒ a silent rotate, neither ⇒ a redirect. **One redirect per host per
  tab** (a `sessionStorage` marker written before leaving, cleared only when a session arrives), so
  a leaf that keeps refusing cannot loop the browser; the route travels in `sessionStorage` because
  the fragment is the handoff's. `prompt=consent` is passed by the dock's fallback button alone.

**The honesty boundary**
- `adapters.js` — maps kgsm-api's narrow HONEST model to view shapes. A value the
  backend doesn't provide → `null`/`"unknown"`/`[]`, **NEVER `0` or an invented
  default**. Don't hardcode game/domain data the backend can serve. This is the
  ecosystem-wide "never fabricate a metric" rule at the frontend edge.
- `merge.js` — pure per-host → aggregated roll-up; every row carries its owning
  host id; merge only unions/de-dups, never invents attribution.
- `placement.js` — which node an install should land on, **measured**: the
  blueprint's declared RAM/disk (advisory MB) against each node's live headroom
  (GiB — reconcile at ×1024). Verdicts `fits｜tight｜insufficient｜unknown｜
  offline` carry the numbers behind them. **CPU is not a dimension** (no such
  blueprint field, by design). Only a measured fit is ever recommended — an
  `unknown` node is selectable with its honesty shown, never ranked as if it fit,
  and no measurable node means no preselection at all.

**Preferences** — `stores/prefs.js` holds the account's preferences **local-first**: localStorage is
what the app reads (synchronously, on the first render — the dashboard decides what to mount from
it), and the node is where the value is kept so it outlives the browser and can follow the person.
A write lands locally and returns; the PUT is best-effort and a failure loses nothing.
⚠ **Seeding a default is a WRITE, so nothing may seed before the node has answered** — doing so
publishes a default over the stored value. `dashboardStore.hydrate` encodes the ordering, and
`boot.js` hydrates preferences only after `hostsStore.refresh` has reconciled the connection's
backend id, since the home node is addressed by that id.

**Stores** — see `stores/CLAUDE.md`. `store.js` is the tiny reactive primitive
(`createStore` + `useStore`, React 18 `useSyncExternalStore`). `stores.js`
re-exports `stores/` — import from either.

**Connection / config / multi-host**
- `config.js` — the connection model: `CONNECTIONS` (seeded from the localStorage
  host registry at module load, then **grown in place** by cluster discovery via
  `addConnections`; `subscribeConnections` notifies holders of per-connection
  resources) and the **routing rule**: `apiV1Of`/`apiOriginOf` resolve a node by
  backend id **exactly** — an id no connection holds throws in dev and returns
  null in prod, so a call fails rather than landing on another node. The one
  exemption is cold boot (a lone connection whose id isn't reconciled yet); a
  node-less call at N=1 resolves with a loud dev warning. `apiV1ForConn`/
  `streamUrlForConn` address a connection the caller already holds (the fan-out,
  the SSE registry). `originOfHost`/`hostAddressOf` are the soft **lookups** —
  an address to show or store, honestly `""` when we hold no such node.
  **`CONNECTIONS.length` is a topology check (0 → connect screen, ≥2 →
  fan-out), NOT a `LIVE`/`MOCK` mode flag — never reintroduce that duality.**
  `VITE_API_BASE` is an optional single-host *seed*.
- `connect.js` — connect/disconnect a host (mutates the registry → full page
  reload) and `mirrorRosterToRegistry`, which registers the alive+reachable peers
  a roster names (dedupes against the registry AND the live connection set, so a
  seeded node is never registered twice under a second address);
  `devSeedAutoConnect` for auth-disabled dev.

**Auth / RBAC / capabilities**
- `sessionStore.js` — per-host identity (Model A): Discord SSO anchor, each host
  mints its own access (sessionStorage) + refresh (localStorage) token, resolves
  role via that host's bot. It also holds the LIVE half of that role: the primary
  stream's `me` topic carries the node's own `{tier, status}` whenever it regrades
  this account, and `applyMePatch` writes it as given — the push is the node's
  current answer, so a demotion lands exactly like a promotion. `onTierChange`
  reports a genuine delta to the two things a re-render cannot cover on its own:
  the shell (which says so, and leaves a route the role can no longer occupy) and
  the dashboard's default arrangement.
- `authRedirect.js` — captures the OAuth fragment handoff at boot, and **says who issued
  it**. A node login and an assistant-leaf login both land on this origin with the same
  `access`/`refresh`/`error` fragment keys; the `assistant_login=<hostId>` marker that
  `assistantSession.signIn` puts in its return address is what tells them apart. It only
  classifies — `main.jsx` hands an assistant landing to `assistantSession`, so this module
  stays a leaf of the import graph and the two session layers keep their own storage.
- `authStorage.js` — the app-shell user read/write (extracted from `App.jsx`).
- `persona.js` — the authorization **policy, single source of truth**. Roles
  `admin｜operator｜viewer｜none`, resolved **per host**. `can(cap)` = aggregate
  (any host) for nav/reach; `canOn(cap, host)` = scoped for actions — **never
  substitute one for the other**. `resolveRoute()` is the routing chokepoint.
- `capabilities.js` — per-host services (metrics / assistant / watchdog), each
  `provisioned` × `status`. The assistant is per-host with no central fallback.

**Routing & presentation helpers**
- `router.js` — pure URL-hash ↔ `route` object bridge (framework-free). Full URL
  scheme documented in-file.
- `theme.js` — client-only theme preference; LIVE swap of `<html data-theme>`, no
  reload. Owns `THEME_OPTS`, the offered themes as `{ id, label, mode }` — both
  surfaces' pickers read it and `VALID` derives from it, so a theme is declared
  once. `mode` (`dark｜light`, absent on `auto`) is the palette's own character,
  **declared not derived**, and is what the swatch picker groups on. `cvd` names,
  in words, the deficiency a colour-vision palette is built for; its presence —
  not the `cvd-` id prefix — is what puts a theme in the picker's own badged
  section, so the grouping survives a rename. `tribute` does the same job for a
  palette quoting a screen from somewhere else and names what it quotes — the
  picker's Tributes section and each swatch's tooltip. A theme carries at most one
  of the two. Mirror the `index.html` / `assistant.html` boot scripts when you
  change the list.
- `formatting.js` / `labels.js` / `art.js` / `servers.js` / `leaves.js` —
  formatting, display-label vocabulary (including `ROUTE_TABS`, every tabbed
  route's sub-tabs — read by the page that draws the strip AND by the breadcrumb
  that names the tab in the URL, so the two cannot disagree), key-art helpers,
  server-shape helpers,
  and the leaf vocabulary (run-state → tone+label, iconography, kind). `leaves.js`
  lives here rather than beside any one surface because the Services board, the
  leaf page and the leaf config page all read it — and because `components/`
  may not import from a page.
- `sorting.js` — the ONE row comparator, shared by `CardTable`'s sortable columns
  and the card grids' toolbar sort. It orders the **value** a column's accessor
  returns (Date → epoch millis, number → numerically, else digit-aware string),
  and treats `null`/`""`/an unparseable date as **missing**: pinned last in BOTH
  directions, never coerced to `0`. **A sort accessor returns the raw value —
  never `x || 0`, and never the formatted text the cell renders.**
- `voicePcm.js` — a recorded voice note → the samples the speech leaf reads (16kHz mono signed
  16-bit PCM), via the decoder the browser already has for what it just recorded. **Imports
  nothing**, deliberately: both surfaces record notes and the standalone may not reach this layer's
  networked half, so a shared module that pulled in `apiClient` would fail `npm run check:assistant`.
  The rate is the leaf's contract and travels in no header — resampling to anything else transcribes
  at the wrong speed rather than failing. Falls back to arithmetic here when a browser refuses an
  `OfflineAudioContext` at 16kHz. Proven in Chromium against a live host by
  `scripts/visual-harness/voice-note.mjs`; jsdom has no Web Audio, so the smoke cannot reach it.
- `device.js` — this browser's id for the per-device half of the preference store (`krystal:device`,
  minted once, sent as `X-Krystal-Device` by every call). **A session id is not device identity**:
  sessions are per host and expire, so the same laptop signing in again would read as a new device
  and lose what was stored against it. Imports nothing, so it can never be what drags `apiClient`
  into the standalone bundle.
- `keyedResource.js` — one hydrate and one live subscription per KEY, however many components want
  it (`useKeyedResource(key, hydrate, follow)`). The counterpart to a keyed store: keying lets two
  targets exist at once, this stops N mounts of the same target hydrating N times or one unmount
  disposing what another still holds. The SSE transport already ref-counts topics, so this is about
  the REST hydrate and the store slot.
- `serverActions.js` — `runServerAction(verb, server|id)`: the optimistic patch, the rollback and
  the wording of a lifecycle verb. **Where the outcome goes is a parameter** (`opts.reporter`,
  defaulting to the toast one): one button pressed once wants a toast, twenty servers asked at once
  wants one summary. The other three obligations stay here whoever is reporting —
  `markCommandIssued(server, verb, state)` makes the patch and hands back the undo, and its `state`
  is the honesty boundary: `"running"` for a command that starts within the second, `"queued"` for a
  batch member that may sit behind seven others. Also `requestBackup(server)` (the POST alone, for a surface that
  owns its own busy state and error line — the Backups tab) and `backupServer(server)` (the POST,
  the job wait and the failure report, for one that has nowhere to render an outcome). A module rather than a shell callback because a card that can be
  PINNED has no shell above it to be handed one, and a surface offering Start has to do all three or
  it lies about what happened.
- `widgets/` — the dashboard's composability: `registry.js` (a type → component, params, capability,
  size; it holds no types itself, so `lib/` never imports a page), `layout.js` (the descriptor, the
  breakpoint ladder, and the span rule) and `dashboardStore.js` (the layout, and the only thing that
  writes it).
  **A size floor is a WIDTH (`minPx`), not a column count.** `columnsForPx` converts it against the
  grid's measured width, so one number holds at every breakpoint — a column count means half the row
  on a wide grid and the whole of it on a narrow one, which forces a card to full width exactly where
  there was room for three. `minW` remains for the few whose constraint really is a column count (a
  KPI tile); the wider of the two wins. The span then snaps to the full row only when the remainder
  is narrower than `MIN_USEFUL_COLS`, i.e. when nothing could be placed beside it anyway.
- `batchRun.js` — one verb fired at a SET of servers. A **run** is what a person starts (one verb,
  one cluster-wide set, one outcome); a **batch** is one node's share of it, and the node owns it
  from the moment it accepts. So this mints a `runId`, groups the selection by node, fires one POST
  per node and reconciles the answers — it paces nothing and retries nothing. Three properties:
  the run id is **client-minted** and stored verbatim by every node, which is what lets any client
  reassemble the run afterwards without a coordinator; a node that never answered is reported
  **undispatched, never failed** (its commands were never issued); and each node's `refused[]` is
  the authority for its own servers, so the summary reads the responses rather than the local
  prediction. `cancelRun` is the same shape in reverse — one `DELETE` per node holding a share, of
  **pending** members only — and it carries out what it could NOT stop: a kgsm invocation under way
  is not interruptible, and a node that did not answer the cancel keeps running its share.
- `hooks/useJobPhase.js` — pending work in three states: **idle · queued · running**. Derived once
  and read by every surface that draws a lifecycle button (the tile, the hero, an alert card's
  suggested action), because a fourth derivation is how one of them comes to disagree about a server
  nobody is watching. `useJobPhase` subscribes; `jobPhaseOf` is the same answer for a caller that has
  already returned early and cannot take a hook.
- `registerSW.js` — production-only PWA service-worker registration.
- `push.js` — the browser half of Web Push: capability probe, subscribe/unsubscribe, device list.
  `support()` distinguishes **`needs-install`** from `unsupported`, because on iOS push works only
  for a Home-Screen install and that is a step away rather than a dead end. Two platform rules it
  encodes: permission must come from a user gesture (a load-time prompt earns a permanent refusal
  that cannot be re-prompted), and Chrome's `userVisibleOnly` means every push shows a notification —
  push is not a quiet data channel. A subscription is per HOST (signed by that host's VAPID key), so
  every call is node-scoped. It also carries the per-account event **preferences** — note the
  default: an event with no stored row is ON, so treat a missing entry as yes, never as no.

## The init-order landmine — do not "tidy"

A few base modules **lazily** `import("...")` upper ones (e.g. `apiClient.js`
defers `stores.js`/`sessionStore.js`/`alertsApi.js`) to keep the ESM graph
**acyclic**. Converting one
of these to a static `import` can reintroduce a cycle and break boot. Read the
comment before changing an import.
