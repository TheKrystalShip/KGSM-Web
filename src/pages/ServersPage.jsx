import React from "react";
import { SurfaceError } from "../components/ErrorBoundary.jsx";
import { ClusterReach, nodeFilterOptions } from "../components/host-helpers.jsx";
import { Icon } from "../components/Icon.jsx";
import { Pagination, useDebouncedValue } from "../components/Pagination.jsx";
import { SelectionBar } from "../components/batch/SelectionBar.jsx";
import { ServerTile } from "../components/ServerCard.jsx";
import { ServersSkeleton, Skel } from "../components/Skeletons.jsx";
import { Toolbar, ToolbarButton, ToolbarCount, ToolbarFilters, ToolbarSearch, ToolbarSort, ToolbarSpacer } from "../components/Toolbar.jsx";
import { serverCapUsable } from "../lib/capabilities.js";
import { can } from "../lib/persona.js";
import { playerTally } from "../lib/servers.js";
import { sortByAccessor } from "../lib/sorting.js";
import { useStore } from "../lib/store.js";
import { favoritesStore, hostsStore, selectionStore, serversStore, useSelectionIds } from "../lib/stores.js";

// ServersPage — the dedicated home for every installed game server.
//
// The dashboard shows only what's live right now; this is the full inventory,
// with text search and status filtering. Reuses the same ServerTile cards so
// management is identical to the dashboard grid.

// effectiveStatus — the status a tile actually shows. A watchdog-down server
// reads "unknown" (its true state can't be confirmed) no matter its last-known
// status, so grouping and sorting line up with the pill drawn on the card.
function effectiveStatus(s) {
  if (!serverCapUsable(s, "watchdog")) return "unknown";
  return s.status;
}

// ServerGroup — one section (a host, or a blueprint): an anchored header with
// the section's identity (icon/art chip + name), a count pill, a live aggregate
// (online / players), and a collapse toggle, with the card grid beneath. When
// there's only ONE section (e.g. a single-host fleet) the heavy banner would be
// redundant, so `solo` swaps it for a thin context strip.
// A group's player figure, off the shared tally. A sum that leaves out a server whose presence can't
// be seen is a FLOOR, not a total — the trailing "+" is what says so, and the tooltip says how many.
function groupPlayers(items) {
  const { total, unseen } = playerTally(items);
  return {
    label: `${total}${unseen ? "+" : ""} ${total === 1 && !unseen ? "player" : "players"}`,
    title: unseen
      ? `${unseen} of these servers can't report who's connected — at least ${total} online`
      : undefined,
  };
}

function ServerGroup({ group, groupBy, solo, onOpenServer, onAction, showHost, pick }) {
  const [open, setOpen] = React.useState(true);
  const items = group.items;
  const online = items.filter(s => s.status === "online").length;
  const players = groupPlayers(items);
  const isBlueprint = groupBy === "blueprint";
  const grid = (
    <div className="server-grid server-grid--page server-group__grid">
      {items.map(s => (
        <ServerTile key={s.id} server={s} onOpen={onOpenServer} onAction={onAction} showHost={showHost} {...pick(s)} />
      ))}
    </div>
  );

  if (solo) {
    return (
      <section className="server-group server-group--solo">
        <div className="server-group__strip">
          <Icon name="server" size={12} strokeWidth={2.2} />
          <span className="server-group__strip-name">{group.key}</span>
          <span className="server-group__strip-meta" title={players.title}>{items.length} servers &middot; {online} online &middot; {players.label}</span>
        </div>
        {grid}
      </section>
    );
  }

  return (
    <section className={"server-group" + (open ? "" : " is-collapsed") + (groupBy === "host" ? " server-group--host" : "")}>
      <div className="server-group__head">
        <button className="server-group__toggle" onClick={() => setOpen(o => !o)} aria-expanded={open}>
          <span className="server-group__caret"><Icon name="chevron-right" size={14} /></span>
          {isBlueprint
            ? <span className="server-group__chip" style={{ backgroundImage: items[0].art, backgroundSize: "cover", backgroundPosition: "center" }}></span>
            : <span className="server-group__chip server-group__chip--host"><Icon name="server" size={12} strokeWidth={2.2} /></span>}
          <span className="server-group__name">{group.key}</span>
          <span className="server-group__count">{items.length}</span>
          <span className="server-group__agg" title={players.title}>
            <span className={"server-group__dot" + (online ? " is-on" : "")}></span>
            {online} online &middot; {players.label}
          </span>
        </button>
      </div>
      <hr className="server-group__rule" />
      {open && grid}
    </section>
  );
}

