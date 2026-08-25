import { createStore } from "./store.js";

// toasts.js — transient outcome messages, and the history that outlives them.
//
// THE RULE: a toast reports the outcome of something YOU DID, or a change to what THIS
// BROWSER may do. It never reports something that merely happened to the fleet — those
// events have homes already (the Alerts feed, the live tiles, Recent activity), and routing
// them through here would bury the panel under cards during a mass restart.
//
// The second half of that rule has exactly one occupant: a role regraded under somebody
// mid-session. That is not a fleet event, it is this panel changing under the person reading
// it — controls and tabs going, and the page possibly with them — and nothing else says why.
//
// It exists for the SHELL-LEVEL handlers. Every write path that owns a component renders its
// own error next to the control that failed, which is the better place for it — see
// ConsolePanel, ServerNotice, PlayersTab, ServerSettings. App.jsx's lifecycle and install
// handlers own no control, which is why they need this.
//
// The HISTORY is client-side on purpose, and it is not a duplicate of the audit
// log. kgsm-api writes an audit row from the ENGINE ECHO, so every command it
// refuses up front — unknown verb, unknown server, an inadmissible no-op, or a
// command already in flight — is answered and dropped before the engine is ever
// touched, and no audit row is ever written for it. Those refusals exist nowhere
// but here. The audit log remains the authority for what actually happened to
// the fleet; this is the record of what you asked for and how it went.
//
// Dependency-free beyond store.js so BOTH surfaces can hold it (the standalone
// assistant must not reach the Control Panel's data layer — see src/CLAUDE.md).

const KEY = "krystal:notifications";
const HISTORY_MAX = 50;
const HISTORY_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const LIVE_MAX = 4;
// Repeats of the same message inside this window fold into a count instead of
// stacking — the same reason kgsm-api's NotificationDeliveryWorker coalesces a
// crash loop. One mis-click that retries six times is one card, not six.
const DEDUPE_MS = 5000;

// Auto-dismiss. An ERROR is sticky: a failure reason that vanishes before it is
// read is barely better than no reason at all, which is the whole complaint this
// feature answers.
const TIMEOUT = { success: 4000, info: 6000, error: null };

let seq = 0;
const nextId = () => "t" + (++seq) + "_" + Date.now().toString(36);

// `action` holds a function and is deliberately dropped on the way to storage —
// a callback cannot survive a reload, and JSON.stringify would silently write
// null for it anyway. History rows are data; only live toasts carry behaviour.
function persistable(t) {
  const rest = { ...t };
  delete rest.action;
  return rest;
}

function prune(history, now) {
  return history
    .filter(t => (now - (t.ts || 0)) < HISTORY_TTL_MS)
    .slice(0, HISTORY_MAX);
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    return prune(arr.filter(t => t && typeof t === "object" && t.id), Date.now());
  } catch { return []; }
}

function save(history) {
  try { localStorage.setItem(KEY, JSON.stringify(history.map(persistable))); } catch {}
}

const toastStore = createStore({ live: [], history: load() });

function unreadCount(state) {
  let n = 0;
  for (const t of state.history) if (!t.read) n++;
  return n;
}

// "danger" the moment any unread one is an error, so the badge tells you whether
// what you missed needs you.
function unreadTone(state) {
  for (const t of state.history) if (!t.read && t.tone === "error") return "danger";
  return "info";
}

function push(tone, title, opts) {
  const o = opts || {};
  const now = Date.now();
  const state = toastStore.getState();

  // Fold a repeat into the card already on screen.
  const dupe = state.live.find(t => t.tone === tone && t.title === title && (now - t.ts) < DEDUPE_MS);
  if (dupe) {
    const bumped = { ...dupe, count: (dupe.count || 1) + 1, ts: now };
    toastStore.setState({
      live: state.live.map(t => (t.id === dupe.id ? bumped : t)),
      history: state.history.map(t => (t.id === dupe.id ? { ...bumped, read: t.read } : t)),
    });
    save(toastStore.getState().history);
    return dupe.id;
  }

  const t = {
    id: nextId(),
    tone,
    title: String(title || ""),
    detail: o.detail || null,
    code: o.code != null ? String(o.code) : null,
    serverId: o.serverId || null,
    action: o.action || null,
    sticky: o.sticky != null ? !!o.sticky : TIMEOUT[tone] == null,
    count: 1,
    ts: now,
    read: false,
  };

  // Dropping off the live stack is not dismissal — the card leaves the screen,
  // the row stays in the history.
  const live = [...state.live, t].slice(-LIVE_MAX);
  const history = prune([{ ...t }, ...state.history], now);
  toastStore.setState({ live, history });
  save(history);
  return t.id;
}

const toast = {
  error:   (title, opts) => push("error", title, opts),
  success: (title, opts) => push("success", title, opts),
  info:    (title, opts) => push("info", title, opts),

  // The ONE place the apiClient error shape is read. kgsm-api answers with an
  // envelope whose `message` is written for a person, and apiClient already
  // carries it through as `userMessage` (apiClient.js apiError) — so the honest
  // reason is in hand at every call site that currently throws it away.
  fromError(err, title) {
    const detail = (err && (err.userMessage || err.message)) || null;
    const code = err ? (err.envCode || err.status || err.code) : null;
    return push("error", title, {
      // Never guessed. An error carrying nothing says so rather than having a
      // plausible cause invented for it.
      detail: detail || "The backend gave no reason.",
      code: code != null ? code : null,
      serverId: (err && err.serverId) || (err && err.hostId) || null,
    });
  },

  dismiss(id) {
    const state = toastStore.getState();
    if (!state.live.some(t => t.id === id)) return;
    toastStore.setState({ live: state.live.filter(t => t.id !== id) });
  },

  // Every live card off the screen. The history is untouched.
  clearLive() { toastStore.setState({ live: [] }); },

  markAllRead() {
    const state = toastStore.getState();
    if (!state.history.some(t => !t.read)) return;
    const history = state.history.map(t => (t.read ? t : { ...t, read: true }));
    toastStore.setState({ history });
    save(history);
  },

  clearHistory() {
    toastStore.setState({ history: [] });
    save([]);
  },
};

export { toast, toastStore, unreadCount, unreadTone };
