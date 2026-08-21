# PLAN — the dashboard as pinned widgets

The dashboard becomes a surface the user composes: they start from a small default set (or
nothing), and every card elsewhere in the panel carries a **pin** that adds *that component* to it.
Pinned widgets are the real components — the leaf journal on the dashboard is `LeafLogs`, the same
one the leaf page renders, bound to the same node and leaf and following the same live topic.

The grid is **12-column flow**: a widget declares a column span and a row span, the grid packs them
in order, and the user reorders by dragging and resizes by pulling an edge. No free 2D placement and
no coordinates to keep consistent — one stored layout that reflows honestly at every width. Space a
widget does not fill is still addressable: a row's spare tail is a drop target, and `layout.spacer`
holds room open on purpose.

Layout persists **server-side per device**, with an account-level **Sync** switch: off, every device
keeps its own; turning it on makes the device that turned it on authoritative and overwrites the
rest.

---

## 1. Where the dashboard is now

`DashboardPage.jsx` builds five bands as inline JSX — summary (twelve KPIs), the capacity strip,
the alerts + activity feed, the catalog rail, the servers rail. `DashLayout.jsx` reorders them
vertically with pointer math and persists an **id list** in `localStorage["krystal:dash:order"]`.
`ServerDetailPage`'s overview reuses the same mechanism under its own key.

The bands are anonymous. A saved layout can only ever be a list of ids because there is nothing to
reconstruct a band from — no type, no parameters, no size.

## 2. What has to change, and what already fits

Four things stand between the current page and a widget surface.

**Bands are not addressable.** Needs a registry mapping a stable `type` to a component, its
parameter shape, the capability it requires, and its default size.

**Navigation is prop-drilled.** `AppRouter` hands `DashboardPage` fourteen callbacks and
`ServerDetailPage` eight. A widget pinned from a leaf page has no parent to hand it `onOpenServer`.
`AssistantDockContext` is the precedent: dock state moved to context for exactly this reason.

**Five stores hold one target at a time.** This is the real blocker and it bites the leaf-journal
case directly. `leafLogsStore` is `{ list, hostId, leaf }` — **one leaf's journal, globally**. Pin
the watchdog's journal beside the reactor's and they blank each other; open the leaf page while a
widget is pinned and they fight over the one slot. `logsStore`, `logSourcesStore` and
`servicesStore` have the same shape scoped to one host.

**There is no grid and no dependency to lean on.** `package.json` is React, lucide and monaco.
The grid gets hand-rolled, consistent with `DashLayout` already being hand-rolled.

Against that, four things already fit:

- **`BriefCard` is one shared card shell with 65 render sites.** The other chokepoints are
  `CardTable` (16), `Kpi` (13), `ConsoleView` (4) and `Rail` (2) — about a hundred card-shaped
  surfaces reachable through five components.
- **Global stores are already multi-reader.** `serversStore`, `hostsStore`, `auditStore`,
  `libraryStore` and `alertsStore` are hydrated once by the data layer; a widget reading one costs
  nothing.
- **The SSE transport ref-counts dynamic topics.** `api.stream.subscribe` opens one stream per
  topic no matter how many listeners want it, so N widgets on `hosts/<id>/logs` cost one stream.
- **Two instance-safe data patterns exist.** `useLeafResource` and `usePlayerRoster` are per-mount:
  each instance owns its fetch and its subscription. `filesStore.byServer`,
  `blueprintFileStore.byKey`, `pingStore.byHost` and `fleetOpsStore.byHost` are keyed stores. The
  refactor in §6 is migrating the remaining five stores onto patterns the repo already runs.

## 3. The widget descriptor

A layout is an ordered array of these. Order is position — the grid packs in array order.

```js
{
  i: "w_3f2a91",                                  // instance id, minted at pin time
  type: "leaf.logs",                              // registry key
  params: { hostId: "hotrod", leaf: "watchdog" }, // what it is bound to
  w: 12, h: 5,                                    // column span (1..12), row span
  title: null                                     // user override, null = the registry's
}
```

`i` is the React key. Keying by array index reuses component state across a reorder — a console
would inherit the neighbour it swapped with.

## 4. The registry — `src/lib/widgets/registry.js`

