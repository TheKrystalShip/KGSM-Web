import { Icon } from "./Icon.jsx";
import { reachStore } from "../lib/apiClient.js";
import { CONNECTIONS } from "../lib/config.js";
import { useStore } from "../lib/store.js";
import { hostsStore } from "../lib/stores.js";
import { sessionStore, TIER_LABEL } from "../lib/sessionStore.js";
import { statusTone } from "../lib/formatting.js";
import { nodeLabel } from "../lib/nodeLabel.js";

// host-helpers.jsx — shared host-related UI components extracted from page files.
//
// These were previously co-located in DiagnosticsPage.jsx, HostAccess.jsx, and
// the sign-in screen. They are reusable components consumed across pages and components.

// ---------- Fan-out reach disclosure ----------

const REACH_TEXT = {
  unreachable: "didn't answer",
  unauthenticated: "couldn't be signed in to",
  unauthorized: "refused this session",
  error: "returned an error",
};

// The honest footnote on an aggregated surface: which nodes did NOT contribute
// to what you are looking at. Without it, a node dropping out of the fan-out is
// indistinguishable from its servers having been deleted.
//
// Silent when every node answered, and silent at N=1 — a lone node's failure is
// already the app-wide connectivity banner's story, and repeating it here would
// be noise. A node with no recorded read yet is not counted against anything.
function ClusterReach({ className = "" }) {
  const byHost = useStore(reachStore, s => s.byHost);
  const hosts = useStore(hostsStore, s => s.list);
  // The denominator is the connection set — the nodes we drive — so a stale
  // entry for a node no longer connected can never be counted against it.
  const known = CONNECTIONS.filter(c => byHost[c.url]);
  if (CONNECTIONS.length <= 1 || known.length <= 1) return null;
  const degraded = known.filter(c => !byHost[c.url].ok);
  if (!degraded.length) return null;
  const labelOf = (conn) => {
    const rec = byHost[conn.url];
    const id = conn.id || (rec && rec.id);
    const h = id && hosts.find(x => x.id === id);
    return (h && h.name) || conn.name || (rec && rec.name) || id || conn.url;
  };
  return (
    <div className={"cluster-reach " + className}>
      <Icon name="triangle-alert" size={13} />
      <span>
        {known.length - degraded.length} of {known.length} nodes reported
        {degraded.map(c => " · " + labelOf(c) + " " + (REACH_TEXT[byHost[c.url].reason] || "is degraded")).join("")}
      </span>
    </div>
  );
}

// ---------- Per-node access degradation ----------

// The nodes that refuse this session, reported as a list rather than as a gate.
//
// A node can refuse in two ways, and they are not the same thing: `denied` is
// terminal (your Discord role grants nothing there — re-logging in changes
// nothing), `expired` is recoverable with one gesture. Neither is a reason to
// take the whole panel away: sessions are per node, so the rest of the cluster
// is still yours to use, and the surfaces already disclose the rows that node
// would have contributed (ClusterReach). What is owed is naming the node and
// offering the one action that fixes it.
//
// A node we couldn't REACH is not a node that refused us, so it is not reported
// here — its session lands on `expired/unreachable`, which says nothing about
// whether we'd be let in. That is ClusterReach's story ("didn't answer"), and
// offering "Re-authorize" for it would be a diagnosis we never measured.
//
// The expired rows read `reauthDue`, not the raw status: an access token lapses
// every 15 minutes and the seam rotates it away in one round-trip, and a notice
// that asks for a sign-in the user doesn't owe is worse than no notice at all.
// A lapse that outlives the surfacing delay is reported as it always was.
//
// Driven by the SESSION records, not by the host list: a node that refuses us
// contributes no row to `GET /hosts`, so reading the host list would silently
// drop the very nodes this exists to name. The list is only consulted for a
// display name, with the connection's own label behind it.
//
// Silent when every node accepts us.
function NodeAccessNotice({ onReauth, onManage }) {
  const hosts = useStore(hostsStore, s => s.list);
  const sessions = useStore(sessionStore, s => s.byHost);
  const nameOf = (id) => nodeLabel(id, hosts);
  const refused = Object.keys(sessions).filter(id => {
    const rec = sessions[id];
    if (rec.status === "denied") return true;
    return !!rec.reauthDue && rec.error !== "unreachable";
  });
  if (!refused.length) return null;
  return (
    <div className="node-access" role="status">
      {refused.map(id => {
        const denied = sessions[id].status === "denied";
        const name = nameOf(id);
        return (
          <div key={id} className={"node-access__row node-access__row--" + (denied ? "denied" : "expired")}>
            <Icon name={denied ? "lock" : "rotate-cw"} size={14} />
            <span className="node-access__text">
              {denied
                ? <><b>{name}</b> doesn{"’"}t grant your Discord role access. Its servers aren{"’"}t shown.</>
                : <><b>{name}</b> ended your session. Its servers aren{"’"}t shown until you sign in again.</>}
            </span>
            {denied
              ? <button className="node-access__act" onClick={() => onManage && onManage({ id, name })}>Details</button>
              : <button className="node-access__act" onClick={() => onReauth && onReauth({ id, name })}>Sign in again</button>}
          </div>
        );
      })}
    </div>
  );
}

