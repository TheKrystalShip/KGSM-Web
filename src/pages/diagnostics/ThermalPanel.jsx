import React from "react";
import { Icon } from "../../components/Icon.jsx";
import { StatusLed } from "./diagComponents.jsx";
import { fetchSensorSummary, fetchGpuSummary } from "../../lib/stores/hosts.js";
import { useHostThresholds, ruleLines } from "../../lib/hostThresholds.js";
import { useStore } from "../../lib/store.js";
import { hostsStore } from "../../lib/stores.js";
import { PinButton } from "../../components/widgets/PinButton.jsx";

// ThermalPanel — every channel on this host that reports a temperature, on ONE shared axis: the window's
// min–max as a bar, the current reading marked on it, and the lines the channel is actually judged
// against drawn where they fall.
//
// A shared axis is the whole point. Twelve numbers in a list are twelve comparisons the reader has to
// do; on a common scale "the package swings hardest and the DIMMs barely move" is a shape. It is also
// why the axis is fixed rather than fitted to the data — an axis that rescales makes a calm host and a
// hot one look identical. Hovering reads the axis back: a crosshair anywhere over the tracks names the
// temperature under the cursor and lifts every channel whose window reached it.
//
// The GPU arrives from the driver rather than hwmon and is keyed by its UUID, but it is a temperature on
// the same host, so it is a row here like any other. Keeping it on a card of its own would leave the one
// comparison people actually make — is the card hotter than the package — as a comparison between two
// cards.
//
// Standalone by construction (it takes a host and fetches its own ranges), so the dashboard pins the
// same component this page renders. There is no widget-only fork.

// Fixed axis. Board thermistors live near the bottom and silicon runs to ~100; past 110 is the
// unconnected-pin territory the monitor already withholds, so nothing real lands off the end.
const AX_LO = 30;
const AX_HI = 110;

const ROLE_GROUPS = [
  ["cpu", "Processor"],
  ["gpu", "Graphics"],
  ["memory", "Memory"],
  ["drive", "Storage"],
  ["board", "Motherboard"],
  ["chipset", "Chipset"],
  ["network", "Network"],
];

const clampPct = (v) => {
  const p = ((v - AX_LO) / (AX_HI - AX_LO)) * 100;
  return Math.max(0, Math.min(100, p));
};

// A GPU as a thermal channel. Its identity is the UUID the monitor keys its rows by, so the range lookup
// and the pinned tile address the same device the driver does. A card whose temperature the driver would
// not give up is left out entirely rather than shown at a temperature nobody measured.
function gpuChannels(gpus) {
  return (Array.isArray(gpus) ? gpus : [])
    .filter((g) => g && typeof g.temp_c === "number")
    .map((g) => ({
      id: g.uuid,
      chip: g.name,
      label: null,
      name: g.name,
      role: "gpu",
      value_c: g.temp_c,
      limit_high_c: g.temp_limit_c ?? null,
      limit_critical_c: g.temp_shutdown_c ?? null,
      primary: true,
    }));
}

// A channel's own limits when the device published them, else the host's policy — which is READ from the
// host, never assumed here. A default written into the SPA would be a second copy of a number the monitor
// owns, and it would keep drawing a line after an operator moved theirs.
function linesFor(sensor, policy) {
  const warn = sensor.limit_high_c ?? (policy ? policy.warn : null) ?? null;
  const danger = sensor.limit_critical_c ?? (policy ? policy.danger : null) ?? null;
  return { warn, danger, own: sensor.limit_high_c != null || sensor.limit_critical_c != null };
}

function toneFor(sensor, policy) {
  const { warn, danger } = linesFor(sensor, policy);
  if (danger != null && sensor.value_c >= danger) return "danger";
  if (warn != null && sensor.value_c >= warn) return "warn";
  return null;
}

