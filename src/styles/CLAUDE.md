# src/styles/ — CSS, tokens, and the kit barrel

Plain CSS — **no Tailwind, no CSS-modules.** Three files load in order (from
`../main.jsx`): `tokens.css` → `kit.css` → `consumer.css`. Everything is driven
by the CSS custom properties `tokens.css` defines. The root `../CLAUDE.md` ("Styling & themes") has
the full theming narrative; this is the local map + the one rule that matters.

## The one rule

**A component must never hardcode a color — add or extend a token.** Colors live
in theme scopes in `tokens.css`; a rule references them via `var(--…)`. This is
what makes theme switching (and adding a theme) a data change, not a code hunt.

The same applies to **radius** and to a surface's **border**: write
`border-radius: var(--r-sm)` and `border: var(--edge)`, never a literal, because
those two tokens are how a theme re-shapes the whole app at once.

## A percentage size next to padding or a border must state `box-sizing`

**There is no global reset here** — `box-sizing` is `content-box` unless a rule says otherwise. So a
rule that says `width: 100%` *and* carries padding or a border resolves to **more** than the box it
was told to fill, and the element hangs out of its parent by exactly that padding and border. A
capped card (`max-width: 460px; width: 100%; padding: 28px`) renders 56px wider than its own cap.

Write `box-sizing: border-box` in any rule that states a percentage size alongside padding or a
border. Two things make this easy to miss:

- **The tag decides whether you get away with it.** A `<button>` and a `<select>` are `border-box`
  from the UA stylesheet, so a percentage width on one is safe whatever padding it carries.
  Everything else is not — **`<input>` and `<textarea>` included**, which is the surprise, along
  with every `div`, `span` and `a`.
- **Nothing fails, and the page-level overflow check reads clean.** `.app__main` sets
  `overflow-y: auto`, which computes `overflow-x` to `auto` as well, so an overflowing child scrolls
  *that column* and never widens the document. `scrollWidth > innerWidth` stays false while boxes
  visibly run off the right of a card.

**The guard is a pair of harness scripts**, because neither lint nor the build nor the jsdom smoke
can see any of this: `scripts/visual-harness/boxsizing-scan.mjs` reads every stylesheet and lists the
rules at risk (dropping the ones on a `<button>`/`<select>`), and `boxsizing-live.mjs` measures each
one's right edge against its parent's **content** box in both engines — driving the real surface
where it can reach it, and instantiating the class on its real tag under its real parent where it
cannot. Run both after adding a full-width control or card. `--ua` re-measures the per-tag defaults
the first script's filter rests on.

## Filling with a semantic colour? Take its `--on-*` ink

A semantic colour is used two ways, and only one of them is a contrast question.
As a **tint** behind muted text (`--success-bg` + `--success-fg`) the theme has
already tuned the pair. As a **fill** — a primary button, a filled badge, a status
chip — the colour becomes the background and something has to be legible on it.

For that second case there is one token per family, and a call site that writes
`background: var(--success)` reads `color: var(--on-success)`:

`--on-accent` · `--on-success` · `--on-danger` · `--on-warning` · `--on-update` · `--on-info`

**Do not reach for `--fg-inverse` or `--btn-accent-fg` there.** Both are right on
some themes and wrong on others — `--fg-inverse` is dark in most themes and light
in the tribute light ones, `--btn-accent-fg` tracks the teal specifically — and
CSS has no `contrast()` to pick an ink from a background it was handed, so the
pairing has to be stated per theme. `--on-accent` and `--on-success` *default
through* those two tokens, so a theme that tuned them keeps its tuning; most
themes re-value at least one of the six.

A per-theme `--on-*` is **not** a palette retouch, and does not conflict with
"an upstream scheme ships unretouched" below. Choosing black rather than white
type to lay *on* Solarized's red does not change Solarized's red. What is measured
is the pair, never the palette.

**`node /home/heisen/tks/scripts/visual-harness/semantic-contrast.mjs`** re-measures
all of it in a real browser — every theme the stylesheet defines, every filled
surface that renders on the routes it walks — and is the check to run after
touching any of these tokens or adding a filled surface. It also covers the
`--scrim-media` chips (below), compositing the scrim over white and black artwork
so the figure is the worst case rather than a flattering one.

## `--scrim-base` dims the page; `--scrim-media` sits on cover art

