// DiagServices — the Services sub-tab: KGSM leaf control center.

import { Icon } from "../../components/Icon.jsx";
import { Toolbar, ToolbarCount, ToolbarFilters, ToolbarSearch, ToolbarSpacer, useFilters } from "../../components/Toolbar.jsx";
import { useStore } from "../../lib/store.js";
import { leafStatus } from "../../lib/leaves.js";
import { canOn } from "../../lib/persona.js";
import { PinButton } from "../../components/widgets/PinButton.jsx";
import { useKeyedResource } from "../../lib/keyedResource.js";
import { servicesStore, subscribeHostServices } from "../../lib/stores.js";
import { LeafCard } from "../../components/LeafCard.jsx";

// The two axes the cards show are the two axes you filter on. State folds the run-state tones
// the cards already render, so a leaf failing its health probe and a leaf whose unit failed sit
// together under Attention — that is the same question being asked of both. Link is the API↔leaf
// connection, where "not provisionable" is its own answer and not a kind of disconnected.
const STATE_BUCKET = { up: "running", warn: "attention", down: "attention", idle: "idle", off: "stopped" };
const stateBucket = (svc) => STATE_BUCKET[leafStatus(svc).tone] || "stopped";
const linkBucket = (svc) => svc.provisioned == null ? "na" : svc.provisioned ? "yes" : "no";

function matchesQuery(svc, q) {
  if (!q) return true;
  return [svc.displayName, svc.id, svc.unit, svc.role].some(v => v && String(v).toLowerCase().includes(q));
}

function DiagServices({ host, onOpenLeaf }) {
  const hostId = host && host.id;
  const entry = useStore(servicesStore, s => (hostId ? s.byHost[hostId] : null));
  const status = entry ? entry.status : "loading";
  const canManage = hostId ? canOn("host.manage", hostId) : false;
  const f = useFilters({ search: "", state: "all", link: "all" });

  useKeyedResource(
    hostId ? "host-services/" + hostId : null,
    () => servicesStore.refresh(hostId).catch(() => {}),
    () => subscribeHostServices(hostId));

  const ready = !!entry;
  const rows = ready && Array.isArray(entry.list) ? entry.list : [];

  if (rows.length > 0) {
    const q = f.debouncedQuery.trim().toLowerCase();
    const shown = rows.filter(svc =>
      matchesQuery(svc, q)
      && (f.values.state === "all" || stateBucket(svc) === f.values.state)
      && (f.values.link === "all" || linkBucket(svc) === f.values.link));
    const tally = (bucket, value) => rows.filter(r => bucket(r) === value).length;
    const running = tally(stateBucket, "running");
    const missing = rows.filter(r => r.state === "not-installed").length;
    return (
      <>
        <Toolbar>
          <ToolbarSearch
            value={f.query}
            onChange={f.setQuery}
            pending={f.searchPending}
            placeholder="Search by name, unit or role…" />
          <ToolbarFilters
            fields={[
              {
                id: "state", label: "State", value: f.values.state, default: "all",
                onChange: (v) => f.set("state", v),
                options: [
                  { value: "all",       label: "All",       count: rows.length },
                  { value: "running",   label: "Running",   count: running },
                  { value: "attention", label: "Attention", count: tally(stateBucket, "attention") },
                  { value: "idle",      label: "Idle",      count: tally(stateBucket, "idle") },
                  { value: "stopped",   label: "Stopped",   count: tally(stateBucket, "stopped") },
                ],
              },
              {
                id: "link", label: "Link", value: f.values.link, default: "all",
                onChange: (v) => f.set("link", v),
                options: [
                  { value: "all", label: "All",               count: rows.length },
                  { value: "yes", label: "Connected",         count: tally(linkBucket, "yes") },
                  { value: "no",  label: "Disconnected",      count: tally(linkBucket, "no") },
                  { value: "na",  label: "Not provisionable", count: tally(linkBucket, "na") },
                ],
              },
            ]}
            onReset={f.reset} />
          <ToolbarSpacer />
          <ToolbarCount>
            <b>{shown.length}</b> of {rows.length} leaves · <b>{running}</b> running
            {missing > 0 && <> · {missing} not installed</>}
          </ToolbarCount>
          {/* Toolbar routes anything it doesn't recognise to its trailing slot, so the pin sits at
              the end of the row — this board has no card header to carry one. */}
          <PinButton type="host.services" params={{ hostId }} label="this node's services" />
        </Toolbar>

        {shown.length === 0 ? (
          <div className="proc-unavailable">
            <span className="proc-unavailable__icon"><Icon name="search-x" size={26} strokeWidth={1.9} /></span>
            <div className="proc-unavailable__title">No leaves match</div>
            <div className="proc-unavailable__sub">
              This host runs {rows.length} KGSM {rows.length === 1 ? "leaf" : "leaves"}, and none of them match the
              current search and filters.
            </div>
            <button className="svc-cfg-btn" onClick={f.reset}>
              <Icon name="rotate-ccw" size={12} /> Clear filters
            </button>
          </div>
        ) : (
          <div className="svc-grid">
            {shown.map(svc => (
              <LeafCard key={svc.id} svc={svc} hostId={hostId} canManage={canManage}
                onOpen={() => onOpenLeaf && onOpenLeaf(svc.id)}
                onConfigure={() => onOpenLeaf && onOpenLeaf(svc.id, "settings")} />
            ))}
          </div>
        )}
      </>
    );
  }

  const phase = (status === "loading" || !ready) ? "loading" : status === "error" ? "error" : "quiet";
  return (
    <div className="proc-unavailable">
      <span className="proc-unavailable__icon"><Icon name="server-cog" size={26} strokeWidth={1.9} /></span>
      <div className="proc-unavailable__title">
        {phase === "loading" ? "Reading host services…" : phase === "error" ? "Host services unavailable" : "No services reported"}
      </div>
      <div className="proc-unavailable__sub">
        {phase === "loading"
          ? "Reading the state of this host’s KGSM leaf services (watchdog · monitor · assistant · firewall · api · bot)."
          : phase === "error"
            ? "Couldn’t read the host’s service state — the backend didn’t respond."
            : "This host reports no KGSM leaf services."}
      </div>
      <span className="proc-unavailable__tag">
        <Icon name="activity" size={12} /> {phase === "loading" ? "loading" : phase === "error" ? "unavailable" : "none"}
      </span>
    </div>
  );
}

export { DiagServices };
