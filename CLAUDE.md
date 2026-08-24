# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`kgsm-web` builds the KGSM ecosystem's **web surfaces**: the **Control Panel** and the
**standalone assistant** served by the kgsm-assistant leaf. Two Vite builds over one source tree,
sharing `src/chat/` — the conversation is the same code in both, because a divergence between the
dock and the standalone page would be a bug, not a variant. Everything that differs is a prop.
⚠ The standalone surface must not reach the panel's data layer; `npm run check:assistant` enforces
it (see `src/CLAUDE.md`). The Control Panel is a standard
Vite + React 18 (JSX) single-page app, ported from the no-build `krystal-design`
prototype. It is a **runtime multi-host client**: it reads a localStorage
registry of `kgsm-api` hosts and talks to them over `fetch` + SSE. The
`README.md` covers quick-start and the file layout; this file covers the
architecture and the landmines.

**Per-directory docs (read the one for wherever you're working):** the source
tree carries focused nested `CLAUDE.md` files that lock in the 2026-07
architecture-cleanup refactor's structure — `src/CLAUDE.md` (the source map +
module boundaries), `src/pages/CLAUDE.md` (pages & routing), `src/lib/CLAUDE.md`
(data layer), `src/lib/stores/CLAUDE.md` (the domain-split stores),
`src/components/CLAUDE.md` (shared UI + `<Modal>`), `src/styles/CLAUDE.md` (CSS
tokens + the `kit/` barrel). This file stays the architecture/landmines narrative.

## Commands

```bash
npm install
npm run dev          # http://localhost:5173 — no host configured → the connect screen
npm run build        # → dist/  (minified, hashed, tree-shaken)
npm run dev:assistant     # http://localhost:5174 — the STANDALONE assistant surface
npm run build:assistant   # → dist-assistant/
npm run check:assistant   # the standalone bundle contains no Control Panel, and is fully styled
npm run deploy:assistant  # = deploy/deploy-assistant.sh — publish it into the leaf's wwwroot
npm run preview      # serve the built dist/
./deploy/setup.sh    # ONCE per host — verifies the wwwroot target exists and is yours
npm run deploy:prod  # = deploy/deploy.sh — build + rsync dist/ into the kgsm-api wwwroot, no API restart

KGSM_API=http://127.0.0.1:8096 npm run smoke   # against a RUNNING, AUTH-DISABLED kgsm-api
```

**Frontend-only deploys never restart the API.** kgsm-api serves this SPA
same-origin from its `wwwroot/` via ASP.NET `UseStaticFiles` (PhysicalFileProvider
— read from disk per request, no content cache), so `npm run deploy:prod`
(`deploy/deploy.sh`) just builds `VITE_API_BASE=self` and `rsync`s `dist/`
into the live `wwwroot/` (`/opt/kgsm-api/wwwroot`, owned by the service user → no
sudo); the bundle is live the moment the files land. Reserve the full
`kgsm-api/deploy/deploy.sh` (which bounces the systemd unit) for **API code**
changes — it also re-bundles the SPA.

This repo follows the same `setup.sh`-once / `deploy.sh`-forever pattern every
`kgsm-*` repo uses, and is the simplest case of it — the one project that needs no
privilege even at setup. It owns no systemd unit and runs no process of its own, so
`setup.sh` installs nothing and needs no polkit grant: it only verifies that the
wwwroot target exists and is writable by you, since kgsm-api's deploy is what
creates it. `deploy.sh` then builds and `rsync`s with **no sudo and no prompts**, and
refuses up front with *"run `deploy/setup.sh`"* when the target isn't there. The
three files in `deploy/` are self-contained, so a standalone clone deploys.

**There is an ESLint gate (`npm run lint`) but no typecheck or unit-test runner** —
don't hunt for `npm run test`. The lint config (`eslint.config.js`, ESLint 9 flat)
is deliberately NARROW: `no-undef` and `react-hooks/rules-of-hooks` are **errors**
(these are the static bug classes the build silently passed — see CHANGELOG v1.4.3:
a component used-but-not-imported, and a hook called after an early return);
`react-hooks/exhaustive-deps` and `no-unused-vars` are **warnings** (a real backlog
to work down, not a wall). Keep errors at zero. The other automated check is
`scripts/smoke-live.mjs` (`npm run smoke`): it boots the real Vite module graph in jsdom
against a RUNNING kgsm-api and asserts real backend data renders without crashing. After any
data-layer or route change, run `npm run lint` (0 errors), `npm run build` (no
import dangles), and `npm run smoke` against a live api.

