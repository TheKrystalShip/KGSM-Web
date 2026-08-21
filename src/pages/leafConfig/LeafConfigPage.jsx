// LeafConfigPage — the per-node leaf configuration surface: every setting every leaf on this host
// declares, with where its value comes from, what changing it risks, and one apply that batches
// every edit into a single restart.
//
// It is its own page rather than a node sub-tab because it carries its own leaf tab strip, and
// nesting that under the node page's tabs would stack two tab rows.
//
// Admin-only, end to end: kgsm-api's leaf controller is Admin-policy, so `persona.ROUTE_CAP`
// gates the route on `host.manage` and an operator never reaches it.

import React from "react";
import { BriefCard } from "../../components/BriefCard.jsx";
import { ConsoleView } from "../../components/ConsoleView.jsx";
import { Icon } from "../../components/Icon.jsx";
import { copyText } from "../../lib/clipboard.js";
import { SubTabs } from "../../components/SubTabs.jsx";
import {
  Toolbar, ToolbarButton, ToolbarCount, ToolbarFilters, ToolbarSearch, ToolbarSpacer,
} from "../../components/Toolbar.jsx";
import { useStore } from "../../lib/store.js";
import {
  applyLeafConfig, fetchLeafConfig, hostsStore, logSourcesStore, logsStore,
  servicesStore, subscribeHostLogs, subscribeHostServices,
} from "../../lib/stores.js";
import { fmtBytes, uptimeShort } from "../../lib/formatting.js";
import { leafIcon, leafStatus } from "../../lib/leaves.js";
import { LeafConfigRow } from "./LeafConfigRow.jsx";
import { LeafConfigReview } from "./LeafConfigReview.jsx";
import {
  buildPayload, dirtyFields, filterFields, groupFields, isDirty, isOverridden,
} from "./leafConfigHelpers.js";

const FILTER_LABEL = { all: "All", modified: "Modified", risky: "Risky", unknown: "Unknown" };

// The apply outcomes, rendered honestly. A rollback is not a success and `applied_unreachable` is
// not a failure — the change IS live, the panel just cannot see the leaf any more.
const OUTCOME = {
  applied: { tone: "ok", icon: "circle-check", title: "Applied" },
  unchanged: { tone: "info", icon: "info", title: "Nothing to apply" },
  rolled_back: { tone: "warn", icon: "triangle-alert", title: "Rolled back" },
  applied_unreachable: { tone: "warn", icon: "triangle-alert", title: "Applied — but unreachable" },
};

