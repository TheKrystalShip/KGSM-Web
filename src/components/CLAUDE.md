# src/components/ — shared UI & the pieces extracted from the shell

Reusable, mostly-presentational components. Two kinds live here: **UI primitives**
shared across pages, and **shell pieces** the refactor pulled out of `App.jsx`.
A component here should be view logic — it may read a store via `useStore`, but
it doesn't own routing or fetch from the API directly.

## The `<Modal>` primitive — use it, don't hand-roll

`Modal.jsx` is the shared dialog primitive (commit `aa5d1f5` — 8 ad-hoc modals
were migrated onto it). It owns the portal-to-body, scrim, Esc-to-close, and
focus/scroll handling. **New dialogs compose `<Modal>`; don't re-implement a
backdrop + portal by hand** (that's exactly the duplication the refactor removed).
`Select.jsx` is the shared portal-popover dropdown — reach for it over a raw
`<select>` when you need the styled menu.

## Shell pieces extracted from App.jsx (refactor §3) — leave them out here

These were `App.jsx` sections; keeping them as their own modules is what keeps
the shell thin. Don't re-inline them.

- `AssistantDockContext.jsx` — the assistant dock's state, derived layout, and
  interaction fns. `AssistantDockProvider` wraps the app; consumers read via
  `useAssistantDock()` instead of threading dock props through the shell.
- `AppRouter.jsx` — routing-only switch (see `../pages/CLAUDE.md`). It lives here
  but is the routing layer, not a presentational component.
- `Breadcrumb.jsx`, `BootLanding.jsx`, `MobileNavToggle.jsx`, `Sidebar.jsx`,
  `Footer.jsx`, `ErrorBoundary.jsx` (+ `ColdStartDown`/`ConnectivityBanner`/
  `ContentError`/`AppCrash`) — the layout chrome.

  `Sidebar.jsx` also holds **`SidebarFavorites`**, the shortcut list under Servers. Three rules make
  it safe to give permanent chrome to: it renders **nothing** with nothing starred — no header, no
  placeholder — so the space it takes is always space somebody asked for; it keeps **insertion
  order** and nothing re-sorts it, because a shortcut that moves is not a shortcut and the status dot
  is what carries state; and it **caps** at `FAVORITES_SHOWN`, overflowing to Servers, because the
  nav sits above an account and a Settings entry that have to stay reachable. A favourite the roster
  does not hold is still drawn — vanishing while a node reboots reads exactly like one somebody
  deleted — with a hollow dot (no reading is not "off") and a tooltip naming which of the two it is;
  only the stale case, where a live node has no such server, offers to clear it.

  ⚠ `.sidebar__nav` is the one part of the aside allowed to scroll. The foot is pinned by
  `margin-top: auto` and would otherwise be pushed past the bottom edge, where nothing can reach it.

## The `pin` slot — how a card gets onto the dashboard

`BriefCard`, `CardTable`, `KPI`, `ConsoleView` and `Rail` each take an optional **`pin`** in their
header. Those five shells are about a hundred card surfaces between them, which is why the affordance
lives there rather than at each call site.

**It is a NODE, not a descriptor** — `pin={<PinButton type="leaf.logs" params={{ hostId, leafId }} />}`.
That is not a style preference: `BriefCard` is reachable from the standalone assistant's bundle, and
`PinButton` reaches `persona` through the dashboard store, so a `pin={{type, params}}` prop would
force `BriefCard` to import it and fail `npm run check:assistant`. The node form keeps the shells
ignorant of widgets entirely — they render whatever they are handed.

`PinButton` self-suppresses inside a widget (`useWidgetContext`), so a pinned card never offers to
pin itself and no shell has to check. It is a **toggle**: filled means this exact `(type, params)` is
on the dashboard, and pressing it removes it.

⚠ **CANON: a component does not branch on where it is mounted.** A card renders and behaves
identically on its own page and pinned to the dashboard — a Minecraft console is the same console in
both places. Its data is a function of its PARAMS (which server, which leaf) and never of its
placement: stores are keyed by the target, not by the surface reading it. `WidgetContext` exists for
the widget system's own chrome, and `PinButton` is its only legitimate reader. A card that needs to
look different as a widget is a card that will diverge from itself the first time one path is
touched — fix the host or the CSS instead.

**Empty space is a widget.** `layout.spacer` is the one way to say "leave this room alone" — the grid
is a flow, so a gap otherwise exists only as a consequence of a widget not fitting its row, and the
flow closes anything nothing occupies. It is the one `repeatable` type: every other is a toggle,
because a second copy of one card is the same card twice, while two spacers are two different spaces.
The store gives each copy its own `slot` param, which is what keeps them distinct targets — identity
here is `(type + params)`, so without it `isPinned` would report the second one already present and
removing one would take them all.

**A gap is a drop target.** Dragging a widget over empty space lands it THERE rather than displacing
the nearest card: `WidgetGrid` measures each row's spare tail and offers it as a candidate alongside
the cells, when the dragged widget is narrow enough to fit. A gap's insert index is the first cell of
the next row — the array slot whose occupant would sit in that space.

⚠ The catalog of widget types is registered by **`App.jsx`**, eagerly. `DashboardPage` is lazy, so
registering from there leaves the registry empty everywhere else and every pin silently draws
nothing until the dashboard has been opened once.

## `palette/` — ⌘K onto everything the panel can reach

`CommandPalette.jsx` is mounted once by `App.jsx` and renders nothing until the hotkey fires; it owns
the hotkey itself rather than being handed one, so the shell does not have to know it exists. Anything
else can raise it with `paletteStore.open()`.

**It never invents a code path.** `palette/sources.js` builds every entry from stores the SPA already
holds, and a lifecycle verb there runs `runServerAction` gated by `verbGuard` — the same pair a server
card's button uses. A verb refused on the card is refused here in the same sentence, rollback works the
same way, and the audit row comes from the same place. The palette is a second **door** onto existing
capability, never a second implementation of it. That is also what makes it cheap: it is an index and
a keyboard over things that already work.

⚠ **Permission is applied when entries are BUILT, not at render.** An entry a role may not act on is
never constructed, so it cannot be matched, ranked, arrowed onto or run. Navigation asks `can`,
anything scoped to one node asks `canOn` — "aggregate for reach, scoped for action", as everywhere.

`palette/score.js` is the matcher: subsequence, not substring, so `mcsrv` finds `minecraft_survival`.
It **imports nothing**, deliberately — ranking is exactly the kind of logic that rots silently, and
being import-free means it can be asserted straight out of the module graph without a browser.

Two behaviours worth not breaking. A **destructive verb always arms**, whether or not anyone is
connected — one rule, nothing to reason about before pressing a key — and it lapses after the same
interval as `useConfirmAction`, so the pause learned on a card is the pause here. And **a theme
previews live while writing nothing**: arrowing sets `data-theme` on the document, `↵` calls
`themeStore.set`, Escape puts the stored one back.

It also **pins**, **backs up**, **copies a connect address** and **launches an install**. The line
those four sit on: an entry belongs here when it is one decision. Backing up is one, so it runs
(armed, like anything that changes the host). Copying an address is one, and it is the only entry a
**viewer** can run — an address is what a player needs, so it is gated on nothing but the server
being joinable, and it refuses in `ServerConnect`'s own words (`joinRefusal`, the counterpart to
`verbGuard` and `moderationOffers`). Installing needs a node, a name and a port, so the entry opens
the real form — it LAUNCHES, it does not act. Pinning and theme-switching are the two things that
deliberately leave the palette open, because you do several in a row.

