// adapters.js — translate kgsm-api DTOs into the shapes the SPA components read.
//
// The backend emits an HONEST, narrow model: no per-server ip/uptime, no
// per-process host tables — kgsm-api omits anything it can't measure (the "never
// fabricate" invariant). So the cardinal rule here: a value the backend doesn't
// provide maps to null / "unknown" / empty — NEVER to 0 or an invented default.
// The components render "—" for those; see WIRING.md §5.
//
// camelCase (api) → the field names the components already use.

const round = (n, d = 0) => {
  if (n == null || !isFinite(n)) return null;
  const f = Math.pow(10, d);
  return Math.round(n * f) / f;
};

// ---- Servers ------------------------------------------------------------
// api status is the watchdog/Docker run-state (a 4-state: running/stopped/
// starting/unknown — "starting" sits between launch and the game finishing boot
// (joinable), then flips to "running"); the UI vocabulary is
// online/offline/starting/unknown. The states that describe what is being DONE to a
// server rather than what it IS — installing, updating — are synthesized from the
// job the server carries, in stores/servers.js (the one place that derivation lives).
// Arrives over the SAME server.patch SSE frame that already carries status.
const SERVER_STATUS = { running: "online", stopped: "offline", starting: "starting", unknown: "unknown" };

export function adaptServer(be) {
  if (!be) return be;
  const m = be.metrics || null;
  return {
    // identity / metadata (honest passthrough)
    id: be.id,
    name: be.name ?? be.id,
    hostId: be.hostId,
    blueprint: be.blueprint,
    runtime: be.runtime,
    version: be.version ?? null,
    // display game name: no curated title upstream yet → fall back to blueprint
    // id (enriched from /library by id in a later slice).
    game: be.blueprint,
    status: SERVER_STATUS[be.status] || "unknown",
    // How many people are on it right now. The backend counts this off the same roster the players
    // tab reads, and carries it on the list, the detail AND the server.patch stream — so a card, the
    // fleet total on the dashboard and the Players tab are one number, live, with no per-card fetch.
    //
    // null when the backend could not see: the game declares no join/leave detection, or the
    // supervisor could not be asked. That is NOT zero, and no surface may sum it as one — the
    // dashboard counts the servers it cannot see and says so instead. `max` stays null: no instance
    // declares a capacity, so there is nothing honest to render a "x / y" against.
    players: be.onlinePlayers == null ? null : { current: be.onlinePlayers, max: null },
    // What starting this server is expected to cost the node, and which figure that is ("cap" — the
    // enforced cgroup ceiling — or "blueprint", a vendor estimate that is uncurated for many games).
    // Both null when nothing is declared, which is the common case and means the engine's memory gate
    // cannot answer either: the panel then warns about nothing rather than inventing a requirement.
    //
    // It is the gate's INPUT, not its verdict. Whether there is room depends on the node's free memory
    // at the instant the engine looks, so a surface joins this against the owning host and the ENGINE
    // still decides — see capacityHint in lib/capacity.js.
    start_memory_mb: be.startMemoryMb != null ? be.startMemoryMb : null,
    start_memory_source: be.startMemorySource || null,
    // When the current run started / when the last one ended, both ISO-UTC or null. The backend joins
    // these from the run-state authority (the watchdog's persisted spawn time and its durable run
    // ledger), so they survive a daemon restart and are not derived from the audit feed. A surface
    // derives a duration from them against wall clock; null is an honest "nothing dates this run",
    // never a zero.
    startedAt: be.startedAt ?? null,
    stoppedAt: be.stoppedAt ?? null,
    uptime: null,                  // not exposed by kgsm
    ip: null,                      // not exposed by kgsm
    // The newest backup's own manifest record ({ name, createdAt, version, sizeBytes, fileCount,
    // compressed, consistency, sources, sha256 }) or null, plus how many backups the instance holds.
    // Both ride the list, the detail AND the server.patch stream, so the dashboard can summarize backup
    // freshness across the roster without a detail fetch per server.
    //
    // The two nulls mean DIFFERENT things and surfaces must keep them apart: backup_count === 0 is a
    // MEASURED zero ("this server genuinely has no backups"), while backup_count == null means the
    // backend hasn't scanned yet ("unknown"). Rendering the second as "no backups yet" would be a
    // fabrication — it is the honest-unknown "—" case. Any manifest field may itself be null (a backup
    // the engine lists but whose manifest is missing/unreadable); render what is present, omit the rest.
    last_backup: be.lastBackup ?? null,
    backup_count: be.backupCount ?? null,
    log: [],                       // console is a SEPARATE endpoint (GET /servers/{id}/console + WS follow),
                                   // hydrated by ConsolePanel — never carried on the server DTO.
    // update_available — a truthy TARGET VERSION string when an update is waiting (the SPA surfaces
    // render "→ <version>" beside the Update chip), or null when the probe hasn't checked / no update.
    // The backend DTO is bool? updateAvailable + string? latestVersion; the adapter collapses to the
    // consumer-expected shape so the existing KPI/tile/filter code ("→ " + server.update_available)
    // keeps reading a truthy string. Honest-null when the probe is cold or reported no update — NEVER
    // a fabricated false (the chip stays disabled with an honest reason, not lit as "no update").
    update_available: be.updateAvailable ? (be.latestVersion || "new version available") : null,
    // The target version on its own, or null when the engine reported an update without naming a
    // build. Kept separate from update_available so a surface can render the figure WITHOUT having to
    // recognise the prose stand-in above — the tile's update chip shows its version segment only when
    // there is a real version to put in it, rather than printing a sentence in a mono badge.
    update_version: be.latestVersion ?? null,
    // When the update-check probe last ran for this instance (UTC ISO), or null until the first check.
    // Surfaced so freshness is visible ("checked N min ago"); never a fabricated timestamp.
    update_checked_at: be.updateCheckedAt ?? null,
    // How long the gap has been open, as the engine's own first notice dates it. Distinct from
    // update_checked_at (when the check last RAN) — this is what makes an update overdue rather than
    // merely pending. Null whenever nothing dates it: no update outstanding, an engine that emits no
    // such event, or a notice older than the backend's walk. Never derived from the check time.
    update_available_since: be.updateAvailableSince ?? null,
    // per-instance metrics (null when the monitor is absent/down):
    cpu: m ? round(m.cpuPctCore, 0) : null,           // % of one core (can exceed 100)
    ram: m ? { used: round(m.memBytes / 1e9, 2), max: null } : null,  // GiB; no per-instance max
    // Network throughput, bytes/sec. Null when the meter doesn't cover this instance (see
    // adaptServerMetrics) as well as when nothing is running — two different unknowns, one honest null.
    rxBps: m ? (m.rxBps ?? null) : null,
    txBps: m ? (m.txBps ?? null) : null,
    // On-disk footprint in bytes, or null when the monitor hasn't measured it. NOT read off `metrics`:
    // the backend carries it beside that block precisely because it survives the server being stopped
    // (an instance occupies its disk whether or not anything is running), which is what lets a card show
    // disk for every server and cpu/mem/net only for the running ones.
    diskBytes: be.diskBytes ?? null,
    // keep the raw backend objects for surfaces that want honest detail:
    metrics: m,
    network: be.network || null,
    // The player-facing connect port. Unlike `network` (detail-only — it carries a firewall probe), this
    // rides the list, the stream AND the detail, so a card can render host:port without a detail fetch.
    // Honest null when the instance declares no ports.
    connectPort: be.connectPort ?? null,
    // RAWG art for this server's blueprint, self-hosted by kgsm-api (absolute, directly-renderable
    // URLs, or null). DETAIL-ONLY — the list/stream omit them, so they're null here until
    // serversStore.fetchDetail merges the detail body in. hero = landscape banner (the detail-page
    // background), cover = 2:3 portrait. Never construct these client-side; consume the DTO field.
    cover: be.cover ?? null,
    hero: be.hero ?? null,
    // The operator-authored server note ({ body, updatedBy, updatedAt }) or null when none is set.
    // Rides the list, the detail AND the server.patch stream, so a dashboard tile renders it without
    // a detail fetch and an edit made elsewhere lands live. `notice` is the body alone — the shape
    // the tile and the note card read; `note` keeps the attribution the card's byline needs.
    note: be.note ?? null,
    notice: be.note?.body ?? "",
    steamAppId: be.steamAppId,
    clientSteamAppId: be.clientSteamAppId,
    isSteamAccountRequired: be.isSteamAccountRequired,
    // The long-running operation that owns this server right now (an update downloading and
    // deploying, a backup being taken) or null when it's idle. Same shape as a `jobs` frame — it IS
    // the backend's own job record — so the store keeps it in the SAME `job` field the jobs channel
    // writes, and the two can only ever agree. Carrying it on the server is what lets a page opened
    // (or reloaded) mid-update show the state: the jobs channel only ever delivers the transition,
    // which a client that wasn't connected at the time never saw.
    job: be.activeJob ? adaptJob(be.activeJob) : null,
    // Which named root this server's files live in, and the root itself. `"unregistered"` is the
    // engine's own word for a server on a disk nothing declares — a real, recoverable state, not a
    // missing value — and null is a host whose engine predates libraries.
    library: be.library || null,
    libraryPath: be.libraryPath || null,
    // Whether that root is reachable: online | offline | unregistered, or null when the node could not
    // read its registry. A SEPARATE axis from status — status is what the process is doing, this is
    // whether the files exist to run at all — joined for display in stores/servers.js, the one place
    // that derivation lives.
    libraryState: be.libraryState || null,
  };
}
export const adaptServers = (arr) => (Array.isArray(arr) ? arr.map(adaptServer) : []);

