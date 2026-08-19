// chat utilities — pure functions, constants, and helpers used by ChatPage and
// its sub-modules. No React state, no component deps (except renderMarkdown
// which returns JSX from plain data).

import { commandMeta, NEW_CHAT_TITLE } from "./chatConstants.js";
import { fmtRelative } from "../lib/formatting.js";

const CHAT_LS_KEY      = "krystal:chat:conversations";
const CHAT_ACTIONS_LS  = "krystal:chat:actions";
const CHAT_THINK_LS    = "krystal:chat:think";

const TOGGLE_COPY = {
  thinking: {
    on:  "Thinking on — replies may take a little longer but tend to be more thorough and accurate.",
    off: "Thinking off — the assistant answers directly, for quicker replies.",
  },
  actions: {
    on:  "Auto-run on — the assistant will carry out start/stop/restart actions immediately, without asking you to confirm each one.",
    off: "Auto-run off — the assistant will propose actions and wait for you to confirm before anything runs.",
  },
};

// ---------- persistence ----------
function loadConversations() {
  try {
    const raw = localStorage.getItem(CHAT_LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}
function saveConversations(convos) {
  try { localStorage.setItem(CHAT_LS_KEY, JSON.stringify(convos)); } catch {}
}
function loadSetting(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}
function saveSetting(key, val) {
  try { localStorage.setItem(key, val); } catch {}
}

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// The label a tool shows while it runs arrives ON the frame, from the tool's own catalog entry —
// the assistant owns its tools, so it owns what they are called. The map that used to live here
// went stale without failing: it named four tools that no longer existed and knew nothing about any
// tool added after it was written, and the fallback below hid that by prettifying the raw name.
// A frame with no label still gets that fallback, which is all a pre-label leaf ever sent.
function toolLabel(tool, label) {
  if (label) return label;
  if (!tool) return "Working";
  return tool.charAt(0).toUpperCase() + tool.slice(1).replace(/_/g, " ");
}

// ---------- command verified (rendered from the leaf's confirm verdict) ----------
// The leaf watches a lifecycle command until it reaches its run-state postcondition and answers a
// VERDICT (wire-contract \u00a73): settled/accepted are the two successes, and notSettled/unknown/failed/
// refused each say something different about what went wrong. We render the verdict rather than
// parsing `text` for it \u2014 `text` is the one field the leaf is free to reword, and two surfaces
// reading it differently is exactly how they come to disagree about whether a server started.
const VERB_PAST = {
  start: "Started", stop: "Stopped", restart: "Restarted", install: "Installed",
  uninstall: "Uninstalled", update: "Updated", backup: "Backed up",
};
const STATE_WORD = { running: "running", stopped: "stopped", unknown: "unreadable" };

function composeVerified(verb, serverName, resp) {
  const r = resp || {};
  const o = r.outcome || null;
  const what = verb.replace(/_/g, " ") + " ";
  const lines = o && o.reason ? [{ status: "fail", label: "Reason", detail: String(o.reason) }] : [];

  // No outcome object at all: an older leaf, or a kind that reports none. Fall back to `success`,
  // and to the leaf's own sentence \u2014 never upgrade silence into an observation.
  if (!o) {
    return r.success
      ? { ok: true, headline: r.text || ((VERB_PAST[verb] || ("Ran " + verb + " on")) + " " + serverName + "."), lines: [] }
      : { ok: false, headline: r.text || ("Couldn\u2019t " + what + serverName + "."), lines: [] };
  }

  switch (o.verdict) {
    case "settled": {
      const headline = (VERB_PAST[verb] || ("Ran " + verb + " on")) + " " + serverName + ".";
      return { ok: true, headline, lines: [] };
    }
    // Ran, and the engine reported success, but the verb has no run-state to watch (an update, a
    // backup, a config write). Say what was done, and claim nothing about the server's state.
    case "accepted":
      return { ok: true, headline: (VERB_PAST[verb] || ("Ran " + verb + " on")) + " " + serverName + ".", lines: [] };
    // Ran; the end state was not reached inside the window. `observedState` is what was actually
    // seen \u2014 the honest middle, and the one case a client is most tempted to round to a failure.
    case "notSettled":
      return {
        ok: false,
        headline: "Ran " + what.trim() + " on " + serverName + ", but it hasn\u2019t "
          + (verb === "stop" ? "stopped" : "come up") + " yet \u2014 it may still be working.",
        lines: o.observedState
          ? [{ status: "warn", label: "Last seen", detail: STATE_WORD[o.observedState] || o.observedState }, ...lines]
          : lines,
      };
    // Ran; the run state could not be read. Never rendered as "stopped".
    case "unknown":
      return { ok: false, headline: "Ran " + what.trim() + " on " + serverName + ", but its state couldn\u2019t be read.", lines };
    case "refused":
      return { ok: false, headline: r.text || ("Didn\u2019t " + what + serverName + "."), lines };
    default:  // failed, or a verdict this build doesn't know
      return { ok: false, headline: "Couldn\u2019t " + what + serverName + ".", lines };
  }
}

// ---------- tool.result → evidence card projection ----------
const HEALTH_CHECK_LABELS = {
  liveness: "Server",
  logs:     "Console",
  updates:  "Updates",
  disk:     "Disk space",
};
const HEALTH_CHECK_ICONS = {
  liveness: "server",
  logs:     "terminal-square",
  updates:  "download",
  disk:     "hard-drive",
};
// CheckState → chain tone, same 5-tone vocabulary as EVENT_TYPE_META (danger/warn/update/
// info/success). "skip" (source unavailable / not applicable) reads as neutral info — never a
// fabricated pass or fail.
const CHECK_STATE_TONE = { pass: "success", warn: "warn", fail: "danger", skip: "info" };

// Icon/tone/label for the RAW kgsm engine event-type vocabulary (get_audit_log /
// get_change_timeline). Deliberately separate from formatting.js's ACTION_META: that map is
// keyed by kgsm-api's dotted, shaped audit vocabulary (server.start, …) applied at ITS read
// time; the assistant reads the monitor's engine-event store directly and never runs that
// shaping (event-history-plan.md §"raw enriched events, neutral"), so the wire `type` here is
// always the unshaped kgsm name (instance_started, …). An unrecognized type (a future kgsm
// event) falls back to a plain formatting of the raw string — never a guessed meaning.
const EVENT_TYPE_META = {
  instance_started:         { icon: "play",             tone: "success", label: "Started" },
  instance_restarted:       { icon: "rotate-cw",         tone: "info",    label: "Restarted" },
  instance_stopped:         { icon: "square",            tone: "info",    label: "Stopped" },
  instance_ready:           { icon: "circle-check",      tone: "success", label: "Ready" },
  instance_crashed:         { icon: "alert-triangle",     tone: "danger",  label: "Crashed" },
  instance_failed:          { icon: "octagon-x",          tone: "danger",  label: "Failed (gave up restarting)" },
  instance_installed:       { icon: "package-plus",       tone: "success", label: "Installed" },
  instance_uninstalled:     { icon: "trash-2",            tone: "danger",  label: "Uninstalled" },
  instance_updated:         { icon: "download",           tone: "update",  label: "Updated" },
  instance_update_finished: { icon: "download",           tone: "update",  label: "Update finished" },
  instance_version_updated: { icon: "circle-arrow-up",    tone: "update",  label: "Version updated" },
  instance_backup_created:  { icon: "database",           tone: "success", label: "Backup created" },
  instance_deploy_failed:   { icon: "octagon-alert",       tone: "danger",  label: "Deploy failed" },
  instance_download_failed: { icon: "octagon-alert",       tone: "danger",  label: "Download failed" },
  instance_uninstall_failed:{ icon: "octagon-alert",       tone: "danger",  label: "Uninstall failed" },
  instance_ports_opened:    { icon: "lock-open",          tone: "info",    label: "Ports opened" },
  instance_ports_closed:    { icon: "lock",               tone: "warn",    label: "Ports closed" },
  instance_player_joined:   { icon: "log-in",             tone: "info",    label: "Player joined" },
  instance_player_left:     { icon: "log-out",            tone: "info",    label: "Player left" },
};
function eventTypeMeta(type) {
  return EVENT_TYPE_META[type] || {
    icon: "circle",
    tone: "info",
    label: String(type || "event").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()),
  };
}
// One raw event/change row → the flat display shape EvidenceAudit/EvidenceChangeTimeline
// render. `by` is honestly "unknown actor" for a null actor (a bare CLI call) — never
// defaulted to a fabricated "system". `detail` names the owning instance only in a fleet-wide
// read (redundant once the card is already scoped to one server).
function auditEventRow(e, fleetWide) {
  const meta = eventTypeMeta(e && e.type);
  const ts = e && e.ts ? new Date(e.ts) : null;
  return {
    icon: meta.icon,
    tone: meta.tone,
    label: meta.label,
    by: (e && e.actor) || "unknown actor",
    detail: fleetWide ? ((e && e.instance) || "host-level") : "",
    rel: ts && !isNaN(ts.getTime()) ? fmtRelative(ts) : "",
  };
}

// The raw kgsm engine event-type → the dotted audit action + summary wording kgsm-api's read-time
// shaping (MonitorEventShaping.Shape) emits for the SAME event. Mirroring it here lets the chat
// "Recent events" card render each event as the exact shared `.audit-row` the Audit page and
// dashboard show — one consistent activity design across the app. The assistant reads the monitor's
// raw engine store directly (leaf independence — it never runs kgsm-api's shaping), so the mapping
// has to live on this side too. An unmapped type falls back to `engine.<type>` (kgsm-api's own
// GenericShape fallback), which ACTION_META renders with the neutral circle-dot pill exactly as the
// audit page does — so a future kgsm event still shows up, never guessed into a wrong meaning.
const RAW_EVENT_ACTION = {
  instance_started:         { action: "server.start",       summary: (i) => "started " + i },
  instance_ready:           { action: "server.ready",       summary: (i) => i + " is ready to play" },
  instance_stopped:         { action: "server.stop",        summary: (i) => "stopped " + i },
  instance_restarted:       { action: "server.restart",     summary: (i) => "restarted " + i },
  instance_uninstalled:     { action: "server.uninstall",   summary: (i) => "uninstalled " + i },
  instance_version_updated: { action: "server.update",      summary: (i) => "updated " + i },
  instance_installed:       { action: "server.install",     summary: (i) => "installed " + i },
  instance_backup_created:  { action: "backup.create",      summary: (i) => "backed up " + i },
  instance_backup_restored: { action: "backup.restore",     summary: (i) => "restored backup for " + i },
  instance_crashed:         { action: "server.crash",       summary: (i) => i + " crashed — auto-restarting" },
  instance_failed:          { action: "server.crash",       summary: (i) => i + " crashed — supervisor gave up" },
  instance_ports_opened:    { action: "network.ports.open", summary: (i) => "opened ports for " + i },
  instance_ports_closed:    { action: "network.ports.close",summary: (i) => "closed ports for " + i },
  instance_upnp_opened:     { action: "network.upnp.open",  summary: (i) => "forwarded router ports for " + i },
  instance_upnp_closed:     { action: "network.upnp.close", summary: (i) => "removed router forwards for " + i },
  instance_upnp_reasserted: { action: "network.upnp.reassert", summary: (i) => "restored router forwards the router dropped for " + i },
  instance_player_joined:   { action: "player.join",        summary: (i) => "a player joined " + i },
  instance_player_left:     { action: "player.leave",       summary: (i) => "a player left " + i },
  instance_config_changed:  { action: "config.set",         summary: (i) => "changed config for " + i },
  instance_input_sent:      { action: "console.input",      summary: (i) => "sent a console command to " + i },
};

// Mirror of kgsm-api ParseActor so the same event resolves the same actor on both surfaces:
// `provider:name` → discord=user, api=token, system=system, an unrecognized provider keeps the name
// as a user; a bare "system" (or a null actor — kgsm's defensive default) is the autonomous engine;
// any other bare string is the local OS user. Never fabricated beyond that defensive default.
//
// `provider` rides along, because it is the axis that separates a real Discord identity from every
// other name: AuditActor reads it to decide whether an actor called `monitor` is the metrics leaf or
// a person. An unrecognized provider keeps the name but leaves it null, exactly as the api does —
// never coerced to one of the three.
function parseAuditActor(flat) {
  const s = (flat || "").trim();
  if (!s) return { name: "system", kind: "system", provider: "system" };
  const colon = s.indexOf(":");
  if (colon > 0 && colon < s.length - 1) {
    const provider = s.slice(0, colon).toLowerCase();
    const name = s.slice(colon + 1);
    if (provider === "discord") return { name, kind: "user", provider: "discord" };
    if (provider === "api")     return { name, kind: "token", provider: "api" };
    if (provider === "system")  return { name, kind: "system", provider: "system" };
    return { name, kind: "user", provider: null };
  }
  return s.toLowerCase() === "system"
    ? { name: "system", kind: "system", provider: "system" }
    : { name: s, kind: "user", provider: "system" };
}

// One raw engine event (the monitor's GET /events row, relayed verbatim by the assistant as
// { id, ts, type, instance, actor, origin }) → the standard `ev` audit-record shape the shared
// AuditEventRow renders, shaped to match kgsm-api's /audit output for the same event. `id` is the
// deterministic AuditId the monitor stores (== the id /audit returns), so it's a stable React key.
function auditEventToRecord(e) {
  const instance = (e && e.instance) || null;
  const shape = (e && RAW_EVENT_ACTION[e.type]) || null;
  const action = shape ? shape.action : "engine." + String((e && e.type) || "event");
  const summary = shape
    ? shape.summary(instance || "a server")
    : String((e && e.type) || "event").replace(/_/g, " ");
  return {
    id: (e && e.id) || (action + ":" + (e && e.ts)),
    ts: e && e.ts ? String(e.ts) : "",
    action,
    actor: parseAuditActor(e && e.actor),
    summary,
    origin: (e && e.origin) || null,
    serverId: instance,
    meta: {},
  };
}
function adaptResultCard(card) {
  if (!card || !card.tool) return null;
  const id = (card.subject && card.subject.id) || null;
  switch (card.tool) {
    case "run_health_check": {
      const d = card.data;
      if (!d || !Array.isArray(d.checks)) return null;
      let fails = 0, warns = 0;
      const checks = d.checks.map(ck => {
        if (ck.state === "fail") fails++;
        else if (ck.state === "warn") warns++;
        return {
          label: HEALTH_CHECK_LABELS[ck.name] || (ck.name || "check"),
          status: ck.state || "skip",
          detail: ck.detail || "",
        };
      });
      return {
        kind: "health",
        serverId: id,
        serverName: id || "this server",
        confidence: card.confidence || null,
        checks,
        passes: typeof d.passed === "number" ? d.passed : checks.filter(c => c.status === "pass").length,
        fails,
        warns,
      };
    }
    case "get_status": {
      const d = card.data;
      if (!d || !Array.isArray(d.servers)) return null;
      const TONE = { running: "success", stopped: "idle", unknown: "warn" };
      const servers = d.servers.map(s => {
        const state = String(s.state || "unknown").toLowerCase();
        const known = Object.prototype.hasOwnProperty.call(TONE, state);
        return {
          instance: s.instance || "\u2014",
          state: known ? state : "unknown",
          tone: known ? TONE[state] : "warn",
          reason: s.reason || null,
        };
      });
      const parts = [];
      if (typeof d.running === "number") parts.push(d.running + " running");
      if (typeof d.stopped === "number") parts.push(d.stopped + " stopped");
      if (d.unavailable) parts.push(d.unavailable + " unavailable");
      return {
        kind: "fleet",
        confidence: card.confidence || null,
        summary: parts.join(" \u00b7 ") || (servers.length + " server" + (servers.length === 1 ? "" : "s")),
        servers,
      };
    }
    case "get_performance": {
      // Two shapes from the same tool: a live SNAPSHOT (current values, no time-series)
      // or a windowed TREND (a per-metric series → a chart). The presence of a non-empty
      // `series` is what distinguishes them. Either way an unmeasured field is null and
      // stays null (never coerced to 0).
      const d = card.data;
      if (!d) return null;
      const num = (v) => (typeof v === "number" ? v : null);

      // Trend: the card carries a per-metric time series over `range` → render a chart.
      const series = d.series && typeof d.series === "object" ? d.series : null;
      const hasSeries = series && Object.values(series).some(
        (pts) => Array.isArray(pts) && pts.length > 0);
      if (hasSeries) {
        return {
          kind: "performance",
          mode: "trend",
          serverId: id,
          serverName: id || "this server",
          confidence: card.confidence || null,
          range: typeof d.range === "string" ? d.range : null,
          series,
        };
      }

      return {
        kind: "performance",
        mode: "snapshot",
        serverId: id,
        serverName: id || "this server",
        confidence: card.confidence || null,
        cpuPctCore: num(d.cpuPctCore),
        memBytes:   num(d.memBytes),
        rxBps:      num(d.rxBps),
        txBps:      num(d.txBps),
        ioReadBps:  num(d.ioReadBps),
        ioWriteBps: num(d.ioWriteBps),
        diskBytes:  num(d.diskBytes),
        pids:       num(d.pids),
      };
    }
    case "get_audit_log": {
      const d = card.data;
      if (!d) return null;
      // Normalize each raw engine event into the standard `ev` audit shape so the card renders the
      // shared AuditEventRow — the same row the Audit page and dashboard use (host chip resolves
      // itself off serverId, so no fleet-wide flag is threaded here).
      return {
        kind: "audit",
        serverId: d.instance || null,
        serverName: d.instance || "all servers",
        confidence: card.confidence || null,
        windowLabel: typeof d.window === "string" ? "last " + d.window : "",
        available: d.state === "available",
        events: Array.isArray(d.events) ? d.events.map(auditEventToRecord) : [],
      };
    }
    case "get_change_timeline": {
      const d = card.data;
      if (!d) return null;
      const fleetWide = !d.instance;
      return {
        kind: "timeline",
        serverId: d.instance || null,
        serverName: d.instance || "all servers",
        confidence: card.confidence || null,
        windowLabel: typeof d.window === "string" ? "last " + d.window : "",
        available: d.state === "available",
        changes: Array.isArray(d.events) ? d.events.map((e) => auditEventRow(e, fleetWide)) : [],
      };
    }
    case "trace_root_cause": {
      // The capstone aggregator (event-history-plan.md Phase E): a RANKED list of findings, each
      // a deterministic pattern match (or, when nothing matched, an honest correlation) with its
      // own evidence chain. The card shows the TOP (best-confidence) finding's evidence in full —
      // its matched events, metric-window facts, and health checks, each carrying its own
      // provenance/tone — and folds any remaining findings into one trailing summary line so a
      // secondary lead is never silently dropped.
      const d = card.data;
      if (!d || !Array.isArray(d.findings) || d.findings.length === 0) return null;
      const [top, ...rest] = d.findings;
      const fleetWide = false; // trace_root_cause is always single-instance

      const steps = [];
      (Array.isArray(top.events) ? top.events : []).forEach((e) => {
        const row = auditEventRow(e, fleetWide);
        steps.push({ tone: row.tone, icon: row.icon, label: row.label, detail: [row.by, row.rel].filter(Boolean).join(" · ") });
      });
      (Array.isArray(top.metrics) ? top.metrics : []).forEach((m) => {
        const label = m.metric === "cpuPctCore" ? "CPU" : m.metric === "memBytes" ? "Memory" : (m.metric || "Metric");
        steps.push({ tone: "info", icon: "activity", label, detail: m.detail || "" });
      });
      (Array.isArray(top.healthChecks) ? top.healthChecks : []).forEach((h) => {
        steps.push({
          tone: CHECK_STATE_TONE[h.state] || "info",
          icon: HEALTH_CHECK_ICONS[h.name] || "stethoscope",
          label: HEALTH_CHECK_LABELS[h.name] || h.name || "check",
          detail: h.detail || "",
        });
      });
      if (rest.length) {
        steps.push({
          tone: "info",
          icon: "list",
          label: rest.length + " other lead" + (rest.length === 1 ? "" : "s") + " considered",
          detail: rest.map((f) => f.label).filter(Boolean).join(" · "),
        });
      }

      return {
        kind: "rootcause",
        serverId: d.instance || id,
        serverName: d.instance || id || "this server",
        confidence: card.confidence || top.confidence || null,
        signature: top.signature || "none",
        headline: top.explanation || "",
        steps,
      };
    }
    case "search": {
      const d = card.data;
      // A card is only surfaced when the search has passages to cite; empty/failed stays summary-only.
      if (!d || !Array.isArray(d.passages) || d.passages.length === 0) return null;
      const passages = d.passages.map(p => ({
        origin: p.provenance === "web" ? "web" : "local",
        source: p.source || "",
        title: p.title || null,
        text: p.text || "",
        score: typeof p.score === "number" ? p.score : null,
      }));
      const anyLocal = passages.some(p => p.origin === "local");
      const anyWeb = passages.some(p => p.origin === "web");
      return {
        kind: "search",
        confidence: card.confidence || null,
        query: d.query || id || "",
        state: d.state || null,      // "localStrong" | "localWeak" | "web"
        provenance: anyLocal && anyWeb ? "mixed" : anyWeb ? "web" : "local",
        passages,
      };
    }
    case "get_network": {
      // Two independent axes, each with its own honest-unknown states that must NEVER read
      // as "nothing open / nothing forwarded": the HOST FIREWALL (state / listState /
      // enforcement / open port ranges) and the ROUTER's UPnP forwards (upnpState / forwards).
      // The card is only attached when at least one axis has real structure, but the OTHER
      // axis may be unreadable — carry its state through verbatim so the card can say so.
      const d = card.data;
      if (!d) return null;
      const proto = (p) => (p ? String(p).toLowerCase() : "");
      const ports = Array.isArray(d.ports) ? d.ports.map((p) => ({
        start: typeof p.start === "number" ? p.start : null,
        end: typeof p.end === "number" ? p.end : null,
        protocol: proto(p.protocol),
      })) : [];
      const forwards = Array.isArray(d.forwards) ? d.forwards.map((f) => ({
        externalPort: typeof f.externalPort === "number" ? f.externalPort : null,
        internalPort: typeof f.internalPort === "number" ? f.internalPort : null,
        protocol: proto(f.protocol),
        internalClient: f.internalClient || null,
      })) : [];
      return {
        kind: "network",
        serverId: id,
        serverName: id || "this server",
        confidence: card.confidence || null,
        firewall: {
          state: d.state || "firewallUnavailable",   // "available" | "firewallUnavailable"
          backend: d.backend || null,
          listState: d.listState || "unknown",         // "enumerated" | "unknown" | "unsupported"
          enforcement: d.enforcement || "unknown",     // "enforcing" | "inactive" | "unknown"
          ports,
        },
        router: {
          state: d.upnpState || "daemonUnavailable",   // "queried" | "routerUnavailable" | "daemonUnavailable"
          forwards,
        },
      };
    }
    case "create_blueprint": {
      // The terminal outcome of the blueprint-authoring pipeline: `outcome` is a 6-value
      // enum ("disabled" | "alreadyExists" | "notFeasible" | "failed" | "draftReady" |
      // "verified") — ONLY "verified" is a real success; every other value (including an
      // absent/unrecognized one) renders the honest "couldn't" side, never a claimed
      // success we can't back up. `subject.id` is the canonical blueprint slug on every
      // outcome (the install-handoff key); `d.blueprintName` is a defensive fallback.
      const d = card.data || {};
      // "draftReady" is the mandatory-review checkpoint, NOT a terminal card: the editable
      // Monaco card is driven by the sibling command.proposed frame (verb "blueprint"), which
      // alone carries the confirmation token Save needs. Suppress the tool.result twin here so
      // the draft renders once, as the interactive card — never as a dead "couldn't add" card.
      if (d.outcome === "draftReady") return null;
      return {
        kind: "blueprintOutcome",
        confidence: card.confidence || null,
        ok: d.outcome === "verified",
        slug: id || d.blueprintName || null,
        displayName: d.game || null,
        proof: d.proofLine || null,
        reason: d.reason || null,
      };
    }
    default:
      return null;
  }
}

// The assistant's /confirm response for a blueprint finalize (Save on the review card) →
// the patch the ChatBlueprintDraft state machine applies. Read the RICH card's `data.outcome`,
// never the prose: "verified" (with success) is the only real catalog win; a "draftReady" comes
// back with a FRESH token (resp.confirmations[0]) + boot `evidence` for a second edit — the
// re-edit loop; anything else (or an unparseable/absent outcome) is an honest terminal failure,
// never a fabricated success. Slug/proof/reason are carried verbatim or left null.
function adaptBlueprintConfirm(resp) {
  const r = resp || {};
  const card = r.card || {};
  const d = (card && card.data) || {};
  const reToken = Array.isArray(r.confirmations) && r.confirmations[0] ? r.confirmations[0].token : null;

  if (d.outcome === "verified" && r.success) {
    return {
      state: "verified",
      slug: (card.subject && card.subject.id) || d.blueprintName || null,
      displayName: d.game || null,
      proof: d.proofLine || null,
    };
  }
  // Repair exhausted / invalid edit came back for another pass — only a real re-edit if the
  // draft AND a fresh token both arrived; otherwise it degrades to the honest failure below.
  if (d.outcome === "draftReady" && reToken && d.draftYaml) {
    return {
      state: "proposed",
      token: reToken,
      draftYaml: d.draftYaml,
      evidence: d.evidence || null,
      displayName: d.game || null,
    };
  }
  return {
    state: "failed",
    displayName: d.game || null,
    reason: d.reason || r.text || null,
  };
}

// Evidence cards gathered from tool.result frames ride on `bubble.pendingCards`
// while the assistant is still streaming its answer, then get promoted to
// `bubble.cards` when the turn ends (done/error/dropped). This keeps the card
// hidden until the streamed text is complete, so the thread reads top-to-bottom
// (answer, then evidence) instead of the card popping in above the growing text.
function promotePendingCards(bubble) {
  if (!bubble || !bubble.pendingCards || !bubble.pendingCards.length) return bubble;
  const { pendingCards, ...rest } = bubble;
  return { ...rest, cards: (bubble.cards || []).concat(pendingCards) };
}

// ---------- SSE frame reducer ----------
function reduceTurnFrame(messages, ev) {
  const msgs = messages.slice();
  const lastIdx = msgs.length - 1;
  const bubble = msgs[lastIdx];
  if (!bubble || bubble.role !== "assistant") return messages;
  switch (ev.type) {
    case "text.delta":
      msgs[lastIdx] = { ...bubble, content: (bubble.content || "") + (ev.text || "") };
      break;
    case "thinking.delta":
      msgs[lastIdx] = { ...bubble, thinking: (bubble.thinking || "") + (ev.text || "") };
      break;
    case "tool.start": {
      const startTools = (bubble.tools || []).concat({ id: ev.id, label: toolLabel(ev.tool, ev.label), state: "pending" });
      msgs[lastIdx] = { ...bubble, tools: startTools };
      break;
    }
    case "progress": {
      // create_blueprint narrates its own sub-steps before its tool.result lands. The wire
      // carries NO tool-call id on a progress frame (it can't thread one through the
      // frozen generic SSE package) — steps are keyed by `key` ALONE, which is safe
      // because a turn calls create_blueprint at most once. A fresh key is appended as
      // "active" after every OTHER active step is checked off "done" — that's what gives
      // the live check-them-off effect. A repeat of the same key (the bounded self-repair
      // loop re-entering a step) re-activates it in place rather than duplicating the row.
      const prevSteps = bubble.steps || [];
      const steps = prevSteps.map(s => s.status === "active" ? { ...s, status: "done" } : s);
      const idx = steps.findIndex(s => s.key === ev.key);
      const entry = { key: ev.key, label: ev.label || "", status: "active" };
      if (idx >= 0) steps[idx] = entry; else steps.push(entry);
      msgs[lastIdx] = { ...bubble, steps };
      break;
    }
    case "tool.result": {
      const resTools = (bubble.tools || []).slice();
      for (let k = resTools.length - 1; k >= 0; k--) {
        if (resTools[k].id === ev.id && resTools[k].state === "pending") {
          resTools[k] = { ...resTools[k], state: "done", summary: ev.summary || "" };
          break;
        }
      }
      let next = { ...bubble, tools: resTools };
      // Progress steps carry no id to match against ev.id — identify create_blueprint's
      // own tool.result by the result card's `tool` field instead, and check off whatever
      // is still active (normally just the last step, e.g. teardown).
      if (bubble.steps && bubble.steps.length && ev.result && ev.result.tool === "create_blueprint") {
        next = { ...next, steps: bubble.steps.map(s => s.status === "active" ? { ...s, status: "done" } : s) };
      }
      if (ev.result) {
        const card = adaptResultCard(ev.result);
        // Hold the card back until the turn finishes streaming (see promotePendingCards).
        if (card) next = { ...next, pendingCards: (bubble.pendingCards || []).concat(card) };
      }
      msgs[lastIdx] = next;
      break;
    }
    case "error": {
      const note = "\u26a0\ufe0f " + (ev.message || "The assistant failed.");
      // A turn-ending error strands any still-active progress steps \u2014 check them off so
      // the stepper doesn't sit spinning forever.
      let base = bubble;
      if (bubble.steps && bubble.steps.some(s => s.status === "active")) {
        base = { ...base, steps: bubble.steps.map(s => s.status === "active" ? { ...s, status: "done" } : s) };
      }
      const errored = base.content
        ? { ...base, content: base.content + "\n\n_" + note + "_" }
        : { ...base, content: note, error: true };
      msgs[lastIdx] = promotePendingCards(errored);
      break;
    }
    case "command.proposed":
      // A new blueprint draft (initial or a revise_blueprint refinement) supersedes any earlier draft
      // still open for review — that older card's token/content is stale, so retire it to a read-only
      // "superseded" state (no editor, no Save/Reset) rather than leave two live editors that could both
      // be saved. Only editable ("proposed") drafts are retired; a mid-finalize ("verifying") one is left
      // alone. A verify still in flight is left alone.
      if (ev.verb === "blueprint") {
        for (let k = 0; k < msgs.length; k++) {
          if (msgs[k].role === "command" && msgs[k].verb === "blueprint" && msgs[k].bpState === "proposed")
            msgs[k] = { ...msgs[k], bpState: "superseded" };
        }
      }
      msgs.splice(lastIdx, 0, proposalMessage(ev));
      break;
    case "done": {
      let done = bubble;
      // Safety net: the turn ended without every progress step's owning tool.result
      // arriving in band (a dropped frame) — check off whatever is still active.
      if (bubble.steps && bubble.steps.some(s => s.status === "active")) {
        done = { ...done, steps: bubble.steps.map(s => s.status === "active" ? { ...s, status: "done" } : s) };
      }
      if (ev.text) done = { ...done, content: ev.text };
      if (ev.usage) done = { ...done, usage: ev.usage };
      // The id the leaf recorded this turn under, so the answer can be rated the moment it lands rather
      // than only after a reload. 0/absent means the turn was not persisted and is not addressable.
      if (ev.turnId) done = { ...done, turnId: ev.turnId };
      if (ev.completedAt) done = { ...done, ts: Date.parse(ev.completedAt) || undefined };
      // Streaming is over — reveal the evidence cards below the finished answer.
      msgs[lastIdx] = promotePendingCards(done);
      let start = lastIdx;
      while (start > 0 && msgs[start - 1].role === "command") start--;
      if (start < lastIdx) {
        const bub = msgs[lastIdx];
        const cards = msgs.slice(start, lastIdx);
        msgs.splice(start, lastIdx - start + 1, bub, ...cards);
      }
      break;
    }
    default:
      break;
  }
  return msgs;
}

// ---------- conversation history rebuild ----------
// One proposal card, built the same way whether the frame arrived live on the turn that staged it or
// was restated by a conversation load while it was still waiting.
//
// ⚠ Built in ONE place on purpose. A restated proposal that rendered even slightly differently from a
// live one would be a second answer to "what is this action", and the surface most likely to see the
// restated form is the one arriving via the notification — the surface with the least context.
function proposalMessage(ev) {
  return {
    role: "command",
    // Mint a CONVERSATION-unique correlation handle locally rather than trusting ev.id: the
    // assistant's command.proposed id (`cmd_<n>`) is a PER-TURN monotonic counter that resets
    // to cmd_0 each turn, so a create_blueprint draft and a later revise_blueprint draft collide
    // on the same id. Since ev.id is only ever used client-side to correlate proposed→verified
    // (the finalize Save authorizes with msg.token, never the id — nothing server-bound reads it
    // back), a fresh uid() keeps every draft's patches (verifying/verified/failed) scoped to its
    // own card — otherwise a Save would revive every same-id superseded editor alongside it.
    cmdId: uid(),
    verb: ev.verb,
    subjectId: ev.subject ? ev.subject.id : null,
    subjectResource: (ev.subject && ev.subject.resource) || "server",
    // Install targets a blueprint (subject.id is the blueprint); the optional custom instance
    // name the user asked for rides its own field so a named install lands the name.
    instanceName: ev.instanceName || null,
    confirm: ev.confirm || (commandMeta(ev.verb).label + "?"),
    reason: ev.reason || null,
    // write_file carries a { path, proposedContent } preview so the card can show the exact
    // change before the user accepts it; null for every other verb.
    file: ev.file || null,
    // The host-minted confirmation token + the staged body. Only the blueprint-review card
    // (verb "blueprint") uses them: `token` authorizes the finalize Save, `draftYaml` is the
    // editor's starting content (the frame's `configValue`). Null/harmless for other verbs —
    // the M3 command path routes those through kgsm-api endpoints, not the assistant token.
    token: ev.token || null,
    draftYaml: ev.configValue ?? null,
    // The blueprint-review card is a small state machine (proposed → verifying → verified|
    // failed, looping back to proposed on repair exhaustion); ChatPage patches bpState onto
    // this message as the Save round-trip resolves. It starts at the review checkpoint.
    bpState: ev.verb === "blueprint" ? "proposed" : undefined,
    state: "proposed",
  };
}

function scaffoldHistory(entries) {
  const out = [];
  if (!Array.isArray(entries)) return out;
  entries.forEach((e, ei) => {
    if (!e) return;
    if (e.kind === "checkpoint") {
      out.push({ role: "checkpoint", label: "Conversation compacted to save context", at: e.createdAt });
      return;
    }
    const t = e.turn;
    if (!t) return;
    const userMsg = { role: "user", content: t.prompt || "" };
    if (e.startedAt) userMsg.ts = Date.parse(e.startedAt) || undefined;
    out.push(userMsg);
    const bubble = { role: "assistant", content: t.final || "", ts: Date.parse(e.createdAt) || undefined };
    // The turn's durable id + the verdict already on it. History is the bulk of any corpus, so without
    // these a replayed answer could never be rated — only the newest one could.
    if (e.turnId) bubble.turnId = e.turnId;
    if (e.feedback && e.feedback.rating) {
      bubble.feedback = { rating: e.feedback.rating, note: e.feedback.note || null };
    }
    if (t.thinking) bubble.thinking = t.thinking;
    if (t.usage) bubble.usage = t.usage;
    const tools = Array.isArray(t.tools)
      ? t.tools.map((tl, ti) => ({ id: "h" + ei + "_" + ti, label: toolLabel(tl.tool, tl.label), state: "done", summary: tl.summary || "" }))
      : [];
    if (tools.length) bubble.tools = tools;
    const cards = Array.isArray(t.tools)
      ? t.tools.map(tl => (tl && tl.result ? adaptResultCard(tl.result) : null)).filter(Boolean)
      : [];
    if (cards.length) bubble.cards = cards;
    if (!t.final && t.outcome && t.outcome !== "ok") { bubble.content = "\u26a0\ufe0f This turn didn\u2019t complete."; bubble.error = true; }
    out.push(bubble);
  });
  return out;
}

// The transcript, plus whatever is still awaiting approval in it.
//
// The proposals go at the END rather than beside the turn that staged them: the leaf reports them as
// the conversation's outstanding set, not as part of any turn's record, and a conversation runs one
// turn at a time — so the last thing said is the thing they belong to. Placing them anywhere else
// would mean inventing an association the host never stated.
function scaffoldConversation(data) {
  const out = scaffoldHistory(data && data.entries);
  const pending = (data && data.pending) || [];
  for (const ev of pending) out.push(proposalMessage(ev));
  return out;
}

function latestUsage(messages) {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === "assistant" && m.usage) return m.usage;
  }
  return null;
}

