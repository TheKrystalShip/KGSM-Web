import React from "react";

import { Icon } from "../../../components/Icon.jsx";
import { useNav } from "../../../components/NavContext.jsx";
import { Rail } from "../../../components/Rail.jsx";
import { ServerTile } from "../../../components/ServerCard.jsx";
import { runServerAction } from "../../../lib/serverActions.js";
import { useStore } from "../../../lib/store.js";
import { favoritesStore, hostsStore, serversStore } from "../../../lib/stores.js";

// ServersRail — the whole fleet on a rail, most-worth-a-glance first.
//
// It renders the same wherever it is mounted. It reads stores and navigates through context, so it
// has no idea whether it is on the dashboard grid, on a page, or anywhere else — which is the point:
// a card that behaves differently as a widget is two cards to keep in agreement.
//
// Unfiltered by status on purpose: the Running tile already covers the live count, so filtering here
// would make this a second view of the same fact instead of a way to reach any server.
//
// Servers carry no added/created date, so instead of arbitrary list order the ones worth a glance
// lead: FAVOURITES first (a pinned server is the one you care about most, whatever it is doing),
// then most-active online, then the ones in transition (they need watching), then offline last.
const STATUS_RANK = { online: 0, starting: 1, restarting: 2, stopping: 3, updating: 4, offline: 5 };

function ServersRail() {
  const nav = useNav();
  const servers = useStore(serversStore, s => s.list);
  const hosts = useStore(hostsStore, s => s.list);
  const favIds = useStore(favoritesStore, s => s.ids);
  const favSet = React.useMemo(() => new Set(favIds), [favIds]);

  const ordered = React.useMemo(() => [...servers].sort((a, b) => {
    const fa = favSet.has(a.id) ? 0 : 1, fb = favSet.has(b.id) ? 0 : 1;
    if (fa !== fb) return fa - fb;
    const ra = STATUS_RANK[a.status] ?? 5, rb = STATUS_RANK[b.status] ?? 5;
    if (ra !== rb) return ra - rb;
    return (b.players?.current || 0) - (a.players?.current || 0);
  }), [servers, favSet]);

  if (servers.length === 0) {
    return (
      <div className="chat-brief">
        {(
          <div className="chat-brief__head">
            <span className="chat-brief__title">
              <Icon name="server" size={13} /> Servers
              <span className="chat-brief__count chat-brief__count--neutral">0</span>
            </span>
          </div>
        )}
        <div className="chat-brief__body">
          <div className="dash-servers-empty">
            <Icon name="moon" size={20} />
            <span>No servers yet.</span>
            <button className="dash-servers-empty__link" onClick={() => nav.servers()}>View all servers</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <Rail
      variant="servers"
      icon="server"
      title="Servers"
      count={servers.length}
      items={ordered}
      onViewAll={() => nav.servers()}
      renderItem={s => (
        <ServerTile server={s} onOpen={(id) => nav.openServer(id)}
          onAction={(id, action) => runServerAction(action, id)} showHost={hosts.length > 1} />
      )}
    />
  );
}

export { ServersRail };
export default ServersRail;
