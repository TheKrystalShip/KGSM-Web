// DiagResources — the Resources sub-tab: the node's compute, from the monitor's live telemetry.
//
// The page is a band of glance tiles over three groups, in descending urgency: what the node is doing
// right now (CPU cores and the RAM bar, the kgsm.slice split, the GPUs), how hot it is running (the
// thermal panel, its own file — it fetches its own ranges so it pins as-is), and what it has been doing
// (the recorded history, likewise, in DiagHostHistory). The group headings state the tense, because a
// live reading, a 24-hour range and a recorded curve are three different claims and look alike.
//
// A device is named once. The GPUs' temperature is a thermal row like every other channel, so the GPU
// card here holds what only it can say: VRAM, power and utilisation.
//
// Engine domain (placement libraries, ports) lives on the engine's and firewall's own pages; host
// plumbing the ecosystem doesn't manage (raw disks, network interfaces) is deliberately not surfaced
// here.

import { Icon } from "../../components/Icon.jsx";
import { KPI } from "../../components/KPI.jsx";
import { fmtBytes, metricTone } from "../../lib/formatting.js";
import { useHostThresholds, ruleLines } from "../../lib/hostThresholds.js";
import { StatusLed } from "./diagComponents.jsx";
import { DiagHostHistory } from "./DiagHostHistory.jsx";
import { ThermalPanel } from "./ThermalPanel.jsx";

const GiB = 1073741824;

// A meter is always painted, so its healthy state is a filled bar rather than the tiles' silence.
const fillTone = (tone) => (tone === "muted" ? "success" : tone);