// Render a turn from a `turn.attach` snapshot — the state of a turn this surface did not watch from
// the start, or one it has just been redrawn with after falling behind.
//
// The snapshot REPLACES whatever this surface was rendering for the live turn rather than being merged
// into it: it is the leaf's own account of that turn, and reconciling two partial views is how a
// duplicated tool row or a doubled sentence gets in. Everything before the live turn is untouched.
function scaffoldLiveTurn(messages, attach) {
  const settled = messages.filter(m => !m.live);
  const tools = (attach.tools || []).map(t => ({
    id: t.id,
    label: toolLabel(t.name, t.label),
    state: t.state === "done" ? "done" : "pending",
    summary: t.summary || "",
  }));
  const cards = (attach.tools || [])
    .map(t => (t.card ? adaptResultCard(t.card) : null))
    .filter(Boolean);

  const bubble = {
    role: "assistant",
    live: true,
    content: attach.text || "",
    thinking: attach.thinking || undefined,
    tools: tools.length ? tools : undefined,
    // Cards are held back until the turn finishes, exactly as a watched turn holds them — so a
    // mirrored turn and a first-hand one reach their final shape through the same step.
    pendingCards: cards.length ? cards : undefined,
  };

  return [
    ...settled,
    { role: "user", content: attach.prompt || "", live: true },
    bubble,
  ];
}

