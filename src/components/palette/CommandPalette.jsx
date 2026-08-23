import React from "react";

import { Icon } from "../Icon.jsx";
import { Modal } from "../Modal.jsx";
import { useAssistantDock } from "../AssistantDockContext.jsx";
import { useNav } from "../NavContext.jsx";
import { buildEntries, previewTheme, restoreTheme } from "./sources.js";
import { boostSnapshot, noteUse, recentIds } from "./recents.js";
import { rank, segments } from "./score.js";
import { createStore, useStore } from "../../lib/store.js";
import { hostsStore, libraryStore, servicesStore, serversStore } from "../../lib/stores.js";
import { dashboardStore } from "../../lib/widgets/dashboardStore.js";
import { usePlayerRoster } from "../../lib/hooks/usePlayerRoster.js";
import { useThemePref } from "../../lib/theme.js";

// CommandPalette — one key onto everything the panel can reach.
//
// The panel is about 130 addressable screens and a couple of hundred actions across 12 routes, the
// fleet, the leaves, the catalog and 49 themes. Every one of them is two seconds away from a
// keyboard; none of them was, before this.
//
// WHAT IT IS NOT: a second implementation of anything. Entries come from `sources.js`, which routes
// every action back through `runServerAction` + `verbGuard` — the same pair the button on a server
// card uses. A verb refused on a card is refused here in the same sentence. See that file's header.
//
// THE CHIN carries the consequence. Its type and keycaps are `.chat-cmdmenu__hint`'s, value for
// value — the slash-command menu is the panel's other command surface and the two should read as one
// family — with a --surface-0 fill added because this is a far bigger surface and a hairline alone
// reads as one more list row. Its left half names what ↵ will do, in full, which is what earns it
// the height: a destructive verb ALWAYS arms, and this is where the reason for the second press gets
// stated without crowding the row.

// Matching `useConfirmAction` in ServerActions.jsx. The two arming affordances in the panel lapse
// after the same interval on purpose — a person who has learned the pause on a card should not have
// to learn a different one here.
const ARM_MS = 3500;

// The opener. A store rather than a prop so anything can raise the palette — the hotkey below today,
// a header button tomorrow — without the shell threading a callback to it.
const paletteStore = createStore({ open: false });
paletteStore.open = () => paletteStore.setState({ open: true });
paletteStore.close = () => paletteStore.setState({ open: false });

// ---- the rows -------------------------------------------------------------

function Row({ item, selected, armed, onRun, onHover }) {
  const e = item.entry;
  const parts = segments(e.title, item.ranges);
  return (
    <button
      type="button"
      className={"kp__row"
        + (selected ? " kp__row--on" : "")
        + (e.disabled ? " kp__row--off" : "")
        + (armed ? " kp__row--armed" : "")}
      // A disabled entry stays focusable and selectable on purpose: the chin is where its reason is
      // read, and a row that cannot be reached cannot explain itself.
      aria-disabled={e.disabled || undefined}
      onMouseMove={onHover}
      onClick={onRun}
    >
      <span className="kp__ico"><Icon name={e.icon || "circle"} size={13} strokeWidth={2} /></span>
      <span className="kp__b">
        <span className="kp__t">
          {parts.map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <React.Fragment key={i}>{p.text}</React.Fragment>))}
        </span>
        {(e.disabled ? e.reason : e.sub) && (
          <span className={"kp__s" + (e.disabled ? " kp__s--warn" : "")}>{e.disabled ? e.reason : e.sub}</span>
        )}
      </span>
      {armed && <span className="kp__pill kp__pill--arm">↵ again</span>}
      {!armed && e.state && <span className={"kp__pill kp__pill--" + e.state.tone}><i className="kp__dot" />{e.state.label}</span>}
      {!armed && !e.state && e.themeId && <ThemeSwatch id={e.themeId} />}
      {!armed && !e.state && !e.themeId && e.arm && !e.disabled && <span className="kp__hint">↵ ↵</span>}
    </button>
  );
}

