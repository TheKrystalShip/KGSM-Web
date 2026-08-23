// DiagResources — the Resources sub-tab: CPU core grid, RAM bar, disk list,
// libraries, network interface table, open-ports table. Pure render from props —
// no hooks, no stores; the libraries card owns its own state and is its own file.

import { Icon } from "../../components/Icon.jsx";
import { DiagLibraries } from "./DiagLibraries.jsx";
import { StatusLed } from "./diagComponents.jsx";

function DiagResources({ host, fresh, servers = [], onOpenServerSettings }) {
  const frozen = !!(fresh && fresh.frozen);
  const noTelemetry = !host.cpu || !Array.isArray(host.cpu.per_core) || host.cpu.per_core.length === 0 || !host.ram || !host.ram.total_gb;
  if (noTelemetry) {
    // The libraries card still renders. Where a node can put a server is the engine's answer, not the
    // monitor's — a host with no metrics agent has exactly the same disks declared to it.
    return (
      <>
        <div className="diag-empty">
          <Icon name="activity" size={18} strokeWidth={1.8} />
          <p>Live metrics are unavailable on this host{fresh && fresh.message ? " — " + fresh.message : "."}</p>
          <p className="diag-empty__sub">CPU, memory, disk and network telemetry need the host's metrics agent to be running.</p>
        </div>
        <DiagLibraries host={host} />
      </>
    );
  }
  const ageShort = fresh && fresh.label ? fresh.label.replace(/\s*ago$/, "") : null;
  const ramPct = Math.round((host.ram.used_gb / host.ram.total_gb) * 100);
  const hasBreakdown = host.ram.cached_gb != null && host.ram.buffers_gb != null;
  const cachedPct = hasBreakdown ? (host.ram.cached_gb / host.ram.total_gb) * 100 : 0;
  const bufPct = hasBreakdown ? (host.ram.buffers_gb / host.ram.total_gb) * 100 : 0;
  const serverName = (id) => (servers.find(s => s.id === id) || {}).name || id;
  const portExposure = (p) => p.exposure || (p.app === "sshd" ? "lan" : "public");
  const PORT_COLS = "92px minmax(110px, 1fr) minmax(150px, 1.4fr) 104px 18px";
  return (
    <>
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

      {/* Ahead of the disks list: where a server CAN go is the actionable half, and a card of
         right-aligned controls at the very bottom of the page sits under the assistant dock's
         floating button. */}
      <DiagLibraries host={host} />

      {/* Disks */}
      {host.disks && host.disks.length > 0 && (
        <div className={"chat-brief" + (frozen ? " is-frozen" : "")} style={{ marginTop: 16 }}>
          <div className="chat-brief__head">
            <span className="chat-brief__title">
              <Icon name="database" size={13} /> Disk{host.disks.length > 1 ? "s" : ""}
              <span className="chat-brief__count chat-brief__count--neutral">{host.disks.length}</span>
            </span>
            <StatusLed live={!frozen} label={frozen ? ageShort : null} />
          </div>
          <div className="disk-list">
            {host.disks.map((d, i) => {
              const pct = d.total_gb > 0 ? Math.round((d.used_gb / d.total_gb) * 100) : 0;
              const tone = pct > 90 ? "danger" : pct > 80 ? "warn" : "success";
              const smart = d.smart === "warn" ? "warn" : d.smart === "fail" ? "danger" : "success";
              return (
                <div className="disk-row" key={i}>
                  <div className="disk-row__head">
                    <code className="disk-row__mount">{d.mount}</code>
                    {d.device && <span className="disk-row__device">{d.device}</span>}
                    {d.fs && <span className="disk-row__fs">{d.fs}</span>}
                    <span style={{ flex: 1 }}></span>
                    {d.smart && <span className={"disk-row__smart disk-row__smart--" + smart}>SMART: {d.smart}</span>}
                  </div>
                  <div className="disk-row__bar">
                    <i className={"disk-row__fill disk-row__fill--" + tone} style={{ width: pct + "%" }}></i>
                  </div>
                  <div className="disk-row__usage">
                    <span><b>{d.used_gb}</b> / {d.total_gb} GB used</span>
                    <span style={{ marginLeft: "auto" }}>{pct}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Network — interfaces + open ports in one card */}
      {host.network && (
        (host.network.interfaces && host.network.interfaces.length > 0) ||
        (host.network.open_ports && host.network.open_ports.length > 0)
      ) && (
        <div className={"chat-brief" + (frozen ? " is-frozen" : "")} style={{ marginTop: 16 }}>
          <div className="chat-brief__head">
            <span className="chat-brief__title">
              <Icon name="network" size={13} /> Network
              {host.network.interfaces && host.network.interfaces.length > 0 && (
                <span className="chat-brief__count chat-brief__count--neutral">{host.network.interfaces.length} iface</span>
              )}
            </span>
            <StatusLed live={!frozen} label={frozen ? ageShort : null} />
          </div>
          {host.network.interfaces && host.network.interfaces.length > 0 && (
            <div className="iface-list">
              {host.network.interfaces.map((iface, i) => (
                <div className="iface-row" key={i}>
                  <code className="iface-row__name">{iface.name}</code>
                  <span className="iface-row__ip">{iface.ip || "—"}</span>
                  <span className="iface-row__mac">{iface.mac || "—"}</span>
                  <span className="iface-row__metric">
                    <span style={{ color: "var(--fg-3)" }}>↓</span> <b>{iface.rx_kbps || 0}</b> kbps
                  </span>
                  <span className="iface-row__metric">
                    <span style={{ color: "var(--fg-3)" }}>↑</span> <b>{iface.tx_kbps || 0}</b> kbps
                  </span>
                  {iface.errors != null && (
                    <span className={"iface-row__errors" + (iface.errors > 0 ? " iface-row__errors--bad" : "")}>
                      {iface.errors} errors
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
          {host.network.open_ports && host.network.open_ports.length > 0 && (
            <div className="ports-block">
              <div className="ports-block__head">
                Open ports <span className="ports-block__count">{host.network.open_ports.length}</span>
              </div>
              <div className="card-table">
                <div className="card-table__head" style={{ gridTemplateColumns: PORT_COLS }}>
                  <span className="card-table__th">Port</span>
                  <span className="card-table__th">Service</span>
                  <span className="card-table__th">Owner</span>
                  <span className="card-table__th">Exposure</span>
                  <span></span>
                </div>
                {host.network.open_ports.map((p, i) => {
                  const exp = portExposure(p);
                  return (
                    <div className="card-table__row" key={i} style={{ gridTemplateColumns: PORT_COLS }}>
                      <span className="card-table__cell port-num"><b>{p.port}</b><span className="port-proto">/{p.proto || "tcp"}</span></span>
                      <span className="card-table__cell port-svc">{p.app || "—"}</span>
                      <span className="card-table__cell">
                        {p.server ? (
                          <button className="port-owner port-owner--link" onClick={() => onOpenServerSettings && onOpenServerSettings(p.server)} title={"Configure " + serverName(p.server)}>
                            <Icon name="gamepad-2" size={13} />
                            <span className="port-owner__name">{serverName(p.server)}</span>
                            <Icon name="arrow-up-right" size={12} />
                          </button>
                        ) : (
                          <span className="port-owner port-owner--host"><Icon name="server" size={13} /> Host service</span>
                        )}
                      </span>
                      <span className="card-table__cell">
                        <span className={"port-exp port-exp--" + exp}>
                          <Icon name={exp === "public" ? "globe" : "lock"} size={11} /> {exp === "public" ? "Public" : "LAN"}
                        </span>
                      </span>
                      <span className="card-table__cell port-chevron">
                        {p.server && <Icon name="chevron-right" size={15} />}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

export { DiagResources };
