// Evidence cards — the rich diagnostic result renderers shown beneath an
// assistant's answer. Each card deep-links to the full context. Pure
// props-in, JSX-out — no local state, no parent coupling.

import { Icon } from "../components/Icon.jsx";
import { AuditEventRow } from "../components/AuditEventRow.jsx";
import { ChartHoverProvider } from "../components/TimeSeriesChart.jsx";
import { MetricsChartGrid } from "../pages/performance/MetricsChartGrid.jsx";
import { formatBytes, formatBps } from "../lib/formatting.js";

// `nodes` is the environment a card needs to name a NODE: the host roster and how to derive a host
// from an event. It arrives as props rather than being read from a store, because a surface with one
// leaf and no cluster has neither — and a card that reaches for the store barrel cannot render there.
// The default is the honest empty one: no roster, nothing to resolve, no node chip.
const NO_NODES = { hosts: [], resolveHost: (e) => (e && e.hostId) || null, showHost: false };

function ChatEvidence({ cards, onOpenServer, onOpenView, onRun, nodes = NO_NODES }) {
  if (!cards || !cards.length) return null;
  return (
    <div className="chat-evidence">
      <div className="chat-evidence__label">
        <Icon name="search-check" size={12} /> Evidence
      </div>
      {cards.map((c, i) => {
        if (c.kind === "performance") return <EvidencePerformance key={i} c={c} onOpen={() => onOpenServer && onOpenServer(c.serverId, "performance")} />;
        if (c.kind === "console")     return <EvidenceConsole     key={i} c={c} onOpen={() => onOpenServer && onOpenServer(c.serverId, "console")} />;
        if (c.kind === "config")      return <EvidenceConfig      key={i} c={c} onOpen={() => onOpenServer && onOpenServer(c.serverId, "files")} />;
        if (c.kind === "host")        return <EvidenceHost        key={i} c={c} onOpen={() => onOpenView && onOpenView("cluster")} />;
        if (c.kind === "fleet")       return <EvidenceFleet       key={i} c={c} />;
        if (c.kind === "network")     return <EvidenceNetwork     key={i} c={c} onOpen={() => onOpenView && onOpenView("cluster")} />;
        if (c.kind === "health")      return <EvidenceHealth      key={i} c={c} />;
        if (c.kind === "search")      return <EvidenceSearch      key={i} c={c} />;
        if (c.kind === "rootcause")   return <EvidenceRootCause   key={i} c={c} onOpenServer={onOpenServer} />;
        if (c.kind === "changes")     return <EvidenceChanges     key={i} c={c} onOpenServer={onOpenServer} />;
        if (c.kind === "audit")       return <EvidenceAudit          key={i} c={c} onOpenServer={onOpenServer} nodes={nodes} />;
        if (c.kind === "timeline")    return <EvidenceChangeTimeline key={i} c={c} onOpenServer={onOpenServer} />;
        if (c.kind === "blueprintOutcome") return <EvidenceBlueprintOutcome key={i} c={c} onRun={onRun} />;
        return null;
      })}
    </div>
  );
}

function ConfidenceBadge({ level }) {
  if (!level) return null;
  const meta = {
    confirmed: { label: "Confirmed", icon: "badge-check", title: "Directly measured" },
    likely:    { label: "Likely",    icon: "trending-up", title: "Inferred from correlation" },
    possible:  { label: "Possible",  icon: "help-circle", title: "Can\u2019t be measured directly" },
  }[level];
  if (!meta) return null;
  return (
    <span className={"ev-conf ev-conf--" + level} title={meta.title}>
      <Icon name={meta.icon} size={10} strokeWidth={2.4} />
      {meta.label}
    </span>
  );
}