// The channel closest to the line it is judged by. This is the one cross-device comparison per-device
// limits make possible: 68.9° against 85 and 50.8° against 80.85 are not comparable as readings, and
// a plain maximum would name whichever device happens to run hot by design.
function nearestLimit(sensors, hostLines) {
  let best = null;
  for (const s of sensors || []) {
    if (s.primary === false) continue;
    const warn = s.limit_high_c ?? (hostLines ? hostLines.warn : null);
    if (!warn) continue;
    const pct = (s.value_c / warn) * 100;
    if (!best || pct > best.pct) {
      best = {
        sensor: s,
        pct,
        lines: { warn, danger: s.limit_critical_c ?? (hostLines ? hostLines.danger : null) },
      };
    }
  }
  return best;
}

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
// summed across devices (it does not pool). Temperature belongs to the thermal panel, which has the
// axis, the device's own limits and the window to put it in.
function GpuCard({ host, frozen, ageShort, memLines }) {
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
          const tone = fillTone(metricTone(pct, memLines, 80, 90));
          return (
            <div className="disk-row" key={g.uuid || g.index}>
              <div className="disk-row__head">
                <code className="disk-row__mount">{g.name}</code>
                <span style={{ flex: 1 }}></span>
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

function DiagResources({ host, fresh }) {
  const thresholds = useHostThresholds(host && host.id);
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
  const sensors = Array.isArray(host.sensors) ? host.sensors : [];
  const fans = Array.isArray(host.fans) ? host.fans : [];

  // Every line comes from what this host publishes, so a tile and the alert the same number would
  // raise cannot disagree. The literals are only for the quantities the host states no rule for.
  const memLines = ruleLines(thresholds, "HostMemUsedPct");
  const swapLines = ruleLines(thresholds, "HostSwapUsedPct");
  const gpuMemLines = ruleLines(thresholds, "HostGpuMemUsedPct");
  const tempLines = ruleLines(thresholds, "HostTempC");

  const swapPct = host.ram.swap_total_gb > 0
    ? (host.ram.swap_used_gb / host.ram.swap_total_gb) * 100 : null;
  const swapTone = metricTone(swapPct, swapLines, 50, 90);

  const gTone = (tone) => (frozen ? "off" : tone);
  const gLed = frozen ? "down" : "live";
  const gLedLabel = frozen ? ageShort : null;

  const threads = host.cpu.threads || host.cpu.per_core.length;
  const sliceCores = hasSlice && host.slice.cpu_pct_core != null ? host.slice.cpu_pct_core / 100 : null;

  // The fullest card, since VRAM does not pool — a mean across devices would describe none of them.
  const fullestGpu = hasGpus
    ? host.gpus.reduce((acc, g) => {
        const pct = g.mem_used_gb != null && g.mem_total_gb ? (g.mem_used_gb / g.mem_total_gb) * 100 : null;
        return pct != null && (acc.pct == null || pct > acc.pct) ? { gpu: g, pct } : acc;
      }, { gpu: host.gpus[0], pct: null })
    : null;

  const hottest = nearestLimit(sensors, tempLines);

  return (
    <>
      <div className={"diag-tiles" + (frozen ? " is-frozen" : "")}>
        <KPI icon="cpu" label="CPU" className="kpi--metric" led={gLed} ledLabel={gLedLabel}
          tone={gTone(metricTone(host.cpu.usage_pct, null, 60, 80))}
          value={host.cpu.usage_pct + "%"}
          sub={"load " + host.cpu.load_avg.map((v) => v.toFixed(1)).join(" / ") + " · " + threads + " threads"} />

        <KPI icon="memory-stick" label="Memory" className="kpi--metric" led={gLed} ledLabel={gLedLabel}
          tone={gTone(metricTone(ramPct, memLines, 70, 85))}
          value={ramPct + "%"}
          sub={host.ram.used_gb.toFixed(1) + " / " + host.ram.total_gb + " GB · " + host.ram.free_gb.toFixed(1) + " GB free"} />

        {hasSlice && (
          <KPI icon="gamepad-2" label="Servers" className="kpi--metric" led={gLed} ledLabel={gLedLabel}
            tone={gTone("muted")}
            value={host.slice.pids != null ? host.slice.pids : "—"}
            sub={[
              sliceCores != null ? "≈" + sliceCores.toFixed(1) + " cores" : null,
              host.slice.mem_bytes != null ? fmtBytes(host.slice.mem_bytes) : null,
            ].filter(Boolean).join(" · ") || "unmeasured"} />
        )}

        {hasGpus && fullestGpu && (
          <KPI icon="microchip" label="GPU" className="kpi--metric" led={gLed} ledLabel={gLedLabel}
            tone={gTone(metricTone(fullestGpu.pct, gpuMemLines, 80, 90))}
            value={fullestGpu.pct != null ? Math.round(fullestGpu.pct) + "%" : "—"}
            sub={fullestGpu.gpu.mem_used_gb != null && fullestGpu.gpu.mem_total_gb != null
              ? fullestGpu.gpu.mem_used_gb.toFixed(1) + " / " + fullestGpu.gpu.mem_total_gb.toFixed(1) + " GiB VRAM"
              : "VRAM unmeasured"} />
        )}

        {hottest && (
          <KPI icon="thermometer" label="Temperature" className="kpi--metric" led={gLed} ledLabel={gLedLabel}
            tone={gTone(metricTone(hottest.sensor.value_c, hottest.lines, 75, 85))}
            value={hottest.sensor.value_c.toFixed(1) + "°C"}
            sub={(hottest.sensor.name || hottest.sensor.chip) + " · "
              + Math.round(hottest.pct) + "% of its " + hottest.lines.warn + "°"} />
        )}
      </div>

      <div className="diag-subhead">Right now</div>
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
              swap: <b className={"is-" + swapTone}>{host.ram.swap_used_gb} / {host.ram.swap_total_gb} GB</b>
            </div>
          </div>
        </div>
      </div>

      {(hasSlice || hasGpus) && (
        <div className="diag-2col" style={{ marginTop: 16 }}>
          {hasSlice && <SliceCard host={host} frozen={frozen} ageShort={ageShort} />}
          {hasGpus && <GpuCard host={host} frozen={frozen} ageShort={ageShort} memLines={gpuMemLines} />}
        </div>
      )}

      {(sensors.length > 0 || fans.length > 0) && (
        <>
          <div className="diag-subhead">Heat</div>
          <ThermalPanel host={host} frozen={frozen} ageShort={ageShort} policy={tempLines} />
        </>
      )}

      <div className="diag-subhead">Recorded</div>
      <DiagHostHistory host={host} />
    </>
  );
}

export { DiagResources };
