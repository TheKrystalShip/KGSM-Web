import React from "react";
import { Icon } from "../components/Icon.jsx";
import { VoiceComposerBar, useVoiceRecorder } from "../components/VoiceNote.jsx";
import { createSpokenReply, armAudio } from "./spokenReply.js";
import { useStore } from "../lib/store.js";
import { assistant } from "../lib/assistantClient.js";
import { assistantSession } from "../lib/assistantSession.js";

// Imports from extracted modules
import {
  TOGGLE_COPY,
  loadConversations, saveConversations,
  uid, adaptResultCard, adaptBlueprintConfirm, composeVerified, reduceTurnFrame, promotePendingCards,
  scaffoldHistory, scaffoldConversation,
  scaffoldLiveTurn, latestUsage, mergeServerConversations, adoptServerConversation,
} from "./chatUtils.jsx";
import {
  LEAF_COMMAND_VERBS, CHAT_PRIVACY_NOTICE, NEW_CHAT_TITLE, commandMeta, conversationTitle, pickGreeting,
} from "./chatConstants.js";
// ChatCommand is imported only to re-export it (see the export list below); the
// message-role dispatch that used it now lives in ChatThread.
import { ChatCommand } from "./ChatMessageParts.jsx";
import { ChatCommandMenu } from "./ChatCommandMenu.jsx";
import { resolveCommand, suggestFor } from "./chatCommands.js";
import { ChatContextMeter } from "./ChatContextMeter.jsx";
import { ChatHistory } from "./ChatHistory.jsx";
import { RecentConversations } from "./RecentConversations.jsx";
import { ChatThread } from "./ChatThread.jsx";
import { useConversationStream } from "./useConversationStream.js";

// ChatPage renders a conversation with ONE assistant leaf. Everything that is true of the surface
// around it rather than of the conversation arrives as a prop, because the two surfaces that render
// it differ in exactly those things: the Control Panel drives a cluster (several leaves, a picker,
// a server roster, per-host roles, an admin review mode), while the standalone assistant is one leaf
// with none of that. Defaults describe the smaller surface, so the standalone one passes almost
// nothing and gets a chat.
//
// `assistantHost` stays the identity of the leaf being addressed — `{ id, name }` — because the
// session layer and the client are both keyed by it. The standalone surface names its own.
// The frames that belong to a running TURN, as opposed to the state events about the chat list. They
// carry no turn id of their own, so they apply to whichever turn last announced itself on the stream.
const TURN_FRAMES = new Set([
  "text.delta", "thinking.delta", "tool.start", "tool.result", "progress",
  "command.proposed", "done", "error",
  // One sentence of the reply, spoken. Handled as a side effect rather than through the message
  // reducer: it is audio to play, not state to render, and nothing about the transcript changes.
  "audio.delta",
]);