// adaptServerMetrics(be) — reshape ONE per-server metrics sample (the kgsm-api
// ServerMetricsDto) into a chart point for the Performance deep-dive's live
// rolling window. Used in TWO places that must agree byte-for-byte:
//   1. the WS metrics.tick frame (servers/{id}/metrics) — adaptStreamMessage,
//   2. the REST seed (the `metrics` block already on the server DTO) — so the
//      first point and every subsequent tick share one shape.
// HONESTY: the monitor measures cpu/mem/io/pids/diskBytes and — native instances
// only, via the eBPF cgroup/skb meter attached to kgsm.slice — network rx/tx.
//   - cpu is % of ONE core (htop convention) and CAN exceed 100 — never cap it.
//   - mem is ABSOLUTE bytes (no per-server limit exists → no honest %).
//   - io read/write are bytes/sec, null when the cgroup io controller isn't
//     accounted (never fabricate 0). diskBytes is a slow-cadence footprint.
//   - rxBps/txBps are bytes/sec and NOW SOURCED for native instances (the meter
//     covers everything under kgsm.slice), but still null when unmeasured — a
//     container (outside kgsm.slice) or an un-metered host. Honest null, never 0.
//   - tick-rate has NO source and is absent — the tab must not invent it. Players
//     are NOT a metric: the count rides the server DTO (see adaptServer), because
//     it is a reading of the roster, not of the process.
export function adaptServerMetrics(be) {
  if (!be) return null;
  return {
    cpu: round(be.cpuPctCore, 1),            // % of one core (uncapped)
    memBytes: be.memBytes ?? null,           // absolute charged memory, bytes
    ioReadBps: be.ioReadBps ?? null,         // bytes/sec, null when not accounted
    ioWriteBps: be.ioWriteBps ?? null,       // bytes/sec, null when not accounted
    pids: be.pids ?? null,                   // live process/thread count
    diskBytes: be.diskBytes ?? null,         // on-disk footprint, bytes (slow cadence)
    rxBps: be.rxBps ?? null,                 // network receive, bytes/sec; null when unmetered (container / un-metered host) — never 0
    txBps: be.txBps ?? null,                 // network transmit, bytes/sec; null when unmetered — never 0
  };
}

// adaptServerMetricsRoster(be) — the `metrics.roster` frame on the `servers/metrics` topic: every
// instance's readout at one instant, which is what a GRID of cards reads. (The per-server
// `servers/{id}/metrics` tick above is one chart's feed — subscribing a whole page of cards to N of
// those opens N streams, since a resource-scoped topic gets its own SSE connection.)
//
// Each row is the live half of what adaptServer hydrates, in the same two parts and with the same
// meaning, so a merge is field-for-field:
//   • `metrics` — null when the monitor produced no sample, which is the ordinary case for a STOPPED
//     server. Null is "not measured", never zero, and never a claim about run-state (status comes from
//     the run-state authority on the `servers` topic — the tile joins the two).
//   • `diskBytes` — present independently, because the monitor walks its whole watch-list. A row is
//     half-null exactly when half of it was measured.
// A row the frame omits is one the monitor knows nothing about; the store leaves such a server alone
// rather than blanking what it already holds.
export function adaptServerMetricsRoster(be) {
  const rows = be && Array.isArray(be.servers) ? be.servers : [];
  return rows
    .filter((r) => r && r.id)
    .map((r) => ({
      id: r.id,
      metrics: adaptServerMetrics(r.metrics),
      diskBytes: r.diskBytes ?? null,
    }));
}