function SensorRow({ sensor, range, policy, hostId, cross }) {
  const { warn, danger, own } = linesFor(sensor, policy);
  const tone = toneFor(sensor, policy);
  const lo = range ? clampPct(range.min) : null;
  const hi = range ? clampPct(range.max) : null;

  // Whether this channel's window reached the temperature under the cursor. This is the read the shared
  // axis exists for — "which of these has been at 80°" is one glance instead of twelve comparisons.
  const crossed = cross != null && range != null && cross >= range.min && cross <= range.max;

  const limitNote = own ? "device limit" : "host policy";
  const title =
    sensor.chip + (sensor.label ? " · " + sensor.label : "") +
    (range ? "\n" + range.min.toFixed(1) + "° – " + range.max.toFixed(1) + "° over the window" : "") +
    (warn != null ? "\nwarn " + warn + "° (" + limitNote + ")" : "");

  return (
    <div className="therm-row" title={title}>
      <span className="therm-row__name">{sensor.name || sensor.chip}</span>
      <span className="therm-row__track">
        <i className="therm-track__axis" />
        {/* The range only exists once a window has accumulated; before that the marker stands alone
            rather than a zero-width bar implying a channel that has never moved. */}
        {range && (
          <i className={"therm-track__range" + (crossed ? " is-crossed" : "")}
            style={{ left: lo + "%", width: Math.max(hi - lo, 0.6) + "%" }} />
        )}
        {warn != null && warn <= AX_HI && (
          <i className="therm-track__tick therm-track__tick--warn" style={{ left: clampPct(warn) + "%" }} />
        )}
        {danger != null && danger <= AX_HI && (
          <i className="therm-track__tick therm-track__tick--danger" style={{ left: clampPct(danger) + "%" }} />
        )}
        <i
          className={"therm-track__now" + (tone ? " is-" + tone : "")}
          style={{ left: "calc(" + clampPct(sensor.value_c) + "% - 1.5px)" }}
        />
      </span>
      <span className={"therm-row__now" + (tone ? " is-" + tone : "")}>{sensor.value_c.toFixed(1)}°</span>
      <span className="therm-row__pin">
        <PinButton type="host.sensor" params={{ hostId, sensorId: sensor.id }}
          label={sensor.name || sensor.chip} />
      </span>
    </div>
  );
}