**Nodes and filtered views are entries too.** A node by name, its journal, its resources and services
tabs, and the servers it runs — the leaves above are reached *through* a node, so a palette that
could not name one was missing the middle of a path it covered at both ends. The filtered
destinations (offline servers, servers with updates, crashed, installed games, the audit log's
warnings and failures) are the entry filters the router already addresses; each carries its count as
a subtitle, and **a count of zero means no entry** rather than a row leading to an empty page.

**Ranking learns, within a cap.** `palette/recents.js` holds a frecency table — a saturating use
count decayed by a one-week half-life — and `rank` takes it as an optional `boostOf` so `score.js`
keeps importing nothing. ⚠ The cap is the safety property: the boost can reorder entries whose text
scores are close and outweigh any `weight` a source declares, but it cannot lift a weak match past a
strong one, because a match at the start of a title is worth several times more on its own. Habit
breaks ties; it never overrules what was typed. The snapshot is taken **once per open** — running
something rewrites the table, and a boost that moved between keystrokes would reorder the list under
a cursor that had not moved.

**It moderates players, but only in scope.** Fleet-wide, "ban griefer123" has no target the palette
could name; inside one server the candidate set is small and known. Which verbs each player is offered,
and the sentence when one cannot run, comes from **`moderationOffers`** in `PlayerModeration.jsx` — the
counterpart to `verbGuard`, and for the same reason: a palette saying "Kick" where the roster's menu
says "the server isn't running" would be two answers to one question.