```js
registerWidget({
  type:  "leaf.logs",
  label: "Leaf journal",
  icon:  "scroll-text",
  cap:   "host.manage",                    // persona capability, checked at render
  params: ["hostId", "leaf"],              // what must be bound
  describe: (p) => leafLabel(p.leaf) + " · journal",
  size: { w: 12, h: 5, minPx: 380, minH: 3 },
  load: () => import("../../pages/leaf/LeafLogs.jsx").then(m => m.LeafLogs),
});
```

`load` is a lazy import — the dashboard must not pull every page's code into its chunk, and
`AppRouter` already lazy-loads pages the same way.

**The registry points at the component the page renders.** There are no widget-only forks. When a
component cannot be pinned as-is, that is a signal to fix the component — a page-owned, prop-fed,
singleton-backed card is worse on its own page too.

### Granularity: a tile is a widget

Each of the twelve summary tiles is its own type, placeable alone. Anything coarser makes "the four
numbers I care about" unbuildable and means the add-widget catalog can never offer a single figure.

The cost is extracting twelve derivations out of `DashboardPage`, which is mechanical — they are
already twelve separately commented `const` blocks over shared stores — and it retires a 555-line
page in the process. Each tile recomputing from the same store is cheap: the data is already
loaded, and the derivation is a reduce over an array in memory.

### Surface scope: the home dashboard

`ServerDetailPage`'s overview keeps its existing band reorder under its own key. Generalizing the
grid to it, and to the node overview, is additive — the registry is already generic — but it needs
a second idea first: params injected from **surface context**, so a `scope: "server"` widget binds
to whichever server the page is about rather than to one named in the descriptor. That is worth
doing deliberately, not as a side effect of the first surface.

## 5. `WidgetHost` — the wrapper

One per widget, supplying everything the component should not have to own:

- **Capability gate.** `can(cap)` / `canOn(cap, hostId)` at render. A widget the current role may
  not see does not render and does not leak its title — but **stays in the stored layout**, so a
  re-promotion restores it rather than silently discarding what the user arranged.
- **Parameter validity.** A widget bound to a deleted server, a forgotten host or a leaf the node
  no longer serves renders an honest "this no longer exists" tile with a remove button. It never
  vanishes silently and never takes the dashboard down.
- **`ErrorBoundary`** keyed on the instance id, so one broken widget is one broken tile.
- **`Suspense`** for the lazy component.
- **Chrome** — title, unpin, "open the full page", and the resize handles.
- **`WidgetContext`**, which tells the component it is rendering as a widget. A `BriefCard` inside a
  `WidgetHost` that also draws a header would show two; the flag lets the card suppress its own.

The component inside receives its `params` and nothing else. Sizing is applied from outside.

## 6. Instance-safe data — the core refactor

**A widget's data is keyed by its parameters.** Every widget-eligible component lands in one of
three shapes, all of which the repo already runs:

| Shape | Examples today | When |
|---|---|---|
| Global singleton store | `serversStore`, `hostsStore`, `auditStore`, `libraryStore`, `alertsStore` | Fleet-wide data. Already correct. |
| Keyed store | `filesStore.byServer`, `blueprintFileStore.byKey`, `pingStore.byHost` | Target-scoped data shared by several readers. |
| Per-mount hook | `useLeafResource`, `usePlayerRoster` | A fetch cheap enough to own per instance. |

### A loop is refcounted, never started and stopped by a mount

`stores/fleet.js` exposes `startFleetOps()` / `stopFleetOps()`, and `DashboardPage` is its only
caller: start on mount, stop on unmount. `stopFleetOps` clears the timer **unconditionally**.

That is safe for exactly one consumer and breaks the moment there are twelve. Five of the summary
tiles — uptime, drift, oldest backup, schedule failures, services — read `fleetOpsStore`, so as
separate widgets each would start the loop on mount and stop it on unmount, and **the first one
unpinned freezes the other four on their last value**. No error, no empty state: four tiles keep
rendering a week-old availability figure as though it were live, which is the fabricated
measurement the ecosystem forbids.

