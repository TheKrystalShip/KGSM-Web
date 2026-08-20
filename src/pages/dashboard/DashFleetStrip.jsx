// DashFleetStrip — the dashboard's "Cluster capacity" card: one expandable row
// per CLUSTER NODE (connected host + federation "ghost" peers this browser
// holds no host session for), built from the same `buildClusterNodes` merge the
// Cluster page renders from — capacity can't be averaged across machines, so
// it's one row per node.
//
// The row is progressive disclosure, in two halves:
//
//   COLLAPSED — what you scan: status dot, name, region, hostname, the ONE
//   worst signal stated in words, servers running, players on, round trip. A
//   verdict rather than three bars, so four nodes read in the height three
//   meters used to take.
//
//   OPEN — what you read: the three capacity meters WITH their absolute
//   readings (load + cores, used/total GB, the fullest mount), then every disk
//   by mount, swap, CPU model, OS, kernel, uptime, network both ways, the
//   hottest sensor, a chip per leaf, and the four actions.
//
// A LONE node opens by default. With one node there is no list to scan and
// nothing to compare, so a collapsed row would be a chevron guarding a card
// with nothing else in it; the chevron still closes it, and the auto-open lapses
// the moment a second node joins.
//
// Everything rendered is a field the host DTO already carries. A node whose
// metrics feed is down has no capacity to show and says so — never a zero.

import React from "react";
import { BriefCard } from "../../components/BriefCard.jsx";
import { alertsTone, anchoredAlerts } from "../../components/ContextualAlerts.jsx";
import { HostMeters, hostHealth, hostMetricsFreshness } from "../../components/HostCardBody.jsx";
import { Icon } from "../../components/Icon.jsx";
import { CAP_ORDER, CAP_META, capUsable, hostCapability } from "../../lib/capabilities.js";
import { uptimeShort } from "../../lib/formatting.js";
import { playerTally } from "../../lib/servers.js";
import { useStore } from "../../lib/store.js";
import { serversStore } from "../../lib/stores.js";
import { membershipRowTone } from "../diagnostics/clusterBadges.jsx";

// ---------- the collapsed line's one chip ----------

// The single worst thing true about this node, in words. Ordered by what stops
// you using the node at all, then by what stops the readings meaning anything,
// then by the capacity itself. Never a number the node didn't report: a feed
// that is down produces "no readings", not 0%.
function signalChip(h, health, fresh) {
  const { denied, metricsDown, meters, worst } = health;
  if (denied) return { tone: "danger", icon: "lock", text: "No access on this node" };
  if (!h.online) return { tone: "muted", icon: h._pending ? "loader-2" : "moon", text: h._pending ? "Awaiting telemetry" : "Disconnected" };
  if (metricsDown) return { tone: "warn", icon: "activity", text: "Metrics unavailable" };
  // Numbers we HAVE but that stopped updating are worse than no numbers shown
  // as a verdict — say they're frozen rather than reporting a stale meter as live.
  if (fresh && fresh.frozen) return { tone: "warn", icon: "activity", text: "Readings frozen" + (fresh.label ? " · " + fresh.label : "") };
  if (!meters.length) return { tone: "muted", icon: "activity", text: "No capacity readings" };
  if (!worst || worst.tone === "success") return { tone: "ok", icon: "shield-check", text: "All clear" };
  return { tone: worst.tone === "danger" ? "danger" : "warn", icon: "triangle-alert", text: worst.label + " " + worst.value };
}

const chipClass = (tone) => "dash-node__chip" + (tone && tone !== "muted" ? " dash-node__chip--" + tone : "");

// ---------- drawer pieces ----------

function Fact({ label, value, title }) {
  if (value == null || value === "") return null;
  return <div className="dash-node__kv" title={title || undefined}><span>{label}</span><b>{value}</b></div>;
}

function FactBlock({ title, children }) {
  return (
    <div className="dash-node__block">
      <div className="dash-node__block-h">{title}</div>
      {children}
    </div>
  );
}

