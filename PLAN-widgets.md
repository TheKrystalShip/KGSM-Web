# PLAN — the dashboard as pinned widgets

The dashboard becomes a surface the user composes: they start from a small default set (or
nothing), and every card elsewhere in the panel carries a **pin** that adds *that component* to it.
Pinned widgets are the real components — the leaf journal on the dashboard is `LeafLogs`, the same
one the leaf page renders, bound to the same node and leaf and following the same live topic.

The grid is **12-column flow**: a widget declares a column span and a row span, the grid packs them
in order, and the user reorders by dragging and resizes by pulling an edge. No free 2D placement,
no gaps to bookkeep, one stored layout that reflows honestly at every width.

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
  size: { w: 12, h: 5, minW: 6, minH: 3 },
  load: () => import("../../pages/leaf/LeafLogs.jsx").then(m => m.LeafLogs),
});
```

`load` is a lazy import — the dashboard must not pull every page's code into its chunk, and
`AppRouter` already lazy-loads pages the same way.

**The registry points at the component the page renders.** There are no widget-only forks. When a
component cannot be pinned as-is, that is a signal to fix the component — a page-owned, prop-fed,
singleton-backed card is worse on its own page too.

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

Five stores need rekeying:

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

CSS Grid, `repeat(12, 1fr)`, `grid-auto-rows: var(--widget-row)`. Each item takes
`grid-column: span w` and `grid-row: span h`. `grid-auto-flow` stays at its default — `dense`
back-fills holes by reordering, which would move a widget the user did not touch.

**Reorder** generalizes `DashLayout`'s existing model to two axes: snapshot every item's rect on
grip-down, track the pointer 1:1 on the dragged item, decide the drop index by midpoint crossing
against the snapshot centres, commit once on release. The scroll-delta folding that already keeps a
dragged band pinned to the cursor during a wheel-scroll carries over unchanged.

**Resize** is a pointer drag on the right, bottom and corner handles, snapping to whole column and
row units, previewed live through inline custom properties and committed on release. `minW`/`minH`
from the registry stop a console being squeezed to two columns.

**Responsive** collapses the column count (12 → 6 → 1) and clamps each widget to
`min(w, columns)`. **One stored layout, not one per breakpoint** — spans are relative, so this
reflows without a per-device layout matrix to keep in sync.

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
  Updated

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

**Open:** which node holds the record in a cluster. Every routed call must name a node and there is
no "home node" concept in `config.js`. The recommendation is the node serving the panel: prefs live
with the account store you signed into, and a panel served by a different node is a different
surface. Worth deciding before P5; it does not block P0–P4.

## 11. Phases

| | | Unlocks |
|---|---|---|
| **P0** | Registry, `WidgetHost`, `NavContext`. The dashboard still renders its five bands, but *through* the registry. | Nothing visible. Proves the seam with no behaviour change. |
| **P1** | `WidgetGrid` — 12-column, reorder + resize — replacing `DashBandList` on the dashboard. Layout in `localStorage`. | The existing five bands become resizable widgets at `w: 12`. |
| **P2** | Pin affordance on the five chokepoints; Add-widget catalog; register everything already fed by a global store. | KPIs, alerts, activity, servers, catalog, capacity — pinnable and composable. A real widget dashboard. |
| **P3** | `useKeyedResource`; rekey the five singleton stores. | Leaf journals, host logs, the services board, per-node cards. **The leaf-logs case.** |
| **P4** | Parameterized widgets: server console, performance charts, player roster, stat tiles, hero. | Per-server surfaces on the dashboard. |
| **P5** | The kgsm-api preference store, the sync switch, the settings card; move the layout off raw `localStorage`. | Layouts that survive a browser, and sync across devices. |
| **P6** | Empty-dashboard first run, per-persona defaults, stale-widget handling, mobile. | Somebody arriving at an empty dashboard knows what to do with it. |

P0–P2 is a working widget dashboard. P3 is what makes "pin the watchdog's journal" work.

## 12. Risks

- **A dashboard of fifteen live widgets is fifteen subscriptions.** Gate hydration on visibility
  with an `IntersectionObserver` and pause below the fold. A paused widget must **say** it is
  paused — a stale frame presented as live is a fabricated measurement.
- **Heavy surfaces stay off the grid.** The Monaco blueprint editor, the file browser and the
  settings forms carry unsaved state, focus behaviour and sizing assumptions that a tile makes
  worse. They get a **shortcut tile** — a card that names the target and opens the page.
- **Capability drift** must be non-destructive: hide, never delete (§5).
- **Doubled chrome** is the most likely visual bug — `WidgetContext` exists to prevent it, and every
  chokepoint has to honour it.