So: **every shared loop is refcounted** — it runs while at least one consumer wants it and stops
when the last leaves. The alternative the repo already uses is to hoist the loop into `boot.js`, as
`startPingLoop` is, whose own comment gives the reason: *"a consumer mounting does not start it,
because several of them can be open at once and the loop is one per app."* Refcounting is the
better answer for fleet ops specifically, because it is five requests per node per minute and
should not run when nobody is looking at it — and it composes with the visibility gating in §12,
where a widget scrolled off-screen releases its count.

`startDiscovery` and `startPingLoop` are already boot-owned and need nothing. `ConsolePanel` is
already instance-safe: per-mount effects keyed on the server, its own subscribe and dispose.

### Rekeying

Five stores need it:

| Store | Holds today | Target |
|---|---|---|
| `leafLogsStore` | one `(hostId, leaf)` | `byKey["<hostId>/<leaf>"]` |
| `logsStore` | one `hostId` | `byHost` |
| `logSourcesStore` | one `hostId` | `byHost` |
| `servicesStore` | one `hostId` | `byHost` |
| `clusterStore` | cluster-wide | unchanged — it is genuinely global |

Rekeying alone leaves every reader responsible for hydrate-and-dispose, which N mounts would
duplicate. One helper, written once:

```js
// Hydrates on the first mount for a key, follows live, disposes when the last one leaves.
const { data, status, error } = useKeyedResource(leafLogsStore, key, {
  hydrate: () => leafLogsStore.refresh(hostId, leaf),
  follow:  () => subscribeLeafLogs(hostId, leaf),
});
```

This is the one genuinely new piece of data-layer machinery, and it pays for itself outside the
dashboard: the leaf page and a pinned journal for the same leaf then share one hydrate and one
subscription instead of racing over a single store slot.

## 7. Navigation context

`NavContext` provides `useNav()` → `{ open(route), openServer(id), openLeaf(hostId, leaf, tab), … }`,
backed by the shell's `setRoute`.

Migration is incremental, not a rewrite. `AppRouter` keeps its explicit prop wiring; a
widget-eligible component takes the context as a fallback:

```js
const nav = useNav();
const open = onOpenServer || nav.openServer;
```

The component then works unchanged on its page and works pinned. Props get dropped from a call site
once every consumer is on the context.

## 8. The grid — `WidgetGrid`

CSS Grid, `repeat(12, 1fr)`, `grid-auto-rows: minmax(var(--widget-row), auto)`. Each item takes
`grid-column: span w` and `grid-row: span h`. `grid-auto-flow` stays at its default — `dense`
back-fills holes by reordering, which would move a widget the user did not touch. Filling a hole is
something a person does, not something the grid does behind them.

**Reorder** generalizes `DashLayout`'s existing model to two axes: snapshot every item's rect on
grip-down, track the pointer 1:1 on the dragged item, decide the drop target by nearest snapshot
centre, commit once on release. The scroll-delta folding that already keeps a dragged band pinned to
the cursor during a wheel-scroll carries over unchanged.

**A row's spare tail is a drop target of its own.** Order is position, so a hole appears wherever the
next widget is too wide for what is left of a row — and that hole is somewhere a person can aim.
`measureRows` finds each tail and offers it alongside the cells whenever the dragged widget fits,
drawing the space it would land in; its insert index is the first cell of the next row. Cells alone
made a widget dropped onto obvious empty space take the nearest card's place instead.

**Resize** is a pointer drag on the right, bottom and corner handles, snapping to whole column and
row units, previewed live through inline custom properties and committed on release. The registry's
floor stops a console being squeezed until its toolbar overflows.

**Empty space is itself a widget.** `layout.spacer` occupies room so the flow leaves it alone, which
is the only way to state a hole in a model where a hole is otherwise a side effect. It is the one
`repeatable` type and each copy carries its own `slot`, so N of them are N distinct targets.

### Reflow

**One stored layout, not one per breakpoint.** The column count drops at the breakpoints the panel
already uses, and each widget's span is resolved against it by a clamp, the widget's own floor, and
one snap:

```js
out = clamp(w, 1, cols);
out = Math.max(out, floor);                              // spanFloor: minPx → columns, or minW
if (out < cols && cols - out < MIN_USEFUL_COLS) out = cols;   // a remainder nothing fits takes the row
```