Five things about the smoke are load-bearing enough to state outright:

- **It never mutates the host.** Every assertion is either a READ against the live backend or a
  WRITE INTERCEPTED at the fetch seam (assert the request the SPA builds, answer it synthetically).
  This is not fastidiousness: kgsm's event transport is a single host-wide journal
  (`/var/lib/kgsm/events/*.ndjson`) indexed by ONE kgsm-monitor, and **every** kgsm-api on the box —
  including the operator's `:8097` — merges its engine history from that one monitor. There is no
  such thing as a write scoped to the backend under test; anything reaching the engine lands in the
  operator's real audit log permanently and rides the live consumer out to their notification
  integrations. So: no `kgsm.sh events emit`, no engine-touching PUT/DELETE, and nothing requiring
  this process to sit next to the engine. A run leaves nothing behind because it writes nothing —
  not because it cleans up afterwards. Coverage this gives up (the journal→api→stream relay, the
  note's verbatim round trip through a SOURCED config) lives in kgsm-api's `AuditJournalRelayTests`
  / `ServerNoteRoundTripTests`, which own a disposable fixture.
- **It needs an AUTH-DISABLED backend.** It sends no bearer, so a real auth-enabled host
  401s every gated read. The backend it expects is
  `/home/heisen/tks/scripts/visual-harness/dev-api.sh` (`:8096`) — the harness lives at the
  workspace root, outside every repo, so it is named absolutely and runs from whichever repo is
  being worked in. The prod unit on `:8097` has auth ON, and the smoke refuses it up front with a
  message rather than degrading into a wall of failures. Run it as
  `KGSM_API=http://127.0.0.1:8096 npm run smoke`.
- **The backend URL is written to `.env.development.local`, not `.env.local`.** The vite
  server boots in "development" mode, and Vite ranks a mode-specific env file above a plain
  one — the committed `.env.development` (seeding `:8090`) beats `.env.local`, so writing
  there silently does nothing and the whole suite runs against the wrong port.
- **Monaco is stubbed with a `textarea`.** It is built for a real browser and throws from
  inside its own mount under jsdom, which surfaces as the *page* hitting its error boundary
  — every surface hosting it (blueprint editor, create page, file editor, chat draft) would
  be untestable. Its real behaviour is proven in Chromium by the visual harness; the smoke
  asserts the wiring around it.
- **Instances are DERIVED from the live roster, never named.** `PROBE`/`OTHER` come from
  `GET /servers`, because a hardcoded instance name rots the moment someone uninstalls it
  and then fails in a way that reads like an SPA regression.

**For VISUAL / layout testing (smoke is jsdom — it does NOT lay out CSS), use the
permanent headless-browser harness at `/home/heisen/tks/scripts/visual-harness/`**
(outside the repos on purpose, so it doesn't violate the no-test-runner rule).
Playwright + **Chromium and Firefox** (no sudo on this host) drive the real SPA against
a real **auth-disabled** dev kgsm-api with real data — this is the only way to actually
*see* a mobile/responsive/overflow bug rather than reason about the CSS. Flow:
background `dev-api.sh` (auth-off api on :8096, state sandboxed) + `dev-web.sh`
(Vite on :5190, seeded — leaves your `:5173` alone), then `node shoot.mjs
'#/servers/factorio-test/files' --device both --click 'manage.sh'` → PNGs in
`shots/` + overflow/footer-overlap diagnostics. See that dir's `README.md` for the
full recipe and gotchas (port waits, teardown, the `pkill -f` self-match trap).

**Chromium alone is not proof.** The engines disagree about real things — most sharply,
a percentage height resolves only against a *definite* containing block, and Chromium
resolves one against a flex-derived height where Firefox follows the spec and collapses
the element. `shoot.mjs --engine both --measure '<css>,<css>'` measures the selectors in
each engine, prints what they disagree about, and **exits 2** when they do. Use it for
anything resting on a percentage height, a flex/grid track, sticky/fixed positioning, or
`100vh`/`dvh`. ⚠ Firefox contexts take no `isMobile`/`hasTouch`/`deviceScaleFactor`
(Playwright rejects them), so a Firefox "mobile" run is the viewport only — check
touch- and DPR-dependent behaviour in Chromium.

**Monaco's own mounts are the live instance of that trap:** `@monaco-editor/react`
renders a `<section style="height:100%">`, so every editor wrapper must give it a
definite height. `.bp-editor__monaco-wrap` states a grid track (`minmax(0, 1fr)`) for
exactly this reason — the file browser's `flex: 1` works only because `.fb-card` already
fills its modal from a grid. Reach for the grid when you add an editor mount.

## The connection model (`src/lib/config.js`)

There is exactly ONE data path: the app always talks to real `kgsm-api`(s). There
are no fixtures and no mode switch. The only state distinction is **whether any
host is connected**, derived at module-load from `CONNECTIONS`:

- **≥1 connection** (a non-empty localStorage registry, or a `VITE_API_BASE`
  *seed*) → normal operation against the real backend(s).
- **0 connections** → the "connect a host" screen (`AddHostPage`), the entry point
  where you point the SPA at a kgsm-api.

`VITE_API_BASE` is an OPTIONAL single-host **seed** (a dev shortcut and how
`smoke` points the app at a backend), not a gate. `CONNECTIONS` is seeded once at
module load and then **grows in place**: cluster discovery (`clusterStore.discover`,
started from `stores/boot.js`) asks any reachable node for the converged peer
roster and registers the nodes it names, so the SPA drives the **cluster's** node
set rather than the addresses this browser was pointed at by hand. The array
identity never changes, so every consumer that holds the import sees a new node at
once; `subscribeConnections()` notifies the pieces that hold per-connection
resources (the SSE registry opens a stream per new node and re-hydrates). Connect
and disconnect still do a **full page reload** — they change identity and auth, the
same way login/logout/session-loss do. An appended peer needs no reload.

Each host carries its own base URL + bearer, and **routing is exact**: `apiV1Of(hostId)`
resolves the connection with that backend id or fails — throwing in dev, returning
null in prod so the call is rejected — because answering from another node is worse
than not answering. The single exemption is **cold boot**: a lone connection whose id
`GET /hosts` hasn't reconciled yet answers to any id. The fan-out and the SSE registry
already hold the connection, so they address it directly (`apiV1ForConn` /
`streamUrlForConn`) instead of round-tripping through an id. Multi-host (N≥2) fan-out
+ merge are real but some paths are still partly stubbed (see `merge.js`, `WIRING.md`).
`CONNECTIONS.length` (0 → connect screen, \>1 → fan-out) is a topology check, NOT a
mode flag — don't reintroduce a `LIVE`/`MOCK` duality.

## The data layer (`src/lib/`)

Components never touch the API directly. The flow is:

```
component → useStore(domainStore)            (store.js / stores.js — reactive cache, React 18 useSyncExternalStore)
domainStore.refresh() → api.get/post/patch   (apiClient.js — the ONE backend seam)
   fetch → adapters.js → store
realtime: liveStream.js (fetch-based SSE — one primary stream per host + per-view dynamic streams) → adaptStreamMessage → same stores
```

- **`apiClient.js` is the single seam.** Every store stays empty until it fetches;
  **call sites only ever see `api`**. It also owns connection health
  (`connectionStore` = REST reachability → cold-start/banner; `realtimeStore` =
  per-host SSE stream state, driven by `liveStream` `onMode`), the per-host auth gate
  (`api.host(id)` with 401-retry/silent-renew), `fanOut` (multi-host roll-up),
  `reconnectHost`/`reconnectAll` (drive the per-host sockets). **The assistant is not on
  this seam** — see below.
- **`adapters.js` — the honesty boundary.** kgsm-api emits a narrow, HONEST
  model. A value the backend doesn't provide maps to
  `null`/`"unknown"`/`[]` — **NEVER to `0` or an invented default** (the
  ecosystem-wide "never fabricate a metric" invariant; the UI renders "—").
  Don't hardcode game/domain data the backend can serve — plumb it through.
- **`merge.js`** — pure per-host → aggregated roll-up (every row carries its
  owning host id; merge only unions/de-dups, never invents attribution).
- **A server has TWO names, and they are not interchangeable.** `id` is the engine's — immutable,
  unique, path-safe — and is the key for every route, keyed store, SSE join, fetch path, widget param
  and React key. `name` is the mutable display label, free text, **not unique**, and never blank (an
  unlabelled instance reads as its id, which `adaptServer` guarantees with `be.name ?? be.id`). Render
  `name` wherever a person reads which server this is; pass `id` wherever something has to find it
  again. Where two servers could collide or identity is the point — the hero, the Identity card, the
  palette's rows — show BOTH, the id as secondary monospace. A rename arrives as an ordinary
  `server.patch` carrying a new `name`, so nothing needs invalidating: the row is patched in place and
  every surface re-renders. **Searching reads both**, because a person who knows an instance as
  `factorio-42` from a shell must still find it after somebody has labelled it "Sunday Server".
- **`assistantClient.js` + `assistantSession.js` — the SECOND seam, onto the assistant
  LEAF.** The assistant is a standalone service, so the chat talks to it **directly**, on
  the public origin the host's assistant capability reports (`info.url`), with a session
  the **leaf** issued — `kgsm-api` is not in the path of a turn, a confirmation, or a
  conversation read. `assistant.host(id)` mirrors `api.host(id)`'s shape (`conversations`,
  `turn`, `confirm`, …) against the leaf's own unprefixed routes. **A host that reports no
  public origin has no chat** (`ENOROUTE`, and the capability reads down) — it never falls
  back to kgsm-api's `/assistant/*` relay, which exists to reach a *peer* node's assistant
  and logs a warning when it serves the local one.

### Init-order: the lazy-import edges are deliberate

A few base-layer modules `import("...")`-lazily import upper ones (e.g.
`apiClient.js` defers `stores.js`/`sessionStore.js`/`alertsApi.js`). This keeps
the ESM graph **acyclic** — a carryover from the prototype's fixed global script
order. Converting one of these to a static `import` can reintroduce a cycle and
break boot. Read the comments before "tidying" an import.

## Auth, RBAC, capabilities

- **`sessionStore.js` — per-host identity (Model A).** Two doors: a KGSM username
  and password (`POST /auth/login`), and Discord as an SSO anchor. Each host mints
  its OWN short-lived access token (sessionStorage) + long-lived refresh token
  (localStorage, weeks), and resolves the user's **tier from that host's KGSM
  account for them** — a provider proves who you are and nothing more.
  `authRedirect.js` captures the OAuth fragment handoff at boot;
  `establishNodeSession` is the shared adoption path both doors end in.
  The per-host record carries `account` (`active｜pending｜unknown`) beside the
  tier, because a `none` tier is two facts: waiting on an admin, and unknown here.
  **`components/AuthGate.jsx` is everything in front of the app** — the node screen, the
  one sign-in/register card, and the wait for approval — and `App.jsx` renders it *instead
  of* the shell, so none of the shell's hooks and none of the data layer run for somebody
  who has not signed in. ⚠ A **pending** account cannot be carried by `sessionStore`: that
  store is keyed by backend host id, and the only way to learn one is `GET /hosts`, which
  is viewer-gated. The gate holds their session itself (`lib/authFlow.js`, sessionStorage,
  keyed by origin) and polls `GET /me` — bare-authorized precisely so a tierless caller can
  ask — until an admin approves them, at which point the ordinary per-host session takes
  over. There is no push here to replace the poll: `/api/v1/stream` is viewer-gated and the
  hub has no per-user delivery.
- **`SettingsIdentities.jsx` — connected accounts, per host.** Which provider accounts are attached
  to the caller's own KGSM account, and attaching or detaching one. Both writes confirm the password
  first (`POST /auth/reauth`), asked BEFORE starting rather than after being refused; a fresh sign-in
  already counts, so the common path is never prompted. ⚠ **The link flow is same-origin**: the start
  is an XHR (a bearer does not survive a top-level navigation) whose one-time ticket cookie the
  callback comes back with, and a cross-origin fetch does not store one. The callback returns to the
  configured frontend URL with `#linked=<provider>` or `#link_error=<code>`, which
  `oauthFragment.js` captures into a one-shot the section reports — and it rewrites the hash to
  `#/settings`, because the callback can only return to one address and landing on the dashboard
  after connecting an account tells nobody whether it worked.
- **`persona.js` — the authorization POLICY (single source of truth).** Roles are
  `admin｜operator｜viewer｜none`, resolved **per host** (you can be admin on one
  box, viewer on another). The rule: **`can(cap)` = aggregate (held on ANY host) for
  nav/reach; `canOn(cap, host)` = scoped for actions** — never substitute one for
  the other. `resolveRoute()` is the **routing chokepoint**: a forbidden route is
  mapped to the persona's home synchronously, so it never enters state or mounts.
- **`assistantSession.js` — the session with the LEAF, separate from the node's, and obtained
  silently.** The assistant issues and revokes its own tokens, but every surface on a host is the
  **same Discord application** (one `KgsmAuth__Providers__discord__ClientId`, differing only in redirect URI), so a
  browser signed into the panel has already authorized the assistant: its round trip completes with
  `prompt=none`, rendering nothing. It is chained onto a panel login (already mid-redirect, so it
  costs nothing visible) and otherwise fires as soon as there is a targeted assistant host — which
  is what bounds it, since no assistant means nothing targeted and several means nothing targeted
  until the user picks. The return leg lands here carrying an **`assistant_login=<hostId>` marker
  in the query**; that marker is load-bearing, because both logins come back to this origin with
  the same `access`/`refresh`/`error` fragment keys and without it the panel hands a leaf token to
  kgsm-api and gets a 401. ⚠ **One redirect per host per tab**, so a refusing leaf cannot loop the
  browser.
- **`capabilities.js` — per-host services** (metrics / assistant / watchdog), each
  with `provisioned` (offered?) × `status` (live health). **The assistant is
  per-host with no central fallback** — if a host doesn't expose it, that host has
  no assistant. An assistant whose capability names no public origin reads **down**,
  because the browser has nowhere to send a turn however healthy the leaf is.

## The shell (`App.jsx`)

Hash routing (`router.js`) — the URL is the source of truth (Back/Forward,
deep links, refresh all work). **Login/logout/session-loss do a full
`window.location.reload()` rather than swapping components in place** — this is
deliberate: several hooks live below the `!user` gate, so flipping `user` in
place would trip React's Rules of Hooks. Keep that pattern. Every server sub-tab
(Files, Settings, Performance, Players) is backed by a real endpoint; a value the
backend can't supply renders as "—" or its own honest not-measurable state, never
as a fabricated number.

**Notifications are two separate things here, and conflating them is the mistake
to avoid.** `<Toasts>` + the sidebar tray (`lib/toasts.js`) report the outcome of
something the **user just did**, in an open browser — they exist for the
shell-level handlers that own no control to render an error into, and a write path
with its own component keeps its inline error instead. **Web Push**
(`lib/push.js`, `pages/SettingsNotifications.jsx`, `public-panel/sw.js`) reports
what happened to the **fleet** while nothing was open, per device, opt-in, and
gated by both the host's rule and the person's own preference. Detail:
`components/CLAUDE.md`; the ecosystem-wide map, including how both relate to
kgsm-bot's Discord announcements, is in the workspace `CLAUDE.md`.

**There are TWO push surfaces, on two origins, and they are not interchangeable.**
The panel's is above. The standalone assistant's (`assistant/push.js`,
`assistant/SettingsPage.jsx`, `public-assistant/assistant-sw.js`) announces one
thing — an action the leaf staged and is waiting on you to approve — and it comes
from the **leaf**, with the leaf's own VAPID key. A subscription carries exactly
one application server key and belongs to one origin, so these can never share
one: the panel's worker is kgsm-api's and the assistant's is the leaf's, whatever
the browser. The browser mechanics they share live in `lib/pushBrowser.js`, which
takes its transport as a parameter and **imports nothing** — a shared module
reaching `apiClient` would fail `npm run check:assistant`.

## A component shows its data; it does not explain the system

**Never caption a reusable component with prose about how the system behind it works.** No footnote
saying where a node's queue is held, what a restart empties, that a run outlives the tab, or where
history lives instead. No empty-state subtitle restating the empty-state title in a sentence. No
sheet paragraph describing how work is paced. The site is not a tutorial on its own internals, and a
surface that has to caption itself to be understood has not been designed — the fix is the layout,
the label, or the data shown, never a paragraph underneath.

What a component *may* say in words is what it measured or was told: a count, a name, a verdict it
holds evidence for, a node that could not be read. The distinction is whether the sentence would
change if the data changed. *"1 node couldn't be read (DevTest)"* is data. *"A run keeps going
whether or not this tab is open"* is documentation, and belongs in `CLAUDE.md` or the CHANGELOG.

⚠ Assert the **absence**, not the presence. A no-prose rule is invisible to lint and to a build, and
the next edit that adds a helpful sentence will pass every gate. `scripts/smoke-live.mjs` and the
browser harnesses check the rendered component for explanatory phrasing and fail on it.

The **pin** is not prose and must survive any such removal. Where a surface is one card, the pin goes
in that card's `BriefCard` header and reveals on hover with the rest of the family
(`.chat-brief:hover .pin-btn`). Where it is not — the runs board — it sits on a row of its own
(`.opsq__head`), stays visible because nothing reveals it, and that row takes itself out of the
layout when the pin self-suppresses inside a widget.

## Styling & themes (`src/styles/`)

Plain CSS, no Tailwind/CSS-modules. Three files load in order (`main.jsx`):
`tokens.css` → `kit.css` → `consumer.css`. Everything is driven by ~40 CSS custom
properties — **a component must never hardcode a color; add or extend a token.**

- **`tokens.css` — the design-token source of truth, split by concern:**
  - A plain `:root` holds **structural** tokens (type, spacing, radius, edge,
    shadow, motion, layout). Shadow/ring/edge tokens may reference color vars;
    `var()` is late-bound, so they pick up the active theme automatically.
    Most of these are invariant, but a closed subset — **the shape surface** —
    may be re-valued by a theme; the block's banner names it exactly.
  - **Borders are the elevation model here** (~180 hairlines against two dozen
    shadows), so the whole shorthand is a token: `--edge` / `--edge-strong` /
    `--edge-accent`. Those are the OUTLINE OF A SURFACE; a one-sided
    `border-top`/`border-bottom` is a **divider**, keeps the longhand, and stays a
    hairline in every theme.
  - **Radii must go through `var(--r-*)`.** `--r-sm` carries ~260 of the kit's
    radius declarations and `--r-pill` another ~150, which is what makes corner
    geometry a one-line theme change. A literal `border-radius: 4px` is legal CSS
    and simply will not follow a theme.
  - **Color** tokens live in theme scopes: `:root, [data-theme="dark"]` (the
    default — applies with no attribute too) and `[data-theme="light"]`. Plus the
    overlay tokens that used to be hardcoded everywhere: `--veil-1/2/3` (white-alpha
    surface fills that flip to black-alpha on light), `--scrim-base` (modal/drawer
    backdrop, consumed via `color-mix` so each site keeps its own alpha), and
    `--scrollbar-*`. **The contract: a theme = the FULL color set re-valued.**
    Canvas-fade gradients use `color-mix(in srgb, var(--canvas) X%, transparent)`
    so they track the theme with no extra token.
- **`kit.css` is a BARREL, not a file to edit.** The old ~6,300-line monolith is
  split into **focused partials under `src/styles/kit/`** (`base`, `shell`, `page`,
  `server`, `catalog`, `modal`, `onboarding`, `dashboard`, `observability`,
  `controls`, `responsive`, `chat`, `rail`, `toast`, `settings`, `dock`, `hosts`,
  `states`, `extras`). `kit.css` only `@import`s them. **Add a rule to the partial that owns
  the domain — do NOT grow a monolith again.** Import **order is load-bearing**
  (later wins on equal specificity): keep the `@import` sequence; a new domain gets
  a new partial appended to the barrel. `@import` must precede other rules, which
  the imports-only barrel satisfies.
- **`consumer.css`** — a few consumer surfaces (connect/MOTD/login persona).

**Themes (`src/lib/theme.js`).** A client-only preference (`localStorage
krystal:theme` = `auto` or a concrete palette id from `THEME_OPTS`, default
`dark`) that NEVER round-trips to a
host — same model as favorites. `auto` resolves via `matchMedia` and live-updates
on OS change. Switching is **LIVE — no page reload** (swaps `<html data-theme>`,
which re-cascades instantly). **Both surfaces offer the same `<ThemePicker>` on a
Settings page** — the panel's under Profile, the standalone assistant's under
Appearance (`src/assistant/SettingsPage.jsx`, reached from the foot of the
conversation rail, or the header cog at phone width where that rail is hidden).
Landmines:
- **No-flash:** an inline boot script in `index.html` **and `assistant.html`** sets
  `data-theme` *before* the stylesheet applies. Both mirror `theme.js` — keep the
  three in sync.
- **Monaco can't read CSS vars** → `CodeEditor.jsx` samples the resolved tokens at
  runtime and re-themes (`vs`/`vs-dark`) whenever the theme store flips.
- **Always-dark media surfaces** (e.g. the cinematic server hero over key-art) pin
  the dark `--fg-*`/`--border-*`/`--*-fg` tokens **locally** so they stay
  light-on-dark in every theme — see `.hero--cinematic` in `kit/server.css`. Do
  that instead of per-theme special-casing.
- **Adding a theme:** add a `[data-theme="x"]` block (full color set) to
  `tokens.css`, then one entry in `theme.js`'s `THEME_OPTS` (id + label — `VALID`
  is derived from it, and every picker reads it), and the concrete-theme list in
  the `index.html` / `assistant.html` boot scripts, which cannot import.