Two different jobs. A modal or drawer **backdrop** dims the page and belongs to the
theme, so it uses `color-mix(in srgb, var(--scrim-base) N%, transparent)` and
several light themes correctly give that a light value. A chip sitting on a server
card's **artwork** has an image behind it that nobody chose, so it takes
`--scrim-media` — deliberately not theme-scoped, dark in every theme — and its
content stays white. Borrowing `--scrim-base` there puts white type on white under
those same light themes. Same reasoning as `lib/art.js` keeping a separate dark
placeholder for the cinematic hero.

**`npm run check:tokens` is the guard.** It fails on any `var(--…)` naming a
property nothing defines — the failure mode CSS gives you for free otherwise, in
which `border-color: var(--typo)` silently becomes `currentColor` and
`border-radius: var(--typo)` silently becomes `0`. It cannot catch a raw literal, though: a
`border-radius: 4px` is valid CSS that simply will not follow a theme.

## `tokens.css` — the design-token source of truth

- Plain `:root` holds **structural** tokens (type, spacing, radius, edge, shadow,
  motion, layout). Most are invariant; a **closed subset** is re-valuable by a
  theme — see "Themes change shape too" below.
- **Color** tokens live in theme scopes: `:root, [data-theme="dark"]` (default —
  applies with no attribute) and `[data-theme="light"]`. Plus overlay tokens
  (`--veil-1/2/3`, `--scrim-base`, `--scrollbar-*`). **A theme = the FULL color
  set re-valued.**
- Adding a theme: add a `[data-theme="x"]` block here, then one `{ id, label }`
  entry in `../lib/theme.js`'s `THEME_OPTS` (`VALID` derives from it and every
  picker reads it), and the concrete-theme list in the `index.html` /
  `assistant.html` boot scripts, which cannot import.

## The colour-vision pack (`cvd-*`) is checked, not eyeballed

The `cvd-*` themes are built for viewers who cannot rely on hue, and they
carry a **measured guarantee**: every pair of status colours stays a stated
ΔE2000 apart, and every contrast floor holds, *under a simulation of the
deficiency the theme names*. The pack's banner comment in `tokens.css` states
the exact floors.

**Touching a `cvd-*` token means re-running the check** —
`node /home/heisen/tks/scripts/cvd-check/verify.mjs` — which parses these blocks
back out of this file and re-measures them. A palette here is a solved artefact,
not a preference: "that green looks nicer" is how a theme silently stops being
the thing it claims. That directory also holds the solver that produced the
palettes and a contact-sheet renderer; its `README.md` covers adding one.

The rest follows the same rules as any other theme: a `cvd-*` block is the FULL
colour set, and `THEME_OPTS` carries the `cvd:` field that puts it in the
picker's own badged section.

## Two kinds of palette live here, and they answer to different rules