**A floor is a WIDTH, not a column count.** A console needs about 380px before its toolbar overflows;
how many columns that buys depends entirely on the breakpoint, so `minPx` is converted against the
grid's measured width by `columnsForPx`. A column floor means two different things at the two ends of
the ladder — six columns is half a wide grid and the whole of a narrow one — which forced a card to
the full row at every step below the widest.

| | ≥1281 | ≤1280 | ≤1024 | ≤768 |
|---|---|---|---|---|
| **columns** | 12 | 8 | 6 | 4 |
| KPI tile `w:2` | 6 across | 4 across | 3 across | 2 across |
| half card `w:6` | half | full | full | full |
| third card `w:4` | third | half | full | full |
| rail `w:12` | full | full | full | full |

The KPI row is the constraint that fixes the ladder. `.dash-summary` today collapses **6 → 4 → 3 →
2 tiles**, hand-tuned so twelve divides evenly at every step and the numbers never get squeezed. A
12 → 6 → 1 collapse cannot reproduce that; 12 → 8 → 6 → 4 columns against `w: 2` reproduces it
exactly.

The snap rule keeps a widget from leaving a remainder too narrow to hold anything: a single spare
column beside a wide card is dead space no arrangement can use. A remainder that CAN hold something
is left alone, because a gap is a drop target — the space is offered rather than abolished.

### Touch

Horizontal gestures are already contested: edge-swipe opens the nav drawer and the assistant dock,
and rails claim their own sideways scroll by marking themselves `[data-hswipe]`, which
`useMobileSwipe` checks before tracking. The grid does not add a fourth claimant, because at four
columns and below **horizontal resize is meaningless** — phone layout is a single column of
full-width widgets, which is the vertical reorder that already works today. The grid's drag handles
carry `data-hswipe` for the same reason the rails do.

## 9. The pin affordance

Add an optional `pin={{ type, params }}` to the five chokepoints — `BriefCard`, `CardTable`, `Kpi`,
`ConsoleView`, `Rail`. When set, and the user holds the capability, the header grows a pin button in
the same treatment as the existing `dash-section__more`. It renders filled when the descriptor is
already in the layout, so the same control unpins. It is suppressed under `WidgetContext`, so a
pinned card does not offer to pin itself again.

Five component edits cover roughly a hundred surfaces; each call site adds one prop.

**Plus an Add-widget catalog**, opened from the dashboard's Customize mode: browse the registry
filtered by capability, with pickers for the parameters a scoped type needs. Pinning-by-navigation
alone is a discovery gap for somebody starting from an empty dashboard — they would have to already
know where a thing lives to put it in front of themselves.

## 10. Persistence — per device, with sync

`MeController` already names this gap: *"the editable Profile half needs a per-panel preference
store that is deliberately not built."* Build it generally, with the dashboard layout as the first
tenant and the theme as the named second, rather than a dashboard-shaped endpoint.

**Device identity is client-minted.** Sessions are per-host and expire, so a session id is not a
device — a device that signs in again would be a new one. The SPA mints `dev_<uuid>` once into
`localStorage["krystal:device"]` and sends it as a header.

### kgsm-api

```
UserPreferenceEntity        PK (UserId, DeviceId, Key)
  UserId       discord:<id>
  DeviceId     dev_<uuid>, or "" for the synced record
  Key          "dashboard.layout"  (later "ui.theme", "ui.density")
  Value        json text
  Version      monotonic per (UserId, Key) — the cluster's merge key
  OriginDevice the device that wrote this version — the tiebreak at equal Version
  Updated      display only, never a merge input

UserSyncEntity              PK (UserId)
  Enabled
  SourceDevice   the device that switched it on
  Updated
```

- `GET /me/preferences` — the effective set for the calling device: the synced record when sync is
  on, this device's own rows when it is off.
- `PUT /me/preferences/{key}` — writes this device's row, or the synced record when sync is on.
- `GET /me/preferences/sync`, `PUT /me/preferences/sync` — the switch. **Enabling stamps the calling
  device as the source and overwrites every other device's rows from it**, then subsequent writes go
  to the synced record. Disabling seeds each device from the synced record so nobody lands on an
  empty dashboard.

