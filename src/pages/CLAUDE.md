# src/pages/ — pages & routing

One component per route (and per server/host sub-tab). Pages are the **only**
place that composes `lib/` stores + `components/` into a screen. They are all
**lazy-loaded** by `components/AppRouter.jsx` behind a single `<Suspense>`.

## How routing works (the contract)

The URL hash is the source of truth. The pipeline (see `../lib/router.js` for the
full scheme, and `../hooks/useRouteSync.js` for the sync):

```
location.hash  ──parseHash──▶  route {kind, id?, tab?, hostId?, status?, filter?, serverId?, severity?}
route          ──routeToHash──▶ location.hash        (Back/Forward, deep links, refresh all work)
AppRouter: route.kind ──▶ the matching lazy <Page/>
```

- **`route.kind` is the internal vocabulary; the URL word can differ on purpose**
  — `kind:"attention"` ↔ `#/alerts`, `kind:"chat"` ↔ `#/assistant`
  (`kind:"cluster"` ↔ `#/cluster`, with the pre-cluster `#/diagnostics`/`#/hosts`
  words still resolving). Keep both sides in sync in `router.js` when you add a route.
- **`persona.resolveRoute()` is the routing chokepoint** (`../lib/persona.js`): a
  forbidden route is remapped to the persona's home *before* it enters state or
  mounts. `App.setRoute` runs every route through it. Don't bypass it.
- Most pages receive **navigation callbacks** from `AppRouter` (`onOpenServer`,
  `onAction`, `onTabChange`, `onAsk`, …) — they don't call `setRoute`
  themselves. They read **domain data straight from the singleton stores** via
  `useStore(...)`, not from props threaded down the shell.
- **A component that can be PINNED reaches the router through `useNav()`**
  (`components/NavContext.jsx`) instead, because a widget on the dashboard has no
  page above it to hand it anything. A card that is rendered both ways takes the
  prop and falls back — `const open = onOpenServer || nav.openServer` — so it works
  on its own page and pinned, with no call site changed. `DashboardPage` takes no
  navigation props at all: every card on it is a widget.
- **Lifecycle verbs are `lib/serverActions.js`**, not a callback. `runServerAction`
  owns the optimistic patch, the rollback and the wording, so any surface offering a
  Start button does all three. `App.jsx`'s `handleAction` only resolves WHICH server
  the shell means when a caller names none.

### Adding a page/route

1. Add the `route.kind` ↔ hash mapping to `../lib/router.js` (both `routeToHash`
   and `parseHash`).
2. `const NewPage = React.lazy(() => import("../pages/NewPage.jsx"))` +
   `{route.kind === "new" && <NewPage .../>}` in `AppRouter.jsx`.
3. If it's gated, wire the capability in `../lib/persona.js` so `resolveRoute`
   protects it.

## `auth/` — the screens in front of the app

`auth/` is not on the router. `components/AuthGate.jsx` renders these instead of the shell,
so they answer to no `route.kind` and no persona: `NodePage` (which host), `SignInPage`
(one card, two tabs, against that host) and `PendingPage` (signed in, holding nothing).
`AuthChrome.jsx` holds what all three share. The domain logic — probing a node, the two
credential calls, the pending session and the field checks — is `lib/authFlow.js`, so these
files are the rendering and nothing else.

Two rules they encode. **A refusal sits with what it is about**: a wrong password renders
above the username inside the form, while a host that cannot be reached renders above the
tabs, because it invalidates every door on the card rather than one of them. And **every
check here is also the node's** — the client validates shape so somebody is told while
typing, and the node decides.

## The split-page folders — keep the entry thin

Four screens were too big and were broken into folders (root-`CLAUDE.md` refactor
§3). The entry file stays thin (state + layout); the pieces live beside it.
**Don't fold these back into their entry file — grow the folder instead.**

| Entry | Folder | Holds |
|---|---|---|
| `ChatPage.jsx` (512) | `chat/` | thread/message/parts, evidence cards, context meter, host picker, `chatUtils`/`chatConstants` |
| `DiagnosticsPage.jsx` (290) | `diagnostics/` | `DiagOverview/Resources/Services/Logs`, host cards, `LeafConfigModal`, `diagHelpers` (the leaf card itself is `components/LeafCard.jsx`) |
| `PerformanceTab.jsx` | `performance/` | `PerfCards`, `perfHelpers` |
| `ServerSettings.jsx` | `serverSettings/` | `SettingsSections` |
| `DashboardPage.jsx` | `dashboard/` | `catalog.js` (the widget registrations), `widgets/` (the pinnable bodies), `fleetKpis.js` (the twelve figures), `DashFleetStrip`, `AddWidgetSheet`, `DashboardEmpty` |
| `leafConfig/LeafConfigPage.jsx` | `leafConfig/` | `LeafConfigRow`, `LeafConfigReview`, `leafConfigHelpers` |
| `GamePage.jsx` | `library/` | `GameOverview`, `GamePlacement`, `GameBlueprintTab`, `GameServersTab`, `BlueprintFileCard`, `BlueprintHostPicker`, `LibraryCreatePage` |

New rule of thumb: **a page pushing ~400 lines gets its own `pages/<name>/`
folder** rather than another append.

## Server, host & game detail = tabbed pages

`ServerDetailPage.jsx`, `DiagnosticsPage.jsx` (host detail) and `GamePage.jsx`
(a library blueprint) render sub-tabs via `route.tab` (`overview` is the default
and is omitted from the URL). A tab the persona can't reach is left out of the
strip and `safeTab` falls back to overview, so a stale URL never mounts an empty
body — the game page's File tab is operator-only on that basis.

**A tab's id, name and place in the strip come from `ROUTE_TABS` in `../lib/labels.js`**,
because a tab is a URL segment and the breadcrumb above the page names it too. The page
keeps what is its own — the badge counting its alerts, and which tabs this persona is
offered — and decorates the shared row. Add a tab there, not in the page. Every server
tab is backed by a real endpoint: `FileBrowser`, `ServerSettings`,
`PerformanceTab` and `PlayersTab` all render measured data.

**A tab whose backend can't answer says so — it never fills itself in.** A value
the API doesn't provide arrives as `null`/`"unknown"`/`[]` from `../lib/adapters.js`
and renders as "—"; a roster that can't be measured renders its own honest
not-measurable state rather than "0 players". Adding a tab means wiring its
endpoint, not inventing numbers to fill it. (Ecosystem-wide "never fabricate a
metric" invariant — see root `CLAUDE.md` and `../lib/adapters.js`.)
