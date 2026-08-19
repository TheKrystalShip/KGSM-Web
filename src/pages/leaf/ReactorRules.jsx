// ReactorRules — what the reactor is watching for, what it would do about each, and which of them are
// switched on.
//
// The Overview's rules table answers "what is running" at a glance. This answers the question that
// takes a minute: what is this rule FOR, why are its windows those numbers, and should it be enabled
// at all. So each rule gets a card rather than a row.
//
// ── What is editable here, and what deliberately is not ────────────────────────────────────────────
//
// A rule's PREDICATE ships in code, and that is a locked decision rather than an unfinished one: a
// file that could add a rule is a file that could make the host act, and `ReactorAction` is a closed
// union precisely so the never-list (never uninstall, never delete a backup, never rewrite instance
// config, never moderate a player) is enforced by the type system instead of by the discretion of
// whoever writes the next rule.
//
// What configuration owns is which rules are live and what authority each has. That is what this page
// writes, through the same leaf-config path the Settings tab uses — the three mode lists the leaf
// already declares. A CSV of rule ids is a poor thing to type by hand and a good thing to render as a
// switch, which is the whole reason this page holds a control at all.
//
// ⚠ **The windows are read-only, and that is not an oversight.** Settle and suppression are compiled
// constants carrying the measurement they came from — 30 days of this host, pinned by the leaf's own
// tests with each figure's basis. A text box here would invite replacing a measurement with a guess,
// and the guess would look exactly as authoritative on screen. The card states each window's basis
// instead.
//
// ── ⚠ The mode a rule may have is the LEAF's answer ────────────────────────────────────────────────
//
// Propose and act are later phases in the leaf, and a rule configured to one of them observes. Which
// modes are offered here comes from `honours` on the wire, never from a constant in this file: a panel
// that hard-coded "this build only observes" would go on refusing `act` after the build that acts is
// deployed.
//
// ── Applying restarts the reactor ──────────────────────────────────────────────────────────────────
//
// The leaf reads its mode lists at startup, so a change is a config write plus a restart — which is
// what the leaf-config path does, admin-gated, through the scoped polkit grant. The page says so
// before it asks, because a restart resets every counter the Overview shows.

import React from "react";

import { BriefCard } from "../../components/BriefCard.jsx";
import { Icon } from "../../components/Icon.jsx";
import { applyLeafConfig, fetchLeafConfig, fetchLeafReactorStatus, servicesStore } from "../../lib/stores.js";
import { sessionStore } from "../../lib/sessionStore.js";
import { LeafAbsent, LeafFacts, LeafLoading, LeafNotice, LeafUnreadable, useLeafResource } from "./leafOverviewKit.jsx";

// The leaf's three mode lists, in the order authority increases. `off` is not a list — a rule named in
// none of them is not enabled — which is why it is handled separately everywhere below.
const MODES = [
  { id: "off", label: "Off", key: null, note: "Not enabled. Nothing wakes it and nothing is evaluated." },
  { id: "observe", label: "Observe", key: "rulesObserve", note: "Evaluate and record. Dispatch nothing." },
  { id: "propose", label: "Propose", key: "rulesPropose", note: "Stage the action for a person to confirm." },
  { id: "act", label: "Act", key: "rulesAct", note: "Perform it." },
];

// How far up that ladder the running build goes. Anything above what the leaf reports it honours is
// offered disabled, with the reason — rather than hidden, because knowing the ladder continues is part
// of understanding what observe means.
const RANK = { off: 0, observe: 1, propose: 2, act: 3 };

// What wakes a rule, and why the distinction matters. An edge rule can miss its wake while the process
// is down; a state rule rediscovers its own condition every sweep and therefore cannot.
const SHAPE = {
  edge: {
    label: "Edge",
    note: "Woken by an event arriving. What happens while the reactor is down is a wake it never gets — "
      + "which costs a wake and never a judgment, since every rule re-derives from the live world when "
      + "it evaluates.",
  },
  state: {
    label: "State",
    note: "Woken by the sweep, and rediscovers its own condition each time. Nothing can be missed, "
      + "because there is no edge to catch.",
  },
};

// What a rule would do if it were ever permitted to. `none` is a real answer and reads as one: the rule
// reports and proposes nothing, which is a judgment worth recording without an action attached.
const ACTION = {
  create_backup: "Take a pinned backup of the failing instance. It only ever creates, so its false "
    + "positive costs disk rather than a running server — which is why it is the first rule the plan "
    + "would let act.",
  propose_restore: "Offer to roll the instance back to the archive taken before the update that "
    + "preceded its failure. It overwrites live state, so it proposes and never acts.",
  none: "Nothing. It records what it concluded and proposes no action.",
};

const SEVERITY_TONE = { danger: "danger", warning: "warn", info: "muted" };