function ThermalPanel({ host, frozen, ageShort, range = "24h", policy: given }) {
  const hostId = host && host.id;
  const [ranges, setRanges] = React.useState(null);
  const [showAll, setShowAll] = React.useState(false);
  const [cross, setCross] = React.useState(null);
  const plotRef = React.useRef(null);

  // The host's own temperature rule, for the channels whose devices publish no limit. A page that has
  // already read the host's rules hands them down; pinned on a dashboard the panel reads them itself,
  // which is what keeps it the same component in both places. Null until it arrives and null if it
  // cannot be read, which draws no line rather than a line nobody set.
  const fetched = useHostThresholds(given ? null : hostId);
  const policy = given || ruleLines(fetched, "HostTempC");

  // One request per row set for every channel's range — hwmon and the GPUs are separate kinds, keyed
  // differently, so they are separate queries folded into one map here. Re-fetched when the host or
  // window changes; a failure leaves ranges null, which renders markers with no bars rather than bars
  // over invented numbers.
  React.useEffect(() => {
    let alive = true;
    if (!hostId) return undefined;
    Promise.all([
      fetchSensorSummary(hostId, range).catch(() => null),
      fetchGpuSummary(hostId, range).catch(() => null),
    ]).then(([sensors, gpus]) => {
      if (!alive) return;
      if (!sensors && !gpus) { setRanges(null); return; }
      const byId = {};
      for (const r of [sensors, gpus]) {
        for (const e of (r && r.entries) || []) {
          if (e.metric !== "tempC" && e.metric !== "rpm") continue;
          byId[e.entityId] = e;
        }
      }
      setRanges(byId);
    });
    return () => { alive = false; };
  }, [hostId, range]);

  // The cursor's position read back as a temperature. Measured off a real track rather than computed
  // from the column template, so it stays exact through the mobile layout that makes the track
  // full-width. Mouse only: a tap carries no position to read, and a crosshair frozen where a finger
  // last touched would be a reading nobody is taking.
  const onMove = React.useCallback((e) => {
    if (e.pointerType && e.pointerType !== "mouse") return;
    const plot = plotRef.current;
    const track = plot && plot.querySelector(".therm-row__track:not(.therm-row__track--none)");
    if (!track) return;
    const tr = track.getBoundingClientRect();
    if (tr.width <= 0) return;
    const pct = (e.clientX - tr.left) / tr.width;
    if (pct < 0 || pct > 1) { setCross(null); return; }
    const x = Math.round(e.clientX - plot.getBoundingClientRect().left);
    setCross((prev) => (prev && prev.x === x ? prev : { x, value: AX_LO + pct * (AX_HI - AX_LO) }));
  }, []);

  const sensors = Array.isArray(host.sensors) ? host.sensors : [];
  const fans = Array.isArray(host.fans) ? host.fans : [];
  const channels = sensors.concat(gpuChannels(host.gpus));

  // A non-primary channel is one another channel on the same device speaks for — the CPU's per-die
  // reading, an NVMe's component sensors, the same CPU temperature relayed through the motherboard.
  // Folded by default and never dropped: they are real measurements, and one diverging from the channel
  // that supposedly speaks for it is exactly the thing worth being able to look at.
  const shown = showAll ? channels : channels.filter((s) => s.primary !== false);
  const folded = channels.length - shown.length;

  const groups = [];
  for (const [role, label] of ROLE_GROUPS) {
    const rows = shown.filter((s) => s.role === role);
    if (rows.length) groups.push([label, rows]);
  }
  const rest = shown.filter((s) => !ROLE_GROUPS.some(([role]) => s.role === role));
  if (rest.length) groups.push(["Other", rest]);

  const anyOwnLimit = channels.some((s) => s.limit_high_c != null || s.limit_critical_c != null);

  return (
    <div className={"chat-brief" + (frozen ? " is-frozen" : "")}>
      <div className="chat-brief__head">
        <span className="chat-brief__title">
          <Icon name="thermometer" size={13} /> Thermal
          <span className="chat-brief__count chat-brief__count--neutral">{shown.length}</span>
        </span>
        {folded > 0 && (
          <button type="button" className="therm-toggle" onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Hide duplicates" : "+" + folded + " duplicate" + (folded === 1 ? "" : "s")}
          </button>
        )}
        <PinButton type="host.thermal" params={{ hostId }} label="Thermal" />
        <StatusLed live={!frozen} label={frozen ? ageShort : null} />
      </div>
      <div className="chat-brief__pad">
        {/* The crosshair reaches exactly as far as the axis it reads — the temperature rows and the scale
            that labels them. It deliberately stops short of the fans below, which are not on this axis. */}
        <div className="therm-plot" ref={plotRef} onPointerMove={onMove} onPointerLeave={() => setCross(null)}>
          <div className="therm-plot__readout">
            {cross && (
              <span className="therm-readout" style={{ left: cross.x + "px" }}>
                {cross.value.toFixed(1)}°
              </span>
            )}
          </div>

          <div className="therm-plot__rows">
            {groups.map(([label, rows]) => (
              <div key={label}>
                <div className="diag-subhead">{label}</div>
                <div className="therm-rows">
                  {rows.map((s) => (
                    <SensorRow key={s.id} sensor={s} range={ranges && ranges[s.id]} policy={policy}
                      hostId={hostId} cross={cross ? cross.value : null} />
                  ))}
                </div>
              </div>
            ))}
            {/* Spans the rows and nothing else, so the line ends where the axis does instead of striking
                through the labels that name it. */}
            {cross && <i className="therm-cross" style={{ left: cross.x + "px" }} aria-hidden="true" />}
          </div>

          <div className="therm-scale">
            <span />
            <span className="therm-scale__marks"><i>30°</i><i>50°</i><i>70°</i><i>90°</i><i>110°</i></span>
            <span />
          </div>
        </div>

        {fans.length > 0 && (
          <div>
            <div className="diag-subhead">Fans</div>
            <div className="therm-rows">
              {fans.map((f) => (
                <div className="therm-row" key={f.id} title={f.chip + (f.label ? " · " + f.label : "")}>
                  <span className="therm-row__name">{f.name || f.chip}</span>
                  {/* No track: RPM does not belong on a temperature axis, and giving it one would put two
                      scales on a single plot where a reader takes the crossing point for a fact. */}
                  <span className="therm-row__track therm-row__track--none" />
                  <span className="therm-row__now">{f.rpm.toLocaleString()}<i className="therm-unit">RPM</i></span>
                  <span className="therm-row__pin">
                    <PinButton type="host.sensor" params={{ hostId, sensorId: f.id }}
                      label={f.name || f.chip} />
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="therm-legend">
          <span><i className="therm-sw therm-sw--range" /> {range} range</span>
          <span><i className="therm-sw therm-sw--now" /> now</span>
          <span><i className="therm-sw therm-sw--warn" /> warn</span>
          <span><i className="therm-sw therm-sw--danger" /> critical</span>
          <span className="therm-legend__note">
            {anyOwnLimit
              ? "Limits are each device's own where it publishes them, the host policy otherwise."
              : "No device on this host publishes its own limits — the host policy applies throughout."}
          </span>
        </div>
      </div>
    </div>
  );
}

// The page already holds a host object; the dashboard hands down the id its descriptor was bound to,
// spread as a plain prop, so the widget entry resolves it against the roster itself.
function ThermalPanelWidget({ hostId, pin }) {
  const hosts = useStore(hostsStore, (s) => s.list);
  const host = (hosts || []).find((h) => h.id === hostId) || null;
  if (!host) return <div className="diag-empty"><p>This node is not reachable.</p></div>;
  return <ThermalPanel host={host} pin={pin} />;
}

export { ThermalPanel, ThermalPanelWidget };