// ---- Hosts --------------------------------------------------------------
// The backend gives coarse, honest host metrics (aggregate cpuPct, mem, disks)
// or null when the metrics capability is down. The diagnostics deep-dive reads
// a richer shape (per_core / load / sensors / processes) the backend doesn't
// have — we fill those with a valid-but-empty skeleton (mirrors the FE's own
// makeHostSkeleton convention) so nothing crashes, and the capability status
// (truthfully reported by the backend) drives the "no signal" treatment. No
// fabricated numbers: absent telemetry → zero-length / 0 framed by a down LED.
function telemetrySkeleton() {
  return {
    cpu: { model: "—", cores: 0, threads: null, freq_ghz: null, usage_pct: null, per_core: [], load_avg: null, temp_c: null },
    ram: { total_gb: 0, used_gb: 0, cached_gb: null, buffers_gb: null, free_gb: 0, swap_total_gb: null, swap_used_gb: null },
    disks: [], network: { interfaces: [], open_ports: [] }, sensors: [], fans: [], processes: [],
  };
}

// Interface throughput: the monitor measures bytes/sec; the UI labels it "kbps". Convert to
// kilobits/sec (the conventional network unit) — a real measured rate, unit-shifted for display,
// not a fabricated value. null in → null out (honest-unknown, never a 0 rate).
const toKbps = (bps) => (bps == null ? null : Math.round((bps * 8) / 1000));

// mapHostTelemetry(be) — the measured-capacity portion of a host: exactly the fields present in
// BOTH the full Host DTO (GET /hosts) AND the host.metrics WS tick (HostMetricsDto). The API maps
// both through one shared MetricsMapping (so a tick is byte-identical to the REST host it patches);
// mapping them in one place here is the FE mirror of that invariant — a live tick reshapes to the
// SAME telemetry a hydrate produced, so the WS merge can never drift from the REST element.
//
// Honest-unknown throughout: usage / per-core / load / mem-breakdown / fs / iface throughput are
// MEASURED; model / threads / freq / temperature / cached / buffers / device / SMART / ip / mac /
// error counters are NOT sampled → "—"/null, never a fabricated 0. A field the snapshot omits comes
// back null here; the caller decides whether to fall back to a skeleton (adaptHost) or skip it (merge).
function mapHostTelemetry(be) {
  const hasSample = Array.isArray(be.perCore) && be.perCore.length > 0;
  // DYNAMIC cpu only (usage / per-core / cores / load). The STATIC identity
  // (model / threads / max-freq) is a per-host constant that rides the Host REST
  // view, NOT the metrics tick — so it lives in adaptHost, and the tick merge
  // (hostsStore.mergeMetrics) preserves it rather than clobbering with a tick
  // that never carries it.
  const cpu = (be.cpuPct != null || hasSample)
    ? {
        cores: hasSample ? be.perCore.length : 0,
        usage_pct: be.cpuPct != null ? round(be.cpuPct, 0) : null,
        per_core: hasSample ? be.perCore.map((p) => round(p, 0)) : [],
        load_avg: be.load ? [round(be.load.one, 2), round(be.load.five, 2), round(be.load.fifteen, 2)] : null,
      }
    : null;
  const ram = be.mem
    ? {
        total_gb: round(be.mem.total, 1),
        used_gb: round(be.mem.used, 1),
        free_gb: be.mem.available != null ? round(be.mem.available, 1) : round(Math.max(0, be.mem.total - be.mem.used), 1),
        // The same figure in MB and UNROUNDED, for the capacity hint. free_gb is rounded to a tenth of a
        // gibibyte — about 100MB of slop — which is enough to move a start from "fits" to "doesn't" on
        // its own, and the engine judges in MB.
        //
        // Sourced ONLY from `available`. The gate compares against MemAvailable specifically, so when the
        // backend has no such reading the honest answer is that there is nothing comparable to show —
        // total-used is a different number (it omits reclaimable cache) and substituting it would have
        // the panel warn against a figure the engine never uses.
        free_mb: be.mem.available != null ? Math.round(be.mem.available * 1024) : null,
        // M-diag depth (Monitor.Contracts 1.1.0) — measured page cache + buffers; honest-null when absent.
        cached_gb: be.mem.cached != null ? round(be.mem.cached, 1) : null,
        buffers_gb: be.mem.buffers != null ? round(be.mem.buffers, 1) : null,
        swap_total_gb: be.mem.swapTotal != null ? round(be.mem.swapTotal, 1) : null,
        swap_used_gb: be.mem.swapUsed != null ? round(be.mem.swapUsed, 1) : null,
      }
    : null;
  const disks = Array.isArray(be.disks) && be.disks.length
    ? be.disks.map((d) => ({ mount: d.mount, total_gb: round(d.total, 1), used_gb: round(d.used, 1), fs: d.fs || "—", device: d.device || "—", smart: null }))
    : null;
  const interfaces = Array.isArray(be.interfaces)
    ? be.interfaces.map((i) => ({
        // mac/errors are M-diag depth now sourced; ip is still unsourced (honest "—"). errors uses ?? so a
        // real 0 stays 0 (a genuine "no link errors"), never conflated with unknown (null).
        name: i.name, ip: null, mac: i.mac || null, errors: i.errors ?? null,
        rx_kbps: toKbps(i.rxBps), tx_kbps: toKbps(i.txBps), rx_pps: i.rxPps ?? null, tx_pps: i.txPps ?? null,
      }))
    : null;
  // hwmon temperatures. Empty array when no chip exposes one (never an invented row); null only when
  // there's no snapshot at all (so adaptHost can fall back to the skeleton's []). role/name are the
  // monitor's classification of the channel and are carried, never derived here — the daemon that read
  // the register owns that knowledge. Both null together means the chip isn't in its catalog, which is
  // unrecognised hardware and NOT a doubtful reading: value_c is measured either way, so the UI falls
  // back to chip/label rather than hiding the row.
  const sensors = Array.isArray(be.sensors)
    ? be.sensors.map((s) => ({
        id: s.id, chip: s.chip, label: s.label || null, value_c: round(s.valueC, 1),
        role: s.role || null, name: s.name || null,
        // The device's own thermal lines, carried UNROUNDED — a limit is a setting, and a rounded
        // threshold is a different threshold. null means the device publishes none, which is a
        // consumer's cue to fall back to the host's policy, never to a number written in here.
        limit_high_c: s.limitHighC ?? null,
        limit_critical_c: s.limitCriticalC ?? null,
        // Which channel speaks for a device, and what a channel restates. Absent on an older node's
        // payload, where every channel stands alone — hence the `!== false` reads at the call sites.
        primary: s.primary,
        duplicate_of: s.duplicateOf || null,
      }))
    : null;
  // hwmon fan tachometers. Only fans that are TURNING are on the wire — an unpopulated header and a
  // stopped fan both read zero and hwmon can't separate them — so expect fewer rows than the board has
  // headers, and never read an absent row as "that fan stopped". undefined when the payload predates
  // the field, which the merge keeps distinct from a measured empty.
  const fans = Array.isArray(be.fans)
    ? be.fans.map((f) => ({
        id: f.id, chip: f.chip, label: f.label || null, rpm: f.rpm, name: f.name || null,
      }))
    : be.fans;
  // The host's GPUs — devices only (the per-process breakdown is detail-only and gated). GiB figures
  // straight from the api; each nullable field passes through (an unreadable SM/temp/power is unknown,
  // never 0). null = the host has no readable card; undefined = the payload predates the field — the
  // merge distinguishes the two so an older node's tick can't clear a newer read.
  const gpus = Array.isArray(be.gpus)
    ? be.gpus.map((g) => ({
        index: g.index, name: g.name, uuid: g.uuid,
        mem_used_gb: g.memUsed != null ? round(g.memUsed, 2) : null,
        mem_total_gb: g.memTotal != null ? round(g.memTotal, 2) : null,
        sm_pct: g.smPct ?? null, temp_c: g.tempC ?? null,
        temp_limit_c: g.tempLimitC ?? null, temp_shutdown_c: g.tempShutdownC ?? null,
        power_w: g.powerW ?? null, power_cap_w: g.powerCapW ?? null,
      }))
    : be.gpus;
  // The kgsm.slice aggregate — what the game servers collectively cost, measured at the parent cgroup.
  // cpu_pct_core is percent of ONE core (may exceed 100) and null on the monitor's first observation;
  // null slice = no kgsm.slice on this host; undefined = an older payload, same rule as gpus.
  const slice = be.slice
    ? {
        cpu_pct_core: be.slice.cpuPctCore ?? null,
        mem_bytes: be.slice.memBytes ?? null,
        pids: be.slice.pids ?? null,
      }
    : be.slice;
  // boot_time derived from the measured uptime (now − uptimeSec); the FE's uptime helpers want a
  // timestamp. null when uptime isn't sourced → the helpers render "—".
  const boot_time = be.uptimeSec != null ? new Date(Date.now() - be.uptimeSec * 1000).toISOString() : null;
  const hostname = be.hostname || null;
  return { cpu, ram, disks, interfaces, sensors, fans, gpus, slice, boot_time, hostname };
}

