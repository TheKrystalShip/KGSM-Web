import React from "react";
import { Icon } from "./Icon.jsx";
import { PinButton } from "./widgets/PinButton.jsx";
import { ConsoleView } from "./ConsoleView.jsx";
import { api } from "../lib/apiClient.js";
import { sendConsoleInput } from "../lib/stores.js";
import { canOn, serverOperable } from "../lib/persona.js";
import { fmtRelative, parseTs } from "../lib/formatting.js";

// ConsolePanel — the server's stdout feed + command input, rendered through the shared
// ConsoleView (the same card the host-logs tab uses, so they look identical).
//
// A finite REST tail hydrates the scrollback (GET /servers/{id}/console?tail=N →
// { lines: [string] }, oldest-first), then the per-server WS topic servers/{id}/console
// follows live lines (console.line { id, seq, line }).
//
// A game stdout line carries no timestamp, so each LIVE line is stamped with the moment it
// arrived (observed-at) — honest, never fabricated; scrollback stays un-timed (the gutter is
// reserved once any line is timed, so the two align). The host-logs feed uses the real journald
// time instead — same gutter, same card.
//
// The input sends an arbitrary console command (POST /servers/{id}/console) to a running NATIVE
// server; the response, if any, streams back on the same WS topic (no local echo — we never
// fabricate console output, only show real stdout). The input is shown only to operators on native
// servers; otherwise an honest read-only note explains why (container / no permission).

// Non-"Live" pill copy, keyed by the FE run-state vocabulary (online maps to "Live" directly;
// anything missing falls back to "Unknown").
const PILL_LABEL = {
  offline: "Offline",
  crashed: "Crashed",
  updating: "Updating",
  stopping: "Stopping",
  restarting: "Restarting",
  installing: "Installing",
  "backing-up": "Backing up",
  restoring: "Restoring",
  error: "Error",
  unknown: "Unknown",
};

// The scrollback is a WINDOW, not a transcript: the feed follows for as long as the panel is open,
// so an uncapped buffer grows without limit and every arriving line re-renders all of it. The
// newest MAX_LINES are kept and the oldest fall off — the console is a tail, and the durable
// record of what a server printed is the server's own log on disk, not this card.
const MAX_LINES = 1000;

// Sent-command recall, per server, in this browser. Capped because it is a convenience, not a record.
const HISTORY_MAX = 50;
const historyKey = (server) => "krystal:console:history:" + (server && server.hostId) + ":" + (server && server.id);

function loadHistory(server) {
  if (!server || !server.id) return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(historyKey(server)) || "[]");
    return Array.isArray(parsed) ? parsed.filter(h => typeof h === "string" && h) : [];
  } catch { return []; }   // unreadable / disabled storage is no history, never a broken console
}

function saveHistory(server, list) {
  if (!server || !server.id) return;
  try { localStorage.setItem(historyKey(server), JSON.stringify(list)); } catch { /* full or blocked — recall is best-effort */ }
}

// How many lines one "load earlier" step fetches. Bigger than the opening tail because it is asked
// for deliberately, and each step costs a round trip.
const EARLIER_PAGE = 500;

// How many recent commands the strip under the input shows. Short on purpose — it answers "did
// somebody just run something?", and the whole record is the audit log.
const RECENT_COMMANDS = 5;

// Who has been sending commands to THIS server, from the audit log. The point is that a console is
// not private: the bot, the assistant and every other operator reach the same one, so a command
// appearing in the feed with no explanation is a real question this answers. The API is the
// authority — it writes these rows from the engine's echo, which is why they include the commands
// this browser never sent — and it redacts what the caller may not read, so this renders the
// summary it is given rather than assembling its own.
function useRecentCommands(server, enabled) {
  const [rows, setRows] = React.useState([]);
  const hostId = server && server.hostId;
  const id = server && server.id;

  React.useEffect(() => {
    if (!enabled || !hostId || !id) { setRows([]); return undefined; }
    let alive = true;
    const qs = "?serverId=" + encodeURIComponent(id) + "&category=console&limit=" + RECENT_COMMANDS;
    const load = () => api.host(hostId).get("/audit" + qs).then(
      (page) => { if (alive) setRows(((page && page.rows) || []).filter(r => r && r.action === "console.input.sent")); },
      () => { if (alive) setRows([]); }   // no audit access / unreachable — show nothing, claim nothing
    );
    load();
    // The row is written from the engine's echo, so it lands a moment after the command does; the
    // live topic is what saves this from polling for it.
    const dispose = api.stream.subscribe(["audit"], (m) => {
      if (!alive || !m || m.type !== "audit.append" || !m.data) return;
      if (m.data.action !== "console.input.sent" || m.data.serverId !== id) return;
      setRows(prev => [m.data, ...prev.filter(r => r.id !== m.data.id)].slice(0, RECENT_COMMANDS));
    });
    return () => { alive = false; dispose(); };
  }, [enabled, hostId, id]);

  return rows;
}

