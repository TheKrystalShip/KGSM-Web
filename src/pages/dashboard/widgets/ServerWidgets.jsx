import { ConsolePanel } from "../../../components/ConsolePanel.jsx";
import { Icon } from "../../../components/Icon.jsx";
import { useNav } from "../../../components/NavContext.jsx";
import { ServerTile } from "../../../components/ServerCard.jsx";
import { runServerAction } from "../../../lib/serverActions.js";
import { useStore } from "../../../lib/store.js";
import { serversStore } from "../../../lib/stores.js";
import { PerformanceTab } from "../../PerformanceTab.jsx";
import { PlayersTab } from "../../PlayersTab.jsx";

// The server-detail surfaces, pinnable.
//
// Every one of them takes a server OBJECT; a descriptor can only carry an id, because a layout is
// JSON that outlives the roster it was written against. So each resolves the id against the live
// store — which is also the one thing these wrappers add that the page never needs: somewhere honest
// to report that the server has been deleted.
//
// The bodies are the components the server page renders, unchanged. All four were already
// instance-safe (per-mount effects keyed on the server, its own subscribe and dispose), which is why
// this file is wrappers and nothing else.

function MissingServer({ serverId, everLoaded, what }) {
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
          ? `Nothing named “${serverId}” is on this cluster any more, so there are no ${what} to read. Remove this widget, or put it back if the node it lived on is only unreachable.`
          : "Waiting for the roster."}
      </div>
      <span className="proc-unavailable__tag">
        <Icon name="activity" size={12} /> {everLoaded ? "no such server" : "loading"}
      </span>
    </div>
  );
}

// Before the roster lands, an absent server is UNKNOWN rather than gone. Reporting "deleted" here
// would flash a wrong answer on every cold load.
function useServer(serverId) {
  const servers = useStore(serversStore, s => s.list);
  const everLoaded = useStore(serversStore, s => s.everLoaded);
  return { server: servers.find(x => x.id === serverId) || null, everLoaded };
}

function ServerConsoleWidget({ serverId }) {
  const { server, everLoaded } = useServer(serverId);
  if (!server) return <MissingServer serverId={serverId} everLoaded={everLoaded} what="console lines" />;
  return <ConsolePanel server={server} />;
}

function ServerPlayersWidget({ serverId }) {
  const { server, everLoaded } = useServer(serverId);
  if (!server) return <MissingServer serverId={serverId} everLoaded={everLoaded} what="players" />;
  return <PlayersTab server={server} />;
}

function ServerPerformanceWidget({ serverId }) {
  const { server, everLoaded } = useServer(serverId);
  if (!server) return <MissingServer serverId={serverId} everLoaded={everLoaded} what="metrics" />;
  return <PerformanceTab server={server} />;
}

// One server as the card the Servers page and the dashboard rail already render. Pinned from the
// server's own hero, which reads as "keep this one in front of me" — a whole hero on the dashboard
// would be a banner where a card belongs, and this is the component built for a grid.
function ServerCardWidget({ serverId }) {
  const nav = useNav();
  const { server, everLoaded } = useServer(serverId);
  if (!server) return <MissingServer serverId={serverId} everLoaded={everLoaded} what="details" />;
  return (
    <ServerTile
      server={server}
      onOpen={(id) => nav.openServer(id)}
      onAction={(id, action) => runServerAction(action, id)}
    />
  );
}

export { ServerCardWidget, ServerConsoleWidget, ServerPerformanceWidget, ServerPlayersWidget };