export function adaptHost(be) {
  if (!be) return be;
  const skel = telemetrySkeleton();
  const metricsOk = !!(be.capabilities && be.capabilities.metrics && be.capabilities.metrics.status === "operational");
  const tel = mapHostTelemetry(be);

  // Absent telemetry → the valid-but-empty skeleton (so nothing crashes reading the shape); the
  // capability status (truthfully reported by the backend) drives the "no signal" treatment. We do
  // NOT stamp last_sample_at on a REST hydrate (deliberate): an unrefreshed sample would age every
  // host to "frozen" 30s after boot on surfaces that have no WS feed — the freshness stamp is owned
  // by the host.metrics tick path only (see adaptHostMetrics + hostsStore.mergeMetrics).
  // Layer the STATIC cpu identity (model/threads/max-freq — Host-view-only, M-diag depth) over the
  // dynamic telemetry. skel.cpu supplies the full key set so a render never reads undefined; tel.cpu
  // the live dynamic fields; staticCpu the real identity when sourced (else the skeleton's "—"/null).
  const staticCpu = be.cpu
    ? { model: be.cpu.model || "—", threads: be.cpu.threads ?? null, freq_ghz: be.cpu.maxFreqGhz ?? null }
    : {};
  const cpu = tel.cpu ? { ...skel.cpu, ...tel.cpu, ...staticCpu } : skel.cpu;
  const ram = tel.ram || skel.ram;
  const disks = tel.disks || skel.disks;
  const interfaces = tel.interfaces || [];
  const network = {
    interfaces,
    // The firewall's own availability, carried alongside the grid because the grid CANNOT be read
    // without it: an empty `open_ports` under "operational" means nothing is open, and the very same
    // empty grid under "inactive" means EVERYTHING is (an idle ufw enumerates no rules and filters
    // nothing). null when the host answered without the block — the list response omits it — which is
    // an honest "not measured here", never "no firewall".
    firewall: (be.network && be.network.firewall) || null,
    open_ports: be.network && Array.isArray(be.network.openPorts)
      ? be.network.openPorts.map((p) => ({ port: p.port, proto: p.proto, server: p.server ?? null, app: p.app ?? null }))
      : [],
  };

  // Identity card (M8·d): operator-declared region + runtime-derived os/kernel/build, now sourced by the
  // API. Honest-unknown ("—") when a field is null (region unset, or an unreadable os source).
  const ident = be.identity || {};
  const identOs = ident.os || {};
  return {
    id: be.id,
    name: be.label ?? be.id,
    hostname: tel.hostname || be.id,   // real monitor hostname when sampled, else the host id
    region: ident.region ?? "—",
    os: identOs.name ?? "—",
    kernel: identOs.kernel ?? "—",
    // The honest "which build is this host running" — the API build version (<Version>+git SHA), falling
    // back to the route version. NOT a hardcoded "—" anymore.
    panel_version: ident.build || be.panelVersion || "—",
    // The managed runtime the API process is executing on (".NET 10.0.10"). Null when the host didn't
    // report it — a fact about the response, not a runtime worth guessing at.
    runtime: ident.runtime || null,
    boot_time: tel.boot_time,
    online: be.status === "online",
    // capabilities pass straight through — the api shape already matches the
    // FE capability model {provisioned,status,since,message,info}.
    capabilities: be.capabilities || {},
    cpu, ram, disks, network,
    sensors: tel.sensors || [],   // hwmon temperatures; [] when none / no snapshot
    fans: tel.fans || [],         // hwmon tachometers that are turning; [] when none reported
    gpus: tel.gpus ?? null,       // devices only; null = no readable card on this host
    slice: tel.slice ?? null,     // kgsm.slice aggregate; null = no slice on this host
    processes: [],                // no host process-list source → honest-empty (not fabricated rows)
    events: [], logs: [],
    // The named roots this host places servers in, each with its live state and capacity. null when the
    // engine could not answer — which is NOT an empty array: a surface hides the placement controls on
    // null and offers "register one" on []. free/total stay in BYTES here (unlike disks, which the API
    // serves in GB) because that is what the API measured; formatBytes renders them.
    libraries: Array.isArray(be.libraries)
      ? be.libraries.map((l) => ({
          name: l.name,
          path: l.path,
          online: !!l.online,
          // null for an offline library — nothing measured an unplugged disk, and a 0 would render as
          // a full one.
          free_bytes: l.freeBytes ?? null,
          total_bytes: l.totalBytes ?? null,
          instance_count: l.instanceCount ?? 0,
          mount: l.mount || null,
          device: l.device || null,
        }))
      : null,
    // This host's node-capacity policy, as the engine will apply it — the floor a start must leave free.
    // Null when the engine did not answer or the keys are unset; the gate still runs there on its own
    // coded defaults, which this client does not know, so it warns about nothing rather than guessing.
    memory_gate: be.memoryGate
      ? { enabled: !!be.memoryGate.enabled, headroom_mb: be.memoryGate.headroomMb }
      : null,
    _metricsOk: metricsOk,
  };
}
export const adaptHosts = (arr) => (Array.isArray(arr) ? arr.map(adaptHost) : []);

