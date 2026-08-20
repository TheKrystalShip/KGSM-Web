import React from "react";
import { assistantSession } from "../lib/assistantSession.js";
import { assistantHosts, assistantHostsAll, capUsable } from "../lib/capabilities.js";
import { fmtRelative, parseTs } from "../lib/formatting.js";
import { serverHostId, serversStore } from "../lib/stores.js";

// AssistantDockContext — extracts the assistant dock state, derived layout
// values, and interaction functions out of App.jsx. The provider owns all
// dock-related state; consumers read via useAssistantDock().

const AssistantDockContext = React.createContext(null);

function useAssistantDock() {
  return React.useContext(AssistantDockContext);
}

function alertAssistantPrompt(item) {
  if (!item) return "";
  const srv = item.serverId ? serversStore.find(item.serverId) : null;
  const where = srv ? " on " + srv.name : "";
  const when = item.raisedAt
    ? fmtRelative(parseTs(item.raisedAt), new Date())
    : null;
  const raised = when ? " (raised " + when + ")" : "";
  if (item.escalated) {
    return "The alert \u201C" + item.title + "\u201D" + where + " escalated \u2014 auto-recovery gave up after "
      + item.attempts + " attempt" + (item.attempts === 1 ? "" : "s") + " and it needs a human. "
      + "Walk me through diagnosing and fixing it.";
  }
  return "The alert \u201C" + item.title + "\u201D is firing" + where + raised
    + ". What's likely causing it, and how do I fix it?";
}

