# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Command palette — actions

- **Back up now**, on a scoped server. Arms like anything else that changes the host.
- **Pin and unpin widgets**, fleet-wide and per server; the row flips between the two. Pinning leaves
  the palette open, because you pin several things in a row.
- **Install a server** opens the install form already pointed at the blueprint. It launches the real
  surface rather than trying to be it — installing needs a node, a name and a port.
- **The assistant** is reachable by name.
- **A query that matches nothing offers to ask the assistant, as a row** — selected and confirmed
  like any other, never a silent fall-through. It fills the composer and focuses it rather than
  sending, so the last word is still a person pressing Enter on their own text. Shown only when
  there is nothing else, and only where an assistant can actually be reached.
- `requestBackup` / `backupServer` in `lib/serverActions.js`; the Backups tab now shares the former
  instead of holding its own copy of the URL.

### Command palette

- **⌘K / Ctrl-K opens a search over everything the panel can reach** — routes, every server and its
  tabs, lifecycle verbs, leaves, the blueprint catalog, settings sections and all 49 themes. About
  200 entries, all from stores the SPA already holds; nothing here fetches and no backend work was
  needed.
- Matching is **subsequence, not substring**, so `mcsrv` finds `minecraft_survival`. Ranking favours
  earlier matches, word boundaries and contiguous runs, and groups appear where their best member
  landed rather than in a fixed order.
- **`→` scopes into a server** — its tabs and verbs and nothing else — and `⌫` leaves. Both keys keep
  their ordinary job until it would do nothing, so `→` still moves the caret while there is text to
  move through.
- A verb the server refuses renders **disabled with its reason**, the same `verbGuard` contract the
  cards follow. A destructive verb **always arms**, whether or not anyone is connected.
- **A theme previews live and stores nothing** while arrowing; `↵` commits, `Esc` puts it back.
- A query that matches nothing says so and offers nothing else.
- Permission is applied when entries are built, so an entry a role may not act on never exists.

### Fixed

- Eight undefined CSS custom-property references (`--border-1`, `--fs-xs`, `--fg-muted`) that shipped
  with the composable dashboard. An undefined property is invalid at computed-value time, so those
  borders were falling back to `currentColor` and the widget count badge to its inherited size.
  `npm run check:tokens` is green again.

### Dashboard layout

- A row's spare tail is a **drop target**. Dragging a widget over empty space lands it there, with the
  space outlined under the cursor, instead of taking the nearest card's place. `WidgetGrid` measures
  each row's tail and offers it alongside the cells whenever the dragged widget fits; the tail's
  insert index is the first cell of the next row.
- A widget's size floor is a **width** (`minPx`), converted to columns against the grid's measured
  width. One number holds at every breakpoint, where a column count meant half the row on a wide grid
  and the whole of it on a narrow one. The content-heavy cards declare 380px — the width below which
  the console toolbar, the services grid and a game card's title overflow — so three of them sit
  across a wide row.
- The span snaps to the full row only when the remainder is narrower than a KPI tile, i.e. when
  nothing could be placed beside it.
### Fixed — resizing and dragging

- A resize **commits the span it previewed**. The preview writes straight to the DOM, which React
  does not know about; a gesture ending on the span it started from produced an identical render, so
  React wrote nothing and the cleared inline style stood — leaving the cell with `grid-column: auto`,
  which is one column. The gesture now hands the element back in the state React believes it to be in.
- A dragged span is stored **in columns, as dragged**. It was rescaled to twelfths while the render
  clamps rather than scales — two different functions, so the round trip lost the gesture: at 8
  columns a drag to 4 stored 6 and rendered back at 6, and the resize did nothing.
- A widget being dragged **stays under the cursor while the page scrolls**. The geometry is
  snapshotted in viewport coordinates and the scrolling surface is `.app__main`, not the window, so a
  wheel scroll — which emits no pointermove — left the widget pinned where the screen was when the
  gesture began. The scroll delta is folded into both the transform and the hit-test, and the
  scroller's own `scroll` event re-runs the gesture.

### Added

- **`layout.spacer`** holds room open on purpose — the one way to state a gap in a flow that would
  otherwise close it. It is `repeatable`, and each copy carries its own `slot` so N spacers are N
  distinct targets rather than one widget added N times.

## [1.142.0] - 2026-08-21

### Added — the dashboard layout is stored on the node

Preferences are **local-first**: localStorage is what the app reads, synchronously, because the
dashboard decides what to mount from the layout on its very first render. The node is where the
value is kept, so it outlives the browser and can follow the person to their other devices. A write
lands locally and returns; the PUT that follows is best-effort and a failure loses nothing.

Device identity is client-minted (`krystal:device`) and carried in `X-Krystal-Device` on every call.
A session id would have been the obvious choice and is wrong: sessions are per host and expire, so
the same laptop signing in again would read as a new device and lose its layout.

The node that holds an account's preferences is the one **serving the panel** — `config.homeConn`,
resolved from the document's origin, falling back to the first connection in development and behind
a proxy. It is a route, not an authority: rows converge on their own version, not on which node
wrote them.

### Added — a sync switch, on Settings → Devices

Off, each browser keeps its own arrangement. On, every device shares one — and the card says
**before** the switch is thrown that enabling makes this browser's arrangement the one every device
uses, replacing the others. That is not something a person can consent to from the word "sync".

### Fixed — a cold load could publish the default layout over the stored one

Seeding a default is a write, and a write goes to the node. The dashboard seeded before the node had
answered, so a browser with no local copy pushed the default up and the real arrangement was gone.
Nothing seeds while the answer is outstanding now: a local copy renders immediately and writes
nothing, and an absent one waits for the node rather than guessing.

Preferences also hydrate only after the host roster has reconciled the connection's backend id. The
home node is addressed by that id, so hydrating in parallel found no node and concluded the account
had nothing stored — which is what triggered the seed.

## [1.141.0] - 2026-08-21

### Added — a one-time tour of the composable dashboard

The dashboard is built from widgets and nothing on screen says so: somebody who never presses
Customize sees a page that looks like a page. Five cards — your dashboard is yours, add what you
want, move it anywhere, size it how you like, pin from anywhere — each one line of text over a small
animation of the gesture it describes. The animations are built from divs, so there is nothing to
ship, nothing to 404, and they re-theme with the rest of the app.

**Where it is mounted is the feature.** It renders inside the app frame, past every gate — the
sign-in screen, the pending-approval wait, the add-a-host screen, the cold-start failure and the
boot landing all return earlier — so it only meets somebody who is signed in, approved and one
render away from the dashboard. Never mid-login.

Seen-state is `krystal:welcome:v1`, a new key, so every existing session sees it once on its next
visit. **Every way out records it** — Get started, Skip, the close button, Escape — because
re-showing a modal somebody has closed teaches them to close it faster rather than to read it.
Clearing site data brings it back. The key is versioned, so bumping it re-shows the tour after the
mechanics change.

Arrow keys walk it, the dots jump, it fits a 390px phone, and every animation stops under
`prefers-reduced-motion` holding its end state, so each diagram still reads as a picture of the
finished gesture.

## [1.140.0] - 2026-08-21

### Added — a server's card, players, performance and console are pinnable

Four surfaces from the server-detail page, bound to the server they were pinned from: `server.card`
(pinned from the hero — a banner that size belongs at the top of a page, and `ServerTile` is the
component built for a grid), `server.players`, `server.performance` and `server.console`. All four
were already instance-safe, so they are wrappers that resolve an id against the live roster and
nothing else.

### Fixed — a widget bound to something deleted says so, and can be removed

The existence check is the host's, not the component's: a card renders the same wherever it is
mounted and cannot offer to remove itself from a dashboard. It reports "gone" in its own words; the
affordance to act on it lives on the widget.

Checked **before** permission, which is what made the node case work at all — `canOn(cap, node)` is
false for a node the panel no longer holds, so asking permission first hid the widget with no
explanation and no way to remove it. There is nothing to protect: the id is one the person put in
their own layout.

`WidgetHost` also subscribes to the roster now rather than reading it once, so the capability gate
and the existence check settle when the data lands instead of keeping whatever they decided first.

### Fixed — a widget returning several roots no longer stretches its control rows

`.widget__body > *` gave every root `flex: 1`, so a component returning a fragment — the Performance
tab is a range selector above a chart grid — had the cell split evenly between them, inflating a
36px control row to a third of the widget. Only the last child takes the slack.

## [1.139.0] - 2026-08-21

### Added — the twelve glance figures are twelve widgets

Each summary tile is placeable alone, so a dashboard can carry exactly the numbers somebody cares
about and the Add-widget catalog can offer a single figure. At `w: 2` they read 6, 4, 3 and 2 across
the breakpoint ladder — the band's original shape, now as twelve things that move and resize
independently.

The figures stay derived in one place (`fleetKpis.js`), so twelve tiles cannot drift into twelve
definitions of "running". The five that need a per-node fetch share one refcounted loop rather than
running twelve.

`fleet.summary` stays registered, because a shipped type is immutable and a layout may hold one, but
it leaves the catalog: a stored one is expanded in place into the twelve on load, keeping the
arrangement around it and skipping any tile already placed by hand.

### Added — a node's journal and services board are pinnable

`host.logs` and `host.services`, bound to the node they were pinned from. Both are the same
components the node page renders and both read stores keyed by host, so a board on the dashboard and
the tab it came from share one hydrate and one subscription.

### Fixed — the arrange strip no longer names every widget twice

It carried a title above a card that already has its own header — twelve doubled labels once the
tiles were split. It is controls only now: a grip at one end, remove at the other. The card cannot be
asked to drop its header, because it renders the same wherever it is mounted, so the host is what had
to give.

## [1.138.0] - 2026-08-21

### Changed — the last three host-scoped stores are keyed

`logsStore`, `logSourcesStore` and `servicesStore` each held one host at a time. They are `byHost`
now, with per-key generation counters, `drop()` on the last release, and their consumers acquiring
through `useKeyedResource` — so a node's Logs tab, its Services board and anything pinned for the
same node share one hydrate and one subscription rather than overwriting each other.

Reconnect re-hydrates **every** key somebody is holding. Refreshing only one would leave the rest
rendering whatever they had before the stream dropped, with nothing to say they had stopped
following.

### Canon — a component does not branch on where it is mounted

A card renders and behaves identically on its own page and pinned to the dashboard; a Minecraft
console is the same console in both. Data is a function of its PARAMS — which server, which leaf —
and never of its placement, which is what the keyed stores are for.

Both dashboard rails violated it: one hid its empty-state header as a widget, both passed `disabled`
while the grid was being arranged. Neither needed to — the grid already blocks pointer events into a
widget's body while editing — so they no longer read `WidgetContext` at all. Its one legitimate
reader is `PinButton`, which suppresses itself inside a widget because a pinned card offering to pin
itself is a dead control; that is the pin, not the card.

`dash-pinning.mjs` now enforces it, reading a journal's title and window in the widget and again on
its own page and requiring them to agree.

## [1.137.0] - 2026-08-21

### Added — pin a card to your dashboard from the page it lives on

`BriefCard`, `CardTable`, `KPI`, `ConsoleView` and `Rail` take an optional `pin` slot in their
header — about a hundred card surfaces between the five of them. The panel passes `<PinButton/>`,
which is a toggle: filled means this exact `(type, params)` is on the dashboard, and pressing it
takes it off. It self-suppresses inside a widget, so a pinned card never offers to pin itself.

The binding comes from where you are standing. Pinning the watchdog's journal pins THAT journal —
`{ hostId, leafId }` frozen into the descriptor — which is why bound widgets are pinned from their
own page and never offered by the Add-widget catalog: nothing in a list can know which leaf you
meant. Live so far: a leaf's journal and a server's console.

The `pin` is taken as a NODE rather than a descriptor, deliberately. `BriefCard` is in the
standalone assistant's bundle and `PinButton` reaches `persona` through the dashboard store, so a
`pin={{type, params}}` prop would force `BriefCard` to import it and fail `check:assistant`.

### Changed — `leafLogsStore` is keyed by (host, leaf)

It held one journal globally, which works while exactly one surface reads it and breaks the moment a
card can be pinned: two journals side by side, or one pinned while its own page is open, had each
`refresh` blank the other — silently, each console showing the wrong service's lines or none.

It is `byKey[…]` now, with `lib/keyedResource.js` sharing one hydrate and one live subscription per
key however many components hold it, and freeing the window on the last release. The transport
underneath already ref-counted topics, so N journals on one node still cost one stream.

### Fixed — the widget catalog is registered by the shell, not the dashboard

It was imported by `DashboardPage`, which is lazy — so the registry was empty on every other page
and every pin drew nothing until the dashboard had been opened once. `App.jsx` imports it eagerly;
each entry's component is still a dynamic import, so this costs the metadata and not the code.

### Fixed — a quiet journal can be pinned

The pin only existed on the branch that had lines, so the journals you would most want to watch were
the ones you could not pin. It is on the loading, quiet and error states too — dropped only for a
leaf the host publishes no source for, where the widget could never say anything.

## [1.136.0] - 2026-08-21

### Added — the dashboard is a surface you compose

The dashboard is a 12-column grid of WIDGETS. Each one is the same component its own page renders,
reconstructed from a saved descriptor `{ type, params, w, h }` — not a dashboard-only copy of it. In
Customize mode a widget is dragged by its grip to reorder and pulled by an edge to resize, and the
arrangement is remembered per browser. An Add-widget catalog offers everything bound to nothing;
removing every widget reaches an empty state that offers the defaults back.

A new account is seeded a layout filtered by what its role may actually see, so a viewer is never
given a widget their capability immediately hides. An existing `krystal:dash:order` is carried
across, so an arrangement made when the dashboard had bands survives.

Spans reflow by two rules — clamp to the column count, then take the whole row if wider than half
of it. The column ladder is 12 / 8 / 6 / 4, chosen so the summary band's hand-tuned tile ladder
falls out of the span rule rather than being restated: a KPI at `w: 2` reads 6, 4, 3 and 2 across,
which is what `.dash-summary` collapsed to before there were widgets. One stored layout, no
per-breakpoint matrix.

### Added — navigation and lifecycle verbs a card can ask for

`components/NavContext.jsx` (`useNav()`) and `lib/serverActions.js` (`runServerAction`). A pinned
card has no page above it to be handed `onOpenServer` or `onAction`, and a surface offering a Start
button has to do the optimistic patch, the rollback and the wording or it lies about what happened.
Both are now asked for rather than threaded down. `AppRouter` keeps its explicit props for every
other page; a card rendered both ways takes the prop and falls back to the context.

### Fixed — a shared loop no longer stops while consumers still want it

`startFleetOps`/`stopFleetOps` cleared the timer unconditionally, which is correct for one caller
and wrong for several: the first consumer to unmount would freeze the rest on their last value, with
no error and no empty state — a week-old availability figure still rendering as live. The loop is
refcounted.

### Fixed — widgets are neither clipped nor stretched

Grid rows are `minmax(row, auto)`, so a row span is a minimum and a card taller than its cell grows
the track instead of being cut off at the edge. A card with a natural height is no longer stretched
to fill a taller cell, which had inflated the KPI tiles to 193px with the numbers floating in dead
space.

### Fixed — the Customize toolbar is reachable on a phone

The bar was `flex-shrink: 0` with a `nowrap` hint inside a `.dash-head` that clips, so below about
520px Reset and Done sat past the right edge — unreachable, and reporting no horizontal overflow
anywhere to give it away. The row wraps and the hint is dropped at phone widths, where every widget
is full width and there is no edge to pull anyway.

## [1.135.0] - 2026-08-21

### Added — the status pill carries how long the run has lasted

A server card's status pill splits into two segments: the state, and how long it has been in it.
`online · 12h 44m`, `offline · 2d 8h`. The construction is the update chip's — two halves sharing one
pill radius under `align-items: stretch` + `overflow: hidden` — with the label filled and the figure
in mono beside it. The one difference is the ink: the update chip is solid because it rides cover art
and has to survive any image, while this sits on the card body, so its figure half is the status
colour's own tint rather than a scrim.

**It splits only when something dates the run.** With no timestamp the markup is exactly the
single-segment pill that shipped before, which is what keeps the transitional states (Starting,
Updating…, Restarting…) and a server nothing has dated from needing a special case.

Both timestamps come off the DTO, joined by the backend from the run-state authority — the watchdog's
persisted spawn time and its durable run ledger — never derived from the audit feed, which is a capped
page and would report a different answer depending on how much history happened to be loaded.

### Added — the alerts card says what it is watching

When nothing is firing, the card lists the rules the engine is armed against instead of a green tick,
with the 24h resolved count in its foot. The card therefore always renders a list: firing conditions
when there are any, armed rules when there are not.

A rule the host's threshold policy reports as switched **off** keeps its row and loses its dot. That is
the point — an alert engine that is quiet and one that is not watching are indistinguishable from a
tick, and only the dot tells them apart. The rules come from the node's own policy, so a rule added on
the backend appears here with no rebuild. The policy is operator-gated; a viewer sees the previous
all-clear placeholder.

### Fixed — the audit card reported the store's page cap as a total

The header count read `1000` because that is `AUDIT_CAP`, the audit store's page size, rendered as if
it were a total. It read the same figure on a fleet of any size. It now states the window it covered
(`70+ in 24h`), and whether that figure is exact is decided by the cursor rather than the row count: a
walk that reached the end of the log left no cursor, so what is loaded is everything and the count is
complete; a cursor still standing means older rows exist and the count is a floor, marked with a `+`.

### Added — a catalog card says whether this node has room for the blueprint

An uninstalled Library card's foot states the verdict: **Room for this**, **Tight fit**, or the
**Steam account** gate that outranks both. The node's free memory is stated once in the toolbar rather
than on every card — it is a fact about a machine, and printing it per card repeats one number across
the whole grid.

⚠ It is a comparison of two measured figures, never a promise: free memory moves the moment anything
else starts. Hence "Tight fit" rather than "Won't fit", and no card ever refuses to deploy. A blueprint
that declares no recommended memory gets no verdict at all rather than one computed against a guess.

### Fixed — two dead spots on the Library card

Every uninstalled card's foot rendered the word **"Added"** followed by nothing: `addedAt` is not on
the library DTO, so the label resolved to an empty string. That slot now carries the fit verdict.

A blueprint that declares no player capacity rendered an icon with no value beside it — true of 8 of
the 32 on this host — which reads as a broken card rather than an unknown figure. It renders an
em-dash.

### Changed — the dashboard summary band is twelve tiles, six across

Six on a desktop row and two on a phone (6x2 becoming 2x6), through 4- and 3-column steps that
always leave whole rows. `KPI` gains a `compact` variant for it: same chrome and same tone accent,
smaller type, and the header's "View →" becomes the arrow alone — at a sixth of the row the word is
what overflows first.

The split is by question. **What is happening** — servers running, players now (with the day's peak),
distinct players this week, hours played, uptime, time-to-ready. **What needs me** — desired-state
drift, crashes, updates, oldest backup, failed schedules, leaf health.

Five of these are windowed, and that is the point: the capacity strip below already renders every
node's CPU, RAM, disk and round trip, so nothing in the band restates an instantaneous machine
reading. What the strip never shows is time.

⚠ **A tile whose source is missing keeps its slot** and renders "—" with an honest sub-line. In a
fixed grid a self-hiding tile reflows the whole band, and an absent measurement is worth saying.

### Removed — the Ping tile

It measured this browser's link, not the fleet, and the capacity strip already states each node's
round trip on its collapsed line. The ping loop itself stays — the strip, the cluster constellation
and diagnostics all read it, and it is started once from `stores/boot.js`.

### Added — the figures behind the new tiles

`lib/fleetStats.js` derives the windowed player and boot figures from the audit rows the app already
holds; `lib/fleetOps.js` rolls up four per-node payloads that `stores/fleet.js` fetches on the
dashboard's own lazy loop.

⚠ **The audit store holds a capped page**, so a window can outrun the rows loaded. Every function
reports the span it actually saw and the tiles qualify themselves ("partial feed", "in the loaded
feed") rather than presenting a short count as a full one.

⚠ **The peak-players figure is reconstructed backwards** from the live total. Forwards would need a
starting count nobody recorded, and assuming zero would report every peak as the number of joins
since the log began.

⚠ **A session whose join fell outside the window is skipped, not clamped.** Clamping would
manufacture exactly as much playtime as the window happens to be long; the tile counts those
separately as "started earlier".

### Fixed — `/servers/availability` was read as an instance

`adaptResponse` matched it against the `/servers/{id}` rule and ran the report through `adaptServer`,
which returned a server-shaped object with every field null — so the uptime tile read "—" against a
backend answering correctly. It is now routed ahead of that rule and relayed verbatim.

### Changed — the dashboard's Cluster capacity card is one expandable row per node

The row is progressive disclosure. Collapsed it answers *is anything wrong, and how busy is it?* —
status dot, name, region, hostname, the **one worst signal stated in words**, servers running,
players on, round trip. Opened it carries the whole reading: the three capacity meters **with their
absolute values** (`load 3.2 · 16 cores`, `21.6 / 31.3 GB`, `/ · 274.8 / 915.3 GB`), then every disk
by mount, swap, CPU model, OS, kernel, uptime, network both ways, the hottest sensor, a chip per leaf,
and four actions.

**A lone node opens by default.** With one node there is no list to scan and nothing to compare, so a
collapsed row would be a chevron guarding a card with nothing else in it. The chevron still closes it,
and the auto-open lapses the moment a second node joins.

The actions land on surfaces that already exist: **Servers on this node** opens the server list
narrowed to it (a new `?node=<hostId>` entry filter, the same shape as `?status=`), **Node logs** opens
that node's Logs tab, **Ask about ‹node›** opens the dock with an editable prompt nobody has sent, and
**Open node** is the drill the whole row used to be. Ask renders only where the node has a usable
assistant — it is a per-host leaf with no central fallback, and a button that cannot work is worse
than no button.

The worst-meter verdict breaks a tie by how far past its **own** amber line each meter sits. The three
lines are 60/70/80, so ranking by raw percentage names CPU 71% over memory 84% — both amber, only one
nearly out of room.

Repeated mounts of one filesystem collapse to a single row. The monitor reports every mount, and a
bind or subvolume mount repeats the same figures under another path; three identical
`274.8 / 915.3 GB` rows say nothing about three disks. The shortest path represents the filesystem and
the others are named in its tooltip.

Laid out with **container queries**, so the card reflows on its own width rather than the viewport's —
the sidebar and the assistant dock resize this column without the window changing. Under ~620px the
line folds to two rows at a 56px tap-target floor, the drawer's meters stack, its fact columns become
one and its actions go full width. Measured identical in Chromium and Firefox.

Readings that stopped updating are shown dimmed and labelled, never dropped and never refreshed into a
lie; a node whose metrics leaf is down reports its capacity as **unknown**, not zero.

### Added — GPU cards on the performance grid

An entity that reaches the card gets two more cards in the existing grid: **GPU memory** (video memory
held) and **GPU compute** (utilisation, 0–100). They are the same `MetricChartCard` every other metric
uses, fed from the same per-metric series map — `gpuMemBytes` and `gpuSmPct`, the names the monitor
persists them under — so nothing new renders charts.

An entity with no GPU gets **no card**, not an empty one. Most leaves never reach the card and a game
server has no GPU dimension at all.

⚠ **Gaps in the GPU compute chart are idleness, not missing data.** Utilisation is sampled over a
window and a backend that did no work in one reports nothing for that bucket, so the series is
genuinely shorter than the memory series beside it. The nulls are passed through untouched and the
chart opens a gap; coercing them to 0 would draw an idle model as measured-and-busy-at-zero.

Video memory is charted in GiB throughout rather than switching unit on the peak the way host memory
does — a model's footprint is always gigabytes, and a card that silently changed unit between windows
would make two ranges incomparable at a glance.

### Fixed — an unmeasured sample opens a gap in a chart, never a dive to the axis

`TimeSeriesChart` scales and draws whatever it is handed, and a null coerces to 0 in arithmetic — so
a series carrying an absent measurement drew a line down to the axis and along it, which reads as a
real zero. It now treats a non-finite value (null / undefined / NaN) as what it is: a point that was
not measured.

Such a point is left out of the y-domain, dropped from the line and its fill, dropped from the
min/max band, excluded from the anomaly statistics, and reads `—` in the hover tooltip. A series
whose newest sample is absent gets no current-value dot rather than one parked on the axis. The
break reuses the same segmentation downtime already uses, with one difference that matters: a time
gap breaks every series alike, an absent value breaks only the series carrying it.

⚠ **A series formatter is only ever handed a number.** A card supplies its own `fmt` (`v =>
v.toFixed(0) + "% core"`), and the tooltip called it on whatever sat under the cursor — hovering an
absent sample threw and took the whole card to its error boundary.

A single NaN or `undefined` anywhere in a series was worse than one point: `Math.min`/`Math.max`
propagated it through the domain and every coordinate on the chart became NaN, blanking it entirely.

A series with no absent values renders exactly as before.

### Added — the Reactor's Rules tab

One card per rule: what wakes it, what it would do about that, how long it settles before judging,
how long it stays quiet afterwards, and which authority it runs under — with a control to move it
between off, observe, propose and act.

**What the control can offer comes from the leaf, not from here.** Propose and act are later phases
in the reactor, and it reports the most authority it will honour; the modes above that render
disabled with the reason. A panel that hard-coded "this build only observes" would go on refusing
`act` after the build that acts is deployed.

⚠ **A rule configured beyond what the build honours is now called out on its card.** The leaf reports
the effective mode with the configured one beside it, and the card says "configured to act, running
as observe" rather than echoing a granted authority that does not exist.

**The windows stay read-only, deliberately.** Settle and suppression are compiled constants carrying
the measurement they came from — 30 days of this host, pinned by the leaf's tests with each figure's
basis. A text box would invite replacing a measurement with a guess that looks just as authoritative
on screen. Each card states the basis instead, and a closing card says plainly what configuration
owns and what ships in code.

Writing a rule's mode edits the leaf's own mode lists through the same config path the Settings tab
uses — a CSV of rule ids is a poor thing to type by hand and a good thing to render as a switch.
Admin-gated, and the page says up front that applying restarts the reactor.

### Fixed — "no sweep yet" could never clear

The Overview reported a null last-sweep as a first pass that had not landed, telling the reader it
clears within one sweep interval. With every rule switched off the engine stops before its first
pass and never sweeps at all, so that message would have stood forever. The two states are now
separate, and the one that does not resolve itself says what to do about it.

### Added — the Reactor's Decisions tab: the review gate, performed rather than declared

The reactor's plan gates propose and act mode behind a review — nothing moves until a window of
decisions has been read against what a person would actually have done. That review existed only as
`kgsm-reactor --decisions` on a terminal on the host, which is how a gate becomes a formality.

`ReactorDecisions` renders the four readings the leaf computes, at a chosen window of 7, 14 or 30
days: what each rule concluded and how often, the busiest rolling hour of fired decisions, how far
apart a rule's repeats about one subject were, and the rules that decided nothing at all — plus the
decisions themselves, each carrying the journal position it was derived from so a reviewer who
disagrees with a verdict can go and read the line it was made from.

**Nothing on the page is computed.** Every figure arrives from the leaf. Re-deriving the busiest hour
in the browser from the decisions list would be wrong the moment that list is capped — and it is
capped, which is why `total` sits on the wire beside it.

An empty window is worded as the ambiguous reading it is, not as "no data": a rule decides nothing
when its condition never occurred, and equally when the event that wakes it never arrived, and only
the population report separates those.

⚠ The page suggests no window, ceiling or threshold, because the leaf suggests none. Adding a
recommendation here would put back exactly what the leaf declined to say.

### Added — the Reactor leaf has an Overview

The reactor was the one leaf on the board still falling through to the generic configuration card,
which answered what it is set to and nothing about what it is doing. `ReactorOverview` reads the
leaf's own status through `GET /hosts/{id}/services/reactor/status` and states four things: whether
it is observing at all, how long ago the last sweep landed against the interval it is meant to run
on, what it has ingested, and what it has judged.

Three of those exist because the states they separate look identical from outside. A reactor that
reports nothing may be deliberately silent — `enabled:false` leaves the daemon running and recording
nothing, which is how it is quieted without stopping the unit — or sweeping normally over a quiet
host, or wedged. Observing and the sweep age are what tell them apart, so neither is folded into one
calm tile.

**Dropped observations are surfaced, loudly.** A non-zero drop count means the ledger is missing
events that really happened and every rate derived from it under-reports — the one failure that
otherwise looks exactly like a quiet host. It tones the Observations tile danger at one, not at a
threshold.

⚠ Every counter the leaf reports is since its own process started, so each says so in its own
sub-line: a zero after a deploy is a restart, never evidence of a quiet host.

Alongside them, the settling lane (evaluations woken and waiting out a settle window — the difference
between a reactor that has not noticed and one deliberately waiting), the rules table with each
rule's shape, severity and windows, and the gate's tuning. Nothing is recomputed: the leaf reports
each rule's mode and suppression window already resolved, and re-deriving either from the settings
descriptor would show an authority a rule does not have.

### Fixed — the Reactor card says what it is

The Services board draws a leaf's icon and its one-word kind from the frontend's own leaf
vocabulary, and the reactor had no entry there: its card came up with the generic cube and no
kind chip above the name, the only card on the board missing one. It now carries a lightning
bolt and reads "event rules" — the counterpart to the scheduler's clock, which fires on time
where this one fires on something happening.

### Changed — the breadcrumb walks the whole URL, sub-tab included

A trail stopped at the page and left the tab off, so `#/cluster/hotrod/services` read
"Home / Cluster / Hotrod" — three crumbs for four segments, and the last one named a place
the screen was not on. Every tabbed route now ends its trail with the tab the URL carries:
`#/servers/Ketchup/files` reads "Home / Servers / Ketchup / Files", `#/settings/security`
reads "Home / Settings / Security", and a leaf's own tab reads
"Home / Cluster / DevTest / Services / Monitor / Logs". Each crumb but the last opens the
prefix of the URL it sits at, so walking back up the trail walks back up the address.

A crumb appears only for a tab the URL actually names and the page actually shows: a route's
default tab is omitted from the hash and so has no crumb, a segment no tab answers to is left
off rather than announced, and a server's operator tabs — which the page hides from a player,
landing them on the overview — are uncrumbed for one.

Tab names now come from `ROUTE_TABS` in `src/lib/labels.js`, read by the page drawing the strip
and by the breadcrumb naming the segment, so the two cannot drift. Each page keeps what is its
own: the badge counting its alerts, and which tabs the persona is offered.

### Removed — the back arrow beside a node's name

The node deep-dive's title carried an icon-only back button into the left gutter. The breadcrumb
above it already walks back to the cluster, one crumb per segment, so the arrow was a second
control for the same move — one the page had to keep in step with the URL by hand.

### Fixed — type on a filled semantic colour is legible in every theme

A semantic colour is used two ways, and only one of them was ever tuned. As a **tint** behind muted
text (`--success-bg` + `--success-fg`) each theme had already picked the pair. As a **fill** — a
primary button, a filled badge, a status chip — the colour becomes the background, and the
foreground was whichever of `--fg-inverse` / `--btn-accent-fg` / a literal `#fff` the call site
happened to reach for. Measured in a browser across all 48 themes and 7 routes, **80 of 290 rendered
(theme × filled surface) pairs sat below AA**; the worst was 1.35:1, and the failures clustered in
the tribute light themes and the colour-vision pack, where legibility is the entire point.

`--on-accent` / `--on-success` / `--on-danger` / `--on-warning` / `--on-update` / `--on-info` now
carry that ink, one per family. A call site writing `background: var(--success)` reads
`color: var(--on-success)` and nothing else. `--on-accent` and `--on-success` default *through*
`--btn-accent-fg` / `--btn-success-fg`, so a theme that had tuned those keeps its tuning; 29 themes
re-value at least one of the six. **All 290 pairs now clear AA, worst 4.53:1.**

⚠ This is not a palette retouch and does not soften "an upstream scheme ships unretouched": choosing
black rather than white type to lay *on* Solarized's red does not change Solarized's red. What is
stated per theme is the pair.

Twenty-two teal-filled surfaces were reading `--fg-inverse` where `--btn-accent-fg` was the token
built for exactly that job — dark type on a teal the light theme also darkens. Those are among the
80.

### Fixed — chips on cover art no longer borrow a page colour

`--scrim-media` is the scrim for something sitting on **artwork** rather than on the page: the server
card's host pill, its favourite star and the update chip. Deliberately not theme-scoped, dark in
every theme, content stays white. `--scrim-base` remains the modal/drawer backdrop and is correctly
light in several light themes — which is exactly why the two cannot be the same token, since a white
host pill on a light scrim was white on white. Worst case is now measured with the scrim composited
over white artwork: 8.25:1.

`scripts/visual-harness/semantic-contrast.mjs` measures all of the above in a real browser and is the
check to run after touching an `--on-*` token or adding a filled surface. It reads the theme list out
of the stylesheet, so a new theme is covered the day it lands.

### Changed — a server card says which update is waiting, and offers it when it can run

A pending update is announced by a chip on the card's **artwork**, in the corner the host pill and
star leave empty: a solid "Update" label fused to a frosted version segment, so it stays legible over
whatever cover art the backend returns. It carries the target build (`2.0.55`) rather than pointing at
one, and it shows in **every run state** — a newer build is a fact about the installed files, true
whether or not anything is running. It goes quiet only while the update is being applied, because the
status pill is already saying "Updating…" and two colours reporting one event reads as two events.

Acting on it is a separate question, and `verbGuard` owns it. kgsm cannot rewrite files in use, so an
update only runs on a stopped server — and there the card promotes a full-width **"Update to
&lt;version&gt;"** into its connect row, which is dead weight on a stopped server anyway (nothing to
join, no address to copy). Info-blue, never the green of Play. Online, the row goes back to Play and
the chip carries it alone: **no disabled update control anywhere on the card**, because an action that
cannot run is absent rather than greyed. It is the same button pressed everywhere else — one press
arms it ("Confirm?"), the second issues `update`, and an in-flight job shows its spinner.

The chip lives on the artwork so that a card carrying an update is **exactly as tall** as one without.
That is load-bearing rather than tidy: a CSS grid row stretches to its tallest item, so anything that
grew the body would pad out every sibling in the row. At a 4-up dashboard (295px columns, below the
card's own 340px container query) a fourth quick button would have cost 34px per updating card.

`ServerActionButton` gains a `cta` variant and an optional `label`, so a promoted button can name its
target version while still reporting the verb's own words in flight. The adapter now also exposes
`update_version` — the target build on its own — so a surface can render the figure without having to
recognise the prose stand-in `update_available` falls back to when the engine names no build.

### Added — `--on-info`, text on a filled info surface

Both new surfaces are filled `--info`, and `--info` swings from a pale tint to a saturated blue across
the theme pack, so no single foreground reads on all of them. `--on-info` defaults to `--fg-inverse`
and is re-valued by the 17 themes where that pairing falls below AA — including every colour-vision
theme, which is where it matters most. Measured in a browser across all 48 themes; worst is now
4.64:1 (nord), where the worst was 2.34:1.

⚠ The same gap remains for the other filled semantic surfaces (`.chat-action__go--success/--danger/
--warning/--update` pair `--fg-inverse` with tokens that are light in the tribute light themes), and
`.server-tile__host` hardcodes white on a `--scrim-base` that three light themes make light. Neither is
touched here. The update chip sidesteps the second by scrimming itself with a fixed dark value: what is
behind it is cover art, not the page, so it holds the dark palette in every theme — the same reasoning
`lib/art.js` uses for the cinematic hero's placeholder.

### Added — an alert offers what to do about itself

A firing alert card now carries the condition's own action beside "Ask assistant": an available
update draws **Update**, a crash the watchdog is retrying draws **Stop**, and one it gave up on
draws **Start**. The verbs come from the backend (`actions[]` on the alert), which shares its
catalog with Web Push, so the same condition never suggests one thing on a phone and another here.
A host threshold offers nothing — a number over a line names no cause — and keeps "Ask assistant"
as its primary action. On both surfaces the feed appears on: the Alerts page card and the
dashboard's compact row, where a press does not also open the assistant.

It is the same button pressed anywhere else, with the same misclick guard: one press arms it
("Confirm?"), the second runs it, and the armed state lapses on its own. A press while the server
has a command in flight is locked out, and shows that job's spinner.

`verbGuard(server, verb)` in `ServerActions.jsx` is now the ONE answer to "can this verb run, and
why not", shared by the hero, the server tile and an alert card — so a card cannot offer Update
while the hero refuses it. A running server with an update pending therefore renders the button
**disabled**, saying "Server must be stopped before updating", rather than hiding it or letting the
click come back a 409.

⚠ An unrecognized action kind draws nothing rather than guessing, so kgsm-api can offer a new
operation before this SPA knows how to render it.

### Fixed — the dashboard's player count is the fleet's, not zero

*"X of Y servers online · Z players connected right now"* always said **0**. The count read
`server.players`, which the adapter hardcoded to null because the backend carried no player field —
so the greeting reported nobody on a fleet whose own cards, right below it, showed people playing.

kgsm-api now carries `onlinePlayers` on the server DTO, counted off the same roster the Players tab
reads and pushed on the `server.patch` stream. The adapter maps it, so the count is live everywhere it
was dead: the dashboard line, the Servers page group and favourites tallies, and the **"Players
online" sort**, which until now compared zeroes and sorted nothing.

⚠ `null` is not `0`. A server whose presence this host can't see (no join/leave detection, or an
unreachable supervisor) carries null, renders "—" on its card, and is **left out of a total and
counted separately** — the dashboard says *"· N servers can't report who's on"*, and a group tally
renders `3+ players`. A measurably stopped server is not counted among those: nobody is connected to a
process that isn't running. The counting rules live in `lib/servers.js` (`playerTally`,
`fleetSummary`), so the two pages can't drift.