const fmtSeconds = (s) => (s == null ? "—" : s < 60 ? s + "s" : s < 5400 ? Math.round(s / 60) + "m" : (s / 3600).toFixed(1) + "h");
const fmtMinutes = (m) => (m == null ? "—" : m < 90 ? m + "m" : (m / 60).toFixed(1) + "h");

// Parse one of the leaf's CSV mode lists into ids. The leaf tolerates the spacing a person writes, and
// so does this — a list round-tripped through here must not reorder or re-space what it did not change.
const parseCsv = (v) => String(v == null ? "" : v).split(",").map(s => s.trim()).filter(Boolean);

function ReactorRules({ hostId, leafId }) {
  // The leaf page's gate is the aggregate one — admin anywhere reaches it — so the tier that decides
  // whether these are editable is the one held on THIS node. Reading is operator; changing what a
  // daemon is permitted to do to your servers is admin.
  const live = !!hostId && sessionStore.isLive(hostId);
  const canEdit = live && sessionStore.tierOf(hostId) === "admin";

  const { state, data, error, reload } =
    useLeafResource(hostId, leafId, (h) => fetchLeafReactorStatus(h));

  // The mode lists live in the config descriptor, not on the status socket — status reports the
  // RESOLVED mode per rule, which is what a rule may do rather than which list put it there. Writing
  // one back means editing the list it came from, so both are read.
  const [config, setConfig] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState(null);

  const loadConfig = React.useCallback(() => {
    if (!hostId) return;
    fetchLeafConfig(hostId, "reactor").then(setConfig, () => setConfig(null));
  }, [hostId]);

  React.useEffect(() => { loadConfig(); }, [loadConfig]);

  // The mode lists as they currently stand, keyed by the descriptor key that holds each. A leaf whose
  // config could not be read leaves these null, which is what disables the controls: writing a list
  // back without having read it would drop every rule the page cannot see.
  const lists = React.useMemo(() => {
    if (!config || !Array.isArray(config.fields)) return null;
    const byKey = {};
    for (const f of config.fields) byKey[f.key] = f;
    const out = {};
    for (const m of MODES) {
      if (!m.key) continue;
      if (!byKey[m.key]) return null;
      out[m.key] = parseCsv(byKey[m.key].effective);
    }
    return out;
  }, [config]);


  if (state === "loading") return <LeafLoading what="Reading the reactor’s rules…" />;
  if (state === "none") return <LeafAbsent leafId={leafId} what="a reactor" />;
  if (state === "error") return <LeafUnreadable what="Reactor rules" error={error} onRetry={reload} />;

  const rules = Array.isArray(data.rules) ? data.rules : [];
  const honours = data.honours || "observe";

  // Which list a rule is actually named in — which is not the same question as what mode it runs in.
  // A rule in two lists gets the safest, and one asking for an authority this build lacks observes; the
  // control has to show where the rule IS, so that moving it out of that list is what the write does.
  const listOf = (id) => {
    if (!lists) return null;
    for (const m of MODES) {
      if (m.key && lists[m.key].some(x => x.toLowerCase() === id.toLowerCase())) return m.id;
    }
    return "off";
  };

  const setMode = (ruleId, next) => {
    if (!lists || busy) return;
    setBusy(true); setResult(null);

    // Removed from every list, then added to the one chosen. Rewriting all three rather than the two
    // that change is what clears a rule accidentally named twice — the leaf resolves that collision
    // downwards and would otherwise keep resolving it forever, invisibly.
    const values = {};
    for (const m of MODES) {
      if (!m.key) continue;
      const kept = lists[m.key].filter(x => x.toLowerCase() !== ruleId.toLowerCase());
      if (m.id === next) kept.push(ruleId);
      values[m.key] = kept.join(",");
    }

    applyLeafConfig(hostId, "reactor", { values, reset: [] }).then(
      (res) => {
        setResult(res);
        loadConfig();
        reload();
        // A restart moves the unit through activating; re-read the board so the header's chip and the
        // System tab reflect what actually came back up.
        servicesStore.refresh(hostId).catch(() => {});
      },
      (e) => setResult({
        outcome: "rolled_back",
        message: (e && (e.userMessage || e.message)) || "The change could not be applied.",
      }),
    ).finally(() => setBusy(false));
  };

  return (
    <>
      {result && (
        <LeafNotice
          title={result.outcome === "rolled_back" ? "The change was rolled back" : "Applied"}
          onRetry={result.outcome === "rolled_back" ? () => setResult(null) : undefined}
          retryLabel="Dismiss">
          {result.message
            || (result.outcome === "rolled_back"
              ? "The reactor did not come back healthy with that change, so the previous configuration "
                + "was restored."
              : "The reactor restarted with the new rule configuration. Its counters start again from "
                + "zero — that is the restart, not a quiet host.")}
        </LeafNotice>
      )}

      {rules.length === 0 && (
        <LeafNotice title="No rules are live">
          Every rule is switched off, so nothing wakes and nothing is judged. The reactor is running and
          observing events; it simply has nothing to evaluate them against.
        </LeafNotice>
      )}

      {rules.map(rule => (
        <RuleCard key={rule.id} rule={rule} honours={honours}
          current={listOf(rule.id)} canEdit={canEdit && !!lists} busy={busy}
          onMode={(next) => setMode(rule.id, next)} />
      ))}

      <BriefCard icon="lock" title="Why a rule can’t be written here"
        meta="What configuration owns, and what ships in code.">
        <LeafFacts rows={[
          ["What a rule decides", "compiled",
            "A file that could add a rule is a file that could make the host act. The set of things a "
            + "rule may do is a closed type, so the never-list — never uninstall, never delete a backup, "
            + "never rewrite instance config, never moderate a player — is enforced by the compiler "
            + "rather than by whoever writes the next rule."],
          ["Which rules are live, and their authority", "configurable",
            "What this page writes. It is the leaf’s own mode lists, edited as switches rather than as "
            + "a comma-separated string."],
          ["Settle and suppression windows", "compiled, with a basis",
            "Measured over 30 days of this host and pinned by the leaf’s tests alongside the reading "
            + "each came from. A box to type a new one in would invite replacing a measurement with a "
            + "guess that looks just as authoritative."],
          ["Sweep, host-wide suppression, ceiling", "configurable",
            "The gate’s host-wide tuning, in Settings — those apply across every rule rather than to one."],
        ]} />
      </BriefCard>
    </>
  );
}

