// DiagOverview — the Overview sub-tab: KPI tiles + services summary + recent activity.

import React from "react";
import { KPI } from "../../components/KPI.jsx";
import { NeedsAttention } from "../../components/NeedsAttention.jsx";
import { RecentActivity } from "../../components/RecentActivity.jsx";
import { useStore } from "../../lib/store.js";
import { metricTone, uptimeShort } from "../../lib/formatting.js";
import { useHostThresholds, ruleLines } from "../../lib/hostThresholds.js";
import { useKeyedResource } from "../../lib/keyedResource.js";
import { servicesStore, subscribeHostServices } from "../../lib/stores.js";
import { ServicesSummaryCard } from "./diagComponents.jsx";

// What this machine is running, under how long it has been up. Either half can be
// missing — a host that reports neither says so rather than showing an empty line.
function osLine(host) {
  const named = (v) => (v && v !== "—" ? v : null);
  return [named(host.os), named(host.kernel)].filter(Boolean).join(" · ") || "—";
}

function DiagOverview({ host, fresh, onAsk, onRun, onViewAlerts, onViewAudit, onViewServices }) {
  const frozen = !!(fresh && fresh.frozen);
  const wasFrozen = React.useRef(frozen);
  const [poweringOn, setPoweringOn] = React.useState(false);
  React.useEffect(() => {
    if (wasFrozen.current && !frozen) {
      setPoweringOn(true);
      const t = setTimeout(() => setPoweringOn(false), 1700);
      wasFrozen.current = frozen;
      return () => clearTimeout(t);
    }
    wasFrozen.current = frozen;
  }, [frozen]);
  // A dropped feed darkens every readout; otherwise the tone is whatever the value earned. Healthy is
  // muted, so a band with nothing wrong stays quiet and one amber tile is the only lit thing on it.
  const gTone = (t) => (frozen ? "off" : t);
  const gLed = frozen ? "down" : "live";
  const ageShort = fresh && fresh.label ? fresh.label.replace(/\s*ago$/, "") : null;
  const gLedLabel = frozen ? ageShort : null;
  const thresholds = useHostThresholds(host && host.id);
  // Coloured by the lines this host publishes, so a tile and the alert the same number would raise
  // cannot disagree. CPU keeps a literal: the host states no rule for utilisation.
  const cpuTone = metricTone(host.cpu.usage_pct, null, 60, 80);
  const ramPct = Math.round((host.ram.used_gb / host.ram.total_gb) * 100);
  const ramTone = metricTone(ramPct, ruleLines(thresholds, "HostMemUsedPct"), 70, 85);
  const fullestDisk = host.disks.reduce((acc, d) => {
    const pct = (d.used_gb / d.total_gb) * 100;
    return pct > acc.pct ? { disk: d, pct } : acc;
  }, { disk: null, pct: 0 });
  const diskTone = metricTone(fullestDisk.pct, ruleLines(thresholds, "HostDiskUsedPct"), 80, 90);
  // The headline temperature is the CPU's, when the monitor could classify one. A plain max across
  // every channel puts a warm SSD or DIMM under a tile labelled "Temperature", which reads as the host
  // running hot; falling back to the max is only for a host whose chips aren't in the monitor's catalog,
  // and the tile says so rather than implying the number is the processor's.
  const hasSensors = Array.isArray(host.sensors) && host.sensors.length > 0;
  const cpuSensors = hasSensors ? host.sensors.filter((s) => s.role === "cpu") : [];
  const tempPool = cpuSensors.length > 0 ? cpuSensors : host.sensors;
  const hotTemp = hasSensors ? tempPool.reduce((max, s) => (s.value_c > max ? s.value_c : max), 0) : null;
  // The label stays one word: the KPI row is a fixed grid and a two-line label drops this tile's value
  // out of line with its neighbours. Which sensor the number came from rides the subtitle instead.
  const tempSub = cpuSensors.length > 0
    ? (cpuSensors.length === 1 ? "CPU package sensor" : "hottest of " + cpuSensors.length + " CPU sensors")
    : "highest of " + (host.sensors || []).length + " sensors";
  const tempTone = metricTone(hotTemp, ruleLines(thresholds, "HostTempC"), 75, 85);
  const netTotal = host.network.interfaces.reduce((sum, i) => sum + (i.rx_kbps || 0) + (i.tx_kbps || 0), 0);
  const ifaceCount = host.network.interfaces.length;

  const svcEntry = useStore(servicesStore, s => (host && host.id ? s.byHost[host.id] : null));
  const svcList = (svcEntry && svcEntry.list) || [];
  const svcStatus = svcEntry ? svcEntry.status : "loading";
  useKeyedResource(
    host && host.id ? "host-services/" + host.id : null,
    () => servicesStore.refresh(host.id).catch(() => {}),
    () => subscribeHostServices(host.id));
  const svcReady = !!svcEntry;

  return (
    <>
      <NeedsAttention
        hostId={host.id}
        onPick={onAsk}
        onRun={onRun}
        onViewAll={onViewAlerts}
        max={3} />

      <div className={"diag-tiles" + (frozen ? " is-frozen" : "") + (poweringOn ? " is-powering-on" : "")}>
        <KPI icon="cpu"          label="CPU"         tone={gTone(cpuTone)} className="kpi--metric" led={gLed} ledLabel={gLedLabel}
          value={host.cpu.usage_pct + "%"}
          sub={"load " + host.cpu.load_avg.join(" / ") + " \u00b7 " + host.cpu.cores + " cores"} />
        <KPI icon="hard-drive"   label="Memory"      tone={gTone(ramTone)} className="kpi--metric" led={gLed} ledLabel={gLedLabel}
          value={ramPct + "%"}
          sub={host.ram.used_gb.toFixed(1) + " / " + host.ram.total_gb + " GB \u00b7 swap " + host.ram.swap_used_gb + " GB"} />
        <KPI icon="database"     label="Disk"        tone={gTone(diskTone)} className="kpi--metric" led={gLed} ledLabel={gLedLabel}
          value={Math.round(fullestDisk.pct) + "%"}
          sub={fullestDisk.disk ? fullestDisk.disk.mount + " \u00b7 " + fullestDisk.disk.used_gb + " / " + fullestDisk.disk.total_gb + " GB" : "\u2014"} />
        <KPI icon="network"      label="Network"     tone={frozen ? "off" : "muted"} className="kpi--metric" led={gLed} ledLabel={gLedLabel}
          value={Math.round(netTotal) + "kbps"}
          sub={ifaceCount + (ifaceCount === 1 ? " interface" : " interfaces")} />
        {hasSensors && (
          <KPI icon="thermometer"  label="Temperature" tone={gTone(tempTone)} className="kpi--metric" led={gLed} ledLabel={gLedLabel}
            value={hotTemp + "\u00b0C"}
            sub={tempSub} />
        )}
        <KPI icon="clock"        label="Uptime"      tone="ok" led="live"
          value={uptimeShort(host.boot_time)}
          sub={osLine(host)} />
      </div>

      <div className="diag-grid">
        <ServicesSummaryCard services={svcList} status={svcStatus} ready={svcReady} onViewAll={onViewServices} />
        <RecentActivity hostId={host.id} onViewAll={onViewAudit} max={5} />
      </div>
    </>
  );
}

export { DiagOverview };