// Every leaf this node offers, and how it is right now. Reads the same
// capability model the rest of the panel switches on, so a leaf that isn't
// offered says so rather than going missing.
function LeafChips({ host }) {
  return (
    <div className="dash-node__leaves">
      {CAP_ORDER.map(id => {
        const cap = hostCapability(host, id);
        const tone = cap.tone === "success" ? "ok" : cap.tone === "warn" ? "warn" : cap.tone === "danger" ? "danger" : "muted";
        return (
          <span key={id} className={chipClass(tone)} title={cap.message || cap.stateLabel}>
            <Icon name={CAP_META[id].icon} size={11} strokeWidth={2.2} />
            {id}
            {cap.state !== "operational" && <span className="dash-node__leaf-state">{cap.stateLabel.toLowerCase()}</span>}
          </span>
        );
      })}
    </div>
  );
}

// The action row. Four verbs, all of which land somewhere that already exists:
// this node's servers, its logs, its assistant, its page. "Ask" renders only
// where there IS an assistant — it is a per-host leaf with no central fallback,
// so offering it on a node that has none would be a button that can't work.
function NodeActions({ host, onOpenServers, onOpenLogs, onAsk, onOpen }) {
  return (
    <div className="dash-node__acts">
      <button className="dash-node__act" onClick={() => onOpenServers && onOpenServers(host.id)}>
        <Icon name="layers" size={12} /> Servers on this node
      </button>
      <button className="dash-node__act" onClick={() => onOpenLogs && onOpenLogs(host.id)}>
        <Icon name="terminal" size={12} /> Node logs
      </button>
      {capUsable(host, "assistant") && (
        <button className="dash-node__act" onClick={() => onAsk && onAsk(host.id)}>
          <Icon name="bot" size={12} /> Ask about {host.name}
        </button>
      )}
      <button className="dash-node__act dash-node__act--primary" onClick={() => onOpen && onOpen(host.id)}>
        <Icon name="arrow-right" size={12} /> Open node
      </button>
    </div>
  );
}

// ---------- rows ----------