// One conversation as the LEAF states it, turned into a row this surface holds. The listing path and
// the create path (`/new` answers with the row it made) both come through here, so a chat adopted the
// moment it is started and the same chat read back later are the same object — including its name,
// which is the leaf's either way.
//
// `loaded: false` marks the transcript as not yet fetched, which is true of both: a fresh chat has no
// transcript and a listed one has not been read.
function adoptServerConversation(s, hostId) {
  return {
    id: s.id,
    title: s.title || NEW_CHAT_TITLE,
    messages: [],
    created: Date.parse(s.createdAt) || 0,
    lastActivity: Date.parse(s.lastActivityAt) || 0,
    turns: typeof s.turnCount === "number" ? s.turnCount : undefined,
    think: typeof s.think === "boolean" ? s.think : undefined,
    autorun: typeof s.autorun === "boolean" ? s.autorun : undefined,
    hostId,
    remote: true,
    loaded: false,
  };
}

function mergeServerConversations(local, serverList, hostId) {
  if (!Array.isArray(serverList) || serverList.length === 0) return local;
  const byId = new Map(local.map(c => [c.id, c]));
  const merged = local.slice();
  for (const s of serverList) {
    if (!s || !s.id) continue;
    const existing = byId.get(s.id);
    if (existing) {
      const patch = {};
      // The NAME overwrites, like the switches below and for the same reason: the leaf is what names a
      // conversation, and what is held here is only ever a record of what it last said. A row this
      // browser minted carries the placeholder until the leaf answers; keeping that over the leaf's
      // answer is how a chat comes to read differently here than everywhere else.
      if (s.title) patch.title = s.title;
      if (!existing.hostId) patch.hostId = hostId;
      // When it was last spoken in OVERWRITES, for the same reason the switches do: the leaf holds
      // every surface's turns, and this browser only ever saw its own. A conversation carried on
      // from a phone is stale here by exactly the amount that matters to anything ordering by it.
      const touched = Date.parse(s.lastActivityAt);
      if (touched) patch.lastActivity = touched;
      // The switches OVERWRITE, where everything else above only fills a gap: they are the leaf's,
      // any surface may have moved them since this browser last looked, and what is cached here is
      // only ever a record of what they were. Keeping a remembered value is how the phone comes to
      // show Thinking off for a conversation the panel turned it on for.
      if (typeof s.think === "boolean") patch.think = s.think;
      if (typeof s.autorun === "boolean") patch.autorun = s.autorun;
      // The turn count is how a re-read of the listing notices that a conversation grew while this
      // surface was not watching — a stream that was down, or a device only just opened. It is the
      // precise version of "something happened": a transcript is refetched because it demonstrably
      // has more turns in it, never merely because a stream reconnected.
      if (typeof s.turnCount === "number") {
        patch.turns = s.turnCount;
        if (typeof existing.turns === "number" && s.turnCount > existing.turns) patch.stale = true;
      }
      if (Object.keys(patch).length) merged[merged.indexOf(existing)] = { ...existing, ...patch };
    } else {
      merged.push(adoptServerConversation(s, hostId));
    }
  }
  merged.sort((a, b) => (b.lastActivity || b.created || 0) - (a.lastActivity || a.created || 0));
  return merged;
}

