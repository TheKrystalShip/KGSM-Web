# src/lib/stores/ — the domain-split reactive stores

One module per domain; `../stores.js` re-exports from here. **Don't grow a
monolith — a new domain gets a new module in this folder, wired into the
barrel.**

## The barrel

`index.js` re-exports every public symbol; `../stores.js` is a one-line
pass-through to it. Import from either — both resolve here.

`index.js` re-exports `startDataLayer` / `stopDataLayer` from `boot.js`. **Importing
this barrel hydrates nothing and opens no socket** — the shell calls `startDataLayer()`
once it is mounted, which is once there is somebody signed in to fetch on behalf of, and
`stopDataLayer()` when it unmounts. Keep the hydrate as its own module; don't scatter
hydrate calls into the domain stores.

`boot.js` reaches `sessionStore` through a **lazy `import()`**. A static one closes the
cycle `sessionStore` → `stores.js` → `stores/index.js` → `boot.js` and breaks boot.

## The modules (each owns one domain)

| Module | Owns |
|---|---|
| `servers.js` | game servers, jobs, command actions (`commandServer`, `awaitJob`), install/delete, settings fetch/patch, console input, game-name resolution. `jobsStore` carries each job's **origin** — the node whose socket delivered the frame, since the job DTO names none — and keeps only the last 25 **settled** jobs per node: it is fed by every connected node for the life of a tab, and a queue surface left open for a week would otherwise hold every job the cluster ever ran. Queued and running work is never dropped |
| `hosts.js` | hosts/diagnostics store + metrics & capability subscriptions (`subscribeHostMetrics`, `subscribeServerMetrics`, `syncCapabilitySubscriptions`, metrics history/events), and the library mutations (`addLibrary`/`renameLibrary`/`removeLibrary`). **There is no libraries store**: the list rides the host aggregate this one already holds, so a second cache would be a second answer to "where can this node put a server" and the two would disagree the first time a disk was unplugged. Each mutation re-reads the host, which is what moves the storage card, the install form and the node overview off one measurement |
| `audit.js` | the cluster-wide audit log, plus the node-attribution helpers every surface labels or filters rows with (`auditEventHost`, `auditInScope`, `serverHostId`). **There is no app-wide node scope** — a node is an attribute of a row, and narrowing is local to the list that offers it |
| `diagnostics.js` | host logs, log sources, services, leaf provisioning/config (`logsStore`, `servicesStore`, `applyLeafConfig`). **`leafLogsStore` is KEYED by (host, leaf)** — `byKey[leafLogsKey(h,l)]`, not one slot — because two journals can be on screen at once (two pinned to the dashboard, or one pinned while its own page is open) and a single slot had each refresh blank the other with nothing to show for it. Acquire it through `useKeyedResource` so N mounts share one hydrate and one subscription, and the last release `drop()`s the window |
| `players.js` | one server's player roster, **KEYED by (host, server)** — `byKey[playersKey(h,s)]`. Keyed for the same reason `leafLogsStore` is: the Players tab and a command palette scoped to that server are routinely mounted at once (the palette opens over the page it is scoped to), and one slot had each reader blank the other. Acquire through `useKeyedResource`; the last release `drop()`s it, because a kept roster carries live statuses and would render stale. **Tail-then-follow is a race here**: `acquire` calls hydrate and follow back to back and neither waits, so live frames arrive mid-read and are BUFFERED until the roster lands, then replayed in order behind it — without that, a join applied first is silently undone by the hydrate |
| `files.js` | per-server working-dir file tree + editor cache (self-contained; only `api.host()`, no live stream) |
| `library.js` | the installable game catalog (mostly static; hydrate from `/library`) |
| `ui.js` | favourites + the per-node link-latency probe the capacity strip, cluster constellation and diagnostics read. A favourite is the ACCOUNT's, not the browser's — it rides `prefs.js` under `servers.favorites`, because it decides what the sidebar keeps a permanent shortcut to and per-device shortcuts could not be reconciled by anybody. Entries are `{id, hostId}` like `selection.js`: a favourite the roster cannot find is either an unreachable node or a deleted server, and only the node tells those apart. Insertion order, never re-sorted — the sidebar list is a dock, and a shortcut that moves when a server changes state has stopped being one |
| `selection.js` | the set of servers one gesture is about to act on — ids plus the node each belongs to, since a selection is cluster-wide and the dispatcher groups by node. Shaped after `favoritesStore` and deliberately **not** persisted: it is a gesture, not a preference. Three rules live here — cleared when a filter moves (a selected row hidden behind a filter is invisible consent), never written to storage, and narrowed by a settled run to what still needs doing |
| `batches.js` | the batch records this browser can see, and which nodes it could ask. `refresh()` fans `GET /batches?active=true` across every connection and keeps each node's rows under that node; the accept and the `batch.patch` frames top it up. **Hydration is what makes a run visible to a client that was not open when it started**, which is the reader the runs board exists for. `nodes` holds the last fan-out's per-connection outcome, because a node that did not answer holds an UNKNOWN share rather than none — never a run drawn with fewer members. A batch held active which its node no longer lists is re-read individually and dropped only on a `404`: it settled, and how it settled is the node's to say. `runsFrom` groups by the client-minted `runId` (a batch that carries none is a run of one, keyed on itself) and sums each node's own `counts`, marking a share that reported none rather than counting it as zero. Ten settled runs are kept |
| `fleet.js` | the summary tiles' per-node reads — availability, watchdog supervision, scheduler board, systemd services, thresholds. Started by its CONSUMERS rather than by `boot.js`: it is one surface's data, and five requests per node on every login for a page nobody opened is five wasted. **`startFleetOps`/`stopFleetOps` are REFCOUNTED** — several tiles read it as separate widgets, each mounting and unmounting on its own, and an unconditional stop would let the first to leave clear the timer under the rest, which would then render a week-old figure as live. Balance every start with one stop (an effect cleanup does it). Each slice fails independently to `null`, which the tiles read as "not measured" and never as zero |
| `cluster.js` | the converged cluster roster **and** node discovery — `discover()` asks any addressable connection for the roster and registers the peers it names, `startDiscovery()` runs it at boot and on a slow cadence. It is the roster's ONE owner: pages read `clusterStore`, they don't refresh it on mount (per-node peer *actions* still re-read the node they mutated) |
| `prefs.js` | the account's preferences, local-first: `get`/`set` are synchronous against localStorage, `hydrate` adopts the node's copy, `setSync` moves the account's switch. Keys are declared in `PREF_KEYS` — the dashboard layout and the account's favourites. A default seeded before the node answers is a write that overwrites the stored value — see `lib/CLAUDE.md` |
| `boot.js` | `startDataLayer()` / `stopDataLayer()` — the hydrate, the ping loop, discovery and the SSE streams, started by the shell rather than at import |
| `index.js` | the re-export barrel + boot import |

## Conventions

- Every store is a `createStore(...)` from `../store.js`; components subscribe
  with `useStore(store, selector)`. Stores start **empty** and populate on
  `refresh()` — never seed with fabricated defaults.
- All data reaches a store through `../apiClient.js` → `../adapters.js` (the
  honesty boundary) → `../merge.js` for multi-host roll-up. A store doesn't call
  `fetch` directly. The one store on the *other* seam is `assistantReview.js`, which reads
  the assistant corpus straight from the leaf via `../assistantClient.js`.
- **Intra-folder imports are downward:** `boot`/`audit`/`ui` may import
  `servers`/`hosts`/`library`; the base domain stores don't import back up. Watch
  for cycles — mirror the existing import direction.