// Live scrollback hook: REST tail then WS follow. Subscribes FIRST and buffers live lines, so a
// frame that arrives during the REST round-trip can't land before the tail (ordering: tail, then
// buffered live, then ongoing). Dedups WS frames by seq. Each live line is stamped with its arrival
// time ({ at, seq, text }); scrollback stays a raw string (no honest time). Returns null until
// hydrated.
//
// Reading further back is a THIRD segment ahead of those two. The API reports the byte range each
// window came from, and `earlier` is asked for by passing that cursor back, so pages meet exactly
// while the game keeps printing. It is exempt from the live cap: the cap exists to stop a feed
// growing on its own, and lines someone asked for by name are not that — they stay until the panel
// is closed or the reader jumps back to the live tail.
function useLiveConsole(server) {
  const [state, setState] = React.useState({ lines: null, cursor: null, hasEarlier: false, loading: false });
  const loadEarlierRef = React.useRef(null);

  React.useEffect(() => {
    if (!server) return;
    if (!server.hostId) return;
    let alive = true, hydrated = false;
    const earlier = [];       // pages the reader asked for, oldest-first, never auto-trimmed
    const tail = [];          // REST scrollback (strings, no seq, no time)
    const follow = [];        // live WS lines, in arrival order, stamped with observed-at
    const seen = new Set();
    let cursor = null;        // byte offset the oldest loaded line begins at
    let hasEarlier = false;
    let loading = false;
    const flush = () => {
      if (alive) setState({ lines: [...earlier, ...tail, ...follow], cursor, hasEarlier, loading });
    };
    // Drop the oldest lines down to the cap, scrollback first (it is the older half by
    // construction). A dropped line's seq leaves `seen` with it, so the dedup set stays the size of
    // what's retained instead of becoming the unbounded thing the buffer no longer is.
    const trim = () => {
      let over = tail.length + follow.length - MAX_LINES;
      if (over <= 0) return;
      if (tail.length) { const n = Math.min(over, tail.length); tail.splice(0, n); over -= n; }
      if (over > 0) for (const dropped of follow.splice(0, over)) if (dropped.seq != null) seen.delete(dropped.seq);
    };
    // Subscribe first so nothing emitted during hydrate is lost; buffer until tail lands.
    const dispose = api.stream.subscribe(["servers/" + server.id + "/console"], (m) => {
      if (!alive || !m || m.type !== "console.line" || !m.data) return;
      const { seq, line } = m.data;
      if (seq != null) { if (seen.has(seq)) return; seen.add(seq); }
      follow.push({ at: Date.now(), seq, text: line });   // observed-at timestamp for the live line
      trim();
      if (hydrated) flush();
    });

    const path = "/servers/" + server.id + "/console";
    api.host(server.hostId).get(path + "?tail=200").then(
      (res) => {
        (res && res.lines || []).forEach((l) => tail.push(l));
        // A watchdog too old to report the range answers hasEarlier false, so nothing offers a way
        // back that would re-serve these same lines.
        cursor = res && typeof res.start === "number" ? res.start : null;
        hasEarlier = !!(res && res.hasEarlier);
        hydrated = true; trim(); flush();
      },
      () => { hydrated = true; trim(); flush(); }   // no scrollback (watchdog down / non-native) — live follow still works
    );

    // Read the window ending where the oldest loaded line begins. Resolves to how many lines landed,
    // so the caller can hold the reader's scroll position across the prepend.
    loadEarlierRef.current = () => {
      if (!alive || loading || !hasEarlier || cursor == null) return Promise.resolve(0);
      loading = true; flush();
      return api.host(server.hostId).get(path + "?tail=" + EARLIER_PAGE + "&before=" + cursor).then(
        (res) => {
          if (!alive) return 0;
          const page = (res && res.lines) || [];
          earlier.unshift(...page);
          cursor = res && typeof res.start === "number" ? res.start : cursor;
          hasEarlier = !!(res && res.hasEarlier);
          loading = false; flush();
          return page.length;
        },
        () => { if (alive) { loading = false; flush(); } return 0; }
      );
    };

    return () => { alive = false; dispose(); loadEarlierRef.current = null; };   // unsubscribe re-idles the backend's console bridge
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only server.id/hostId are used (and in deps); the object churns each render, so depping it would resubscribe constantly
  }, [server && server.id, server && server.hostId]);

  const loadEarlier = React.useCallback(() => {
    const fn = loadEarlierRef.current;
    return fn ? fn() : Promise.resolve(0);
  }, []);

  return { ...state, loadEarlier };
}