// A federation peer with no connected host: nothing about it is measured here,
// so the drawer says exactly that and offers the one place that knows more.
function GhostRow({ n, open, onToggle, onViewCluster }) {
  const tone = membershipRowTone(n.fed.membership);
  return (
    <div className={"dash-node dash-node--ghost" + (open ? " is-open" : "")}>
      <button className="dash-node__line" onClick={onToggle} aria-expanded={open}>
        <span className="dash-node__id">
          <span className={"dash-node__dot dash-node__dot--" + tone}></span>
          <span className="dash-node__name">{n.fed.label}</span>
        </span>
        <span className="dash-node__chips">
          <span className={chipClass("muted")}><Icon name="radar" size={11} /> Discovered · not connected</span>
        </span>
        <span className="dash-node__ping">
          {n.latencyMs != null ? <><Icon name="zap" size={11} />{Math.round(n.latencyMs)}ms</> : null}
        </span>
        <Icon name="chevron-right" size={15} className="dash-node__chev" />
      </button>
      {open && (
        <div className="dash-node__body">
          <div className="dash-node__note">
            <Icon name="radar" size={13} />
            The cluster gossips about this peer, but this browser holds no session on it — nothing here is measured.
          </div>
          <div className="dash-node__grid">
            <FactBlock title="Federation">
              <Fact label="Membership" value={n.fed.membership} />
              <Fact label="Node id" value={n.fed.nodeId} />
              <Fact label="Reported latency" value={n.latencyMs != null ? Math.round(n.latencyMs) + " ms" : "—"} />
              <Fact label="Address" value={n.fed.clientUrl} />
            </FactBlock>
          </div>
          <div className="dash-node__acts">
            <button className="dash-node__act dash-node__act--primary" onClick={() => onViewCluster && onViewCluster()}>
              <Icon name="arrow-right" size={12} /> View in cluster
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function NodeRow({ n, open, onToggle, onOpenHost, onOpenServers, onOpenLogs, onAsk }) {
  const h = n.host;
  const servers = useStore(serversStore, s => s.list);
  const alerts = anchoredAlerts(an => an.surface === "diagnostics" && an.hostId === h.id);
  const health = hostHealth(h);
  const fresh = hostMetricsFreshness(h);
  const sig = signalChip(h, health, fresh);
  const mine = React.useMemo(() => servers.filter(s => s.hostId === h.id), [servers, h.id]);
  const running = mine.filter(s => s.status === "online").length;
  const { total: players, unseen } = playerTally(mine);

  // One row per FILESYSTEM, not per mount point. The monitor reports every mount,
  // and a subvolume or bind mount repeats the same numbers under another path —
  // three identical "274.8 / 915.3 GB" rows say nothing about three disks. Same
  // device + same fs + the same figures is one filesystem seen more than once; the
  // shortest path represents it and the others are named in its tooltip, so nothing
  // is hidden. An unsourced device ("\u2014") merges nothing, since the key falls
  // back to the mount itself.
  const disks = React.useMemo(() => {
    const rows = Array.isArray(h.disks) ? h.disks.filter(d => d && d.total_gb) : [];
    const byFs = new Map();
    for (const d of rows) {
      const key = d.device && d.device !== "\u2014"
        ? [d.device, d.fs, d.total_gb, d.used_gb].join("|")
        : d.mount;
      const seen = byFs.get(key);
      if (!seen) byFs.set(key, { ...d, also: [] });
      else if (d.mount.length < seen.mount.length) byFs.set(key, { ...d, also: [...seen.also, seen.mount] });
      else seen.also.push(d.mount);
    }
    return [...byFs.values()];
  }, [h.disks]);
  const sensors = Array.isArray(h.sensors) ? h.sensors : [];
  const hottest = sensors.length ? sensors.reduce((m, s) => (s.value_c > m.value_c ? s : m), sensors[0]) : null;
  const ifaces = (h.network && Array.isArray(h.network.interfaces)) ? h.network.interfaces : [];
  const rx = ifaces.reduce((sum, i) => sum + (i.rx_kbps || 0), 0);
  const tx = ifaces.reduce((sum, i) => sum + (i.tx_kbps || 0), 0);
  const swap = h.ram && h.ram.swap_total_gb
    ? (h.ram.swap_used_gb || 0).toFixed(1) + " / " + h.ram.swap_total_gb + " GB"
    : null;

  return (
    <div className={"dash-node dash-node--" + health.tone + (open ? " is-open" : "")}>
      <button className="dash-node__line" onClick={onToggle} aria-expanded={open}>
        <span className="dash-node__id">
          <span className={"dash-node__dot dash-node__dot--" + health.tone}></span>
          <span className="dash-node__name">{h.name}</span>
          {h.region && h.region !== "—" && <span className="dash-node__region">{h.region}</span>}
          {h.hostname && <span className="dash-node__host">{h.hostname}</span>}
        </span>
        <span className="dash-node__chips">
          {alerts.length > 0 && (
            <span className={chipClass(alertsTone(alerts) === "danger" ? "danger" : "warn")}>
              <Icon name="triangle-alert" size={11} strokeWidth={2.4} />
              {alerts.length} {alerts.length === 1 ? "alert" : "alerts"}
            </span>
          )}
          <span className={chipClass(sig.tone)}>
            <Icon name={sig.icon} size={11} strokeWidth={2.2} className={sig.icon === "loader-2" ? "is-spinning" : ""} />
            {sig.text}
          </span>
          <span className={chipClass("muted")}>
            <Icon name="server" size={11} /> {running}/{mine.length} srv
          </span>
          <span className={chipClass("muted")} title={unseen ? unseen + (unseen === 1 ? " server can't report who's on" : " servers can't report who's on") : undefined}>
            <Icon name="users" size={11} /> {players}{unseen ? "+" : ""} {players === 1 && !unseen ? "player" : "players"}
          </span>
        </span>
        <span className="dash-node__ping">
          {n.latencyMs != null ? <><Icon name="zap" size={11} />{Math.round(n.latencyMs)}ms</> : null}
        </span>
        <Icon name="chevron-right" size={15} className="dash-node__chev" />
      </button>

      {open && (
        <div className="dash-node__body">
          {health.meters.length ? (
            <div className={"dash-node__meters" + (fresh.frozen ? " dash-node__meters--frozen" : "")}>
              <HostMeters meters={health.meters} detail />
            </div>
          ) : (
            <div className="dash-node__note">
              <Icon name={health.denied ? "lock" : "activity"} size={13} />
              {health.denied
                ? "Your role on this node grants no access to it, so nothing here is measured."
                : !h.online
                  ? "This node isn't answering, so its capacity is unknown — not zero."
                  : "The metrics leaf isn't reporting, so this node's capacity is unknown. Its servers are still managed."}
            </div>
          )}
          {fresh.frozen && health.meters.length > 0 && (
            <div className="dash-node__note dash-node__note--warn">
              <Icon name="activity" size={13} />
              These readings stopped updating{fresh.label ? " " + fresh.label : ""}. They're the last ones measured, not live.
            </div>
          )}

          <div className="dash-node__grid">
            <FactBlock title="Machine">
              <Fact label="CPU" value={h.cpu && h.cpu.model && h.cpu.model !== "—" ? h.cpu.model + (h.cpu.cores ? " ×" + h.cpu.cores : "") : null} />
              <Fact label="Load" value={h.cpu && Array.isArray(h.cpu.load_avg) && h.cpu.load_avg.length ? h.cpu.load_avg.map(v => v.toFixed(2)).join("  ") : null} />
              <Fact label="OS" value={h.os} />
              <Fact label="Kernel" value={h.kernel} />
              <Fact label="Uptime" value={h.boot_time ? uptimeShort(h.boot_time) : "—"} />
            </FactBlock>
            <FactBlock title="Storage & memory">
              {disks.map(d => (
                <Fact key={d.mount} label={d.mount + (d.also.length ? " +" + d.also.length : "")}
                  title={d.also.length ? "Same filesystem, also mounted at " + d.also.join(", ") : d.device}
                  value={d.used_gb + " / " + d.total_gb + " GB"} />
              ))}
              <Fact label="Swap" value={swap} />
              <Fact label="Hottest sensor" value={hottest ? hottest.value_c + " °C" + (hottest.label ? " · " + hottest.label : "") : null} />
            </FactBlock>
            <FactBlock title="Link & leaves">
              <Fact label="Round trip" value={n.latencyMs != null ? Math.round(n.latencyMs) + " ms" : "—"} />
              <Fact label="Network" value={ifaces.length ? "↓ " + Math.round(rx) + " · ↑ " + Math.round(tx) + " kbps" : null} />
              <Fact label="Panel build" value={h.panel_version} />
              <LeafChips host={h} />
            </FactBlock>
          </div>

          <NodeActions host={h} onOpenServers={onOpenServers} onOpenLogs={onOpenLogs} onAsk={onAsk} onOpen={onOpenHost} />
        </div>
      )}
    </div>
  );
}

// ---------- the card ----------

function DashFleetStrip({ nodes, onOpenDiagnostics, onOpenHost, onOpenServersForNode, onOpenNodeLogs, onAskAboutNode }) {
  const [openKeys, setOpenKeys] = React.useState([]);
  // A lone node opens itself, once. Tracked by key rather than by a boolean so
  // re-opening is never forced on a node the user just closed, and so the
  // auto-open re-arms if the cluster drops back to one DIFFERENT node.
  const autoKey = nodes.length === 1 ? nodes[0].key : null;
  const autoApplied = React.useRef(null);
  React.useEffect(() => {
    if (autoKey && autoApplied.current !== autoKey) {
      autoApplied.current = autoKey;
      setOpenKeys([autoKey]);
    } else if (!autoKey) {
      autoApplied.current = null;
    }
  }, [autoKey]);

  const toggle = (key) => setOpenKeys(keys => keys.includes(key) ? keys.filter(k => k !== key) : [...keys, key]);

  return (
    <BriefCard
      icon="network"
      title="Cluster capacity"
      count={nodes.length}
      countTone="neutral"
      onViewAll={onOpenDiagnostics}
      className="dash-fleet"
    >
      <div className="dash-fleet__rows">
        {nodes.map(n => n.ghost
          ? <GhostRow key={n.key} n={n} open={openKeys.includes(n.key)} onToggle={() => toggle(n.key)} onViewCluster={onOpenDiagnostics} />
          : <NodeRow key={n.key} n={n} open={openKeys.includes(n.key)} onToggle={() => toggle(n.key)}
              onOpenHost={onOpenHost} onOpenServers={onOpenServersForNode} onOpenLogs={onOpenNodeLogs} onAsk={onAskAboutNode} />)}
      </div>
    </BriefCard>
  );
}

export { DashFleetStrip };