Server cards no longer fetch a roster each — a dashboard with eight servers fired eight
`GET /servers/{id}/players` requests to render eight numbers that now ride the roster they already had.

### Fixed — one conversation, one name, whichever surface you open it in

A chat started in the Control Panel's dock read **New chat** there and **Untitled chat** in the
standalone assistant. Neither was wrong on its own; they were two clients each inventing a word for a
title the leaf reported as null. Naming a conversation is a cross-client fact, so the leaf answers it
now (wire contract 2.1) and both surfaces render what it says.

`/new` returns the conversation it started, not only its id, and `newChat()` adopts that row instead of
composing one — so the surface that pressed the button holds the identical row every other surface will
read. `mergeServerConversations` lets the leaf's title **overwrite**, the way it already does the
per-conversation switches, rather than only filling an empty one.

The browser no longer derives a title from the first prompt. Its rule was `slice(0, 40)` with no
ellipsis where the leaf's is 80 with one, and the merge would not replace what it had written — so a
first prompt longer than 40 characters read one way in the browser that typed it and another way
everywhere else, permanently. A conversation now takes its name from the leaf on the next listing read,
which the first turn's own completion triggers.

⚠ One client-side name survives, in **one** place (`chatConstants.js`): the row this browser mints
between pressing New chat and `/new` answering, which is the only conversation the leaf has no opinion
about yet. It is the leaf's word, which is why the wire contract states the string rather than leaving
each side to pick one. Everything that renders a conversation name — the rail, the history popover, the
recent-conversations card, the admin review listing and the review header — goes through the one
`conversationTitle()` helper, where there were previously four fallbacks spelling three different words.

### Added — the fresh-chat screen offers the last three conversations

Opening a new chat lists the three conversations you were most recently in, each with how many
messages are in it and when it was last spoken in, and one click resumes it. It is the same
`BriefCard` the Alerts panel above it is built from, so the two read as one family of cards.

Both surfaces get it from one place. The list is already the chat's own state — this browser's
conversations merged with the ones the leaf holds — so the card renders in the shared empty state
rather than being injected per surface, and it makes no request of its own. On a phone, where the
conversation rail is hidden, it is the only way back into a conversation that does not go through
the history menu.

Ordered by when each was last spoken in, which the leaf is the authority for: its `lastActivityAt`
overwrites what this browser remembered, the way the per-conversation switches already do — a
conversation carried on from another device is otherwise as old here as this browser's last sight
of it. A conversation nobody has said anything in is left out; it is the screen you are already
looking at.

### Fixed — the Memory card says whose memory it is showing

A memory belongs to one leaf and the Control Panel is one page over a whole cluster, so the card now
names the host: *"What the assistant on hotrod has written down about you."* Left unsaid, changing
which assistant the chat dock points at silently changed what the card was about.

Three reasons there is nothing to show are told apart, where one message used to cover all of them:

- **no host in the cluster runs an assistant** — nothing has been written down
- **several run one and none is picked** — the dock deliberately leaves its target unset when more
  than one could answer, so a cluster of healthy assistants was reporting itself as having none. It
  offers the chat, where that choice is made; the choice is not duplicated here.
- **one is picked but the browser has no route to it** — ⚠ stated as *not readable right now*, never
  as nothing being remembered. The second is a claim about the memory, and it isn't known.

The standalone assistant is untouched: it has exactly one leaf and never has to say which, so every
prop that makes this cluster-aware defaults to describing that surface.

### Added — the Memory card corrects a memory, not only drops one

Settings → Memory (both surfaces) lists what the leaf has written down about you, and each row opens
a sheet holding the whole memory: the summary on a line of its own, the note underneath in the same
editor the file browser and the chat's blueprint card use. `Write one` in the card's header writes one
from nothing.

The two fields are separate because the SUMMARY is injected into every later turn and the NOTE is
not. Each carries a live count against the leaf's own cap — read from `GET /memories/limits`, never
restated here, since a client cannot know when a host re-tunes them — and the card's header says how
many of the allowance are kept.

⚠ The name of a memory is fixed once it exists: writing that name again is what replaces it, so a
rename would be a write plus a forget wearing one button. The sheet says so, and offers the name as a
field only when there is nothing there yet.

A row says where its memory came from — written by you, or learned in a conversation. Correcting one
the assistant wrote makes it yours, because the sentence is then the person's.

A refusal from the leaf (a length, the per-owner cap) renders inside the sheet against what is still
on screen, never as a toast: it names something to correct, and a toast would take the note away to
say it.

### Fixed — the standalone assistant's phone rules lost to the partials listed after them

`styles/assistant.css` imports the shared partials in the order `kit.css` does. A media query adds no
specificity, so a partial listed after `responsive.css` beat `responsive.css`'s own phone rules for
anything it styles — which made a modal on that surface keep its desktop scrim inset on a phone, and
was invisible from every desktop check and from the Control Panel.

### Fixed — two rules that were never written

`.login-card__error` had no rule anywhere: the reason a sign-in did not go through rendered as bare
text on both surfaces. And a badge in `kit/catalog.css` asked for `--font-sans`, which nothing
defines — an undefined custom property is invalid at computed-value time, so it silently dropped to
the inherited family and could not follow a theme that re-values `--font-ui`.

### Added — why a backup exists, and whether retention may take it

A backup row's subtitle ends with why it was taken — `manual`, `scheduled`, `before an update`,
`before a restore`, `incident`. It is the one field rendered when it is **absent** too: a backup taken
before the engine recorded a reason reads `reason unknown`, because leaving it blank would present it
as an ordinary snapshot, and telling a routine archive from one taken over a broken server is the
whole point of the field.

A pinned backup carries a `Pinned` badge beside its id, and the pin/unpin toggle sits next to
Restore. Pinning is not a delete guard — the trash still removes a pinned backup — so the toggle is a
plain button with no arming. Both directions re-list rather than flipping the badge locally: it says
what the host records, never what was asked for.

### Added — a Memory settings card

Both settings surfaces (the Control Panel's account page and the standalone assistant's own
settings) gain a Memory tab: what the assistant has written down about you, each row showing its
summary, its key and when it was written, with a control to forget it. The new
`src/components/SettingsMemory.jsx` talks to the assistant leaf directly through
`assistantClient.js` (`memories()` / `deleteMemory()`), the same seam a chat turn uses, never
through kgsm-api's peer relay — so it stays safe for the standalone bundle.

### Changed — the assistant names its own tools

`TOOL_LABELS` is gone. The label shown while a tool runs arrives on the `tool.start` frame, read from
that tool's own entry in the assistant's catalog — the leaf owns its tools, so it owns what they are
called.

The map that used to live here went stale without ever failing. It named `get_console`, `get_config`,
`get_host_diagnostics` and `get_change_timeline`, four tools that no longer exist, and knew nothing
about any tool added after it was written; `toolLabel`'s prettify-the-name fallback covered for it, so
the wrong labels looked like a design choice. That fallback still runs for a frame that carries no
label, which is all a pre-label leaf ever sent.


### Added — one way in: node → sign in / register → the app

`components/AuthGate.jsx` and `pages/auth/` replace the old chain of early returns inside the shell.
`App.jsx` now renders the gate **instead of** `AppInner`, so none of the shell's ~15 hooks — and none
of the data layer they drive — runs for somebody who has not signed in.

- **`NodePage`** — which host you are signing in to. A node is a row: status dot, the name it calls
  itself, region, address, build. Everything on it comes from one anonymous `GET /api/v1`, which is
  also the reachability probe, so nothing is green because an address was typed in. An unreachable
  node stays listed with its reason and a Retry rather than vanishing. With an empty registry the
  address form *is* the screen. A returning visitor skips this: the last node used is probed and, if
  it answers, they land on its sign-in.
- **`SignInPage`** — one card, two tabs, same order down the card on both so nothing moves when you
  toggle: **segment → providers → divider → form**. Providers and whether sign-up is open both come
  from that node's `/auth/providers`; this SPA holds no list of either. One provider is a branded
  full-width button, several are a neutral 2-up grid.
- **`PendingPage`** — signed in, holding nothing. It **polls `GET /me`** every 5s while the tab is
  visible and lets the person in the moment an admin approves them. Not a push: a pending account is
  tier `none`, `/api/v1/stream` is viewer-gated, and the hub has no per-user delivery — there is
  nothing to subscribe to.
- **`lib/authFlow.js`** — the domain half: probing, the two credential calls, the field checks
  mirroring `kgsm-auth`'s real rules, and the pending session.

**Transitions no longer reload the page.** Sign-in, registration and approval all swap the gate for
the shell in place. The reload was never about routing — it was that the shell's hooks sat above a
flipping condition, which the split removes.

⚠ **A pending account cannot live in `sessionStore`.** That store is keyed by backend host id, and
the only way to learn one is `GET /hosts`, which is viewer-gated — so a tierless caller has no id to
be filed under on any node. The gate carries their session itself, in `sessionStorage`, keyed by
origin, until approval lets the ordinary per-host session take over.

### Changed — a session that ends sends you to that node's sign-in

`pages/HostReauth.jsx` is **removed**. It could not re-authenticate: it waited 650ms behind
"Opening Discord…" without opening anything, then re-read `/me` with the token that had already
failed. The honest answer to a dead session is the door, so the shell drops the stored identity and
`AuthGate` lands on the node last used. The per-node notice's button says "Sign in again".

### Fixed — a revoked session could stay silently expired forever