// ---------- The Node list-filter ----------

// Option list for a toolbar's "Node" field. This is a LIST filter: it narrows
// the rows on its own page and touches nothing outside it. The options are every
// node the panel drives, because every node's rows are on the page, and a filter
// with nothing to choose between hides itself (`nodeFilterOptions(...).length
// <= 2` — "All nodes" plus a lone node).
function nodeFilterOptions(hosts) {
  return [{ value: "all", label: "All nodes" }, ...(hosts || []).map(h => ({ value: h.id, label: h.name }))];
}

// ---------- Capacity meters (from DiagnosticsPage.jsx) ----------

// Derive the three capacity meters from a host record. `warnAt` is each meter's own
// amber threshold, carried so a reader ranking meters against each other can ask how
// far past its OWN line each one is — three meters that turn amber at 60/70/80 are not
// comparable by raw percentage (see hostHealth's `worst`).
function hostCapacityMeters(host) {
  if (!host || !host.cpu || !host.ram || !host.ram.total_gb) return [];
  const ramPct = Math.round((host.ram.used_gb / host.ram.total_gb) * 100);
  const fullest = host.disks.reduce((acc, d) => {
    const pct = (d.used_gb / d.total_gb) * 100;
    return pct > acc.pct ? { disk: d, pct } : acc;
  }, { disk: null, pct: 0 });
  const diskPct = Math.round(fullest.pct);
  const swapRatio = host.ram.swap_total_gb ? host.ram.swap_used_gb / host.ram.swap_total_gb : 0;

  return [
    {
      key: "cpu", icon: "cpu", label: "CPU", pct: host.cpu.usage_pct,
      value: host.cpu.usage_pct + "%",
      detail: "load " + host.cpu.load_avg[0].toFixed(1) + " \u00b7 " + host.cpu.cores + " cores",
      tone: statusTone(host.cpu.usage_pct, 60, 80), warnAt: 60,
    },
    {
      key: "ram", icon: "memory-stick", label: "Memory", pct: ramPct,
      value: ramPct + "%",
      detail: host.ram.used_gb.toFixed(1) + " / " + host.ram.total_gb + " GB",
      tone: statusTone(ramPct, 70, 85), warnAt: 70,
      flag: swapRatio > 0.3 ? "swap rising" : null,
    },
    {
      key: "disk", icon: "database", label: "Disk", pct: diskPct,
      value: diskPct + "%",
      detail: fullest.disk ? fullest.disk.mount + " \u00b7 " + fullest.disk.used_gb + " / " + fullest.disk.total_gb + " GB" : "\u2014",
      tone: statusTone(diskPct, 80, 90), warnAt: 80,
      flag: fullest.disk && fullest.disk.smart && fullest.disk.smart !== "ok" ? "SMART " + fullest.disk.smart : null,
    },
  ];
}