// `embedded` renders the configuration BODY only — no page title, no back button, no leaf tab strip.
// It is what the per-leaf page's Settings tab mounts: that page already names the host and the leaf
// and carries its own tabs, so repeating them here would stack two tab rows and two titles. Every
// other behaviour (search, filters, grouped rows, review, apply, the logs panel) is shared verbatim,
// which is the point of embedding rather than reimplementing.
function LeafConfigPage({ hostId, leafId, onSelectLeaf, onBackToHost, embedded = false }) {
  const hosts = useStore(hostsStore, s => s.list);
  const svcEntry = useStore(servicesStore, s => (hostId ? s.byHost[hostId] : null));
  const services = (svcEntry && svcEntry.list) || [];
  const servicesFor = svcEntry ? hostId : null;
  const servicesStatus = svcEntry ? svcEntry.status : "loading";
  const logsEntry = useStore(logsStore, s => (hostId ? s.byHost[hostId] : null));
  const logLines = (logsEntry && logsEntry.list) || [];
  const sourcesEntry = useStore(logSourcesStore, s => (hostId ? s.byHost[hostId] : null));
  const logSources = (sourcesEntry && sourcesEntry.sources) || [];

  const [config, setConfig] = React.useState(null);
  const [loadState, setLoadState] = React.useState("loading");
  const [loadErr, setLoadErr] = React.useState(null);
  const [drafts, setDrafts] = React.useState({});
  const [resets, setResets] = React.useState(() => new Set());
  const [shut, setShut] = React.useState(() => new Set());
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState("all");
  const [reviewing, setReviewing] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState(null);
  const [copyState, setCopyState] = React.useState(null); // { key, ok } | null
  const [showLogs, setShowLogs] = React.useState(false);

  const host = hosts.find(h => h.id === hostId) || null;
  const rows = servicesFor === hostId && Array.isArray(services) ? services : [];
  // Only leaves that actually publish a config surface; the API is the authority on which those
  // are, so this never carries a list of leaf ids.
  const configurable = rows.filter(r => r.id);
  // A leafless URL (#/config/<host>) opens the first leaf, and a leaf this host doesn't serve
  // falls back to it too. Deliberately WITHOUT rewriting the URL: normalising it here would push
  // a history entry that Back immediately re-normalises, trapping the back button.
  const active = configurable.find(r => r.id === leafId) || configurable[0] || null;
  const activeId = active ? active.id : null;

  React.useEffect(() => {
    if (!hostId) return undefined;
    servicesStore.refresh(hostId).catch(() => {});
    return subscribeHostServices(hostId);
  }, [hostId]);

  const hydrate = React.useCallback((cfg) => {
    setConfig(cfg);
    setDrafts({});
    setResets(new Set());
  }, []);

  React.useEffect(() => {
    if (!hostId || !activeId) return undefined;
    let cancelled = false;
    setLoadState("loading"); setLoadErr(null); setResult(null); setQuery(""); setFilter("all");
    setShut(new Set()); setShowLogs(false);
    fetchLeafConfig(hostId, activeId).then(
      (cfg) => {
        if (cancelled) return;
        if (cfg) { hydrate(cfg); setLoadState("ready"); } else { setLoadState("error"); }
      },
      (e) => { if (!cancelled) { setLoadErr(e); setLoadState(e && e.status === 404 ? "none" : "error"); } },
    );
    return () => { cancelled = true; };
  }, [hostId, activeId, hydrate]);

  React.useEffect(() => {
    if (!showLogs || !hostId) return undefined;
    logsStore.refresh(hostId).catch(() => {});
    logSourcesStore.refresh(hostId).catch(() => {});
    return subscribeHostLogs(hostId);
  }, [showLogs, hostId]);

  const fields = (config && config.fields) || [];
  const editable = !!(config && config.editable);
  const staged = dirtyFields(fields, drafts, resets);

  const setField = React.useCallback((key, val) => {
    setDrafts(d => {
      const next = { ...d };
      if (val === undefined) delete next[key]; else next[key] = val;
      return next;
    });
  }, []);

  // Reset and edit are mutually exclusive on one key: staging a reset clears any draft, so the
  // payload can never carry both for the same field.
  const toggleReset = React.useCallback((key) => {
    setResets(s => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key); else { n.add(key); setField(key, undefined); }
      return n;
    });
  }, [setField]);

  // Reports the outcome, never the intent: a refused clipboard is worth knowing
  // about here, since the whole point of the button is to paste the line into a
  // unit file or a shell.
  const copyEnv = (f) => {
    const line = f.envName + "=" + (f.effective == null ? "" : f.effective);
    copyText(line).then(ok => {
      setCopyState({ key: f.key, ok });
      setTimeout(() => setCopyState(c => (c && c.key === f.key ? null : c)), ok ? 1200 : 2600);
    });
  };

  const discard = () => { setDrafts({}); setResets(new Set()); };

  const apply = () => {
    if (busy || !config || !staged.length) return;
    setBusy(true); setResult(null);
    applyLeafConfig(hostId, activeId, buildPayload(fields, drafts, resets)).then(
      (res) => {
        setResult(res);
        if (res && res.config) hydrate(res.config);
        else { setDrafts({}); setResets(new Set()); }
        // A wiring change can move what the panel reaches; re-read the board so its liveness and
        // capability state reflect what actually came back up.
        servicesStore.refresh(hostId).catch(() => {});
      },
      (e) => setResult({
        outcome: "rolled_back", health: null, config: null,
        message: (e && (e.userMessage || e.message)) || "The change could not be applied.",
      }),
    ).finally(() => { setBusy(false); setReviewing(false); });
  };

  // ---- Leaf strip ---------------------------------------------------------
  // The site's own in-page switcher, configured exactly as every other tab strip is: an icon and
  // a label. Only the open leaf carries a staged count — the others' configs aren't loaded, and a
  // badge guessed from nothing would be a fabricated number.
  const tabs = configurable.map(svc => ({
    id: svc.id,
    label: svc.displayName || svc.id,
    icon: leafIcon(svc.id),
    title: svc.role || undefined,
    badge: svc.id === activeId ? staged.length : 0,
    badgeTone: "info",
  }));

  if (!hostId || (!configurable.length && servicesStatus !== "loading")) {
    return (
      <div className="proc-unavailable">
        <span className="proc-unavailable__icon"><Icon name="sliders-horizontal" size={26} strokeWidth={1.9} /></span>
        <div className="proc-unavailable__title">
          {servicesStatus === "error" ? "Host services unavailable" : "Nothing configurable here"}
        </div>
        <div className="proc-unavailable__sub">
          {servicesStatus === "error"
            ? "Couldn’t read this host’s leaf services, so there is nothing to configure yet."
            : "This host reports no KGSM leaf services."}
        </div>
      </div>
    );
  }

  const st = active ? leafStatus(active) : null;
  const up = active && active.since ? uptimeShort(active.since) : null;
  const mem = active ? fmtBytes(active.memoryBytes) : null;
  const overridden = fields.filter(isOverridden).length;

  const visible = filterFields(fields, { query, filter, drafts, resets });
  const groups = groupFields(config, visible);
  const allShut = groups.length > 0 && groups.every(g => shut.has(g.id));

  const counts = {
    all: fields.length,
    modified: fields.filter(f => isDirty(f, drafts, resets) || isOverridden(f)).length,
    risky: fields.filter(f => f.risk !== "safe").length,
    unknown: fields.filter(f => f.source === "unknown").length,
  };

  return (
    <>
      {!embedded && (
        <div className="lcf-head">
          <button className="lcf-back" onClick={onBackToHost}>
            <Icon name="arrow-left" size={14} /> {host ? (host.name || host.id) : "Host"}
          </button>
          <h1 className="lcf-head__title">Leaf configuration</h1>
          <p className="lcf-head__sub">
            Every setting each leaf on this host declares. Changes are layered on top of the leaf’s own
            config and applied by restarting it — the leaf’s shipped files are never edited.
          </p>
        </div>
      )}

      {!embedded && tabs.length > 0 && (
        <SubTabs tabs={tabs} active={activeId} onChange={(id) => onSelectLeaf(id)} />
      )}

      {/* Embedded, this is the leaf page's Settings tab: that page's header already names the leaf and
          its System tab owns the unit's state, uptime and memory — so this block would be the same row
          again, one tab away from where it belongs. Standalone, it is the only thing naming which leaf
          the settings below belong to. */}
      {active && !embedded && (
        <div className="lcf-leaf">
          <div className="lcf-leaf__icon"><Icon name={leafIcon(activeId)} size={18} /></div>
          <div className="lcf-leaf__id">
            <div className="lcf-leaf__name">
              {active.displayName}
              <span className={"svc-dot svc-dot--" + st.tone}></span>
              <span className="lcf-leaf__state">{st.label}{st.note ? " · " + st.note : ""}</span>
              {config && !editable && (
                <span className="lcf-risk lcf-risk--wiring"><Icon name="lock" size={10} /> read-only</span>
              )}
            </div>
            <div className="lcf-leaf__meta">
              <span><Icon name="box" size={12} /> <code>{active.unit}</code></span>
              {up && <span><Icon name="clock" size={12} /> up {up}</span>}
              {mem && <span><Icon name="memory-stick" size={12} /> {mem}</span>}
              {config && <span><Icon name="sliders-horizontal" size={12} /> {fields.length} settings</span>}
              {overridden > 0 && (
                <span className="lcf-leaf__ovr"><Icon name="pencil" size={12} /> {overridden} overridden</span>
              )}
            </div>
          </div>
          <div className="lcf-leaf__acts">
            <button className={"lcf-btn lcf-btn--ghost" + (showLogs ? " is-on" : "")}
              onClick={() => setShowLogs(v => !v)}>
              <Icon name="scroll-text" size={13} /> Logs
            </button>
            {/* Restarting a leaf on its own has no endpoint yet — it arrives with leaf lifecycle
                actions. Shown disabled rather than hidden so the affordance's place is settled,
                and never wired to an empty PUT, which returns `unchanged` and restarts nothing. */}
            <button className="lcf-btn lcf-btn--ghost" disabled
              title="Restarting a leaf on its own isn’t available yet — applying a change restarts it.">
              <Icon name="refresh-cw" size={13} /> Restart
            </button>
          </div>
        </div>
      )}

      {showLogs && (
        <ConsoleView
          title={(active ? active.displayName : "Leaf") + " · journal"}
          icon="scroll-text"
          initialSourceId={activeId}
          resetKey={activeId}
          sources={(logSources || []).map(s => ({
            id: s.id,
            label: s.label || s.id,
            lines: (logLines || []).filter(e => e.source === s.id).slice().reverse(),
          }))}
          pill={{ label: "Live", live: true }} />
      )}

      {result && (
        <div className={"lcf-note lcf-note--" + (OUTCOME[result.outcome] || OUTCOME.unchanged).tone}>
          <Icon name={(OUTCOME[result.outcome] || OUTCOME.unchanged).icon} size={15} />
          <span>
            <b>{(OUTCOME[result.outcome] || OUTCOME.unchanged).title}.</b>{" "}
            {result.message
              || (result.outcome === "applied" ? "The leaf restarted and reports healthy." : "")}
            {result.health && result.health.message && result.health.message !== result.message
              ? " " + result.health.message : ""}
          </span>
          <button className="lcf-iconbtn" onClick={() => setResult(null)} aria-label="Dismiss">
            <Icon name="x" size={13} />
          </button>
        </div>
      )}

      {loadState === "loading" && (
        <div className="lcf-state"><Icon name="loader" size={20} className="act-spin" />
          <span>Reading {active ? active.displayName : "leaf"} configuration…</span></div>
      )}

      {loadState === "none" && (
        <div className="lcf-state"><Icon name="info" size={20} />
          <span>{active ? active.displayName : "This leaf"} doesn’t publish a configuration surface on this host.</span></div>
      )}

      {loadState === "error" && (
        <div className="lcf-state lcf-state--error"><Icon name="triangle-alert" size={20} />
          <span>
            Couldn’t read this leaf’s configuration
            {loadErr && (loadErr.userMessage || loadErr.message) ? " — " + (loadErr.userMessage || loadErr.message) : "."}
          </span></div>
      )}

      {loadState === "ready" && config && !editable && (
        <div className="lcf-note lcf-note--lock">
          <Icon name="lock" size={15} />
          <span><b>Read-only.</b> {config.editableReason}</span>
        </div>
      )}

      {loadState === "ready" && config && !config.fromDescriptor && (
        <div className="lcf-note lcf-note--info">
          <Icon name="info" size={15} />
          <span>
            This leaf hasn’t shipped a configuration descriptor, so only the settings this API
            already knew about are listed — it is not necessarily the leaf’s whole surface.
          </span>
        </div>
      )}

      {loadState === "ready" && fields.length > 0 && (
        <>
          <Toolbar className="lcf-toolbar">
            <ToolbarSearch value={query} onChange={setQuery}
              placeholder={"Search " + fields.length + " settings, keys or descriptions…"} />
            <ToolbarFilters fields={[{
              id: "show", label: "Show", value: filter, onChange: setFilter, default: "all",
              options: Object.keys(FILTER_LABEL)
                .filter(k => k === "all" || counts[k] > 0)
                .map(k => ({ value: k, label: FILTER_LABEL[k], count: counts[k] })),
            }]} />
            <ToolbarSpacer />
            <ToolbarCount shown={visible.length} total={fields.length} unit="settings" />
            {groups.length > 1 && (
              <ToolbarButton icon={allShut ? "plus" : "minus"}
                onClick={() => setShut(allShut ? new Set() : new Set(groups.map(g => g.id)))}>
                {allShut ? "Expand all" : "Collapse all"}
              </ToolbarButton>
            )}
          </Toolbar>

          {groups.length === 0 ? (
            <div className="lcf-state">
              <Icon name="search" size={20} />
              <span>No setting matches {query ? <b>{query}</b> : "this filter"}.</span>
            </div>
          ) : (
            <div className="lcf-groups">
              {groups.map(g => {
                const edited = g.fields.filter(f => isDirty(f, drafts, resets)).length;
                return (
                  <BriefCard key={g.id} icon="layers" title={g.label} count={g.fields.length}
                    countTone="neutral" collapsible open={!shut.has(g.id)}
                    className={"lcf-group" + (edited ? " has-edits" : "")}
                    onToggle={() => setShut(s => {
                      const n = new Set(s);
                      if (n.has(g.id)) n.delete(g.id); else n.add(g.id);
                      return n;
                    })}
                    action={edited ? <span className="lcf-group__edits">{edited} edited</span> : null}>
                    <div className="lcf-group__body">
                      {g.fields.map(f => (
                        <LeafConfigRow key={f.key} f={f} editable={editable}
                          drafts={drafts} resets={resets}
                          onChange={setField} onToggleReset={toggleReset}
                          onCopy={copyEnv} copyState={copyState} />
                      ))}
                    </div>
                  </BriefCard>
                );
              })}
            </div>
          )}
        </>
      )}

      {loadState === "ready" && fields.length === 0 && (
        <div className="lcf-state"><Icon name="info" size={20} />
          <span>This leaf declares no configurable settings.</span></div>
      )}

      {staged.length > 0 && (
        <div className="lcf-bar">
          <span className="lcf-bar__n"><b>{staged.length}</b> pending change{staged.length === 1 ? "" : "s"}</span>
          <span className="lcf-bar__sum">
            {staged.map(f => f.label).join(" · ")}
          </span>
          <button className="lcf-btn lcf-btn--ghost" onClick={discard}>Discard</button>
          <button className="lcf-btn lcf-btn--primary" onClick={() => setReviewing(true)}>
            <Icon name="check" size={13} strokeWidth={2.4} /> Review &amp; apply · one restart
          </button>
        </div>
      )}

      {reviewing && config && (
        <LeafConfigReview config={config} staged={staged} drafts={drafts} resets={resets} busy={busy}
          onCancel={() => setReviewing(false)} onApply={apply} />
      )}
    </>
  );
}

export default LeafConfigPage;
export { LeafConfigPage };
