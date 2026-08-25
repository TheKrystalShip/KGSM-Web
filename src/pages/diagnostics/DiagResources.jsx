// DiagResources — the Resources sub-tab: the node's compute, from the monitor's live telemetry.
// CPU core grid and the RAM bar; the kgsm.slice split (what the game servers collectively cost,
// measured at the parent cgroup); the GPUs, on a host that has any; the hwmon temperatures; and the
// recorded history (its own file — DiagHostHistory owns the fetch, everything here is pure render
// from props). Engine domain (placement libraries, ports) lives on the engine's and firewall's own
// pages; host plumbing the ecosystem doesn't manage (raw disks, network interfaces) is deliberately
// not surfaced here.

import { Icon } from "../../components/Icon.jsx";
import { fmtBytes } from "../../lib/formatting.js";
import { StatusLed } from "./diagComponents.jsx";
import { DiagHostHistory } from "./DiagHostHistory.jsx";

const GiB = 1073741824;

// The kgsm.slice split: the servers' collective share drawn against the host's own bar. CPU needs
// the thread count to put "percent of one core" and "percent of the host" on one axis — without it
// the share is stated in cores instead, never guessed into a bar.
function SliceCard({ host, frozen, ageShort }) {
  const slice = host.slice;
  const cpu = host.cpu;
  const ram = host.ram;
  const threads = (cpu && (cpu.threads || (cpu.per_core || []).length)) || null;

  const sliceCores = slice.cpu_pct_core != null ? slice.cpu_pct_core / 100 : null;
  const sliceCpuPct = slice.cpu_pct_core != null && threads
    ? (slice.cpu_pct_core / (threads * 100)) * 100 : null;
  const hostCpuPct = cpu && cpu.usage_pct != null ? cpu.usage_pct : null;
  const restCpuPct = sliceCpuPct != null && hostCpuPct != null
    ? Math.max(0, hostCpuPct - sliceCpuPct) : null;

  const sliceGb = slice.mem_bytes != null ? slice.mem_bytes / GiB : null;
  const sliceMemPct = sliceGb != null && ram && ram.total_gb ? (sliceGb / ram.total_gb) * 100 : null;
  const restMemGb = sliceGb != null && ram ? Math.max(0, ram.used_gb - sliceGb) : null;
  const restMemPct = restMemGb != null && ram && ram.total_gb ? (restMemGb / ram.total_gb) * 100 : null;

  return (
    <div className={"chat-brief" + (frozen ? " is-frozen" : "")}>
      <div className="chat-brief__head">
        <span className="chat-brief__title">
          <Icon name="gamepad-2" size={13} /> Game servers
          {slice.pids != null && (
            <span className="chat-brief__count chat-brief__count--neutral">{slice.pids} procs</span>
          )}
        </span>
        <span className="diag-meta-line">kgsm.slice</span>
        <StatusLed live={!frozen} label={frozen ? ageShort : null} />
      </div>
      <div className="chat-brief__pad">
        <div className="diag-meta-line">CPU</div>
        {sliceCpuPct != null ? (
          <>
            <div className="ram-bar" style={{ marginTop: 6 }}>
              <div className="ram-bar__seg" style={{ width: Math.min(100, sliceCpuPct) + "%", background: "var(--krystal-teal)" }}></div>
              {restCpuPct != null && (
                <div className="ram-bar__seg" style={{ width: Math.min(100 - Math.min(100, sliceCpuPct), restCpuPct) + "%", background: "var(--info)" }}></div>
              )}
            </div>
            <div className="ram-legend">
              <span><span className="swatch" style={{ background: "var(--krystal-teal)" }}></span>servers <b>{sliceCpuPct.toFixed(1)}%</b> (≈{sliceCores.toFixed(1)} cores)</span>
              {restCpuPct != null && <span><span className="swatch" style={{ background: "var(--info)" }}></span>rest of host <b>{restCpuPct.toFixed(1)}%</b></span>}
            </div>
          </>
        ) : (
          <div className="diag-meta-line" style={{ marginTop: 6 }}>
            {sliceCores != null
              ? <>servers <b>≈{sliceCores.toFixed(1)} cores</b></>
              : "first sample — no rate yet"}
          </div>
        )}

        <div className="diag-meta-line" style={{ marginTop: 14 }}>Memory</div>
        {sliceGb != null && sliceMemPct != null ? (
          <>
            <div className="ram-bar" style={{ marginTop: 6 }}>
              <div className="ram-bar__seg" style={{ width: Math.min(100, sliceMemPct) + "%", background: "var(--krystal-teal)" }}></div>
              {restMemPct != null && (
                <div className="ram-bar__seg" style={{ width: Math.min(100 - Math.min(100, sliceMemPct), restMemPct) + "%", background: "var(--info)" }}></div>
              )}
            </div>
            <div className="ram-legend">
              <span><span className="swatch" style={{ background: "var(--krystal-teal)" }}></span>servers <b>{fmtBytes(slice.mem_bytes)}</b></span>
              {restMemGb != null && <span><span className="swatch" style={{ background: "var(--info)" }}></span>rest of host <b>{restMemGb.toFixed(1)} GB</b></span>}
              {ram && <span><span className="swatch" style={{ background: "var(--surface-3)" }}></span>free <b>{ram.free_gb.toFixed(1)} GB</b></span>}
            </div>
          </>
        ) : (
          <div className="diag-meta-line" style={{ marginTop: 6 }}>memory unmeasured</div>
        )}
      </div>
    </div>
  );
}