// adaptHostMetrics(be) — reshape a host.metrics WS tick (the HostMetricsDto, which is the measured
// SUBSET of the Host DTO) into the FE telemetry partial. Same fields, same units as adaptHost (they
// share mapHostTelemetry), so a live tick produces telemetry byte-identical to the REST host it
// patches. Returns ONLY the telemetry fields — the store merges them clobber-safe over the existing
// host, preserving the capability block and the firewall open-ports grid the tick deliberately omits
// (hostsStore.mergeMetrics). The per-tick freshness stamp is applied at merge time, not here.
export function adaptHostMetrics(be) {
  if (!be) return be;
  return mapHostTelemetry(be);
}

// ---- Library (installable catalog) -------------------------------------
export function adaptLibraryEntry(be) {
  if (!be) return be;
  return {
    id: be.id,
    name: be.name ?? be.id,
    // no curated category upstream → group by runtime type (honest, coarse).
    category: be.type || "game",
    type: be.type,
    // players: specs.maxPlayers is null today → leave unknown (no display).
    players: be.specs && be.specs.maxPlayers != null ? String(be.specs.maxPlayers) : null,
    // Steam identity: the SERVER app is what kgsm downloads, the CLIENT app is what a
    // player owns — two different ids, both nullable for a non-Steam blueprint.
    steamAppId: be.steamAppId ?? null,
    clientSteamAppId: be.clientSteamAppId ?? null,
    // A real boolean from the blueprint, so a missing one is unknown, not "no".
    steamAccountRequired: be.isSteamAccountRequired ?? null,
    ports: be.ports || [],
    specs: be.specs || null,
    // RAWG-sourced metadata, served by kgsm-api (cover/hero are ABSOLUTE,
    // directly-renderable URLs → render verbatim; null → the gradient fallback).
    cover: be.cover ?? null,
    hero: be.hero ?? null,
    description: be.description ?? null,
    genres: be.genres ?? [],
    tags: be.tags ?? [],
    rawg_slug: be.rawgSlug ?? null,
  };
}
export const adaptLibrary = (arr) => (Array.isArray(arr) ? arr.map(adaptLibraryEntry) : []);

// ---- Audit --------------------------------------------------------------
// api returns { data:[…], nextCursor } (architecture.html §6 keyset page). Preserve
// the page envelope as { rows, nextCursor } so the store can WALK the cursor — the
// log is paginated, and a single fetch would leave everything older than the first
// page permanently unreachable (the real bug this fixes). `nextCursor` is the
// opaque rowid of the oldest row in this page, or null when there are no older
// rows. Row shapes align (actor carries an extra `kind` harmlessly).
export function adaptAudit(page) {
  const rows = page && Array.isArray(page.data) ? page.data : Array.isArray(page) ? page : [];
  return { rows: rows.map((e) => ({ ...e })), nextCursor: (page && page.nextCursor) || null };
}

// ---- Host logs (the aggregated leaf-service journal) --------------------
// GET /hosts/{id}/logs → { data:[LogLine], nextCursor }. Each line is already the
// honest FE shape the LogConsole renders ({ id, at, source, level, text }) — the
// backend tags `source` (watchdog/monitor/assistant/firewall/api/bot) and maps the
// syslog priority to level. Honest passthrough: a missing level is "info" (never an
// invented "error"), a missing text is "" — never fabricated. `id` is the journald
// cursor (also the React key + the keyset paging cursor). Shared by the REST page
// (adaptLogPage) and the live `log.line` stream frame (adaptStreamMessage).
export function adaptLogLine(l) {
  return {
    id: l && l.id,
    at: l && l.at,
    source: (l && l.source) || "unknown",
    level: (l && l.level) || "info",
    text: (l && l.text) != null ? l.text : "",
  };
}
export function adaptLogPage(page) {
  const rows = page && Array.isArray(page.data) ? page.data : Array.isArray(page) ? page : [];
  return { rows: rows.map(adaptLogLine), nextCursor: (page && page.nextCursor) || null };
}

// ---- Services board (host leaf control center) --------------------------
// GET /hosts/{id}/services → { data:[LeafService] }. One KGSM leaf per row, joining its live systemd
// liveness with the api's deep-health probe where it has one. HONEST passthrough: a field the backend
// omits (it doesn't measure it) stays null — NEVER a fabricated 0/false/"running". `state` is systemd's
// own word (active|inactive|failed|…|not-installed|unknown); `health` is null when the api has no probe
// for that leaf (firewall/bot), distinct from a probed down/unknown. `onDemand` flags a socket-activated
// leaf (the firewall) so an `inactive` state renders as idle, not a fault.
export function adaptService(s) {
  if (!s) return null;
  const h = s.health ? { status: s.health.status || "unknown", message: s.health.message || null } : null;
  return {
    id: s.id,
    displayName: s.displayName || s.id,
    role: s.role || "",
    unit: s.unit || "",
    state: s.state || "unknown",
    onDemand: !!s.onDemand,
    subState: s.subState || null,
    enabled: s.enabled == null ? null : !!s.enabled,
    since: s.since || null,
    mainPid: s.mainPid == null ? null : s.mainPid,
    memoryBytes: s.memoryBytes == null ? null : s.memoryBytes,
    // Runtime provisioning state (the API↔leaf connection, distinct from systemd liveness): true/false
    // for the four provisionable leaves (monitor/watchdog/assistant/firewall), honest NULL for api/bot
    // (not provisionable). A leaf can be `active` on the host yet disconnected from the API, or
    // provisioned yet down — so this never collapses into `state`. null in → null out (never a false).
    provisioned: s.provisioned == null ? null : !!s.provisioned,
    health: h,
  };
}
export function adaptServices(page) {
  const rows = page && Array.isArray(page.data) ? page.data : Array.isArray(page) ? page : [];
  return rows.map(adaptService).filter(Boolean);
}

