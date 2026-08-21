import React from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon.jsx";
import { Modal } from "./Modal.jsx";
import { Select } from "./Select.jsx";
import { usePortalPopover } from "../hooks/usePortalPopover.js";

// fmtClock — a wall-clock HH:MM:SS from an ISO string or epoch ms; "" for absent/garbage
// (never a fabricated time). Game stdout lines carry no time, so the live feed stamps each
// line with the moment it ARRIVED (observed-at); host logs carry the real journald `at`.
function fmtClock(at) {
  if (at == null) return "";
  const d = new Date(at);
  return isNaN(d.getTime())
    ? ""
    : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

// A line is either a raw stdout STRING (game scrollback) or { id?, seq?, at?, ts?, tag?, level?, text }.
const lineText = (line) => (typeof line === "object" && line !== null ? (line.text || "") : String(line));

// The line's OWN identity where it has one — the journald cursor (`id`) or the console bridge's
// sequence (`seq`) — falling back to the index for a bare scrollback string. These feeds are capped
// windows that drop their oldest lines, which shifts every index by one: keyed on the index, a
// single arriving line rewrites the text of all thousand rows instead of appending one. It is also
// what lets the view hold a row still while the top is trimmed, and count what arrived unread.
function lineKey(line, idx) {
  if (typeof line !== "object" || line === null) return idx;
  if (line.id != null) return "i" + line.id;
  if (line.seq != null) return "s" + line.seq;
  return idx;
}

// A word character for the whole-word test — the same class a `\b` is defined against.
const WORD = /[A-Za-z0-9_]/;

// buildMatcher — compile the query plus its three modifiers into one thing that finds ranges.
// Everything downstream (the count, the "only matches" filter, the highlight, the stepper) goes
// through this single object, so what is counted and what is marked can never disagree.
//
// A pattern that won't compile is a NORMAL state of typing one — `(err` is what `(error|warn)` looks
// like halfway through. It comes back as `{ error }` and the bar says the pattern is bad, because
// reporting zero matches instead would read as "this is not in the log", which is a different and
// much more damaging claim.
function buildMatcher(query, caseSensitive, wholeWord, useRegex) {
  if (!query) return null;
  // Literal mode escapes everything the regex engine would otherwise read as syntax, so a search for
  // `[Server]` or `1.2.3` finds exactly that.
  const source = useRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let re;
  try { re = new RegExp(source, caseSensitive ? "g" : "gi"); }
  catch (e) { return { error: (e && e.message) || "invalid pattern" }; }

  // Whole-word is checked on the RESULT rather than by wrapping the pattern in `\b`, because a `\b`
  // is an assertion about the character next to it: on a query that starts or ends with punctuation
  // — `[warn]`, `--verbose`, `x=1` — it asserts against the bracket and matches nothing. An edge is
  // a boundary unless word characters sit on both sides of it.
  const atBoundary = (s, start, end) => (
    !(start > 0 && WORD.test(s[start - 1]) && WORD.test(s[start]))
    && !(end < s.length && WORD.test(s[end - 1]) && WORD.test(s[end]))
  );

  const find = (s, from) => {
    if (from > s.length) return null;
    re.lastIndex = from;
    for (;;) {
      const m = re.exec(s);
      if (!m) return null;
      const start = m.index;
      const end = start + m[0].length;
      // A pattern that can match nothing (`a*`, `^`, `\b`) leaves lastIndex where it was, so exec
      // returns the same position forever unless it is stepped past by hand.
      if (end === start) {
        if (start >= s.length) return null;
        re.lastIndex = start + 1;
        continue;
      }
      if (!wholeWord || atBoundary(s, start, end)) return [start, end];
      re.lastIndex = start + 1;   // not `end` — a later overlapping match may still be whole-word
    }
  };
  return { find };
}

// Every range the matcher finds in `s`, ascending and non-overlapping.
function allMatches(s, matcher) {
  const out = [];
  let i = 0;
  for (;;) {
    const r = matcher.find(s, i);
    if (!r) return out;
    out.push(r);
    i = r[1];
  }
}

// The line as the reader SEES it: the `§…§` markers around an engine-highlighted name are not
// characters on screen, so they take no part in a search. Matching the raw string instead would let
// an invisible marker split a name away from the word after it, and in regex mode would put `^`,
// `$` and `.` against characters nobody can see.
const visibleText = (line) => lineText(line).split(/§([^§]+)§/g).join("");

// decorate — the line's text as nodes: §…§ wraps a teal highlight (player/world names the engine
// marked), and the find's hits are marked inside whatever those segments are. The search runs over
// the joined visible text and its ranges are mapped back onto the segments, so a hit that straddles
// a name is counted and marked as the one match it is.
function decorate(text, matcher) {
  const parts = text.split(/§([^§]+)§/g);
  const wrap = (nodes, i) => (i % 2 === 1
    ? <span key={i} className="tag-player">{nodes}</span>
    : <React.Fragment key={i}>{nodes}</React.Fragment>);
  if (!matcher || matcher.error) return parts.map((seg, i) => wrap(seg, i));

  const plain = parts.join("");
  const ranges = allMatches(plain, matcher);
  if (!ranges.length) return parts.map((seg, i) => wrap(seg, i));

  let at = 0;
  return parts.map((seg, i) => {
    const s0 = at, s1 = at + seg.length;
    at = s1;
    const nodes = [];
    let cur = s0;
    for (const [ms, me] of ranges) {
      if (me <= s0) continue;
      if (ms >= s1) break;
      const a = Math.max(ms, s0), b = Math.min(me, s1);
      if (a > cur) nodes.push(plain.slice(cur, a));
      nodes.push(<mark key={a} className="ln__hit">{plain.slice(a, b)}</mark>);
      cur = b;
    }
    if (cur < s1) nodes.push(plain.slice(cur, s1));
    return wrap(nodes, i);
  });
}

// renderLine — one console row. With `tsMode` the left gutter is reserved (so timestamped and
// un-timestamped lines align); `level`/`tag` tint the row. `currentKey` marks the find's active hit.
function renderLine(line, idx, tsMode, matcher, currentKey) {
  const obj = typeof line === "object" && line !== null;
  const ts = obj ? (line.ts != null ? line.ts : fmtClock(line.at)) : "";
  const tag = obj ? line.tag : null;
  const level = obj ? line.level : null;
  const key = lineKey(line, idx);
  const tagEl = tag ? <span className={"tag-" + tag}>[{tag}]</span> : null;
  const cls = "ln" + (level ? " ln--" + level : "")
    + (currentKey != null && String(key) === String(currentKey) ? " ln--hit-current" : "");
  return (
    <div className={cls} key={key} data-k={key}>
      {tsMode ? <span className="ts">{ts}</span> : null}
      <span className="ln__text">{tagEl}{tagEl && " "}{decorate(lineText(line), matcher)}</span>
    </div>
  );
}

// How many lines sit after the one the reader last saw. The marked line having been trimmed away
// means everything in view arrived since — never a fabricated 0.
function countAfter(arr, key) {
  if (key == null) return 0;
  for (let i = arr.length - 1; i >= 0; i--) if (String(lineKey(arr[i], i)) === String(key)) return arr.length - 1 - i;
  return arr.length;
}

// A selector-safe form of a line key (they are engine-issued — a journald cursor carries `;` and `=`).
const keySel = (k) => (window.CSS && CSS.escape ? CSS.escape(String(k)) : String(k));

// Slack at the bottom that still counts as "following" — a fractional scroll height, or a click that
// lands a pixel short, must not read as the reader having deliberately scrolled away.
const NEAR_BOTTOM = 24;

// ConsoleView — the shared console card (chrome + find bar + body + the full-screen pop-out). BOTH
// the game-server console (ConsolePanel) and the journal feeds (host logs, one leaf's journal) render
// through this, so they look identical — including the left-hand timestamp gutter.
//
//   lines    — strings or { id?, seq?, at?, ts?, tag?, level?, text }, OLDEST-FIRST (newest at the
//              bottom, tail).
//   sources  — optional [{ id, label, lines }] → a source dropdown in the head; the selected source's
//              lines are shown (overrides `lines`). A single source shows a quiet label, none = no chip.
//   pill     — optional { label, live } run-state / Live pill.
//   pin      — optional header NODE (the panel's <PinButton/>), beside the count. Taken as a
//              node rather than a descriptor for the same reason the other shells do it: a
//              card shell must not have to know that widgets exist.
//   count    — optional line count for the head ("N lines"); `loading` shows "connecting…".
//   footer   — optional node under the body (a command input / a read-only note).
//   resetKey — when it changes, the pop-out collapses and the find/follow state resets: a server or
//              host switch is a new context, not a continuation of the one being read.
//   initialSourceId — which source to open on, when the caller knows (the leaf config page opens a
//              leaf's own journal). Ignored if it isn't in `sources`; only seeds the initial pick,
//              so the user's later choice always wins.
//   onLoadEarlier — () => Promise, when the feed can read further back than it currently holds. Its
//              presence is what puts the control at the top of the scrollback; a feed that has
//              reached the beginning passes null and the control goes away rather than sitting there
//              claiming there is more.
//   onDownload — () => Promise, when the whole log can be had in one piece. `downloadName` labels it.
function ConsoleView({
  title = "Console", icon = "terminal-square",
  lines = [], sources, pill, count, pin, loading = false,
  footer = null, emptyText = "— no output —", resetKey, initialSourceId,
  onLoadEarlier = null, loadingEarlier = false, onDownload = null, downloadName = null,
}) {
  const bodyRef = React.useRef(null);
  const findRef = React.useRef(null);
  const [sourceId, setSourceId] = React.useState(() => {
    if (initialSourceId && sources && sources.some(s => s.id === initialSourceId)) return initialSourceId;
    return sources && sources[0] && sources[0].id;
  });
  const [expanded, setExpanded] = React.useState(false);
  const [finding, setFinding] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [onlyMatching, setOnlyMatching] = React.useState(false);
  const [matchAt, setMatchAt] = React.useState(0);
  // The three search modifiers, in the shape every editor spells them. They survive closing and
  // reopening the bar — someone reading a log in regex is still in regex on the next search — and
  // reset only with the card's context, alongside the query itself.
  const [caseSensitive, setCaseSensitive] = React.useState(false);
  const [wholeWord, setWholeWord] = React.useState(false);
  const [useRegex, setUseRegex] = React.useState(false);

  // View options. `wrap` off puts long lines on one row each and scrolls the body sideways, which is
  // how a stack trace or a table stays readable; `showTs` hides the gutter for the same reason.
  // `clearedAt` is the newest line at the moment Clear was pressed — everything up to and including
  // it is hidden HERE and nowhere else. Nothing is deleted: the log on disk is untouched and the
  // count in the head keeps saying what the feed holds, because a console that quietly forgot what a
  // server printed would be the one thing this card must never do.
  const [wrap, setWrap] = React.useState(true);
  const [showTs, setShowTs] = React.useState(true);
  const [clearedAt, setClearedAt] = React.useState(null);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const menuBtnRef = React.useRef(null);
  const { pos: menuPos, menuRef } = usePortalPopover(menuOpen, setMenuOpen, menuBtnRef);

  // Following is the reader's POSITION, not a mode they set: the feed tails while they are at the
  // bottom and holds still the moment they scroll away to read something. `pinnedRef` mirrors the
  // state because the layout effect below reads it without wanting to re-run every time it flips.
  const [pinned, setPinned] = React.useState(true);
  const pinnedRef = React.useRef(true);
  const setPin = (v) => { pinnedRef.current = v; setPinned(v); };
  const [unread, setUnread] = React.useState(0);
  const anchorRef = React.useRef(null);   // { key, delta } — the row to hold still while unpinned
  const seenRef = React.useRef(null);     // the newest line the reader had seen when they scrolled away

  // Keep the source selection valid as the set changes; collapse the pop-out on a context switch.
  // Sources usually arrive after the first render, so the requested one is honoured here too —
  // otherwise seeding it above would lose the race and always fall to the first source.
  React.useEffect(() => {
    if (!sources || !sources.length || sources.some(s => s.id === sourceId)) return;
    const wanted = initialSourceId && sources.some(s => s.id === initialSourceId) ? initialSourceId : sources[0].id;
    setSourceId(wanted);
  }, [sources, sourceId, initialSourceId]);
  React.useEffect(() => {
    setExpanded(false); setFinding(false); setQuery(""); setOnlyMatching(false); setMatchAt(0);
    setCaseSensitive(false); setWholeWord(false); setUseRegex(false);
    setUnread(0); anchorRef.current = null; seenRef.current = null;
    setClearedAt(null); setMenuOpen(false);
    pinnedRef.current = true; setPinned(true);
  }, [resetKey]);
  React.useEffect(() => { if (finding && findRef.current) findRef.current.focus(); }, [finding]);

  const current = sources ? (sources.find(s => s.id === sourceId) || sources[0]) : null;
  const held = React.useMemo(() => (current ? (current.lines || []) : lines), [current, lines]);
  // What Clear hid. Its line having since been trimmed out of the window means everything left is
  // newer than it, so there is nothing to hide and the whole feed shows.
  const all = React.useMemo(() => {
    if (clearedAt == null) return held;
    for (let i = held.length - 1; i >= 0; i--)
      if (String(lineKey(held[i], i)) === String(clearedAt)) return held.slice(i + 1);
    return held;
  }, [held, clearedAt]);
  // The compiled search. Nothing typed → null; a pattern that won't compile → `{ error }`. The query
  // is NOT trimmed: leading and trailing spaces are part of what someone searching a log means, and
  // in regex mode they are part of the pattern.
  const matcher = React.useMemo(
    () => buildMatcher(query, caseSensitive, wholeWord, useRegex),
    [query, caseSensitive, wholeWord, useRegex]
  );
  const badPattern = !!(matcher && matcher.error);
  const searching = !!(matcher && !matcher.error);

  // Which lines carry the query, as indices into `all`. null when nothing is being searched for —
  // and equally when the pattern is broken, since a half-typed regex knows nothing about the log.
  const matches = React.useMemo(() => {
    if (!searching) return null;
    const out = [];
    for (let i = 0; i < all.length; i++) if (matcher.find(visibleText(all[i]), 0)) out.push(i);
    return out;
  }, [all, matcher, searching]);
  const hits = matches ? matches.length : 0;
  const mAt = hits ? Math.min(matchAt, hits - 1) : 0;

  const shown = matches && onlyMatching ? matches.map(i => all[i]) : all;
  // The head counts what the FEED holds, not what the view is currently showing — a find or a Clear
  // narrows the screen, and a count that followed it would report the console as having less in it.
  const shownCount = count != null ? count : held.length;
  // The key of the find's active hit — its row is tinted, and is what the stepper scrolls to.
  const currentKey = !hits ? null
    : onlyMatching ? lineKey(shown[mAt], mAt) : lineKey(all[matches[mAt]], matches[mAt]);
  // Reserve the timestamp gutter only when something in view is timestamped — so a plain stdout
  // tail (no times yet) isn't indented under an empty column, but a live/host-log feed aligns.
  const tsMode = showTs && shown.some(l => typeof l === "object" && l !== null && (l.at != null || l.ts != null));
  // A full window is exactly `length` lines long forever, so the count cannot say a line arrived —
  // the newest line's own identity is what does.
  const tailKey = shown.length ? lineKey(shown[shown.length - 1], shown.length - 1) : "";

  // Where the reader is now: following the newest line, or parked on a row with a note of which one
  // and where it sits, so the same row can be put back under their eyes after the content changes.
  const readPosition = (el) => {
    if (el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM) {
      setPin(true); setUnread(0);
      anchorRef.current = null; seenRef.current = null;
      return;
    }
    setPin(false);
    if (seenRef.current == null) seenRef.current = tailKey;   // everything past this line is unread
    for (const row of el.children) {
      if (row.dataset && row.dataset.k != null && row.offsetTop + row.offsetHeight > el.scrollTop) {
        anchorRef.current = { key: row.dataset.k, delta: row.offsetTop - el.scrollTop };
        break;
      }
    }
  };

  // Moving the view ourselves. The scroll event this raises is DROPPED, and each self-move states
  // the resulting position outright instead: the compensation that holds a row still runs on every
  // arriving line, and letting it re-enter through its own scroll event would re-scan the rows above
  // the viewport — hundreds of layout reads per line — to re-derive the anchor it was just applying.
  // The flag is only armed when the value actually changes, since a no-op assignment raises no event
  // and would leave it set to swallow the reader's next real scroll.
  const selfScrollRef = React.useRef(false);
  const moveTo = (el, top) => {
    const v = Math.max(0, top);
    if (Math.abs(el.scrollTop - v) < 0.5) return;
    selfScrollRef.current = true;
    el.scrollTop = v;
  };

  // Follow the feed, or hold the reader's place. The body tails only while pinned; while it isn't,
  // the topmost visible row is anchored so trimming the oldest lines off the top can't slide what is
  // being read out from under it. The browsers' own scroll anchoring is switched off in CSS
  // (`overflow-anchor: none`) so there is ONE mechanism here rather than two compensating at once.
  React.useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    if (pinnedRef.current) { moveTo(el, el.scrollHeight); setUnread(0); return; }
    const a = anchorRef.current;
    if (a && a.key != null) {
      const row = el.querySelector('[data-k="' + keySel(a.key) + '"]');
      // The anchored row itself having been trimmed means everything the reader had on screen is
      // gone; the oldest surviving line is where that content went, so go there and re-anchor rather
      // than leave the offset pointing at whatever now happens to occupy it.
      if (row) moveTo(el, row.offsetTop - a.delta);
      else { moveTo(el, 0); readPosition(el); }
    }
    setUnread(countAfter(shown, seenRef.current));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the CONTENT changes: the identity of the newest line, never the count, which a capped window pins forever. `pinned` is read through its ref on purpose, so merely scrolling to the bottom doesn't re-fire this.
  }, [shown.length, tailKey, sourceId, expanded, onlyMatching, matcher]);

  const onScroll = () => {
    const el = bodyRef.current;
    if (!el) return;
    if (selfScrollRef.current) { selfScrollRef.current = false; return; }
    readPosition(el);
  };

  const jumpToLatest = () => {
    const el = bodyRef.current;
    if (!el) return;
    moveTo(el, el.scrollHeight);
    setPin(true); setUnread(0);
    anchorRef.current = null; seenRef.current = null;
  };

  // Walk the view to the active hit whenever the search changes. A query that only matches up in the
  // scrollback has to be SHOWN, not merely counted — typing one and being left staring at the bottom
  // of the feed reads as "no match". Declared after the follow effect so it wins in the same commit;
  // landing away from the bottom unpins through the scroll handler, so the next arriving line can't
  // drag the reader off what they just searched for.
  React.useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el || !hits) return;
    const key = onlyMatching ? lineKey(shown[mAt], mAt) : lineKey(all[matches[mAt]], matches[mAt]);
    const row = el.querySelector('[data-k="' + keySel(key) + '"]');
    if (!row) return;
    moveTo(el, row.offsetTop - (el.clientHeight - row.offsetHeight) / 2);
    readPosition(el);   // a hit up in the scrollback is a deliberate move away from the feed
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the SEARCH moving is what scrolls, never the feed: `shown`/`all`/`matches` are read for the current hit's position and would re-fire this on every arriving line if depped
  }, [matcher, mAt, onlyMatching, hits]);

  const step = (d) => { if (hits) setMatchAt((mAt + d + hits) % hits); };

  // Flipping a modifier searches for something else, so the cursor goes back to the first hit —
  // holding position at "12 of 40" through a change that produces a different 40 would put the
  // reader somewhere neither they nor the count chose. Focus returns to the field, since narrowing
  // the search is part of typing it.
  const toggleMode = (set) => {
    set(v => !v);
    setMatchAt(0);
    if (findRef.current) findRef.current.focus();
  };

  const closeFind = () => { setFinding(false); setQuery(""); setOnlyMatching(false); setMatchAt(0); };

  // Reading further back prepends, which moves everything down. The reader is by definition up at the
  // top of the scrollback to have pressed it, so the anchor already holds their line still — this
  // only has to leave the pin alone, which it does by never touching it.
  const loadEarlier = () => {
    if (!onLoadEarlier || loadingEarlier) return;
    Promise.resolve(onLoadEarlier()).catch(() => {});
  };

  // Copy what is ON SCREEN — the find's result if one is running, the window otherwise. Timestamps
  // are included only when the gutter is showing them, and the highlight markers are dropped, so
  // what lands on the clipboard is the text that was being looked at.
  const copyVisible = () => {
    const text = shown.map(l => {
      const t = visibleText(l);
      if (!tsMode) return t;
      const stamp = typeof l === "object" && l !== null ? (l.ts != null ? l.ts : fmtClock(l.at)) : "";
      return stamp ? stamp + " " + t : t;
    }).join("\n");
    const done = () => { setCopied(true); setTimeout(() => setCopied(false), 1600); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, () => {});
    }
    setMenuOpen(false);
  };

  const [downloadErr, setDownloadErr] = React.useState(null);
  const [downloading, setDownloading] = React.useState(false);
  const runDownload = () => {
    if (!onDownload || downloading) return;
    setDownloading(true); setDownloadErr(null); setMenuOpen(false);
    Promise.resolve(onDownload()).then(
      () => setDownloading(false),
      (e) => { setDownloading(false); setDownloadErr((e && (e.userMessage || e.message)) || "Couldn't download the log."); }
    );
  };

  const clearView = () => {
    setClearedAt(shown.length ? tailKey : null);
    setMenuOpen(false);
  };

  const headCount = loading ? "connecting…"
    : matches ? hits + " of " + shownCount
      : shownCount + " lines";

  const body = (
    <section className="console-card">
      <div className="console-card__head">
        <span className="console-card__title"><Icon name={icon} size={13} /> {title}</span>
        {sources && sources.length > 1 ? (
          <Select variant="chip" value={sourceId} onChange={e => setSourceId(e.target.value)}>
            {sources.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </Select>
        ) : (sources && sources[0] && sources[0].label ? <span className="console-card__single">{sources[0].label}</span> : null)}
        {pill ? <span className={"console-card__live" + (pill.live ? "" : " console-card__live--idle")}>{pill.label}</span> : null}
        <span className="console-card__count">{headCount}</span>
        {pin}
        <button type="button" className={"console-card__expand" + (finding ? " console-card__expand--on" : "")}
          onClick={() => (finding ? closeFind() : setFinding(true))}
          title="Find in console" aria-label="Find in console" aria-pressed={finding}>
          <Icon name="search" size={14} />
        </button>
        <span ref={menuBtnRef} className="console-card__menu-anchor">
          <button type="button" className={"console-card__expand" + (menuOpen ? " console-card__expand--on" : "")}
            onClick={() => setMenuOpen(o => !o)}
            title="View options" aria-label="View options" aria-haspopup="menu" aria-expanded={menuOpen}>
            <Icon name="sliders-horizontal" size={14} />
          </button>
        </span>
        <button type="button" className="console-card__expand" onClick={() => setExpanded(v => !v)}
          title={expanded ? "Exit full screen (Esc)" : "Expand to full screen"}
          aria-label={expanded ? "Exit full screen" : "Expand to full screen"}>
          <Icon name={expanded ? "minimize-2" : "maximize-2"} size={14} />
        </button>
      </div>

      {menuOpen && menuPos && createPortal(
        <div className="console-menu" role="menu" ref={menuRef} style={menuPos}>
          <button type="button" role="menuitemcheckbox" aria-checked={wrap} onClick={() => setWrap(v => !v)}>
            <Icon name={wrap ? "check" : "minus"} size={13} /> Wrap long lines
          </button>
          <button type="button" role="menuitemcheckbox" aria-checked={showTs} onClick={() => setShowTs(v => !v)}>
            <Icon name={showTs ? "check" : "minus"} size={13} /> Timestamps
          </button>
          <div className="console-menu__sep" />
          <button type="button" role="menuitem" onClick={copyVisible} disabled={!shown.length}>
            <Icon name={copied ? "clipboard-check" : "clipboard"} size={13} /> {copied ? "Copied" : "Copy what's shown"}
          </button>
          {onDownload ? (
            <button type="button" role="menuitem" onClick={runDownload} disabled={downloading}>
              <Icon name="download" size={13} /> {downloading ? "Downloading…" : "Download the full log"}
            </button>
          ) : null}
          <div className="console-menu__sep" />
          <button type="button" role="menuitem" onClick={clearView} disabled={!shown.length}>
            <Icon name="eraser" size={13} /> Clear the view
          </button>
          {clearedAt != null ? (
            <button type="button" role="menuitem" onClick={() => { setClearedAt(null); setMenuOpen(false); }}>
              <Icon name="rotate-ccw" size={13} /> Show the hidden lines
            </button>
          ) : null}
          <div className="console-menu__note">
            Clearing hides lines in this view only — the log on disk is untouched
            {onDownload ? ", and the download still carries all of it" : ""}.
          </div>
        </div>,
        document.body
      )}

      {finding ? (
        <div className={"console-card__find" + (badPattern ? " console-card__find--bad" : "")}>
          <Icon name="search" size={13} />
          <input
            ref={findRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setMatchAt(0); }}
            onKeyDown={e => {
              if (e.key === "Enter") { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
              else if (e.key === "Escape") { e.preventDefault(); closeFind(); }
              // The editor accelerators, so a search can be narrowed without leaving the keyboard.
              else if (e.altKey && !e.ctrlKey && !e.metaKey) {
                const k = e.key.toLowerCase();
                if (k === "c") { e.preventDefault(); toggleMode(setCaseSensitive); }
                else if (k === "w") { e.preventDefault(); toggleMode(setWholeWord); }
                else if (k === "r") { e.preventDefault(); toggleMode(setUseRegex); }
              }
            }}
            placeholder={useRegex ? "Find by pattern…" : "Find in console…"}
            spellCheck="false"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            aria-label="Find in console"
            aria-invalid={badPattern || undefined}
          />
          {/* The three modifiers, in the order and with the glyphs every editor spells them in. */}
          <span className="console-card__find-opts" role="group" aria-label="Search options">
            <button type="button" className={"console-card__find-opt" + (caseSensitive ? " is-on" : "")}
              onClick={() => toggleMode(setCaseSensitive)} aria-pressed={caseSensitive}
              title="Match case (Alt+C)" aria-label="Match case">
              <Icon name="case-sensitive" size={16} />
            </button>
            <button type="button" className={"console-card__find-opt" + (wholeWord ? " is-on" : "")}
              onClick={() => toggleMode(setWholeWord)} aria-pressed={wholeWord}
              title="Match whole word (Alt+W)" aria-label="Match whole word">
              <Icon name="whole-word" size={16} />
            </button>
            <button type="button" className={"console-card__find-opt" + (useRegex ? " is-on" : "")}
              onClick={() => toggleMode(setUseRegex)} aria-pressed={useRegex}
              title="Use a regular expression (Alt+R)" aria-label="Use a regular expression">
              <Icon name="regex" size={16} />
            </button>
          </span>
          <span className={"console-card__find-count" + (badPattern ? " console-card__find-count--bad" : "")}>
            {badPattern ? "bad pattern" : searching ? (hits ? (mAt + 1) + "/" + hits : "no matches") : ""}
          </span>
          <button type="button" onClick={() => step(-1)} disabled={!hits}
            title="Previous match (Shift+Enter)" aria-label="Previous match">
            <Icon name="chevron-up" size={14} />
          </button>
          <button type="button" onClick={() => step(1)} disabled={!hits}
            title="Next match (Enter)" aria-label="Next match">
            <Icon name="chevron-down" size={14} />
          </button>
          <label className="console-card__find-only">
            <input type="checkbox" checked={onlyMatching} onChange={e => setOnlyMatching(e.target.checked)} />
            Only matches
          </label>
          <button type="button" onClick={closeFind} title="Close find (Esc)" aria-label="Close find">
            <Icon name="x" size={14} />
          </button>
          {/* The engine's own account of what is wrong with the pattern, on its own row rather than
              in a tooltip — a phone has no hover, and "bad pattern" alone doesn't say where. The
              wording comes from the JS engine, so it reads differently between browsers. */}
          {badPattern ? <span className="console-card__find-msg" role="alert">{matcher.error}</span> : null}
        </div>
      ) : null}

      {downloadErr ? (
        <div className="console-card__error" role="alert">
          <Icon name="triangle-alert" size={12} /> {downloadErr}
        </div>
      ) : null}

      <div className="console-card__view">
        <div className={"console-card__body" + (tsMode ? " console-card__body--ts" : "") + (wrap ? "" : " console-card__body--nowrap")}
          ref={bodyRef} onScroll={onScroll}>
          {/* At the TOP because that is where the lines it fetches land, and because reaching it is
              the same gesture as looking for them. It is absent once the run's beginning is loaded. */}
          {onLoadEarlier && !loading ? (
            <button type="button" className="console-card__earlier" onClick={loadEarlier} disabled={loadingEarlier}>
              {loadingEarlier ? "Loading…" : "Load earlier lines"}
            </button>
          ) : null}
          {loading ? <div className="ln" style={{ color: "var(--fg-3)" }}>Loading console…</div>
            : shown.length === 0 ? (
              // An emptied view is NOT an empty console, and must not be worded as one — the feed
              // still holds every line and the log on disk is untouched.
              <div className="ln" style={{ color: "var(--fg-3)" }}>
                {searching ? "— no matching lines —"
                  : clearedAt != null ? "— view cleared · the feed still holds " + held.length + " lines —"
                    : emptyText}
              </div>
            )
              : shown.map((l, i) => renderLine(l, i, tsMode, matcher, currentKey))}
        </div>
        {!pinned && !loading ? (
          <button type="button" className="console-card__jump" onClick={jumpToLatest}>
            <Icon name="arrow-down" size={13} />
            {unread ? unread + (unread >= shown.length ? "+" : "") + " new" : "Latest"}
          </button>
        ) : null}
      </div>

      {footer}
    </section>
  );

  // Expand lifts the whole card into a full-screen pop-out (portaled to <body>, not promoted in
  // place — .app__main is a container-type ancestor that would clip a fixed child). The inline slot
  // keeps a quiet placeholder behind the scrim. Same pattern as the Files tab.
  return (
    <>
      {expanded ? (
        <section className="console-card">
          <div className="console-card__placeholder">
            <Icon name="maximize-2" size={24} strokeWidth={1.6} />
            <div style={{ fontSize: 13 }}>Console is in full screen.</div>
            <button type="button" className="console-card__restore" onClick={() => setExpanded(false)}>
              <Icon name="minimize-2" size={13} /> Restore
            </button>
          </div>
        </section>
      ) : body}
      {expanded && (
        <Modal onClose={() => setExpanded(false)} scrimClassName="console-modal-scrim">
          <div className="console-modal" role="dialog" aria-modal="true" aria-label={title}>
            {body}
          </div>
        </Modal>
      )}
    </>
  );
}

export { ConsoleView, renderLine, buildMatcher };