// Four bands sampled off the theme itself rather than a stored table: a palette that drifts from its
// tokens would be a swatch that lies about what it applies.
function ThemeSwatch({ id }) {
  const [bands, setBands] = React.useState(null);
  React.useEffect(() => {
    const probe = document.createElement("div");
    probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none";
    probe.dataset.theme = id === "auto" ? (document.documentElement.dataset.theme || "dark") : id;
    document.body.appendChild(probe);
    const cs = getComputedStyle(probe);
    setBands(["--canvas", "--surface-1", "--krystal-teal", "--fg-1"].map((v) => cs.getPropertyValue(v).trim()));
    probe.remove();
  }, [id]);
  if (!bands) return null;
  return <span className="kp__swatch">{bands.map((c, i) => <i key={i} style={{ background: c }} />)}</span>;
}

// ---- the palette ----------------------------------------------------------

function Palette({ onClose, onInstall }) {
  const nav = useNav();
  // The assistant is dock state, not a route, and installing is the shell's modal. Both are read
  // here rather than in sources.js because they belong to the app frame — sources builds entries out
  // of stores and gets handed the two things that are not one.
  const dock = useAssistantDock();
  const openAssistant = dock && dock.openAssistant;
  const servers = useStore(serversStore, (s) => s.list);
  const hosts = useStore(hostsStore, (s) => s.list);
  const library = useStore(libraryStore, (s) => s.list);
  const services = useStore(servicesStore, (s) => s.byHost);
  const themePref = useThemePref();

  const [query, setQuery] = React.useState("");
  const [scope, setScope] = React.useState(null);
  const [cursor, setCursor] = React.useState(0);
  const [armedId, setArmedId] = React.useState(null);
  const armTimer = React.useRef(null);
  const listRef = React.useRef(null);
  const inputRef = React.useRef(null);

  // ⚠ THE ONE THING HERE THAT FETCHES. Every other entry is derived from a store already in memory;
  // a roster is not, because the server DTO carries a player COUNT and no names. So scoping a server
  // reads one, shared through the keyed store so the Players tab and this never read it twice.
  //
  // Gated on the server being ONLINE, which is the moderation gate itself: every one of these actions
  // is a console command, and a stopped server has no console. That way the fetch never happens for a
  // roster whose every row would be disabled. Gating on the player COUNT instead was wrong for the
  // one case that most needs this — unbanning somebody is precisely what you do when nobody is on.
  const scopeServer = React.useMemo(
    () => (scope ? servers.find((s) => s.id === scope) : null), [scope, servers]);
  const wantRoster = !!scopeServer && scopeServer.status === "online";
  const players = usePlayerRoster(wantRoster ? scopeServer : null);

  // `layout` is not read, but pinning changes it and the pin/unpin entries have to flip with it —
  // depending on it is what re-builds them when something is pinned from anywhere.
  const layout = useStore(dashboardStore, (s) => s.layout);
  const entries = React.useMemo(
    () => buildEntries({ servers, hosts, library, services, players, themePref, scope, nav, openAssistant, onInstall }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `layout` is a rebuild trigger, not an input
    [servers, hosts, library, services, players, themePref, scope, nav, openAssistant, onInstall, layout]);

  // With nothing typed the palette shows where you have just been and then where you can go — it
  // never opens onto an empty box. Recents are resolved against the CURRENT entry set, so a server
  // that has since been uninstalled simply drops out rather than offering a dead row.
  //
  // What has been RUN before lifts what matches it, through a boost taken once when the palette
  // opens (recents.js). Once, because running something rewrites the table — and a boost that moved
  // between keystrokes would reorder the list under a cursor that had not moved. It is capped well
  // below what a strong text match is worth: habit breaks ties, it never overrules what was typed.
  const boostOf = React.useMemo(() => boostSnapshot(), []);

  const resting = !query.trim() && !scope;
  const ranked = React.useMemo(() => {
    if (!resting) return rank(query, entries, undefined, boostOf);
    const byId = new Map(entries.map((e) => [e.id, e]));
    const recent = recentIds().map((id) => byId.get(id)).filter(Boolean)
      .map((e, i) => ({ entry: { ...e, group: "Recent" }, ranges: [], score: 0, i }));
    const go = entries.filter((e) => e.group === "Go to")
      .map((e, i) => ({ entry: e, ranges: [], score: 0, i: i + 100 }));
    return [...recent, ...go];
  }, [resting, query, entries, boostOf]);

  // Groups in rank order: a group appears where its best member landed, and members keep their own
  // order inside it. Grouping the ranking rather than ranking within fixed groups is what keeps the
  // best match at the top whatever kind of thing it is.
  const groups = React.useMemo(() => {
    const out = [];
    const seen = new Map();
    for (const item of ranked) {
      let g = seen.get(item.entry.group);
      if (!g) { g = { group: item.entry.group, items: [] }; seen.set(item.entry.group, g); out.push(g); }
      g.items.push(item);
    }
    return out;
  }, [ranked]);

  // Nothing matched, but the query is still a sentence somebody meant. Offering it to the assistant
  // as a ROW rather than as a silent fall-through is the whole difference: it has to be selected and
  // confirmed, it says what it will do, and a typo simply sits there unchosen.
  //
  // ⚠ It does NOT send. The seed lands in the composer and focuses it (ChatPage's
  // `startBriefingChat`), so the last word is still a person pressing Enter on their own text — the
  // same rule a voice note follows, and the reason neither one can put words in somebody's mouth.
  //
  // Only when there is nothing else — an assistant offered alongside real results would be noise —
  // and only where one can actually be reached, because offering to ask a leaf this host has no
  // route to is a row that cannot do what it says.
  const askable = dock && dock.usableAssistants && dock.usableAssistants.length > 0;
  const withFallback = React.useMemo(() => {
    if (ranked.length || !query.trim() || !askable) return groups;
    const q = query.trim();
    return [{
      group: "Assistant",
      items: [{
        ranges: [], score: 0, i: 0,
        entry: {
          id: "ask.assistant",
          kind: "ask", group: "Assistant",
          transient: true,
          title: "Ask the assistant about “" + q + "”",
          sub: "Opens the assistant with this ready to send",
          icon: "bot",
          chin: "Ask the assistant about “" + q + "”",
          run: () => {
            dock.askAssistant();
            dock.setAssistantSeed({ prompt: q, serverId: null, nonce: Date.now() });
          },
        },
      }],
    }];
  }, [ranked.length, query, askable, groups, dock]);

  const flat = React.useMemo(() => withFallback.flatMap((g) => g.items), [withFallback]);
  const active = flat[Math.min(cursor, flat.length - 1)] || null;

  const disarm = React.useCallback(() => {
    clearTimeout(armTimer.current);
    setArmedId(null);
  }, []);

  // Re-ranking moves the ground under the selection, so both reset together: a cursor left pointing
  // at index 3 of a different list is how somebody starts a server they never looked at.
  React.useEffect(() => { setCursor(0); disarm(); }, [query, scope, disarm]);

  // Arrowing through 49 themes previews each one against the real document and stores nothing;
  // `themeStore.set` on ↵ is the commit. Anything that is not a theme puts the stored one back, so
  // moving off a preview never leaves the panel wearing it.
  React.useEffect(() => {
    if (active && active.entry.themeId) previewTheme(active.entry.themeId);
    else restoreTheme();
  }, [active]);

  const close = React.useCallback(() => { restoreTheme(); disarm(); onClose(); }, [onClose, disarm]);

  const runEntry = React.useCallback((item) => {
    if (!item) return;
    const e = item.entry;
    if (e.disabled) return;                       // the row says why; ↵ does nothing
    if (e.arm && armedId !== e.id) {
      setArmedId(e.id);
      clearTimeout(armTimer.current);
      armTimer.current = setTimeout(() => setArmedId(null), ARM_MS);
      return;
    }
    disarm();
    // The ask row is built fresh from whatever was typed and is not in the entry set, so recording
    // it would spend one of five recent slots on an id that can never resolve again.
    if (!e.transient) noteUse(e.id);
    // A theme and a pin both stay open: you try several themes in a row, and you pin three things in
    // a row, and re-opening between each is the friction this exists to remove. Everything else
    // closes first, so a navigation lands on a page with nothing over it.
    if (e.themeId || e.kind === "pin") { e.run(); return; }
    onClose();
    try { e.run(); } catch { /* a source that throws must not take the shell down */ }
  }, [armedId, disarm, onClose]);

  const enterScope = React.useCallback((item) => {
    if (!item || !item.entry.scope) return;
    setScope(item.entry.scope);
    setQuery("");
    if (inputRef.current) inputRef.current.focus();
  }, []);

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown" || (e.key === "n" && e.ctrlKey)) {
      e.preventDefault(); disarm();
      setCursor((c) => (flat.length ? (c + 1) % flat.length : 0));
    } else if (e.key === "ArrowUp" || (e.key === "p" && e.ctrlKey)) {
      e.preventDefault(); disarm();
      setCursor((c) => (flat.length ? (c - 1 + flat.length) % flat.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      runEntry(active);
    } else if (e.key === "ArrowRight" && active && active.entry.scope
               && e.target.selectionStart === e.target.value.length) {
      // Only once the caret has nothing left to travel over, so → is still an ordinary right arrow
      // while there is text to move through. Same rule as ⌫ below: the key keeps its normal job
      // until it would do nothing, and only then takes on the palette's.
      e.preventDefault();
      enterScope(active);
    } else if (e.key === "Backspace" && !query && scope) {
      e.preventDefault();
      setScope(null);
    } else if (e.key === "Escape") {
      // Handled by Modal too, but arming has to be cleared before the close so a re-open is idle.
      e.preventDefault();
      close();
    }
  };

  // Keep the selection on screen. `block: "nearest"` so arrowing one row scrolls one row rather than
  // recentring the whole list under the cursor.
  React.useEffect(() => {
    const el = listRef.current && listRef.current.querySelector(".kp__row--on");
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
  }, [cursor, flat.length]);

  React.useEffect(() => () => clearTimeout(armTimer.current), []);

  const armed = active && armedId === active.entry.id;

  return (
    <Modal onClose={close} scrimClassName="modal-scrim kp-scrim">
      <div className="kp" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="kp__q">
          {scopeServer ? (
            <span className="kp__scope">
              <Icon name="server" size={12} strokeWidth={2.2} />{scopeServer.name || scopeServer.id}
            </span>
          ) : (
            <Icon name="search" size={16} strokeWidth={2} className="kp__qico" />
          )}
          <input
            ref={inputRef}
            className="kp__input"
            value={query}
            autoFocus
            spellCheck="false"
            autoComplete="off"
            aria-label={scopeServer ? "Search " + (scopeServer.name || scopeServer.id) : "Search the panel"}
            placeholder={scopeServer ? "Tabs and actions…" : "Search servers, actions, settings…"}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <span className="kp__count">
            {wantRoster && players.status === "loading" ? "reading players…"
              : wantRoster && players.status === "error" ? "players unavailable"
                : scope && !query ? "⌫ exit"
                  : flat.length ? flat.length + (flat.length === 1 ? " result" : " results") : ""}
          </span>
        </div>

        {flat.length > 0 ? (
          <div className="kp__list" ref={listRef} role="listbox" aria-label="Results">
            {withFallback.map((g) => (
              <React.Fragment key={g.group}>
                <div className="kp__grp">{g.group}</div>
                {g.items.map((item) => {
                  const idx = flat.indexOf(item);
                  return (
                    <Row
                      key={item.entry.id}
                      item={item}
                      selected={idx === Math.min(cursor, flat.length - 1)}
                      armed={armedId === item.entry.id}
                      onHover={() => { if (idx !== cursor) { setCursor(idx); disarm(); } }}
                      onRun={() => { setCursor(idx); runEntry(item); }}
                    />
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        ) : (
          <div className="kp__empty">
            <b>Nothing matches that</b>
            <span>Try a server name, a verb like “restart”, or a page</span>
          </div>
        )}

        <div className="kp__chin">
          {active ? (
            <span className={"kp__act" + (active.entry.warn || armed ? " kp__act--warn" : "")}>
              <kbd>↵</kbd>
              {armed ? "again to " + active.entry.chin.charAt(0).toLowerCase() + active.entry.chin.slice(1)
                : active.entry.disabled ? active.entry.reason || "Unavailable"
                  : active.entry.chin}
            </span>
          ) : <span className="kp__act" />}
          <span className="kp__sp" />
          <span className="kp__rest">
            {armed ? "lapses in " + (ARM_MS / 1000) + "s"
              : (
                <>
                  {active && active.entry.scope && !query && <><kbd>→</kbd>scope · </>}
                  {scope && <><kbd>⌫</kbd>back · </>}
                  <kbd>Esc</kbd>dismiss
                </>
              )}
          </span>
        </div>
      </div>
    </Modal>
  );
}

/// Mounted once by the shell. Owns the hotkey and renders nothing until it is opened.
function CommandPalette({ onInstall }) {
  const open = useStore(paletteStore, (s) => s.open);

  React.useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        paletteStore.setState((s) => ({ ...s, open: !s.open }));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!open) return null;
  return <Palette onClose={paletteStore.close} onInstall={onInstall} />;
}

export { CommandPalette, paletteStore };