### kgsm-web

`prefsStore` writes **local-first**: apply to `localStorage` immediately, PUT in the background,
reconcile on the response. The dashboard must stay usable while the API is slow, and the SPA already
has an OFFLINE mode where there is no API at all. `localStorage` stays the cache and the offline
fallback; the server holds the durable record.

The existing `krystal:dash:order` seeds the first layout — each band id maps to its widget type at
`w: 12` — so an existing arrangement survives the switch.

### What is a preference, and what is only local

Thirty `krystal:*` keys exist. Most are not preferences and must never reach the store.

| | Keys | |
|---|---|---|
| **Account** | `theme`, `favorites`, `dash:order` → `dashboard.layout`, `server:overview:order`, `chat:think`, `chat:actions` | Sync candidates. Follow the person. |
| **Device** | `sidebar:collapsed`, `dock:open`, `dock:width`, `dock:pin`, `files:tree`, `console:history:*`, `node:last` | Window furniture and local recall — a function of the screen in front of you, never synced even when sync is on. |
| **Neither** | `auth*`, `oauth:*`, `*session*`, `hostrefresh:*`, `assistant:*`, `hosts:registry`, `notifications` | Credentials, connection registry, tray history. Not preferences at all. |

`hosts:registry` is worth naming explicitly: it is the set of nodes this browser connects to, and
syncing it would push one machine's cluster view onto every other device the account touches.

### ⚠ Theme sync cannot live in `theme.js`

`scripts/check-assistant-bundle.mjs` walks the standalone assistant's import graph and **fails the
build** when `lib/apiClient.js` is reachable from it. `src/assistant/main.jsx` imports
`../lib/theme.js` directly. Any network call added to `theme.js` therefore breaks the assistant
build — which is the check doing its job, since the standalone chat has no cluster and should not
ship the panel's data layer.

`theme.js` stays pure. A **panel-only** module syncs it, reading and writing the same
`krystal:theme` key from outside. The assistant surface simply never syncs, which is correct: it is
a different origin with its own session.

There is a second reason the local key stays authoritative. The theme is resolved and written to
`<html data-theme>` **before first paint**, by a boot script in `index.html`, so there is no flash.
A value that has to be fetched cannot participate in that. The server record reconciles *after*
boot and seeds the next load — so a theme changed on another device arrives one refresh later, and
that is the honest ceiling on it.

### In a cluster

