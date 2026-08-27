import React from "react";
import { AuditEventRow } from "../components/AuditEventRow.jsx";
import { ClusterReach, nodeFilterOptions } from "../components/host-helpers.jsx";
import { Icon } from "../components/Icon.jsx";
import { Pagination, useDebouncedValue } from "../components/Pagination.jsx";
import { AuditSkeleton } from "../components/Skeletons.jsx";
import { Toolbar, ToolbarCount, ToolbarFilters, ToolbarSearch, ToolbarSpacer } from "../components/Toolbar.jsx";
import { ACTION_META, AUDIT_CATEGORIES, CATEGORY_LABEL, actionCategory, fmtRelative, fmtTime, parseTs } from "../lib/formatting.js";
import { useStore } from "../lib/store.js";
import { auditEventHost, auditStore, hostsStore, serversStore } from "../lib/stores.js";

// AuditLogPage — searchable, filterable timeline of every action taken on
// Krystal. Same data feeds the small "Recent activity" panel on the
// dashboard; this page is the canonical view with filters and search.

// Re-export from the shared module so existing consumers don't break.
export { ACTION_META, actionCategory, AUDIT_CATEGORIES, CATEGORY_LABEL, fmtRelative, fmtTime, parseTs };

function dayBucket(date, now = new Date()) {
  const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dd = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diff = Math.round((d0 - dd) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return date.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
}

// ---------- Query ----------

// The Node filter's value for events that belong to no node — the same class the
// timeline chips as "panel".
const PANEL_WIDE = "__panel";

// Apply the aggregated filter set to the event list. This is the client-side
// stand-in for the server's WHERE clause: in production the same `filters`
// object is sent as query params (GET /audit?…) and this function disappears —
// the backend returns the already-filtered, already-paginated page. `filters.
// query` arrives pre-trimmed and lower-cased so the hot path does no work.
function queryAudit(list, filters, now) {
  const rangeMs = { "1h": 3600e3, "24h": 86400e3, "7d": 7 * 86400e3, "30d": 30 * 86400e3, "all": Infinity }[filters.range];
  const cutoff = new Date(now.getTime() - rangeMs);
  const q = filters.query;
  return list.filter(ev => {
    if (parseTs(ev.ts) < cutoff) return false;
    if (filters.category !== "all" && actionCategory(ev.action) !== filters.category) return false;
    // Node matches STRICTLY. An event that belongs to no node (auth, account —
    // the rows the timeline chips "panel") is its own class, selectable on its
    // own, never quietly counted as part of whichever node you picked.
    if (filters.node !== "all") {
      const h = auditEventHost(ev);
      if (filters.node === PANEL_WIDE ? h != null : h !== filters.node) return false;
    }
    if (filters.actor    !== "all" && ev.actor.name !== filters.actor) return false;
    if (filters.server   !== "all" && ev.serverId !== filters.server) return false;
    if (filters.severity === "attention" && ev.severity !== "warn" && ev.severity !== "danger") return false;
    if (filters.severity !== "all" && filters.severity !== "attention" && ev.severity !== filters.severity) return false;
    if (q) {
      const hay = [ev.summary, ev.action, ev.actor.name, ev.origin || "", ev.target?.name || "", JSON.stringify(ev.meta || {})].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

// Map the page's filter state to the backend query params it can push down
// (architecture: the keyset cursor walks the FILTERED log, so old matching events
// stay reachable instead of sitting behind newer noise). `severity` "attention"
// (warn∨danger — the Alerts view) → "warn,danger"; the time range → an ISO `since`
// lower bound from `nowMs`; `category` → the action-group prefix; "all" → omitted.
// Free-text `query` (page search) and the host scope stay CLIENT-side (no backend
// param), so the page still discloses incompleteness for those.
const RANGE_SPAN_MS = { "1h": 3600e3, "24h": 86400e3, "7d": 7 * 86400e3, "30d": 30 * 86400e3 };
function auditServerParams({ severity, server, actor, range, category } = {}, nowMs) {
  const p = {};
  if (severity === "attention") p.severity = "warn,danger";
  else if (severity && severity !== "all") p.severity = severity;
  if (server && server !== "all") p.serverId = server;
  if (actor && actor !== "all") p.actor = actor;
  if (category && category !== "all") p.category = category;
  const span = RANGE_SPAN_MS[range];
  if (span && nowMs) p.since = new Date(nowMs - span).toISOString();
  return p;
}

// ---------- Components ----------

// "Load older events" — shown only when the keyset cursor has rows older than
// the loaded window (auditStore.nextCursor != null). It discloses that the loaded
// window is partial — so the client-side search/filters below never look exhaustive
// when they aren't — and pulls the next page. A fully-walked log has a null
// cursor, so this never renders there.
function LoadOlder({ count, loadingMore }) {
  return (
    <div className="audit-loadmore">
      <div className="audit-loadmore__note">
        <Icon name="history" size={13} strokeWidth={2} />
        The {count} most recent events are loaded — search and filters apply only to these. Older events exist but aren’t loaded yet.
      </div>
      <button className="toolbar-btn" onClick={() => auditStore.loadMore()} disabled={loadingMore}>
        <Icon name="loader-2" size={14} className={loadingMore ? "is-spinning" : undefined}
          style={loadingMore ? undefined : { display: "none" }} />
        <Icon name="arrow-down" size={14} style={loadingMore ? { display: "none" } : undefined} />
        {loadingMore ? "Loading…" : "Load older events"}
      </button>
    </div>
  );
}

function AuditLogPage({ initialSeverity, initialServer }) {
  const all = useStore(auditStore, s => s.list);
  const dataLoading = useStore(auditStore, s => s.status === "loading" && !s.everLoaded);
  // Keyset paging: a non-null cursor means older events exist beyond the loaded
  // window. That makes the load "incomplete" — so the per-option counts below
  // would be undercounts (we omit them) and the search/filters cover only the
  // loaded window (we disclose that). A fully-walked log → cursor null.
  const incomplete = useStore(auditStore, s => !!s.nextCursor);
  const loadingMore = useStore(auditStore, s => s.loadingMore);
  const allServers = useStore(serversStore, s => s.list);
  const hosts = useStore(hostsStore, s => s.list);
  // The whole cluster's log. The Node field in the toolbar narrows the rows
  // below, and nothing outside this page.
  const scoped = all;
  const servers = allServers;
  const nodeOptions = nodeFilterOptions(hosts);
  const actorOpts = React.useMemo(() => {
    const set = new Set(scoped.map(e => e.actor.name));
    return ["all", ...Array.from(set)];
  }, [scoped]);

  const [query, setQuery]     = React.useState("");
  const [category, setCat]    = React.useState("all");
  const [actor, setActor]     = React.useState("all");
  const [server, setServer]   = React.useState(initialServer || "all");
  const [range, setRange]     = React.useState("all");
  // Node is a filter over THIS log, held locally like every other filter here.
  // It stays CLIENT-side (no backend param), same as free-text search.
  const [node, setNode]       = React.useState("all");
  // "attention" = warn + danger (what the Alerts button pre-selects).
  const [severity, setSeverity] = React.useState(initialSeverity || "all");

  // Push the structured filters to the backend so the keyset cursor walks the
  // FILTERED log — otherwise an old crash / backup / actor event sits unreachable
  // behind newer noise. Re-query whenever a pushed filter changes; free-text
  // search stays client-side over the loaded window.
  const serverParams = React.useMemo(
    () => auditServerParams({ severity, server, actor, range, category }, Date.now()),
    [severity, server, actor, range, category]
  );
  const serverKey = serverParams ? JSON.stringify(serverParams) : "";
  React.useEffect(() => {
    auditStore.refresh(serverParams).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverKey]);

  // The "now" anchor: real wall-clock — relative times are vs now, and it matches
  // the server's `since` (also real-now-relative). Recomputed when the loaded set
  // changes so streamed-in events keep fresh relative times.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- [scoped] is a deliberate recompute trigger so relative times refresh as the audit set grows; now intentionally doesn't read it
  const now = React.useMemo(() => new Date(), [scoped]);

  // Debounce the free-text search so we don't re-query on every keystroke. The
  // dropdowns and range tabs apply instantly; only typing waits out a 250ms
  // quiet window. `searchPending` lets the input show that it's settling.
  const debouncedQuery = useDebouncedValue(query, 250);
  const searchPending = query.trim() !== debouncedQuery.trim();

  // The single aggregated filter set — this object IS the request. In
  // production it serializes straight to the query string:
  //   GET /audit?cursor=&limit=25&q=&category=&actor=&serverId=&severity=&range=
  // Memoizing it on its inputs means "the query changed" is one identity check.
  const filters = React.useMemo(() => ({
    query: debouncedQuery.trim().toLowerCase(),
    category, actor, server, severity, range, node,
  }), [debouncedQuery, category, actor, server, severity, range, node]);

  // Run the aggregated query (client-side stand-in for the server WHERE clause).
  const filtered = React.useMemo(
    () => queryAudit(scoped, filters, now),
    [scoped, filters, now]
  );

  // ---- Pagination (25 / page) -------------------------------------------
  // The log grows without bound over time, so we never render it whole. The
  // backend pages with a keyset cursor (architecture §3·d); here we slice the
  // filtered list into 25-row pages.
  const PAGE_SIZE = 25;
  const [page, setPage] = React.useState(0);
  // Any change to the aggregated filters (including the debounced search) is a
  // fresh query — snap back to the first page so you're not stranded on page 7
  // of a result set that no longer has 7 pages.
  React.useEffect(() => { setPage(0); }, [filters]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageItems = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  // Group the CURRENT PAGE by day for the timeline. Insertion order matters
  // since the log is already sorted newest-first.
  const grouped = [];
  for (const ev of pageItems) {
    const bucket = dayBucket(parseTs(ev.ts), now);
    const last = grouped[grouped.length - 1];
    if (last && last.bucket === bucket) last.events.push(ev);
    else grouped.push({ bucket, events: [ev] });
  }

  const categories = ["all", ...AUDIT_CATEGORIES];

  // Per-option counts behind each filter dimension, computed off the host-scoped
  // event set so the popover shows how many events each choice would surface.
  const auditCounts = React.useMemo(() => {
    const by = (keyFn) => { const c = {}; scoped.forEach(ev => { const k = keyFn(ev); if (k != null) c[k] = (c[k] || 0) + 1; }); return c; };
    const sev = by(ev => ev.severity);
    return {
      total: scoped.length,
      category: by(ev => ev.category),
      actor: by(ev => ev.actor.name),
      server: by(ev => ev.serverId),
      severity: { ...sev, attention: (sev.warn || 0) + (sev.danger || 0) },
    };
  }, [scoped]);

  // The loaded set is server-FILTERED (and possibly partial), so a per-option
  // count would be relative to the current filter, not an absolute total over the
  // log — and there's no aggregation endpoint to source honest totals. So omit
  // counts entirely (never-fabricate); the chips render label-only when undefined.
  const cnt = () => undefined;

  return (
    <>
      <div className="dash-head">
        <h1>Audit log</h1>
        <div className="dash-head__sub">Every action on Krystal — by you, your crew, or our automation. Search, filter, export.</div>
        <ClusterReach />
      </div>

      {dataLoading ? <AuditSkeleton /> : (<>
      <Toolbar>
        <ToolbarSearch value={query} onChange={setQuery} pending={searchPending} placeholder="Search actions, players, files…" />

        <ToolbarFilters
          fields={[
            { id: "category", label: "Category", value: category, onChange: setCat, default: "all",
              options: categories.map(c => ({ value: c, label: c === "all" ? "All categories" : (CATEGORY_LABEL[c] || c), count: cnt(c === "all" ? auditCounts.total : auditCounts.category[c]) })) },
            { id: "node", label: "Node", value: node, onChange: setNode, default: "all",
              options: [...nodeOptions, { value: PANEL_WIDE, label: "Panel-wide" }], hidden: nodeOptions.length <= 2 },
            { id: "actor", label: "User", value: actor, onChange: setActor, default: "all",
              options: actorOpts.map(a => ({ value: a, label: a === "all" ? "All users" : a, count: a === "all" ? undefined : cnt(auditCounts.actor[a]) })) },
            { id: "severity", label: "Severity", value: severity, onChange: setSeverity, default: "all", options: [
              { value: "all",       label: "All severities", count: cnt(auditCounts.total) },
              { value: "attention", label: "Alerts",         count: cnt(auditCounts.severity.attention) },
              { value: "danger",    label: "Danger",         count: cnt(auditCounts.severity.danger) },
              { value: "warn",      label: "Warning",        count: cnt(auditCounts.severity.warn) },
              { value: "info",      label: "Info",           count: cnt(auditCounts.severity.info) },
              { value: "success",   label: "Success",        count: cnt(auditCounts.severity.success) },
            ] },
            { id: "server", label: "Server", value: server, onChange: setServer, default: "all",
              options: [{ value: "all", label: "All servers" }, ...servers.map(s => ({ value: s.id, label: s.name, count: cnt(auditCounts.server[s.id]) }))] },
            { id: "range", label: "Time range", value: range, onChange: setRange, default: "all", options: [
              { value: "1h",  label: "Last hour" },
              { value: "24h", label: "Last 24 hours" },
              { value: "7d",  label: "Last 7 days" },
              { value: "30d", label: "Last 30 days" },
              { value: "all", label: "All time" },
            ] },
          ]}
          onReset={() => setQuery("")} />

        <ToolbarSpacer />
        <ToolbarCount shown={filtered.length} total={scoped.length} unit="events" />
      </Toolbar>

      {grouped.length === 0 && (
        <div style={{
          background: "var(--surface-1)", border: "1px solid var(--border-subtle)",
          borderRadius: "var(--r-sm)", padding: 48, textAlign: "center", color: "var(--fg-3)",
        }}>
          <Icon name="search-x" size={26} />
          <div style={{ marginTop: 10, color: "var(--fg-2)", fontWeight: 600, fontSize: 14 }}>No events match these filters</div>
          <div style={{ marginTop: 4, fontSize: 13 }}>
            {incomplete
              ? "Try widening the time range or clearing the search — older events aren’t loaded yet and aren’t searched (load them below)."
              : "Try widening the time range or clearing the search."}
          </div>
        </div>
      )}

      <div className="audit-timeline">
        {grouped.map(group => (
          <section key={group.bucket} className="audit-group">
            <h3 className="audit-group__title">
              <span>{group.bucket}</span>
              <span className="audit-group__count">{group.events.length}</span>
            </h3>
            <div className="audit-group__events">
              {group.events.map(ev => (
                <AuditEventRow key={ev.id} ev={ev} now={now} hosts={hosts} resolveHost={auditEventHost} />
              ))}
            </div>
          </section>
        ))}
      </div>

      <Pagination
        page={safePage}
        pageCount={pageCount}
        total={filtered.length}
        pageSize={PAGE_SIZE}
        onPage={setPage}
        unit="events"
      />

      {incomplete && <LoadOlder count={scoped.length} loadingMore={loadingMore} />}
      </>)}
    </>
  );
}

export { AuditLogPage, auditServerParams };
export default AuditLogPage;