⚠ **The roster is the one thing the palette FETCHES.** Everything else is derived from stores already
in memory. It reads through the keyed `playersStore`, so the Players tab and the palette share one
hydrate, and only when the scoped server is **online** — which is the moderation gate itself, so it
never reads a roster whose every row would be disabled. (Gating on the player *count* instead was
wrong for the case that most needs this: unbanning is what you do when nobody is connected.)

**A query that matches nothing offers the assistant, as a row.** Not a fall-through: it has to be
selected and confirmed, and a typo simply sits there unchosen. ⚠ It does **not** send — the seed
lands in the composer and focuses it, so the last word is a person pressing Enter on their own text,
the same rule a voice note follows. It appears only when there is nothing else and only where an
assistant can actually be reached; offering to ask a leaf this host has no route to is a row that
cannot do what it says.

The chin's type and keycaps are `.chat-cmdmenu__hint`'s, value for value — the slash-command menu is
the panel's other command surface and the two read as one family. Its left half names what `↵` will
do, which is what earns it the height: it is where a destructive verb's consequence gets stated in
full without crowding the row.

## `<Rail>` — the horizontal shelf

`Rail.jsx` renders a brief card whose body is a scroll-snapped row of `items`: the
dashboard's Servers and Catalog cards use it to reach their whole collection. It is
a **real scroll container, not a transform carousel** — that is what makes a touch
swipe native scrolling (no swipe-vs-tap ambiguity against cards that are themselves
click targets), keeps trackpad/shift-wheel working, and scrolls a tab-focused
off-screen card into view. There is no slide index, so nothing can desync from what
is on screen; the arrows only call `scrollBy`.

Card width comes from `--rail-per-view` in **container query units** (`kit/rail.css`),
so the rail follows the sidebar and the assistant dock, which resize it without
resizing the viewport. It is deliberately fractional — the cut-off next card is the
primary "there is more" affordance, with an edge fade behind it and the arrows third.

Two things a caller has to respect:

- **The track carries `data-hswipe`**, which is how `hooks/useMobileSwipe.js` knows
  to leave the gesture alone. That hook arms the nav drawer anywhere within 28px of
  the viewport edge, and a rail's leftmost card sits inside that zone — drop the
  attribute and a swipe meant for the rail also opens the drawer.
- **Pass `disabled` while the dashboard is in Customize mode.** Sideways scrolling
  otherwise fights `DashLayout`'s band drag.

## `<ConsoleView>` — the shared console card, and why it scrolls itself

One card renders the game console (`ConsolePanel`), the host-logs tab and a leaf's journal, so a feed
reads the same wherever it is opened. Three things about it are load-bearing:

- **The feeds are capped windows, and every line carries its own identity.** `ConsolePanel` keeps the
  newest 1000 lines; `logsStore`/`leafLogsStore` keep 2000. A window that drops its oldest line shifts
  every array index, so rows key on the line's own identity — the console bridge's `seq`, journald's
  cursor — and carry it as `data-k`. Keyed on the index instead, one arriving line rewrites the text
  of every row on screen. The same identity is what the tail, the anchor and the unread count all read;
  a feed whose lines have neither `id` nor `seq` falls back to the index and loses all three.