`sessionStore`'s `reauthDue` countdown was restarted by every retry. A retry passes through
`bootstrapping` on its way back to `expired`, `syncReauthSurfacing` treated any non-`expired` status
as a recovery and cleared the timer, and the SSE stream's own reconnect backoff tops out at 12s and
never gives up — so the 30s never elapsed. A revoked session left the panel showing stale data
behind a connectivity banner indefinitely. `bootstrapping` is now ignored, and only a session that
comes back cancels the countdown. **Measured against the live host: a revoked tab returns to sign-in
in ~50s** (the server's 20s session re-check on the open stream, plus the 30s grace) with no
interaction.

### Fixed — the login screen's form furniture followed its own scheme

It had drifted from the rest of the app. Inputs filled with `--surface-2` where every other input
uses `--surface-3` (which `tokens.css` names "input fill"), focused to full-strength
`--krystal-teal` where the rest focus to `--border-accent`, and `.oauth-btn` hovered *down* a
surface where every other ghost lifts. Labels are now the onboarding family's uppercase micro-label
(`.add-host__label`), the segmented control matches `.subtabs`, the status dot is `.svc-dot`, and
callouts take `.add-host__denied` / `.add-host__note`'s treatment. Each rule names the site-wide
class it matches.

Also fixed while there: **the inputs overflowed their card by 26px** (56px for a password field).
This app has no global reset — it declares `box-sizing` per rule — and a `width: 100%` padded
control is `content-box` by default.

Corners on these three screens are `--r-sm` throughout; `--r-pill` stays on the dots, the doorway
chip and the strength meter, which are shapes rather than corners.

### Changed — the data layer runs for somebody, not for nobody

`startDataLayer()` / `stopDataLayer()` (`lib/stores/boot.js`), called by the shell once there is an
identity. Importing the store barrel now hydrates nothing and opens no socket.

Until now the four store refreshes, the ping loop, cluster discovery and **one SSE stream per
connection** all fired at module evaluation — before React rendered, for every visitor. A browser
sitting on the sign-in screen was therefore fetching and streaming on behalf of nobody: every call
401'd, and every stream entered a 2.5s→12s backoff loop that could not succeed until somebody signed
in and would not stop until the tab closed. Measured on a real Chromium load with no stored identity:
**3 stream dials and 18 domain fetches before, 0 and 0 after**; with an identity, unchanged.

Three mechanical parts: `api.startStreams()`/`stopStreams()` replaces the stream registry's
module-load dial (a topic subscribed while stopped is recorded and opened on start, so an early
subscriber is not silently dropped); `sessionStore.startBootstrap()`/`stopBootstrap()` gates the
`hostsStore` subscription that authorizes each host, while `seed()` stays at import because restoring
a persisted session is a pure storage read the gate needs on its first render; and `stopPingLoop()` /
`stopDiscovery()` join their existing starters.

⚠ **`boot.js` reaches `sessionStore` through a lazy `import()`.** A static one closes a cycle —
`sessionStore` → `stores.js` → `stores/index.js` → `boot.js` — and breaks boot. Same landmine as
`apiClient`'s deferred imports.

⚠ **One request still precedes sign-in**: `useAlerts()` is a hook above `App.jsx`'s gate, so it
subscribes before the gate decides what to render. It goes when the gate and the shell become
separate components.

## [1.117.0] - 2026-08-15

### Added — the speech leaf has an Overview

`pages/leaf/SpeechOverview.jsx`, registered in `LeafPage`'s `LEAF_OVERVIEW`. Until now this leaf fell
through to the generic body, which re-renders the config descriptor — everything it said was already
on the Settings tab.

It reads the engine's own measurements: whether the models are loaded, which runtime each half
ACTUALLY opened on, the voice it is speaking in beside the one configured, when the models unload, what
is attached to it, and per-half tallies of what it has heard and said — passes, seconds of audio, mean
and p95 durations, and how many seconds of audio it handles per second of work.

Three engine states are rendered as three states, not two, because they are three different answers to
"why is nothing speaking": **resting** (no process — the leaf idle-exits to give back ~1.6GB, and the
api deliberately does not connect, because connecting is what would start it), **idle** (running, models
not loaded, so the next request pays a few seconds), and **loaded**. Resting still shows what can be
known without asking: the model files measured on disk, the configured voice, and the idle window.

Built from the existing kit — `KPI`, `BriefCard`, `CardTable`, `LeafFacts` and `useLeafResource` — so it
carries no component of its own. It deliberately does not poll: `unloadsAt` is an absolute time that a
local clock tick renders against, and polling this leaf is the one thing that would keep it resident.

## [1.116.0] - 2026-08-15

### Added — the host reads your voice notes

Both surfaces have recorded voice notes for a while; what turned one into words was the browser's own
`SpeechRecognition`, which exists in Chrome, sends the audio to Google to do it, and has never heard
of a server called `factorio`. Now the recording goes to the host: the same whisper, primed with the
same server names, that hears a request spoken into a Discord channel — so "restart factorio" lands
the same way in a browser as it does in a voice channel.

- **`src/lib/voicePcm.js`** converts the recording to what the leaf reads (16kHz mono signed 16-bit
  PCM) using the decoder the browser already has for what it just recorded. It imports nothing, so
  both surfaces share it without the standalone reaching the panel's data layer.
- **The browser's recogniser is now the fallback, not the default** — used only on a host with no
  speech leaf, so nothing regresses there. Two recognisers is two spellings of every server name.
- **A failed transcription keeps the recording** and turns the send button into *Try again*. Losing
  somebody's sentence because a request failed is the one outcome worth going to trouble to avoid.
- **Recording stops at three minutes**, the ceiling the leaf refuses above — stopped at the line
  rather than refused after somebody has said the whole thing.
- The transcript lands in the composer for the person to read. It does not become a turn on its own.

Verified in Chromium against the live host (`scripts/visual-harness/voice-note.mjs`, 10/10): a phrase
synthesised by the host, recorded through `MediaRecorder` as webm/opus, converted here and read back
by the host as *"Restart the factorio server please."* — server name intact.

## [1.115.0] - 2026-08-15

### Added — the chat can read an answer aloud as it is written

A **Read aloud** toggle beside Thinking and Auto-run. With it on, a turn asks the leaf to speak, and
each sentence arrives as its own `audio.delta` frame **while the text is still streaming** — the first
one plays before the answer is finished, which is the whole point of doing it on the token stream
rather than at the end.

- **Off until asked, and remembered per conversation.** A page that starts talking is a surprise in a
  room with other people in it. It is also the only shape that works: a browser refuses audio until
  the page has been interacted with, so **turning the toggle on IS the gesture** that arms the audio
  context. Armed on the frame instead, the context would be created seconds later with nothing behind
  it and stay suspended — silence, with nothing to say why.
- **Sentences play back to back, never on top of each other**, and in the order they arrived. A
  sentence that will not decode costs itself and nothing else; the words are on screen either way.
- **Stop silences it.** Pressing Stop, or sending another message, abandons what is queued — an answer
  somebody just abandoned should not go on being read out.
- **A browser that refuses says so on the toggle** rather than in a toast: the control that asked is
  right there, and a toast is for a shell handler that owns no control to render into.

Both surfaces get it — the panel's dock and the standalone assistant share `src/chat/`.

`scripts/visual-harness/spoken-reply.mjs` drives the queue in a real Chromium with real WAV bytes:
decoded, played in arrival order, never two at once, stop empties the queue, a corrupt frame is
skipped. ⚠ It counts concurrent sources rather than timing them — headless Chromium renders audio
through a null sink faster than realtime, so a clip's wall-clock duration proves nothing.

## [1.114.2] - 2026-08-15

### Added — the Speech leaf reads as itself on the Services board

`kgsm-speech` joined the ecosystem and the board rendered it with the fallback: the generic cube and
no kind pill. It now carries `audio-lines` — sound itself rather than a microphone or a speaker,
because the leaf does both directions and a mic would name only the half it hears with — and the kind
**hearing & voice**, for the same reason: a reader seeing "Speech" would assume it only talks.

Both maps in `lib/leaves.js` are still fallback-safe, so a leaf that arrives before the frontend knows
about it renders correctly and nameless rather than not at all.

## [Unreleased]

### Fixed — the find bar's controls are one height

The field rendered 32px and every button 24px, so the three search modifiers sat against the field
as small squares rather than reading as part of it. A `<button>` is `border-box` from the UA
stylesheet and sized to its icon; a text input is `content-box`, so its declared 30px became 32
once the border landed outside it. The row now states one control height that the field and all six
buttons read, each icon-only button is a square of it, and `box-sizing` is stated so the number
means the same thing everywhere. The modifier glyphs are 16px — they are text (`Aa`, `ab`, `.*`)
rather than a symbol, and 14 left them under-scaled in the taller box.

`console-search.mjs` asserts the single height in both engines, which round form-control metrics
differently.

### Added — the console's find takes match case, whole word and regular expressions

The find bar carries the three modifiers an editor spells `Aa`, `ab` and `.*`, with `Alt+C` / `Alt+W`
/ `Alt+R` for each. They compile into one matcher that the count, the "only matches" filter, the
highlight and the stepper all read, so what is counted is what is marked.

Whole-word is checked on the match rather than by wrapping the pattern in `\b`, which lets `[warn]`,
`--verbose` and `x=1` mean what they say — a `\b` is an assertion about the character beside it and
finds nothing when the query begins with punctuation. A pattern that does not compile is answered
with *bad pattern*, a marked field and the engine's own reason on a row of its own; reporting zero
matches instead would say the text is not in the log, which is a different claim. Zero-length
patterns (`a*`, `^`, `\b`) step rather than spin.

The search runs over the line as the reader sees it. The `§…§` markers around an
engine-highlighted name are not characters on screen, so they no longer split a match in half or
stand between `^` and the start of a line, and the ranges found are mapped back onto the segments so
a hit straddling a name is marked as the one match it is. *Copy what's shown* drops the markers for
the same reason. The query is no longer trimmed: a leading or trailing space is part of what someone
searching a log means.

Proven in Chromium and Firefox by `scripts/visual-harness/console-search.mjs`, which recomputes every
expected count from the text on screen with a second implementation.

### Fixed — the server hero's connect bar lines up

Its three controls — the address pill, Copy and Play — measured 35.5, 34 and 36. Play carried the
anchor-vs-button `box-sizing` mismatch below, and the pill had no height at all, so it sized to its
own line box. The bar now states one control height that all three read, and the pill centres its
address inside it rather than setting the pill's size from its text. At phone width the pill still
takes a full-width row of its own with Copy and Play sharing the next at tap-target height, which is
unchanged — the controls sharing a row are what have to agree.

### Fixed — Play and Copy on a server card are the same height

The two controls declared the same 32px and rendered 34 and 32. Play is an `<a>` (it navigates to a
`steam://` URL) and Copy is a `<button>`, and a UA stylesheet gives form controls `border-box` while
an anchor keeps the CSS initial `content-box` — so the 1px border landed inside one and on top of the
other. The row states `box-sizing` rather than leaving the height to mean two different things
depending on which element a control happens to be, and `align-items: stretch` so a future control
that states no height still matches the row instead of sizing to its own text.

### Changed — a server card's metrics hold still

The metric row spans the card and distributes with `space-between`, so the first reading is flush left,
the last flush right and the space falls between them. Each value sits in a box of fixed character
width, which is what stops the row shuffling sideways every time a figure gains a digit — CPU crossing
from 86% to 147% now repaints in place instead of shoving memory, network and disk along with it.

Every figure reads on one ramp that rescales both ways — `4.2G`, `985M`, `12K`, `355B` — because a raw
byte count says nothing until you have counted its digits. The ramp is capped at four characters, which
is what makes the fixed boxes possible: only values under 10 carry a decimal, and one that would round
to four digits promotes to the next unit instead (1023 B is `1.0K`). The exact figure moves to the
chip's tooltip.

Below 768px, and on any card too narrow for one line whatever the window is doing, the row becomes two
— players/CPU/memory over network/disk — each distributed the same way. The narrow case is a container
query on the card rather than a media query, because the roster grid packs to 280px columns on a wide
desktop and it is the card's width that the row has to answer to.

### Added — the console reaches the whole log, not just the window

**Load earlier lines** sits at the top of the scrollback and reads back through the run — as far as
it goes, in 500-line steps, not to some ceiling. Each step asks for the window ending where the
loaded lines begin (kgsm-api reports that byte offset), so the pages meet exactly while the server
keeps printing. Lines fetched this way are exempt from the 1000-line live cap: that cap exists to
stop a feed growing on its own, and lines somebody asked for by name are not that. The control is
absent once the beginning of the run is loaded, rather than sitting there claiming there is more.

**Download the full log** saves the entire run — the file to attach to a bug report — streamed from
the watchdog rather than assembled from what is on screen. It is fetched rather than linked because
a top-level navigation carries no Authorization header and the browser would save an anonymous 401
named like a log.

**A view-options menu** in the card head: wrap long lines off puts each line on one row and scrolls
the body sideways, which is how a stack trace stays readable; timestamps can be hidden; **Copy
what's shown** takes the current view, find filter included; **Clear the view** hides what is on
screen and says so — the feed still holds every line, the count in the head does not move, the log on
disk is untouched and the download still carries all of it. What was hidden comes back from the same
menu.

**Recent commands** under the input names who has been sending them and through what — the same
console is reachable from Discord, the assistant and every other operator, so a command appearing in
the feed with no explanation is a real question. The rows come from kgsm-api's audit log, which is
the authority and redacts what the caller may not read; they are styled unlike console lines on
purpose, because they are records about the console rather than output from it.

### Added — the console can be read while it is running

The console tailed by force: every arriving line scrolled the body to the bottom, so on a server that
says anything at all the scrollback could not be read — you scrolled up, and the next line dragged
you back down. Following is now the reader's POSITION rather than something the card does. It tails
while you are at the bottom, and the moment you scroll away it holds the line you are on, anchoring
it against the window trimming its own oldest lines underneath you. A pill over the foot of the feed
says how many lines have arrived behind your back and takes you back to them.

**Find in console.** The magnifier in the card head opens a bar that searches the lines already in
the window: every occurrence is marked, the active hit is tinted and walked to (Enter / Shift+Enter,
or the steppers), and **Only matches** collapses the feed to the lines that carry the query. Typing
walks to the first hit rather than leaving you at the bottom of an unfiltered feed with a count.

**↑ / ↓ recalls commands** sent to the console, per server, kept in this browser. Stepping back holds
the half-typed command and ↓ returns to it. The authoritative record of who ran what stays kgsm-api's
audit log, which sees the commands sent from Discord and the assistant too.

All three land on the shared console card, so the host-logs tab and a leaf's journal get them as well.



### Added — GPL-3.0-or-later

This project now carries a `LICENSE`. Its package declares `GPL-3.0-or-later` and installs the text
to `/usr/share/licenses/`, so a distributed binary travels with the terms it is under.

### Added — a server card reads CPU, memory, network and disk, live

Each tile carries four measurements instead of two. CPU, memory and network in/out are readings of a
running process, so a stopped server shows an em-dash for each rather than a zero nobody measured;
**disk is shown for every server**, running or not, because the space an instance occupies is a
property of its files and the backend measures it either way (`Server.diskBytes`, kgsm-api 0.97.0).
The row wraps rather than compressing, so the narrowest card keeps every figure legible.

The numbers stay live off a new `servers/metrics` subscription — one frame for the whole roster,
shared and ref-counted across every mounted card (`lib/hooks/useRosterMetrics.js`). The `servers`
topic carries status and roster only, by design, so a card reading its CPU from there showed whatever
figure the last *status* change happened to carry. One subscription and not one per card because a
resource-scoped topic opens its own SSE connection: a grid of twelve would have opened twelve.

### Added — an Arch package

`packaging/PKGBUILD` installs the built bundle to `/usr/share/kgsm-web`, its own package rather than
part of `kgsm-api`. The panel now upgrades without rebuilding the API, this repo's version means what
it says, and a node runs the API headless by simply not installing this. `pkgver()` reads
`deploy/version.sh`.

### Added — one machine-readable version, read rather than restated

`deploy/version.sh` prints this project's version from the single file that declares it, and
`--pkgver` prints the form pacman accepts (a `pkgver` may not contain a hyphen; ordering survives it,
since `vercmp` puts `3.16.0rc3` before `3.16.0`). Packaging asks for a version instead of carrying a
copy that can fall behind the binary.

### Added — the host requirements are declared

`deploy/kgsm-web.requires.json` records that this project installs nothing that executes, that
`kgsm-api` serves the bundle, and that its web root must be pointable at `/usr/share/kgsm-web` so
the two never contend for the same files.

### Added — a long run says what step it is on, and the backup verbs read as busy

An updating server said "Updating…" and nothing else for the whole of a download that can run twenty
minutes; an installing one has always shown its phase. The engine emits the same phases for both
(kgsm 3.15.0-rc1), so the pill now names the step — Downloading…, Deploying… — wherever a run reports
one. `serverStatusLabel` (`lib/servers.js`) is the single place that decides, so the tile, the hero
and the console pill cannot word it differently, and a phase is only ever shown for a LIVE job.

`backup_create` and `backup_restore` join the verb→state map: the engine brackets both now, so an
archive being written by the scheduler or the CLI shows as **Backing up…** / **Restoring…** instead of
a plain "Online" that invites somebody to restart the server out from under it.

### Fixed

- **The live console keeps the newest 1000 lines and drops the rest.** The feed follows for as long
  as the panel is open, so a chatty server built a scrollback with no ceiling — every arriving line
  re-rendered the whole of it, and a tab left open on a busy instance ended up rendering tens of
  thousands of rows. The buffer is a window now: oldest out as newest come in, scrollback first, and
  a dropped line's sequence number leaves the dedup set with it so that stays bounded too.
  - Rows are keyed on the line's own identity — the console bridge's `seq`, or journald's cursor for
    host logs — instead of the array index. A capped window shifts every index by one when it drops a
    line, and keyed on the index a single arriving line rewrote the text of all thousand rows.
  - The auto-tail follows the newest line's identity, not the row count. A full window is exactly
    1000 rows forever, so a tail watching the count alone stops scrolling the moment the cap is
    reached and the view drifts behind the feed as wrapped lines rotate through it.
  - The shell's per-server console accumulator is gone. It subscribed to a topic the API does not
    publish and fed a merge the console panel never reads, so it rendered nothing while holding every
    line it was handed and re-rendering the whole app for each one.
- **A chat left in the background no longer comes back stuck on "the assistant is typing".** A turn's
  POST that was open when the surface was frozen is dead whether or not its promise ever settles —
  and while the code believed it was open, three things stayed wrong at once: `busy` never cleared,
  the transcript refetch was gated off *behind* `busy`, and the event stream's frames kept being
  skipped as this surface's own. The result was a permanent typing indicator over a turn that had
  finished minutes earlier, which is exactly the state somebody returns to after acting on a push
  notification. Returning to the foreground now lets that POST go and re-reads: a turn is a session
  at the leaf, so one genuinely still running is restated by the stream's next attach.
  - A lifecycle drop is told apart from the Stop button, which is the same `AbortError` and means the
    opposite thing. Stop writes "Stopped" into the transcript; this writes nothing at all, because the
    surface does not know what the turn did and the leaf's record is about to say.
- **The service worker draws an outcome notification without buttons.** The leaf reports a confirmed
  action's verdict as its own push, carrying no handles — offering Confirm on a finished backup would
  be offering to run it twice.

### Fixed

- **A conversation load renders the proposals still awaiting you**, so arriving from the assistant's
  push notification — or just reloading — offers the button rather than a message saying something
  was staged. The leaf reports them on `GET /conversations/{id}`; `scaffoldConversation` appends them
  after the transcript. The card is built by one function (`proposalMessage`) shared with the live
  `command.proposed` reducer, because a restated proposal that looked even slightly different from a
  live one would be a second answer to "what is this action" — shown to the surface with the least
  context around it. The review surface keeps `scaffoldHistory`: somebody else's conversation, read
  only, must never render a live button.

### Fixed

- **The standalone assistant's notification toggle was permanently disabled**, under a notice saying
  the assistant couldn't be reached. `assistant/push.js` addressed the leaf by `window.location.origin`
  where every other call on that surface uses `SELF`. The id is a key into the session store — the
  origin resolver is what turns it into an address — so it resolved to the right URL carrying no
  bearer, and the client's `authError()` (401) read as the host being down.
  - `SELF` moves to `assistant/self.js`. Keeping it in `App.jsx` would have closed a cycle
    `App → SettingsPage → push → App`.
  - The failure notice now reports what actually happened rather than collapsing every error into
    "couldn't reach". A lapsed session and a host that is genuinely down produce the same silence,
    and telling somebody to check the network when they need to sign in again is a wrong answer, not
    a vague one.

### Added

- **The standalone assistant can notify this device about an action waiting on you.** Settings →
  Notifications is a real switch now: it registers this browser with the leaf, which pushes a staged
  action — with Confirm and Cancel on the notification — once you have closed the chat. Per device,
  because that is what a push subscription is. `public-assistant/assistant-sw.js` gains the `push`
  and `notificationclick` handlers, including the follow-up notification `userVisibleOnly` requires
  and an honest answer when a button is tapped after the action has expired.
- **`lib/pushBrowser.js`** — the browser half of Web Push (support detection including the iOS
  "install first" case, the permission prompt, acquiring a subscription bound to the right key, and
  giving it up), parameterised by its transport and importing nothing. The panel's `lib/push.js` and
  the assistant's `assistant/push.js` both sit on it; the parameterisation is structural rather than
  stylistic, since a shared module reaching `apiClient` would fail `npm run check:assistant`.

### Added — Quiet hours, on the Notifications card

When not to be woken, and what is worth waking for. Three rows below the event list, because that is
what they narrow: these are the hours in which a "yes" above still means no. Off by default, and the
copy says what will happen rather than naming a severity band — "only urgent" is what somebody picks
between at 11pm, not `danger`.

**The timezone is this browser's and is never shown as a field.** `Intl.DateTimeFormat().resolvedOptions()`
is the one thing the browser knows for certain about where the person is, and a picker would only be a
chance to get it wrong; it rides along on every save. A host that cannot resolve the zone applies
nothing, and the row says so in place of the window rather than reading "on" — claiming an effect the
host cannot have is the failure worth avoiding here.

Per account rather than per device: a person with a phone and a laptop is asleep for both.

### Added — icons for the six new notification events

Settings › Notifications draws its rows from the host's catalog, so `crash_loop`, `player_join`,
`server_empty`, `leaf_down`, `leaf_up`, `restart_soon` and `awaiting_approval` already appeared there — they just fell
back to the generic bell. They now carry their own icons, which is the whole of this change: the list
itself, the toggles, and which events a host offers all come from the API.

The two opt-in events (`player_join`, `server_empty`) arrive switched off host-wide, so they render with
the muted "switched off for this host by an admin" subtitle until somebody enables them on the
integration. That is the existing behaviour for a disabled event, not a new state.

### Added — Monitor › Thresholds

The Monitor leaf gains a Thresholds tab: the lines this host's numbers are watched against, and what it
raises alerts on when they are crossed. It lives on that leaf because kgsm-monitor is what evaluates
them — sample by sample, at its own cadence — and the API only mirrors the verdicts into the alert feed.

Each rule shows its six numbers together, because they only mean anything together: a value crosses
`warn`, holds for the fire dwell, then has to fall a margin below and stay there. "Clears below" is
derived and shown read-only, so somebody setting a margin can see the number they are actually setting.
Every rule also states itself in a sentence, so a policy can be checked without reading six boxes.

Saving sends the whole set, because that is the contract underneath — the monitor validates and applies a
policy as one thing, so a half-applied one is not a state that can exist. What comes back from a refusal
is the monitor's own reason, naming the rule at fault. Reading needs operator on the node, changing needs
admin; the tab says which when you have one and not the other.

### Added — notification buttons

The service worker draws the buttons a push declares and redeems the one that is tapped. Each button
carries an opaque handle and nothing else, so a notification sitting on a lock screen describes no
operation anyone could read or rewrite — what it would do stays on the host. The handle goes back with
this device's own push endpoint, which is what the worker has instead of a session: it can read neither
the access token nor the refresh one.

**A tap always ends in a notification.** `userVisibleOnly` requires one, and a tap answered by silence
is indistinguishable from a tap that did nothing. The sentence shown is the host's own — success and
refusal alike — so the worker never claims an outcome the API did not report. "Asked kgsm to update
factorio-01" is not "factorio-01 is updated", and only the first has happened when the button returns.

The browser reports `Notification.maxActions` when it subscribes, and the host stages buttons only for a
device that says it draws them. Safari renders none on any device, so an iPhone gets the notification
without buttons and taps through to the panel as before. A browser subscribed before this shipped
reports its count the next time this page is opened on it.

### Added — threshold pushes land on the alerts page

The panel's service worker reads two more fields off a push payload. A `tag` names the **subject** the
notification is about, so two conditions on one host no longer overwrite each other on a lock screen — the
worker falls back to its per-server key when a payload does not carry one. An `event` names the catalog
event, which is what the click routes on: a threshold breach or recovery opens `#/alerts` (scoped to the
server when it names one), because that is where the live view of the condition is, while everything else
still opens the server it concerns. The routes stay here rather than in the payload — the panel owns its
own URLs, and a device running an older worker would otherwise follow one that no longer exists.

Notification settings pick up glyphs for the two new catalog events. The list itself is server-driven, so
they appeared there on their own.

### Added

- **A Settings page for the standalone assistant, at `#/settings`.** The surface that is only a chat
  now has somewhere to put a preference: two tabs — **Appearance**, carrying the theme picker, and
  **Notifications**, which is where the answer will go and for now says plainly that the assistant
  sends none and which surface does (`src/assistant/SettingsPage.jsx`). Reached from the foot of the
  conversation rail, or the header cog at phone width where that rail is hidden.
  Built from the Control Panel's own settings furniture — `SubTabs`, `SettingsSection`,
  `SettingsRow`, `ThemePicker` — so the two sites read as one, and the tab lives in the URL
  (`#/settings/notifications`) so Back, refresh and a shared link all land on it. Routing is the
  assistant's own two-screen hash bridge (`src/assistant/route.js`): the panel's router is a cluster
  vocabulary resolved through a per-node policy, and this surface has neither.
- **`kit/page.css`** — the page heading (`.dash-head`) and the sub-tab strip (`.subtabs`), the
  furniture every screen is built from, in a partial both barrels import. It is what lets the
  standalone assistant carry a settings page without also carrying the partials that style servers
  and dashboards.

### Changed

- **The assistant's theme control is the settings page.** The disclosure at the foot of the
  conversation rail, and its copy in the phone-width history popover, are replaced by one entry
  point to a page that shows the picker full size. `ChatPage`'s `showThemePicker` prop is now
  `onOpenSettings`; the panel passes none, since its shell already leads to its own Settings.

### Added

- **A Notifications tab in Settings, with a switch per event.** Every event the host's catalog
  offers — online, offline, crash, updated, update available, installed, backed up — is a toggle
  you own, saved to your account and applied to every device you subscribe
  (`pages/SettingsNotifications.jsx`). Built from the existing settings furniture: the same
  `SubTabs`, `SettingsSection`, `SettingsRow` and `Toggle` the rest of the page uses, so it reads
  as part of the site rather than a new idiom.
  An event an admin has switched off for the whole host renders its switch **inert and says so**,
  rather than letting you turn it on and then hear nothing.
  One card per host, because a subscription is signed by one host's key and the catalog is that
  host's own.

### Changed

- **Push moved from Devices to Notifications.** Turning it on for a device and choosing what it
  carries are one decision, and having them on separate tabs made the second half hard to find.
  Devices goes back to being purely where you are signed in.
- `Toggle` takes an optional `disabled` (and `label`), for a setting that exists but is not yours to
  change. Additive — the five existing call sites are unaffected.

### Added

- **Push notifications, per device, opt-in from Settings → Devices.** Fleet events — crashes,
  updates, backups — now reach a device with the panel closed, delivered by the browser's own push
  service and rendered by the service worker (`public-panel/sw.js` gains `push` and
  `notificationclick`; the client half is `lib/push.js`, the UI is `pages/SettingsPush.jsx`).
  Tapping one opens the panel on the server it concerned, which is the thing a Discord message
  cannot do. **On iPhone this needs the panel installed to the Home Screen** — Safari does not
  deliver push to a tab — so that case reads as "install the app first" rather than "unsupported",
  because it is one step away and not a dead end.
  Subscribing stays behind an explicit button: asking for notification permission on load is how a
  browser learns to refuse permanently, and a denied permission cannot be re-prompted. A
  subscription belongs to ONE host (it is signed by that host's key), so the section asks per node
  rather than implying a cluster-wide switch.

### Added

- **A refused action says why, instead of nothing at all.** Pressing Start on a server the backend
  turns down used to flicker the tile to "Starting", snap it back to Offline, and discard the
  reason — and the reasons are the ones worth having: a port clash, a bad config, or the common
  "a command is already in flight for this server". The lifecycle and install handlers in the shell
  own no control to render an error into, which is why they were the only paths that swallowed;
  they now raise a toast carrying the backend's own sentence and its error code
  (`lib/toasts.js`, `components/Toasts.jsx`). Errors stay on screen until dismissed, repeats inside
  a five-second window fold into one card with a count, and hovering pauses the timer. The write
  paths that already render an error beside the control that failed are untouched — that is the
  better place for it.

- **A Notifications entry in the sidebar keeps what the toasts said.** A message that vanishes
  before it is read is barely better than none, so every toast also lands in a list above the
  account row (`components/NotificationsPanel.jsx`): the reason, the code, how long ago, an unread
  badge, and a click through to the server it concerned. Held per-browser (newest 50, 7 days), and
  deliberately not server-side — kgsm-api writes its audit row from the engine echo, so a command
  it refuses up front never produces one, and these refusals exist nowhere else. The audit log
  stays the authority for what happened to the fleet, and this list does not link to it, because
  none of these rows are in there.

- **"Ready to play" is its own row in the activity feed.** kgsm-api emits `server.ready` for the
  moment a game finishes loading and will accept a connection, which is not what `server.start`
  reports — that one says the process spawned, and on a big world the two are minutes apart. Labelled
  and iconed alongside the rest of the `server.*` vocabulary, on the audit page and in the chat card
  that renders raw engine events.

- **The dashboard's Servers and Catalog cards reach every entry, on a scroll-snapped rail.**
  Both cards rendered only what fitted one row and dropped the rest — 4 of 6 servers and 6 of 32
  blueprints on this host. They are now horizontal shelves (`components/Rail.jsx`,
  `styles/kit/rail.css`): a real scroll container, so a swipe on touch is native scrolling with no
  swipe-vs-tap ambiguity against cards that are themselves click targets, trackpad and shift-wheel
  work, and tabbing to an off-screen card scrolls it into view. Prev/next buttons in the card head
  page by just under a viewport and disable at each end; the next card is always cut off at the
  right edge, which is the primary "there is more" signal, with an edge fade behind it. How many
  cards show is `--rail-per-view` in container query units, so the rail reacts to the sidebar and
  the assistant dock, which change its width without changing the viewport's.
### Changed

- **The dashboard Catalog card is ordered, not shuffled.** It sampled the library at random because
  only one row's worth was ever shown; now that the rail reaches all of it, the uninstalled
  blueprints come first (they are the actionable ones) and each half is alphabetical, which is
  what makes a game findable in a rail of 32. The Servers rail keeps the order the card already
  sorted by: favourites, then most-active online, then in transition, then offline.

### Fixed

- **A copy button never claims "Copied" over an empty clipboard.** Both call sites (the server's
  connect address, the leaf-config env line) wrapped `navigator.clipboard.writeText` in a
  `try`/`catch` and then reported success unconditionally — but that call returns a **promise**, so
  the catch saw none of the ways a browser refuses it, and `navigator.clipboard` is undefined
  outside a secure context, which reaching the panel over plain http on a LAN address is enough to
  trigger. Copying now goes through `lib/clipboard.js`, which falls back to a selection copy when
  the async API is missing (so the LAN case now genuinely copies) and resolves false when neither
  path worked, at which point the button says the copy was blocked and shows the address to read
  instead.

- **A horizontal swipe on a dashboard card no longer also opens the nav drawer.** The drawer gesture
  arms anywhere within 28px of the viewport edge, and a rail's leftmost card sits inside that zone.
  A touch starting in a rail is left to the rail.

- **A server being installed keeps showing its install until the install is over.** kgsm writes an
  instance's config before it downloads a byte, so the engine publishes the instance — measured
  `stopped`, with the install still running — around a minute into a multi-minute download. The tile
  read that frame as the handover and became an ordinary card reading "Offline" about a server that
  did not exist yet, for the rest of the download; a reload landed on the same state. A tile is now a
  phantom for exactly as long as the row's own job says an install is running, wherever the row came
  from — a stream frame, a REST re-hydrate, or a browser that opened the panel halfway through
  someone else's install — and the phase (Preparing / Downloading / Deploying) keeps rendering
  throughout. The handover is the verify frame that follows the install settling, which is the frame
  carrying the finished server, so a card never flips to a completed install the backend has not
  described. A failed install holds its "Failed" tile until dismissed instead of being overwritten.

- **Only the assistant leaf refusing a refresh token ends that session.** The rotate discarded the
  thirty-day credential on every failure, so a dropped packet or a leaf mid-restart cost a sign-in
  that nothing had actually invalidated. A request that never completed, a 5xx and an answer with no
  token in it all leave the credential where it is and the host `bootstrapping`, which the next call
  spends; only a 401 or a 400 is terminal.

- **Two browser tabs no longer sign each other out of the assistant.** The refresh token is shared
  by every tab on the origin while the in-flight dedupe is per-tab, so two tabs waking together
  present the same token and the leaf rotates it for whichever arrives first — correctly refusing
  the second, which then cleared the credential the first had just won. A refusal re-reads storage
  and retries once against what is there now, so the tab that lost picks up the token that won.

- **A lapsed assistant token is rotated before the call, not spent on a 401 first.** The chat's
  opening reads went out with whatever access token the tab held; fifteen minutes after the last
  one was minted that is a token the leaf was always going to refuse, so opening the dock produced a
  pair of 401s that then healed. A token whose own `exp` has passed is treated as no token, which
  spends the same rotation without the round trip that could not have succeeded. An unreadable `exp`
  says nothing and is still healed reactively.

- **Opening the chat no longer asks the leaf to point a stream that is not open yet.** An attach
  names the stream it is re-pointing with `X-Assistant-Origin`, and a surface has no name until the
  leaf's `hello` frame gives it one — so the attach that fires when the dock opens carried no header
  and the leaf refused it, once per open and once per reconnect gap. The conversation on screen is
  attached by the stream's own open handler, which reads it from the ref it is already kept in; the
  re-point call is for a stream that is running.

- **The panel no longer claims to have checked for updates at the moment one was applied.** A
  finished update optimistically stamped `update_checked_at` with the browser's clock, so a server
  read "Checked just now" when the last real upstream fetch may have been an hour earlier — a
  fabricated freshness for a number whose whole job is to say how stale the answer is. The
  optimistic patch clears the update chip and nothing else; the honest timestamp arrives on the
  verify `server.patch` that follows.

### Added

- **The alert feed knows the `engine` source.** kgsm-api raises an `info` alert while a server has a
  game update waiting (`update:<serverId>`), and it resolves when the update is applied — so an
  available update reaches Needs Attention, the Alerts page and the server's contextual alerts, not
  only the update chip. It takes the `circle-arrow-up` glyph the audit log already gives
  `server.update_available`, so the condition and the event that produced it read as one thing.

- **Themes can change the panel's SHAPE, not just its colours.** A closed set of structural tokens —
  the radius ladder, the border shorthands, elevation, focus, the UI type family and the motion
  durations — is re-valuable by a theme; the type scale, the spacing scale and the layout metrics
  are not, because a palette must not be able to move where anything stands. The permitted set is
  named in `tokens.css`'s structural banner.

  **Only the tribute pack uses it.** A theme named after an upstream editor scheme re-values colour
  and nothing else: Nord and Solarized were syntax palettes and never had an opinion about a corner
  or a button. A tribute is quoting a whole interface, so the shape is part of the quotation. All
  eight now carry one: The Matrix, DOS Blue, the Commodore 64 and PICO-8 go square with a monospace
  UI; Windows 95, DOS Blue and the C64 set every duration to `0ms`, because nothing on those screens
  eased; Winamp and Cyberpunk 2077 trade blurred elevation for hard offset shadows; and LCARS
  triples the radius ladder, since the elbow is the design language rather than decoration on it.
  A `THEME_OPTS` entry declares this with a `shape:` field saying in words what changes, since a
  swatch cannot show a duration — though the picker's miniatures do now preview the geometry,
  being built from the same tokens.

  Windows 95's bevel is the one thing quoted at half strength: a raised 3D edge needs four different
  border colours and the `border` shorthand carries one, so it ships a 2px flat edge rather than a
  fake of the whole.

- **`npm run check:tokens`** fails the moment a stylesheet reads a custom property that nothing
  defines. CSS gives no warning for that on its own — the declaration goes
  invalid-at-computed-value-time, so `border-color: var(--typo)` silently becomes `currentColor` and
  `border-radius: var(--typo)` silently becomes `0`, permanently and invisibly.

### Fixed

- **Twenty-five references to custom properties that were never defined**, found by the new check
  and left over from an older naming convention. `--border-1`/`--border-2` (14 uses across the hosts
  and leaf surfaces) were drawing their borders in `currentColor` and one divider in nothing at all;
  `--radius-sm`/`--radius-md`/`--radius-lg` (8 uses in the chat and hosts surfaces) were rendering
  square corners by accident; and `--accent`, `--border`, `--fg-muted`, `--motion-fast`,
  `--shadow-lg`, `--surface-4` and `--warn-fg` each missed in the chat surface both surfaces share —
  the three `--motion-fast` reads meant the cluster-status control had no transition at all.

- **The sidebar wordmark holds one line** whatever UI face a theme sets. The rail is a fixed 240px
  and the monospace tributes pushed "Krystal Ship" past what the sans fits, wrapping the brand to
  two lines and shunting the rail down with it.

### Changed

- **A surface's border is one token, and radii go through `--r-*`.** `--edge`/`--edge-strong`/
  `--edge-accent` hold the whole shorthand across ~180 call sites, because elevation here is drawn
  with borders rather than shadows and a theme needs the width and style, not just the colour. A
  one-sided `border-top`/`border-bottom` keeps the longhand: that is a divider, and it stays a
  hairline in every theme so a thick-edged palette does not also thicken every table rule. Radius
  literals fold onto `--r-sm` (~260 uses) and `--r-pill` (~150), which is what makes corner geometry
  a one-line change per theme.


- **The bot's overview page reads the leaf's plural guild shape.** A KGSM host announces into any
  number of Discord servers, each set up from inside Discord with `/setup`, so the page leads with
  how many of them the client actually resolved and lists them in their own table: the announcement
  channel, whether per-server channels are on there, and whether the bot still holds the permission
  they need. The attention lane calls out each one separately — an unresolved guild, an announcement
  channel the bot cannot see, a board whose `Manage Channels` was revoked — plus an unreadable guild
  store, which is the single condition under which nothing is announced anywhere while the unit and
  the gateway both read healthy. **No Discord server set up is a deliberate state, not a fault**, and
  is worded as one.

### Added

- **Six light themes, each completing a pair the picker was already half of** — **Gruvbox Light**,
  **Everforest Light**, **Rosé Pine Dawn**, **Tokyo Night Day**, **One Light** and **Ayu Light**.
  The Light group goes from five to eleven, and every dark scheme here that publishes a light sibling
  now has it.

  Each takes the sibling's accent assignment with it, so the two halves stay legible as one scheme:
  gruvbox keeps orange, everforest green, Rosé Pine iris, Tokyo Night blue. Gruvbox's semantic
  colours are its FADED set rather than the dark theme's brights, which is the pairing gruvbox itself
  publishes — the brights are drawn for a dark background. Tokyo Night Day's foreground is blue
  (`#3760bf`) and not a near-black, which is the scheme's own choice and the thing that makes it
  recognisable across a room.

  All six ship their upstream values unretouched, including where those are low-contrast by design:
  Ayu Light's accent orange is a caret-and-focus tint upstream, so as link text it sits at 2.2:1 on
  its own paper. That is the rule for any theme named after an outside scheme, and it is why the
  colour-vision and tribute packs — which this repo authors — are the only ones held to floors.

- **Six more themes.** Four upstream schemes that fill gaps the picker already had — **Solarized
  Dark** and **GitHub Dark**, whose light siblings were shipping alone, plus **Monokai** and **Ayu
  Mirage** — and two more tributes: **Commodore 64** and **PICO-8**.

  Monokai's six accents divide exactly across the five status families with the violet left over,
  which is why the brand here is violet and not the famous pink: pink is Monokai's red, and a
  destructive action must not be painted the same colour as the accent beside it. The two tributes
  hold the tribute pack's measured floors — most of the VIC-II palette is unreadable against its own
  screen blue, so the C64's light red, light blue, purple and cyan are raised along their own hue
  until they clear it, and nothing comes from outside the sixteen.

  Solarized Dark ships Schoonover's accents unretouched, low contrast and all, because its accents
  are tuned to sit at equal weight against both of its backgrounds and raising them would be raising
  them off the thing that makes it Solarized. That is now written down as the rule for every theme
  named after an upstream scheme, and the split between those and the palettes this repo invents —
  which *are* measured — is in `src/styles/CLAUDE.md`.

- **A tribute pack: six themes quoting a screen you have already stared at** — The Matrix, Windows
  95, Winamp's classic skin, LCARS, Cyberpunk 2077 and the DOS blue screen — in their own section
  of the picker, with each swatch's tooltip naming what it is quoting. Every one takes its colours
  from the source it names: the vampire-black-and-phosphor of the film's own production palette, the
  registry defaults for the 3D face and the navy title bar, the base skin's grey chrome and green
  LCD, the LCARS colour names, Night City's yellow-on-black, and the CGA sixteen.

  The five status families are the one thing no source screen is a guide for — nothing in The Matrix
  is red on purpose, LCARS has no green and CGA has no orange — so each theme spends its source
  palette on the families first and says in its own block comment where that forced a deviation,
  rather than reaching for a foreign hue to make the ramp tidy. What that does not cost is
  legibility: text, fills and button ink were measured on the surfaces they actually land on,
  including each `-fg` on its own tint, which is what moved Windows 95's VGA fills one step down
  from their text-mode values (a VGA mid-tone sits under 3:1 on a silver face).

- **A colour-vision pack: twelve themes for viewers who cannot rely on hue**, in their own badged
  section of the picker (a dark/light pair each for deuteranopia, protanopia, tritanopia, the two
  red-green deficiencies together, all three at once, and achromatopsia). The panel signals with
  five colour families and the default palette separates them by hue alone, which is exactly what a
  deficiency takes away: to a deuteranope the green "running" dot and the red "down" dot are the
  same brownish yellow. Each palette is instead **built against a simulation** of the deficiency it
  names (Machado, Oliveira & Fernandes 2009 at severity 1.0) and holds, as that viewer sees it,
  ≥ 12 ΔE2000 between every pair of status colours and ≥ 20 across success/danger/warning — with
  contrast re-checked through the same simulation, since a deficiency moves luminance as well as hue
  and protanopia dims red enough to sink a red fill that passes for a trichromat. Hues come from the
  Okabe–Ito / Wong Color-Universal-Design set and, for the tritan and universal palettes, its
  tritan-safe subset; where hue runs out the separation is carried by lightness, which every
  deficiency leaves intact. The monochrome pair goes further and drops hue entirely, coding status
  as a lightness ladder. Palettes are searched rather than hand-picked — six colours that stay apart
  for a dichromat is not something an eye can place — by
  `/home/heisen/tks/scripts/cvd-check/`, which also re-verifies the shipped tokens.
- **The theme picker is a grid of swatches, grouped Dark and Light**, in place of a dropdown of
  names — **on both surfaces**. Each tile paints itself IN the theme it offers (`tokens.css` keys
  colour off a plain `[data-theme]` attribute, so a tile carrying one resolves that palette's own
  tokens) and draws a miniature of the panel — sidebar, heading, the KPI strip with its status
  lights, a card — rather than bare chips, because what you are choosing is how the app will look,
  and a palette is not one colour: how the rail sits against the canvas and how far a card lifts off
  it are the differences chips cannot show. A retuned palette updates its own swatch, and a new theme
  arrives with a correct one for free. Auto sits above the groups with both halves shown, since it is
  a rule rather than a palette.
- **The standalone assistant carries the same picker**, in a disclosure at the foot of its
  conversation rail (and of the history popover at phone width, where that popover replaces the
  rail). Shut it is one row naming the theme in force — more than the dropdown said, which showed its
  value and nothing about it; open, the grid scrolls inside the rail so the conversation list is
  never pushed off screen. Its styles are their own partial, imported by both surfaces' barrels.
- **Change your own password**, on Settings → Signing in. The endpoint has always been there; nothing
  offered it, so the only way to get a password was to ask an administrator. It asks for the current
  one (a session can be a borrowed laptop) and for the new one twice — a mistyped new password is
  something only the panel can catch, since the backend would accept and store it. Offered only to a
  session established WITH a password: a provider session has none to prove.
- **"Your access" on Settings** — the role you hold on each node you are signed in to, and, when you
  hold none, which of the two reasons it is: waiting on an administrator, or no account here. Every
  other surface answers this only by omitting controls.
- **An account's live sessions inside the admin's edit modal** on the API leaf's Users tab: what that
  person is signed in on, ending one, or signing them out everywhere. The confirmation says that this
  ends sessions and does not disable the account, because an admin reaching for it mid-incident is
  usually reaching for the other one.

### Changed

- **Settings is tabbed** — Profile · Security · Devices, on the same `SubTabs` strip the
  server detail, node deep-dive and leaf pages use, so the page navigates like the rest of the site.
  Stacked as equal cards the four subjects had no hierarchy and the page read as a list of slabs.
  The tab is in the URL (`#/settings/security`), so Back, Forward, refresh and a shared link all land
  on it; `profile` is the default and stays out of the hash, so the plain `#/settings` the sidebar
  produces is the landing tab's canonical address, and an unknown tab falls back to it rather than
  rendering an empty body. Appearance is a section of Profile, not a tab: it holds one preference,
  and a tab with a single control is an empty screen with a heading.
- **The Danger zone card draws like every other card.** Its red left rule and tinted header edge
  were a hairline nothing else on the site has; the heading and its icon already say what the card
  is.
- **`THEME_OPTS` entries carry `mode`** (`dark｜light`, absent on `auto`) — the palette's own
  character, declared rather than guessed from the name, and what the picker groups on.
- **Settings is four cards about you** — You, Your access, Signing in, Devices, plus Appearance —
  and every control on it now does something. The display-name and username inputs are values, not
  fields: `/me` is read-only, so what they offered to save was saved nowhere. "Recent logins" is no
  longer a peer card that reads as a duplicate of the sessions above it; it is a collapsed "Earlier
  sign-ins" lane inside Devices, which is where its difference can be stated — a record of what
  happened, including sessions since ended, with nothing to log out of. The danger zone's duplicate
  "Sign out everywhere" is gone (Devices owns that action); Delete account stays, disabled, with the
  route that works named on the row.
- **Administering another person's sessions moved to the API leaf's Users tab**, into the modal for
  the account it belongs to. It was on the personal settings page behind a box that wanted a raw
  `usr_…` id typed from memory.
- **The sign-in method reads as words everywhere** (`signInMethodLabel`) — a password sign-in said
  "Signed in via local", the internal handle prefix, in the sidebar and the account menu.
- **`connect.js` derives the provider from the returned handle** instead of stamping `discord` on
  every session, which put the wrong mark beside a password user's name and offered them the wrong
  controls.
- **Account administration is a Users tab on the Control Panel API leaf**
  (`#/cluster/<node>/services/api/users`), where kgsm-api's account store is — administered beside
  that service's own logs and configuration. Settings is now about the person reading it: their
  profile, what can sign them in, and the sessions those sign-ins produced. Deciding what everybody
  else may do is a different question about a different subject, and it no longer sits on a page
  answering "who am I". The node is fixed by the leaf page's route, so the host picker is gone; the
  tab needs the administrator role on **that** node and says so plainly when the caller holds a
  lesser one there.
- **The login page draws the sign-in buttons a node reports** (`GET /auth/providers`) instead of one
  hardcoded Discord button. A button is never offered for a provider the host is not wired to, and a
  host wired to one this build predates is still reachable through it — an unrecognised name is
  labelled with itself rather than hidden.
- **Connecting an account takes the provider from the host's own list.** `api.identities().startLink(provider)`
  replaces `startDiscord()`, and each button reports its own progress.
- `providerLabel` moved beside `OAuthIcon` in `host-helpers.jsx`, so the two surfaces that name a
  provider read from one place.

### Added

- **A "Connected accounts" section on Settings** — what can sign you in to a host: your KGSM
  password, and the provider accounts attached to yours. Connect a Discord account, disconnect one,
  each per host because each host keeps its own. Both writes confirm your password first (the panel
  asks before starting rather than after being refused) unless you have just signed in, which is
  itself the confirmation. Disconnecting says what it does before it does it: the sessions that
  account established end with it. The link callback returns to this screen and reports the outcome
  there, because it is the only place that can.

- **An awaiting-approval screen on both surfaces.** Signed in and holding nothing everywhere, the
  panel and the standalone assistant say the one true thing instead of rendering an empty roster
  behind a wall of 403s — and say *which* true thing, since "an administrator has to approve you" and
  "this host has no account for you" are the same `none` tier and opposite advice. The panel's
  re-reads each host's `/me` on demand, because approval happens on somebody else's screen.
- **Approve in one gesture on Settings → Accounts.** People awaiting approval sort to the top, a
  banner counts them, and their row carries an Approve button that sets the account active at viewer —
  what they may do beyond that stays a second, deliberate choice.

### Fixed

- **The standalone assistant's sign-in screen no longer forces a horizontal scrollbar.** Its 24px
  padding sat outside a `width: 100%`, which this stylesheet has no global `border-box` reset to
  absorb.

### Added

- **Sign in with a KGSM password**, on both surfaces. The panel's sign-in screen leads with a
  username and password and keeps Discord below it; the standalone assistant offers the same form on
  its own sign-in screen. Neither redirects — the tokens come back in the response and take the same
  adoption path an OAuth return leg takes, so a host with no Discord application configured is fully
  usable.
- **Settings → Accounts** — the host's KGSM accounts: create, rename, retier, approve, disable,
  delete, and set someone's password. With the account store as the sole authority this is the only
  way anyone's authority on a host ever changes. Scoped to ONE host and never rolled up, because
  accounts are per-host and a merged list would imply an account exists somewhere it does not; the
  section renders nothing at all without a live admin session on some host.
- `api.users(hostId)` on the backend seam, plus root-routed `PATCH`/`DELETE` beside the existing
  `rootGet`/`rootPost`.

### Changed

- **The silent assistant sign-in is not attempted for a KGSM-password session.** It is silent only
  because a browser signed into the panel through Discord has already authorized the same
  application for the leaf; somebody signed in with a password has authorized nothing, so the bounce
  would not be silent and on a host with no Discord application cannot complete at all. Navigating
  the whole page away to discover that is worse than the dock saying it needs a sign-in.
- **The stored identity's provider is read off the id the backend returned** (`provider:subject`)
  rather than assumed to be Discord, so a local account is not labelled as one.

### Added

- **Backups can be deleted.** The third button on a server's Backups tab calls
  `DELETE /servers/{id}/backups/{backupId}` and re-lists. The row disappears because the backend said
  the snapshot is gone, never optimistically ahead of it — a delete that failed has to leave the backup
  visibly still there.

  It is **arm-then-fire**, the same misclick guard the lifecycle buttons use: the trash swaps to a
  check for a few seconds and only a second click sends. There is no undo behind this one, and it is an
  unlabelled icon sitting next to Restore in a dense row, so a single stray click must not be enough.
  Armed, the button fills with the danger tint — with no label, the colour is most of what says the
  next click destroys something.

- **Backups can be downloaded.** The button on a server's Backups tab mints a short-lived ticket from
  kgsm-api and hands the browser the URL it returns, so the archive streams straight to disk with the
  browser's own progress and resume — rather than through `fetch`, which would buffer a multi-GB file
  in memory before the save dialog even appeared. The ticket's URL is resolved against the OWNING
  node's origin: in a cluster the backup lives on one specific node, and pointing the browser at
  whichever node the panel happens to be open from would 404.

  Only a **compressed** backup can be downloaded — an uncompressed one is a directory tree rather than
  a single file, and the backend refuses it — so the button carries that reason instead of offering a
  click that always fails. A backup whose `compressed` flag is missing entirely reads as "we don't
  know", which is treated the same as uncompressed: not offering a download beats offering a broken one.

- **`backup.prune`** renders as *"Backups pruned"* in the audit feed, completing the backup
  vocabulary alongside `backup.delete` (which was mapped ahead of its producer and now has one).
  Scheduled retention pruning previously destroyed backups with no row to show for it. The icon is
  `archive-x`: lucide-react at this version ships no `BrushCleaning`, and an unregistered icon name
  renders an empty box behind nothing but a dev-console warning.

- **`network.upnp.reassert`** renders as *"Router forward restored"* in the audit feed, at the `warn`
  tone the API assigns it, and reads in the chat's change timeline as the router having dropped a
  forward that was put back. It is the row that tells an operator their router discards port mappings
  it accepted while a server is still running — without it the action would fall through the
  forward-compatible unknown-action path and show as a bare identifier.

### Removed

- **`open_ports` from the chat's command vocabulary.** The assistant no longer stages it — an instance's
  ports are opened by the supervisor when it starts and released when it stops — so the Run button and the
  label behind it described an action nothing can propose. The engine's `instance_ports_opened` /
  `_closed` timeline entries stay: those are the audit events, which still fire on every bring-up and
  teardown.


### Added
- **The audit vocabulary covers the actions the backend actually emits.** Sixteen of them had no
  entry, so each rendered as a neutral grey dot carrying its own dotted name — a port opening, a
  router forward, a console command and an admin revoking someone else's session were mutually
  indistinguishable at a glance. The two network pairs are deliberately kept apart (`network.ports.*`
  is the host firewall, `network.upnp.*` is the router's NAT forward: a host can hold one without the
  other), and tone tracks what an action does rather than whether it succeeded, so a door opening
  reads `info` and a door closing reads `warn`. The audit page's category filter gains labels for
  Network, Blueprints, Configuration, Console and Services; an unmapped action still renders, since
  the fallback is the forward-compatibility floor rather than the target.

- **Per-leaf Overview pages for every leaf.** The Services drill-in used to give five of the seven
  leaves the same generic body — the first eight config values — while only the assistant had anything
  to say. Each now answers the question its own leaf is the only source for:
  - **Scheduler** — the whole host's schedule board: restart and backup cadences, a merged "next up"
    lane sorted by when the leaf computed each would fire, and every recorded last-run outcome. Server
    Settings shows one instance's row of this; nothing showed the board.
  - **Watchdog** — the supervision table, built around desired-intent against the kernel's `populated`
    measurement, plus the daemon's own readiness to spawn and each instance's last-transition reason.
  - **Firewall** — the enforcement posture and the rules it owns, grouped by the server they belong to.
    An empty grid is read through the backend's state: under an inactive backend it means every port is
    open, and the page says so rather than painting an all-clear.
  - **Monitor** — sample cadence against real frame age, coverage counted off the newest frame, and the
    configured retention windows against the span each tier measurably holds.
  - **Discord bot** — gateway state and latency, the guild it actually resolved, the instance→channel
    map with per-channel reachability, and the fourteen announcement switches.
  - **Control Panel API** — this node's identity and build, the leaves it reaches, its active sessions
    and its cluster peers.
- **A "Recent activity" lane on the leaf pages whose actions the audit can honestly attribute**
  (watchdog, scheduler, bot, firewall, api), reusing the shared audit row. Attribution is a per-leaf
  predicate, not one field: `origin` names the surface a person acted through, `actor.name` names an
  unattended daemon, and the firewall is identified by the action it applied. The monitor gets no lane
  because it performs no auditable action.
- `fetchHostDetail` — the host DETAIL response (`GET /hosts/{id}`), which carries the firewall
  `network` block the list omits. Nothing was fetching it, so `host.network.open_ports` was always
  empty wherever it was read.

### Fixed
- The host adapter dropped `network.firewall`, so the one field that says how to read the open-ports
  grid never reached the UI. It is carried through now, alongside a new `runtime` identity field.

### Changed
- `useLeafResource` (the shared Overview fetch) takes an optional poll interval. The monitor's
  freshness reading needs it: rendering frame age against a ticking clock while the timestamp behind it
  stayed frozen aged a healthy sampler into a false "stalled" warning within a minute of opening the page.

### Changed — the server hero's control bar follows the theme

The cinematic hero is two zones, and only one of them is a media surface. What sits directly on the
key art — the status pill, the name and its runtime tag, the watchdog note — keeps the dark palette
in every theme, because the artwork is whatever RAWG returns. The control bar does not: it brings
its own almost-opaque `--surface-1`, so it runs on the page's own tokens and reads as a light panel
under a light theme and a dark one under a dark theme, across all nineteen. The token pin moved off
the hero container onto exactly the elements that need it, and the bar's fills — its background,
divider, button hovers and the address pill — are tokens rather than fixed dark alpha.

The art stays full-bleed and un-washed; the scrim eases off at the very bottom, where the bar covers
it, so there is no dark chin under a light bar.

A server with **no key art** gets a dark gradient placeholder rather than the themed one every other
surface uses, since the title and pills over it are fixed light.

The hero's armed "Confirm?" button takes its text from `--canvas`, the same inversion the server
tile's quick actions use.

### Added — slash-command completion in the chat composer

Typing `/` as the first character of a message opens a completion list over the composer, on **both**
surfaces — the Control Panel's dock and the standalone assistant — because it lives in the shared
`src/chat/`. Arrow keys move, Tab completes, Enter takes the highlighted row (running it when it
fully specifies a command, completing it when it still owes a value), Escape dismisses.

The catalog is the **leaf's**, fetched from its own origin and already filtered to the caller's tier,
so nothing here decides who may type what and a command the leaf would refuse never appears. A leaf
that offers no commands turns the whole surface off rather than showing an empty box.

A leading slash that matches no command is an ordinary message and goes to the model — `/opt/kgsm/…`
and a mistyped `/compct` both send as text, so nothing a person types is swallowed.

`/help` and `/tools` render as cards in the transcript, because looking something up is part of what
happened and scrolling back to it is the point.

### Added — a switch line and a thumb are seen on every surface

Flipping Thinking or Auto-run writes its sentence into the transcript of **every** surface on that
conversation, not only the one that flipped it. A toggle sliding over on its own reads as a glitch;
the line is what makes it something that happened, and what it says is that the **next** turn here
will behave differently. Which switch moved is derived by diffing the frame — it states where both
now stand — so the frame keeps the same shape the listing has. A conversation whose value this
surface has not read yet gets no line, since a first read is not somebody moving it.

Thumbs travel the same way: a verdict left on one surface lights on the other, and taking it back
unlights it there too. Applied by turn id, which addresses one bubble wherever it is rendered, so it
lands on a conversation that is not the one on screen as well.

### Changed — Thinking and Auto-run are the conversation's, and the leaf owns them

Both were per-browser localStorage flags sent on every turn. They are now switches the conversation
carries, set through the leaf's `/think` and `/autorun` commands — so the composer's buttons and a
typed command travel one path and cannot disagree, and the button reflects what the leaf answered
rather than what was asked for. The turn body no longer carries either field.

The toggles state what the leaf says, never what this browser remembers. `GET /conversations` carries
both switches on every row, so the call that builds the history rail also re-states what every chat
is set to; the merge lets them **overwrite** a cached value where title and host only fill a gap. The
listing is re-read whenever the surface returns to the foreground (`focus`, `visibilitychange`) —
which is the ordinary case for an installed app on a phone, sitting backgrounded while the panel is
the surface being used. A conversation started on one and picked up on the other shows the switches
the next turn will actually run on.

"New chat" mints the conversation at the leaf, so a chat opened here is visible from another device
before anything is said in it. Typing `/new` does the same thing by the same path: the leaf answers
which conversation now stands and the composer follows it there — a row in the rail, switched to and
focused. The client branches on the result naming a conversation, not on the command being `/new`.

### Added — a turn is watchable from every surface, live

A turn typed on one surface streams into every other surface looking at that conversation, token by
token, through the same render path a first-hand turn takes. `busy` stops being a property of this
browser and becomes a property of the conversation: the composer says a turn is running whoever asked
for it, Stop is enabled on a surface that is only watching, and pressing it ends the turn for everyone.

Stop is a call to the leaf now, not an abort of a local connection — a watcher holds no connection to
abort, and ending a turn has to end it for all of them. The partial reply survives it.

Sending while a turn runs queues the prompt instead of racing it. Queued prompts show as chips on the
composer bar with a discard on each, on every attached surface; stopping the running turn deliberately
leaves them standing.

The chat tells the leaf which conversation it is looking at (`POST /events/attach`) and re-attaches when
you switch chats, so token-rate frames only reach the surface rendering them. A surface arriving mid-turn
gets `turn.attach` — the whole state so far — and renders it, rather than waiting for a delta it cannot
place. `scaffoldLiveTurn` replaces the live turn wholesale from that snapshot rather than merging into
what was already drawn, because reconciling two partial views is how a doubled sentence gets in.

The surface that sent the turn skips the event stream's copy of its own frames while its POST is open,
and takes over from the stream if that connection drops.

### Changed — a transcript is refetched because it grew, not because a stream reconnected

The conversation listing's turn count is what marks a transcript behind. Refetching on every reconnect
meant refetching on every proxy timeout, and each refetch drops the rows only this browser holds — the
switch notices, the connectivity notes. A conversation this surface mirrored live is not marked behind
at all: it already holds what the turn produced.

### Added — two surfaces on one conversation stay in step, live

The chat holds the leaf's `GET /events` open (`useConversationStream`) and applies what arrives, so a
switch flipped in the Control Panel moves in the installed app while you watch, a `/new` started on
one appears in the other's rail, and a deleted chat leaves both. The foreground re-read stays as the
backstop for a stream that is down.

A switch frame carries the values and is applied directly; everything else names a conversation, which
is answered by re-reading — the transcript keeps one way to be obtained. A turn made elsewhere
therefore appears when its conversation is next read rather than streaming in token by token.

The surface skips its own echoes. `assistantClient` records the stream id the leaf hands out and sends
it on every call as `X-Assistant-Origin`; without that, the surface that sent a turn would re-fetch the
transcript it had just streamed and tear out the bubble it wrote. A refetch is also deferred while a
turn is streaming here, for the same reason.

Reconnection is exponential and capped, and every reconnection re-reads the listing: nothing is
buffered while a stream is down, so the re-read is what closes the gap.

### Fixed — the smoke read the command manifest's retired flat list

`smoke-live.mjs` reached into `commands` on the bot's manifest, which the gate-keyed shape does not
carry, and crashed the whole run before the checks after it. It reads every gate's bucket now, and
asserts the tab groups by them.

### Changed — the leaf Commands tab reads the gate-keyed manifest

`LeafCommands` groups by the gate that admits each command rather than splitting read/act across one
leaf-wide gate, states what each tier means, and renders the `chat` surface alongside `discord`. An
option offering a fixed set shows the set (`/think [on|off]`) instead of its parameter name.

### Fixed — the server tile's quick actions are three equal buttons, and the confirm state is legible

The three lifecycle buttons on a server tile now occupy exactly a third of the row each, whatever
their label says. The row is a grid of equal tracks (`minmax(0, 1fr)`) instead of three flex items:
a flex item's automatic minimum is its min-content width, so the widest label — "Shutdown", and
"Confirm?" once a button armed — grew its own button and squeezed the other two. The label
truncates inside its track rather than widening it, and the icon and spinner keep their size.

The stop verb reads **Stop** on every surface, which is what fits a third of a tile.

Arming a button (Restart/Stop, the confirm-first misclick guard) left it unreadable: the armed pill
fills with `--fg-1` and the hover rule that follows it in the cascade repainted the text back to
`--fg-1` too — white on white, in exactly the state where the pointer is by definition over the
button. Hover now leaves the armed and pending buttons alone. The armed text is the canvas colour
rather than `--fg-inverse`, which is the text colour for the teal/accent surfaces and stays dark in
a light theme — there the same pill was dark-on-dark.

### Changed — the dashboard's Catalog row is a random sample

The row only ever had space for one line of cards, and the catalog carries no date to rank by, so
the same handful of games sat there on every visit while the rest of the library was never seen
from the dashboard. The row now draws its cards in random order, dealing a different selection each
time the dashboard is opened.

The order is a pure function of a per-mount seed and each entry's id, so a catalog refresh or a
window resize keeps the cards exactly where they are — only a fresh visit reshuffles. The Library
page is untouched and still renders the catalog in its own order.

### Fixed — the assistant leaf's review tabs blamed the assistant for a Discord outage

Both review tabs — Overview and Conversations — treated every rejected request as one failure and
said the assistant hadn't answered. When the leaf's admin gate can't reach Discord to check which
roles you hold, that message points at a service that is running perfectly and at permissions that
haven't changed.

The leaf now reports that case apart, as `502` with an `authority_unavailable` envelope, and the tabs
keep the distinction: an outage says *"Couldn't check your access"*, names Discord as the upstream
that didn't answer, states plainly that permissions have not changed, and offers a retry — which is
what usually resolves it. A real denial says the review surface needs the administrator role. Only a
genuinely unexplained failure still gets the generic message.

The classifier and both states live in `pages/leaf/reviewAuthority.jsx`, shared by the two tabs so
they cannot describe the same failure two different ways. The envelope code is what's checked, not
the status alone: a reverse proxy fronting a leaf that really is down also answers `502`, with no
body behind it, and that case genuinely is "the assistant isn't answering".

### Fixed — the blueprint editor showed one line of the file in Firefox

`@monaco-editor/react` wraps the editor in a `<section style="height:100%">`, and that
percentage only resolves against a **definite** containing block. The blueprint card gave it a
height from `flex: 1`, which is not one, so the section fell back to its own content height —
5px, one line of YAML — and the rest of the file was unreachable. Chrome resolves the percentage
against the flex-derived height regardless, so the same build renders correctly there: the defect
was invisible in one engine and total in the other.

`.bp-editor__monaco-wrap` is now a grid stating its single row as `minmax(0, 1fr)`, a track that
sizes definitely. That is the mechanism the new-blueprint page already used, so its
`.bp-create` override is gone — the shared rule covers both mounts, and the two editors can no
longer disagree about how they get their height. Measured in both engines after the change:
389px/18 lines on the game page's File tab, 777px/37 lines on the create page.

The file browser's editor uses the same `flex: 1` construct but is **not** affected and is
unchanged: its `.fb-card` fills the modal from a grid track, so the definite height it needs is
already there in its ancestor chain.

### Added — the game detail page is four tabs, and answers where a blueprint can run

`#/library/<id>` carries a tab like the server page does — `#/library/<id>/<blueprint|servers|file>`,
overview omitted from the URL. Overview is what the game is and whether the fleet has room for it;
Blueprint is everything the blueprint declares, structured and read-only; Servers is the instances
running from it; File is the `.bp.yaml` in Monaco, offered only to an operator who can read it on a
node that carries the blueprint.

The new **"Where this can run"** card ranks every offering node through `lib/placement.js` — the same
module the install modal preselects with, so the page and the modal cannot disagree — and shows the
measurement behind each verdict rather than the verdict alone: *"Fits — 14.1 GB RAM free of 8 GB
wanted · 627.2 GB free on / for a 15 GB install."* A node with nothing to compare reads `fit unknown`
and is untoned; the "Nodes with room" tile shows an em dash rather than "0 of 3" when nothing measured.

The Blueprint tab surfaces what the catalog DTO already served and the page threw away: **every** port
range on both protocols (7 Days to Die declares 26900–26903 on TCP *and* UDP — the page used to render
`ports[0].start` and call it "26900"), the Steam server and client app ids, whether a Steam account is
required, and the RAWG slug. `clientSteamAppId` and `isSteamAccountRequired` are now plumbed through
`adaptLibraryEntry`.

### Fixed — three defects on the game detail page

- The "Query port" row rendered the literal text `—`: it was a bare JSX string attribute, and JSX
  does not process escape sequences in those. The row had no source to begin with and is gone.
- "Config file" sat under *Blueprint defaults* while reading `instances[0].config.file` — one arbitrary
  instance's path presented as a property of the template. Gone with the card.
- The blueprint editor card supplies its own flex context (`.bp-briefcard`) instead of borrowing one
  from `.dash-feed`. That band is a two-up grid, so the editor had been rendering at half width as an
  orphaned third cell; standing alone on the File tab it would otherwise mount Monaco into a
  zero-height box.

### Changed — an audit entry from a leaf wears that leaf's own icon

Every autonomous row in the audit feed used one bot glyph, so the watchdog restarting a crashed
server, the scheduler taking a backup and this api noticing an update were visually the same author.
`AuditActor` now resolves an actor whose name is a leaf id to the icon `lib/leaves.js` already gives
that leaf on the Services board — shield, calendar-clock, server-cog — so one glyph means one service
on every surface. Anything else autonomous is a generic cog rather than the bot glyph, which now
belongs to the Discord bot leaf alone.

A `discord` provider is excluded before the name is examined, so a person who happens to be called
`monitor` is still drawn as a person. The actor's *kind* deliberately is not part of the test: a leaf
that stamps a bare name reaches the frontend as `kind:"user"`/`provider:"system"` (the engine's
OS-user fallback), and those rows are in the journal for good. `parseAuditActor` (the chat surface's
mirror of the api's parser) now carries `provider` for the same reason — it is the axis that
separates a real Discord identity from every other name.

### Fixed — a sortable column orders by its VALUE, not by the text in the cell

Every sortable table shares one comparator (`lib/sorting.js`), and it takes three kinds of value:
a `Date` (compared as the instant it names), a number, and everything else (case-insensitive,
digit-aware). Anything absent — `null`, `""`, an unparseable date, a non-finite number — is
**missing**, and a missing row sits at the bottom in **both** directions rather than being read as
a zero.

Two columns were ordered by neither rule. The assistant leaf's **Last seen** / **Last** columns
handed the comparator a `Date`, which fell through to the string branch and ordered the tables by
the weekday name `Date#toString` leads with — a roster reading `30d ago, 1d ago, 40d ago, …, 5h
ago`. And every duration column (**Median**, **Slowest**) flattened an unmeasured figure to `0`,
seating a tool nothing ever timed at the fast end of the column, which is the one place a reader
would take it for a measurement. The **First seen** / **Last seen** columns of a server's player
roster compared raw timestamp text, which agrees with the instant only while every row is written
with identical precision and offset.

The sort glyph now carries the direction: a column that is not sorted draws neither arrow. A
column whose cells mix units ("27.0 s" above "878 ms") is unreadable without knowing which way it
runs.

### Changed — the assistant's mark is the badge from the chat, replicated exactly

The standalone assistant is identified by one drawing, and it is the one already on screen:
`.chat-empty__logo`, the badge at the head of an empty conversation — lucide `bot` in
`--krystal-teal` on a `--krystal-teal-dim` fill over `--canvas`, the glyph 26/56 of the frame with
the `1.7` stroke every `<Icon>` renders, and the tile square to the edge. It is the browser-tab
favicon (as SVG, so it is crisp at any OS scale, with a 32px PNG behind it for browsers that take no
SVG icon), the `any`/`maskable` PWA icons Android installs, the apple-touch icons iOS puts on the
home screen, and the mark centred in all 13 iOS launch images.

The service worker's cache version moves with it, so an already-installed app picks the new artwork
up on its next online load rather than serving the icons it cached.

### Added
- **A server being restarted reads as `Restarting…`** for the whole bounce, instead of staying
  `Online` until it comes back. It is the third and last of the long lifecycle verbs to get a state of
  its own, and it arrives the same way the other two do — from the in-flight job the backend carries
  on the server — so it covers a restart started from the CLI or the assistant just as well as one
  clicked here, and survives a reload mid-run. Start, Update and Shutdown stay shut while it lands,
  and the connect surface says `Restarting…` rather than offering Play or claiming Offline.

### Fixed — two smoke assertions asserted the host, not the SPA

The live smoke demanded a MAC from every network interface, which a layer-3 tunnel (the host's
wireguard link) has none of — sysfs `address` is empty there, so the monitor's `null` is the
measurement. It now asserts the field is genuinely read and that every value is a well-formed
address or an honest null, which is what a fabricated placeholder would fail. The other demanded
that an idle socket-activated leaf render "nothing to record", which only holds while nobody wakes
it: the firewall daemon has real samples from the seconds it ran, and drew its charts instead. That
check now reads the window first and asserts the branch the data selects, keeping the half that
holds either way — a resting leaf never reads as stopped.

### Fixed — "Last backup" and the crash window are measured against wall-clock

The server overview's backup KPI and the dashboard's oldest-backup and 24h-crash KPIs took "now"
from the timestamp of the newest audit event, falling back to the clock only while the audit store
was still empty. On a quiet host that subtracted the whole idle gap from every duration: a backup
taken at 02:31 read as "1h ago" at 07:47 because the last event on the box was at 04:00, and the
value visibly changed from right to wrong as the audit fetch landed. Backup age and a crash's place
in the last 24 hours are facts about the world, so both surfaces now read the clock, and the
dashboard carries the same 30s tick the overview already had so the durations stay live.

### Added — the standalone assistant carries the theme picker

Every theme the Control Panel offers is selectable on the assistant too, from a control at the foot
of the conversation rail — and, at phone width where the rail is replaced by the history popover,
at the foot of that popover. It is the same preference (`krystal:theme`, one value per device) and
the same list, which now lives in `lib/theme.js` beside the ids it validates, so a theme added to
`tokens.css` reaches both surfaces with no second edit. The panel keeps its picker in
Settings → Account and shows no second one in the chat.

### Changed — the standalone assistant is full-bleed, and the panes meet on a divider

The chat is the whole window there, so it is laid out as chrome rather than as a card on a canvas:
the conversation rail sits against the left edge of the screen instead of floating in from a
centred column, and the frame around the conversation is replaced by a single divider drawn down
the rail's right edge. A wide screen loses nothing — the thread carries its own 760px measure, so
the extra width becomes margin around the text rather than longer lines. The panel's chat, which
genuinely is a card inside a shell, is unchanged.

### Fixed — the conversation rail shows the conversations the leaf holds

The rail rendered only what this browser had in localStorage, so a conversation started on another
device — or on this one before its storage was cleared — was invisible on desktop while the mobile
history popover listed it in full. The popover's `onOpen` was the only thing that ever fetched the
leaf's list. It is now fetched as soon as there is a session to fetch it with, once per host, so
both affordances read the same history.

### Changed — the chat's connection pill appears only when it has something to say

A reachable, healthy leaf is the state the whole page already demonstrates, so a permanent
"Connected" in the rail foot was decoration. It renders for `warn`, `danger` and `muted` — degraded,
unavailable, or no node chosen — where it names the state and the node it means. The standalone
assistant is always online by construction, so it never shows one.

### Changed — the composer names a node only when there is a choice of them

The placeholder read "Message Assistant's assistant…" on the standalone surface, which addresses
one leaf and was restating its own name back at itself. It names the node where the surface carries
a host picker — the panel, where "Message hotrod's assistant…" says which of several you are
talking to — and is otherwise "Message the assistant…".

### Fixed — the chat fills the screen on a phone

The composer sits at the bottom of the viewport on mobile, on both surfaces. Two separate causes:

- **The mobile grid declared two rows for one item.** `.chat-rail` is `display: none` below 768px
  (its job is done by the in-header new-chat + history popover), and a `display: none` child
  generates no grid item at all — so `.chat-main` was auto-placed in the `auto` track, sized to its
  content, and the `1fr` track below it was empty. That leftover was the dead space, and it grew
  with the viewport: 23px on an iPhone 13, **274px on a Galaxy S25 Ultra**. The track is now `1fr`,
  which is what the docked chat has always used for the same rail-hidden layout.
- **`.chat-page`'s mobile height subtracts a top bar and a content-area inset** that the standalone
  surface has neither of; being the later rule at equal specificity it beat `.chat-page--solo`. The
  solo surface restates its own height inside the mobile query, and drops its 14px inset there — at
  phone width that gutter read as a frame drawn around the conversation.

### Added — the standalone assistant installs as its own app

The assistant surface is a PWA on the same terms the Control Panel is: Android Chrome offers
**Install app**, and it runs standalone and full-screen from the home screen. The two install as
**two separate apps** — two origins, two manifests — so the artwork has to tell them apart at a
glance while still reading as one product.

- **`public-assistant/`** carries the surface's own half: `assistant.webmanifest`,
  `assistant-sw.js`, 192/512/maskable icons, three Safari home-screen icons and 13 iOS launch
  images. `assistant.html` links them and `src/assistant/main.jsx` registers the worker;
  `registerServiceWorker(script)` now takes the surface's own worker.
- **The artwork is derived, not drawn twice.** `scripts/make-assistant-icons.mjs` composes it from
  the panel's mark plus the `bot` badge the chat already uses for its replies, so the family
  resemblance survives a change to the mark. It is an authoring tool — no build runs it.
- ⚠ **The assistant's service worker ALLOWLISTS what it may cache**, where the panel's denies
  `/api/` and `/auth/`. The leaf answers on unprefixed root paths (`/turn`, `/conversations`,
  `/tools`, `/health`), so a denylist would cache every route the leaf grows until someone
  remembered to add it — and a stale authenticated `200` masks token expiry and can serve one
  person's conversation from another's cache. Only the shell and the static asset directories are
  ever intercepted.
- **`npm run check:assistant`** now also fails when the manifest, the worker or any icon they name
  is missing from the build — the overlay not running would otherwise be silent.

### Changed — `public/` is the shared floor; each surface owns its own half

`public/` is copied into both bundles, which is right for the fonts and the brand mark and wrong for
anything describing one app. The panel's manifest, worker, icons and launch images moved to
**`public-panel/`**, and `scripts/public-overlay.js` lays each surface's directory over its own
build output (and serves it in dev). Shared-by-default is preserved: a new shared asset needs no
edit, and only a difference is declared. The panel's `dist/` is unchanged file for file; the
assistant's no longer ships the Control Panel's manifest, worker and artwork.

### Added — the standalone assistant SPA, on the shared chat

This repo now builds **two** surfaces from one source tree: the Control Panel, and the standalone
assistant the kgsm-assistant leaf serves at its own origin. The conversation is the **same code** in
both (`src/chat/`) — a divergence between the dock and the standalone page would be a bug, not a
variant, so there is nowhere for one to drift from the other.

- **The seam is `ChatPage`'s props.** Everything that is true of the surface rather than of the
  conversation is injected, with defaults describing the smaller surface: the connection badge, the
  tier capabilities, the server roster, admin review, the briefing panel, the host picker, and node
  attribution on evidence rows. `src/pages/ChatPage.jsx` is now a thin wrapper that supplies the
  panel's cluster wiring; `src/assistant/` passes almost nothing.
- **Two builds, not two inputs** — `vite.config.js` → `dist/`, `vite.assistant.config.js` →
  `dist-assistant/` — so each host serves only its own bundle. `deploy/deploy-assistant.sh`
  publishes into the leaf's wwwroot with no privilege and no restart.
- **Its sign-in is the leaf's own, and silent.** Served same-origin, so the address is
  `location.origin` and there is nothing to discover.
- ⚠ **`npm run check:assistant` keeps "chat only" true.** It walks the standalone entry's import
  graph and fails on the Control Panel's data-layer roots, because tree-shaking does not remove a
  static import of a module with side effects. Three modules were split to cut those edges:
  `components/AccountAvatar.jsx` (out of `Sidebar.jsx`, which reaches persona and the session
  store), `components/ConnectivityBanner.jsx` (out of `ErrorBoundary.jsx`, which reached
  `apiClient`), and `lib/oauthFragment.js` (the pure parser, out of `authRedirect.js`, which reaches
  the connection model). `AuditEventRow` takes node attribution as a prop instead of importing the
  store barrel.
- **Styles are shared partials with a per-surface barrel** (`styles/assistant.css`). The partial
  files are unedited and identical; only the list differs, so the aesthetic cannot diverge. The same
  check verifies every class the standalone surface renders is styled by the partials it ships.

### Added — the assistant signs you in by itself

Signing into the Control Panel now leaves the dock ready. There is no second login to click through.

Every surface on a host is the **same Discord application** — one client id in
`/etc/kgsm/discord-auth.env`, differing only in redirect URI — so a browser that authorized the app
for the panel has already authorized it for the assistant. Its OAuth round trip completes with
`prompt=none`: two 302s, nothing rendered. The second login was never a decision the user was making,
only a redirect we were making them click.

- **Chained onto a panel login.** `completeOAuthLogin` already reads `/hosts`; if that node runs an
  assistant with a public origin and the browser holds no session for it, the leaf's round trip is
  chained on before the app mounts. The browser is already mid-redirect, so it costs nothing visible.
- **Automatic afterwards**, for an assistant added later, one on another cluster node, or a lapsed
  session — as soon as there is a targeted assistant host.
- **Bounded by the host that is targeted.** No assistant in the cluster and nothing is targeted;
  several and the target stays unset until the user picks one. At most one leaf is ever addressed,
  and a `/hosts` response describes one node, so the login chain can name at most one assistant.
- **Ranked by cost.** A live session does nothing, a held refresh token is spent on a silent rotate,
  and only a browser with neither is worth a redirect.
- ⚠ **One redirect per host per tab.** The marker is written before leaving and cleared only when a
  session actually arrives, so a leaf that keeps refusing cannot loop the browser. `denied` stays
  terminal, and a leaf that is down is never redirected to — that would land on a dead origin.
- **The route survives.** The fragment carries the handoff, so the route travels in `sessionStorage`
  and is restored before mount.
- The sign-in bar is now the fallback for the one case that needs a person: Discord declining the
  silent attempt. Its button is the only caller that ever asks for a consent screen.

### Fixed — a new tab no longer asks for an assistant sign-in it already has

The access token lives in sessionStorage (per-tab) and the refresh token in localStorage (not), so
a new tab holds the long-lived credential and no short-lived one. That state is `bootstrapping`,
not `expired`: the dock spends the refresh token silently instead of offering a sign-in to someone
who never signed out.

### Changed — the chat talks to the assistant leaf directly

The assistant dock addresses the assistant on its own public origin, with a session the leaf issued.
`kgsm-api` is no longer in the path of a turn, a confirmation, or a conversation read: it contributes
the leaf's address (the assistant capability's `info.url`) and nothing else.

- **A second seam, `assistantClient.js` + `assistantSession.js`.** `assistant.host(id)` mirrors
  `api.host(id)`'s shape against the leaf's own unprefixed routes. The leaf session has its own
  storage, its own refresh rotation, and its own sign-in — so a user signed in to the panel can still
  owe the assistant a sign-in, which the chat now says plainly and offers, instead of failing every
  message on a 401.
- **A host whose assistant reports no public origin has no chat.** Its capability reads *down* with
  the reason, and a call is refused with an honest no-route error. It does not fall back to the
  relay: that would restore exactly the coupling going direct removes.
- **The Run on a proposed command hands the leaf's token back to the leaf**, which performs the
  action and answers a verdict. The panel no longer re-runs the action through `kgsm-api` — one
  staged action, one way to perform it, one authority gate, one outcome shape.
- **The verified block is rendered from the verdict, not from the reply text.** `settled` and
  `accepted` are the successes; `notSettled` says the end state was not reached and reports what
  *was* seen; `unknown` says the state could not be read and is never drawn as "stopped".
- **`update`, `backup` and `set_config` are runnable.** The leaf has always been able to perform
  them; the panel offered no Run.
- **Long actions narrate.** The confirm stream's progress steps drive a live sub-label under the
  card's spinner, so an install or a settling wait reads as advancing.
- ⚠ **The OAuth return leg now carries an `assistant_login=<hostId>` marker.** Both logins land on
  this origin with the same `access`/`refresh`/`error` fragment keys, and without the marker the
  panel presents a leaf token to `kgsm-api`. Keep it whenever either sign-in path changes.

### Added — a leaf's Commands tab

- **The leaf page carries a Commands tab for a leaf that answers to commands**, listing every one
  with what it does, what it takes, and which options are required — split into what reads and what
  acts. For kgsm-bot that is the eleven real slash commands, replacing the invented `/krystal …` grid
  the retired Discord page used to show.

  Nothing on the tab is written here. The list comes from the manifest the leaf ships and kgsm-api
  serves, down to the command's own description and the honest note about who may run the ones that act
  — for the bot today, anyone Discord lets invoke them, because it checks no role.

  The tab **registers itself from that read**: which leaves take commands is the leaves' answer, so a
  leaf that grows a command surface gains the tab with no change to the SPA, and a leaf that ships no
  manifest — or a host that could not be asked — gets no tab rather than an empty promise.

### Fixed
- **A leaf's boolean setting renders from what it MEANS, not how it is spelled.** The toggle compared the
  live value against the literal `"true"`, so a leaf running with `True`, `1`, `yes` or `on` — three tiers
  write these, and a leaf's own parser accepts them — rendered as **Disabled** while the leaf had it
  enabled. Reading is now permissive and writing stays canonical (`true`/`false`), and a bool's dirty
  check compares meaning too, so re-affirming a value spelled differently no longer stages an override
  that changes nothing and restarts the leaf to apply it.

### Removed — the Discord integration page

- **The host's Discord tab, `DiscordPage.jsx` and `DiagDiscord.jsx` are gone**, with the `nav.discord`
  capability and the now-dead `settings-discord-*` / `settings-cmd-*` styles.

  The page configured kgsm-api's outbound Discord webhook, which no longer exists — Discord is kgsm-bot's
  channel, and what it announces is configured on the bot's own page under a node's leaf configuration.
  Half the page was never real anyway: the slash-command grid and the message preview were illustrative,
  describing commands the control bot has rather than anything this webhook could do.

  The smoke's integrations phase runs against the provider the API actually registers, and additionally
  asserts that `/integrations/discord` is a 404 — the removal is now a contract, not an absence.

### Added
- **Search and filters on the Services board** — the standard `Toolbar` the Servers and Catalog
  pages use, so a node's leaves are found the same way its servers are. Search covers a leaf's
  name, id, unit and role; the two filters are the two axes the cards themselves show — **State**
  (Running · Attention · Idle · Stopped, folding the run-state tones, so a failing health probe and
  a failed unit sit together) and **Link** (Connected · Disconnected · Not provisionable, where the
  third is its own answer and not a kind of disconnected). Every option carries its count, the
  summary reads `n of m leaves · k running`, and matching nothing is its own state with one button
  back out of it.
- **`LeafCard` — the Services board's leaf tile, rebuilt as shared UI** (`components/LeafCard.jsx`).
  A leaf is managed the way a game server is, so its card is built on the server tile's grammar:
  identity, run state, live facts, then the controls. Its one structural difference is the axes
  strip — a leaf has TWO independent states, the unit systemd reports and the link this panel holds
  to it, and neither implies the other, so each gets a labelled half instead of one blended status
  word. The strip carries the status accent, putting the card's colour on the row that means
  something, and a leaf the API cannot provision says so rather than reading as "disconnected".
  Lifecycle controls (start/restart/stop) are drawn disabled with the reason: a leaf restarts today
  only as the tail of applying a config change. `Open` goes to the leaf's page, `Configure` to its
  Settings tab. The leaf vocabulary it needs (`lib/leaves.js`) and the two formatters
  (`lib/formatting.js`) moved out of the diagnostics page folder, since the leaf page and the leaf
  configuration page read them too. The role line is a fixed two lines whether the leaf's role is
  one line, three or absent, so the facts, the lifecycle row and the footer land at the same height
  on every card in the grid.
- **A server being shut down reads as `Stopping…`** instead of staying `Online` until the process is
  gone. It is the same join as `Updating…` — one entry in the store's verb→state map — and it covers
  the whole shutdown, which for a game that saves its world on the way out is many seconds. Both are
  states where the run-state alone reads wrong for as long as the operation lasts: a server draining
  and saving is still genuinely "running", and an instance being updated is genuinely "stopped".
  Start/Update/Restart stay shut while it lands, and the connect surface says `Stopping…` rather than
  offering a Play button for a server on its way out.
- **A server being updated reads as `Updating…` everywhere it appears** — the detail page's hero pill,
  its Update button, the server tiles, the sidebar dot and the Servers page's status filter — for the
  whole of the update, not just as a flash on the button that was clicked. It is one more state beside
  Installing and Starting: `stores/servers.js` is the single place a server's in-flight job is joined
  onto its run-state, so no surface derives it on its own, and the state is dropped again the moment the
  backend reports nothing is running. It covers an update someone else started, or one started from the
  CLI or the assistant, and survives a reload mid-update, because kgsm-api now carries the active job on
  the server itself (`activeJob`) rather than only announcing the transition.

- **Resource history on a leaf's System tab** — recorded CPU, memory and disk I/O for the leaf itself,
  under the unit facts. kgsm-monitor samples every running leaf's cgroup the way it samples a game
  server's, so this is the Performance tab's historical view pointed at a different entity: the same
  fetch shape, the same `MetricsChartGrid`, the same range selector. The facts above are live and the
  charts are recorded — two sources on two cadences, kept visibly apart.
  - **History windows only, no Live button.** There is no per-leaf metrics tick to subscribe to, and a
    Live range that re-read the history store would be advertising a feed that doesn't exist.
    `RangeSelector` takes a `ranges` prop for this; `HISTORY_RANGES` is the set without it.
  - **No Network card.** A leaf has no per-instance meter by design — the eBPF meter is attached to
    `kgsm.slice` and never sees a unit in `system.slice` — which is a different fact from a server whose
    meter has nothing recorded yet. `MetricsChartGrid` takes `network={false}` for the first; the second
    keeps its honest empty card.
  - **Empty reads three ways, matching what the page already says.** Running with no rows means history
    hasn't accrued; a stopped leaf has nothing to record; a socket-activated one is *resting*, not
    stopped — the same distinction the Activation hint one card up makes.
- Thumbs up/down under every assistant answer, live and in replayed history. The vote is recorded on
  click; a thumbs-down then offers an optional one-line "what went wrong". Read-only transcripts in the
  review dock show the owner's verdict as a badge and offer no control.
- Assistant leaf Overview: a "Rated helpful" KPI that reports its own coverage (a rate with no votes
  renders "—", never 0%), a "What people said" card listing the thumbs-down notes, and a prompt-version
  table whose verdict column makes "did that prompt edit help?" answerable.
- Assistant leaf Conversations: a thumbs-down chip per conversation and a filter for the ones somebody
  marked unhelpful.


### Added — a page per leaf, starting with the assistant

`#/cluster/{host}/services/{leaf}` is one leaf on one node, with its own sub-tabs. The page hangs off
the node's Services tab because that is the only place it is opened from, so the URL keeps descending
instead of jumping to a sibling top-level word — the path reads as the trail you walked, and the
breadcrumb names each step. The flat `#/leaf/{host}/{leaf}` word still resolves, so an older link
still lands.

The shell is deliberately generic — breadcrumb, identity header, the live service strip, the tab
switcher, Logs and Settings are identical for every leaf, because all of it comes from the services
row and the leaf config descriptor each leaf already ships. A leaf with nothing special gets Overview
+ Logs + Settings and needs no code; a leaf with more to say registers a body in `LeafPage`. The
Services board's leaf cards open this page (the all-leaves config page is still at `#/config/{host}`).

**Logs is a tab on the leaf, reading that leaf's journal alone.** It asks journald for the one source
(`?source={leaf}`) rather than filtering the host's merged feed: that feed is capped across every leaf
at once, so a quiet leaf beside a chatty one holds almost none of it — measured on this host, a
300-line merged window carried four sources and none of the monitor's, while the scoped read returned
a full 300. A leaf the host publishes no log source for says so, which is a different fact from
having been quiet. Since the journal is now a tab, the Settings body no longer carries its own Logs
toggle when it is embedded there.

**A System tab owns the unit's facts, which three surfaces had been rendering.** The unit, its
activation, whether it is enabled at boot, its state, when it started, uptime, memory and pid were
split across a strip repeated above every tab, a "Service" card on the generic Overview, and the
config page's identity block — none of them complete, and a leaf with a bespoke Overview (the
assistant) got none of the middle one. They live on System now, which every leaf has. The page header
keeps the leaf's name and its status chip: whether the thing is up is the one fact worth seeing from
whatever tab you are on. The Settings body drops its identity block when embedded, since the page
hosting it names the leaf already.

The tab distinguishes what it cannot measure from what is simply absent: a unit that isn't running
HAS no pid or memory and says "not running", while a running unit whose pid didn't come back is
"unknown", and neither is ever a 0. A leaf the API runs no deep probe for reports "none for this leaf"
rather than an unhealthy-looking blank. `since` is systemd's `ActiveEnterTimestamp` and a stopped unit
still carries it from its last run, so a unit that is down reports when it LAST started and no uptime
at all — reading elapsed time off it claims a dead service has been up for hours.

**One breadcrumb, and it mirrors the URL.** The leaf page drew its own trail, which landed under the
shell's rather than replacing it — two breadcrumbs, disagreeing. Its crumbs moved into the app's own
`Breadcrumb`, which every route already renders: `Home / Cluster / {node} / Services / {leaf}`. A crumb
now carries the route it opens rather than only a route kind, so a trail can step through a
parameterised place — which is what lets the node and Services crumbs be real links back up the path.

**Settings is the existing config surface, not a second one.** `LeafConfigPage` gained an `embedded`
mode that renders its body without its own title and leaf strip — nesting those under the leaf page's
tabs would stack two tab rows. Search, filters, grouped rows, provenance, review and apply are shared
verbatim; a reimplementation would only be free to drift.

**The assistant's Overview** shows how it is actually behaving, ordered by how often a panel would
make you act: clean-answer rate, answer-time distribution, tool problems and people, then a measured
"needs a look" queue and the latest conversations, then per-tool call counts / durations / failures,
then prompt versions, context occupancy, tool steps and thinking share. Every figure is derived by the
leaf from its conversation log and relayed verbatim; this surface formats and never fills in. An
unmeasured distribution renders as "—", never `0` — a zero median would read as "instant".

**The assistant's Conversations tab** walks people → their conversations → the transcript. Every
conversation is listed, including soft-deleted ones (flagged) and the synthetic `dev`/probe actors:
the corpus is what it is. A person with no recorded name shows their raw id — a name is never derived
from a Discord snowflake.

**Transcripts replay read-only in the assistant dock.** The admin transcript DTO is identical to a
user's own history by design, so it goes through the very same `scaffoldHistory` → `ChatThread` path
the person saw — no second renderer able to drift. Review mode removes the rail and the composer
outright rather than disabling them (a greyed input still invites typing into a conversation that
cannot be replied to) and carries a banner that cannot be scrolled away.

`CardTable` gained an optional `onRowClick`, which hands the handler the **row record** rather than an
index — the table sorts internally, so anything resolving a click by position picks the wrong record
the moment a column header is used.

### Added — the assistant tells you its conversations are kept and reviewable

A line on the fresh-conversation screen, under what the assistant can do: *"Conversations are saved
and may be reviewed by an administrator to improve the assistant."* Conversations are stored
server-side by the assistant leaf — they are its memory between turns and the record its tuning is
judged from — and a user should learn that before they type, not after. It sits on the screen that
opens every new chat, which costs the composer no height; a line pinned under the composer instead
would push the input box up on every screen for the whole conversation.

### Changed — the empty chat screen greets and orients instead of labelling

The heading is a greeting drawn at random per conversation ("Hi there — what can I help with?"),
replacing a title that only restated the page. Beneath it, what the assistant can actually do —
health, logs, configuration, lifecycle, troubleshooting — in place of a line describing the routing
topology, which meant nothing to anyone who did not already know the architecture. The capability
line follows the caller's own authority: without operator rights it does not offer to start or stop
anything, so it never promises what the composer then refuses.

### Fixed
- A server's in-flight job no longer disappears when any unrelated server frame arrives mid-run (a
  backup landing, a version changing), which is what made a long update look like nothing was happening.