function CapacityMeter({ meter }) {
  return (
    <div className={"cap-meter cap-meter--" + meter.tone}>
      <div className="cap-meter__top">
        <span className="cap-meter__icon"><Icon name={meter.icon} size={14} strokeWidth={2.2} /></span>
        <span className="cap-meter__label">{meter.label}</span>
        <span className="cap-meter__value">{meter.value}</span>
      </div>
      <div className="cap-meter__track">
        <i className="cap-meter__fill" style={{ width: Math.max(2, Math.min(100, meter.pct)) + "%" }}></i>
      </div>
      <div className="cap-meter__detail">
        <span className="cap-meter__detail-text">{meter.detail}</span>
        {meter.flag && (
          <span className="cap-meter__flag"><Icon name="triangle-alert" size={10} strokeWidth={2.4} />{meter.flag}</span>
        )}
      </div>
    </div>
  );
}

function HostCapacityStrip({ host, title, hostLabel, onOpenDiagnostics, hideAlert }) {
  if (!host) return null;
  const meters = hostCapacityMeters(host);
  const rank = { success: 0, warn: 1, danger: 2 };
  const worst = meters.reduce((w, m) => (rank[m.tone] > rank[w.tone] ? m : w), meters[0]);
  const alert = !hideAlert && worst && worst.tone !== "success";
  return (
    <section className="cap-strip">
      <div className="cap-strip__head">
        <h2 className="cap-strip__title">
          <Icon name="server" size={14} />
          {title || "Host capacity"}
          {hostLabel && <span className="cap-strip__host">{hostLabel}</span>}
        </h2>
        {alert && (
          <span className={"cap-strip__alert cap-strip__alert--" + worst.tone}>
            <Icon name="triangle-alert" size={12} strokeWidth={2.4} />
            {worst.label} {worst.flag || ("at " + worst.value)}
          </span>
        )}
        <span style={{ flex: 1 }}></span>
        {onOpenDiagnostics && (
          <button className="dash-section__more" onClick={onOpenDiagnostics}>
            Diagnostics <Icon name="arrow-right" size={12} strokeWidth={2.2} />
          </button>
        )}
      </div>
      <div className="cap-strip__meters">
        {meters.length
          ? meters.map(m => <CapacityMeter key={m.key} meter={m} />)
          : <div className="cap-strip__empty"><Icon name="activity" size={13} /> Live metrics unavailable on this host</div>}
      </div>
    </section>
  );
}

// ---------- Host auth badge (from HostAccess.jsx) ----------

function HostAuthBadge({ hostId, size }) {
  const rec = useStore(sessionStore, s => s.byHost[hostId]) || { status: "none" };
  const TIER = TIER_LABEL;
  const map = {
    live:          { tone: "ok",   icon: "shield-check", label: TIER[rec.tier] || "Connected" },
    bootstrapping: { tone: "info", icon: "loader-2",     label: "Connecting\u2026", spin: true },
    expired:       { tone: "warn", icon: "rotate-cw",    label: "Reconnecting\u2026", spin: true },
    denied:        { tone: "danger", icon: "lock",       label: "No access" },
    none:          { tone: "muted", icon: "plug",        label: "Not connected" },
  };
  // A session the seam is mid-rotation on reads as connected: `expired` is written
  // on every 401, including the one the 15-minute token renewal produces, and the
  // badge speaks only once that lapse has outlived the surfacing delay (reauthDue)
  // — a "Reconnecting…" that resolves in 100ms reports nothing the user can act on.
  const shown = (rec.status === "expired" && !rec.reauthDue) ? "live" : rec.status;
  const m = map[shown] || map.none;
  return (
    <span className={"host-auth host-auth--" + m.tone + (size === "sm" ? " host-auth--sm" : "")} title={m.label}>
      <Icon name={m.icon} size={size === "sm" ? 11 : 12} className={m.spin ? "is-spinning" : ""} />
      <span className="host-auth__label">{m.label}</span>
    </span>
  );
}

// ---------- Host denied notice (from HostAccess.jsx) ----------

