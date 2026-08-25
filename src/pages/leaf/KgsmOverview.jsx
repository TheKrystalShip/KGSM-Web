// KgsmOverview — the engine's identity card: who this kgsm is (version, entrypoint, directory
// layout) and what it holds on this node (servers, placement libraries).
//
// Two sources, deliberately kept apart. The identity facts come from GET /hosts/{id}/engine — the
// api invoking kgsm itself, so every one of them is the engine's own answer. The holdings are joined
// client-side from stores the app already keeps current (the server roster, the host's library
// registry); re-fetching either here would be a second copy of a fact with one owner.
//
// The engine is a stateless CLI: there is no uptime, memory or pid to report, and this page shows
// none rather than an em-dashed row implying an unmeasured process.

import { KPI } from "../../components/KPI.jsx";
import { fmtBytes } from "../../lib/formatting.js";
import { fetchEngineInfo, serversStore } from "../../lib/stores.js";
import { useStore } from "../../lib/store.js";
import { LeafFacts, LeafLoading, LeafNotice, LeafUnreadable, useLeafResource } from "./leafOverviewKit.jsx";

function KgsmOverview({ hostId, host }) {
  const { state, data, error, reload } = useLeafResource(hostId, "kgsm", (h) => fetchEngineInfo(h));
  const servers = useStore(serversStore, s => s.list).filter(s => s.hostId === hostId);

  const running = servers.filter(s => s.status === "online");
  const libraries = (host && host.libraries) || null;
  const onlineLibs = libraries ? libraries.filter(l => l.online) : [];
  const freeBytes = onlineLibs.reduce((sum, l) => (l.free_bytes != null ? sum + l.free_bytes : sum), 0);
  const measuredFree = onlineLibs.some(l => l.free_bytes != null);

  const identity = () => {
    if (state === "loading") return <LeafLoading what="Asking the engine who it is…" />;
    if (state === "none") {
      return (
        <LeafNotice title="No engine configured">
          This node’s panel runs without a kgsm engine, so there is no version or layout to report.
        </LeafNotice>
      );
    }
    if (state === "error") return <LeafUnreadable what="Engine identity" error={error} onRetry={reload} />;
    const paths = data.paths || {};
    return (
      <div className="chat-brief">
        <div className="chat-brief__pad">
          <LeafFacts rows={[
            ["Version", data.version],
            ["Entrypoint", data.path, "what this panel executes"],
            paths.root && ["Engine root", paths.root],
            paths.configFile && ["Config file", paths.configFile],
            paths.instancesDir && ["Instances", paths.instancesDir],
            paths.blueprintsDir && ["Blueprints", paths.blueprintsDir],
          ]} />
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="dash-summary">
        <KPI icon="gamepad-2" label="Servers" value={servers.length} tone="muted"
          sub={servers.length ? "installed on this node" : "nothing installed on this node"} />
        <KPI icon="play" label="Running" value={running.length}
          tone={running.length ? "ok" : "muted"}
          sub={servers.length ? (servers.length - running.length) + " stopped" : "nothing to run"} />
        <KPI icon="hard-drive" label="Libraries" value={libraries ? libraries.length : "—"}
          tone={libraries && libraries.length === 0 ? "warn" : "muted"}
          sub={libraries === null
            ? "the engine could not report them"
            : libraries.length === 0
              ? "no placement root — nothing can be installed"
              : measuredFree
                ? fmtBytes(freeBytes) + " free"
                : "capacity unmeasured"} />
      </div>
      {identity()}
    </>
  );
}

export { KgsmOverview };