— a lapsed session is reported only once it stays lapsed

An access token lives 15 minutes, and the seam heals it reactively: the API answers `401`, the host is
marked `expired`, one `POST /auth/session/refresh` rotates a fresh token and the rejected call replays.
Every surface keyed on that status therefore appeared four times an hour for the ~100ms of the
rotation — the node-access notice ("needs your sign-in re-confirmed") flashing at the top of the page
being the visible one, with the auth badge, the cluster chip's degraded count and the stale-credential
auto-logout all reading the same transient state.

The session record now carries `reauthDue`: an `expired` that has *persisted* past a 30s surfacing
window, i.e. one the silent rotation did not heal. Everything that asks the user for something keys
on that; the raw `status` stays instantaneous and is what the seam itself keeps gating on. The routine
renewal now passes under the window silently, and a session that genuinely needs re-authorizing is
still named — 30s later, which is the honest cost of not claiming a failure that hasn't happened.

`denied` is untouched: it is terminal, not a state a rotation can heal, and is surfaced immediately.

### Changed — the live smoke never mutates the host

`scripts/smoke-live.mjs` is read-only against the backend, plus interception at the fetch seam for
every write. Each run previously left ~10 permanent rows in the operator's audit log: seven synthetic
`server.start` events emitted through `kgsm.sh events emit`, and three `config.set` rows from real
note writes on whichever server happened to be first on the live roster.