// FavoritesSection — the pinned shelf that sits ABOVE every grouping mode. It
// mirrors the user's starred servers (it never removes them from their host
// group below), always shows host badges (favorites span hosts), and hides
// itself entirely when there's nothing pinned in the current filter view.
function FavoritesSection({ items, onOpenServer, onAction, pick }) {
  const [open, setOpen] = React.useState(true);
  const online = items.filter(s => s.status === "online").length;
  const players = groupPlayers(items);
  return (
    <section className={"server-group server-group--fav" + (open ? "" : " is-collapsed")}>
      <div className="server-group__head">
        <button className="server-group__toggle" onClick={() => setOpen(o => !o)} aria-expanded={open}>
          <span className="server-group__caret"><Icon name="chevron-right" size={14} /></span>
          <span className="server-group__chip server-group__chip--fav"><Icon name="star" size={12} strokeWidth={2.2} /></span>
          <span className="server-group__name">Favorites</span>
          <span className="server-group__count">{items.length}</span>
          <span className="server-group__agg" title={players.title}>
            <span className={"server-group__dot" + (online ? " is-on" : "")}></span>
            {online} online &middot; {players.label}
          </span>
        </button>
      </div>
      <hr className="server-group__rule" />
      {open && (
        <div className="server-grid server-grid--page server-group__grid">
          {items.map(s => (
            <ServerTile key={s.id} server={s} onOpen={onOpenServer} onAction={onAction} showHost={true} {...pick(s)} />
          ))}
        </div>
      )}
    </section>
  );
}