- **Following is the reader's position, not a mode.** The body tails only while it is within
  `NEAR_BOTTOM` of the bottom. Scrolled away, it anchors the topmost visible row and puts it back after
  each change, so trimming the top doesn't slide what is being read; the pill counts what arrived and
  goes back. `.console-card__body` sets `overflow-anchor: none` **on purpose** — the browser's own
  anchoring would be a second mechanism compensating for the same shift, and it isn't available on
  every engine this installs to.
- **The view only ever moves itself through `moveTo`**, which drops the scroll event it raises; the
  resulting position is stated outright by whoever called it. The compensation runs per arriving line,
  and letting it re-enter through its own event re-scans the rows above the viewport each time.

- **The find compiles to one matcher, and everything reads it.** Match case, whole word and regular
  expression (`Alt+C`/`Alt+W`/`Alt+R`) build a single object; the count, the *only matches* filter, the
  highlight and the stepper all go through it, so what is counted cannot disagree with what is marked.
  Whole-word is tested on the match — an edge is a boundary unless word characters sit on both sides —
  because wrapping the pattern in `\b` asserts against the character beside it and finds nothing for a
  query like `[warn]` or `--verbose`. **A pattern that won't compile is reported, never answered with
  zero matches**: half a regex is what typing one looks like, and "no matches" would claim the text is
  not in the log. The search runs over the line the reader SEES — the `§…§` markers are stripped and
  the ranges mapped back onto the segments — so a name cannot split a match, and `^` anchors the line
  rather than a segment.
- **The window is not the log.** *Load earlier lines* reads back through the run in 500-line steps,
  each asking for the window ending at the byte offset the last one reported (`?before=`), so pages
  meet exactly while the server keeps printing — a line count from the end would overlap or skip.
  Those lines are exempt from the live cap, which exists to stop a feed growing on its own. *Download
  the full log* streams the entire run from the watchdog; it is a `blob()` fetch and not an `<a href>`
  because a top-level navigation carries no bearer. **Clear the view hides and never deletes** — the
  count in the head keeps reporting what the feed holds, and the emptied body says so.

Behaviour here is proven in a real browser (`scripts/visual-harness/console-follow.mjs`,
`console-tier2.mjs` and `console-search.mjs`, both engines) — jsdom lays out nothing, so the smoke can
prove the window's SIZE but not that it holds still, and nothing in jsdom saves a file. The search
harness recomputes every expected count from the text on screen with a second implementation, so a
matcher that agrees with itself still fails it.

## Lifecycle buttons: `verbGuard` is the one answer

