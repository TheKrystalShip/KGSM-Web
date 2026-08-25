// DiagResources — the Resources sub-tab: the node's compute, from the monitor's live telemetry —
// CPU core grid and the RAM bar. Pure render from props — no hooks, no stores. Engine domain
// (placement libraries, ports) lives on the engine's and firewall's own pages; host plumbing the
// ecosystem doesn't manage (raw disks, network interfaces) is deliberately not surfaced here.

import { Icon } from "../../components/Icon.jsx";
import { StatusLed } from "./diagComponents.jsx";

function DiagResources({ host, fresh }) {
  const frozen = !!(fresh && fresh.frozen);
  const noTelemetry = !host.cpu || !Array.isArray(host.cpu.per_core) || host.cpu.per_core.length === 0 || !host.ram || !host.ram.total_gb;
  if (noTelemetry) {
    return (
      <div className="diag-empty">
        <Icon name="activity" size={18} strokeWidth={1.8} />
        <p>Live metrics are unavailable on this host{fresh && fresh.message ? " — " + fresh.message : "."}</p>
        <p className="diag-empty__sub">CPU and memory telemetry need the host's metrics agent to be running.</p>
      </div>
    );
  }
  const ageShort = fresh && fresh.label ? fresh.label.replace(/\s*ago$/, "") : null;
  const ramPct = Math.round((host.ram.used_gb / host.ram.total_gb) * 100);
  const hasBreakdown = host.ram.cached_gb != null && host.ram.buffers_gb != null;
  const cachedPct = hasBreakdown ? (host.ram.cached_gb / host.ram.total_gb) * 100 : 0;
  const bufPct = hasBreakdown ? (host.ram.buffers_gb / host.ram.total_gb) * 100 : 0;
  return (
    <div className="diag-2col">
      <div className={"chat-brief" + (frozen ? " is-frozen" : "")}>
        <div className="chat-brief__head">
          <span className="chat-brief__title">
            <Icon name="cpu" size={13} /> CPU
            <span className="chat-brief__count chat-brief__count--neutral">{host.cpu.cores} cores</span>
          </span>
          <span className="diag-meta-line">{host.cpu.model}</span>
          <StatusLed live={!frozen} label={frozen ? ageShort : null} />
        </div>
        <div className="chat-brief__pad">
          <div className="core-grid" style={{ "--core-count": host.cpu.per_core.length }}>
            {host.cpu.per_core.map((pct, i) => (
              <div key={i} className="core-cell" title={"core " + i + ": " + pct + "%"}>
                <div className="core-cell__bar"><i style={{ height: pct + "%", background: pct > 80 ? "var(--danger)" : pct > 60 ? "var(--warning)" : "var(--krystal-teal)" }}></i></div>
                <span className="core-cell__lbl">{i}</span>
              </div>
            ))}
          </div>
          <div className="diag-meta-line" style={{ marginTop: 14 }}>
            load 1m / 5m / 15m: <b>{host.cpu.load_avg[0].toFixed(1)}</b> · <b>{host.cpu.load_avg[1].toFixed(1)}</b> · <b>{host.cpu.load_avg[2].toFixed(1)}</b>
          </div>
        </div>
      </div>

      <div className={"chat-brief" + (frozen ? " is-frozen" : "")}>
        <div className="chat-brief__head">
          <span className="chat-brief__title">
            <Icon name="memory-stick" size={13} /> Memory
            <span className="chat-brief__count chat-brief__count--neutral">{host.ram.total_gb} GB</span>
          </span>
          <StatusLed live={!frozen} label={frozen ? ageShort : null} />
        </div>
        <div className="chat-brief__pad">
          <div className="ram-bar">
            <div className="ram-bar__seg" style={{ width: (ramPct - cachedPct - bufPct) + "%", background: "var(--krystal-teal)" }}></div>
            <div className="ram-bar__seg" style={{ width: cachedPct + "%",                       background: "var(--info)" }}></div>
            <div className="ram-bar__seg" style={{ width: bufPct + "%",                          background: "var(--update)" }}></div>
          </div>
          <div className="ram-legend">
            <span><span className="swatch" style={{ background: "var(--krystal-teal)" }}></span>used <b>{host.ram.used_gb.toFixed(1)} GB</b></span>
            {hasBreakdown && <span><span className="swatch" style={{ background: "var(--info)" }}></span>cached <b>{host.ram.cached_gb.toFixed(1)} GB</b></span>}
            {hasBreakdown && <span><span className="swatch" style={{ background: "var(--update)" }}></span>buffers <b>{host.ram.buffers_gb.toFixed(1)} GB</b></span>}
            <span><span className="swatch" style={{ background: "var(--surface-3)" }}></span>free <b>{host.ram.free_gb.toFixed(1)} GB</b></span>
          </div>
          <div className="diag-meta-line" style={{ marginTop: 14 }}>
            swap: <b>{host.ram.swap_used_gb} / {host.ram.swap_total_gb} GB</b>
            {host.ram.swap_used_gb / host.ram.swap_total_gb > 0.3 && (
              <span style={{ color: "var(--warning-fg)", marginLeft: 10 }}>↑ rising — investigate</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export { DiagResources };