function EvidenceCardShell({ icon, title, sub, onOpen, openLabel, children, confidence }) {
  return (
    <div className="ev-card">
      <div className="ev-card__head">
        <span className="ev-card__icon"><Icon name={icon} size={13} /></span>
        <div className="ev-card__titles">
          <span className="ev-card__title">{title}</span>
          {sub && <span className="ev-card__sub">{sub}</span>}
        </div>
        {confidence && <span className="ev-card__conf-label">Confidence:</span>}
        <ConfidenceBadge level={confidence} />
        {onOpen && (
          <button className="ev-card__open" onClick={onOpen}>
            {openLabel} <Icon name="arrow-right" size={12} strokeWidth={2.2} />
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function EvidencePerformance({ c, onOpen }) {
  // Trend read: the card carries a per-metric time series \u2192 render it through the
  // very same MetricsChartGrid the server Performance tab uses, so the chart cards
  // look and behave identically here (hover crosshair, full-screen pop-out,
  // per-window stats, log toggle). `compact` trims them for the chat column. A
  // metric with no points is simply omitted (never a fabricated flat line).
  if (c.mode === "trend") {
    const series = c.series && typeof c.series === "object" ? c.series : {};
    const hasData = Object.values(series).some((pts) => Array.isArray(pts) && pts.length > 0);
    // A shared wall-clock domain across every axis, so the synced crosshair lines
    // up CPU/memory/\u2026 by time even when they carry different sample counts.
    const allTs = Object.values(series)
      .flatMap((pts) => (Array.isArray(pts) ? pts : []))
      .map((p) => Date.parse(p.ts))
      .filter((n) => isFinite(n));
    const domain = allTs.length ? [Math.min(...allTs), Math.max(...allTs)] : undefined;
    return (
      <EvidenceCardShell icon="activity" title={"Resource trend \u00b7 " + c.serverName}
        sub={c.range ? "last " + c.range : "trend"}
        confidence={c.confidence} onOpen={onOpen} openLabel="Open Performance">
        {hasData ? (
          <div className="ev-perf-charts">
            <ChartHoverProvider>
              <MetricsChartGrid series={series} range={c.range || "24h"} domain={domain} compact />
            </ChartHoverProvider>
          </div>
        ) : (
          <div className="ev-perf-trend"><div className="ev-perf__na">no trend recorded for this window</div></div>
        )}
      </EvidenceCardShell>
    );
  }

  // A live snapshot readout. A null field is "not measured" (muted), never rendered as 0.
  const na = <span className="ev-perf__na">not measured</span>;
  const pair = (a, b) => {
    if (a == null && b == null) return na;
    return (
      <span className="ev-perf__pair">
        <Icon name="arrow-down" size={10} strokeWidth={2.2} /> {a == null ? "\u2014" : formatBps(a)}
        <Icon name="arrow-up" size={10} strokeWidth={2.2} style={{ marginLeft: 4 }} /> {b == null ? "\u2014" : formatBps(b)}
      </span>
    );
  };
  const rows = [
    { icon: "cpu",          label: "CPU",            value: c.cpuPctCore == null ? na : c.cpuPctCore + "% of one core" },
    { icon: "memory-stick", label: "Memory",         value: c.memBytes == null ? na : formatBytes(c.memBytes) },
    { icon: "arrow-down-up",label: "Network",        value: pair(c.rxBps, c.txBps) },
    { icon: "hard-drive",   label: "Disk I/O",       value: pair(c.ioReadBps, c.ioWriteBps) },
    { icon: "list",         label: "Processes",      value: c.pids == null ? na : String(c.pids) },
  ];
  if (c.diskBytes != null) rows.push({ icon: "database", label: "Disk footprint", value: formatBytes(c.diskBytes) });
  return (
    <EvidenceCardShell icon="activity" title={"Resource usage \u00b7 " + c.serverName} sub="live snapshot"
      confidence={c.confidence} onOpen={onOpen} openLabel="Open Performance">
      <div className="ev-perf">
        {rows.map((r, i) => (
          <div className="ev-perf__row" key={i}>
            <span className="ev-perf__icon"><Icon name={r.icon} size={12} /></span>
            <span className="ev-perf__label">{r.label}</span>
            <span className="ev-perf__value">{r.value}</span>
          </div>
        ))}
      </div>
    </EvidenceCardShell>
  );
}

function EvidenceConsole({ c, onOpen }) {
  return (
    <EvidenceCardShell icon="terminal-square" title={"Console \u00b7 " + c.serverName} sub={c.lines.length + " flagged line" + (c.lines.length === 1 ? "" : "s")}
      confidence={c.confidence} onOpen={onOpen} openLabel="Open Console">
      <div className="ev-console">
        {c.lines.map((l, i) => (
          <div className={"ev-console__line ev-console__line--" + l.tag} key={i}>
            <span className="ev-console__ts">{l.ts}</span>
            <span className="ev-console__tag">[{l.tag}]</span>
            <span className="ev-console__text">{l.text}</span>
          </div>
        ))}
      </div>
    </EvidenceCardShell>
  );
}

function EvidenceConfig({ c, onOpen }) {
  return (
    <EvidenceCardShell icon="file-text" title={c.file + " \u00b7 " + c.serverName} sub="relevant settings"
      confidence={c.confidence} onOpen={onOpen} openLabel="Open Files">
      <div className="ev-config">
        {c.rows.map((r, i) => (
          <div className={"ev-config__row" + (r.flagged ? " ev-config__row--hi" : "")} key={i}>
            <span className="ev-config__key">{r.key}</span>
            <span className="ev-config__val">{r.value}</span>
          </div>
        ))}
      </div>
    </EvidenceCardShell>
  );
}

function EvidenceHost({ c, onOpen }) {
  return (
    <EvidenceCardShell icon="server" title={"Host \u00b7 " + c.hostName} sub={c.problems.length + " issue" + (c.problems.length === 1 ? "" : "s")}
      confidence={c.confidence} onOpen={onOpen} openLabel="Open Diagnostics">
      <div className="ev-host">
        {c.problems.map((p, i) => (
          <div className={"ev-host__row ev-host__row--" + p.tone} key={i}>
            <Icon name={p.icon} size={12} />
            <span>{p.text}</span>
          </div>
        ))}
      </div>
    </EvidenceCardShell>
  );
}

function EvidenceChanges({ c, onOpenServer }) {
  const TONE = { info: "var(--info)", warn: "var(--warning)", update: "var(--update)" };
  return (
    <EvidenceCardShell icon="history" title={"What changed \u00b7 " + c.serverName} sub={c.windowLabel + " \u00b7 " + c.changes.length + " change" + (c.changes.length === 1 ? "" : "s")}
      confidence="confirmed"
      onOpen={() => onOpenServer && onOpenServer(c.serverId, "overview")} openLabel="Open server">
      <div className="ev-changes">
        {c.changes.map((ch, i) => (
          <div className="ev-changes__row" key={i}>
            <span className="ev-changes__icon" style={{ color: TONE[ch.tone] || "var(--fg-3)" }}><Icon name={ch.icon} size={12} /></span>
            <div className="ev-changes__body">
              <span className="ev-changes__label">{ch.label}<span className="ev-changes__by"> · {ch.by}</span></span>
              <span className="ev-changes__detail">{ch.detail}</span>
            </div>
            <span className="ev-changes__rel">{ch.rel}</span>
          </div>
        ))}
      </div>
    </EvidenceCardShell>
  );
}

// Shared dot color for get_audit_log / get_change_timeline rows. The tone is the one the audit
// page reads the same event in — what its producer stamped, on the danger/warn/info/success scale
// — so the two surfaces cannot colour one event two ways.
const EVENT_TONE_DOT = { danger: "var(--danger)", warn: "var(--warning)", info: "var(--info)", success: "var(--success)" };

// The row list both get_audit_log and get_change_timeline render, plus the two HONEST
// non-list states: the monitor couldn't be read (never narrated as "nothing happened"/
// "nothing changed"), and a real empty read (a measured "nothing recorded" — reuses the
// existing `.ev-changes` row layout, just with nothing to show).
function EventTimelineBody({ available, rows, emptyLabel, unavailableLabel }) {
  if (!available) {
    return <div className="ev-changes__empty">{unavailableLabel}</div>;
  }
  if (!rows.length) {
    return <div className="ev-changes__empty">{emptyLabel}</div>;
  }
  return (
    <div className="ev-changes">
      {rows.map((r, i) => (
        <div className="ev-changes__row" key={i}>
          <span className="ev-changes__icon" style={{ color: EVENT_TONE_DOT[r.tone] || "var(--fg-3)" }}>
            <Icon name={r.icon} size={12} />
          </span>
          <div className="ev-changes__body">
            <span className="ev-changes__label">{r.label}<span className="ev-changes__by"> · {r.by}</span></span>
            {r.detail && <span className="ev-changes__detail">{r.detail}</span>}
          </div>
          <span className="ev-changes__rel">{r.rel}</span>
        </div>
      ))}
    </div>
  );
}

// "Recent events" renders the SAME shared AuditEventRow the Audit page and dashboard use, so chat
// activity is visually consistent with the rest of the app — not a bespoke list. The two honest
// non-list states are kept: the monitor couldn't be read (never narrated as "nothing happened"), and
// a measured empty read ("nothing recorded"). `now` is a static snapshot — an evidence card is a
// point-in-time record in the conversation, so relative times don't tick (matching the other cards).
// "Recent events" renders the SAME shared AuditEventRow the Audit page and dashboard use, so chat
// activity is visually consistent with the rest of the app — not a bespoke list. The two honest
// non-list states are kept: the monitor couldn't be read (never narrated as "nothing happened"), and
// a measured empty read ("nothing recorded"). `now` is a static snapshot — an evidence card is a
// point-in-time record in the conversation, so relative times don't tick (matching the other cards).
function EvidenceAudit({ c, onOpenServer, nodes = NO_NODES }) {
  const scope = c.serverId ? "for " + c.serverName + " " : "";
  const now = new Date();
  return (
    <EvidenceCardShell icon="history" title={"Recent events" + (c.serverId ? " · " + c.serverName : "")}
      sub={[c.windowLabel, c.available && c.events.length ? c.events.length + " event" + (c.events.length === 1 ? "" : "s") : null]
        .filter(Boolean).join(" · ")}
      confidence={c.confidence}
      onOpen={c.serverId ? () => onOpenServer && onOpenServer(c.serverId, "overview") : undefined}
      openLabel="Open server">
      {!c.available ? (
        <div className="ev-changes__empty">
          Event history is unavailable right now — the metrics monitor isn’t reachable. That isn’t a
          sign nothing happened; the events just couldn’t be read.
        </div>
      ) : !c.events.length ? (
        <div className="ev-changes__empty">{"No events recorded " + scope + c.windowLabel + "."}</div>
      ) : (
        <div className="ev-audit">
          {c.events.map((ev) => (
            <AuditEventRow key={ev.id} ev={ev} now={now} hosts={nodes.hosts} avatarSize={24}
              showMeta={false} showHost={nodes.showHost} resolveHost={nodes.resolveHost} />
          ))}
        </div>
      )}
    </EvidenceCardShell>
  );
}

function EvidenceChangeTimeline({ c, onOpenServer }) {
  const scope = c.serverId ? "for " + c.serverName + " " : "";
  return (
    <EvidenceCardShell icon="git-commit-vertical" title={"What changed" + (c.serverId ? " · " + c.serverName : "")}
      sub={[c.windowLabel, c.available && c.changes.length ? c.changes.length + " change" + (c.changes.length === 1 ? "" : "s") : null]
        .filter(Boolean).join(" · ")}
      confidence={c.confidence}
      onOpen={c.serverId ? () => onOpenServer && onOpenServer(c.serverId, "overview") : undefined}
      openLabel="Open server">
      <EventTimelineBody
        available={c.available}
        rows={c.changes}
        emptyLabel={"No changes recorded " + scope + c.windowLabel +
          " (routine starts/stops and player activity don’t count as changes)."}
        unavailableLabel={"The change timeline is unavailable right now — the metrics monitor isn’t reachable. " +
          "That isn’t a sign nothing changed; the timeline just couldn’t be read."} />
    </EvidenceCardShell>
  );
}

function EvidenceRootCause({ c, onOpenServer }) {
  const TONE_DOT = { danger: "var(--danger)", warn: "var(--warning)", info: "var(--info)", success: "var(--success)" };
  const steps = Array.isArray(c.steps) ? c.steps : [];
  return (
    <EvidenceCardShell icon="git-merge" title={"Root cause \u00b7 " + c.serverName} sub={c.headline}
      confidence={c.confidence} onOpen={() => onOpenServer && onOpenServer(c.serverId, "overview")} openLabel="Open server">
      {steps.length === 0 ? (
        // Honest: no matched signature AND nothing to correlate (or every source was
        // unavailable) \u2014 the headline already says so; there is no evidence chain to draw.
        <div className="ev-changes__empty">No supporting evidence to show.</div>
      ) : (
        <div className="ev-chain">
          {steps.map((s, i) => (
            <div className={"ev-chain__step ev-chain__step--" + s.tone} key={i}>
              <span className="ev-chain__rail">
                <span className="ev-chain__dot" style={{ background: TONE_DOT[s.tone] || "var(--fg-3)" }}></span>
                {i < steps.length - 1 && <span className="ev-chain__line"></span>}
              </span>
              <span className="ev-chain__icon"><Icon name={s.icon} size={12} /></span>
              <div className="ev-chain__body">
                <span className="ev-chain__label">{s.label}</span>
                <span className="ev-chain__detail">{s.detail}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </EvidenceCardShell>
  );
}

function EvidenceHealth({ c }) {
  const verdict = c.fails ? "danger" : c.warns ? "warn" : "success";
  const headline = c.fails
    ? `${c.fails} issue${c.fails === 1 ? "" : "s"} found`
    : c.warns ? `${c.warns} thing${c.warns === 1 ? "" : "s"} to watch` : "All clear";
  const ICON = { pass: "check", warn: "alert-triangle", fail: "x", skip: "minus" };
  return (
    <EvidenceCardShell icon="stethoscope" title={"Health check \u00b7 " + c.serverName}
      sub={`${c.passes}/${c.checks.length} passed`}
      confidence={c.confidence}>
      <div className={"ev-health__verdict ev-health__verdict--" + verdict}>
        <Icon name={verdict === "success" ? "circle-check-big" : "alert-triangle"} size={13} />
        {headline}
      </div>
      <div className="ev-health">
        {c.checks.map((ck, i) => (
          <div className={"ev-health__row ev-health__row--" + ck.status} key={i}>
            <span className="ev-health__icon"><Icon name={ICON[ck.status]} size={11} strokeWidth={2.6} /></span>
            <span className="ev-health__label">{ck.label}</span>
            <span className="ev-health__detail">{ck.detail}</span>
          </div>
        ))}
      </div>
    </EvidenceCardShell>
  );
}

function EvidenceSearch({ c }) {
  const ORIGIN = { local: "file-text", web: "globe" };
  const title = c.provenance === "web" ? "Web search"
    : c.provenance === "mixed" ? "Docs & web"
    : "Indexed docs";
  const weak = c.state === "localWeak";
  const q = c.query ? "“" + c.query + "”" : "";
  return (
    <EvidenceCardShell icon="search" title={title}
      sub={weak ? "closest matches for " + q : q}
      confidence={c.confidence}>
      <div className="ev-search">
        {c.passages.map((p, i) => {
          const label = p.title || p.source || "source";
          return (
            <div className={"ev-search__row ev-search__row--" + p.origin} key={i}>
              <span className="ev-search__icon"><Icon name={ORIGIN[p.origin] || "file-text"} size={11} /></span>
              <div className="ev-search__body">
                {p.origin === "web" && p.source
                  ? <a className="ev-search__src" href={p.source} target="_blank" rel="noopener noreferrer">{label}</a>
                  : <span className="ev-search__src" title={p.source}>{label}</span>}
                {p.text && <span className="ev-search__snippet">{p.text}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </EvidenceCardShell>
  );
}

function EvidenceFleet({ c }) {
  const STATE = {
    running: { icon: "check",          label: "Running" },
    stopped: { icon: "minus",          label: "Stopped" },
    unknown: { icon: "alert-triangle", label: "Status unavailable" },
  };
  return (
    <EvidenceCardShell icon="layout-grid" title="Cluster status" sub={c.summary}
      confidence={c.confidence}>
      <div className="ev-fleet">
        {c.servers.map((s, i) => {
          const meta = STATE[s.state] || STATE.unknown;
          return (
            <div className={"ev-fleet__row ev-fleet__row--" + s.tone} key={i}>
              <span className="ev-fleet__icon"><Icon name={meta.icon} size={11} strokeWidth={2.6} /></span>
              <span className="ev-fleet__name">{s.instance}</span>
              <span className="ev-fleet__state">{s.reason || meta.label}</span>
            </div>
          );
        })}
      </div>
    </EvidenceCardShell>
  );
}

// A firewall port rule is a range; a single port collapses start==end. Protocol trails.
function fmtPortRange(p) {
  const span = p.start == null ? "\u2014"
    : (p.end != null && p.end !== p.start ? p.start + "\u2013" + p.end : String(p.start));
  return p.protocol ? span + "/" + p.protocol : span;
}

// get_network \u2014 the two-layer reachability picture for one server: the HOST FIREWALL
// (which ports KGSM has opened, the active backend, whether it's enforcing) and the
// ROUTER's UPnP forwards (what's reachable from the internet). The two axes are separate
// authorities that fail independently; each honest-unknown state renders as its own
// "couldn't read" note, NEVER as a measured "nothing open / nothing forwarded".
function EvidenceNetwork({ c, onOpen }) {
  const fw = c.firewall || {};
  const rt = c.router || {};
  const fwPorts = fw.ports || [];
  const rtForwards = rt.forwards || [];

  const fwAvailable = fw.state === "available";
  const fwUnsupported = fw.listState === "unsupported";
  const fwUnknownList = fw.listState === "unknown";
  const rtQueried = rt.state === "queried";

  const fwSummary = !fwAvailable ? "firewall unreadable"
    : fwUnsupported ? "no firewall backend"
    : fwPorts.length ? fwPorts.length + " firewall port" + (fwPorts.length === 1 ? "" : "s") + " open"
    : fwUnknownList ? "firewall rules unreadable"
    : "no firewall ports open";
  const rtSummary = rtQueried
    ? (rtForwards.length ? rtForwards.length + " router forward" + (rtForwards.length === 1 ? "" : "s") : "no router forwards")
    : rt.state === "routerUnavailable" ? "router unreachable"
    : "watchdog unreachable";

  return (
    <EvidenceCardShell icon="network" title={"Network \u00b7 " + c.serverName}
      sub={fwSummary + " \u00b7 " + rtSummary}
      confidence={c.confidence} onOpen={onOpen} openLabel="Open Diagnostics">
      <div className="ev-net">
        {/* Host firewall layer */}
        <div className="ev-net__layer">
          <div className="ev-net__layer-head">
            <Icon name="shield" size={11} strokeWidth={2.2} />
            <span>Host firewall</span>
            {fwAvailable && fw.backend && <code className="ev-net__backend">{fw.backend}</code>}
            {fwAvailable && fw.enforcement === "inactive" && (
              <span className="ev-net__flag ev-net__flag--warn">not enforcing</span>
            )}
          </div>
          {!fwAvailable ? (
            <div className="ev-net__note">
              {"Couldn\u2019t read the firewall \u2014 that isn\u2019t a sign nothing is open; it just couldn\u2019t be checked."}
            </div>
          ) : fwUnsupported ? (
            <div className="ev-net__note">No firewall backend is active on this host.</div>
          ) : fwPorts.length ? (
            <div className="ev-net__ports">
              {fwPorts.map((p, i) => (
                <span className="ev-net__port ev-net__port--open" key={i}>
                  <Icon name="check" size={11} strokeWidth={2.6} />
                  <code>{fmtPortRange(p)}</code>
                </span>
              ))}
            </div>
          ) : fwUnknownList ? (
            <div className="ev-net__note">{"The firewall is up, but its rules couldn\u2019t be enumerated."}</div>
          ) : (
            <div className="ev-net__note">No ports opened for this server.</div>
          )}
        </div>

        {/* Router / UPnP layer */}
        <div className="ev-net__layer">
          <div className="ev-net__layer-head">
            <Icon name="globe" size={11} strokeWidth={2.2} />
            <span>Router forwards (UPnP)</span>
          </div>
          {rtQueried ? (
            rtForwards.length ? (
              <div className="ev-net__forwards">
                {rtForwards.map((f, i) => (
                  <div className="ev-net__forward" key={i}>
                    <code>{(f.externalPort == null ? "\u2014" : f.externalPort) + (f.protocol ? "/" + f.protocol : "")}</code>
                    <Icon name="arrow-right" size={11} strokeWidth={2.2} />
                    <code>{[f.internalClient, f.internalPort].filter((v) => v != null).join(":") || "\u2014"}</code>
                  </div>
                ))}
              </div>
            ) : (
              <div className="ev-net__note">{"No forwards on the router \u2014 this server isn\u2019t reachable from the internet."}</div>
            )
          ) : rt.state === "routerUnavailable" ? (
            <div className="ev-net__note">{"The router couldn\u2019t be queried, so its forwards are unknown."}</div>
          ) : (
            <div className="ev-net__note">{"The watchdog isn\u2019t reachable, so router forwards couldn\u2019t be read."}</div>
          )}
        </div>
      </div>
    </EvidenceCardShell>
  );
}

// create_blueprint's terminal outcome — the ONLY two-way fork in the chat: either the
// missing game is now empirically proven in the catalog, or it honestly couldn't be
// added automatically. No YAML, no mention of the disposable test host — the user gets
// a plain-language result and, on success, one decision ("Make me a server"), which
// hands off into the SAME install path a proposed `install` command already uses
// (`onRun` here is ChatPage's `runLiveCommand` — no new API, no new confirm flow).
function EvidenceBlueprintOutcome({ c, onRun }) {
  const name = c.displayName || c.slug || "this game";
  const handleMakeServer = () => {
    if (!onRun || !c.slug) return;
    onRun({ verb: "install", subjectId: c.slug, instanceName: null, cmdId: null });
  };
  if (c.ok) {
    return (
      <EvidenceCardShell icon="package-plus" title={"Added to the catalog · " + name}
        sub={c.proof || undefined} confidence={c.confidence}>
        <div className="ev-bp ev-bp--ok">
          <div className="ev-bp__verdict">
            <Icon name="circle-check-big" size={13} />
            <span>
              {"I didn’t have " + name + ", so I researched it, built a config, and test-ran it"}
              {c.proof ? " — it " + c.proof + "." : "."}
              {" "}<b>{name + " is now in the catalog."}</b>
            </span>
          </div>
          <button type="button" className="ev-bp__cta" onClick={handleMakeServer}>
            <Icon name="server" size={13} strokeWidth={2.2} />
            Make me a server
          </button>
        </div>
      </EvidenceCardShell>
    );
  }
  return (
    <EvidenceCardShell icon="octagon-x" title={"Couldn’t add " + name} confidence={c.confidence}>
      <div className="ev-bp ev-bp--fail">
        <div className="ev-bp__verdict">
          <Icon name="alert-triangle" size={13} />
          <span>{c.reason || (name + " needs something beyond what I can set up automatically.")}</span>
        </div>
      </div>
    </EvidenceCardShell>
  );
}

export { ChatEvidence, ConfidenceBadge, EvidenceCardShell };