function HostDeniedNotice({ host, onBack, onManage, embedded }) {
  const name = (host && host.name) || "this host";
  return (
    <div className={"host-denied" + (embedded ? " host-denied--embedded" : "")}>
      <div className="host-denied__icon"><Icon name="lock" size={26} strokeWidth={1.8} /></div>
      <h2 className="host-denied__title">You don{"'"}t have permission on {name}</h2>
      <p className="host-denied__body">
        You{"'"}re signed in with Discord and <b>{name}</b> recognises you — but your Discord
        role doesn{"'"}t grant access here. Each host checks roles against its own
        community, so access can differ from host to host. Ask an admin of this
        host{"'"}s Discord to grant your role, then reconnect.
      </p>
      <div className="host-denied__actions">
        {onBack && <button className="host-btn host-btn--primary" onClick={onBack}><Icon name="layers" size={14} /> Back to all hosts</button>}
        {onManage && <button className="host-btn" onClick={onManage}><Icon name="server-cog" size={14} /> Manage hosts</button>}
      </div>
      <div className="host-denied__hint"><Icon name="info" size={12} /> This isn{"'"}t a sign-in problem — re-logging in won{"'"}t change your role. It{"'"}s set on {name}{"'"}s side.</div>
    </div>
  );
}

// ---------- OAuth providers ----------

// What each provider is called in a sentence. Presentation only — a host names its providers and
// says nothing about how to write them, so an unknown name falls through to the name itself rather
// than being hidden: a host wired to something this build has never heard of is still signable-in.
const PROVIDER_LABEL = { discord: "Discord", github: "GitHub", google: "Google", microsoft: "Microsoft" };

function providerLabel(provider) {
  return PROVIDER_LABEL[provider] || provider;
}

// How somebody signed in, in words. `local` is not a provider — it is the KGSM password — and the
// derived handle prefix says `local` for it, so every surface that renders the raw value tells the
// reader they signed in "via local". Shared so the sidebar and Settings cannot answer differently.
function signInMethodLabel(provider) {
  if (!provider) return "an unknown method";
  if (provider === "local") return "a KGSM password";
  return providerLabel(provider);
}

function OAuthIcon({ provider, size = 20 }) {
  const s = { width: size, height: size, display: "block" };
  if (provider === "discord") {
    return (
      <svg viewBox="0 0 24 24" style={s} fill="currentColor">
        <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.51 12.51 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.058a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.873-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .079.01c.12.099.246.198.373.291a.077.077 0 0 1-.006.128 12.3 12.3 0 0 1-1.873.891.076.076 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.548-13.66a.061.061 0 0 0-.031-.03ZM8.02 15.331c-1.183 0-2.157-1.085-2.157-2.418 0-1.334.955-2.42 2.157-2.42 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.955 2.418-2.157 2.418Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.418 0-1.334.955-2.42 2.157-2.42 1.21 0 2.175 1.095 2.157 2.42 0 1.333-.946 2.418-2.157 2.418Z"/>
      </svg>
    );
  }
  if (provider === "google") {
    return (
      <svg viewBox="0 0 24 24" style={s}>
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.25 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
      </svg>
    );
  }
  if (provider === "github") {
    return (
      <svg viewBox="0 0 24 24" style={s} fill="currentColor">
        <path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.7 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3"/>
      </svg>
    );
  }
  if (provider === "microsoft") {
    return (
      <svg viewBox="0 0 24 24" style={s}>
        <path fill="#F25022" d="M1 1h10v10H1z"/>
        <path fill="#7FBA00" d="M13 1h10v10H13z"/>
        <path fill="#00A4EF" d="M1 13h10v10H1z"/>
        <path fill="#FFB900" d="M13 13h10v10H13z"/>
      </svg>
    );
  }
  return null;
}

export { CapacityMeter, ClusterReach, HostAuthBadge, HostCapacityStrip, HostDeniedNotice, NodeAccessNotice, OAuthIcon, hostCapacityMeters, nodeFilterOptions, providerLabel, signInMethodLabel };