function ChatPage({
  user, onOpenServer, onOpenView, docked, seed, onClose, onExpand, onNavigate, getServerState,
  assistantHost, assistantHosts = [], onSelectAssistantHost,
  showPin, pinned, pinDisabled, onTogglePin, review, onExitReview,
  // ---- the environment ----
  // `connection` is the header badge and the usable gate, already decided: the panel folds a
  // capability into it, the standalone surface knows it is talking to itself.
  connection,
  // Tier capabilities for THIS leaf. The panel reads its per-host persona; the standalone surface
  // reads the tier its own session carries.
  canSeeActions = false, canUseActions = false,
  // The server roster, for the opening suggestions and for naming a command's target. Empty is a
  // fine answer — the suggestions fall back to generic ones and a target is named by its id.
  servers = [],
  // Admin review of someone else's conversation. Absent ⇒ the surface has no review mode.
  loadTranscript = null,
  // Cluster chrome, injected because it means nothing with one leaf.
  BriefingPanel = null, HostPicker = null,
  // What an evidence card needs to name a node (EvidenceCards' `nodes`).
  nodes,
  // An extra class on the page root, for a surface that lays the chat out differently — the
  // standalone assistant owns the whole viewport, the panel gets a content area inside a shell.
  pageClass = "",
  // The way to this surface's own settings, when the chat IS the app and so carries the only route
  // to it. Absent on the panel, where the shell's sidebar already leads there and a second entry
  // point inside the dock would open the wrong page's settings.
  onOpenSettings = null,
}) {
  const conn = connection || { tone: "muted", label: "No assistant", usable: false, message: null };
  const assistantUsable = !!conn.usable;

  // The chat holds its OWN session with the assistant leaf — the leaf issues it, and the node's
  // kgsm-api session neither mints nor refreshes it. So a user signed in to the panel can still
  // owe the assistant a sign-in, and that is worth saying plainly instead of letting every message
  // fail on a 401.
  const leafStatus = useStore(assistantSession, s => {
    const rec = assistantHost ? s.byHost[assistantHost.id] : null;
    return rec ? rec.status : "none";
  });
  const assistantAuthed = leafStatus === "live";
  // The sign-in is normally automatic and invisible (AssistantDockContext → ensureSession): every
  // surface on a host is the same Discord application, so a browser signed into the panel has
  // already authorized the assistant. This bar is the FALLBACK for the one case that genuinely
  // needs a person — Discord declined the silent round trip and wants a consent — plus the case
  // where an attempt was already spent in this tab and came back with nothing.
  const consentNeeded = !!(assistantHost && assistantSession.needsConsent(assistantHost.id));
  const needsAssistantSignIn = !!(
    assistantHost && assistantUsable && !assistantAuthed
    && leafStatus !== "bootstrapping"
    && (consentNeeded || assistantSession.attempted(assistantHost.id)));

  const [convos, setConvos]     = React.useState(loadConversations);
  const [activeId, setActiveId] = React.useState(() => loadConversations()[0]?.id || null);
  const [input, setInput]       = React.useState("");
  const [busy, setBusy]         = React.useState(false);

  const serverList = servers;


  // Thinking and auto-run are the CONVERSATION's, held by the leaf and read by the turn — so these
  // are a mirror of what the leaf last told us, never the value the turn runs on. Auto-run is
  // deliberately per-conversation: it is the one switch that skips the confirmation gate, and a
  // preference that followed the person around would arm chats they were not looking at.
  const active = convos.find(c => c.id === activeId) || null;
  const thinkOn = !!(active && active.think);
  const actionsOn = !!(active && active.autorun);
  const autoAcceptActive = actionsOn && canUseActions;
  // Whether the open conversation's transcript is known to be behind — set when the leaf says its log
  // grew somewhere else. Read as a scalar so the detail effect can depend on it without depending on
  // the whole conversation list.
  const activeStale = !!(active && active.stale);

  // Reflect what the leaf answered, and say so in the transcript. The leaf's `state` is what lands —
  // a toggle asked for is not a toggle granted, and showing the asked-for value would report a
  // change that may not have happened.
  const applySwitch = React.useCallback((convId, toggle, on) => {
    const field = toggle === "thinking" ? "think" : "autorun";
    const label = TOGGLE_COPY[toggle][on ? "on" : "off"];
    setConvos(prev => prev.map(c => c.id !== convId ? c : {
      ...c,
      [field]: on,
      messages: c.messages.length > 0
        ? [...c.messages, { role: "toggle", toggle, on, label }]
        : c.messages,
    }));
  }, []);

  // What this person may type at THIS leaf, in the leaf's own words. Already filtered to their tier,
  // so nothing here is a policy decision made in the browser — a command they cannot run never
  // arrives, and there is no disabled row to explain. An unreachable or unauthenticated leaf leaves
  // the catalog empty, which turns the whole surface off rather than offering something that would
  // fail: a slash then just starts a message, exactly as it did before there were commands.
  const [commandCatalog, setCommandCatalog] = React.useState([]);
  React.useEffect(() => {
    if (!assistantHost || !assistantUsable || !assistantAuthed) { setCommandCatalog([]); return; }
    let live = true;
    assistant.host(assistantHost.id).commands()
      .then((list) => { if (live) setCommandCatalog(Array.isArray(list) ? list : []); })
      .catch(() => { if (live) setCommandCatalog([]); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only assistantHost.id is used (and in deps); the object is re-derived each render
  }, [assistantHost && assistantHost.id, assistantUsable, assistantAuthed]);

  const scrollRef = React.useRef(null);
  const abortRef  = React.useRef(null);

  // Reading answers aloud. Off until asked: a page that starts talking is a surprise in a room with
  // other people in it, and a browser refuses audio before a gesture anyway. Remembered per
  // conversation, because whether you want to listen belongs to the conversation you are in.
  const [speak, setSpeak] = React.useState(false);
  // The browser refused to play audio at all. Shown on the toggle, which is the control that asked.
  const [speakBlocked, setSpeakBlocked] = React.useState(false);
  // What this host's speech engine can do — `{ hear, speak }`, or null until asked. `hear` is what
  // decides who transcribes a voice note, so it is read before the microphone is offered rather than
  // discovered by a recording nobody can read.
  //
  // A host that cannot be asked reads as neither. That is the honest answer and also the safe one:
  // the microphone falls back to the browser's own recogniser, which is exactly what a host with no
  // speech leaf gets, so an unreachable leaf degrades to the same place as an absent one.
  const [hostSpeech, setHostSpeech] = React.useState(null);
  React.useEffect(() => {
    if (!assistantHost || !assistantUsable || !assistantAuthed) { setHostSpeech(null); return; }
    let live = true;
    assistant.host(assistantHost.id).speech()
      .then((s) => { if (live) setHostSpeech(s && typeof s === "object" ? s : null); })
      .catch(() => { if (live) setHostSpeech(null); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only assistantHost.id is used (and in deps); the object is re-derived each render
  }, [assistantHost && assistantHost.id, assistantUsable, assistantAuthed]);
  // The player for the turn now running. One at a time — a new turn stops the last one's audio, which
  // is what makes the stop button silence it as well.
  const spokenRef = React.useRef(null);
  const speakRef = React.useRef(false);
  React.useEffect(() => { speakRef.current = speak; }, [speak]);
  // Whether the in-flight turn's POST was let go because this surface came back from being frozen,
  // as opposed to the person pressing Stop. The two look identical to the fetch (both are an
  // AbortError) and mean opposite things in the transcript: one is "you stopped it", the other is
  // "I lost sight of it and am about to re-read what actually happened".
  const resumedRef = React.useRef(false);
  // The OPEN blueprint draft's live content, so a chat turn can carry it to the assistant (which lets it
  // revise the draft via revise_blueprint). draftEditsRef maps a draft's cmdId → its current editor text
  // (manual edits included); activeDraftRef is the cmdId of the draft currently being reviewed.
  const draftEditsRef  = React.useRef({});
  const activeDraftRef = React.useRef(null);
  const onDraftEdit   = React.useCallback((cmdId, text) => { if (cmdId) draftEditsRef.current[cmdId] = text; }, []);
  const onDraftActive = React.useCallback((cmdId, active) => {
    if (active) activeDraftRef.current = cmdId;
    else if (activeDraftRef.current === cmdId) activeDraftRef.current = null;
  }, []);
  const taRef     = React.useRef(null);
  const pinnedRef = React.useRef(true);

  React.useEffect(() => { saveConversations(convos); }, [convos]);

  const [histLoading, setHistLoading] = React.useState(false);
  const histReqRef = React.useRef(0);
  const loadServerHistory = React.useCallback(() => {
    if (!assistantHost || !assistantUsable || !assistantAuthed) return;
    const reqId = ++histReqRef.current;
    setHistLoading(true);
    assistant.host(assistantHost.id).conversations().then(
      (list) => { if (histReqRef.current === reqId) setConvos(prev => mergeServerConversations(prev, list, assistantHost.id)); },
      () => {})
      .finally(() => { if (histReqRef.current === reqId) setHistLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only assistantHost.id is used (and in deps); the object is re-derived each render
  }, [assistantHost && assistantHost.id, assistantUsable, assistantAuthed]);

  // The conversations the LEAF holds are this list's other half — everything from another browser,
  // another device, or this one before its localStorage was cleared. Fetched as soon as there is a
  // session to fetch them with, so the rail is the whole history rather than only what this browser
  // happens to remember. loadServerHistory is a no-op until authed and re-identifies when the
  // addressed host changes, so this runs once per host per session.
  React.useEffect(() => { loadServerHistory(); }, [loadServerHistory]);

  // And again whenever this surface comes back to the foreground. The conversation's switches and the
  // chat list both live at the leaf, and the other surface — the panel in another tab, the installed
  // app on a phone — can move them while this one is backgrounded. Re-reading on the way back in is
  // what makes the toggles show the conversation's state rather than this browser's memory of it.
  React.useEffect(() => {
    // One return to the foreground fires visibilitychange AND focus, and the two say the same thing —
    // so the second is coalesced away rather than fetching the list twice every time.
    let last = 0;
    const refresh = () => {
      if (document.visibilityState !== "visible" || Date.now() - last < 1000) return;
      last = Date.now();
      loadServerHistory();

      // ⚠ And let go of a turn POST that was open when this surface was backgrounded. A frozen page's
      // fetch is dead whether or not its promise ever settles, and while this code believes it is open
      // three things stay wrong at once: `busy` never clears, the transcript refetch is gated off
      // behind it, and the event stream's frames keep being skipped as this surface's own. The result
      // is a permanent "the assistant is typing" over a turn that finished minutes ago — which is
      // exactly the state somebody returns to after acting on a push notification.
      //
      // Letting go costs nothing: a turn is a SESSION at the leaf, not this request, so one genuinely
      // still running is restated by the stream's next attach, and one that finished is restated by
      // the re-read.
      if (abortRef.current) {
        resumedRef.current = true;
        abortRef.current.abort();
      }
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [loadServerHistory]);

  // What the leaf pushes while this surface is open, so a conversation held in two places agrees with
  // itself. Only changes made SOMEWHERE ELSE arrive here — the hook drops this surface's own echoes —
  // so every branch below is reacting to another tab, another device, or Discord.
  //
  // The switches are applied from the frame, which carries them; everything else names a conversation
  // and nothing more, and is answered by re-reading. That split is deliberate: a transcript has one
  // way to be obtained, and a second streaming path for it could drift from the first.
  // The turn running on the conversation this surface is looking at, whoever asked for it:
  // { conversationId, turnId, state, queued: [{turnId, prompt}] }. It is the CONVERSATION's, not this
  // browser's — which is why Stop is a call any surface can make and why the composer is busy for
  // everyone while a turn runs, not only for whoever typed it.
  const [liveTurn, setLiveTurn] = React.useState(null);
  // The turn this surface is streaming over its own POST. Its frames arrive twice — once on that
  // response and once on the event stream — so the event stream's copy is skipped until the POST is
  // done, at which point the next attach takes over.
  const ownTurnRef = React.useRef(null);

  const applyTurnFrame = React.useCallback((convId, evt) => {
    setConvos(prev => prev.map(c =>
      c.id === convId ? { ...c, messages: reduceTurnFrame(c.messages, evt) } : c));
  }, []);

  const applyLeafEvent = React.useCallback((evt) => {
    const id = evt.conversationId;

    // ---- the turn frames: a turn on the conversation this surface is attached to ----
    if (evt.type === "turn.attach") {
      // A turn announcing itself, or the leaf restating one after this stream fell behind. Either way
      // the snapshot is the leaf's own account and replaces whatever was being rendered for it.
      if (ownTurnRef.current === evt.turnId) return;
      setLiveTurn({
        conversationId: id, turnId: evt.turnId, state: evt.state, queued: evt.queued || [],
      });
      setConvos(prev => prev.map(c =>
        c.id === id ? { ...c, messages: scaffoldLiveTurn(c.messages, evt) } : c));
      return;
    }

    if (evt.type === "turn.queue") {
      setLiveTurn(prev => {
        if (!evt.runningTurnId) return null;             // nothing is running here any more
        if (!prev || prev.turnId !== evt.runningTurnId) return prev;
        return { ...prev, queued: evt.queued || [] };
      });
      return;
    }

    if (TURN_FRAMES.has(evt.type)) {
      // Frames carry no turn id of their own — they belong to whatever turn last announced itself on
      // this stream, which is why an attach always precedes them.
      if (!liveTurnRef.current || ownTurnRef.current === liveTurnRef.current.turnId) return;
      applyTurnFrame(liveTurnRef.current.conversationId, evt);
      if (evt.type === "done" || evt.type === "error") {
        setConvos(prev => prev.map(c => c.id !== liveTurnRef.current.conversationId ? c : {
          ...c,
          messages: c.messages.map(m => (m.live ? { ...m, live: false } : m)),
        }));
        setLiveTurn(null);
      }
      return;
    }

    if (typeof id !== "string") return;

    if (evt.type === "conversation.switches") {
      // Say it in the transcript too, not only on the toggle. A switch moved elsewhere changes what
      // the NEXT turn on this conversation does, and a toggle sliding over on its own reads as a
      // glitch — the same line the surface that moved it wrote is what makes it an event that
      // happened. Which switch moved is derived by diffing: the frame states where BOTH now stand
      // (so a client applying it lands where a listing would), not which one was touched.
      setConvos(prev => prev.map(c => {
        if (c.id !== id) return c;
        const next = { ...c, think: !!evt.think, autorun: !!evt.autorun };
        // Only a conversation whose value this surface already knew can have seen it change; the
        // first read of a switch is not somebody moving it.
        const moved = [
          ["thinking", "think", !!evt.think],
          ["actions", "autorun", !!evt.autorun],
        ].filter(([, field, on]) => typeof c[field] === "boolean" && c[field] !== on);
        if (moved.length && c.messages.length > 0) {
          next.messages = [...c.messages, ...moved.map(([toggle, , on]) => ({
            role: "toggle", toggle, on, label: TOGGLE_COPY[toggle][on ? "on" : "off"],
          }))];
        }
        return next;
      }));
      return;
    }

    // A thumb left on an answer somewhere else. Applied by turn id, which addresses one bubble
    // wherever it is rendered, so this lands whether or not the conversation is the one on screen.
    if (evt.type === "conversation.feedback") {
      setConvos(prev => prev.map(c => c.id !== id ? c : {
        ...c,
        messages: c.messages.map(m => m.turnId !== evt.turnId ? m : {
          ...m,
          feedback: evt.rating ? { rating: evt.rating, note: evt.note || null } : null,
        }),
      }));
      return;
    }

    if (evt.type === "conversation.deleted") {
      setConvos(prev => {
        const next = prev.filter(c => c.id !== id);
        if (next.length === prev.length) return prev;
        // Deleted out from under us: fall back to the next chat rather than leaving a dead selection.
        setActiveId(current => (current === id ? (next[0]?.id || null) : current));
        return next;
      });
      return;
    }

    if (evt.type === "conversation.started") { loadServerHistory(); return; }

    if (evt.type === "conversation.activity") {
      // The rail's title and order come from the listing. The transcript is marked behind only for a
      // conversation this surface is NOT watching live — one it mirrored frame by frame already holds
      // what the turn produced, and refetching would replace it with an identical copy mid-render.
      setConvos(prev => prev.map(c => (c.id === id && !c.messages.some(m => m.live)
        ? { ...c, stale: true } : c)));
      loadServerHistory();
    }
    // liveTurn is absent from the deps on purpose: it is read through liveTurnRef so a frame
    // handler is not rebuilt on every delta.
  }, [loadServerHistory, applyTurnFrame]);

  // Read inside the frame handler through a ref: the handler must not be rebuilt on every text delta,
  // and it needs the CURRENT turn rather than the one captured when it was created.
  const liveTurnRef = React.useRef(liveTurn);
  liveTurnRef.current = liveTurn;

  // A reconnected stream knows nothing about the gap it was down for, so the listing is re-read: it
  // restates every conversation's switches, and its turn counts are what say whether a transcript
  // actually moved on. Marking the open one behind unconditionally would refetch it on every
  // reconnect — a proxy timeout is ordinary — and each refetch would drop the rows only this browser
  // holds, so the merge decides that from the counts instead.
  const resyncAfterGap = React.useCallback(() => { loadServerHistory(); }, [loadServerHistory]);

  useConversationStream({
    hostId: assistantHost && assistantHost.id,
    enabled: !!(assistantHost && assistantUsable && assistantAuthed),
    // Turn frames arrive at token rate, so the leaf sends them only for the conversation on screen.
    conversationId: activeId,
    onEvent: applyLeafEvent,
    onResync: resyncAfterGap,
  });

  // Switching conversations abandons whatever was being rendered for the old one's turn: the attach
  // that follows says what is happening on the new one, and the old turn goes on running without us.
  React.useEffect(() => { setLiveTurn(null); }, [activeId]);

  // Fetch the open conversation's detail when we are missing either half of it: its transcript (a
  // chat this browser has never seen) or its switches (which the leaf owns, so the composer cannot
  // know them until it asks). The response carries the switches already resolved against the host's
  // configured default, so the toggles show what the next turn will actually do rather than a guess
  // this browser made about an unset value.
  React.useEffect(() => {
    if (!assistantHost || !assistantAuthed) return;
    const c = convos.find(x => x.id === activeId);
    if (!c) return;
    if (c.hostId && c.hostId !== assistantHost.id) return;

    // `stale` is set by a conversation.activity event: the log grew somewhere else, so the transcript
    // this browser holds is behind. Deferred while a turn is streaming HERE — replacing the messages
    // mid-stream would tear out the bubble being written into — and picked up when it finishes, which
    // is why `busy` is a dependency.
    const wantsHistory = (c.remote && !c.loaded && !(c.messages && c.messages.length > 0))
      || (c.stale && !busy);
    const wantsSwitches = typeof c.think !== "boolean" || typeof c.autorun !== "boolean";
    if (!wantsHistory && !wantsSwitches) return;

    let cancelled = false;
    assistant.host(assistantHost.id).conversation(c.id).then(
      (data) => {
        if (cancelled) return;
        setConvos(prev => prev.map((x) => {
          if (x.id !== c.id) return x;
          const next = { ...x, think: !!(data && data.think), autorun: !!(data && data.autorun) };
          return wantsHistory
            ? { ...next, messages: scaffoldConversation(data), loaded: true, stale: false }
            : next;
        }));
      },
      () => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only assistantHost.id is used (in deps); convos is intentionally excluded (depping it would refetch on every streamed message) in favour of the two scalars read off the open one
  }, [activeId, assistantHost && assistantHost.id, assistantAuthed, activeStale, busy]);

  // ===== Review mode =====
  // Replaying someone ELSE's conversation, read-only. The admin transcript DTO is deliberately the
  // same shape as the caller's own history, so it goes through the very same scaffoldHistory →
  // ChatThread path — a reviewer sees what that person saw, drawn by the same components, and there
  // is no second renderer able to drift from this one.
  const [reviewMessages, setReviewMessages] = React.useState(null);
  const [reviewState, setReviewState] = React.useState("idle");

  React.useEffect(() => {
    if (!review || !review.conversation || !loadTranscript) { setReviewMessages(null); setReviewState("idle"); return undefined; }
    let cancelled = false;
    setReviewState("loading");
    setReviewMessages(null);
    loadTranscript(review.hostId, review.conversation.id).then(
      (data) => {
        if (cancelled) return;
        setReviewMessages(scaffoldHistory(data && data.entries));
        setReviewState("ready");
      },
      () => { if (!cancelled) setReviewState("error"); },
    );
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the review subject; loadTranscript is the surface's fixed capability, not state
  }, [review]);

  const prevUsableRef = React.useRef(assistantUsable);
  const prevHostRef = React.useRef(assistantHost && assistantHost.id);
  React.useEffect(() => {
    const hostId = assistantHost && assistantHost.id;
    if (prevHostRef.current === hostId && prevUsableRef.current !== assistantUsable && activeId) {
      const others = (assistantHosts || []).filter(h => h.id !== hostId).map(h => h.name);
      const note = assistantUsable
        ? { role: "system", kind: "assistant-up", host: (assistantHost && assistantHost.name) || "The" }
        : { role: "system", kind: "assistant-down", host: (assistantHost && assistantHost.name) || "This host", others: others, message: conn.message || null };
      setConvos(prev => prev.map(c =>
        (c.id === activeId && c.messages.length > 0) ? { ...c, messages: [...c.messages, note] } : c));
    }
    prevUsableRef.current = assistantUsable;
    prevHostRef.current = hostId;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ref-based edge detector on the usable-flip; the extra values are read once at the transition, minimal deps keep the edge correct
  }, [assistantUsable, assistantHost && assistantHost.id, activeId]);

  React.useEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [active?.messages, busy]);

  React.useEffect(() => {
    pinnedRef.current = true;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [activeId]);

  const onThreadScroll = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    pinnedRef.current = distanceFromBottom <= 80;
  }, []);

  const pickAssistantHost = (id) => {
    if (!onSelectAssistantHost) return;
    const next = (assistantHosts || []).find(h => h.id === id);
    onSelectAssistantHost(id);
    if (activeId && next) {
      setConvos(prev => prev.map(c => (c.id === activeId && c.messages.length > 0)
        ? { ...c, messages: [...c.messages, { role: "scope", label: "Now talking to " + next.name + "\u2019s assistant" }] }
        : c));
    }
  };

  // A conversation lives on the node that holds it, so opening one targets that
  // node — the subject decides where we're talking. A conversation whose node
  // isn't among the assistant-capable ones is opened without retargeting; the
  // history load below then declines it rather than asking the wrong node.
  const pickChat = (id) => {
    const c = convos.find(x => x.id === id);
    const want = c && c.hostId;
    if (want && want !== (assistantHost && assistantHost.id)
        && onSelectAssistantHost && (assistantHosts || []).some(h => h.id === want)) {
      onSelectAssistantHost(want);
    }
    setActiveId(id);
  };

  const newChat = () => {
    const hostId = assistantHost && assistantHost.id;
    const id = uid();
    // Opened at once, so pressing the button is never a wait. What it is CALLED is the leaf's, and the
    // row below is replaced by the leaf's own the moment it answers — this is the one conversation the
    // leaf has no opinion on yet, and it carries the name the wire contract states for exactly that
    // window so nothing changes under the person when the answer lands.
    setConvos(prev => [{ id, title: NEW_CHAT_TITLE, messages: [], created: Date.now(), hostId }, ...prev]);
    setActiveId(id);
    setInput("");
    if (taRef.current) taRef.current.focus();

    // The id is ours to pick, but the conversation is the leaf's to create — so a chat opened here
    // exists, is named, and is resumable from another device before anything is said in it. The answer
    // carries the whole row, which REPLACES what was put up above: adopting it is what makes this
    // surface show the same conversation every other surface will read out of the listing, rather than
    // its own idea of one. A failure leaves the local row standing — the first turn creates the
    // conversation anyway, so what is lost is the early visibility, not the chat.
    if (hostId && assistantUsable && assistantAuthed) {
      assistant.host(hostId).runCommand("new", { conversationId: id }).then(
        (result) => {
          if (!result || !result.conversation) return;
          const adopted = adoptServerConversation(result.conversation, hostId);
          setConvos(prev => prev.map(c => (c.id === adopted.id ? { ...c, ...adopted } : c)));
        },
        () => {});
    }
  };
  const deleteChat = (id, e) => {
    e.stopPropagation();
    const chat = convos.find(c => c.id === id);
    const hostId = (chat && chat.hostId) || (assistantHost && assistantHost.id);
    if (hostId) assistant.host(hostId).deleteConversation(id).catch(() => {});
    setConvos(prev => {
      const next = prev.filter(c => c.id !== id);
      if (id === activeId) setActiveId(next[0]?.id || null);
      return next;
    });
  };
  // Record how the user judged one of their own answers. Applied to the bubble immediately and NOT
  // rolled back on failure: the vote is a courtesy, and yanking a thumb back out from under someone
  // mid-sentence is a worse outcome than a verdict that silently didn't reach the leaf. The next
  // history load is authoritative either way, since the leaf is what the bubble is rebuilt from.
  const rateTurn = (turnId, rating, note) => {
    if (!turnId) return;
    const chat = convos.find(c => c.id === activeId);
    const hostId = (chat && chat.hostId) || (assistantHost && assistantHost.id);
    if (!hostId) return;

    setConvos(prev => prev.map(c => c.id !== activeId ? c : {
      ...c,
      messages: c.messages.map(m => m.turnId !== turnId ? m : {
        ...m,
        feedback: rating ? { rating, note: note || null } : null,
      }),
    }));

    assistant.host(hostId).feedback(activeId, turnId, { rating, note }).catch(() => {});
  };

  const setMessages = (updater) => {
    setConvos(prev => prev.map(c => {
      if (c.id !== activeId) return c;
      const messages = typeof updater === "function" ? updater(c.messages) : updater;
      return { ...c, messages };
    }));
  };

  const sendLive = async (convId, text, userMsg) => {
    // Deliberately does NOT name the conversation from the prompt. The leaf names it — first prompt,
    // one line, capped at 80 with an ellipsis — and derives that ONCE for every surface. A copy of the
    // rule here was capped at 40 with no ellipsis, so a first prompt longer than that read one way in
    // the browser that typed it and another way everywhere else, permanently: the merge only ever
    // filled an empty title, so the leaf's real name never replaced it. The name arrives with the next
    // listing read, which the turn's own completion triggers.
    setConvos(prev => prev.map(c => (c.id !== convId ? c : {
      ...c, lastActivity: Date.now(),
      messages: [...c.messages, { ...userMsg, live: true }, { role: "assistant", content: "", live: true }],
    })));

    setBusy(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    // One answer is read aloud at a time: a new turn silences the last one rather than talking over
    // it. The player is opened before the request so the first frame has somewhere to land.
    if (spokenRef.current) spokenRef.current.stop();
    spokenRef.current = speakRef.current ? createSpokenReply() : null;

    // This POST is the turn's first attach. Its frames are the same ones every other surface receives,
    // so they are applied here directly and the event stream's copy of them is skipped — otherwise the
    // surface that asked for the turn would render it twice.
    const applyFrame = (ev) => {
      if (ev.type === "turn.attach") {
        ownTurnRef.current = ev.turnId;
        if (ev.state === "queued") {
          // Something else is still answering. This prompt waits its turn, and it waits as a chip on
          // the composer rather than as a message half-rendered into the transcript — the optimistic
          // bubbles put up a moment ago come back out until it actually starts.
          setConvos(prev => prev.map(c =>
            c.id === convId ? { ...c, messages: c.messages.filter(m => !m.live) } : c));
          return;
        }
        setLiveTurn({ conversationId: convId, turnId: ev.turnId, state: ev.state, queued: ev.queued || [] });
        setConvos(prev => prev.map(c =>
          c.id === convId ? { ...c, messages: scaffoldLiveTurn(c.messages, ev) } : c));
        return;
      }
      // Audio is played, never rendered: it belongs to no message and changes no state, so it is
      // handled here rather than in the reducer.
      if (ev.type === "audio.delta") {
        if (spokenRef.current) spokenRef.current.push(ev);
        return;
      }
      if (ev.type === "turn.queue") {
        setLiveTurn(prev => (prev && prev.turnId === ev.runningTurnId
          ? { ...prev, queued: ev.queued || [] } : prev));
        return;
      }
      setConvos(prev => prev.map(c =>
        c.id === convId ? { ...c, messages: reduceTurnFrame(c.messages, ev) } : c));
    };

    try {
      const prompt = text || "[The user sent a voice note; transcription was unavailable.]";
      // If a blueprint draft is open, carry its CURRENT content so the assistant can revise it from chat.
      const openCmdId = activeDraftRef.current;
      const draftYaml = openCmdId ? draftEditsRef.current[openCmdId] : undefined;
      // Thinking and auto-run are NOT sent: they are the conversation's, held by the leaf and read
      // when the turn runs. Sending them would let this browser contradict what the conversation
      // carries — and two surfaces on one conversation would then disagree about what it is set to.
      await assistant.host(assistantHost.id).turn(
        { prompt, conversationId: convId, draftYaml, speak: speakRef.current || undefined },
        { onEvent: applyFrame, signal: ctrl.signal });
    } catch (e) {
      const aborted = e && e.name === "AbortError";
      // Came back to the foreground and dropped a connection we could not have kept. Nothing is
      // written into the transcript — this surface does not know what the turn did, and the leaf's
      // own record is about to say. Marking it stale is what asks for that re-read.
      if (aborted && resumedRef.current) {
        resumedRef.current = false;
        setConvos(prev => prev.map(c => c.id !== convId ? c : { ...c, stale: true }));
        return;
      }
      const reason = e && e.code === 503 ? assistantHost.name + "\u2019s assistant is currently unavailable."
        : e && e.code === 502 ? "Couldn\u2019t reach " + assistantHost.name + "\u2019s assistant \u2014 try again, or check the host."
        : e && e.code === 404 ? assistantHost.name + " isn\u2019t serving an assistant right now."
        : (e && e.userMessage) || (assistantHost.name + "\u2019s assistant didn\u2019t respond.");
      setConvos(prev => prev.map(c => {
        if (c.id !== convId) return c;
        const msgs = c.messages.slice();
        const lastIdx = msgs.length - 1;
        const bubble = msgs[lastIdx];
        if (!bubble || bubble.role !== "assistant") return c;
        const finalized = aborted
          ? { ...bubble, content: bubble.content || "_Stopped._" }
          : bubble.content
            ? { ...bubble, content: bubble.content + "\n\n_\u26a0 Interrupted \u2014 the assistant connection dropped._" }
            : { ...bubble, content: "\u26a0\ufe0f " + reason, error: true };
        // The stream ended without a done frame — still surface any gathered evidence.
        msgs[lastIdx] = promotePendingCards(finalized);
        return { ...c, messages: msgs };
      }));
    } finally {
      setBusy(false);
      resumedRef.current = false;
      abortRef.current = null;
      // The queue outlives the request by design — the last sentences arrive with the terminal frame —
      // so this releases the player rather than stopping it. Stopping is what `stop` and the next turn
      // do, because those are the moments somebody decided not to listen.
      spokenRef.current = null;
      // Stop skipping the event stream's copy: from here the stream is this surface's only source, and
      // the next attach on this conversation is what re-establishes it.
      ownTurnRef.current = null;
      setConvos(prev => prev.map(c => c.id !== convId ? c : {
        ...c, messages: c.messages.map(m => (m.live ? { ...m, live: false } : m)),
      }));
      setLiveTurn(prev => (prev && prev.conversationId === convId ? null : prev));
    }
  };

  const send = async (override, voiceMeta) => {
    const text = (typeof override === "string" ? override : input).trim();
    if (!text && !voiceMeta) return;

    let convId = activeId;
    if (!convId) {
      convId = uid();
      const c = { id: convId, title: NEW_CHAT_TITLE, messages: [], created: Date.now(), hostId: assistantHost && assistantHost.id };
      setConvos(prev => [c, ...prev]);
      setActiveId(convId);
    }

    // A recognised command runs and never reaches the model. Anything else that merely STARTS with a
    // slash — a path, a fraction, a typo — is an ordinary message, so nothing a person types is
    // silently swallowed. `resolveCommand` is the strict half of the surface: only an exact name
    // with an argument the command offers counts.
    const command = voiceMeta ? null : resolveCommand(text, commandCatalog);
    if (command) {
      setInput("");
      setCommandMenu({ items: [], active: 0 });
      if (taRef.current) taRef.current.style.height = "auto";
      runCommand(command.command.name, command.argument, convId);
      return;
    }

    const userMsg = voiceMeta
      ? { role: "user", content: text, voice: voiceMeta, ts: Date.now() }
      : { role: "user", content: text, ts: Date.now() };
    setInput("");
    if (taRef.current) taRef.current.style.height = "auto";

    if (!assistantHost || !assistantUsable) {
      const why = !assistantHost
        ? "No assistant is available right now."
        : conn.message || (conn.label || "This assistant is currently unavailable.");
      // Unnamed on purpose: the turn never reached the leaf, so there is no recorded first prompt for
      // it to be named after, and a name invented here would be one no other surface could arrive at.
      setConvos(prev => prev.map(c => (c.id !== convId ? c : {
        ...c, lastActivity: Date.now(),
        messages: [...c.messages, userMsg, { role: "assistant", content: "\u26a0\ufe0f " + why, error: true }],
      })));
      return;
    }

    if (needsAssistantSignIn) {
      // Unnamed on purpose: the turn never reached the leaf, so there is no recorded first prompt for
      // it to be named after, and a name invented here would be one no other surface could arrive at.
      setConvos(prev => prev.map(c => {
        if (c.id !== convId) return c;
        const why = leafStatus === "denied"
          ? "You don\u2019t have access to " + assistantHost.name + "\u2019s assistant."
          : "Sign in to " + assistantHost.name + "\u2019s assistant to talk to it.";
        return {
          ...c, lastActivity: Date.now(),
          messages: [...c.messages, userMsg, { role: "assistant", content: "\u26a0\ufe0f " + why, error: true }],
        };
      }));
      return;
    }

    sendLive(convId, text, userMsg);
  };

  // Stop the conversation's turn, whoever started it. A call rather than an abort, because a surface
  // that is only watching holds no connection to end — and ending it must end it for everyone, which a
  // local abort could never do. Aborting our own POST as well just detaches this surface early.
  // ⚠ Turning it ON is the user gesture a browser needs before it will play anything, so the audio
  // context is created and resumed HERE. Armed on the frame instead it would be created seconds later
  // with no gesture behind it, and stay suspended — silence, with nothing to say why.
  const toggleSpeak = async () => {
    if (speak) {
      if (spokenRef.current) spokenRef.current.stop();
      setSpeak(false);
      return;
    }
    const ready = await armAudio();
    setSpeak(ready);
    // Refused: the control says so itself rather than raising a toast. A toast is for a shell handler
    // that owns no control to render into, and this button is right here.
    setSpeakBlocked(!ready);
  };

  const stop = () => {
    // The sound stops with the turn. A stop that left the queued sentences playing would go on reading
    // out an answer the person just asked it to abandon.
    if (spokenRef.current) spokenRef.current.stop();
    const hostId = assistantHost && assistantHost.id;
    const turnId = liveTurn && liveTurn.conversationId === activeId ? liveTurn.turnId : null;
    if (hostId && turnId) assistant.host(hostId).stopTurn(turnId).catch(() => {});
    else if (abortRef.current) abortRef.current.abort();
  };

  // Discard a turn waiting behind the running one. Stopping the running turn deliberately leaves these
  // standing, so throwing one away is its own act.
  const cancelQueued = (turnId) => {
    const hostId = assistantHost && assistantHost.id;
    if (hostId && turnId) assistant.host(hostId).stopTurn(turnId).catch(() => {});
  };

  // A turn is the CONVERSATION's, so the composer is busy while one runs on the open conversation
  // whether or not this surface is the one that asked for it.
  const turnRunning = busy || !!(liveTurn && liveTurn.conversationId === activeId);
  const queuedHere = (liveTurn && liveTurn.conversationId === activeId && liveTurn.queued) || [];

  // Run one command at the leaf and render what it answered. The leaf performs every command it
  // lists, so there is no client-side branch on WHAT a command does — only on what its result
  // carries. A failure is shown in the transcript rather than swallowed: the person typed something
  // deliberate and is owed an answer either way.
  const runCommand = React.useCallback(async (name, argument, convId) => {
    const hostId = assistantHost && assistantHost.id;
    if (!hostId || !convId) return;

    const say = (msg) => setConvos(prev => prev.map(c =>
      c.id !== convId ? c : { ...c, messages: [...c.messages, msg] }));

    let result;
    try {
      result = await assistant.host(hostId).runCommand(name, { conversationId: convId, argument });
    } catch (err) {
      say({
        role: "assistant",
        error: true,
        content: "⚠️ " + ((err && err.userMessage) || "That command didn’t run — try again."),
      });
      return;
    }

    // A switch answers the state it now stands at — which is what lands, not what was asked for.
    if (typeof result.state === "boolean" && (name === "think" || name === "autorun")) {
      applySwitch(convId, name === "think" ? "thinking" : "actions", result.state);
      return;
    }

    if (result.commands) { say({ role: "commandHelp", commands: result.commands, label: result.message }); return; }
    if (result.tools)    { say({ role: "commandTools", tools: result.tools, label: result.message }); return; }

    // A command that moved the conversation says so by naming the one that now stands — `/new` is the
    // live case. The leaf decides which conversation that is (it takes up an offered id only while it
    // holds nothing), so the surface follows it there rather than reporting into the chat left behind.
    if (typeof result.conversationId === "string" && result.conversationId && result.conversationId !== convId) {
      // Named by the leaf, which answers with the whole row. A title composed here would be this
      // surface's word for a conversation every other surface reads a name for.
      const started = result.conversation
        ? adoptServerConversation(result.conversation, hostId)
        : { id: result.conversationId, title: NEW_CHAT_TITLE, messages: [], created: Date.now(), hostId };
      setConvos(prev => [started, ...prev.filter(c => c.id !== started.id)]);
      setActiveId(started.id);
      setInput("");
      if (taRef.current) taRef.current.focus();
      return;
    }

    say({ role: "checkpoint", label: result.message });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only assistantHost.id is used (and in deps); the object is re-derived each render
  }, [assistantHost && assistantHost.id, applySwitch]);

  // The composer's two buttons are the same commands the popover offers, so a click and a typed
  // `/think on` travel one path and cannot disagree about what the conversation is set to.
  const toggleThinking = () => runCommand("think", thinkOn ? "off" : "on", activeId);
  const toggleActions  = () => runCommand("autorun", actionsOn ? "off" : "on", activeId);

  const compactActive = React.useCallback(async () => {
    if (!assistantHost || !activeId) return { compacted: false };
    const convId = activeId;
    const res = await assistant.host(assistantHost.id).compact(convId);
    const compacted = !!(res && res.compacted);
    const n = res && typeof res.messagesCompacted === "number" ? res.messagesCompacted : 0;
    if (compacted) {
      const label = "Conversation compacted to save context"
        + (n ? " \u00b7 " + n + " message" + (n === 1 ? "" : "s") : "");
      setConvos(prev => prev.map(c => c.id === convId
        ? { ...c, messages: [...c.messages, { role: "checkpoint", label }] }
        : c));
    }
    return { compacted, messagesCompacted: n };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only assistantHost.id is used (and in deps); the object is re-derived each render
  }, [assistantHost && assistantHost.id, activeId]);

  // The host reads voice notes whenever it can — the same engine, primed with the same server names,
  // that hears a request spoken into a Discord channel. Passing no transcriber is what leaves the
  // browser's own recogniser in charge, and that is only the case on a host without the speech leaf.
  //
  // Held in a ref-stable callback per host so the recorder is not rebuilt on every render.
  const transcribeHere = React.useMemo(() => {
    if (!hostSpeech || !hostSpeech.hear || !assistantHost) return undefined;
    const hostId = assistantHost.id;
    return async (pcm) => {
      const answer = await assistant.host(hostId).transcribe(pcm);
      return (answer && answer.text) || "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only assistantHost.id is used (and in deps); the object is re-derived each render
  }, [hostSpeech && hostSpeech.hear, assistantHost && assistantHost.id]);

  const voice = useVoiceRecorder({ transcribe: transcribeHere });
  const sendVoice = async () => {
    const payload = await voice.finish();
    // Null is a cancelled recording or one whose transcription failed. The failure leaves the bar
    // standing with its reason and the audio still held, so there is nothing to send and nothing to
    // report here — the composer is already saying it.
    if (!payload) return;
    const { id, duration, peaks, transcript } = payload;
    send(transcript || "", { id, duration, peaks });
  };

  const startBriefingChat = (item) => {
    setInput(item.prompt);
    setTimeout(() => {
      const ta = taRef.current;
      if (ta) { ta.focus(); ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 200) + "px"; }
    }, 0);
  };

  React.useEffect(() => {
    if (!seed || !seed.prompt) return;
    startBriefingChat({ prompt: seed.prompt });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once per seed via seed.nonce; seed.prompt is read fresh at that edge
  }, [seed && seed.nonce]);

  // Confirm a staged command by handing its token back to the leaf that staged it. The leaf
  // performs every kind itself — start/stop/restart/update/backup, install/uninstall, the config
  // write, the ports open, the file write — watches the ones with a run-state postcondition until
  // they reach it, and answers a verdict. There is no second execution path: the panel does not
  // re-run the action through kgsm-api, so one staged action has one way to happen, one authority
  // gate, and one outcome shape.
  const runLiveCommand = (card) => {
    if (!LEAF_COMMAND_VERBS.has(card.verb)) return;
    const isInstall = card.verb === "install";
    // Install targets a blueprint (subject.id is the blueprint, not an existing instance); the rest
    // target an existing server. The name is for the copy only — the leaf resolves the target from
    // the token it staged, never from anything sent back here.
    const found = isInstall ? null : (servers.find(s => s.id === card.subjectId) || null);
    const hostId = (assistantHost && assistantHost.id) || null;
    const serverName = isInstall
      ? (card.instanceName || card.subjectId)
      : (found && found.name) || card.subjectId;
    const meta = commandMeta(card.verb);
    const verifyId = uid();
    setMessages(msgs => {
      const marked = msgs.map(m =>
        (m.role === "command" && m.cmdId === card.cmdId && m.state === "proposed")
          ? { ...m, state: "confirmed" } : m);
      return [...marked, { role: "verify", id: verifyId, action: { label: meta.label, verb: card.verb, serverName }, state: "pending" }];
    });
    const resolveVerify = (result) =>
      setMessages(msgs => msgs.map(m => (m.role === "verify" && m.id === verifyId) ? { ...m, state: "done", result, progress: null } : m));
    // The leaf's progress steps drive a live sub-label under the spinner (a lifecycle command
    // narrates its settling wait, an install its download), so a slow action reads as advancing.
    const onProgress = (evt) =>
      setMessages(msgs => msgs.map(m =>
        (m.role === "verify" && m.id === verifyId) ? { ...m, progress: (evt && evt.label) || null } : m));

    // The token is what authorizes and addresses the action; without it there is nothing to confirm.
    if (!hostId || !card.token) {
      resolveVerify({ ok: false, headline: "This action has expired \u2014 ask the assistant to propose it again.", lines: [] });
      return;
    }
    assistant.host(hostId).confirm({ token: card.token }, { onProgress }).then(
      resp => resolveVerify(composeVerified(card.verb, serverName, resp)),
      err => {
        const expired = err && err.code === 401;
        const noRoute = err && err.code === "ENOROUTE";
        resolveVerify(expired
          ? { ok: false, headline: ((assistantHost && assistantHost.name) || "This host") + "\u2019s assistant session expired \u2014 sign in again to run commands.", lines: [] }
          : noRoute
            ? { ok: false, headline: ((assistantHost && assistantHost.name) || "This host") + "\u2019s assistant has no address this browser can reach.", lines: [] }
            : { ok: false, headline: "Couldn\u2019t run " + meta.label.toLowerCase() + " \u2014 " + ((err && err.userMessage) || "the command failed."), lines: [] });
      });
  };

  // ---- blueprint-review checkpoint ----
  // Patch bpState (+ any outcome fields) onto the one blueprint command message being reviewed.
  const patchBlueprintMsg = (cmdId, patch) =>
    setMessages(msgs => msgs.map(m =>
      (m.role === "command" && m.verb === "blueprint" && m.cmdId === cmdId) ? { ...m, ...patch } : m));

  // Save = finalize: send the (possibly edited) YAML to the assistant, which re-validates,
  // test-installs, boots + verifies, and runs its repair loop before answering (minutes). The
  // card sits in a "verifying" state meanwhile. On a verified win it flips to the catalog outcome;
  // on repair exhaustion / an invalid edit it comes back editable with a fresh token + boot log
  // (the re-edit loop); anything else is an honest failure. Never fabricates success from the 202.
  const onSaveBlueprint = (msg, editedYaml) => {
    const hostId = (assistantHost && assistantHost.id) || null;
    if (!hostId || !msg.token) {
      patchBlueprintMsg(msg.cmdId, { bpState: "failed", bpReason: "This draft has expired — ask the assistant to draft it again." });
      return;
    }
    patchBlueprintMsg(msg.cmdId, { bpState: "verifying", bpProgress: null });
    // The finalize streams its own steps (research/install/verify/repair) — surface the latest as a live
    // sub-label under the "verifying" spinner so the user sees it advancing, not a dead wait. Cleared on
    // every terminal branch below.
    const onProgress = (evt) => patchBlueprintMsg(msg.cmdId, { bpProgress: evt && evt.label ? evt.label : null });
    assistant.host(hostId).confirm({ token: msg.token, editedContent: editedYaml }, { onProgress }).then(
      resp => {
        const r = adaptBlueprintConfirm(resp);
        if (r.state === "verified") {
          patchBlueprintMsg(msg.cmdId, { bpState: "verified", bpSlug: r.slug, bpDisplayName: r.displayName, bpProof: r.proof, bpProgress: null });
        } else if (r.state === "proposed") {
          // Re-edit loop: adopt the returned draft + fresh token + boot evidence, back to editable.
          patchBlueprintMsg(msg.cmdId, { bpState: "proposed", token: r.token, draftYaml: r.draftYaml, evidence: r.evidence, bpDisplayName: r.displayName, bpProgress: null });
        } else {
          patchBlueprintMsg(msg.cmdId, { bpState: "failed", bpDisplayName: r.displayName, bpReason: r.reason, bpProgress: null });
        }
      },
      err => {
        const expired = err && err.code === 401;
        patchBlueprintMsg(msg.cmdId, {
          bpState: "failed",
          bpProgress: null,
          bpReason: expired
            ? ((assistantHost && assistantHost.name) || "This host") + "’s session expired — re-authorize this host to continue."
            : (err && err.userMessage) || "The test-install couldn’t run — try saving again.",
        });
      });
  };

  // Abandon is the only terminal Failed a user can reach directly — always offered so a draft can't
  // get stuck in an un-closable loop. Client-side only: the token simply expires unused server-side.
  const onGiveUpBlueprint = (msg) =>
    patchBlueprintMsg(msg.cmdId, { bpState: "failed", bpReason: "You dismissed this draft — nothing was added." });

  // The completion list, derived from the text on every keystroke rather than held open as a mode —
  // so a backspace walks back out of it and Escape needs nothing to reset. `dismissed` is the one
  // piece of state, because Escape has to survive the next keystroke or the list springs back.
  const [commandMenu, setCommandMenu] = React.useState({ items: [], active: 0 });
  const [menuDismissed, setMenuDismissed] = React.useState(false);
  const composerRef = React.useRef(null);

  const refreshMenu = React.useCallback((text, dismissed) => {
    const items = dismissed ? [] : suggestFor(text, commandCatalog);
    setCommandMenu(prev => ({
      items,
      // Hold the highlight where it was while the list only narrows, so typing another letter does
      // not silently move which command Enter would run.
      active: Math.min(prev.active, Math.max(0, items.length - 1)),
    }));
  }, [commandCatalog]);

  // Put a completion into the composer. A command that still wants a value lands with a trailing
  // space and re-opens on its values; one that is ready to run just sits there for Enter.
  const applyCompletion = (item) => {
    setInput(item.insert);
    setMenuDismissed(false);
    refreshMenu(item.insert, false);
    if (taRef.current) taRef.current.focus();
  };

  const onKeyDown = (e) => {
    const items = commandMenu.items;
    if (items.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const delta = e.key === "ArrowDown" ? 1 : -1;
        setCommandMenu(prev => ({
          ...prev,
          active: (prev.active + delta + prev.items.length) % prev.items.length,
        }));
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMenuDismissed(true);
        setCommandMenu({ items: [], active: 0 });
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        applyCompletion(items[commandMenu.active] || items[0]);
        return;
      }
      // Enter takes the highlighted row. A row that fully specifies a command (`/think on`) RUNS —
      // there is nothing left to decide, and making someone press Enter twice to confirm a choice
      // already under the cursor is friction with no question behind it. A row that still owes a
      // value (`/think`) completes instead, opening its values. Either way Enter never runs a
      // command while ignoring what is highlighted, which is the bug this shape exists to avoid.
      if (e.key === "Enter" && !e.shiftKey) {
        const picked = items[commandMenu.active] || items[0];
        if (picked && picked.insert !== input) {
          e.preventDefault();
          if (picked.runnable) send(picked.insert);
          else applyCompletion(picked);
          return;
        }
      }
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const onInputChange = (e) => {
    const value = e.target.value;
    setInput(value);
    // A composer emptied back out re-arms the list, so dismissing one slash does not mute the next.
    const stillDismissed = menuDismissed && value.startsWith("/");
    if (menuDismissed !== stillDismissed) setMenuDismissed(stillDismissed);
    refreshMenu(value, stillDismissed);

    const ta = e.target;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
  };

  const suggestions = React.useMemo(() => {
    const running = serverList.find(s => s.status === "running");
    const srv = running || serverList[0] || null;
    if (!srv) {
      return [
        "Run a health check on my server",
        "Why might my server be lagging?",
        "Explain a setting in my server's config file",
        "Server is online but I can't connect \u2014 why?",
      ];
    }
    const name = srv.displayName || srv.name || "MyServer";
    const game = srv.game || "my game";
    return [
      `Run a health check on ${name}`,
      `Why might my ${game} server be lagging?`,
      "Explain a setting in my server's config file",
      `Server is online but I can't connect \u2014 why?`,
    ];
  }, [serverList]);

  // A fresh greeting per conversation — drawn once and held, so a re-render (typing,
  // a store tick) never swaps the wording out from under the reader.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- activeId is the POINT: it re-rolls the greeting per conversation, not a value read inside.
  const greeting = React.useMemo(() => pickGreeting(), [activeId]);

  // What the assistant can do for you, phrased to match what THIS caller may actually
  // ask of it: a viewer can't have it act, so promising start/stop would be a promise
  // the composer's own gating then breaks.
  const primer = canSeeActions
    ? "I can check server health, dig through logs and configuration, start or stop a server, and help work out what’s going wrong."
    : "I can check server health, read through logs and configuration, and help work out what’s going wrong.";

  const ChatBriefingPanel = BriefingPanel;

  const [railOpen, setRailOpen] = React.useState(false);
  const railWrapRef = React.useRef(null);
  React.useEffect(() => {
    if (!railOpen) return;
    const h = (e) => { if (railWrapRef.current && !railWrapRef.current.contains(e.target)) setRailOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [railOpen]);
  React.useEffect(() => { setRailOpen(false); }, [activeId]);

  // Review mode replaces the whole surface: no rail (there is no "your chats" here), no composer
  // (there is no admin write, and a disabled input would still invite typing), and a banner that
  // cannot be scrolled away — a dock that is usually YOUR chat now holds someone else's, and that has
  // to be unmissable for as long as it is true.
  if (review && review.conversation) {
    const who = review.conversation.user
      ? (review.conversation.user.displayName || review.conversation.user.userId)
      : null;
    return (
      <div className={"chat-page chat-page--review" + (docked ? " chat-page--docked" : "") + (pageClass ? " " + pageClass : "")}>
        <div className="chat-main">
          <div className="chat-review__banner">
            <Icon name="lock" size={13} />
            <span>
              Reading{who ? <> <b>{who}</b>’s</> : " someone else’s"} conversation — read-only.
            </span>
            <button className="chat-review__exit" onClick={onExitReview}>
              Back to your chat
            </button>
          </div>

          <div className="chat-main__head">
            <div className="chat-id">
              <span className="chat-id__mark"><Icon name="message-square" size={17} /></span>
              <div className="chat-id__text">
                <span className="chat-id__title">{conversationTitle(review.conversation)}</span>
                <span className="chat-id__sub">
                  {review.conversation.turnCount} turn{review.conversation.turnCount === 1 ? "" : "s"}
                  {review.conversation.deleted ? " · deleted by its owner" : ""}
                </span>
              </div>
            </div>
            <div className="chat-head__actions">
              <div className="chat-head__win">
                <button className="chat-headbtn" onClick={onExitReview} title="Close review" aria-label="Close review">
                  <Icon name="x" size={16} />
                </button>
              </div>
            </div>
          </div>

          <div className="chat-scroll">
            {reviewState === "loading" && <div className="chat-empty"><p>Loading the transcript…</p></div>}
            {reviewState === "error" && (
              <div className="chat-empty">
                <h2>Transcript unavailable</h2>
                <p>This conversation could not be read. It may have been removed from the log.</p>
              </div>
            )}
            {reviewState === "ready" && reviewMessages && reviewMessages.length === 0 && (
              <div className="chat-empty"><p>This conversation has no turns.</p></div>
            )}
            {reviewState === "ready" && reviewMessages && reviewMessages.length > 0 && (
              // Read-only: no onRun/onSaveBlueprint/onDraftEdit, so every actionable affordance a live
              // chat would offer is simply absent rather than present-and-inert.
              // readOnlyFeedback shows what the OWNER said about an answer without offering the reader
              // a way to say anything: a reviewer's opinion of someone else's conversation is a
              // different fact from that person's satisfaction, and this surface collects only the latter.
              <ChatThread messages={reviewMessages} user={user} nodes={nodes}
                onOpenServer={onOpenServer} onOpenView={onOpenView} readOnlyFeedback />
            )}
          </div>

          <div className="chat-review__foot">
            You are reading a saved conversation. Replying, running actions and editing are not possible here.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={"chat-page" + (docked ? " chat-page--docked" : "") + (pageClass ? " " + pageClass : "")}>
      <aside className="chat-rail">
        <button className="chat-rail__new" onClick={newChat}>
          <Icon name="plus" size={15} strokeWidth={2.2} /> New chat
        </button>
        <div className="chat-rail__list">
          {convos.length === 0 && <div className="chat-rail__empty">No conversations yet.</div>}
          {convos.map(c => (
            <div key={c.id}
              className={"chat-rail__item" + (c.id === activeId ? " chat-rail__item--active" : "")}
              onClick={() => pickChat(c.id)}>
              <Icon name="message-square" size={14} />
              <span className="chat-rail__title">{conversationTitle(c)}</span>
              <button className="chat-rail__del" onClick={(e) => deleteChat(c.id, e)} title="Delete">
                <Icon name="trash-2" size={13} />
              </button>
            </div>
          ))}
        </div>
        {/* Only when it has something to say. A leaf that is reachable and healthy is the state
            the whole page already demonstrates, so a permanent "Connected" is decoration; a
            degraded, unavailable or unchosen one names itself and the node it means. */}
        {conn.tone !== "online" && (
          <div className="chat-rail__foot">
            <span className={"chat-conn chat-conn--" + conn.tone}><span className="dot"></span>{conn.label}</span>
          </div>
        )}
        {/* Foot of the rail, under the conversations — the settings page is about this surface
            rather than about any one chat, so it sits below the list rather than in it. At phone
            width the rail is display:none and the same route is the header's cog. */}
        {onOpenSettings && (
          <button type="button" className="chat-rail__settings" onClick={onOpenSettings}>
            <Icon name="settings" size={15} className="chat-rail__settings-icon" />
            <span>Settings</span>
          </button>
        )}
      </aside>

      <div className="chat-main">
        <div className="chat-main__head">
          <div className="chat-id">
            <span className="chat-id__mark"><Icon name="bot" size={17} /></span>
            <div className="chat-id__text">
              <span className="chat-id__title">Assistant</span>
              {HostPicker && <HostPicker hosts={assistantHosts} current={assistantHost} onSelect={pickAssistantHost} />}
            </div>
          </div>
          <div className="chat-head__actions">
            <div className="chat-head__nav">
              <button className="chat-headbtn" onClick={newChat} title="New chat" aria-label="New chat">
                <Icon name="square-pen" size={16} />
              </button>
              <ChatHistory convos={convos} activeId={activeId} onPick={pickChat} onDelete={deleteChat} onOpen={loadServerHistory} loading={histLoading} />
              {/* This nav strip is the phone-width replacement for the rail (CSS decides, at the
                  breakpoint that hides it), so the rail's foot travels here with it. */}
              {onOpenSettings && (
                <button className="chat-headbtn" onClick={onOpenSettings} title="Settings" aria-label="Settings">
                  <Icon name="settings" size={16} />
                </button>
              )}
            </div>
            {docked && (
              <div className="chat-head__win">
                {showPin && (
                  <button
                    className={"chat-headbtn" + (pinned ? " chat-headbtn--pinned" : "")}
                    onClick={onTogglePin}
                    disabled={pinDisabled}
                    title={pinDisabled ? "Not enough room to pin \u2014 floating over the page" : pinned ? "Unpin \u2014 float over the page" : "Pin \u2014 push the page aside"}
                    aria-label="Toggle dock pin" aria-pressed={!!pinned}>
                    <Icon name={pinned ? "pin" : "pin-off"} size={16} />
                  </button>
                )}
                {onExpand && (
                  <button className="chat-headbtn" onClick={onExpand} title="Expand to full screen" aria-label="Expand to full screen">
                    <Icon name="maximize-2" size={16} />
                  </button>
                )}
                <button className="chat-headbtn" onClick={onClose} title="Close assistant" aria-label="Close assistant">
                  <Icon name="panel-right-close" size={16} />
                </button>
              </div>
            )}
            {!docked && onClose && (
              <div className="chat-head__win">
                <button className="chat-headbtn" onClick={onClose} title="Exit full screen (ESC)" aria-label="Exit full screen (ESC)">
                  <Icon name="minimize-2" size={16} />
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="chat-scroll" ref={scrollRef} onScroll={onThreadScroll}>
          {(!active || active.messages.length === 0) ? (
            <div className="chat-empty">
              <span className="chat-empty__logo"><Icon name="bot" size={26} /></span>
              <h2>{assistantHost ? greeting : "No assistant available"}</h2>
              <p>{assistantHost ? primer : "No connected host is serving an assistant capability."}</p>
              {/* On the fresh-conversation screen only — it opens every new chat, and the
                  composer's own footprint stays exactly as it is without a pinned line. */}
              {assistantHost && <p className="chat-empty__notice">{CHAT_PRIVACY_NOTICE}</p>}
              {ChatBriefingPanel && <ChatBriefingPanel onPick={startBriefingChat} />}
              <RecentConversations convos={convos} activeId={activeId} onPick={pickChat} />
              <div className="chat-suggestions">
                {suggestions.map((s, i) => (
                  <button key={i} className="chat-suggestion" onClick={() => { setInput(s); if (taRef.current) taRef.current.focus(); }}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <ChatThread messages={active.messages} user={user} nodes={nodes}
              onOpenServer={onOpenServer} onOpenView={onOpenView} onRun={runLiveCommand}
              onSaveBlueprint={onSaveBlueprint} onGiveUpBlueprint={onGiveUpBlueprint}
              onDraftEdit={onDraftEdit} onDraftActive={onDraftActive} onRate={rateTurn} />
          )}
        </div>

        {needsAssistantSignIn && (
          <div className="chat-signin">
            <Icon name="bot" size={14} />
            <span>
              {leafStatus === "denied"
                ? "You don\u2019t have access to " + assistantHost.name + "\u2019s assistant."
                : consentNeeded
                  ? assistantHost.name + "\u2019s assistant needs your permission once."
                  : "Couldn\u2019t sign in to " + assistantHost.name + "\u2019s assistant."}
            </span>
            {leafStatus !== "denied" && (
              <button type="button" className="chat-signin__go"
                onClick={() => assistantSession.signIn(assistantHost.id, { prompt: "consent" })}>
                Continue with Discord
              </button>
            )}
          </div>
        )}

        <div className="chat-composer">
          {voice.phase === "idle" ? (
            <div className="chat-composer__box" ref={composerRef}>
              {/* Name the node only where there is a choice of them. HostPicker is the surface
                  saying it addresses a cluster, so on the panel this reads "Message hotrod's
                  assistant\u2026" and stays useful; a surface with one leaf has no node to
                  disambiguate and would just be restating its own name back at itself. */}
              <textarea
                ref={taRef}
                rows={1}
                value={input}
                placeholder={HostPicker && assistantHost
                  ? "Message " + assistantHost.name + "\u2019s assistant\u2026"
                  : "Message the assistant\u2026"}
                onChange={onInputChange}
                onKeyDown={onKeyDown} />
              <ChatCommandMenu
                items={commandMenu.items}
                active={commandMenu.active}
                anchorRef={composerRef}
                onPick={applyCompletion} />
              <div className="chat-composer__bar">
                <ChatContextMeter
                  usage={latestUsage(active && active.messages)}
                  onCompact={(assistantUsable && active && active.messages.length > 0) ? compactActive : null} />
                {assistantHost && (
                  <button
                    type="button"
                    className={"chat-act-toggle chat-think-toggle" + (thinkOn ? " chat-think-toggle--on" : "")}
                    onClick={toggleThinking}
                    title={thinkOn
                      ? "Thinking ON \u2014 the assistant reasons step by step before answering (shown collapsed in the reply). Click to turn off."
                      : "Thinking OFF \u2014 the assistant answers directly. Turn on to have it reason first."}
                    aria-pressed={thinkOn}>
                    <Icon name="brain" size={13} />
                    <span className="chat-act-toggle__label">Thinking</span>
                    <span className="chat-act-toggle__state">{thinkOn ? "On" : "Off"}</span>
                  </button>
                )}
                {assistantHost && (
                  <button
                    type="button"
                    className={"chat-act-toggle chat-speak-toggle" + (speak ? " chat-speak-toggle--on" : "")}
                    onClick={toggleSpeak}
                    title={speakBlocked
                      ? "This browser will not play audio on this page."
                      : speak
                        ? "Reading answers aloud \u2014 each sentence is spoken as it is written, so it starts before the answer is finished. Click to stop."
                        : "Answers are silent. Turn on to have them read aloud as they are written."}
                    aria-pressed={speak}>
                    <Icon name={speakBlocked ? "volume-x" : speak ? "volume-2" : "volume-off"} size={13} />
                    <span className="chat-act-toggle__label">Read aloud</span>
                    <span className="chat-act-toggle__state">
                      {speakBlocked ? "Unavailable" : speak ? "On" : "Off"}
                    </span>
                  </button>
                )}
                {canSeeActions && (
                  <button
                    type="button"
                    className={"chat-act-toggle" + (autoAcceptActive ? " chat-act-toggle--on" : "")}
                    onClick={canUseActions ? toggleActions : undefined}
                    disabled={!canUseActions}
                    title={!canUseActions
                      ? "Auto-run is admin-only. As an operator you can still have the assistant propose actions and confirm them yourself."
                      : autoAcceptActive
                        ? "Auto-run ON \u2014 the assistant carries out start/stop/restart actions immediately, no confirmation. Click to turn off."
                        : "Auto-run OFF \u2014 the assistant proposes actions for you to confirm. Turn on to let it run them automatically."}
                    aria-pressed={autoAcceptActive}>
                    <Icon name={autoAcceptActive ? "zap" : "zap-off"} size={13} />
                    <span className="chat-act-toggle__label">Auto-run</span>
                    <span className="chat-act-toggle__state">{autoAcceptActive ? "On" : "Off"}</span>
                  </button>
                )}
                {queuedHere.length > 0 && (
                  <span className="chat-queued" title="Waiting for the current answer to finish">
                    <Icon name="clock" size={12} />
                    {queuedHere.map(q => (
                      <button
                        key={q.turnId}
                        type="button"
                        className="chat-queued__item"
                        onClick={() => cancelQueued(q.turnId)}
                        title={"Queued: " + q.prompt + "\n\nClick to discard it."}>
                        <span className="chat-queued__text">{q.prompt}</span>
                        <Icon name="x" size={11} />
                      </button>
                    ))}
                  </span>
                )}
                <span className="chat-composer__bar-spacer"></span>
                {!busy && !input.trim() && assistantUsable && (
                  <button className="chat-mic" onClick={voice.start} title="Record a voice note" aria-label="Record a voice note">
                    <Icon name="mic" size={17} />
                  </button>
                )}
                {turnRunning
                  ? <button className="chat-send chat-send--stop" onClick={stop} title="Stop"><Icon name="square" size={15} /></button>
                  : <button className="chat-send" onClick={send} disabled={!input.trim() || !assistantUsable} title={assistantUsable ? "Send" : "Assistant unavailable"}><Icon name="arrow-up" size={16} strokeWidth={2.4} /></button>}
              </div>
              {!assistantUsable && (
                <div className="chat-composer__downhint">
                  <span className="status-led status-led--down"></span>
                  {assistantHost
                    ? assistantHost.name + "\u2019s assistant is unavailable \u2014 your message will send once it\u2019s back."
                    : assistantHosts.length
                      ? "Pick which node\u2019s assistant to talk to \u2014 several can answer."
                      : "Assistant unavailable \u2014 your message will send once it\u2019s back."}
                </div>
              )}
            </div>
          ) : (
            <VoiceComposerBar rec={voice} onSend={sendVoice} onCancel={voice.cancel} />
          )}
          <div className="chat-composer__hint">
            {voice.phase === "recording" || voice.phase === "requesting"
              ? <span>Recording a voice note · I'll transcribe it and reply</span>
              // The one place the command surface is advertised to somebody who has never typed a
              // slash into a chat box. Shown only when this leaf actually offers commands, so it
              // never points at something that would not open.
              : <>Enter to send, Shift+Enter for newline{commandCatalog.length > 0 && <> · <code>/</code> for commands</>}</>}
          </div>
        </div>
      </div>
    </div>
  );
}

export { adaptResultCard, LEAF_COMMAND_VERBS, ChatCommand, ChatPage, composeVerified, latestUsage, mergeServerConversations, reduceTurnFrame, scaffoldHistory };
// Default export so React.lazy(() => import("./ChatPage.jsx")) resolves (AppRouter's
// chat route + App.jsx's dock both lazy-load this).
export default ChatPage;