**A theme named after an upstream scheme ships that scheme's values, unretouched.**
Nord, Dracula, Gruvbox, One Dark, Solarized, Catppuccin, Ayu, Monokai, GitHub —
all of them. Several are deliberately low-contrast (Solarized most of all: its
accents are tuned to sit at equal weight against *both* of its backgrounds, and
Nord's `#bf616a` red is 2.5:1 on its own card). Raising them would be raising them
off the thing that makes them recognisable, so **don't "fix" one**: measured
against WCAG floors the upstream palettes here carry well over a hundred
misses between them, and that is the house position, not an oversight.

**A palette this repo invents is measured.** The colour-vision pack and the
tribute pack are both ours, so both hold: text at 4.5:1 on every surface it lands
on, fills at 3:1, each `-fg` at 4.5:1 over its own `-bg` tint. The one relaxation
is `--fg-4` — placeholder and disabled rank, which the default `dark` theme itself
ships at 2.4:1.

**The split does not extend to the `--on-*` inks.** Every theme, upstream-named or
ours, states a foreground that clears 4.5:1 on its own fills, because that is a
choice about *our* type rather than about their palette — see the `--on-*` section
above.

## The tribute pack is quoted, not designed

The tribute themes — matrix, win95, winamp, lcars, cyberpunk, dos-blue, c64, pico8 —
take their colours from a screen somebody already knows, and the pack's banner
comment says what that costs. A source palette rarely carries five status
families: CGA has no orange, LCARS has no green, the VGA sixteen were drawn for a
black text mode and sit under 3:1 on a silver face, and most of the VIC-II is
unreadable against its own screen blue. Each block resolves that the same way —
the nearest colour from the SAME source, raised along its own hue where the floor
demands it, with the deviation named in the comment.

**Don't tidy a tribute's ramp with a colour the source never had.** That is the
edit that turns a quotation into just another dark theme, and it is invisible in
review because the result looks better. Contrast was measured on the surfaces each
value actually lands on, including each `-fg` on its own `-bg` tint, so a
retune means re-measuring rather than eyeballing.

## Themes change shape too — but only the tributes, and only these tokens

A theme may re-value a **closed set** of structural tokens: the radius ladder
(`--r-sm/md/lg/xl` and `--r-pill`), the border shorthands (`--edge*`), elevation
(`--shadow-*`), focus (`--ring-*`), `--font-ui`, and the motion tokens
(`--d-*`, `--ease-*`). The exact list is in the structural banner in `tokens.css`;
it is closed on purpose. **The type scale, the 4px spacing scale, `--font-mono`
and the layout metrics are not on it** — a theme changes how the furniture is
shaped, never where it stands, because a palette should not be able to break a
page's layout.

**Only the tribute pack uses it.** An upstream editor scheme re-values colour and
nothing else: Nord and Solarized were syntax palettes and never had an opinion
about a corner or a button. A tribute is quoting a whole *interface*, so shape is
part of the quotation — Win95, DOS Blue and the C64 set every duration to `0ms`
because nothing on those screens eased, and LCARS triples the radius ladder
because the elbow is the entire design language, not decoration on top of it.

Theme blocks are emitted after the structural block and match at equal
specificity, so a re-value in a theme block wins on source order — no `!important`
and no extra selector weight needed.

Two limits worth knowing before you extend this. A true Win95 **bevel** needs four
different edge colours and the `border` shorthand cannot carry them, so that theme
ships the honest half — a 2px flat edge — rather than a fake of the whole; doing it
properly means a shared button/card primitive, which does not exist (buttons
are per-domain classes spread across the kit partials). And **Monaco cannot read CSS custom
properties**: `CodeEditor.jsx` samples resolved colours at runtime, so the editor
follows a theme's palette but keeps the house geometry and font.

## `kit.css` is a BARREL — do not edit it, edit the partial

`kit.css` **only `@import`s** the focused per-domain partials under `kit/` —
read the barrel for the set and the order. Adding rules to `kit.css` itself
defeats the split; add a rule to the partial that owns the domain.

`page` is the odd one and is deliberate: the page **heading** (`.dash-head`) and the
in-page **tab strip** (`.subtabs`) are furniture every screen is built from rather
than anything a screen is about, so they sit in their own partial. That is what lets
the standalone assistant carry a settings page — it imports `page` + `settings`
without also importing the partials that style servers and dashboards.

- **Import order is load-bearing** (later wins on equal specificity) — keep the
  `@import` sequence. A new domain gets a **new partial appended to the barrel**,
  never a monolith.
- `@import` must precede other rules; the imports-only barrel satisfies that.

`consumer.css` — a few consumer surfaces (connect / MOTD / login persona).

## Two barrels over ONE set of partials

`kit.css` is the Control Panel's list; `assistant.css` is the standalone assistant's, and lists only
the partials a chat uses (it has none of the pages the others style). **The partial files are shared
and unedited** — only the lists differ — so the two surfaces are identical by construction and a
change to `chat.css` or a token lands in both. Never copy a rule between them; a copy is the drift
this arrangement exists to prevent.

A subset is the one thing that can silently go wrong: a widget whose rules live in a partial that was
left out renders unstyled and nothing fails. `npm run check:assistant` checks every class the
standalone surface can render against the CSS it ships, so add the missing **partial** when it
complains.

## Theme landmines (see root `../CLAUDE.md` for detail)

- **No-flash:** an inline boot script in `index.html` **and `assistant.html`** sets
  `data-theme` before the stylesheet applies — both mirror `../lib/theme.js`;
  keep the three in sync.
- **Always-dark media surfaces** (cinematic hero over key-art) pin dark tokens
  **locally** (see `.hero--cinematic` in `kit/server.css`) rather than
  per-theme special-casing.
- jsdom smoke does **not** lay out CSS — test theme/layout with the visual harness
  (`/home/heisen/tks/scripts/visual-harness/`, `--theme dark|light`).
