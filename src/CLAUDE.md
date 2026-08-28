# src/ — source map & module boundaries

This directory is the whole SPA. The **root `../CLAUDE.md`** owns the
architecture narrative (connection model, data layer, auth/RBAC, styling,
where-truth-lives) — read it first. **This file owns the *structure*:** what
lives where, and the module boundaries to keep.

## Two surfaces, one source tree

This repo builds **two** SPAs. `index.html` → the Control Panel; `assistant.html` → the standalone
assistant served by the kgsm-assistant leaf. Separate Vite configs, separate `dist/`s, separate
deploy scripts — so each host serves only its own bundle — over one source tree.

`src/chat/` is the conversation, shared by both. A divergence between the dock and the standalone
page would be a **bug, not a variant**, so there is nowhere for one to drift from the other:
everything that differs between the surfaces is a PROP, with defaults describing the smaller one.
`src/pages/ChatPage.jsx` is the panel's thin wrapper that injects its cluster wiring (host picker,
server roster, per-host roles, review mode, node attribution); `src/assistant/` is the standalone
shell and passes almost nothing.

**`src/assistant/` is a two-screen app**, not just a chat mount: `App.jsx` (auth gate + shell),
`SettingsPage.jsx` (Appearance / Notifications, built from the panel's own settings furniture) and
`route.js` — its own hash bridge, because the panel's `lib/router.js` is a cluster vocabulary
resolved through a per-node policy and importing it would drag both in. Routes are **hash**-shaped
(`#/settings`): the leaf serves this bundle with no SPA fallback, so a path-shaped `/settings` would
404 on a refresh. Its chat gets the settings entry points through one prop (`onOpenSettings`); the
panel passes none, since its shell already leads there.

Static assets divide the same way: `public/` is the shared floor (fonts, brand mark) and each
surface's own half — the manifest, service worker and icons that make it an **installable app in
its own right** — is laid over the top from `public-panel/` / `public-assistant/` by
`scripts/public-overlay.js`. Neither app's artwork ever ships in the other's bundle.

**The standalone surface must not reach the Control Panel's data layer** — no `apiClient`, no
store barrel, no `config.js`/`CONNECTIONS`, no `persona`, no router. It talks to one leaf on its own
origin and has no notion of a node. `npm run check:assistant` walks the import graph and fails on
those roots, because tree-shaking will NOT save you: a static import of a module with side effects
is retained whether or not its exports are read. When a shared component needs something from that
layer, **cut the edge** — split the module or take the value as a prop — rather than widening the
list. `components/AccountAvatar.jsx`, `components/ConnectivityBanner.jsx` and `lib/oauthFragment.js`
all exist because of exactly this.

## The layering (top → bottom, one direction)

```
main.jsx            boot: styles → theme → OAuth-fragment capture → mount <App/> in <ErrorBoundary>
  └ App.jsx         the SHELL — auth gate, layout chrome, dock, modals, cross-cutting state
      └ components/AppRouter.jsx   ROUTING ONLY — route.kind → lazy page + callbacks
          └ pages/  one file (or folder) per route/tab; pages read stores DIRECTLY
              └ lib/         the data layer + policy (apiClient, adapters, stores, persona, router)
                  └ components/  presentational + shared UI primitives (Modal, KPI, cards…)
```

Dependencies point **downward only**. A page imports from `lib/` and
`components/`; `lib/` never imports a page; `components/` are leaf UI. Don't add
an upward edge (a store importing a page, a component reaching into a page).

## Three boundaries — keep them

1. **`App.jsx` is the chooser and the shell, not a page host.** It picks between
   `AuthGate` (no identity, or one holding nothing) and `AppInner`, and owns the layout frame
   (sidebar / `<main>` / assistant dock / FAB), the global modals (install,
   first-run), and cross-cutting handlers (`handleAction`,
   `confirmInstall`, logout). It holds **no page bodies** — don't inline one
   into `App.jsx`.

2. **`AppRouter.jsx` is routing only.** It maps `route.kind` → the right lazy
   page and threads callbacks. It reads assistant/dock state from
   `useAssistantDock()` (context) and lets pages read domain data from the
   singleton stores themselves — it does **not** fetch data or hold page state.
   Every page is `React.lazy(...)` behind one `<Suspense>` (route-level code
   splitting). A new page = add a `React.lazy` line + one
   `{route.kind === "x" && <Page .../>}` branch. It is not a data-threading hub.

3. **Big screens live in focused folders and modules — don't monolith.** The
   shell's satellite pieces are their own modules
   (`components/AssistantDockContext.jsx`, `components/Breadcrumb.jsx`,
   `components/BootLanding.jsx`, `components/MobileNavToggle.jsx`,
   `hooks/useRouteSync.js`, `hooks/useMobileSwipe.js`, `lib/authStorage.js`);
   the chat lives in `chat/` (shared by both surfaces; see above);
   `pages/DiagnosticsPage.jsx` and `pages/PerformanceTab.jsx` are thin entries
   over `pages/diagnostics/` and `pages/performance/`; the stores are domain
   modules under `lib/stores/` (see `lib/stores/CLAUDE.md`).

   The rule: **a page over ~400 lines gets its own `pages/<name>/`
   folder** with the entry file thin and the pieces beside it — not another
   append to a growing file. Each directory has its own `CLAUDE.md` with the
   local conventions.

## Directory guide

| Dir | What it is | Local doc |
|---|---|---|
| `pages/` | Route + tab components; `pages/<name>/` folders for the split ones | `pages/CLAUDE.md` |
| `lib/` | Data layer + policy: apiClient, adapters, stores, persona, router, config | `lib/CLAUDE.md` |
| `lib/stores/` | Domain-split reactive stores; `lib/stores.js` re-exports them | `lib/stores/CLAUDE.md` |
| `components/` | Shared/presentational UI + the `<Modal>` primitive | `components/CLAUDE.md` |
| `hooks/` | `useRouteSync` (URL↔route sync), `useMobileSwipe` (drawer/dock gestures), `usePortalPopover` (portalled popovers — shared by chat and the panel) | — |
| `styles/` | Plain CSS: `tokens.css` → `kit.css` (barrel over `kit/`) → `consumer.css` | `styles/CLAUDE.md` |

## Guardrails (the ESLint gate — see root `../CLAUDE.md`)

`npm run lint`: `no-undef` and `react-hooks/rules-of-hooks` are **errors**, keep
them at zero. `react-hooks/exhaustive-deps` + `no-unused-vars` are warnings.
Several intentional dep-array exceptions carry an inline
`// eslint-disable-next-line react-hooks/exhaustive-deps -- <reason>` — keep the
reason when you touch them. After any change here: `npm run lint` (0 errors),
`npm run build`, `npm run smoke` against a live api.
