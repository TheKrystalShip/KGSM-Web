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

⚠ The catalog of widget types is registered by **`App.jsx`**, eagerly. `DashboardPage` is lazy, so
registering from there leaves the registry empty everywhere else and every pin silently draws
nothing until the dashboard has been opened once.

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
is the button (confirm-first arming, the job spinner, one `variant` per surface's chrome);
**`verbGuard(server, verb)` is whether that verb can run right now and the sentence explaining why
not**. The hero, the server tile and an alert card's suggested action all ask it, which is the point
— a card offering Update while the hero refuses it would be two answers to one question. It checks
the watchdog, the observed run state, and (for `update`) whether there is anything to apply; it
deliberately does **not** check tier, which decides whether the control renders at all
(`serverOperable`), a different question.

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