// ---- Host capabilities (the live capability set) ------------------------
// The hosts/{id}/capabilities → capabilities.patch frame carries the FULL HostCapabilities block
// ({metrics,assistant,watchdog}, each {provisioned,status,since?,message?,info?}). It is already the
// FE capability shape (adaptHost passes be.capabilities straight through), so this only HARDENS it:
// keep every record the backend sent as a plain object, drop a non-object record, invent nothing.
// `provisioned` is now RUNTIME-FLIPPABLE (a leaf connected/disconnected at runtime), so a patch can
// flip a capability absent↔present — the store folds it per-key so the metrics freshness stamp survives.
export function adaptCapabilities(block) {
  if (!block || typeof block !== "object") return {};
  const out = {};
  for (const k of Object.keys(block)) {
    const rec = block[k];
    if (rec && typeof rec === "object") out[k] = { ...rec };
  }
  return out;
}

// ---- Leaf config (the per-leaf configuration surface) --------------------
// GET /hosts/{id}/services/{leaf}/config → LeafConfig. Every leaf ships a descriptor declaring its whole
// configurable surface, so this carries the FULL shape the config page renders: the display `groups`,
// whether this host can deliver a change at all (`editable` + the reason it cannot), and per field the
// provenance chain, the risk, and the bounds.
//
// HONESTY is load-bearing here in three places:
//   • SECRETS — a secret's value is ALWAYS null on the wire and the form must never echo it. `set` (is
//     one stored?) + `fingerprint` (last-4) are all the UI gets. Forced null here as defence in depth,
//     across `value`, `floor` and `effective` alike.
//   • PROVENANCE — `source` says which tier `effective` came from, and `"unknown"` means the host could
//     not read the leaf's own config source. It is NEVER quietly downgraded to `"default"`: the page has
//     to be able to say "I don't know what this leaf is running with".
//   • UNSET vs EMPTY — `null` is "nothing supplies this"; `""` is "the leaf's config supplies an empty
//     value" (several settings read that as "fall back to the machine name"). Neither is coerced.
export function adaptLeafConfigField(f) {
  if (!f) return null;
  const isSecret = f.type === "secret" || !!f.isSecret;
  const str = (v) => (v == null ? null : String(v));
  const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);
  return {
    key: f.key,
    envName: f.envName || null,
    label: f.label || f.key,
    description: f.description || null,
    type: f.type || "string",
    enum: Array.isArray(f.enum) ? f.enum : null,
    isSecret,
    overridden: !!f.overridden,
    value: isSecret ? null : str(f.value),
    default: str(f.default),
    set: isSecret ? !!f.set : null,
    fingerprint: isSecret ? (f.fingerprint || null) : null,
    // The provenance chain: what the leaf's own deploy files set, what it is actually running with,
    // and which tier that came from.
    floor: isSecret ? null : str(f.floor),
    effective: isSecret ? null : str(f.effective),
    source: f.source || "unknown",
    // Presentation + safety metadata from the descriptor.
    group: f.group || null,
    risk: f.risk || "safe",
    unit: f.unit || null,
    min: num(f.min),
    max: num(f.max),
    pairedApiKey: f.pairedApiKey || null,
    dependsOn: f.dependsOn || null,
  };
}
export function adaptLeafConfig(be) {
  if (!be) return null;
  return {
    leaf: be.leaf || null,
    displayName: be.displayName || be.leaf || null,
    unit: be.unit || null,
    // Sections, ascending by order. Empty for a leaf whose surface renders flat.
    groups: Array.isArray(be.groups)
      ? be.groups
          .filter(g => g && g.id != null)
          .map(g => ({ id: g.id, label: g.label || g.id, order: typeof g.order === "number" ? g.order : 0 }))
          .sort((a, b) => a.order - b.order)
      : [],
    // Whether a PUT would be accepted, and why not. A leaf can be readable and not editable — the API
    // itself publishes its surface for reading only, and a host that has not wired a leaf's drop-in
    // cannot deliver a change to it. Default true only when the backend omits the field entirely.
    editable: be.editable !== false,
    editableReason: be.editableReason || null,
    applyMode: be.applyMode || "restart",
    // False means the leaf has not shipped a descriptor and only the keys this API historically knew
    // are exposed — the page says so rather than implying the short list is the whole surface.
    fromDescriptor: !!be.fromDescriptor,
    fields: Array.isArray(be.fields) ? be.fields.map(adaptLeafConfigField).filter(Boolean) : [],
  };
}
// PUT /hosts/{id}/services/{leaf}/config → LeafConfigApplyResult { outcome, health, message, config }.
// outcome ∈ applied | rolled_back | unchanged | applied_unreachable — the UI renders each HONESTLY.
// A rollback is NOT a success: the value did not stick and the leaf was restored. `applied_unreachable`
// is the signature of a wiring change: it WAS applied and the leaf restarted cleanly, but the API can no
// longer reach it — reported rather than reverted, because a silent revert would misreport what is
// running. `config` is the fresh LeafConfig the form re-reads from.
export function adaptLeafConfigApply(be) {
  if (!be) return { outcome: "unchanged", health: null, message: null, config: null };
  const h = be.health ? { status: be.health.status || "unknown", message: be.health.message || null } : null;
  return {
    outcome: be.outcome || "unchanged",
    health: h,
    message: be.message || null,
    config: be.config ? adaptLeafConfig(be.config) : null,
  };
}

// ---- Alerts -------------------------------------------------------------
// api returns { data:[Alert] }; the FE alerts store consumes an array. The
// honest backend shape carries no `icon` — an icon is PRESENTATION, not a
// measured fact (like SERVER_STATUS maps a run-state to a label), so we derive
// one from the alert's real `source`/`severity`. source→icon is the honest
// common path; the severity map is the fallback for a producer this map does
// not name.
const ALERT_ICON_BY_SOURCE = {
  watchdog: "alert-triangle",
  "host-monitor": "server",
  metrics: "gauge",
  assistant: "sparkles",
  // kgsm itself — update availability. Same glyph the audit log gives
  // `server.update_available`, so the condition and the event that produced it
  // read as the same thing across the two surfaces.
  engine: "circle-arrow-up",
};
const ALERT_ICON_BY_SEVERITY = { danger: "alert-triangle", warn: "circle-alert", info: "info" };
function alertIcon(a) {
  return ALERT_ICON_BY_SOURCE[a.source] || ALERT_ICON_BY_SEVERITY[a.severity] || "circle-alert";
}
// One alert: honest passthrough of every field the API sources (id/severity/
// source/title/detail/serverId/hostId/anchor/status/raisedAt/escalated/attempts/
// resolvedAt/resolution) plus a derived display icon. Shared by the REST page
// (below) and the live `alert.raise` stream message (adaptStreamMessage).
export function adaptAlert(a) {
  if (!a) return a;
  return { ...a, icon: a.icon || alertIcon(a) };
}
export function adaptAlerts(page) {
  const rows = page && Array.isArray(page.data) ? page.data : Array.isArray(page) ? page : [];
  return rows.map(adaptAlert);
}