function AssistantDockProvider({ hosts, setRoute, children }) {
  // ===== State =====
  const [assistantOpen, setAssistantOpen] = React.useState(false);
  const [assistantSeed, setAssistantSeed] = React.useState(null);
  const tw = { dockBehavior: "auto", contentFloor: 1000, openByDefault: true };
  const [manualPin, setManualPin] = React.useState(() => {
    const v = localStorage.getItem("krystal:dock:pin");
    return v === "1" ? true : v === "0" ? false : null;
  });
  const [vw, setVw] = React.useState(() => window.innerWidth);
  const [assistantHostId, setAssistantHostId] = React.useState(null);
  const [dockWidth, setDockWidth] = React.useState(() => {
    const saved = parseInt(localStorage.getItem("krystal:dock:width") || "", 10);
    return saved && saved >= 320 && saved <= 900 ? saved : 420;
  });

  // ===== Functions =====
  const dockResize = React.useCallback((e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = dockWidth;
    const min = 320, max = Math.min(900, window.innerWidth - 80);
    const onMove = (ev) => {
      setDockWidth(Math.max(min, Math.min(max, startW + (startX - ev.clientX))));
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.body.style.userSelect = "";
      const handle = document.querySelector(".assistant-dock__resize");
      if (handle) handle.classList.remove("assistant-dock__resize--active");
    };
    document.body.style.userSelect = "none";
    e.currentTarget.classList.add("assistant-dock__resize--active");
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }, [dockWidth]);

  const handleAssistantNavigate = React.useCallback((target) => {
    if (!target) return;
    if (target.kind === "server") setRoute({ kind: "server", id: target.serverId, tab: target.tab });
    else if (target.kind === "audit") setRoute({ kind: "audit" });
    else setRoute({ kind: target.kind === "diagnostics" ? "fleet" : target.kind });
  }, [setRoute]);

  const openView = React.useCallback((view) => {
    setRoute({ kind: view === "diagnostics" ? "fleet" : view });
  }, [setRoute]);

  const askAssistant = React.useCallback((serverId) => {
    if (serverId) {
      const hid = serverHostId(serverId);
      const h = hid && hosts.find(x => x.id === hid);
      if (h && capUsable(h, "assistant")) setAssistantHostId(hid);
    }
    setAssistantOpen(true);
  }, [hosts]);

  const askAboutAlert = React.useCallback((item) => {
    if (item && item.serverId) setRoute({ kind: "server", id: item.serverId });
    askAssistant(item && item.serverId);
    if (item) setAssistantSeed({ prompt: alertAssistantPrompt(item), serverId: item.serverId || null, nonce: Date.now() });
  }, [setRoute, askAssistant]);

  // Hand a blueprint-authoring request to the assistant, from the create page. Opens the
  // INLINE dock (the page stays put, so the half-written editor isn't thrown away) and seeds
  // an editable, not-yet-sent prompt — the user reads and sends it, we never speak for them.
  // The host is the one the create page picked: the blueprint lands on that host's disk.
  const askCreateBlueprint = React.useCallback((gameName, hostId) => {
    const h = hostId && hosts.find(x => x.id === hostId);
    if (h && capUsable(h, "assistant")) setAssistantHostId(hostId);
    setAssistantOpen(true);
    setAssistantSeed({
      prompt: "Create a blueprint for " + (gameName || ""),
      serverId: null,
      nonce: Date.now(),
    });
  }, [hosts]);

  // Hand a NODE to the assistant, from the dashboard's capacity card. Same contract as
  // every other seeded ask: the dock opens on that node's own assistant (per-host leaf, no
  // central fallback) with an editable prompt the user sends — we never speak for them. The
  // caller only offers this where the node HAS a usable assistant, and the capability check
  // here is the second half of that, so a node that lost its leaf mid-session opens the dock
  // on whatever the picker already had rather than pointing it somewhere that can't answer.
  const askAboutHost = React.useCallback((hostId) => {
    const h = hostId && hosts.find(x => x.id === hostId);
    if (h && capUsable(h, "assistant")) setAssistantHostId(hostId);
    setAssistantOpen(true);
    setAssistantSeed({
      prompt: "How is " + ((h && h.name) || hostId) + " doing right now \u2014 what's using its capacity, "
        + "and is anything worth acting on?",
      serverId: null,
      nonce: Date.now(),
    });
  }, [hosts]);

  // Opening the dock with nothing in hand names no node. The target comes from
  // the subject — the server behind askAssistant, the blueprint behind
  // askCreateBlueprint, the node a picked conversation lives on — or, absent a
  // subject, from the dock's own host picker.
  const openAssistant = React.useCallback(() => {
    setAssistantOpen(true);
  }, []);

  // ===== Effects =====
  React.useEffect(() => {
    try { localStorage.setItem("krystal:dock:width", String(dockWidth)); } catch {}
  }, [dockWidth]);

  React.useEffect(() => {
    const onResize = () => setVw(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  React.useEffect(() => {
    try {
      if (manualPin == null) localStorage.removeItem("krystal:dock:pin");
      else localStorage.setItem("krystal:dock:pin", manualPin ? "1" : "0");
    } catch {}
  }, [manualPin]);

  // Per-host assistant capability
  const assistantHostList = React.useMemo(
    () => assistantHostsAll(hosts),
    [hosts]
  );
  const usableAssistants = React.useMemo(
    () => assistantHosts(hosts),
    [hosts]
  );
  // With no subject to derive from, a node is taken only when it is the ONLY
  // one that can answer — that is the sole candidate, not a positional default.
  // Several assistant-capable nodes and no subject leaves the target unset, and
  // the dock renders that as its host picker rather than binding to whichever
  // node happened to sort first.
  const soleAssistant =
    usableAssistants.length === 1 ? usableAssistants[0]
    : (usableAssistants.length === 0 && assistantHostList.length === 1 ? assistantHostList[0] : null);
  const assistantHost = hosts.find(h => h.id === assistantHostId) || soleAssistant || null;

  React.useEffect(() => {
    if (!assistantHostId && assistantHost) setAssistantHostId(assistantHost.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only assistantHost.id is used (and in deps); the object is re-derived every render, so depping it would loop
  }, [assistantHost && assistantHost.id, assistantHostId]);

  // Sign in to the targeted assistant's leaf without being asked to. Every surface on a host is the
  // same Discord application, so a browser signed into the panel has already authorized the
  // assistant and its round trip renders nothing — the second login is a redirect, not a decision.
  //
  // Keyed on the TARGETED host, which is what bounds this: no assistant in the cluster and there is
  // nothing to target; several and the target stays unset until the user picks one, so at most one
  // leaf is ever addressed. ensureSession spends a held refresh token before it spends a redirect,
  // and takes at most one redirect per host per tab.
  //
  // Gated on the leaf being USABLE, not merely declared: a redirect to a leaf that is down lands the
  // browser on a dead origin, which is a far worse answer than the dock saying it is unavailable.
  // The flag is in the deps so a leaf that comes up later still gets its one attempt.
  const assistantReachable = !!(assistantHost && capUsable(assistantHost, "assistant"));
  React.useEffect(() => {
    if (assistantHost && assistantReachable) assistantSession.ensureSession(assistantHost.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the targeted host id + reachability; the object is re-derived every render
  }, [assistantHost && assistantHost.id, assistantReachable]);

  // Restore dock open/closed state across sessions
  const storedOpenRef = React.useRef(localStorage.getItem("krystal:dock:open"));
  const didInitOpen = React.useRef(false);
  React.useEffect(() => {
    if (didInitOpen.current) return;
    if (assistantHostList.length === 0) return;
    didInitOpen.current = true;
    if (window.innerWidth <= 768) return;
    const stored = storedOpenRef.current;
    if (stored === "0") return;
    if (stored === "1") { openAssistant(); return; }
    if (tw.openByDefault && tw.dockBehavior !== "rail") openAssistant();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot dock-open init guarded by didInitOpen; tw is a constant literal
  }, [assistantHostList.length]);

  React.useEffect(() => {
    try { localStorage.setItem("krystal:dock:open", assistantOpen ? "1" : "0"); } catch {}
  }, [assistantOpen]);

  // ===== Review mode (read-only replay of someone else's conversation) =====
  // An admin reviewing a transcript sees it in THIS dock, rendered by the very same components that
  // drew it for the person who had the conversation — the transcript DTO is identical to a user's own
  // history by design, so a second viewer would only be a copy free to drift.
  //
  // It is held here rather than in the reviewing page because the dock outlives that page: opening a
  // transcript and then navigating elsewhere must not strand the dock in a mode with nothing in it.
  const [review, setReview] = React.useState(null);

  // Enter review mode. `conversation` carries the opaque handle, the owning user, and the summary the
  // listing already had, so the header can render before the transcript arrives.
  const openReview = React.useCallback((hostId, conversation) => {
    if (!hostId || !conversation || !conversation.id) return;
    setReview({ hostId, conversation });
    setAssistantOpen(true);
  }, []);

  // Leave review mode and return the dock to the reviewer's own chat. Called by the banner's exit and
  // whenever the dock is closed, so the dock can never reopen still showing someone else's chat.
  const exitReview = React.useCallback(() => setReview(null), []);

  React.useEffect(() => { if (!assistantOpen) setReview(null); }, [assistantOpen]);

  // ===== Layout derivations =====
  const desktop = vw > 768;
  const canPush = desktop && (vw - dockWidth) >= tw.contentFloor;
  const effPush = manualPin == null ? canPush : (manualPin && canPush);
  const pushingPanel = desktop && assistantOpen && (
    tw.dockBehavior === "auto" ? effPush
    : tw.dockBehavior === "rail" ? canPush
    : false
  );
  const railMode = tw.dockBehavior === "rail" && desktop;

  // ===== Context value =====
  const value = React.useMemo(() => ({
    assistantOpen, setAssistantOpen,
    assistantSeed, setAssistantSeed,
    manualPin, setManualPin,
    vw, assistantHostId, setAssistantHostId,
    dockWidth, setDockWidth,
    tw, desktop, canPush, effPush, pushingPanel, railMode,
    assistantHostList, usableAssistants, assistantHost,
    dockResize, handleAssistantNavigate, openView,
    askAssistant, askAboutAlert, askAboutHost, askCreateBlueprint, openAssistant,
    review, openReview, exitReview,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tw is a fresh-per-render literal with constant contents; depping it would rebuild the context value every render
  }), [
    assistantOpen, setAssistantOpen,
    assistantSeed, setAssistantSeed,
    manualPin, setManualPin,
    vw, assistantHostId, setAssistantHostId,
    dockWidth, setDockWidth,
    desktop, canPush, effPush, pushingPanel, railMode,
    assistantHostList, usableAssistants, assistantHost,
    dockResize, handleAssistantNavigate, openView,
    askAssistant, askAboutAlert, askAboutHost, askCreateBlueprint, openAssistant,
    review, openReview, exitReview,
  ]);

  return (
    <AssistantDockContext.Provider value={value}>
      {children}
    </AssistantDockContext.Provider>
  );
}

export { AssistantDockProvider, useAssistantDock, alertAssistantPrompt };