The teardown that was supposed to absorb this could not. kgsm's event transport is a single host-wide
journal indexed by one kgsm-monitor, and every kgsm-api on the box — including the operator's `:8097`
— merges its engine history from that one monitor, so pointing the smoke at the auth-disabled dev api
never scoped its writes. The purge deleted probe rows from the monitor's index only: the journal kept
the raw lines (a rebuild resurrects them), the note rows were never covered by the predicate at all,
and the "restore" put the note body back but not its attribution. A run now leaves nothing behind
because it writes nothing.

What changed, assertion by assertion:

- `audit.append` is injected at the dispatch seam, like `server.patch`/`server.removed`/`job.patch`
  already were. The stream still has to reach `mode: "live"` against the real backend.
- Audit paging and pushdown run against the host's real log instead of a seeded one, and the scoped
  `serverId` and the `since` bound are derived from it. This is a stronger proof than the synthetic
  seed gave: the filter now runs over a log that holds other servers' rows.
- The note read path is proven against a server that genuinely has one; the write path asserts the
  request the SPA builds, including the empty-body → DELETE routing.
- The file editor keeps its read, stale-etag `412` and traversal `404` — all non-mutating — and
  asserts the save request at the seam rather than performing a 200 that writes an audit row.

The dead socket-isolation block went with it (kgsm dropped the socket transport; it staged a config
override for a key that no longer exists). The smoke no longer needs `sqlite3` or to run next to the
engine. Coverage deliberately handed to kgsm-api's own suite: the journal→api→stream relay and the
note's verbatim round trip through a SOURCED config.

### Added — player moderation in the roster

Kick / ban / unban per player, on the Players band of a server's overview.
Operator-only: the read-only (player-facing) view never renders the column.

**The browser never names who gets moderated.** A request sends the roster's
opaque `playerIdentity` and nothing else — no address, no name. The API resolves
that against its own record of who has been on this server and builds the game's
command from it, so a client cannot aim a ban at someone the roster never saw.
`moderatePlayer()` carries a comment saying so, because the "helpful" change here
is to pass the address along, and it would quietly move the authority for who
gets banned into the browser.

**Only real actions are offered.** The roster response's `moderation` block
({ kick, ban, unban, targetKind }) says what the game's blueprint actually
declares, so a game with no ban command shows no ban button instead of one that
409s on click. It defaults to nothing, so a backend that predates the field
renders no controls rather than broken ones. Beyond that:

- A banned player is offered **unban** and not ban — offering both would state a
  change that wouldn't happen.
- **An action the game declares is always rendered, and disabled when the moment
  is wrong** — a control that vanishes tells the operator nothing, while a
  disabled one that says why separates "this game can't" from "not right now".
  Three gates, broadest first: the server has to be **running** (moderation is a
  console command, and the engine refuses one for a stopped instance — `starting`
  and `unknown` are not running either); the player has to carry an identity of
  the kind the game addresses (a Steam-relay player on an `ip`-keyed game has
  none); and **kick** needs them currently connected. The reason rides the
  tooltip on desktop and a second line in the menu on touch, where no tooltip
  exists. This mirrors the API's own resolution as a courtesy — the API
  re-resolves on every request and remains free to refuse.
- Kick and ban arm-then-confirm (the existing `useConfirmAction` misclick guard);
  unban doesn't, because restoring access is not destructive.
- No optimistic status write. The row changes when the engine's event comes back
  through the `players` topic — because the action landed, not because it was
  asked for.

**The controls are the panel's square ghost icon buttons** (`.icon-btn`, the same
row action the backups list and the host cards use), tinted by tone on hover —
amber for kick, red for ban, green for unban. The label lives in the tooltip and
the accessible name, and both follow the state, so an armed button announces the
confirm rather than the action it still shows.

**On phones the controls collapse into a "⋯" menu** that keeps both icons and
labels — a tooltip, which is what labels an icon button, is not something a touch
screen offers.
The panel is portalled to `<body>` and positioned from the trigger's rect,
because the roster card and its cells both clip overflow — an in-row panel is cut
off, most visibly on the last row. It flips above the trigger when the viewport
is short, and closes on scroll or resize rather than pointing at a stale rect.
The mobile column rule now hides the two date columns by name instead of
"everything past the second", so the actions column survives at phone width —
where an operator is most likely to need it.

### Fixed

- **The `banned` status dot was invisible in every theme.** It referenced
  `--krystal-red`, a token no theme defines (the only use of that name in the
  codebase), so the dot rendered with no colour. It now uses `--danger`, the
  semantic token all 18 themes carry. Latent until now — nothing in the SPA could
  put a player into `banned` before this release.

### Removed — there is no "current node" any more

The sidebar's host switcher is gone, and so is everything behind it: the selected-node store, the
hook that read it, the helper that narrowed lists by it, and the setting that persisted it. The
panel shows the whole cluster on every surface, so there was nothing left for it to mean — and
while it existed, any new feature could quietly bind to it without anyone noticing.

- **In its place, a chip that reports:** `Cluster · N nodes · M online`, plus a count of the ones
  that are degraded. It opens the Cluster page and changes nothing about what you are looking at.
  Collapsed to the rail it shows the node count.
- **Servers and the audit log now show the whole cluster.** Each still has its own Node field,
  which narrows that list and nothing else.
- **Picking a node on the Cluster page** no longer reframes the app; the page's subject is the node
  you opened, which is in the URL.

### Changed — a node that refuses you is reported, not a wall

Losing access to one node used to replace the entire panel with a notice about it. Now it is a row
above the content naming the node, with the one action that helps — *Re-authorize* for a lapsed
sign-in, *Details* for a role you don't have there — and the rest of the cluster keeps working.
A node that simply couldn't be reached is not listed there: not answering says nothing about
whether you'd be let in, and the reachability footnote already covers it.

### Fixed — a node refusing your role was reported as an expired session

The identity check treated every failure that wasn't a 401 the same way, so a node answering *"your
role doesn't grant access here"* came back as *"your session expired — try re-authorizing"*.
Re-authorizing could never have fixed it. The three answers are now kept apart: refused, lapsed,
and no answer at all.

### Changed — federating names the node it federates through

Adding a node to the cluster edits one node's peer list. With more than one node you can manage,
"Add node" asks which one to go through instead of picking for you.

### Changed — a call names the node it is for, or it fails

- **Routing is exact.** Reaching a node the browser doesn't hold now fails — loudly in development,
  and in production with *"That node isn't connected"* — instead of quietly answering from a
  different one. Reading node A's data under node B's name is worse than reading nothing.
- **One exemption, on purpose:** a lone connection whose backend id isn't known yet (a fresh boot,
  before the host list confirms it) still answers, because there is nothing to mistake it for. A
  call that names no node at all still works while exactly one is connected, but says so in
  development — it breaks the moment a second node joins.
- **A token only goes to the node it belongs to.** Sessions are per node, so a call that doesn't
  name one no longer borrows the last-selected node's credentials.
- **Installing a server requires naming where it goes.** No node, no install — instead of landing
  on whichever host happened to load first.
- **Live-connection state is attributed to the socket that produced it**, never to whichever node
  loaded first.

### Changed — signing in picks a doorway, not a node

Your identity is cluster-wide: whichever node signs you in vouches you onto the rest. With several
nodes connected the sign-in page now asks which one to go through and waits until you choose, and
it remembers that choice so the trip back lands on the same node. Before, the return leg always
asked the first configured node — with someone else's token.