// ---- Jobs (command progress over the `jobs` stream) --------------------
// API Job state is queued|running|succeeded|failed|cancelled; the FE job tracker reads a coarse
// waiting-vs-working-vs-done — a spinner while it runs, a position while it waits, nothing once it
// is over. Collapse every terminal state to the FE's "done" so the store logic
// (`state === "done" ? clear : { verb, state }`) stays simple. `cancelled` is terminal for the same
// reason the other two are: nothing further will happen to that job, and leaving it live would pin a
// row to a verb that was never attempted.
const JOB_TERMINAL = { succeeded: true, failed: true, cancelled: true };
export function adaptJob(be) {
  if (!be) return be;
  return {
    id: be.id,
    serverId: be.serverId,
    verb: be.verb,
    state: JOB_TERMINAL[be.state] ? "done" : be.state,
    error: be.error ?? null,
    phase: be.phase ?? null,       // install sub-phase: "preparing"|"downloading"|"deploying"
    blueprint: be.blueprint ?? null, // carry through so SSE-driven phantom can look up cover art
    // Which batch issued this job, and where it sits in that batch's line. Null for a hand-issued
    // command, which is what most jobs are. The position is a COUNT, never a clock: it says which of
    // eight queued servers moves next, and offers no time, because how long a verb takes is not
    // something anything here has measured.
    batchId: be.batchId ?? null,
    queuedPosition: be.queuedPosition ?? null,
    // What became of it, beside whether anything more will happen to it. `state` answers the second
    // question and is all a server's row needs; a queue lane showing settled work has to tell a
    // cancellation from a success, and collapsing all three terminal words leaves only `error` to
    // tell them apart — which reads a job nobody ran as one that succeeded. Null while it is live:
    // an outcome nobody has observed is not a value to carry.
    outcome: JOB_TERMINAL[be.state] ? be.state : null,
    // The API's own timestamps, passed through. `settledAt` is when the node finished with it, which
    // is the only honest "when" a settled row can show — the alternative is stamping the moment this
    // browser happened to receive the frame.
    createdAt: be.createdAt ?? null,
    settledAt: be.settledAt ?? null,
  };
}

// Build a phantom server row for an in-progress install. Injected into serversStore
// immediately on POST /servers 202 (or reactively from job.patch SSE for other users),
// flagged _phantom:true so the card renders its installing state instead of lifecycle actions.
// This is the row for an install the backend has no instance for YET — the engine publishes one
// partway through, and from that point the phantom is a real row that keeps rendering as a phantom
// because its job says so (stores/servers.js owns that rule). It is handed over to an ordinary card
// by the verify frame that follows the install settling.
export function adaptPhantom({ id, blueprint, cover, hero, displayName, hostId, label }) {
  return {
    id,
    // The label the install was asked to carry, when this client is the one that asked. A phantom the
    // jobs stream raised knows only the id the engine assigned, and that is what it reads as — the
    // real label arrives with the server.patch that hands the row over.
    name: label || id,
    hostId: hostId ?? null,
    blueprint: blueprint ?? null,
    runtime: null,
    version: null,
    game: displayName || blueprint || id,
    cover: cover ?? null,
    hero: hero ?? null,
    status: "installing",
    players: null,
    uptime: null,
    ip: null,
    // An install in flight has no backups and has not been scanned — honestly unknown, not a measured zero.
    last_backup: null,
    backup_count: null,
    log: [],
    cpu: null,
    ram: null,
    metrics: null,
    network: null,
    connectPort: null,
    steamAppId: null,
    clientSteamAppId: null,
    isSteamAccountRequired: false,
    job: { verb: "install", state: "queued", phase: null },
    _phantom: true,
  };
}

// ---- Me (caller identity + tier) ---------------------------------------
// /me drives the per-host tier (the persona / route gate). Honest passthrough;
// tier falls back to "none" (secure-by-default), never a fabricated role.
export function adaptMe(be) {
  if (!be) return be;
  return {
    user: be.user || null,
    tier: be.tier || "none",
    // Why the caller holds nothing, when they hold nothing: "pending" is waiting on an
    // admin, "unknown" is a host that has no account for them. Same tier, different
    // sentences. Anything unrecognised reads as unknown rather than as a guess.
    status: be.status === "active" || be.status === "pending" || be.status === "disabled"
      ? be.status
      : "unknown",
    scopes: be.scopes || [],
    // Recent login history (device = user-agent, may be null). Honest empty
    // default when the backend omits it — never fabricated.
    recentLogins: Array.isArray(be.recentLogins) ? be.recentLogins : [],
  };
}

// ---- Me patch (a live change to what this account holds on a host) ------
// The `me.patch` frame carries the two facts the session record gates on, and
// nothing else — it is a patch, not a second /me, so it never stands in for an
// identity. Same vocabulary as `adaptMe`: an unrecognised tier reads `none` and
// an unrecognised status reads `unknown`, because inventing either would hand
// somebody a role, or an explanation, the node never gave.
export function adaptMePatch(be) {
  if (!be) return be;
  return {
    tier: be.tier === "viewer" || be.tier === "operator" || be.tier === "admin" ? be.tier : "none",
    status: be.status === "active" || be.status === "pending" || be.status === "disabled"
      ? be.status
      : "unknown",
  };
}

// ---- Sessions (GET /auth/sessions, root-routed) ------------------------
// A caller's (or, admin-scoped, another user's) active session list. Hardens
// every row against a partial/missing field — honest null, never invented —
// and guards the envelope itself so a malformed/empty response renders as no
// sessions instead of crashing the settings UI.
export function adaptSessions(json) {
  const rows = json && Array.isArray(json.data) ? json.data : [];
  return {
    sessions: rows.map((r) => ({
      sid: r.sid,
      userId: r.userId,
      created: r.created ?? null,
      lastSeen: r.lastSeen ?? null,
      expires: r.expires ?? null,
      userAgent: r.userAgent ?? null,
      current: !!r.current,
    })),
  };
}

// One integration provider's config (GET /integrations/{provider}). The API view
// is already FE-shaped (camelCase); this only hardens it — `events` always an
// array, `webhook` always present — so the settings UI never crashes on a partial.
// The webhook secret is NEVER on the wire: `webhook.hint` is a masked display hint
// (…/webhooks/{id}/{tok}***), never the URL — so it must stay display-only and never
// be sent back. `bot` is honestly null for webhook-only providers (Discord is
// one-way; Slack omits it entirely).
export function adaptIntegration(be) {
  if (!be) return be;
  return {
    provider: be.provider || null,
    webhook: be.webhook || { configured: false, hint: null },
    channelLabel: be.channelLabel != null ? be.channelLabel : null,
    bot: be.bot || null,
    enabled: !!be.enabled,
    events: Array.isArray(be.events) ? be.events : [],
  };
}