A client reaches a cluster by knowing one node, and that entry node is where its preference writes
land. The entry node is a **route, not an authority**: "home" is per-device (one browser entered via
hotrod, another via node-b, both are somebody's home), so there is no single node to appoint, and
appointing one would make a layout change fail whenever a machine the user is not talking to is
down.

Rows converge by **last-write-wins on a monotonic version**, not on a clock. Each write increments
`Version` for its `(UserId, Key)`; a node compares versions and breaks a tie on the originating
device id, lexically, so every node reaches the same answer. Wall-clock LWW would hand permanent
victory to whichever node's clock runs fastest — a user on the losing device watches their layout
revert with no error anywhere. `Updated` stays for display, where it is worth having: the Settings
sync card can say which device last changed a preference and when.

Propagation rides the cluster bus, which already carries `session.revoke` from `SessionController`:
a `preferences.upsert` message type and one handler beside `SessionRevokeHandler`. The bus's
at-least-once delivery with inbox dedupe is the right guarantee, because version-LWW is idempotent —
a redelivered message carrying a stale version is a no-op.

**Sequencing:** the cluster half does not block the rest. P5 ships preferences on the node serving
the panel — the single-node case, which is the common one — and P5b adds the bus message and the
handler. **`Version` ships in the schema from the start regardless**: retrofitting a
conflict-resolution field onto rows that already exist means inventing a version for every one of
them.

## 11. Phases

| | | Unlocks |
|---|---|---|
| **P0** ✅ | Registry, `WidgetHost`, `NavContext`, `lib/serverActions.js`. | Done. A card can be reconstructed from a descriptor, navigate without a parent, and run a lifecycle verb. |
| **P1** ✅ | `WidgetGrid` — 12-column, reorder + resize. Layout in `localStorage` via `dashboardStore`. | Done. Drag to reorder, pull an edge to resize, both persisted. Proven in a browser by `scripts/visual-harness/dash-widgets.mjs`. |
| **P2** ✅ | Catalog, the `pin` slot on all five shells, the twelve tile types, and bound widgets for a leaf journal, a server console, a node journal and a node services board. | Done. A dashboard can carry exactly the figures somebody wants, and four kinds of card pin from the page they live on. |
| **P3** ✅ | `useKeyedResource`; `leafLogsStore` keyed by (host, leaf); `logsStore`, `logSourcesStore` and `servicesStore` keyed by host. | Done. Two journals coexist, proven in a browser by `dash-pinning.mjs`, which also enforces that a card is identical pinned and on its page. |
| **P4** ✅ | `server.card`, `server.players`, `server.performance`, `server.console`. Stat tiles dropped — they overlapped the card and had no header to carry a pin. | Done. Proven in a browser by `dash-server-widgets.mjs`, which also covers a widget whose target has been deleted. |
| **P5** \u2705 | The kgsm-api preference store (`kgsm-api` `408a554`), `lib/device.js`, `stores/prefs.js`, `config.homeConn`, the Devices sync card, and the layout moved onto the preference. | Done. A layout survives the browser and follows the account when sync is on. Proven end to end by `scripts/visual-harness/prefs-sync.mjs`. |
| **P6** \u2705 | Seeded defaults, stale-widget handling, the phone layout, and `FirstRunWelcome` as a five-card tour of the mechanics. | Done. A new account lands on a dashboard worth looking at and is shown, once, that it can change it. |

### The default layout is a client-side constant

A new account gets a **seeded layout chosen by persona** — admin, operator and viewer each start
from a sensible set rather than a blank grid, and a viewer is never seeded widgets their capability
would immediately hide.

It must be a plain client-side constant, not a server seed, because of a constraint from an
unexpected direction: **`scripts/smoke-live.mjs` runs unauthenticated** against an auth-disabled
backend and asserts the dashboard renders real data. A layout that can only come from
`GET /me/preferences` would leave the smoke with no dashboard to assert against. One constant
serves both: the no-session default and the new-account seed.

`FirstRunWelcome.jsx` is that onboarding: a five-card tour of the mechanics, mounted by the shell
inside the app frame so it is past every gate and can only meet somebody who can already reach the
dashboard. Seen-state is a versioned localStorage key that every way out records.

P0–P2 is a working widget dashboard. P3 is what makes "pin the watchdog's journal" work.

## 12. Risks

- **A dashboard of fifteen live widgets is not fifteen round trips, and must not become them.** The
  widgets fed by a global store add nothing — `startDataLayer` already hydrates those, and they are
  most of a default dashboard. A keyed widget costs one hydrate **per distinct key**, not per
  widget, and the SSE transport ref-counts dynamic topics, so fifteen widgets on
  `hosts/<id>/logs` share one stream. What is left is a handful of REST calls at load.

  This is why there is **no per-user aggregating endpoint**. One would make the API's response shape
  depend on client layout state — a new widget type is zero backend work today, and that is the
  property most worth keeping. It also collapses fifteen independent failures into one response that
  has to decide what to do when three of them fail, in place of the honest per-widget empty states
  that already exist. If load ever becomes a *measured* problem, the answer is a generic
  `POST /batch { requests: [{ method, path }] }` — layout-agnostic, knowing nothing about widgets —
  and not before there is a number.

  The cost that is real is **liveness**: widgets below the fold hydrating and following at once.
  Gate on visibility with an `IntersectionObserver` and pause off-screen. A paused widget must
  **say** it is paused — a stale frame presented as live is a fabricated measurement.
- **Heavy surfaces stay off the grid.** The Monaco blueprint editor, the file browser and the
  settings forms carry unsaved state, focus behaviour and sizing assumptions that a tile makes
  worse. They get a **shortcut tile** — a card that names the target and opens the page.
- **Capability drift** must be non-destructive: hide, never delete (§5).
- **Doubled chrome** is the most likely visual bug — `WidgetContext` exists to prevent it, and every
  chokepoint has to honour it.