- **The `cvd-*` colour-vision themes carry a measured guarantee** — status colours
  a stated ΔE2000 apart and every contrast floor held, *under a simulation of the
  deficiency each names*. Editing one of their tokens means re-running
  `node /home/heisen/tks/scripts/cvd-check/verify.mjs`, which re-measures the
  blocks straight out of `tokens.css`. A `THEME_OPTS` entry joins the pack by
  carrying a `cvd:` field naming who it is for; that field, not the id prefix, is
  what the pickers group and badge on. See `src/styles/CLAUDE.md`.
- **The tribute themes quote a screen from somewhere else** — The Matrix, Windows
  95, Winamp, LCARS, Cyberpunk 2077, the DOS blue screen, the Commodore 64, PICO-8.
  Their colours are chosen for recognition, so where a source palette can't carry a
  status family the nearest colour from the SAME source is used and the deviation is
  named in the block's comment; a foreign hue smuggled in to make the ramp tidy is
  the one edit to refuse. A `THEME_OPTS` entry joins them by carrying a `tribute:`
  field naming what it quotes, which the pickers group on and show as the swatch's
  tooltip.
- **The tributes are also the only themes that re-value SHAPE** — corner radius,
  border weight, elevation, the UI font, transition durations. An upstream editor
  scheme never had an opinion about a corner; a tribute is quoting a whole
  interface, so the shape is part of the quotation. Win95, DOS Blue and the C64
  set every duration to `0ms` because nothing on those screens eased; LCARS
  triples the radius ladder because the elbow *is* the design. A `THEME_OPTS`
  entry declares it with a `shape:` field saying in words what changes, since a
  swatch cannot show a duration. The permitted token set is fixed — see the
  structural banner in `tokens.css`, and don't widen it without a reason.
