// DiagLogs — the Logs sub-tab: aggregated leaf-service journals.

import { Icon } from "../../components/Icon.jsx";
import { ConsoleView } from "../../components/ConsoleView.jsx";
import { PinButton } from "../../components/widgets/PinButton.jsx";
import { useStore } from "../../lib/store.js";
import { useKeyedResource } from "../../lib/keyedResource.js";
import { logSourcesStore, logsStore, subscribeHostLogs } from "../../lib/stores.js";
import { LOG_SOURCE_META } from "./diagHelpers.js";

function DiagLogs({ host }) {
  const hostId = host && host.id;
  // Both stores are keyed by host, and the hold is shared: this tab and a journal pinned to the
  // dashboard for the same node use one hydrate and one subscription between them.
  const entry = useStore(logsStore, s => (hostId ? s.byHost[hostId] : null));
  const sourcesEntry = useStore(logSourcesStore, s => (hostId ? s.byHost[hostId] : null));

  useKeyedResource(
    hostId ? "host-logs/" + hostId : null,
    () => { logsStore.refresh(hostId).catch(() => {}); logSourcesStore.refresh(hostId).catch(() => {}); },
    () => subscribeHostLogs(hostId));

  if (!ConsoleView) return null;

  const status = entry ? entry.status : "loading";
  const ready = !!entry;
  const entries = ready && Array.isArray(entry.list) ? entry.list : [];
  const logSources = (sourcesEntry && sourcesEntry.sources) || [];
  const sourcesReady = !!sourcesEntry && sourcesEntry.status === "ready";

  const sources = logSources.map(s => {
    const m = LOG_SOURCE_META[s.id] || {};
    return {
      id: s.id,
      label: s.label || m.label || s.id,
      lines: entries.filter(e => e.source === s.id).slice().reverse(),
    };
  });

  if (sources.length > 0)
    return <ConsoleView title="Host logs" icon="scroll-text" sources={sources} pill={{ label: "Live", live: true }}
      pin={<PinButton type="host.logs" params={{ hostId }} label="this node's journal" />}
      resetKey={hostId} />;

  const phase = (status === "loading" || !ready || !sourcesReady) ? "loading" : status === "error" ? "error" : "quiet";
  return (
    <div className="proc-unavailable">
      <span className="proc-unavailable__icon"><Icon name="scroll-text" size={26} strokeWidth={1.9} /></span>
      <div className="proc-unavailable__title">
        {phase === "loading" ? "Loading host logs\u2026" : phase === "error" ? "Host logs unavailable" : "No recent log lines"}
      </div>
      <div className="proc-unavailable__sub">
        {phase === "loading"
          ? "Reading the host\u2019s leaf-service journal (assistant \u00b7 monitor \u00b7 watchdog \u00b7 firewall \u00b7 api \u00b7 bot)."
          : phase === "error"
            ? "Couldn\u2019t read the host log stream \u2014 the backend journal source didn\u2019t respond."
            : "The host\u2019s leaf services haven\u2019t logged anything in the recent window."}
      </div>
      <span className="proc-unavailable__tag">
        <Icon name="activity" size={12} /> {phase === "loading" ? "loading" : phase === "error" ? "no log source" : "quiet"}
      </span>
    </div>
  );
}

export { DiagLogs };
