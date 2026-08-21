import { ConsolePanel } from "../../../components/ConsolePanel.jsx";
import { Icon } from "../../../components/Icon.jsx";
import { useStore } from "../../../lib/store.js";
import { serversStore } from "../../../lib/stores.js";

// ServerConsoleWidget — one server's console, pinned.
//
// `ConsolePanel` takes a server OBJECT; a descriptor can only carry an ID, because a layout is JSON
// that outlives the roster it was written against. So this resolves the id against the live store,
// which also gives it somewhere honest to report the case the page version never has to face: the
// server the widget names has been deleted.
//
// ConsolePanel is already instance-safe — per-mount effects keyed on the server, its own subscribe
// and dispose — so two of these cost two scrollbacks and, because the transport ref-counts topics,
// one stream.

function ServerConsoleWidget({ serverId }) {
  const servers = useStore(serversStore, s => s.list);
  const everLoaded = useStore(serversStore, s => s.everLoaded);
  const server = servers.find(x => x.id === serverId) || null;

  // Before the roster lands, an absent server is unknown rather than gone. Saying "deleted" here
  // would flash a wrong answer on every cold load.
  if (!server) {
    return (
      <div className="proc-unavailable">
        <span className="proc-unavailable__icon">
          <Icon name={everLoaded ? "unlink" : "loader-2"} size={24} strokeWidth={1.9} />
        </span>
        <div className="proc-unavailable__title">
          {everLoaded ? "That server is gone" : "Finding " + serverId + "…"}
        </div>
        <div className="proc-unavailable__sub">
          {everLoaded
            ? `Nothing named “${serverId}” is on this cluster any more. Remove this widget, or put it back if the node it lived on is just unreachable.`
            : "Waiting for the roster."}
        </div>
        <span className="proc-unavailable__tag">
          <Icon name="activity" size={12} /> {everLoaded ? "no such server" : "loading"}
        </span>
      </div>
    );
  }

  return <ConsolePanel server={server} />;
}

export { ServerConsoleWidget };
export default ServerConsoleWidget;