- **`npm run check:tokens`** fails on any `var(--…)` that names a property nothing
  defines. That is silent otherwise: an undefined custom property goes
  invalid-at-computed-value-time, so a border falls back to `currentColor` and a
  radius computes to 0, forever, with no warning from CSS or the build.
- **A theme named after an upstream scheme ships that scheme's values unretouched**,
  including where they are low-contrast by design — Solarized and Nord both are.
  Only the palettes this repo invents (the tribute and colour-vision packs) are held
  to contrast floors. `src/styles/CLAUDE.md` has the split.
- **Test themes with the visual harness's `--theme <id>` flag** (jsdom smoke does
  NOT lay out CSS, so it can't catch a theme regression). It seeds `krystal:theme`
  with whatever id you give it, so any palette in `THEME_OPTS` can be shot.

## Where truth lives, and stale-doc warnings

- **`WIRING.md` is the authoritative front↔back contract** — endpoint/realtime/
  schema diffs + the sequenced wiring plan. `§8` is the slice ledger; consult it
  for what's wired vs. pending rather than trusting prose elsewhere.
- **The README's "What's done vs. left" section is STALE.** Auth (Discord OAuth +
  per-host re-auth + refresh-token rotation) and the realtime SSE stream
  (fetch-based `text/event-stream`; protocol authority:
  `kgsm-api/src/Api/Realtime/CLAUDE.md`) are
  **built and committed** (see `authRedirect.js`, `sessionStore.js`,
  `liveStream.js`, and the git log) — they are NOT "left". **PWA installability is
  also built, for BOTH surfaces** — each installs as its own app, with its own manifest,
  production-only service worker and icons under `public-<surface>/` (see the
  "PWA / installability" section in `README.md`, `scripts/public-overlay.js`, and
  `src/lib/registerSW.js`). The Files/Settings/Performance/Players tabs are wired
  to real endpoints too. Genuinely still deferred: TypeScript, a unit-test runner,
  a full Workbox **precache** (`vite-plugin-pwa`; the current SW caches on demand,
  not the whole build manifest), and parts of multi-host fan-out. Describe current
  state from code + git, not from that list.

