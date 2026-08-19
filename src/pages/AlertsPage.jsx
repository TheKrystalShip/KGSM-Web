import React from "react";
import { AlertCard, AlertSeverityTag } from "../components/AlertCard.jsx";
import { Icon } from "../components/Icon.jsx";
import { alertInScope } from "../components/ContextualAlerts.jsx";
import { ClusterReach, nodeFilterOptions } from "../components/host-helpers.jsx";
import { alertBuckets, useAlerts } from "../components/NeedsAttention.jsx";
import { Pagination, useDebouncedValue } from "../components/Pagination.jsx";
import { Toolbar, ToolbarCount, ToolbarFilters, ToolbarSearch, ToolbarSpacer } from "../components/Toolbar.jsx";
import { useStore } from "../lib/store.js";
import { hostsStore, serversStore } from "../lib/stores.js";

// AlertsPage — the "what's wrong right now" board (Model A, condition-mirror).

function AlertsSection({ title, subtitle, icon, items, defaultOpen, onAsk, onOpenServer, onOpenHost, onOpenAudit, onRun, now, emptyHint, footer, resetKey }) {
  const [open, setOpen] = React.useState(defaultOpen);
  // Each surface paginates independently — the resolved feed in particular can
  // grow well past one screen. 25 per page, matching every other list.
  const PAGE_SIZE = 25;
  const [page, setPage] = React.useState(0);
  React.useEffect(() => { setPage(0); }, [resetKey]);
  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageItems = items.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  return (
    <section className="alerts-section">
      <button className="alerts-section__head" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <Icon name={open ? "chevron-down" : "chevron-right"} size={15} className="alerts-section__caret" />
        <span className="alerts-section__icon"><Icon name={icon} size={14} /></span>
        <span className="alerts-section__title">{title}</span>
        {subtitle && <span className="alerts-section__subtitle">{subtitle}</span>}
        <span className="alerts-section__count">{items.length}</span>
      </button>
      {open && (items.length > 0
        ? <>
            <div className="alerts-section__list">{pageItems.map(i => <AlertCard key={i.id} item={i} onAsk={onAsk} onOpenServer={onOpenServer} onOpenHost={onOpenHost} onOpenAudit={onOpenAudit} onRun={onRun} now={now} />)}</div>
            <Pagination page={safePage} pageCount={pageCount} total={items.length} pageSize={PAGE_SIZE} onPage={setPage} unit="alerts" />
            {footer}
          </>
        : <div className="alerts-section__empty">{emptyHint}</div>)}
    </section>
  );
}