function ConsolePanel({ server, extraLines = [], readOnly }) {
  const live = !!server;
  const feed = useLiveConsole(live ? server : null);
  const liveLines = feed.lines;
  const [draft, setDraft] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [err, setErr] = React.useState(null);

  // ↑/↓ recall what has been sent to THIS server. Kept per (host, server) because the commands a
  // console takes are the game's, not the operator's — a Minecraft `/kick` recalled into a Factorio
  // console is noise. This browser's own record: the authoritative one is kgsm-api's audit log,
  // which records every command with its actor, including the ones sent from somewhere else.
  const [history, setHistory] = React.useState(() => loadHistory(server));
  const [histAt, setHistAt] = React.useState(-1);   // -1 = the live draft, 0 = the most recent command
  const draftRef = React.useRef("");                // what was being typed before stepping back into history
  React.useEffect(() => {
    setHistory(loadHistory(server)); setHistAt(-1); draftRef.current = "";
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the identity of the server, not the row object, which churns every render
  }, [server && server.id, server && server.hostId]);

  const recall = (e) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    if (!history.length) return;
    // Already back at the live draft — ↓ is an ordinary caret key again, and must not overwrite
    // what is being typed with a draft held from before the last edit.
    if (e.key === "ArrowDown" && histAt === -1) return;
    e.preventDefault();
    if (e.key === "ArrowUp") {
      if (histAt === -1) draftRef.current = draft;   // hold the half-typed command to come back to
      const at = Math.min(histAt + 1, history.length - 1);
      setHistAt(at); setDraft(history[at]);
      return;
    }
    const at = histAt - 1;
    if (at < 0) { setHistAt(-1); setDraft(draftRef.current); }
    else { setHistAt(at); setDraft(history[at]); }
  };

  const lines = React.useMemo(
    () => (live ? (liveLines || []) : [...((server && server.log) || []), ...extraLines]),
    [live, liveLines, server, extraLines]
  );
  const loading = live && liveLines == null;

  // The pill reflects the server's RUN-STATE, not a hardcoded "Live". The feed follows live stdout
  // only while the process is actually running; offline / crashed / updating / unknown have nothing
  // live to follow, so the pill drops its green pulse and names the real state.
  const isRunning = live && server.status === "online";
  const pill = isRunning
    ? { label: "Live", live: true }
    : { label: PILL_LABEL[live ? server.status : "unknown"] || "Unknown", live: false };

  // The command channel is native-only (the watchdog owns a native process's stdin; Docker owns a
  // container's), needs operator permission ON THIS host, requires the server to actually be running,
  // and is hidden in a forced read-only view (the player tab). The backend re-checks all of this —
  // this only decides whether to show the input vs. an honest note explaining why it's unavailable.
  const isNative = live && server.runtime === "native";
  const canSend = live && !readOnly && isNative && isRunning && serverOperable(server);

  const submit = (e) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setErr(null);
    // Recorded on SEND, not on the 202: a command the engine refused because the server had just
    // stopped is exactly the one worth pressing ↑ for.
    setHistory((prev) => {
      const next = [text, ...prev.filter(h => h !== text)].slice(0, HISTORY_MAX);
      saveHistory(server, next);
      return next;
    });
    setHistAt(-1); draftRef.current = "";
    sendConsoleInput(server, text).then(
      () => { setDraft(""); setSending(false); },   // delivered — the response streams in live
      (e2) => { setSending(false); setErr((e2 && (e2.userMessage || e2.message)) || "Couldn't send the command."); }
    );
  };

  // When the input is hidden, say why (only meaningful for a live server). Order by precedence of the
  // blocking reason: structural (container) → permission → run-state.
  const note = !live ? null
    : !isNative ? { icon: "terminal-square", text: "Console input isn’t available for container servers — Docker owns their console." }
    : !serverOperable(server) ? { icon: "lock", text: "Read-only — you don’t have permission to send console commands." }
    : !isRunning ? { icon: "power-off", text: server.status === "unknown"
        ? "Console input is unavailable — the server’s state can’t be confirmed."
        : "Console input is unavailable while the server is offline — start it to send commands." }
    : null;

  // Gated on this host's audit reach, which is the same gate the audit page uses — the rows come
  // from the same endpoint, so asking without it would just collect 403s.
  const recent = useRecentCommands(live ? server : null, live && !readOnly && canOn("nav.audit", server && server.hostId));

  // Who has been sending commands here. Shown under the input rather than in the feed: these are
  // audit rows, not console output, and putting them in the stream would be writing lines the server
  // never printed. The command may be redacted by the API for a caller not permitted it, so the
  // row's own summary is what renders.
  const commandStrip = recent.length ? (
    <div className="console-card__recent">
      <div className="console-card__recent-head">
        <Icon name="history" size={11} /> Recent commands
      </div>
      {recent.map(r => (
        <div className="console-card__recent-row" key={r.id}>
          <span className="console-card__recent-when">{fmtRelative(parseTs(r.ts) || new Date())}</span>
          <span className="console-card__recent-who">{(r.actor && r.actor.name) || "unknown"}</span>
          {r.origin && r.origin !== "ui" ? <span className="console-card__recent-via">via {r.origin}</span> : null}
          <span className="console-card__recent-what">{(r.meta && r.meta.command) || r.summary}</span>
        </div>
      ))}
    </div>
  ) : null;

  // The footer (input or read-only note) renders inside the card, below the body — so the
  // full-screen pop-out (owned by ConsoleView) carries it too.
  const footer = canSend ? (
    <>
      <form className="console-card__input" onSubmit={submit}>
        <input
          value={draft}
          onChange={e => { setDraft(e.target.value); setHistAt(-1); if (err) setErr(null); }}
          onKeyDown={recall}
          placeholder="Type a console command (e.g. say hello, kick player)…"
          title={history.length ? "↑ / ↓ recalls the commands you've sent to this server" : undefined}
          spellCheck="false"
          disabled={sending}
        />
        <button type="submit" disabled={!draft.trim() || sending}>Send</button>
      </form>
      {err ? (
        <div className="console-card__error" role="alert">
          <Icon name="triangle-alert" size={12} /> {err}
        </div>
      ) : null}
      {commandStrip}
    </>
  ) : note ? (
    <>
      <div className="console-card__readonly">
        <Icon name={note.icon} size={12} /> {note.text}
      </div>
      {commandStrip}
    </>
  ) : commandStrip;

  // The whole of the run's log, not the window on screen. It is fetched rather than linked because
  // every gated read carries a bearer and a top-level navigation sends no Authorization header — the
  // browser would save an anonymous 401 page named like a log.
  const download = React.useCallback(() => {
    if (!live) return Promise.reject(new Error("no server"));
    return api.host(server.hostId).blob("/servers/" + server.id + "/console/download").then(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = server.id + "-console.log";
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Let the click start the save before the object URL stops resolving.
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the server's identity; the row object churns every render
  }, [live, server && server.id, server && server.hostId]);

  return (
    <ConsoleView
      title="Console"
      lines={lines}
      pill={pill}
      pin={<PinButton type="server.console" params={{ serverId: server && server.id }}
        label={(server && server.name) || "this console"} />}
      loading={loading}
      footer={footer}
      onLoadEarlier={live && feed.hasEarlier ? feed.loadEarlier : null}
      loadingEarlier={feed.loading}
      onDownload={live ? download : null}
      downloadName={live ? server.id + "-console.log" : null}
      resetKey={(server && server.id) + "@" + (server && server.hostId)}
    />
  );
}

export { ConsolePanel };