`ServerActions.jsx` owns both halves of every start/stop/restart/update control. `ServerActionButton`
is the button (confirm-first arming, the job state, one `variant` per surface's chrome);
**`verbGuard(server, verb)` is whether that verb can run right now and the sentence explaining why
not**. The hero, the server tile and an alert card's suggested action all ask it, which is the point
— a card offering Update while the hero refuses it would be two answers to one question. It checks
the watchdog, the observed run state, and (for `update`) whether there is anything to apply; it
deliberately does **not** check tier, which decides whether the control renders at all
(`serverOperable`), a different question.

**Pending work is THREE states, not two: idle · queued · running.** A queued job is one a node has
accepted and not yet reached, which a batch can leave sitting for as long as the work ahead of it
takes. Its rendering is deliberately **not** the pending one — no spinner, because nothing is
spinning — and the label carries its place in the line (*"Stop queued · 3rd of 8"*), a count and
never a predicted time. Every button on the server locks while one is queued: the work is committed.
The phase is derived once by `lib/hooks/useJobPhase.js` and spread into each button, so the tile, the
hero and an alert card's action cannot disagree about it.

⚠ Two variants are too narrow for the sentence, measured in a browser: the tile's quick row is three
equal grid columns (~82px of label each) and the hero's button is a fixed 136px. Both drop the verb
— which the button already says, by its icon and its slot in the row — rather than let an ellipsis
eat the position, which is the one thing only the label can carry. The tooltip keeps the sentence.

⚠ A refused verb renders **disabled with its reason** wherever the control has a fixed home — the
hero's chip row, the tile's quick row, an alert card's suggested action. kgsm-api's `CommandGate` 409s
an update on a running server, so the button says "Server must be stopped before updating" before the
click; hiding it there would leave an operator hunting for a control that was on that surface
yesterday.

**A PROMOTED control is the exception, and the server card's update CTA is the one.** It has no fixed
home: it is a full-width button the card puts in its connect row only while `verbGuard` allows
`update`, borrowing a row that is dead weight on a stopped server (nothing to join, no address to
copy). Nothing is displaced and nothing goes missing, because the card's own announcement is the
`.server-tile__update` chip on the artwork — present in **every** run state, carrying the target
version, and carrying the guard's refusal in its tooltip when there is one. So the card states the
fact always and offers the action only when it would work, and no control on it is ever disabled.
The reason this lives on the artwork rather than in the body is measured, not stylistic: an update
must not change the card's height, since a CSS grid row stretches to its tallest item and one taller
card pads out every sibling in its row.

`ServerActionButton`'s `cta` variant is that button, and its optional `label` prop is why it can read
"Update to 2.0.55" while still reporting the verb's own words ("Updating…", "Confirm?") in flight.

`AlertCard`'s `useAlertActions` resolves the backend's `actions[]` through the same guard. The
backend chooses the **verb** (its catalog is shared with Web Push, so a crash cannot suggest Stop on
a phone and Restart here); this side chooses the **wording and the chrome**, and re-derives every
gate live. An unrecognized kind draws nothing rather than guessing.

## `batch/` — one verb, a set of servers

Selecting servers and arming one run over them. Three pieces, and the split is the point: what is
predicted, what is armed, and what the nodes actually said.

- **`preflight.js`** — the partition. It adds the two gates `verbGuard` does not cover: a server with
  work already in flight (`verbGuard` reads status only, so a preflight that skipped this would report
  refusals as failures), and per-host permission (a selection can span nodes this person operates
  unevenly — those are refusals, not errors, and are dropped before dispatch because a node's batch
  endpoint is Operator-gated for the whole request). It also holds the cumulative capacity forecast:
  `capacityHint` answers for one server against a live `MemAvailable` reading and does not compose
  over a set, so each member is judged against what the ones before it have already committed.
- **`SelectionBar.jsx`** — the bar that appears once something is picked. It states the count, the node
  count whenever the selection crosses more than one, and how many of the selection each verb could
  actually run against. *"Select all N matching"* deliberately lives in the page's **toolbar** instead:
  it is how a selection starts, and a control that only appears once you have selected something
  cannot be the thing that starts one.
- **`BatchPreflight.jsx`** — the sheet, and the one place a run is armed. **Once, for the whole run**:
  the safety is the sheet stating the count, the refusals and the players lost, not a gesture repeated
  N times, because a confirm clicked twenty times is read zero times. The wording **escalates** when
  the selection is every running server (it leads with the player total and says so in those words);
  the gesture does not, because stop is reversible and uninstall is excluded from batching entirely.
  Pressing it hands off to `lib/batchRun.js` and the sheet switches to the run's result.

- **`RunsBoard.jsx`** — what the whole cluster is doing, and how it is going. It is the `fleet.runs`
  dashboard widget and nothing else: fleet-scoped, so it takes no `hostId`, which is what makes it
  offerable from the Add-widget catalog at all. The board hydrates `stores/batches.js` and renders
  one card per **run**, reassembled by grouping the nodes' batches on the client-minted `runId` — so a
  run this browser never dispatched reads exactly like one it did. Opening a card shows each node's
  share and every member's standing. **Cancel is here**: one `DELETE` per node holding a share,
  addressed only to the nodes this person may operate, stopping **pending** members and naming what
  was already running and could not be stopped.

  It is a widget somebody pins rather than a permanent sidebar tray because a run is born on the
  Servers page and settles in seconds, and the badge for it sat empty in every session that never
  fired a bulk action. `host.jobs.queued`/`host.jobs.running` answer the per-node question and are
  bound for that reason.

⚠ **The two screens are different on purpose.** Everything before the press is a prediction this
client made so it could explain itself; everything after it is read from the nodes' answers, which may
contradict it — each node's `refused[]` is the authority for its own servers, and a node that never
answered is reported **undispatched**, never counted as a failure.

## `<Toasts>` / `<NotificationsPanel>` — outcome reporting

`lib/toasts.js` holds one store; `Toasts.jsx` renders the live cards (portalled to
body, mounted once per surface) and `NotificationsPanel.jsx` renders the history
from the sidebar's foot.

**The rule: a toast reports the outcome of something the user DID — never something
that merely happened.** Fleet events already have the Alerts feed, the tiles and
Recent activity; routing those here would bury the panel during a mass restart.

It exists for the **shell-level** handlers only. Every write path that owns a
component already renders its error beside the control that failed
(`ConsolePanel`, `ServerNotice`, `PlayersTab`, `ServerSettings`) and that is the
better place for it — `App.jsx`'s lifecycle and install handlers own no control,
which is why they are the ones that route through `toast.fromError`. Don't convert
a working inline error into a toast.

The **history is client-side** (`localStorage krystal:notifications`, newest 50,
7-day cap) and is **not** a duplicate of the audit log. kgsm-api writes its audit
row from the *engine echo*, so every command it refuses up front — unknown verb,
unknown server, an inadmissible no-op, a command already in flight — is answered
before the engine is touched and **never produces an audit row**. Those refusals
exist nowhere else. The audit log stays the authority for what happened to the
fleet; this records what was asked for and how it went. The panel deliberately
offers **no link** to the audit log: none of these rows are in it, so a "see more"
would promise a continuation of this list that isn't there.

⚠ Keep **Notifications** distinct from **Alerts**: Alerts are AlertEngine
conditions about the fleet, server-side and the same for everyone; Notifications
are yours and this browser's. The foot placement and the `bell` vs `triangle-alert`
icons are what hold them apart.

⚠ And distinct from the **Runs** board (`batch/RunsBoard.jsx`), which is server-side truth about the
fleet — work the nodes are executing, hydrated from every one of them, the same for everybody and
outliving this tab. This one is per-browser and is what *you* did in it. Runs lives on the dashboard
as a pinned widget, not in the foot beside this: two trays a foot apart would read as one list, and a
run somebody else started would pass for something you did yourself.

## The rest, by rough category

- **Cards / lists:** `ServerCard`, `LeafCard`, `GameCard`, `AlertCard`, `BriefCard`,
  `CardTable`, `HostCardBody`, `RecentActivity`, `NeedsAttention`,
  `ContextualAlerts`, `Skeletons`, `Pagination`, `Rail`.
- **Server surfaces:** `ServerHero`, `ServerActions`, `ServerConnect`,
  `ServerNotice`, `ConsolePanel`, `ConsoleView`, `InstallModal`, `SubTabs`,
  `Toolbar`.
- **Metrics / charts:** `KPI`, `StatTiles`, `TimeSeriesChart`, `DashLayout`.
- **Editor / logs:** `CodeEditor` (Monaco), `LogConsole`, `VoiceNote`.

⚠ **`VoiceNote`: the host transcribes, whenever it can.** `useVoiceRecorder({ transcribe })` takes the
host's recogniser, and given one it is the only transcriber used — the browser's own
`SpeechRecognition` is the fallback for a host with no speech leaf. Two recognisers is two spellings
of every server name, and Chrome's ships the audio to Google, which is a surprising thing for a
self-hosted panel to do with somebody's voice. The transcript comes back to the composer rather than
becoming a turn: recognition is wrong often enough that sending it onward unseen would ask the
assistant things nobody said. A failed transcription **keeps the recording** and the send button
retries it.
- **Primitives / helpers:** `Modal`, `Select`, `Icon`, `settings-primitives.jsx`,
  `host-helpers.jsx`.

## Conventions

- **Never hardcode a color** — every color comes from a CSS custom property
  (`var(--…)`); add/extend a token in `../styles/tokens.css` instead. See
  `../styles/CLAUDE.md`.
- Monaco can't read CSS vars → `CodeEditor.jsx` samples resolved tokens at runtime
  and re-themes on theme flip. Follow that pattern for any canvas/3rd-party
  surface that can't inherit the cascade.
- Presentational only: take data + callbacks as props (or read a store); don't
  call `setRoute` or `api.*` from a leaf component — hand that to the page/shell.