// ---------- lightweight markdown ----------
function renderMarkdown(text) {
  const blocks = [];
  const fenceRe = /```(\w+)?\n([\s\S]*?)```/g;
  let last = 0, m;
  while ((m = fenceRe.exec(text)) !== null) {
    if (m.index > last) blocks.push({ type: "text", value: text.slice(last, m.index) });
    blocks.push({ type: "code", lang: m[1] || "", value: m[2].replace(/\n$/, "") });
    last = fenceRe.lastIndex;
  }
  if (last < text.length) blocks.push({ type: "text", value: text.slice(last) });

  return blocks.map((b, i) => {
    if (b.type === "code") {
      return (
        <pre className="chat-code" key={i}>
          {b.lang && <span className="chat-code__lang">{b.lang}</span>}
          <code>{b.value}</code>
        </pre>
      );
    }
    const parts = [];
    const inlineRe = /(`[^`]+`|\*\*[^*]+\*\*)/g;
    let li = 0, im;
    let key = 0;
    while ((im = inlineRe.exec(b.value)) !== null) {
      if (im.index > li) parts.push(b.value.slice(li, im.index));
      const tok = im[0];
      if (tok.startsWith("`")) parts.push(<code key={key++} className="chat-inline-code">{tok.slice(1, -1)}</code>);
      else parts.push(<strong key={key++}>{tok.slice(2, -2)}</strong>);
      li = inlineRe.lastIndex;
    }
    if (li < b.value.length) parts.push(b.value.slice(li));
    return <span key={i} style={{ whiteSpace: "pre-wrap" }}>{parts}</span>;
  });
}

export {
  CHAT_LS_KEY, CHAT_ACTIONS_LS, CHAT_THINK_LS, TOGGLE_COPY,
  loadConversations, saveConversations, loadSetting, saveSetting,
  uid, toolLabel, composeVerified, adaptResultCard, adaptBlueprintConfirm,
  reduceTurnFrame, promotePendingCards, scaffoldHistory, scaffoldConversation, scaffoldLiveTurn, latestUsage, mergeServerConversations,
  adoptServerConversation,
  renderMarkdown,
};