function RuleCard({ rule, honours, current, canEdit, busy, onMode }) {
  const shape = SHAPE[rule.shape] || { label: rule.shape, note: null };
  const ceiling = RANK[honours] ?? 1;

  return (
    <BriefCard
      icon={rule.mode === "off" ? "circle-off" : "scale"}
      title={rule.id}
      count={rule.severity}
      countTone={SEVERITY_TONE[rule.severity] === "danger" ? "danger" : "neutral"}
      meta={ACTION[rule.actionName] || "This build does not describe what this rule would do."}>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {/* The control first: it is why somebody opened this tab, and reading the card below is how
            they decide what to set it to. */}
        <div>
          <div style={{ display: "flex", gap: 2, background: "var(--surface-2)", borderRadius: 6, padding: 2, width: "fit-content" }}>
            {MODES.map(m => {
              const beyond = RANK[m.id] > ceiling;
              const on = current === m.id;
              return (
                <button key={m.id}
                  disabled={!canEdit || busy || beyond || current == null}
                  onClick={() => !on && onMode(m.id)}
                  title={beyond
                    ? m.label + " is a later phase in the reactor — this build honours at most "
                      + honours + ", so a rule set to it would observe."
                    : m.note}
                  style={{
                    padding: "4px 12px", fontSize: 12, fontWeight: 600, borderRadius: 5, border: "none",
                    cursor: (!canEdit || busy || beyond || current == null) ? "not-allowed" : "pointer",
                    opacity: beyond ? 0.45 : 1,
                    background: on ? "var(--surface-3)" : "transparent",
                    color: on ? "var(--fg-1)" : "var(--fg-3)",
                  }}>
                  {m.label}
                </button>
              );
            })}
          </div>

          <div className="leaf-facts__hint" style={{ marginTop: 6 }}>
            {current == null
              ? "The reactor’s configuration couldn’t be read, so these can’t be changed from here."
              : !canEdit
                ? "Read-only — changing what a daemon may do to your servers is an admin action on this node."
                : "Applying restarts the reactor, which resets the counters on Overview."}
          </div>
        </div>

        {/* ⚠ The one state where the two disagree, spelled out. It is a warning rather than a fact row
            because somebody granted an authority and did not get it. */}
        {rule.configuredMode && (
          <div className="chat-brief__item chat-brief__item--warn">
            <span className="chat-brief__icon"><Icon name="triangle-alert" size={14} /></span>
            <div className="chat-brief__body">
              <span className="chat-brief__item-title">
                <span className="chat-brief__titletext">
                  Configured to {rule.configuredMode}, running as {rule.mode}
                </span>
              </span>
              <span className="chat-brief__detail">
                This build honours at most {honours}. The rule evaluates and records; nothing is staged
                or performed, whatever the configuration asks for.
              </span>
            </div>
          </div>
        )}

        <LeafFacts rows={[
          ["Wakes on", (rule.wakes || []).length
            ? (rule.wakes || []).join(", ")
            : "the sweep",
            shape.label + " — " + (shape.note || "")],
          ["Settles for", fmtSeconds(rule.settleSeconds),
            "How long the condition is left alone before it is judged — the window in which one that "
            + "was going to resolve itself does so."],
          ["Then stays quiet for", fmtMinutes(rule.suppressionMinutes),
            "Per subject, after it fires. Its own window where it carries one, the host-wide setting "
            + "where it does not."],
        ]} />
      </div>
    </BriefCard>
  );
}

export { ReactorRules };
