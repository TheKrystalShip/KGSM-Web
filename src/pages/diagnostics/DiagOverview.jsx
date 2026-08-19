// DiagOverview — the Overview sub-tab: KPI tiles + services summary + recent activity.

import React from "react";
import { KPI } from "../../components/KPI.jsx";
import { NeedsAttention } from "../../components/NeedsAttention.jsx";
import { RecentActivity } from "../../components/RecentActivity.jsx";
import { useStore } from "../../lib/store.js";
import { statusTone, uptimeShort } from "../../lib/formatting.js";
import { servicesStore, subscribeHostServices } from "../../lib/stores.js";
import { ServicesSummaryCard } from "./diagComponents.jsx";

const DIAG_KPI_TONE = { cpu: "teal", ram: "teal", disk: "teal", net: "muted", temp: "teal", uptime: "ok" };

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
  const gTone = (t) => frozen ? "off" : DIAG_KPI_TONE[t];
  const gLed = frozen ? "down" : "live";
  const ageShort = fresh && fresh.label ? fresh.label.replace(/\s*ago$/, "") : null;
  const gLedLabel = frozen ? ageShort : null;
  const cpuTone = statusTone(host.cpu.usage_pct, 60, 80);
  const ramPct = Math.round((host.ram.used_gb / host.ram.total_gb) * 100);
  const ramTone = statusTone(ramPct, 70, 85);
  const fullestDisk = host.disks.reduce((acc, d) => {
    const pct = (d.used_gb / d.total_gb) * 100;
    return pct > acc.pct ? { disk: d, pct } : acc;
  }, { disk: null, pct: 0 });
  const diskTone = statusTone(fullestDisk.pct, 80, 90);
  const hasSensors = Array.isArray(host.sensors) && host.sensors.length > 0;
  const hotTemp = hasSensors ? host.sensors.reduce((max, s) => s.value_c > max ? s.value_c : max, 0) : null;
  const tempTone = hotTemp != null ? statusTone(hotTemp, 75, 85) : "success";
  const netTotal = host.network.interfaces.reduce((sum, i) => sum + (i.rx_kbps || 0) + (i.tx_kbps || 0), 0);
  const ifaceCount = host.network.interfaces.length;

  const svcList = useStore(servicesStore, s => s.list);
  const svcStatus = useStore(servicesStore, s => s.status);
  const svcForHost = useStore(servicesStore, s => s.hostId);
  React.useEffect(() => {
    if (host && host.id) servicesStore.refresh(host.id).catch(() => {});
    return subscribeHostServices(host && host.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only host.id is used (and in deps); the object churns each render
  }, [host && host.id]);
  const svcReady = svcForHost === host.id;

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
            sub={"highest of " + host.sensors.length + " sensors"} />
        )}
        <KPI icon="clock"        label="Uptime"      tone="ok" led="live"
          value={uptimeShort(host.boot_time)}
          sub={host.kernel} />
      </div>

      <div className="diag-grid">
        <ServicesSummaryCard services={svcList} status={svcStatus} ready={svcReady} onViewAll={onViewServices} />
        <RecentActivity hostId={host.id} onViewAll={onViewAudit} max={5} />
      </div>
    </>
  );
}

export { DiagOverview };