### Added — where a server lands is a measured decision

- **The install modal recommends a node from what it can measure**: the blueprint's declared RAM
  and disk against each node's live free RAM and disk. Every node shows its verdict and the numbers
  behind it — *"Fits — 16.7 GB RAM free of 8 GB wanted · 670.5 GB free on / for a 15 GB install"*.
- **A blueprint that declares nothing reads "fit unknown"**, and an unknown node is never
  recommended — it stays pickable with that shown. When nothing measures as having room, the modal
  asks you to choose and Install waits until you do.
- **CPU isn't part of it**, deliberately: a single number can't represent CPU capability.

### Fixed — the install modal's Host field was never rendered

It gated on a permission that doesn't exist, so the field's node list was always empty and every
install silently landed on whichever node came first. The field (now **Node**) gates on the same
create permission every other create surface uses.

### Changed — nothing binds to "the first node" any more

- **A blueprint file names its node.** Each node keeps its own copy, so with several holding one,
  the editor and the create page ask which before opening anything rather than showing one node's
  copy as if it were the blueprint. A single node is still opened straight away.
- **The assistant follows the conversation**: the server you asked about, the blueprint you're
  authoring, the node a picked chat lives on. With several assistants and nothing to go on, the
  dock asks instead of quietly picking one — and opening a past conversation switches to the node
  that holds it.
- **An install in progress shows the node it's actually running on**, taken from the node that
  reported the job. Unknown stays unknown.

### Added — a node that goes quiet says so, instead of its servers just vanishing

- **Every aggregated list discloses which nodes didn't answer.** Home, Servers, Alerts and Audit
  show *"1 of 2 nodes reported · Node B couldn't be signed in to"* when a read comes back partial.
  Fewer rows used to be indistinguishable from servers having been deleted.
- **The reason is the measured one**: a node that couldn't be signed in to is never reported as
  having refused you, and the notice stays silent when every node answers or when there's one node.

### Changed — the dashboard and alerts are cluster-wide

- **The dashboard reads every node** — servers, activity, ping, capacity. The crash KPI reads
  unknown when any node's watchdog is down, instead of quietly reporting a count that leaves that
  node out.
- **Alerts are cluster-wide** on the board, the dashboard card and the sidebar badge: an alert on
  any node needs a human, so a scope can't hide it.
- **Server rows show which node they run on** whenever the cluster has more than one and the list
  isn't pinned to one.
- **The audit's Node filter matches strictly**, with account-level events (auth, tokens) as their
  own selectable "Panel-wide" class rather than being counted into whichever node you picked.
- **Active sessions treat every node equally** — sessions and recent logins are merged from all of
  them, with an honest note when one doesn't respond. "Sign out everywhere" still ends everything
  everywhere.

### Added — the panel drives the cluster's nodes, not the ones you typed in

- **Node discovery runs at boot, for every tier.** The SPA asks a node it can reach for the
  converged cluster roster and starts driving the peers it names, so a node federated on another
  machine shows up in servers, alerts, audit and the catalog on its own. Discovery re-runs on a slow
  cadence, so a node that joins later arrives without anyone doing anything.
- **A discovered node joins live — no page reload.** It gets its realtime streams and is folded into
  the next fan-out immediately. Connecting or disconnecting a host still reloads, because that
  changes who you are signed in as.
- **The roster has one owner.** Pages read it instead of each fetching their own copy, so opening
  the dashboard or the Cluster page is no longer what keeps the node list current. Peer actions
  still re-read the node they changed.
- **A seeded node can't be registered twice** under a second address the roster advertises for it.

Only nodes the cluster reports as alive and reachable are driven; anything else stays a visible
ghost on the Cluster page rather than becoming a dead connection (`PLAN-cluster.md`).

### Fixed — a list filter filters its list, and nothing else

- **The Node filter on Servers, Alerts and Audit is local to its page.** Each list holds its own
  node filter, so narrowing one list leaves every other surface exactly where it was. Clearing or
  resetting a page's filters no longer re-scopes the dashboard, the assistant's target node or the
  install form's default node, and no longer writes a persisted app-wide selection.
- **The filter offers only the nodes its page can show**, and hides itself when there is nothing to
  choose between — one shared option builder (`nodeFilterOptions`) for all three lists.
- **A server row carries its node badge while the list spans nodes**, derived from the rows on
  screen rather than from an app-wide scope.

Groundwork for the cluster-transparency work in `PLAN-cluster.md`: the SPA drives a cluster, so a
node is an attribute of the objects on screen, never a mode of the app.

### Fixed — the settings dropdowns save what you picked

- **Backup cadence, restart cadence, backup/restart day, CPU priority and max consecutive restarts
  now save.** `Select` hands its `onChange` the native `<select>` event, the way every other consumer
  reads it; these six Scheduled-tasks and Runtime handlers took it as a bare value. The dropdown's
  choice therefore never reached state — Save shipped a React event object in the request body, the
  body failed to serialize, and the page reported *"Can't reach the Krystal backend (network)"* with
  the connection banner, against a healthy API that was never contacted.
- **A request body that can't be serialized reports itself.** `liveFetch` serializes before the
  transport `try`, so only a real transport failure marks the host unreachable; a caller passing an
  unserializable body surfaces its own `TypeError` instead of a false "backend is down".

### Changed — a server's backup schedule stands on its own

- **Scheduled tasks offers a Backup cadence alongside the Restart cadence.** The old "Back up
  before restart" toggle is gone: a backup runs against the server as it is, running or not, so it
  no longer needs a restart schedule to hang off and is no longer nested under one. Backup time,
  weekly day and retention appear once a cadence is chosen; Next backup renders beside Next
  restart, both from the scheduler leaf.
- **The timezone applies to both schedules** and is offered as soon as either one is on.

### Changed — a server with no backups is the dashboard's worst case

- **"Oldest backup" ranks a never-backed-up server ahead of every aged one.** Having no backup at all
  is a wider insurance gap than having an old one, so a server the backend scanned and found empty
  takes the tile outright and reads **"never"** in the danger tone, naming the server. It carries no
  timestamp, so it is ranked first rather than sorted onto the date axis — treating "never" as
  infinitely old would be inventing an age. Several unprotected servers report the count and drill
  into the server list instead of arbitrarily opening one of them.

- Only a **measured** empty store (`backup_count === 0`) counts as unprotected. A server that has not
  been scanned yet stays `null` and is still reported as "not scanned yet", never as having none.

### Fixed — the backup KPIs are wired to real data

- **"Last backup" (server detail) and "Oldest backup" (dashboard) show real backups.** Both read
  `server.last_backup`, which the adapter had hardcoded to `null` — so both KPIs read "—" / "No backups
  yet" no matter how many backups existed. They now consume the `lastBackup` / `backupCount` fields the
  backend serves, and update live over the `server.patch` stream when a backup is taken or restored,
  including one taken from the CLI.

- **Removed the fabricated "Auto-snapshot" subtitle.** Nothing records how a backup was triggered, so
  the tile no longer characterizes it. It now describes what the snapshot IS, read off the backup's own
  manifest — size, which directories it captured, which build — and shows only the fields that manifest
  actually carried.

- **"No backups yet" is only shown when that is known.** A server the backend has scanned and found
  empty reads "No backups yet"; one it has not scanned yet reads "Not scanned yet" rather than implying
  the server is unprotected. A backup whose manifest carries no timestamp is still described, and is
  excluded from the dashboard's oldest-backup ranking rather than being sorted as infinitely old or
  brand new.

### Added — the server note is wired to the backend

- **The "Server note" card now persists.** It saves through `PUT/DELETE /servers/{id}/note`, so a note
  survives a refresh and every viewer of that server sees the same text. Previously the editor patched
  the in-memory store only and the note vanished on reload.
- **A byline under the note** — "edited by X · 2h ago", from the attribution the backend records. A note
  written by hand into the instance config has no stored author, and renders with no byline rather than
  a guessed one.
- **Clearing the editor removes the note** (routed to `DELETE`), and a failed save keeps the draft in the
  editor with the error beside it instead of losing the text to a toast.
- The note rides the `/servers` list DTO and the `server.patch` stream, so the dashboard tile renders it
  with no extra fetch and an edit made elsewhere appears live.

### Changed — the Join button launches the game instead of trying to connect for you
- **"Play" replaces "Join".** The button now fires `steam://run/<clientSteamAppId>`, which asks Steam to
  start a title the player owns — something every Steam game supports. Handing Steam an address to
  auto-connect only works for the subset of games whose developers wired that up, so on the rest it
  silently did nothing and there was no way to tell which was which from the panel. Launching is honest
  about what it does: it opens the game, and the connect address beside it is how you get in.
- **The connect address works on the servers list.** It comes from the server row's own `connectPort`
  (kgsm-api now carries it on the list and the stream, not just the detail body), so a card resolves
  `host:port` without opening the server first. This fixes a Copy button that silently did nothing on a
  freshly-loaded list — the port only existed after a visit to the detail page merged it in.
- **Steam cards get a copy button too.** They previously offered only the connect action, which was
  correct when it connected you; now that the player joins from the game's own server browser, the
  address has to be reachable from the card. Play + an icon-only copy share the card's action row.
- The launch link no longer depends on an address, so it resolves anywhere a server row does. Both
  actions stay gated on the server being online — there is nothing to join otherwise.

### Added — the leaf configuration page
- **Every setting every leaf declares, on one page.** `#/config/<hostId>/<leaf>` — its own route, not a
  node sub-tab, because it carries its own leaf tab strip and nesting that under the node page's tabs
  would stack two rows. Admin-only (`ROUTE_CAP.leafConfig = host.manage`), matching kgsm-api's
  Admin-policy leaf controller: an operator cannot reach it and could not read it if they did. The
  Services board's Configure button routes here; `LeafConfigModal` is gone.
- **Built from the existing kit.** The leaf strip is `SubTabs` (the server- and node-detail switcher,
  icon + label like every other tab strip); search/filters/count/collapse-all is `Toolbar`; each group
  is a collapsible `BriefCard`; controls are `Select` and `settings-primitives`' `Toggle`; the review
  step is `Modal`; per-leaf logs are `ConsoleView`. Four components took an additive prop —
  `SubTabs` `title`, `BriefCard` `collapsible`/`open`/`onToggle`, `ConsoleView` `initialSourceId` —
  each with an unchanged default.
- **One apply, one restart.** Edits stage into a sticky bar; the review sheet shows every change as
  from → to, names any `pairedApiKey` moving with it, and requires an explicit acknowledgement when
  something staged is `wiring` or `destructive`. Reset and edit are mutually exclusive per key, so a
  payload can never carry both.
- **Provenance on every row.** override → floor → default as one line with the tier in effect lit,
  collapsing `floor = default` when a leaf's config merely restates its own default. `unknown` is its
  own state — the host could not read the leaf's config source — and is never dressed up as the
  default. `unset` and `empty` stay distinct.
- **Honest edge states.** A read-only leaf (the Control Panel API, which cannot restart itself to
  apply a change) renders values as text with a copy-the-env-line button rather than dead inputs, and
  offers no Restart. A leaf that shipped no descriptor says so rather than implying the short list is
  its whole surface. `applied` / `unchanged` / `rolled_back` / `applied_unreachable` each read
  differently.
- Restart-a-leaf-on-its-own is **disabled with its reason** — there is no endpoint for it yet, and an
  empty `PUT` returns `unchanged` and restarts nothing. It turns on with leaf lifecycle actions.

### Fixed — the config adapter dropped most of what the backend sends
- **`adaptLeafConfig` carried only the keys the old modal used.** `groups`, `editable`,
  `editableReason`, `applyMode`, `fromDescriptor` and per-field `floor`, `effective`, `source`,
  `group`, `risk`, `unit`, `min`, `max`, `pairedApiKey`, `dependsOn` were discarded at the honesty
  boundary, so no component could see them. The full shape now passes through, with the secret rule
  extended across `floor` and `effective` as well as `value`.

### Changed — backups show what they are
- **Each backup row carries its age, size and captured version** under the backup id, read from the
  detail `GET /servers/{id}/backups` now returns (`createdAt`, `sizeBytes`, `version`) via the shared
  `fmtRelative` / `formatBytes` helpers. Every field is optional: a backup the engine lists but has
  no manifest for renders as its id alone rather than as a fabricated size or age, and the subtitle
  is omitted entirely when nothing is known. Download and delete remain disabled affordances — there
  is still no endpoint behind them.

### Added — the blueprint editor
- **Edit a game's `.bp.yaml` from its library page.** `BlueprintFileCard` — a Monaco `BriefCard` on
  the game detail page with Save / Reset / Revert-to-original, an "Overridden" badge when a local
  copy is shadowing a shipped blueprint, the engine's validation errors listed beneath the editor, a
  412 "changed on disk" banner with reload, and a full-screen pop-out that keeps the same editor
  instance. Operator+ reads (read-only), Admin writes. The host is auto-selected when one offers the
  game and picked when several do — a blueprint file lives on one host's disk.
- **Create a blueprint: `#/library/new`.** A "Create blueprint" button on the catalog header opens a
  dedicated page whose buffer is seeded from the ENGINE's own `blueprint.tp` skeleton
  (`GET /library/scaffold`) — the SPA carries no template of its own. A name input (lowercase slug),
  Save (`POST /library`) with `409 name_taken` rendered under the input and the engine's `errors[]`
  beneath the editor, and Reset back to the skeleton. On success it lands on the new game's page.
  Admins author manually; Operators get the same editor read-only with the assistant hand-off as
  their primary action, since creation is admin-only server-side.
- **`askCreateBlueprint` on the assistant dock** — opens the inline dock (the page and its
  half-written buffer stay put) and seeds an editable, not-yet-sent "Create a blueprint for `<name>`"
  prompt into the assistant's existing `create_blueprint` flow. Shown only where the chosen host
  actually provisions an assistant; the manual path works fully without one.
- **`BlueprintHostPicker`** — the host picker both blueprint surfaces share, so the choice looks and
  means the same in each.

### Fixed — the live smoke suite
- **`npm run smoke` talked to the wrong backend no matter what `KGSM_API` said.** It seeded the URL
  into `.env.local`, but the vite server it boots runs in "development" mode and Vite ranks a
  mode-specific env file above a plain one — the committed `.env.development` (pointing at `:8090`)
  won every time. Every REST call went to a port with nothing on it, the shell fell to "Can't reach
  Krystal", and ~19 checks failed for one reason. The seed is written to `.env.development.local` now,
  the top of that order.
- **A run against an auth-enabled backend failed 40 times over instead of once.** The preflight now
  probes `/me` and stops with the command to run — this suite sends no bearer, so a real host 401s
  every gated read.
- **Two crashes aborted the run mid-suite**, so the checks after them never ran and no summary ever
  printed: an unhydrated hosts store dereferenced as `seed0.network`, and jsdom's missing
  `Element.scrollTo`/`scrollIntoView` (no layout engine, so components that auto-scroll threw during
  an ordinary render). Both are guarded; a missing seed is one reported failure.
- **Every Monaco surface was invisible to the suite.** The editor is built for a real browser and
  threw from inside its own mount under jsdom, which surfaced as the *page* hitting its error
  boundary — the game page carrying the blueprint editor among them. It is stubbed with a
  `textarea`; its real behaviour is proven in Chromium by the visual harness.
- **Checks pinned to instances and contracts that had moved on.** Probe instances are derived from
  the live roster rather than named (`factorio-test`/`terraria-hardmode` no longer exist); the player
  roster block asserts the shipped DTO (`playerIdentity`-keyed, a permanent record whose rows change
  *status* on leave rather than being evicted) instead of an early draft's; card assertions complete
  the turn, since cards are staged while it streams and promoted on the terminal frame; a card is
  found by verb, not by the wire's per-turn id; the Update chip's gate is derived from the live row;
  and the audit cursor walk runs to the tail instead of assuming two pages reach it.