// The GPUs — rendered only on a host that reports a readable card: a node without one is an
// ordinary node, not a degraded one, so there is no empty state to draw. VRAM per device, never
// summed across devices (it does not pool).
function GpuCard({ host, frozen, ageShort }) {
  const gpus = host.gpus;
  return (
    <div className={"chat-brief" + (frozen ? " is-frozen" : "")}>
      <div className="chat-brief__head">
        <span className="chat-brief__title">
          <Icon name="microchip" size={13} /> GPU
          {gpus.length > 1 && <span className="chat-brief__count chat-brief__count--neutral">{gpus.length}</span>}
        </span>
        <StatusLed live={!frozen} label={frozen ? ageShort : null} />
      </div>
      <div className="disk-list">
        {gpus.map((g) => {
          const pct = g.mem_used_gb != null && g.mem_total_gb
            ? Math.round((g.mem_used_gb / g.mem_total_gb) * 100) : null;
          const tone = pct == null ? "success" : pct > 90 ? "danger" : pct > 80 ? "warn" : "success";
          return (
            <div className="disk-row" key={g.uuid || g.index}>
              <div className="disk-row__head">
                <code className="disk-row__mount">{g.name}</code>
                <span style={{ flex: 1 }}></span>
                {g.temp_c != null && <span className="disk-row__fs">{g.temp_c.toFixed(0)}°C</span>}
                {g.power_w != null && (
                  <span className="disk-row__fs">{g.power_w.toFixed(0)}W{g.power_cap_w != null ? " / " + g.power_cap_w.toFixed(0) + "W" : ""}</span>
                )}
                {g.sm_pct != null && <span className="disk-row__fs">SM {g.sm_pct.toFixed(0)}%</span>}
              </div>
              {pct != null && (
                <div className="disk-row__bar">
                  <i className={"disk-row__fill disk-row__fill--" + tone} style={{ width: pct + "%" }}></i>
                </div>
              )}
              <div className="disk-row__usage">
                <span>
                  {g.mem_used_gb != null && g.mem_total_gb != null
                    ? <><b>{g.mem_used_gb.toFixed(1)}</b> / {g.mem_total_gb.toFixed(1)} GiB VRAM</>
                    : "VRAM unmeasured"}
                </span>
                {pct != null && <span style={{ marginLeft: "auto" }}>{pct}%</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Temperatures grouped by what they measure, and the fans that are turning. Emphasis only — a reading
// at 75°C+ is tinted and 90°C+ is red — while the thresholds that actually act live in the monitor's
// policy, not here.
//
// The monitor classifies each channel and sends a role and a human name; neither is derived here,
// because the daemon that read the register is the one that knows what it is. A reading with no role
// is unrecognised hardware rather than a doubtful measurement, so it still renders — under "Other",
// falling back to the raw chip/label pair.
const SENSOR_GROUPS = [
  ["cpu", "Processor"],
  ["gpu", "Graphics"],
  ["memory", "Memory"],
  ["drive", "Storage"],
  ["board", "Motherboard"],
  ["chipset", "Chipset"],
  ["network", "Network"],
];

function sensorLabel(s) {
  if (s.name) return s.name;
  return s.label ? s.chip + " · " + s.label : s.chip;
}

function SensorsCard({ host, frozen, ageShort }) {
  const sensors = host.sensors || [];
  const fans = Array.isArray(host.fans) ? host.fans : [];

  const groups = [];
  for (const [role, heading] of SENSOR_GROUPS) {
    const rows = sensors.filter((s) => s.role === role);
    if (rows.length) groups.push([heading, rows]);
  }
  const unclassified = sensors.filter((s) => !SENSOR_GROUPS.some(([role]) => s.role === role));
  if (unclassified.length) groups.push(["Other", unclassified]);

  const toneColor = (c) => (c >= 90 ? "var(--danger)" : c >= 75 ? "var(--warning)" : "var(--fg-1)");
  return (
    <div className={"chat-brief" + (frozen ? " is-frozen" : "")} style={{ marginTop: 16 }}>
      <div className="chat-brief__head">
        <span className="chat-brief__title">
          <Icon name="thermometer" size={13} /> Temperatures
          <span className="chat-brief__count chat-brief__count--neutral">{sensors.length}</span>
        </span>
        <StatusLed live={!frozen} label={frozen ? ageShort : null} />
      </div>
      <div className="chat-brief__pad">
        {groups.map(([heading, rows]) => (
          <div key={heading}>
            <div className="diag-subhead">{heading}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {rows.map((s) => (
                <span key={s.id} className="svc-fact" title={s.chip + (s.label ? " · " + s.label : "")}>
                  {sensorLabel(s)}
                  <b style={{ color: toneColor(s.value_c), marginLeft: 4 }}>{s.value_c.toFixed(1)}°C</b>
                </span>
              ))}
            </div>
          </div>
        ))}
        {fans.length > 0 && (
          <div>
            <div className="diag-subhead">Fans</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {fans.map((f) => (
                <span key={f.id} className="svc-fact" title={f.chip + (f.label ? " · " + f.label : "")}>
                  {f.name || f.chip}
                  <b style={{ marginLeft: 4 }}>{f.rpm.toLocaleString()} RPM</b>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

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
  const hasSlice = !!host.slice;
  const hasGpus = Array.isArray(host.gpus) && host.gpus.length > 0;
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

      {(hasSlice || hasGpus) && (
        <div className="diag-2col" style={{ marginTop: 16 }}>
          {hasSlice && <SliceCard host={host} frozen={frozen} ageShort={ageShort} />}
          {hasGpus && <GpuCard host={host} frozen={frozen} ageShort={ageShort} />}
        </div>
      )}

      {((Array.isArray(host.sensors) && host.sensors.length > 0)
        || (Array.isArray(host.fans) && host.fans.length > 0)) && (
        <SensorsCard host={host} frozen={frozen} ageShort={ageShort} />
      )}

      <DiagHostHistory host={host} />
    </>
  );
}

export { DiagResources };