## Version tracking

- **Version source:** the `"version"` field in `package.json`
- **Packaging reads it via `deploy/version.sh`** — `./deploy/version.sh` prints the declared version, `--pkgver` prints the pacman-safe form. A package never restates a version number; it asks for one.
- Bump the version whenever you make a user-facing change (new feature, bug fix, behaviour change). Patch for fixes, minor for new features, major for breaking changes.
- Update `CHANGELOG.md` under `## [Unreleased]` with a brief entry for every meaningful change.
- A git tag matching the new version should be created on release: `git tag v<version>`.

## Documentation & comments: present-tense canon only

Prose in this repo — every doc, `README`/`CLAUDE.md` section, and in-code comment — describes
**how the thing works right now**, nothing else. History lives in the `CHANGELOG` and git
history; never duplicate it into docs or code.

- **No transitions.** Never "was X, now Y", "used to…", "changed from…", "no longer…", or any
  before/after framing. State the current rule flat: a sentence that only makes sense to a reader
  who knows what the code *used to* do is dead weight, because that "before" no longer exists
  anywhere in the code.
- **Tombstones leave no marker.** When something is removed — dying naturally as part of the work,
  or explicitly asked to be deleted — the removal is silent: no *"removed X"*, no *"X is gone"*,
  no *"deprecated, use Y instead"* pointing at a corpse. The prose reads as if it never was. Code
  kept while the thing that justified it was deleted gets a live present-tense reason to exist —
  or goes too.
- **No residue of the active work.** References only meaningful *during* a piece of work don't
  survive it: *"temporary shim for the rework"*, *"added to satisfy the new requirement"*,
  milestone/phase labels (*"per M2"*, *"the Phase 1 step"*). If a line's justification is the work
  that produced it rather than the system as it now stands, it goes.
- **Edits are replacements, not appends.** When changing an existing feature, rewrite the affected
  doc/comment fresh as if writing it for the first time — never append a correction under the
  stale version, and never leave the stale version standing beside the new. The current revision
  does not converse with prior revisions.

A reader six months from now should learn the system from the doc without knowing what it
replaced. If you catch yourself explaining a change, stop — that sentence belongs in the commit
message. When touching prose that already violates this, rewrite it to present-tense canon in
passing.