function AlertsPage({ onOpenServer, onOpenHost, onAsk, onOpenAudit, onRun, initialServerId }) {
  useAlerts();
  const hosts = useStore(hostsStore, s => s.list);
  const [query, setQuery] = React.useState("");
  const [sev, setSev] = React.useState("all");
  const [source, setSource] = React.useState("all");
  // Node is a filter over THIS board, held locally like every other filter here.
  const [node, setNode] = React.useState("all");
  // serverFilter pins the board to a single game server (set when you arrive
  // from that server's overview "View all"). Surfaced as a dismissible chip.
  const [serverFilter, setServerFilter] = React.useState(initialServerId || "all");
  // Debounce the search; both alert surfaces re-filter off the settled value.
  const dq = useDebouncedValue(query, 250);
  const searchPending = query.trim() !== dq.trim();
  const { all, firing, resolved } = alertBuckets("all");
  const nodeOptions = nodeFilterOptions(hosts);
  const now = new Date();

  // Ordering (escalated → severity → recency) now comes from alertBuckets, the
  // single source shared with the dashboard card and sidebar badge.
  const firingSorted = firing;

  const sources = React.useMemo(() => Array.from(new Set((all || []).map(a => a.source).filter(Boolean))).sort(), [all]);

  const q = dq.trim().toLowerCase();
  const match = (i) =>
    (sev === "all" || i.severity === sev) &&
    (source === "all" || i.source === source) &&
    (node === "all" || alertInScope(i, node)) &&
    (serverFilter === "all" || i.serverId === serverFilter) &&
    (!q || i.title.toLowerCase().includes(q) || i.detail.toLowerCase().includes(q));
  const ff = firingSorted.filter(match), fr = resolved.filter(match);
  const filtering = !!q || sev !== "all" || source !== "all" || node !== "all" || serverFilter !== "all";
  const shownCount = ff.length + fr.length;
  const total = firing.length + resolved.length;

  // Live counts behind each filter option, computed off the full (host-scoped)
  // alert set so the popover shows how many alerts each choice would surface.
  const sevCounts = React.useMemo(() => {
    const c = { all: (all || []).length, danger: 0, warn: 0, info: 0 };
    (all || []).forEach(a => { if (c[a.severity] != null) c[a.severity]++; });
    return c;
  }, [all]);
  const sourceCounts = React.useMemo(() => {
    const c = {};
    (all || []).forEach(a => { if (a.source) c[a.source] = (c[a.source] || 0) + 1; });
    return c;
  }, [all]);
  // Servers that actually have alerts — the only meaningful values for the
  // server filter, each with its current alert count.
  const serverOptions = React.useMemo(() => {
    const opts = [{ value: "all", label: "All servers" }];
    const seen = new Map();
    (all || []).forEach(a => { if (a.serverId) seen.set(a.serverId, (seen.get(a.serverId) || 0) + 1); });
    seen.forEach((count, id) => {
      const s = serversStore.find(id);
      opts.push({ value: id, label: (s && s.name) || id, count });
    });
    return opts;
  }, [all]);

  return (
    <>
      <div className="dash-head">
        <h1>Alerts</h1>
        <div className="dash-head__sub">
          {firing.length} firing · {resolved.length} resolved in the last 24h
          <span className="dash-head__src"> · conditions raised &amp; cleared by the server monitor</span>
        </div>
        <ClusterReach />
      </div>

      <Toolbar>
        <ToolbarSearch value={query} onChange={setQuery} pending={searchPending} placeholder="Search alerts…" />

        <ToolbarFilters
          fields={[
            { id: "sev", label: "Severity", value: sev, onChange: setSev, default: "all", options: [
              { value: "all",    label: "All",      count: sevCounts.all },
              { value: "danger", label: "Critical", count: sevCounts.danger },
              { value: "warn",   label: "Warning",  count: sevCounts.warn },
              { value: "info",   label: "Info",     count: sevCounts.info },
            ] },
            { id: "node", label: "Node", value: node, onChange: setNode, default: "all", options: nodeOptions, hidden: nodeOptions.length <= 2 },
            { id: "source", label: "Source", value: source, onChange: setSource, default: "all", options: [
              { value: "all", label: "All sources" }, ...sources.map(s => ({ value: s, label: s, count: sourceCounts[s] })),
            ] },
            { id: "server", label: "Server", value: serverFilter, onChange: setServerFilter, default: "all", options: serverOptions },
          ]}
          onReset={() => setQuery("")} />

        <ToolbarSpacer />
        <ToolbarCount shown={shownCount} total={total} unit="alerts" />
      </Toolbar>

      {total === 0 ? (
        <div className="servers-empty">
          <Icon name="party-popper" size={26} />
          <div className="servers-empty__title">All clear</div>
          <div className="servers-empty__sub">Nothing's wrong right now — the monitor has no firing conditions.</div>
        </div>
      ) : (
        <div className="alerts-sections">
          <AlertsSection
            title="Active" icon="triangle-alert" items={ff} defaultOpen now={now}
            resetKey={q + "|" + sev + "|" + source + "|" + node + "|" + serverFilter}
            onAsk={onAsk} onOpenServer={onOpenServer} onOpenHost={onOpenHost} onOpenAudit={onOpenAudit} onRun={onRun}
            emptyHint={filtering ? "No firing conditions match your filters." : "All clear — nothing needs you right now."} />
          <AlertsSection
            title="Recently resolved" subtitle="last 24h" icon="history" items={fr} defaultOpen now={now}
            resetKey={q + "|" + sev + "|" + source + "|" + node + "|" + serverFilter}
            onAsk={onAsk} onOpenServer={onOpenServer} onOpenHost={onOpenHost} onOpenAudit={onOpenAudit} onRun={onRun}
            emptyHint={filtering ? "Nothing resolved here matches your filters." : "Nothing has resolved in the last day."}
            footer={
              <button className="alerts-section__footer" onClick={() => onOpenAudit && onOpenAudit()}>
                Older than 24h? View the full history in the audit log <Icon name="arrow-up-right" size={11} strokeWidth={2.4} />
              </button>
            } />
        </div>
      )}
    </>
  );
}

// Export the card + severity tag so contextual surfaces (Diagnostics, server
// detail) render the EXACT same alert UI — one component, so lifecycle and
// styling can never diverge between the dedicated page and in-context views.

export { AlertCard, AlertSeverityTag, AlertsPage };
export default AlertsPage;