### Added — blueprint coverage in the smoke
- The blueprint editor and create page had **no automated coverage at all**. The suite now asserts
  the live scaffold read (the engine's `blueprint.tp`, not an SPA constant), a live blueprint file
  read with its sha256 etag and API-answered `canRevert`, the Overridden badge tracking the file's
  real tier, `#/library/new` routing (parsed ahead of the game branch, round-tripping back), the
  catalog's entry button, the create page mounting, and — intercepted, so no blueprint is ever
  written to the host — the wire shapes of create/save/revert plus `409 name_taken` and
  `400 blueprint_invalid` carrying the engine's own `errors[]` through the envelope.

### Fixed
- **The create page's editor rendered as a 5px sliver.** `@monaco-editor/react` wraps the editor in a
  `<section style="height:100%">`, and a percentage height only resolves against a definite
  containing block — a height that comes from `flex: 1` is not one, so the section collapsed to its
  own near-zero content height. Its wrap now states a single grid track, the way the file browser's
  card fills its modal, which sizes definitely at any size.
- **The blueprint pop-out left dead space below its footer and offered no visible way out.** The
  card now fills the modal (the fill rule the file browser's card already had), and its expand
  toggle moved out of the card header into the card body — where the file browser and the console
  keep theirs — so it travels into the pop-out and becomes the exit control. Applies to the
  existing blueprint editor's pop-out as well as the new create page.
- **An API error's `details` reached no caller.** `apiError` built its Error from the envelope's
  `code`/`message` only, so `blueprint_invalid`'s `details.errors` — the ENGINE's own validator
  messages — were dropped and the editor could only say "the engine rejected this blueprint" with
  nothing about what to fix. `details` is now carried through verbatim.

### Changed — headless deploys (`setup.sh` once, `deploy.sh` forever after)
- **The SPA now deploys through `deploy/setup.sh` + `deploy/deploy.sh`**, the ecosystem contract
  (`tks/scripts/deploy-template/README.md`), replacing `scripts/deploy-prod.sh`. `npm run
  deploy:prod` points at the new script.
- `setup.sh` verifies the target `wwwroot` exists and is writable by the deploying user; `deploy.sh`
  builds and `rsync`s the bundle with **no `sudo` and no prompts**, and refuses up-front with "run
  `deploy/setup.sh`" when the host is not provisioned. There are no systemd units and no polkit
  grant for this project — kgsm-api serves the bundle.

### Added (v1.31.0) — update-available icon on server tiles
- **Server tile meta row now shows a "circle-arrow-down" icon (info tone) when an update is
  available for that game server.** The icon sits right-aligned in the metrics row with a native
  tooltip ("Update available") on hover. Follows the existing metric-LED pattern for right-edge
  placement (`margin-left: auto`).

### Fixed (v1.30.4) — full-screen editor no longer loses your edits
- **Editing in the full-screen editor modal and closing it (without saving) no longer discards the
  edits from the inline editor's Save.** The inline and full-screen editors were two separate Monaco
  instances loosely coupled by a string prop: toggling full screen unmounted + remounted the editor at
  a new React tree position, so in-flight model content could drift from the `draft` state and be lost
  on the remount. A new `ReversablePortal` primitive reparents the editor's real DOM node between the
  inline slot and a body-portal modal slot (instead of re-rendering the same JSX at a different tree
  position), keeping one Monaco instance + model alive across the toggle — so the inline and full-screen
  editors are literally the same instance, bi-directionally bound through the existing `value`/`onChange`.
  Applied to all three editor surfaces: the Files tab (`FileBrowser`), the blueprint file editor
  (`BlueprintFileCard`), and the assistant's blueprint-review editor (`ChatBlueprintDraft`).

### Fixed (v1.30.3) — "Checked X ago" now ticks forward live
- **The "Checked X ago" subtitle re-renders every 30s** via a wall-clock tick timer, so the
  relative time advances even when the audit feed is quiet. The previous implementation was
  anchored to the most-recent audit event (by design for the backup KPI, which should not drift
  from its event timestamp), which meant the "Checked" subtitle was frozen until a new audit
  event arrived. The fix adds a `setInterval`-driven re-render; the "Checked X ago" computation
  now uses `Date.now()` (wall-clock) while the backup KPI stays event-anchored — both intents
  served without compromise.

### Fixed (v1.30.2) — "Update available" KPI shows when the check last ran
- **The "Update available" tile's subtitle now shows "Checked X ago" when the cache has a timestamp**
  (`update_checked_at`, already provided by the API), instead of the hardcoded "On the latest build".
  When the first slow probe hasn't landed yet (no `update_checked_at`), the subtitle shows
  "Checking for updates…" — matching the `ServerHero` chip's honest-unknown state.

### Fixed (v1.30.1) — "Update available" now clears immediately after a successful update
- **The SPA reacts to `job.patch` (verb=`update`, state=`done`, no error) by optimistically clearing
  `update_available` and `update_checked_at` in the server store.** This gives instant UX feedback: the
  "Update available" KPI switches to "No update" and the Update chip disables the moment the job success
  event arrives, closing the ~200ms race window before the verify `server.patch` confirms the same state
  (the backend's own `UpdateCheckCache.MarkUpdated` is the authoritative fix; this optimistic patch is
  the frontend's corresponding half).

### Added (v1.30.0) — the update-check pipeline (frontend half)
- **The "Update available" KPI/tile/filter surfaces are now live.** `adaptServer` maps the backend's
  `updateAvailable` (bool?) + `latestVersion` (string?) into the truthy target-version string the existing
  consumers already expected (`server.update_available = updateAvailable ? latestVersion : null`), so the
  dashboard "Updates available" card, the server-detail "Update available" tile, and the Servers-page
  "Update available" filter+count light up the moment the kgsm-api `UpdateCheckCache` reports a newer
  version. `update_checked_at` is threaded for "checked N min ago" freshness. SSE `server.patch` runs
  through the same adapter, so a flip propagates with no extra plumbing.
- **The server-detail "Update" chip is enabled, gated on `update_available`.** It was force-disabled with
  a stale "kgsm doesn't expose an update path" reason; the backend `update` verb has worked end-to-end
  since M3. The chip now lights when `update_available` is truthy and the server is stopped, with the
  two-step confirm (already wired via `confirm: true`) so a lit chip needs two deliberate presses — no
  accidental update. A running/starting server pre-disables it with "Server must be stopped before
  updating" (mirrors kgsm's own rule and the `CommandGate` 409); an unchecked server shows "Checking for
  updates…"; an up-to-date one shows "On the latest build" — all honest, never fabricated.

### Added (v1.29.0) — nine new themes
- **Nine new themes added.** Theme count: 10 → 19 (13 dark + 5 light + auto).
  - Dark: Amber CRT Screen, One Dark Pro, Rosé Pine, Kanagawa, Everforest
  - Light: GitHub Light, Solarized Light, Catppuccin Latte, Nord Light

### Fixed (v1.28.1) — a revised blueprint draft no longer duplicates/revives earlier editor cards
- **Each in-chat blueprint draft now carries a conversation-unique correlation id.** The assistant's
  `command.proposed` id (`cmd_<n>`) is a per-turn counter that resets to `cmd_0` every turn, so a
  `create_blueprint` draft and a later `revise_blueprint` draft collided on the same `cmdId`. Because the
  Save round-trip patches the card by `cmdId`, saving the newest draft matched **both** messages — reviving
  the older (superseded) editor into a duplicate "verifying" card and, on success, producing two identical
  "Added to the catalog" cards. The SPA now mints a local `uid()` for each draft's `cmdId` at insert time
  (the id was only ever a client-side proposed→verified handle — the finalize authorizes with the token,
  never the id), so every draft's state changes stay scoped to its own card. This also fixes a latent
  collision in the open-draft edit buffer (`draftEditsRef`, keyed by `cmdId`), where a revise could carry
  the wrong draft's live content back to the assistant.

### Fixed (v1.28.0) — the blueprint "verifying" card can no longer hang forever
- **"Save" on a blueprint-review card now consumes a STREAMED finalize** instead of a single blocking POST.
  A finalize is minutes of test-install → verify → repair with long silent stretches; the old buffered
  request could sit with zero bytes flowing long enough for an idle-connection reaper (NAT / a middlebox /
  the browser on a remote path) to silently drop the socket — after which the fetch never settled and the
  "verifying" card spun **forever** with no result, even though the finalize had finished on the host.
  `liveConfirm` now reads the assistant's SSE stream (via the api relay):
  - **live progress** — each `progress` step (research / install / verify / repair) is surfaced as a sub-label
    under the spinner, so the card visibly advances instead of dead-waiting;
  - **an idle watchdog** — resets on every received byte (server heartbeats included) and aborts if the
    stream goes quiet for 60s (≫ the 15s heartbeat), converting a genuinely dead socket into a retryable
    failure ("the verification stream went quiet — it may still be running; check the catalog, or try
    saving again") rather than an infinite spinner;
  - **a terminal `result` frame** carries the same `ConfirmResponse` the buffered path returned, so the
    verified / re-edit / failed outcomes are unchanged.

### Changed (v1.27.1) — a superseded blueprint draft is clearly retired
- When a revision (or re-draft) produces a new draft card, the earlier draft card is now retired to a
  read-only **"superseded"** state — dimmed, dashed border, struck-through title ("Replaced by an updated
  draft"), and its editor and Save/Reset/Give-up buttons removed — so the stale token/content can't be
  acted on and it's unmistakable which card is live. Only an editable ("proposed") draft is retired; a
  draft mid-finalize ("verifying") is left alone.

### Added (v1.27.0) — the assistant can revise an open blueprint draft from chat
- When a blueprint draft card is open in the chat, a chat turn now carries the draft's **current editor
  content** (manual edits included) to the assistant, so asking it to change or populate the draft
  ("populate the metadata with RAM and max players") actually updates the draft via its new
  `revise_blueprint` tool — instead of the assistant falsely claiming it did. The open draft's live content
  is tracked per card (`onDraftEdit`/`onDraftActive`) and attached to the turn body as `draftYaml`; a
  successful revision comes back as a fresh editable draft card to review and save. Ordinary turns (no open
  draft) are unaffected.

### Fixed (v1.26.1) — the chat never shows "session expired" during normal use
- The two chat calls that can't lean on the reactive 401-heal — the **SSE assistant turn** and the
  **single-use blueprint finalize (Save)** — now resolve their bearer through a new **expiry-aware**
  path (`sessionStore.authorizeFresh` / `apiClient.freshBearer`). If the host's short-lived access token
  has lapsed (its own JWT `exp` is past, within a 30s skew), it is **proactively rotated via the refresh
  token before the request goes out**, so the call succeeds on the first try and the session never even
  transiently flips to "expired". The frequent trigger was leaving a blueprint draft open in the editor
  longer than the access-token lifetime, then clicking **Save** and getting "session expired — re-authorize"
  with the edits stuck. Only a genuinely dead **refresh** token now surfaces re-auth (the honest case).
  Every other call stays reactive (heals on the API's 401) — this adds proactive refresh **only** for the
  two non-replayable calls, since a turn/finalize can't be safely replayed through the expired-gate.

### Changed (v1.26.0) — blueprint review card matches the file-browser editor + full-screen pop-out
- The in-chat blueprint review card now uses the **same editor chrome as the Files tab**. Its
  action buttons reuse the shared `fb-editor__btn` family (identical Save/Reset styling
  app-wide), laid out **Give up (far left) · Reset · Save & test-install (far right)** — the
  primary teal Save CTA pinned to the right edge, Reset just left of it.
- The review editor is **taller** (a roomier default height), and the card can **pop out into a
  full-screen modal** — the same reused behaviour as the file browser/editor, the console panel,
  and the time-series charts (portaled to `<body>`, quiet inline placeholder + Restore, closes on
  Esc / scrim). The editor fills the overlay height when popped so a long config isn't capped.

### Added (v1.25.0) — in-chat blueprint-review checkpoint (editable Monaco card)
- `create_blueprint` no longer test-installs unattended. When the assistant finishes drafting
  a config for a missing game, the chat now shows an **editable review card**: the drafted
  blueprint YAML in the **same Monaco editor** the file browser uses (yaml mode, theme-aware,
  lazy-loaded so its chunk only downloads when a card mounts). The human edits anything, then
  **Save & test-install** hands the edited YAML back to the assistant, which re-validates it,
  test-installs, boots, and verifies before anything lands in the catalog — **Restore** reverts
  to the drafted config and **Give up** dismisses the draft. Nothing is added without a real
  verified boot; the card never fabricates success from the accept.
- The card is **double duty**: when the assistant's autonomous repair loop exhausts (a draft the
  local model can't fix on its own), the same card comes back **editable again** with the failed
  attempt's **boot log** attached and a fresh token, so a human can close the gap and re-save
  (the re-edit loop). A **verifying** state covers the minutes-long finalize; a verified result
  flips to the catalog outcome with the measured proof line and a **"Make me a server"** button.
- New apiClient seam `api.host(id).confirmBlueprint({ token, editedContent })` — a blocking
  finalize POST to `/assistant/confirm` (relayed by kgsm-api). Like the SSE turn it does not
  replay on 401 (the confirmation token is single-use and finalize isn't idempotent).

### Added (v1.24.0) — assistant `create_blueprint` progress stepper + outcome card
- When the assistant researches, drafts, and empirically test-installs a blueprint for a
  game the catalog is missing (`create_blueprint`), the chat now shows a **live progress
  stepper** in the assistant's bubble — a check-them-off list built from streamed
  `progress` frames ("Looking it up… ✓ Building a config… Booting it up… Cleaning up…").
  The stepper renders inline next to the tool pill and updates live while the tool is
  still running (it is not gated behind the evidence-card promotion that waits for the
  turn to finish streaming).
- The tool's terminal result now renders a **two-outcome evidence card**: on success, a
  plain-language summary plus the one proof line the pipeline measured (e.g. "booted and
  answered on port 8211") and a **"Make me a server"** button; on failure, an honest,
  specific reason — no YAML, no mention of the disposable test host either way. The
  success button hands off into the **existing** chat-driven install path (the same
  `confirmInstall`/`runLiveCommand` flow a proposed `install` command already uses) —
  no new API surface.

### Added (v1.23.0) — assistant `write_file` config-edit preview + confirm
- When the assistant proposes editing a game server's own config file (the new `write_file` verb — e.g.
  populating Palworld's `PalWorldSettings.ini`), the chat's suggested-action card now shows a **preview of
  the exact change**: the file path plus a scrollable, read-only view of the full proposed content, so the
  change is visible before it's accepted. The preview reads the `file` block (`{ path, proposedContent }`)
  the assistant's `command.proposed` frame now carries — nothing is fabricated client-side.
- **Accept** writes the proposed content through the existing jailed, operator-gated file-content endpoint
  (`filesStore.saveFile`), the same path the file editor uses, then reports the result inline ("Updated
  &lt;path&gt; … takes effect on the next restart"); **Cancel** dismisses it. Confirmation is required —
  the content is never written without an explicit accept.

### Added (v1.22.0) — assistant `get_network` evidence card
- The assistant chat now renders a **Network** evidence card when it checks a server's reachability
  (`get_network`), matching the pattern of the performance and recent-activity cards (it wraps the shared
  `EvidenceCardShell` with a confidence badge and an "Open Diagnostics" deep-link). The card shows the two
  independent network layers the tool measures: the **host firewall** (the active backend, whether it's
  enforcing, and the open port ranges KGSM has opened) and the **router's UPnP forwards** (what's
  reachable from the internet, each `external → internalClient:internalPort`).
- Each layer honors its own honest-unknown states rather than fabricating a measured result: an
  unreadable firewall, un-enumerable rules, an unreachable router, and an unreachable watchdog each render
  as their own "couldn't read" note — never as a false "nothing open / nothing forwarded". A firewall
  that's up but not filtering shows a "not enforcing" flag. This closes the last wire-to-card gap: the
  `get_network` tool result was arriving but the chat reducer had no case to project it, so the card
  (whose component and styles already existed) never appeared.

### Changed (v1.21.0) — assistant resource-trend evidence card reuses the Performance tab charts
- The assistant chat's "resource trend" evidence card now renders through the **same**
  `MetricChartCard` grid the server Performance tab uses, so its charts look and behave identically:
  a synced hover crosshair, the full-screen pop-out, per-window avg/peak/min stats, the log-scale
  toggle, and the series-mute legend. It previously drew bare per-axis `TimeSeriesChart`s with no card
  chrome or hover parity.
- Extracted that grid into a reusable `pages/performance/MetricsChartGrid.jsx` (CPU / Memory /
  Disk I/O / Network from the monitor's `{metric: [{ts, value, min?, max?}]}` history shape). The
  Performance tab's Historical view and the evidence card both feed it; `MetricChartCard` gained an
  optional `chartHeight`, and a `.chart-grid--compact` variant stacks the cards one-up (shorter,
  no always-on empty Network card) for the narrow chat column.
- The live snapshot evidence card (single measured frame, no time-series) is unchanged — there is no
  chart to reuse for a one-point reading.

### Fixed (v1.20.4) — assistant evidence cards wait for the streamed answer
- An assistant chat evidence card (from a `tool.result`) no longer pops into view mid-turn while the
  assistant is still streaming its text answer above it — which read as the answer being prepended on
  top of an already-visible card. Cards gathered during a turn are now held on `bubble.pendingCards`
  and promoted to `bubble.cards` only when the turn finishes (`done`), so each bubble renders
  top-to-bottom in natural order: the finished answer, then its evidence below. The `error` frame and
  the connection-drop path also promote any gathered cards, so evidence is never lost when a turn
  fails mid-stream. Server-rebuilt history bubbles already carry final cards and are unaffected.

### Fixed (v1.20.3) — live smoke cleans up its own synthetic audit rows
- `scripts/smoke-live.mjs` now purges the synthetic `__smoke_probe__` `server.start` events it
  emits to exercise the audit/realtime pipeline. The rows must exist in the backend during the run
  (Phase 8 walks them back through the real keyset pager), so a teardown step deletes only those
  probe rows from kgsm-monitor's `events.db` when the run ends — the smoke no longer leaves
  synthetic events accumulating in the operator's audit trail. Best-effort and safe: WAL-mode
  concurrent `DELETE` alongside the running daemon, scoped strictly to the probe instance name, and
  a missing db / no `sqlite3` just no-ops (`KGSM_EVENTS_DB` overrides the path).

### Changed (v1.20.0) — assistant "Recent events" card reuses the shared audit row
- The assistant chat's **"Recent events"** evidence card (`get_audit_log`) now renders the same
  `AuditEventRow` the full Audit page and the dashboard "Recent activity" panel use — actor avatar,
  actor + summary line, severity-toned action pill, host-provenance chip, origin, and time/relative
  columns — instead of a bespoke compact list. One activity design across the whole app.
- Extracted that row into a shared `components/AuditEventRow.jsx`, collapsing the near-duplicate
  copies that lived inside `AuditLogPage` and `RecentActivity`. It takes the standard `ev` audit
  shape plus `avatarSize` / `showMeta` / `onClick` so the full-page (28px avatar + meta chips) and
  compact (24px, no chips, click-through) variants share one implementation.
- The chat card normalizes each raw kgsm engine event (`instance_started`, …) into that `ev` shape,
  mirroring kgsm-api's read-time shaping (`MonitorEventShaping` raw→dotted action + `ParseActor`
  actor kind) so the same underlying event renders identically on both surfaces; an unmapped type
  falls back to `engine.<type>` with the neutral pill, exactly as `/audit` does. The two honest
  non-list states (monitor-unreachable, measured-empty) are preserved.

### Added (v1.19.0) — root-cause card in chat (the capstone aggregator)
- The assistant's `trace_root_cause` tool — a deterministic aggregator that composes one server's
  event timeline, resource-usage window, and health snapshot against a rules table of known KGSM
  failure signatures — renders a **"Root cause"** Evidence card. The card shows the top (best-
  confidence) finding's headline and confidence badge (`Confirmed`/`Likely`/`Possible` — reusing the
  existing `ConfidenceBadge`, unmodified), then its evidence chain: the specific events that matched
  (same icon/tone/actor/relative-time treatment as the audit/timeline cards), the metric-window facts
  that backed it (CPU/memory avg-peak), and the health checks it drew on (disk, updates, liveness) —
  reusing the existing `.ev-chain` rail layout the card shape already had a renderer for
  (`EvidenceRootCause`, previously unwired). When multiple findings matched, the rest are folded into
  one trailing "N other lead(s) considered" line rather than dropped. When nothing matched, the card
  still renders honestly: the deterministic layer's "no known failure signature — most notable recent
  activity" correlation at `Possible` confidence, never a guessed cause; when a source (the event
  timeline, the health snapshot) was unreachable, the affected evidence is simply absent, and an
  entirely empty chain renders "No supporting evidence to show." rather than a blank card. `chatUtils`'
  shared `EVENT_TYPE_META` gained entries for the event types root-cause evidence actually cites
  (`instance_restarted`/`instance_ready`/`instance_failed`/`instance_update_finished`/
  `instance_deploy_failed`/`instance_download_failed`/`instance_uninstall_failed`), which also sharpens
  their display on the existing `get_audit_log`/`get_change_timeline` cards.

### Added (v1.18.0) — event-history cards in chat (recent events + what-changed timeline)
- The assistant's two new engine-event-history tools render chat cards: `get_audit_log` → a
  **"Recent events"** card (every engine event in the window, most-recent-first) and
  `get_change_timeline` → a **"What changed"** card (the same source narrowed to durable state
  changes — install/uninstall/update/version-update/backup/port-open/port-close; routine
  start/stop and player join/leave are excluded). Each row shows a type icon, the actor (an
  unattributed event reads "unknown actor", never a fabricated "system"), a relative timestamp,
  and — on a fleet-wide read (no server specified) — which server the event belongs to. Both
  cards render an HONEST non-list state instead of an empty shell: a real empty window says "no
  events/changes recorded"; an unreachable monitor says so explicitly ("couldn't be read"),
  never narrated as "nothing happened"/"nothing changed". Reuses the existing what-changed row
  layout (`.ev-changes*`) and the shared `EvidenceCardShell`/`ConfidenceBadge` chrome — no new
  card chrome, just two new `adaptResultCard` projections + renderers.

### Added (v1.17.0) — resource-usage card in chat (snapshot + trend chart)
- The assistant's `get_performance` tool renders a **resource-usage card** in the chat in one of two
  shapes, chosen by the tool result:
  - **Snapshot** (a point-in-time question) — a compact readout of one server's CPU (% of one core),
    memory, network (↓ rx / ↑ tx), disk I/O (↓ read / ↑ write), process count, and — when reported —
    disk footprint. Each value is in binary units; an unmeasured field renders a muted "not measured",
    never `0`.
  - **Trend** (a "how has X been doing over the last …?" question) — a **chart** per primary axis
    (CPU, memory) drawn with `TimeSeriesChart` from the windowed history the card carries. Honest now
    that kgsm-monitor owns metrics history: an empty window renders "no trend recorded" rather than a
    fabricated flat line.
  The card deep-links to the server's Performance tab.

### Added (v1.15.0) — search results card in chat
- The assistant's `search` tool now renders a **cited-passages card** in the chat instead of a bare
  "searching" pill. When a search finds something, the reply carries a `search` Evidence card listing
  each passage's source (doc path or clickable URL), title, and snippet, with a provenance icon
  (indexed docs vs web) and a title that reflects where it answered (Indexed docs / Web search /
  Docs & web). A weak-local answer is labelled "closest matches". An empty / "couldn't search"
  result surfaces no card (summary-only — honest, never fabricated).

### Added (v1.14.0) — chat-driven install / uninstall
- The assistant chat now **runs** an `install` or `uninstall` it proposes, instead of rendering a
  disabled "Not available from the panel yet" card. Confirming an install routes to `POST /servers`
  (`confirmInstall`), an uninstall to `DELETE /servers/{id}` (`confirmUninstall`), both stamped
  `origin:"assistant"` and awaited to a terminal outcome — the same confirm-then-verify flow as the
  lifecycle verbs. `install`/`uninstall` join `API_COMMAND_VERBS`.
- A **named install** lands the name the user asked for. `command.proposed`'s `subject.id` is the
  blueprint for an install, so the custom instance name rides its own `instanceName` field (added to
  the assistant SSE contract) and is passed through to `POST /servers { name }`; the proposal card and
  verify block surface it. An unnamed install falls back to kgsm's auto-naming.

### Fixed (v1.13.2) — two more call-site prop mismatches (same class as the install-modal bug)
- **Host re-authorize modal was inert.** `App.jsx` mounted `<HostReauthModal>` with `hostId=` (a
  string) and `onExpired=`, but the component's contract is `host=` (an object) and `onDone=`. So
  `host.id` was `undefined`, the Re-authorize button's handler early-returned (`if (…|| !id …) return`)
  and did nothing, and the dialog showed the generic "this host" instead of the host's name. Now
  resolves the host object from the store and wires `onDone` to reload (the app's session-change
  convention), so a lapsed per-host session can actually be renewed.
- **Docked assistant evidence links were dead.** The docked `<ChatPage>` omitted `onOpenServer`/
  `onOpenView` (the full-screen instance passes them), so clicking "Open server"/"Open" on an
  assistant evidence card in the dock did nothing (silently guarded, no crash). Now threaded through
  to match the full-screen assistant.

### Fixed (v1.13.1) — install modal Confirm did nothing
- **Clicking Install in the game-server install modal silently failed** with a `TypeError` in the
  console and no visible effect. `App.jsx` mounted `<InstallModal>` with `onConfirm=`/`defaultHost=`,
  but the component's contract is `onInstall=`/`defaultHostId=` — so on submit it called an
  `undefined` handler (`onInstall is not a function`) and the install never fired. Renamed the two
  props at the call site to match the component; the requested-host default now threads through too.

### Fixed (v1.13.0) — per-connection REST reachability (no more one-down-host takeover)
- **The global connection banner was a single global flag**: `connectionStore.status` flipped to
  `down` the instant *any* REST call transport-failed, so one unreachable host — a federated peer
  that's offline, a background `/hosts` fan-out probe to a down node — dimmed the whole shell with
  "Can't reach Krystal. Live updates are paused" and forced every host's `HostConnection` indicator
  to "reconnecting", even though the host you were on was perfectly healthy. It also never
  self-healed while that peer stayed down.
- **Reachability is now tracked per connection** (`connectionStore.hosts` = `{ [hostId]: "live" |
  "down" }`) and the global summary is aggregated from it: **`live` when any connection answers,
  `down` only when every one is unreachable** — mirroring `realtimeStore`'s existing per-host model.
  `markSuccess`/`markFailure` take the routed `hostId`; the cold-start takeover (`down && !everLoaded`)
  and the warm banner are unchanged in behaviour for a true full outage. A single down peer now stays
  contained to its own surfaces (its `StatusChip`/`HostConnection`), never the app-wide banner.

### Fixed (v1.12.0) — cluster SSO lazy-vouch loop closed
- **The vouch loop had a dead link: a manually-added auth-enabled peer landed in the host
  registry with `id: null`**, because `connectHost()` returns `needs_auth` from the `/me` 401
  *before* the `/hosts` id-probe runs. With no id, `connOf(nodeId)` can't route to it at N≥2, so
  `sessionStore.vouch(targetId)` (the 401 auto-vouch-via-a-live-sibling engine, `apiClient.js`
  `hostScoped().withRetry`) never had a routable target — dormant even with two federated nodes.
- **`connect.js` now mirrors the converged cluster roster into the host registry**, keyed by each
  node's real `nodeId` (`mirrorRosterToRegistry`). The Cluster page runs it on every roster
  refresh — idempotent, only genuinely new/enabled/`clientUrl`-bearing nodes get written, nothing
  fabricated for a node still missing an id or URL — and reloads once (bounded to the first roster
  change that actually adds an entry) so the new registry rows take effect. Only a node that is
  **both alive (gossip membership) and reachable (status probe)** is mirrored — a down/joining/
  unknown peer stays an honest ghost row rather than adding a dead registry entry that would trip
  the app-wide connection banner and never self-heal.
- **Dropped the stale "multi-host fan-out isn't wired up yet" guard** on the connect screen
  (`HostAccess.jsx`) — it blocked adding a second host at all, which is exactly the case the vouch
  loop now needs to close.

### Added (v1.11.0) — a real "Add node" flow: federate + connect in one step
- **The Cluster page's "Add node" button now does the actual work.** It used to open
  `HostEditorModal` in "add" mode, which just dropped a fake, disconnected client-side host
  skeleton into the list — no URL, no auth, no federation. It now opens `AddNodeModal`
  (`pages/diagnostics/AddNodeModal.jsx`), which brings a node in for real: **federate** the
  backends (`POST /peers` on the local node, so the two kgsm-api nodes join one gossip mesh —
  admin-only, a "Join my cluster" checkbox defaulted on) and **connect** this browser to it
  (the same registry-write + session resolution `AddHostPage` already uses for the first host).
- **Federate and connect are independent and each reports its own honest outcome.** A federation
  failure never blocks the connect attempt that follows; a node that federates but can't be
  reached from this browser right now is shown as exactly that (federated, not yet connected —
  it'll surface as a discovered peer via gossip) rather than silently dropped or faked as
  connected. Non-admins get a connect-only flow — no federate checkbox, an inline note explains
  why.
- **`HostEditorModal`'s edit mode is unchanged** (still how you rename a node or change its
  region) — only the add-a-new-node path moved off it. `makeHostSkeleton`/`slugify`
  (the client-side fake-host generator the old add path used) are removed as dead code.

### Changed (v1.10.1) — Cluster page CTA + topology scale cleanup
- **One "Add node" CTA.** The Nodes card's header "Add peer" affordance is gone; the page-level
  "Add node" button is the single primary call to action. Per-row admin peer actions
  (enable/disable/remove) are unchanged.
- **The topology dial no longer labels each ring inline.** The latency scale is named once in a
  caption beneath the dial (`latency rings · 10ms · 40ms · 150ms · dashed = unmeasured`), so a
  node's own label can never collide with a ring tick near the top — the outer rings are radially
  compressed by the log scale, which crowded per-ring labels stacked at 12 o'clock. Each node
  still shows its own measured latency.

### Added (v1.10.0) — ghost peers, a tighter topology card, and a cluster-wide dashboard
- **The topology card is tighter.** The constellation's SVG box is capped (max 300px, 240px on
  mobile — was 380px/280px) so the card reads as a compact instrument instead of a tall, mostly
  empty radar; the viewBox itself is unchanged, only the on-screen scale shrinks.
- **Single-digit-ms nodes are now visibly distinct from each other.** `latencyRadius` used one
  log1p curve across 0–250ms, which put every same-subnet node within a few px of the local
  marker. It's now two honest segments: a **linear** stretch across 0–10ms (`R_MIN` 56 → `R_LOW`
  110, up from a single `R_MIN` 46) — where most LAN peers actually land — then a log curve from
  10ms out to the 250ms cap (`R_MAX` 140, was 128). The ring gridlines move with it (10/40/150ms,
  was 20/60/150ms). A 4ms and an 8ms node are now ~20px apart in radius instead of ~5px.
- **"Ghost" nodes: a federation peer this browser holds no connected-host session for now
  renders**, on both the constellation and the node list, instead of silently vanishing.
  `buildClusterNodes` (`clusterNodes.js`) appends one ghost entry per federation node that
  matched no connected host (`key: "fed:"+nodeId`, deduped against matched nodes so the same peer
  is never both an enrichment and a ghost) and resolves a single honest `entry.latencyMs` per
  node — the client-measured ping for a connected node, the federation-reported latency for a
  ghost — which the constellation's placement now reads instead of `entry.ping.ms`, so a ghost is
  placed by its own reported latency. A ghost renders as a hollow dashed-outline dot (never a
  fabricated health tone — there's no host to derive one from, so membership color is the only
  honest axis) and, in the node list, a dashed row whose meter slot reads "Discovered · not
  connected" instead of synthesizing capacity. Admins still get enable/disable/remove.
- **The dashboard's capacity card is now "Cluster capacity"**, sourced from the same
  `buildClusterNodes` merge the Cluster page renders from (was raw `hostsStore.list`) — one row
  per cluster node, connected nodes keeping their mini-meters unchanged, ghosts showing the same
  compact "discovered, not connected" treatment. A ghost row drills to the Cluster page (there's
  no host detail to open) instead of a broken per-host route. At N=1 with no federation peers the
  card is visually identical to before — it's just sourced through the merge now.
- `clusterBadges.jsx` gains `membershipRowTone`, mapping the membership badge's tone vocabulary
  onto the `dash-fleet-row`/`-dot` modifier vocabulary, so a ghost row's status dot on either
  surface reads from the same federation-membership axis a connected row's dot reads from host
  health.

### Added (v1.9.0) — Cluster page constellation redesign
- **The Cluster page unifies onto one primitive: the node.** The body is now two stacked
  `BriefCard`s — a latency-topology **constellation** (`ClusterConstellation`) above a
  Fleet-Capacity-style **node list** (`ClusterNodeList`) — replacing the old KPI row +
  search/pagination + `FleetHostCard` grid. Every connected node (`hostsStore`) is enriched
  with federation data (`clusterStore`) by a best-effort hostname/name ↔ nodeId/label/
  clientUrl match; a node with no confident federation match still renders fully (capacity,
  health, deep-dive), just without a membership/status badge — federation data is
  enrichment, never a gate.
- **Constellation placement is two honest axes only.** Radius comes from measured link
  latency (`pingStore`, log-scaled with 20/60/150ms ring gridlines); angle comes from a
  stable hash of the node's id, so a node never reshuffles position when peers join or
  leave. A node with no latency sample yet parks on an outer dashed "unmeasured" ring
  instead of a guessed distance. Dot color follows federation membership where matched,
  else the node's own health tone; edge style follows federation reachability status (or
  reads as honestly "unknown" with no federation match). The local node is pinned at
  center; at N=1 (no peers) it shows a quiet "No peers yet — add a node" state instead of
  an empty radar. Dots/edges ease to new positions on each latency poll rather than snap.
- **The two cards hover-sync.** Hovering a node-list row highlights its constellation dot
  (and vice versa); clicking either opens the existing per-node deep-dive tabs unchanged.
- `MembershipBadge`/`StatusChip` (membership/status tone mapping) move to a shared
  `clusterBadges.jsx` so the constellation, the node list, and `ClusterPanel` read the same
  vocabulary. `ClusterPanel` (and the retired `FleetHostCard` fleet-grid) are no longer
  rendered on the Cluster page but remain in the tree.

### Fixed (v1.8.0)
- **App-level "Sign out" now actually signs out.** It previously revoked nothing server-side and left the
  long-lived refresh token in localStorage (`user.hostId` was never set, so the revoke/forget was dead
  code — and it called a non-existent `sessionStore.forget`). It now revokes this device's session on
  every node the SPA holds one (best-effort, awaited before reload) and clears **all** per-host
  credentials (access + refresh) via `sessionStore.signOut()`, so a reload can't silently rotate back in.

### Added (v1.8.0)
- **Per-peer CORS / reachability warning on the Cluster page (SPA-C0.5).** Each peer is probed from the
  browser (`fetch(clientUrl + "/api/v1", { mode: "cors" })`); a network/CORS failure shows an amber
  warning on the row — *your browser can't reach this peer directly (check its `KGSM_API_CORS_ORIGINS`)* —
  distinct from and shown alongside the backend node-to-node status chip. Honest two-axis rendering:
  browser-reachability ≠ node-to-node reachability.
- **Cross-node "Active sessions" (SPA-C1).** The Settings session list fans across every node the SPA
  holds a live session on; this browser's own sessions collapse into one "This device" row (logging it
  out revokes on each node), other devices show per-node rows tagged with their node, and a per-node fetch
  failure degrades to an honest partial-results note. At N=1 the render and revoke behavior are identical
  to before.

### Added (v1.7.0) — cluster lazy-vouch engine (SPA-C1, foundation)
- **Lazy cluster SSO engine.** On a `401` for a node the SPA holds no session on, `sessionStore.vouch`
  asks a **live sibling** node (same cluster) to vouch the user onto the target
  (`api.vouch` → `POST /auth/cluster-session/request { nodeId }`), adopts the minted
  `{accessToken, refreshToken}`, resolves the tier from the target's `/me`, then the `hostScoped`
  `withRetry` replays once. Loop-safe (mints only on a fresh, non-live target) and storm-bounded (one
  in-flight vouch per target). **Dormant at N=1** — no live sibling → fast `false`, so single-host auth
  is byte-for-byte unchanged (build + N=1 render verified). The roster→registry mirror + N≥2 unblock that
  make this observable ride on a two-node validation (see `docs/cluster-plan.md` SPA-C1).

### Added (v1.6.0) — Cluster page + peer roster (SPA-C0)
- **Fleet → Cluster (canon).** Cluster is now the canonical vocabulary end to end: the nav entry, page
  header, and breadcrumb read **Cluster**; `#/cluster` is the route hash; the internal `route.kind` is
  `"cluster"` and the capability is `nav.cluster`. The pre-cluster `#/diagnostics`/`#/hosts` URL words
  still resolve for old links; the host registry key is unchanged. (The assistant's `fleet` evidence-card
  kind is a separate kgsm-llm wire contract and is untouched.)
- **The Cluster panel** on the Cluster overview lists the local node plus this node's backend peer roster
  with honest **membership** (alive/joining/suspect/dead/left/unknown), **status** (reachable/unreachable/
  unknown, or *disabled*), and **latency** badges — never fabricated; missing values render `—`/`unknown`.
  Admins get add-peer / enable-disable / remove controls wired to the real `POST`/`PATCH`/`DELETE
  /api/v1/peers` surface (replacing the old in-memory host skeleton stub). An unfederated node honestly
  shows *"This node isn't federated with any peers yet."*
- **Data layer:** a host-scoped `api.peers(id)` client (`list`/`roster`/`add`/`remove`/`setEnabled`/
  `latency`, 401-heal like the other scoped surfaces) and a `clusterStore` domain store that reads the
  admin `GET /peers` roster and transparently falls back to the viewer-tier `GET /peers/roster` on a 403.
- **Smoke:** a gated `#/cluster` render case (plus the `#/fleet` legacy-alias case) in `smoke-live.mjs`.

### Changed (v1.5.2)
- **Settings rows stack on mobile.** On narrow screens each account-settings row now wraps: the icon +
  label + description keep the first line to themselves (no more mid-word truncation like "Displ…"), and
  the control (input / theme select / button) drops to a full-width second line indented under the
  label — the same label→input rhythm the game-server install modal's `.k-field` uses.

### Fixed (v1.5.1)
- **Sign-out now revokes server-side.** The app-level "Sign out" (sidebar / top-nav) previously only
  dropped the local tokens, leaving the session alive in the host's registry until it expired; it now
  calls `POST /auth/logout` first (best-effort, via a new root-routed `api.logout(hostId)` seam) so the
  current session is genuinely revoked. The Settings → Danger zone **"Sign out everywhere"** button was
  wired to the same local-only path despite its "End every active session on all devices" copy — it now
  revokes **every** session server-side (`api.sessions(hostId).revoke({ all: true })`) before signing
  out, matching the working "Log out all" control in the Active sessions card.
- **Recent logins hides device-less rows.** The Settings → "Recent logins" list dropped rows that carry
  no device/user-agent (a bare timestamp is not useful), and renders the remaining ones with the
  device string + a per-device glyph rather than an "Unknown device" placeholder.

### Changed (v1.5.1)
- **Settings page spacing & buttons.** The account Settings cards now sit in a flex column with a
  consistent 16px gap (they were cramped at the BriefCard's 4px margin). The ghost/danger action
  buttons adopt the site button family's metrics (r-sm radius, icon flex-alignment, motion, and proper
  disabled states) so they read consistently beside the primary "Save changes" button.

### Added (v1.5.0)
- **Active sessions & revocation in Settings.** The account Settings page gains an "Active sessions"
  section: it lists every active session for the signed-in user across devices (device / user-agent,
  signed-in and last-active times, expiry, and a "This device" badge on the current one), with a
  per-session "Log out" and a section-level "Log out all", each behind a destructive-action confirm.
  Revoking the current session (or all) signs the user out and returns to the login gate. A read-only
  "Recent logins" section shows the login history from `/me`. Admins get a "Manage user sessions"
  section (hidden for everyone else): look up another user's active sessions by id and revoke one or
  all of them — a security control. Wires to the kgsm-api session endpoints via a new root-routed
  `api.sessions(hostId)` seam (`.list`/`.revoke`/`.revokeSid`/`.revokeUser`) that carries the per-host
  bearer and the 401-heal, plus an `adaptSessions` adapter and `recentLogins` on `adaptMe`.

### Fixed (v1.4.26)
- **Adopt the rotated refresh token on session rotation.** kgsm-api now rotates the refresh
  token on every `/auth/session/refresh` (rolling 30-day window + reuse detection, M4·c). The
  SPA was re-persisting the token it *sent*, which is dead after one use — so a returning user's
  second silent rotation would `401` and bounce to Discord re-login. `sessionStore.rotate()` now
  adopts `res.refresh` from the response and writes it to localStorage (falling back to the sent
  token only if an older non-rotating backend omits it). Restores the "stay signed in for weeks"
  behaviour against the rotating backend.

### Changed (v1.4.25)
- **Settings page tabs are now URL-routed.** Replaced the left sidebar nav with `<SubTabs>` (the same horizontal tab bar used by server detail and fleet pages). Each settings section (Account, Connections, Discord, API tokens, Danger zone) has a deep-linkable route (`#/settings/discord`, etc.). Back/Forward navigation, page refresh, and bookmarking all work. The default tab (Account) is omitted from the URL, matching the `overview` convention in other tabbed pages.

### Changed (v1.4.24)
- **Restyle sidebar host picker to Minimal-Flat.** Replaced the heavy card-like trigger (surface-2 background, border, glow-ring dot, two-line column layout) with a borderless, transparent ghost button. The trigger is now a single-line flex row: status dot + host name + thin separator + metadata + caret. Hover reveals a subtle surface fill; open state is a plain surface background with no accent border or ring. Dropdown menu tightened to match (lighter padding, inline option layout). Rail mode updated to hide the flat row and show only the dot + code. Inspired by the assistant dock's minimal host picker language.

### Fixed (v1.4.23)
- **Clean up dead auth/routing code in App.jsx.** Removed the unused `returnTo` ref (`krystal:returnTo` is never written), the dead `forcedOut`/`?auth=out` path (logout already handles its own reload), the `firstRun.current` ref and its mount redirect (overwritten by landing resolution; `krystal:first-run` is never set), and the `setUser` prop (never called after mount). Simplified the landing resolution to always re-parse the URL hash via `KrystalRouter.routeFromHash()` instead of branching on `hasDeepLink`. The auth/routing sequence now reads as three clean gates: no connections → connect screen, no user → login, auth not ready → boot landing, then route.

### Fixed (v1.4.22)
- **Fix deep-link redirect on page refresh.** Navigating to a deep link (e.g. `#/fleet/hotrod/resources`) and refreshing the page would redirect to `#/servers`. The initial route was resolved from `{ kind: "home" }` without parsing the URL hash, so `can()` failed on the empty async hosts list. Deep links also bypassed the deferred-resolution effect by setting `landingResolved = true` immediately, causing `useRouteSync` to overwrite the URL hash before roles loaded. Fixed by parsing the initial hash in `useState`, deferring both deep links and default landings until `hostsLoaded && authzSettled`, and re-parsing the URL hash via `KrystalRouter.routeFromHash()` once capabilities are known (not using the already-rejected route state).

### Fixed (v1.4.21)
- **Restore Disk and Network styles on the Resources tab.** The split-DiagnosticsPage refactor rewrote the JSX with new class names that had no CSS. Reverted `DiagResources.jsx` to the original row-based patterns: disk rows use `disk-row__head / disk-row__bar / disk-row__usage`; network uses `iface-list / iface-row`; open ports use `ports-block + card-table` inside one Network card. Restored the matching CSS in `observability.css`.

### Fixed (v1.4.20)
- **Fix redirect to `#/servers` on page refresh for admin/operator roles.** The initial route was computed before `hostsStore` loaded (async), so `can()` always returned `false` and `homeKind()` fell back to `"servers"`. The `landingResolved` flag was then set prematurely, bypassing the deferred resolution effect that was supposed to correct the route once auth settled. Fixed by determining the default landing from the URL context (not `homeKind()`), and gating the deferred resolution on `hostsLoaded` so `homeKind()` is only called after hosts and roles are known.
- **Fix `authzSettled` checking non-existent session properties.** The `authzSettled` gate checked `s.role || s.denied || s.needReauth`, but session records have `tier` and `status` — not those properties. This meant `authzSettled` was always `false` once hosts loaded, so the deferred landing resolution effect could never fire. Fixed to check `s.status !== "none" && s.status !== "bootstrapping"`.

### Docs
- **Added focused per-directory `CLAUDE.md` files** documenting the architecture-cleanup refactor's structure so future work doesn't re-monolith it: `src/` (source map + module boundaries), `src/pages/` (pages & routing), `src/lib/` (data layer), `src/lib/stores/` (domain-split stores), `src/components/` (shared UI + `<Modal>`), `src/styles/` (CSS tokens + `kit/` barrel). Root `CLAUDE.md` now points to them. Also removed the stray empty `src/pages/__tmp_test__/` directory.

### Fixed (v1.4.19)
- **Fleet page subtabs (Overview, Resources, Services, Logs) now persist in the URL.** The fleet route encodes/decodes a `tab` segment (`#/fleet/<hostId>/<tab>`), matching how server detail tabs already work. Tab state is driven by the route instead of local React state, so back/forward, reload, and deep links land on the correct tab.

### Fixed (v1.4.18)
- **Page scrolls to top on navigation.** When navigating between pages, the main scroll container (`.app__main`) smoothly scrolls to the top so the user doesn't land mid-page.

### Fixed (v1.4.17)
- **Library grid shows two cards side by side on small phones (≤480px).** The `≤480px` breakpoint forced `.game-grid` to a single column; changed to `repeat(2, 1fr)` to match the `≤768px` layout.

### Fixed (v1.4.16)
- **Assistant FAB button now visible on mobile.** The floating action button was gated to `desktop` only, so mobile users had no visible way to open the assistant dock (only an unreliable right-edge swipe). The CSS already had mobile styles ready; removed the JS guard.

### Fixed (v1.4.15)
- **Files tab: file explorer/editor no longer fills to the footer / squishes.**
  Two parts, both traced to the same phase-6 refactor (`989b9cb`) plus a stale floor:
  - The refactor dropped the conditional that put `content--fill` on the shell
    `.content` for the Files tab (`route.kind === "server" && route.tab === "files"`),
    so the vertical fill-chain (`.app__main → .content--fill → .fb-briefcard →
    .fb-card`) never engaged and the browser fell back to its `min-height:460px`.
    Restored the conditional in `App.jsx` (works now that `.app__main` is back — v1.4.14).
  - Moved the "generous minimum" floor from `.content--fill` (the **whole column**,
    which the tall cinematic `ServerHero` + sub-tabs already ate ~480px of, leaving the
    card collapsed to ~158px) down onto `.fb-briefcard` (the file-browser container):
    `min-height: 520px`. Made `.content--fill` `flex: 1 0 auto` (grow, never shrink) so
    it fills to the footer on a tall viewport but keeps its content height on a short
    one — `.app__main` scrolls instead of squashing the card or riding the footer up
    under the hero (the collapse `kit/responsive.css` guards against on mobile).
  - Verified live in Chromium: at 900px the card holds **448px** and the page scrolls
    (footer reachable, flush at the bottom when scrolled); at 1300px it grows to
    **558px** and fills right down to the footer (25px content-padding gap). Lint clean,
    build green.

### Fixed (v1.4.14)
- **Shell layout regression: page scroll + sticky footer.** The refactor's phase-6
  extraction (commit `989b9cb`) silently renamed the shell `<main>` from
  `className="app__main"` to `className="main"` (plus invented `main--push` /
  `main--rail` modifiers), but the CSS was never renamed — the entire `kit/` layer
  still targets `.app__main`. So the live `<main>` matched no rule and lost
  `overflow-y:auto`, `display:flex; flex-direction:column`, and
  `container-type:inline-size` at once:
  - **the Catalog (and any tall page) could not scroll** — `body{overflow:hidden}`
    clipped the content with no scroll container;
  - **the footer was no longer pinned to the bottom** — `.kfoot { margin-top:auto }`
    is inert without a flex-column parent, so it floated right after the content.
  Restored `<main className="app__main">` (the pre-refactor class; the `main--*`
  modifiers had no CSS anywhere — the dock push is handled by `.app`'s
  `padding-right:var(--dock-push)`). Verified live in Chromium: Catalog scrolls
  (`scrollHeight 4141 > clientHeight 900`) and the footer bar sits flush at the
  viewport bottom; lint clean, build green.

### Fixed (v1.4.13)
- **JSX-text `\uXXXX` escapes rendering literally.** A `’`/`—`/`·`/
  `…`/`↑` escape only decodes inside a JavaScript string literal; in a JSX
  **text node or attribute value** the JSX transform emits a doubled backslash, so the
  DOM literally contains `’` and the browser paints it verbatim (confirmed in
  Chromium — the game-not-found fallback showed `That game isn’t in the library.`).
- Classified all 110 source occurrences (strip JS-string spans → a surviving escape is
  JSX text; plus an attribute-value pass) and fixed the **19 that ship as literal-in-DOM**
  across 10 files (AppRouter, ChatPage, EvidenceCards, ChatContextMeter, ChatHistory,
  ChatMessageParts, AssistantHostPicker, DiagServices, LeafConfigModal, DiagResources),
  converting each JSX-text/attribute escape to the literal UTF-8 character. The other ~91
  occurrences are in JS-string context (`{"…"}`, `label:`, concatenation) and decode
  correctly — left untouched. `LeafConfigModal.jsx:110` was surgical: its JSX-text `’`
  was fixed but the same line's ` — ` inside a `{" … "}` string was left as-is.
  Also tidied a lone non-rendering `—` in a `BootLanding.jsx` comment so it won't
  re-trip the classifier.
- These sit on rare/conditional screens (invalid game route, swap >30%, the admin
  leaf-config modal mid-apply, voice-note recording), which is why they went unnoticed.
- Verified: the fresh production bundle contains **0** doubled-backslash escapes (was 19),
  the game-not-found screen now renders a real `’` in Chromium (DOM `innerText` check +
  screenshot), lint clean (0/0), build green.

### Changed (v1.4.12)
- **`exhaustive-deps` backlog — silenced with intent, not "fixed".** A narrow triage
  pass over all 43 `react-hooks/exhaustive-deps` warnings (25 hook sites) found
  **zero genuine staleness bugs** — every one is either a deliberate `[obj.id]`-not-
  `[obj]` choice (the primitive *is* in the deps; listing the whole object would
  resubscribe/refetch on every render), a run-once/edge-detector effect where a
  ref/guard is the real trigger, or a constant false-positive (`tw` is a fresh-per-
  render literal with frozen contents; `SERVER_STATUS_RANK` is a constant map). In
  each case the linter's only available "fix" — adding the missing dep — would
  **introduce** a regression (a refetch storm, a clobbered in-progress edit, a reset
  live buffer), the opposite of the goal.
- Rather than leave the warnings as a trap for a future session to "fix", added a
  scoped `// eslint-disable-next-line react-hooks/exhaustive-deps -- <reason>` at
  each of the 27 anchor lines, each carrying the specific why (e.g. ChatPage's history
  loader excludes `convos` because depping it would refetch on every streamed
  message; AuditLog's `now` keeps `[scoped]` as a deliberate recompute trigger).
- **No behaviour change** — comment-only. `npm run lint` is now fully clean (0 errors,
  0 warnings, down from 43); build green.

### Changed (v1.4.11)
- **#8 Big-file splits — finished the remaining page files.** Same technique as
  v1.4.10 (extract to sibling modules, keep public exports identical → no consumer
  changed):
  - **`ServerSettings.jsx` 469 → 279.** The three gated setting groups → new
    `serverSettings/SettingsSections.jsx` (`StartupSection`, `ScheduleSection`,
    `ResourcesSection`) as presentational components fed their state slice + setters;
    all form state + the load/save/reset/delete handlers stay in the parent (they
    read every field). The tiny Updates group stays inline.
  - **`DashboardPage.jsx` 420 → 366.** `DashFleetStrip` (the all-hosts capacity
    strip) → new `dashboard/DashFleetStrip.jsx`; dropped the two imports it solely
    used. The customizable band render stays inline (entangled with local layout
    state — extracting it would add prop-drilling for no real gain).
  - **`ChatPage.jsx` 528 → 507.** The message-role dispatch → new
    `chat/ChatThread.jsx` (a pure render switch), moving nine message-part imports
    out of ChatPage. The composer/header seams were **left inline** — they'd each
    need ~15-19 props from the shared chat state, so extracting them would add
    drilling, not remove it (ChatPage was already reduced 1944→528 in Phase 5).
- **Left as-is (documented):** `TimeSeriesChart` (single cohesive chart) and
  `apiClient.js`/`adapters.js` (data-layer seams — splitting risks the acyclic-import
  invariant).
- No behaviour change. Verified: lint 0 errors, build green, and the Settings tab
  (all four sections), Dashboard, and the docked Chat render with `errs:[]` in the
  visual harness.

### Changed (v1.4.10)
- **#8 Big-file splits (refactor problem row 4).** Carved the two worst offenders
  into cohesive sibling modules, keeping each original file's **public exports
  identical** so no consumer changed:
  - **`PerformanceTab.jsx` 654 → 432.** Pure constants + formatters → new
    `performance/perfHelpers.js`; the presentational pieces (`StatStrip`,
    `AnomalyBadge`, `MetricChartCard`, `RangeSelector`, `EmptyPerf`) → new
    `performance/PerfCards.jsx`. The tab file keeps only its two stateful views
    (Live / Historical) + the range orchestrator.
  - **`diagComponents.jsx` 393 → 11-line barrel.** The nine-component grab-bag split
    by cohesion into `diagnostics/diagLeafCards.jsx` (leaf/service cards) and
    `diagnostics/diagHostCards.jsx` (host/fleet cards + host modals); `diagComponents.jsx`
    now just re-exports both, so `DiagServices`/`DiagResources`/`DiagOverview`/
    `LeafConfigModal`/`DiagnosticsPage` keep their existing imports.
- **Fixed (incidental, found during #8 verification):** several `\uXXXX` escapes sat
  in **JSX text nodes / attributes** on the Fleet page, where the build does **not**
  process them (the v1.4.6 class), so they rendered literally — the Fleet header
  em-dash, the host-search placeholder ellipsis, the "no hosts match" curly quotes,
  and the host subtitles' `·`/`—`. Replaced with literal characters in
  `DiagnosticsPage.jsx`; the migrated diag cards were converted at the same time.
  (A broader cross-file sweep for the same class is flagged as a follow-up.)
- No behaviour change from the splits. Verified: lint 0 errors, build green, and the
  Performance tab + Fleet page + edit-host modal render with `errs:[]` and no stray
  escapes live in the visual harness.

### Changed (v1.4.9)
- **#7 Shared `<Modal>` primitive (refactor problem-adjacent).** Eight modals each
  hand-rolled the same three things — an Escape `keydown` effect, a fixed scrim, and
  a click-outside check (three of them also duplicated `createPortal`). Extracted one
  `src/components/Modal.jsx` that owns that behaviour (portal-to-`<body>` + Escape +
  scrim mouse-down close, both gated by a `canClose` prop) and migrated every site to
  it. Net −41 lines across the call sites.
  - **Behaviour-only primitive:** the caller keeps its exact scrim *visual* class via
    `scrimClassName` (`.k-backdrop` / `.modal-scrim` / `.console-modal-scrim` / …),
    so there is **no visual change** — all three scrim classes are already
    `position:fixed; inset:0`, so portaling to `<body>` only lifts them out of any
    clipping ancestor.
  - **Migrated (8):** `InstallModal`, `HostReauthModal` (its `!busy` guard → `canClose`),
    `LeafConfigModal`, `HostEditorModal` + `RemoveHostDialog` (diagComponents), and the
    three fullscreen pop-outs `ConsoleView` / `FileBrowser` / `PerformanceTab`.
  - **Small consistency wins:** the `onClick={onClose}` sites now close on a *mouse-down
    outside the box* (target-checked) instead of any bubbled click, and
    `RemoveHostDialog` gained Escape-to-close (it had none).
  - **Deliberately not migrated:** `Toolbar`'s filters/sort dropdown and the chat
    popovers (`usePortalPopover`) are *anchored popovers*, not scrim modals — a
    different pattern, left alone.
  - Verified: lint 0 errors, build green, and in the visual harness `InstallModal`
    (Family A) + `ConsoleView` pop-out (Family B) open portaled-to-`<body>`, close on
    Escape and scrim-click, with `errs:[]` and unchanged appearance.

### Changed (v1.4.8)
- **#3 Prop-drilling cleanup (refactor problem-table row 5).** The Phase-6 App
  extraction *relocated* the god-component prop list onto `AppRouter` (~31 props)
  rather than eliminating it. Thinned `AppRouter` to routing only (~15 props) by
  splitting the props by ownership:
  - **Store-derived data now read in the pages, not threaded.** `DashboardPage`,
    `ServersPage`, `GamePage` read `serversStore`/`hostsStore`/scope directly (via
    `useStore` + `scopeServers` + `useSelectedHostId`), and `ServerGate` reads the
    store's `status`/`everLoaded` — the same pattern `FleetPage`/`ServerDetailPage`
    already used. Dropped `servers`/`scopedServers`/`hosts`/`selectedHostId`/
    `serversStatus`/`serversLoaded` from the router.
  - **Assistant/dock state read from context in the router.** `AppRouter` now calls
    `useAssistantDock()` for `askAboutAlert`/`getServerState`/`assistantHost`/…
    instead of receiving 7 props from the shell (it renders inside
    `AssistantDockProvider`).
  - **Dead props removed:** `activeServer` and `installing` were passed to
    `AppRouter` but never used in its body.
  - Genuinely shell-local props stay threaded (route/setRoute, `serverForRender`
    with merged console `extraLog`, the deny/expired gates, `handleAction`, install
    + reauth + logout, `user`) — and routing callbacks stay on the router (they keep
    pages decoupled from the router). Host-selection in the router's deny/expired
    gates calls `selectedHostStore.set` directly.
  - No behaviour change. Both sides of every contract were updated together (the
    v1.4.7 lesson). Verified: lint 0 errors, build green, and every page renders
    with `errs:[]` live in the visual harness (Servers/ServerDetail/Game confirmed
    populated with real data).

### Fixed (v1.4.7)
- Sidebar nav links (Home / Servers / Catalog / Alerts / Fleet / Audit log /
  Settings) were dead no-ops — a refactor contract mismatch. `App` was passing the
  new `route` + `onNavigate` props, but the `Sidebar` component still expected the
  old individual `on<Page>` / `<page>Active` handlers, so every nav `onClick` was
  `undefined`. Wired `Sidebar` to consume `route` + `onNavigate` (derives active
  state from `route.kind`, emits `onNavigate({ kind })`), completing the intended
  contract instead of reverting it. Also restored the dropped `open={drawerOpen}`
  prop (mobile drawer). Verified live: all 7 items route correctly.

### Fixed (v1.4.6)
- Boot/auth hold screen ("Signing you in…"): fixed two bugs found during the v1.4.5
  browser verification.
  - The ellipsis rendered as a literal `…` — the escape sat in a JSX **text
    node**, where `\u` is not processed. Wrapped it in a JS string expression
    (`{"…"}`) so it renders "…". Fixed the identical case in `AppRouter`'s
    Suspense fallback ("Loading…").
  - The content leaned left on mobile: `BootLanding` reused the `.app` shell class,
    whose `grid-template-columns: var(--sidebar-w) 1fr` pinned the centred content
    into the narrow sidebar column (and the inline `display:grid` even overrode the
    mobile `.app{display:block}`). Replaced with a self-contained `position:fixed;
    inset:0` flex overlay centred on both axes at every breakpoint.

### Fixed (v1.4.5)
- **Four latent crashes** the dead-code sweep + a new lint rule surfaced, all
  used-but-not-imported in JSX-tag position (the same class as v1.4.3 #1, which
  plain `no-undef` misses):
  - `App.jsx` rendered `<ChatPage>` in the assistant dock but no longer imported it
    (the refactor dropped the import; the dock opens by default on desktop, so this
    was a white-screen on load — the dock sits outside the router's ErrorBoundary).
    Now lazy-loaded, matching the existing `<Suspense>` wrapper.
  - `AppRouter.jsx` rendered `<ServerGate>` (the not-yet-loaded/bad-id fallback)
    without importing it → crash on a server route before the list loads. Imported.
  - `ChatPage.jsx` had no default export, but `AppRouter` lazy-loads it via
    `React.lazy(() => import(...))` (which requires a default) → the full-page chat
    route crashed. Added `export default ChatPage` (every other lazy page had one).
  - `ServerSettings.jsx` used `<Select>` but only imported it aliased as an unused
    `KSelect` → `ReferenceError` on the Server Settings tab. Imported `Select`.
- Also fixed a latent `store.patch(...)` reference in `capabilities.js` (leftover
  from a removed alias) that would have thrown at runtime → `hostsStore.patch(...)`.

### Changed (v1.4.5)
- Added `react/jsx-no-undef` (error) to the lint gate — `no-undef` does not catch
  undefined JSX-tag identifiers (`<Foo/>` with no import), which is exactly how the
  four crashes above hid from the build. This closes that blind spot.
- Dead-code / vestigial-guard sweep ("#6") across the whole `src/` tree: removed all
  183 `no-unused-vars` (dead imports, unused `React` imports under the automatic JSX
  runtime, unused locals, `catch (e)` → `catch`) and the vestigial
  `Import ? Import(...) : fallback` / `{Import && <Import/>}` guards left over from the
  prototype's window-globals era (the imported symbol is always defined). Net −107
  lines. Runtime-data guards (`server && …`, `host.online && …`) were deliberately
  left. Remaining lint backlog: 43 `react-hooks/exhaustive-deps` warnings.

### Added (v1.4.4)
- ESLint gate (`npm run lint`, ESLint 9 flat config in `eslint.config.js`).
  Deliberately narrow: `no-undef` and `react-hooks/rules-of-hooks` are **errors**
  (the two static bug classes the build silently passed in v1.4.3);
  `react-hooks/exhaustive-deps` and `no-unused-vars` are **warnings** (a tracked
  backlog). No typecheck or unit-test runner is added.

### Fixed (v1.4.4)
- Fixed 7 `rules-of-hooks` violations the new gate flagged, all the same vestigial
  `useHook ? useHook() : fallback` / `if (useHook) useHook()` guard pattern left over
  from the prototype's window-globals era (the imported hooks are always defined).
  Sites: `NeedsAttention`, `AlertsPage`, `Toolbar` (`useFilters`), `DashboardPage`,
  `DiagnosticsPage`, `ServerDetailPage`. In `ServerCard`, `useIsFavorite` was called
  *after* the phantom-tile early return — hoisted it above the return so hook order
  is stable regardless of `server._phantom`.

### Fixed (v1.4.3)
- Follow-up to the architecture-cleanup refactor: fixed regressions the extraction
  introduced.
  - `ServerDetailPage` referenced `RecentActivity` without importing it — an
    undeclared identifier that threw `ReferenceError` (caught by the ErrorBoundary)
    whenever an operator opened a server's Overview tab. Added the missing import.
  - The assistant dock's "pin" toggle was a no-op: `App` kept a dead local
    `manualPin` state and wired `onTogglePin` to it, while the real pin state
    (driving `effPush`/`pushingPanel`) lived in `AssistantDockContext`. Removed the
    dead state; the toggle now uses the context's `setManualPin`.
  - `App` cleared stored auth and returned `<LoginPage />` mid-render (a render-phase
    side effect) above ~20 hook calls (a Rules-of-Hooks hazard). Moved the `?auth=out`
    handling into the top-level `user` state initializer; the null-user case is now
    handled by the existing post-hooks guard.
  - `AssistantDockContext`'s context-value `useMemo` never actually memoized — two
    derived host-list arrays were rebuilt every render and used as deps, so every
    consumer re-rendered on every provider render. Memoized the lists (and
    `dockResize`) and completed the dependency array; the value is now stable on a
    no-op render.

### Fixed (v1.4.2)
- Auth pipeline hardened across the board: `api.host(null/undefined)` now throws
  immediately rather than silently building a broken unauthenticated client. Every
  `(hostId && api.host) ? api.host(hostId) : api` fallback removed from stores and
  components (11 sites in `stores.js`, plus `BackupsList`, `ConsolePanel`,
  `PlayersTab`, `DiscordPage`). Read functions now bail with `null`/`[]` when
  `hostId` is missing; write functions reject with an explicit error. `_fetchAuditPage`
  switched to `api.fanOut` (consistent with every other multi-host read, closes the
  unauthenticated-audit hole for id-less seed connections). `DiscordPage` host
  derivation made reactive via `useStore(hostsStore)` so the page re-renders
  correctly when `hostsStore` hydrates after a deep-link cold boot.

### Fixed (v1.4.1)
- `GET /servers` always 401s on every page reload: `retryConnection` used the
  unscoped `api.get("/servers")`, which resolves auth via `selectedHostStore.id`.
  On cold load that store initialises to `"all"` (hostsStore is empty until the
  first REST round-trip), triggering the `id === "all"` guard in `authorizedBearer`
  → no token → unauthenticated request. Fix: use `api.fanOut("/servers")` instead,
  which routes per-connection through `hostScoped(conn.id)` with a concrete host ID
  → `authorizedBearer` succeeds on the first call.

### Added (v1.4.0)
- iOS PWA polish: multi-resolution `apple-touch-icon` tags (180×180, 167×167, 152×152 px)
  so the home-screen icon renders at the correct size on every iPhone and iPad variant.
- iOS launch / splash screens: `apple-touch-startup-image` entries with `media` queries
  covering every current iPhone and iPad, eliminating the blank flash on cold-start.
  13 portrait splash sizes generated (640–2048 px wide), all using the app canvas colour
  (#0B0F14) with the icon centred — no white or system-default grey frame.
- `format-detection` meta tag (`telephone=no, date=no, email=no, address=no`) to suppress
  iOS auto-linking of phone numbers, dates, and addresses in rendered text.

### Fixed (v1.4.0)
- **iOS notch / status-bar overlap** — `@media (max-width: 768px)` reset `.topbar`'s
  shorthand padding to `0 16px`, silently overriding the `@supports` block's
  `padding-top: env(safe-area-inset-top)`. The topbar content was running straight
  into the status bar when launched in standalone mode on any iPhone with a notch.
  Fixed by re-applying the safe-area padding inside the mobile block and changing
  `height: 56px` → `min-height: 56px` so the bar grows rather than the content
  shrinking.
- **Assistant FAB hidden behind home indicator** — `.assistant-fab { bottom: 16px }`
  on mobile doesn't respect `env(safe-area-inset-bottom)`, so the FAB overlapped
  the home bar on all edge-to-edge iPhones. Fixed with
  `bottom: max(16px, env(safe-area-inset-bottom, 0px))` (and matching `right:` for
  landscape notch clearance).

### Added (v1.3.0)
- Phantom install card: when a new game server install starts, a dashed card appears in the
  fleet immediately showing install progress. The pill text updates through "Preparing…",
  "Downloading…", and "Deploying…" phases as kgsm emits events. All connected users see the
  phantom — the card is driven by `job.patch` SSE, not just by the user who initiated the install.
- On install failure the card switches to a red "Failed" pill with a Dismiss button.
- The phantom is replaced in-place by the real server card when install completes.

### Added
- Crash-policy rows in the Startup & recovery card: "Restart on crash" toggle and
  "Max consecutive restarts" select (shown only when restart-on-crash is on).
  Wired to `crashRestart` / `crashMaxRestarts` in GET/PATCH /servers/{id}/settings;
  watchdog-gated alongside autostart.
- Auto-backup rows in Scheduled tasks card: "Back up before restart" toggle and
  "Keep N backups" retention input (shown only when a restart cadence is set).
  "Last backup" read-only row shows most-recent backup timestamp and status from
  the scheduler socket.

## [1.0.0] - 2026-07-03

### Added
- **Scheduled restart card** in server Settings. Cadence (off/daily/weekly/6h), time,
  day-of-week (weekly only), optional timezone override, and next-scheduled-restart
  timestamp from the kgsm-scheduler leaf. Scheduler-gated — gracefully absent when
  the leaf is not deployed.

## [0.9.0] - 2026-07-03

### Added
- **Settings Phase 2 — Resources.** CPU priority (Low/Normal/High) and Memory cap (MiB, 0=uncapped)
  rows are now live in the Settings tab, watchdog-gated. CPU priority is live-applied to the running
  cgroup; memory cap persists to config and takes effect at next restart (noted in the sub-label).
  Both show the current values from the API on load.

## [0.8.0] - 2026-07-03

### Added
- **Settings Phase 1 — Autostart.** The Startup & recovery section is now live: shows an Autostart
  toggle when the watchdog capability is healthy (Save/Reset wire through). When watchdog is offline,
  shows an honest "Watchdog offline — autostart unavailable" message instead of the Phase 1 placeholder.
  The "—" sentinel appears when the watchdog is provisioned but the GET couldn't read the value.

## [0.7.0] - 2026-07-03

### Added
- **Settings tab wired (Phase 0).** `ServerSettings.jsx` is now live: loads settings from
  `GET /servers/{id}/settings`, auto-update toggle is wired end-to-end, Save and Reset buttons
  call `PATCH /servers/{id}/settings`, Delete button calls `DELETE /servers/{id}` with a
  two-step confirmation and navigates to the server list on 202 acceptance. Startup & recovery,
  Scheduled tasks, and Resources sections show honest "Available in Phase N" placeholders until
  their primitives land. `fetchSettings`, `patchSettings`, and `deleteServer` added to `stores.js`.

## [0.6.0] - 2026-07-02

### Changed
- **Realtime transport migrated from WebSocket to fetch-based SSE.** `GET /api/v1/stream`
  is now `text/event-stream` (topics chosen via `?topics=`, bearer sent as an `Authorization`
  header instead of `?access_token=`). Fixes the class of WS-401 incidents caused by a
  browser being unable to set headers on a WS handshake and an opaque `1006` close on
  auth failure — SSE surfaces a readable `401` that heals through the same reactive
  rotate-on-401 path as every REST call. One persistent **primary** stream per host
  (global topics, drives `realtimeStore` mode + `rehydrateAll`) plus ref-counted
  **dynamic** per-topic streams for resource-scoped views. Dropped all client-side token
  expiry prediction (`tokenExpMs`/`tokenExpired`/`wsBearer`); the Dashboard Ping KPI is
  now REST-timed (`GET /health` RTT) instead of a WS ping/pong.

## [0.5.1] - 2026-07-01

### Fixed
- **Player roster desktop layout**: Status, First seen, and Last seen columns no longer
  shrink excessively on wider screens. Added minimum column widths (`110px`/`120px`) to
  prevent squishing while preserving the mobile layout.

## [0.5.0] - 2026-07-01

### Added
- **Unified permanent player roster view**: `GET /servers/{id}/players` now returns the
  full history roster (every player who has ever connected, with status, first seen, last seen).
  Status indicator with colored dot + text label. Mobile responsive: time columns hidden on
  small screens, status label visible.

## [0.4.0] - 2026-07-01

### Added
- **Players tab wired to the frozen player-presence contract** (`player-presence-contract.md`
  §5): `GET /servers/{id}/players` hydrates the roster, then the `players` WS topic
  (`players.join`/`players.leave`, keyed by `sessionKey`) follows live joins/leaves —
  tail-then-follow, same ordering guarantee as the Console tab. Replaces the old
  prototype scaffold (ping/playtime/online-banned-allowlist status/kick-ban actions —
  none of which the backend can honestly source) with a thin, honest roster: a row's
  label falls back name → addr → sessionKey (never blank), and `detection:"unknown"`
  renders an explicit "presence not available for this game" — never a fabricated
  "0 players online".
- **`players.reset` handling**: the api clears its own roster on an instance
  stop/start/restart (a killed process emits no `players.leave` lines), so a
  `{type:"players.reset", data:{serverId}}` frame tells an already-open tab to drop
  its stale rows too — no REST refetch needed, a rejoin flows back in as an
  ordinary `players.join`. Prevents phantom "connected" rows surviving a restart.

## [0.3.0] - 2026-07-01

### Changed
- **Session handling rewritten to a reactive model — the API is the authority.**
  The client no longer predicts access-token expiry. It uses whatever token it
  holds and rotates only when told to: an HTTP `401` response rotates the refresh
  token and replays the call once (`hostScoped.withRetry`), and that is the entire
  REST freshness story. Removed the proactive-refresh `setTimeout`, the
  `EXPIRY_SKEW_MS` margin, the separately-tracked shadow `exp`/`capExp` fields, and
  the `visibilitychange` pre-freshen — every WebSocket 401 bug we've had came from
  one of those trying to *predict* expiry and drifting out of sync with the real
  token. `sessionStore` collapses to `token()` / `rotate()` / `authorize()`.
- **WebSocket auth:** because a browser hides a WS-handshake `401` as an opaque
  `1006` close, the socket can't heal reactively like REST. It (and only it) reads
  the access token's own JWT `exp` claim right before dialing (`tokenExpired`) and
  rotates a lapsed token first, so it never opens a connection the API would reject.
  This subsumes the v0.2.1 stop-gap.

## [0.2.1] - 2026-07-01

### Fixed
- Realtime WebSocket 401-loop after a token lapses (e.g. a tab left open overnight,
  then refreshed). The session freshness gate keyed off a client-tracked `exp` field
  that could drift ahead of — or be missing from — the access token's real expiry,
  so a dead token read back as `live`, the funnel handed it to the socket, and it
  401-looped forever without ever attempting a refresh. The token's own JWT `exp`
  claim (exactly what the API validates) is now authoritative in the freshness gate,
  the persisted-session read, and the proactive-refresh timing; the stored `exp` is
  demoted to a faithful cache of that claim (written from the token, never computed
  independently). Auth-disabled hosts and non-JWT bearers are unaffected.

### Added
- Metrics-threshold alerts: the alert feed now surfaces the new kgsm-api `metrics`
  (per-server) and `host-monitor` (host-scope) sources alongside `watchdog` crashes —
  same page, dashboard, sidebar badge, and filters, no new surface. Host-scope alerts
  (no `serverId`, `anchor.surface: "host"`) render cleanly and get an **Open host**
  click-through to the host page; per-server metric alerts deep-link to that server's
  Performance tab. Source→icon already covered `metrics` (gauge) / `host-monitor`
  (server); this wires the navigation for the null-serverId host case.

## [0.1.1] - 2026-06-30

### Fixed
- Realtime WebSocket no longer 401s on every fresh page load. The first `/stream`
  dial runs during `apiClient` module eval, before the lazy `sessionStore` import
  resolves, so the egress auth funnel fell through to a tokenless connect → a
  guaranteed 401, healed only by the ~2.5s reconnect backoff. `authorizedBearer`
  now awaits the session-module-ready promise, so the first dial already carries
  the access token (restored synchronously from `sessionStorage` on an in-tab
  reload — no extra round-trip).

## [0.1.0] - 2026-06-30

### Added
- Initial versioned release.