// ---- Assistant review (the leaf page's Overview + Conversations tabs) -----
// GET /assistant/admin/conversations/stats|users|?user=…|/{handle}. The assistant leaf owns these
// shapes and kgsm-api relays them verbatim, so these adapters only HARDEN — they never reshape.
//
// The honesty rule is the whole job here. The leaf deliberately distinguishes a COUNT (0 because the
// thing did not happen) from an unmeasured DISTRIBUTION (null because nothing was measured), and that
// distinction has to survive the boundary: coercing a null median to 0 would render "instant", which
// is a fabricated measurement. `nullableNum` keeps null null; `count` floors a missing count at 0
// because a count genuinely is zero when the log holds nothing.
const nullableNum = (v) => (typeof v === "number" && isFinite(v) ? v : null);
const count = (v) => (typeof v === "number" && isFinite(v) ? v : 0);

export function adaptAssistantStats(be) {
  if (!be || typeof be !== "object") return null;
  return {
    conversations: count(be.conversations),
    deletedConversations: count(be.deletedConversations),
    actors: count(be.actors),
    turns: count(be.turns),
    okTurns: count(be.okTurns),
    errorTurns: count(be.errorTurns),
    capHitTurns: count(be.capHitTurns),
    cancelledTurns: count(be.cancelledTurns),
    unrecordedOutcomeTurns: count(be.unrecordedOutcomeTurns),
    medianTurnMs: nullableNum(be.medianTurnMs),
    p95TurnMs: nullableNum(be.p95TurnMs),
    maxTurnMs: nullableNum(be.maxTurnMs),
    medianIterations: nullableNum(be.medianIterations),
    maxIterations: nullableNum(be.maxIterations),
    medianContextPercent: nullableNum(be.medianContextPercent),
    maxContextPercent: nullableNum(be.maxContextPercent),
    contextWindow: nullableNum(be.contextWindow),
    thinkingTurns: count(be.thinkingTurns),
    turnsWithoutTool: count(be.turnsWithoutTool),
    toolCalls: count(be.toolCalls),
    tools: Array.isArray(be.tools) ? be.tools.map(t => ({
      name: t && t.name ? String(t.name) : "",
      // A tool the leaf's catalog does not define. Never inferred here — the SPA holds no catalog,
      // and guessing would either hide a real invention or invent one.
      known: t ? !!t.known : true,
      calls: count(t && t.calls),
      medianMs: nullableNum(t && t.medianMs),
      maxMs: nullableNum(t && t.maxMs),
      failedCalls: count(t && t.failedCalls),
    })).filter(t => t.name) : [],
    promptVersions: Array.isArray(be.promptVersions) ? be.promptVersions.map(p => ({
      hash: p && p.hash ? String(p.hash) : null,
      turns: count(p && p.turns),
      okTurns: count(p && p.okTurns),
      medianMs: nullableNum(p && p.medianMs),
      // What people said about this prompt version. `rated` is the denominator: a bucket with one
      // thumbs-down out of one vote is not a worse prompt than one with ten out of a hundred.
      negativeTurns: count(p && p.negativeTurns),
      ratedTurns: count(p && p.ratedTurns),
    })) : [],
    activity: Array.isArray(be.activity) ? be.activity.map(a => ({
      date: a && a.date ? String(a.date) : null,
      turns: count(a && a.turns),
    })).filter(a => a.date) : [],
    // What the leaf is configured to be right now. Without it the numbers are unreadable — a median
    // of 2 tool steps means nothing until you know the cap is 16.
    runtime: be.runtime && typeof be.runtime === "object" ? {
      model: be.runtime.model || null,
      contextWindow: nullableNum(be.runtime.contextWindow),
      maxIterations: nullableNum(be.runtime.maxIterations),
      actionsEnabled: !!be.runtime.actionsEnabled,
    } : null,
    // What people said about the answers. `ratedTurns` is a COUNT (0 is real — nobody voted), while
    // `satisfactionPercent` is a DISTRIBUTION and stays null when nothing was rated: 0% would assert
    // that every answer failed. The two must be read together, which is why the coverage travels with
    // the rate rather than being derivable only from a ratio.
    ratedTurns: count(be.ratedTurns),
    positiveTurns: count(be.positiveTurns),
    negativeTurns: count(be.negativeTurns),
    satisfactionPercent: nullableNum(be.satisfactionPercent),
    feedbackNotes: Array.isArray(be.feedbackNotes) ? be.feedbackNotes.map(n => ({
      conversationId: n && n.conversationId ? String(n.conversationId) : null,
      turnId: count(n && n.turnId),
      note: n && n.note ? String(n.note) : "",
      prompt: n && n.prompt != null ? String(n.prompt) : null,
      at: (n && n.at) || null,
    })).filter(n => n.note) : [],
  };
}

// One row per person who has talked to this assistant. `displayName` is null for conversations
// recorded before names were captured — the surface shows the raw id then. NEVER derive a name from
// an id: the id is a Discord snowflake and any "name" made from it would be fabricated.
export function adaptAssistantReviewUser(be) {
  if (!be || !be.userId) return null;
  return {
    userId: String(be.userId),
    displayName: be.displayName != null ? String(be.displayName) : null,
    conversationCount: count(be.conversationCount),
    deletedCount: count(be.deletedCount),
    turnCount: count(be.turnCount),
    firstActivityAt: be.firstActivityAt || null,
    lastActivityAt: be.lastActivityAt || null,
  };
}

export function adaptAssistantReviewUsers(page) {
  const rows = page && Array.isArray(page.data) ? page.data : Array.isArray(page) ? page : [];
  return rows.map(adaptAssistantReviewUser).filter(Boolean);
}

// One reviewable conversation. `id` is the leaf's OPAQUE handle — never parsed or composed here.
export function adaptAssistantConversation(be) {
  if (!be || !be.id) return null;
  return {
    id: String(be.id),
    title: be.title != null ? String(be.title) : null,
    createdAt: be.createdAt || null,
    lastActivityAt: be.lastActivityAt || null,
    turnCount: count(be.turnCount),
    deleted: !!be.deleted,
    errorTurns: count(be.errorTurns),
    capHitTurns: count(be.capHitTurns),
    // Turns this person marked unhelpful — what makes a conversation worth opening.
    negativeTurns: count(be.negativeTurns),
  };
}

export function adaptAssistantConversations(page) {
  const rows = page && Array.isArray(page.data) ? page.data : Array.isArray(page) ? page : [];
  return rows.map(adaptAssistantConversation).filter(Boolean);
}