function ServersPage({ onOpenServer, onAction, onLibrary, initialStatus, initialNode }) {
  // Every node's servers, always. The Node field below narrows THIS list and
  // nothing else.
  const servers = useStore(serversStore, s => s.list);
  const hosts = useStore(hostsStore, s => s.list);
  const [query, setQuery] = React.useState("");
  const [status, setStatus] = React.useState(initialStatus || "all");
  const [game, setGame] = React.useState("all");
  // Node is a filter over THIS list, held locally like every other filter here.
  // An entry filter (arriving as ?node=<hostId>, the way ?status= does) seeds it,
  // so "Servers on this node" lands on a list already narrowed to that node.
  const [node, setNode] = React.useState(initialNode || "all");
  // Ordering. Status-first by default (online → in transition → crashed → offline) so
  // the page opens on the same triage order the dashboard uses; re-pick the
  // active key to flip direction. See ToolbarSort / sortByAccessor.
  const [sort, setSort] = React.useState("status");
  const [sortDir, setSortDir] = React.useState("asc");
  // Grouping mode. None by default — flat paginated grid. Toggle to "host" or
  // "blueprint" via the Group filter if you want sections.
  const [groupBy, setGroupBy] = React.useState("none");
  const onSort = (key, dir) => { setSort(key); setSortDir(dir); };
  const [refreshing, setRefreshing] = React.useState(false);
  // Debounce the search so filtering + pagination settle after a quiet window.
  const dq = useDebouncedValue(query, 250);
  const searchPending = query.trim() !== dq.trim();
  const refresh = () => {
    if (refreshing) return;
    setRefreshing(true);
    // Hold the spinner a beat so the action reads as a real fetch even when the
    // API resolves quickly.
    const settle = new Promise(r => setTimeout(r, 450));
    Promise.all([serversStore.refresh(), settle]).finally(() => setRefreshing(false)).catch(() => {});
  };
  const srvStatus = useStore(serversStore, s => s.status);
  // Cold-load only: skeletons appear when we have NO data yet. A background
  // refresh (everLoaded) keeps showing the current list instead of flashing.
  const dataLoading = useStore(serversStore, s => s.status === "loading" && !s.everLoaded);
  const nodeOptions = nodeFilterOptions(hosts);
  const multiNode = nodeOptions.length > 2;
  // The rows carry a node badge only while the list actually spans nodes —
  // pinned to one (or a one-node cluster), the badge repeats itself on every
  // card. Derived from the data on screen, never from an app-wide scope.
  const spansNodes = hosts.length > 1 && node === "all";

  // Count by status for the filter tabs (so each tab shows how many match).
  const counts = React.useMemo(() => {
    const c = { all: servers.length, online: 0, offline: 0, updating: 0, crashed: 0, updates: 0 };
    for (const s of servers) {
      if (c[s.status] != null) c[s.status]++;
      if (s.update_available && s.status !== "updating") c.updates++;
    }
    return c;
  }, [servers]);
  const games = React.useMemo(() => Array.from(new Set(servers.map(s => s.game))).sort(), [servers]);

  // Status options carry per-status counts, surfaced inside the Filters popover.
  const statusOptions = [
    { value: "all",      label: "All",      count: counts.all },
    { value: "online",   label: "Online",   count: counts.online },
    { value: "offline",  label: "Offline",  count: counts.offline },
    { value: "updating", label: "Updating", count: counts.updating },
    { value: "updates",  label: "Update available", count: counts.updates },
    { value: "crashed",  label: "Crashed",  count: counts.crashed },
  ];
  const gameOptions = [{ value: "all", label: "All games" }, ...games.map(g => ({ value: g, label: g }))];

  // Sort axes. Numbers default to desc (most players / hottest first); name and
  // status read better ascending. Status uses the effective status (watchdog-
  // down → unknown) so it matches the bucket order: online → in transition →
  // updating → crashed → unknown → offline. The transitional states sort high
  // because they are the rows worth looking at — something is happening to them
  // right now. Uptime is parsed from its human string.
  const STATUS_RANK = {
    online: 0, starting: 1, restarting: 2, stopping: 3, updating: 4,
    "backing-up": 4, restoring: 4, crashed: 5, unknown: 6, offline: 7,
  };
  const parseUptime = (u) => {
    if (!u || u === "\u2014") return 0;
    let s = 0; let m;
    if ((m = u.match(/(\d+)\s*d/))) s += +m[1] * 86400;
    if ((m = u.match(/(\d+)\s*h/))) s += +m[1] * 3600;
    if ((m = u.match(/(\d+)\s*m/))) s += +m[1] * 60;
    if ((m = u.match(/(\d+)\s*s/))) s += +m[1];
    return s;
  };
  const SORT_ACCESSORS = {
    status:  s => { const r = STATUS_RANK[effectiveStatus(s)]; return r != null ? r : 9; },
    name:    s => (s.name || "").toLowerCase(),
    // A server whose presence can't be seen sorts as 0 — it goes to the bottom of a "most players
    // first" list rather than jumping the queue on a number nobody measured. The CARD still shows "—".
    players: s => (s.players ? s.players.current : 0),
    cpu:     s => s.cpu || 0,
    uptime:  s => parseUptime(s.uptime),
  };
  const sortOptions = [
    { value: "status",  label: "Status",         defaultDir: "asc"  },
    { value: "name",    label: "Name",           defaultDir: "asc"  },
    { value: "players", label: "Players online", defaultDir: "desc" },
    { value: "cpu",     label: "CPU load",       defaultDir: "desc" },
    { value: "uptime",  label: "Uptime",         defaultDir: "desc" },
  ];

  const q = dq.trim().toLowerCase();
  const filtered = servers.filter(s => {
    if (status === "updates") {
      if (!(s.update_available && s.status !== "updating")) return false;
    } else if (status !== "all" && s.status !== status) return false;
    if (node !== "all" && s.hostId !== node) return false;
    if (game !== "all" && s.game !== game) return false;
    if (q && !(s.name.toLowerCase().includes(q) || (s.game || "").toLowerCase().includes(q))) return false;
    return true;
  });
  // Order the filtered set with the shared comparator (same rules as CardTable).
  const ordered = sortByAccessor(filtered, SORT_ACCESSORS[sort] || (() => 0), sortDir);

  // Partition the ordered set into sections (by host or blueprint). Grouping
  // operates on `ordered`, so the active sort is preserved within each section.
  // Empty groups never exist — filters prune them. null when grouping is off.
  const grouped = React.useMemo(() => {
    if (groupBy === "none") return null;
    const keyOf = groupBy === "host"
      ? (s) => { const h = hosts.find(h => h.id === s.hostId); return h ? h.name : "Unassigned"; }
      : (s) => s.game;
    const map = new Map();
    for (const s of ordered) {
      const k = keyOf(s);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(s);
    }
    return Array.from(map, ([key, items]) => ({ key, items }))
      .sort((a, b) => a.key.localeCompare(b.key, undefined, { sensitivity: "base" }));
  }, [groupBy, ordered, hosts]);

  // Favorites are a pinned MIRROR of the filtered+sorted set — same scope as the
  // rest of the page (active search / status / game / host filters all apply),
  // so the shelf never disagrees with what's below it. Derived from `ordered`,
  // so the active sort carries through. Empty → the section hides itself.
  const favIds = useStore(favoritesStore, s => s.ids);
  const favSet = React.useMemo(() => new Set(favIds), [favIds]);
  const favItems = ordered.filter(s => favSet.has(s.id));

  // ---- Pagination (25 / page) ----
  const PAGE_SIZE = 25;
  const [page, setPage] = React.useState(0);
  React.useEffect(() => { setPage(0); }, [q, status, game, node, sort, sortDir]);
  const pageCount = Math.max(1, Math.ceil(ordered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageItems = ordered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  // Creating a server is gated (architecture.html §3·f·1): a read-only viewer
  // sees the inventory but no "New server" entry point. Aggregate — shown if the
  // user can create on any host.
  const canCreate = can("server.create");

  // ---- Selection (a gesture over this list, never persisted) ----
  // Aggregate for REACH: a checkbox appears for anyone who operates servers somewhere. Whether a
  // particular node's rows may actually be acted on is a per-host question, and the preflight asks it
  // — a selection can span nodes this person operates unevenly, and those are refusals, not errors.
  const canSelect = can("server.operate");
  const selectedIds = useSelectionIds();
  const selectedSet = React.useMemo(() => new Set(selectedIds), [selectedIds]);
  // Cleared whenever a filter moves. A selected row hidden behind a filter is how a batch reaches a
  // server nobody meant. Sort, grouping and the page number are deliberately NOT in this list: none
  // of them changes WHICH servers are selected, and clearing on a page turn would make a selection
  // wider than one page impossible — the bar states the count and the preflight names every server,
  // so nothing is acted on unseen.
  React.useEffect(() => { selectionStore.clear(); }, [q, status, game, node]);

  // The order shift-click extends over: the list exactly as it is drawn. Grouping sections it, and
  // pagination cuts it — a range is over what is on screen, because that is what was pointed at.
  const visualOrder = grouped ? grouped.flatMap(g => g.items) : pageItems;
  const lastPicked = React.useRef(null);
  const onSelect = (server, opts) => {
    if (opts && opts.shift && lastPicked.current && lastPicked.current !== server.id) {
      const a = visualOrder.findIndex(s => s.id === lastPicked.current);
      const b = visualOrder.findIndex(s => s.id === server.id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        selectionStore.add(visualOrder.slice(lo, hi + 1));
        lastPicked.current = server.id;
        return;
      }
    }
    selectionStore.toggle(server);
    lastPicked.current = server.id;
  };
  const pick = (s) => (canSelect
    ? { selectable: true, selected: selectedSet.has(s.id), onSelect }
    : { selectable: false });

  return (
    <>
      <div className="dash-head">
        <div className="dash-head__row">
          <h1>Servers</h1>
          {canCreate && (
          <button className="fb-editor__btn servers-toolbar__new" onClick={onLibrary}>
            <Icon name="plus" size={13} strokeWidth={2.4} />&nbsp;New server
          </button>
          )}
        </div>
        <div className="dash-head__sub">
          {dataLoading ? <Skel w={240} h={14} /> : <>{servers.length} installed · {counts.online} online right now.</>}
        </div>
        <ClusterReach />
      </div>

      {dataLoading ? <ServersSkeleton /> : (<>
      <Toolbar>
        <ToolbarSearch
          value={query}
          onChange={setQuery}
          pending={searchPending}
          placeholder="Search by name or game…" />

        <ToolbarFilters
          fields={[
            { id: "status", label: "Status", value: status, onChange: setStatus, default: "all", options: statusOptions },
            { id: "node",   label: "Node",   value: node, onChange: setNode, default: "all", options: nodeOptions, hidden: !multiNode },
            { id: "game",   label: "Game",   value: game, onChange: setGame, default: "all", options: gameOptions },
            { id: "group",  label: "Group",  value: groupBy, onChange: setGroupBy, default: "none", options: [
              { value: "none",      label: "None" },
              { value: "blueprint", label: "Blueprint" },
              ...(multiNode ? [{ value: "host", label: "Node" }] : []),
            ] },
          ]}
          onReset={() => setQuery("")} />

        <ToolbarSort value={sort} dir={sortDir} onChange={onSort} options={sortOptions} />

        <ToolbarSpacer />
        <ToolbarCount shown={filtered.length} total={servers.length} unit="servers" />
        {/* The one that matters. The filters are already good enough that `status=updates` +
            `game=factorio` IS the selection — clicking twelve boxes to re-express a filter that has
            already run is the friction being removed. It takes the whole filtered set, not the page,
            because the filter is what was expressed. */}
        {canSelect && filtered.length > 0 && (
          <ToolbarButton
            icon="check-check"
            onClick={() => selectionStore.add(filtered)}
            title={"Select all " + filtered.length + " servers matching the current filters"}>
            Select all {filtered.length}
          </ToolbarButton>
        )}
        <ToolbarButton
          icon="refresh-cw"
          onClick={refresh}
          disabled={refreshing}
          spinning={refreshing}
          title="Re-fetch the latest server list from the backend">
          {refreshing ? "Refreshing…" : "Refresh"}
        </ToolbarButton>
      </Toolbar>

      {canSelect && <SelectionBar />}

      {srvStatus === "error" && (
        <SurfaceError
          title="Couldn't refresh servers."
          detail="Showing the last known state."
          onRetry={refresh}
          retrying={refreshing}
        />
      )}

      {filtered.length === 0 ? (
        <div className="servers-empty">
          <Icon name="server-off" size={26} />
          <div className="servers-empty__title">
            {servers.length === 0 ? "No servers installed yet" : "No servers match your filters"}
          </div>
          <div className="servers-empty__sub">
            {servers.length === 0
              ? (canCreate ? "Install a game from the library to get started." : "No game servers have been set up yet.")
              : "Try a different status or clear the search."}
          </div>
          {servers.length === 0 && (
            <button className="fb-editor__btn" onClick={onLibrary} style={{ marginTop: 14 }}>
              <Icon name="library" size={13} />&nbsp;Browse catalog
            </button>
          )}
        </div>
      ) : (
        <>
          {grouped ? (
            <div className="server-groups">
              {favItems.length > 0 && (
                <FavoritesSection items={favItems} onOpenServer={onOpenServer} onAction={onAction} pick={pick} />
              )}
              {grouped.map(g => (
                <ServerGroup
                  key={g.key}
                  group={g}
                  groupBy={groupBy}
                  solo={grouped.length === 1 && groupBy === "host"}
                  onOpenServer={onOpenServer}
                  onAction={onAction}
                  showHost={spansNodes}
                  pick={pick} />
              ))}
            </div>
          ) : (
            <>
              {favItems.length > 0 && (
                <div className="server-groups server-groups--fav">
                  <FavoritesSection items={favItems} onOpenServer={onOpenServer} onAction={onAction} pick={pick} />
                </div>
              )}
              <div className="server-grid server-grid--page">
                {pageItems.map(s => (
                  <ServerTile key={s.id} server={s} onOpen={onOpenServer} onAction={onAction} showHost={spansNodes} {...pick(s)} />
                ))}
              </div>
              <Pagination
                page={safePage}
                pageCount={pageCount}
                total={filtered.length}
                pageSize={PAGE_SIZE}
                onPage={setPage}
                unit="servers"
              />
            </>
          )}
        </>
      )}
      </>)}
    </>
  );
}

export { ServersPage };
export default ServersPage;
