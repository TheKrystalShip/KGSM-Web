// stores/fleet.js — the dashboard summary band's four extra reads, per node.
//
// The band's other eight tiles derive from stores the app already holds (the roster, the audit
// feed, the host capability block). These four have no such source and are all slow-moving
// facts — a week's uptime, a supervision table, a backup schedule, a systemd board — so they
// are fetched together on one lazy loop rather than four eager ones.
//
// Every slice is independently fallible and independently honest. A node whose watchdog is not
// running still reports its schedules; the slice that failed is `null`, which the tiles read as
// "not measured" and never as zero. That is the same degradation rule the leaf pages follow —
// nothing here can turn one absent leaf into a fleet-wide blank.

import { adaptServices } from "../adapters.js";
import { api } from "../apiClient.js";
import { createStore } from "../store.js";
import { fetchLeafSchedules, fetchLeafSupervision } from "./diagnostics.js";
import { hostsStore } from "./hosts.js";

// The window the availability tile reports. A week is long enough that one bad afternoon does not
// dominate it and short enough to still describe the fleet as it is now.
const AVAILABILITY_WINDOW = "7d";

// These change on the order of minutes at fastest (a schedule fires, a leaf restarts, a server
// crashes). Polling faster would cost four requests per node for a figure that had not moved.
const REFRESH_MS = 60_000;

const fleetOpsStore = createStore({
  byHost: {},          // hostId -> { availability, supervision, schedules, services }
  status: "loading",
  everLoaded: false,
});

// One node's four reads, each settled on its own. `Promise.all` over `.catch(→null)` rather than
// `allSettled` + branching, because there is exactly one failure behaviour here: the slice is
// unknown and the tile says so.
function readHost(hostId) {
  const availability = api.host(hostId)
    .get("/servers/availability?window=" + AVAILABILITY_WINDOW)
    .catch(() => null);
  // A node with no watchdog / no scheduler answers 404, which these helpers already resolve to
  // null; anything else rejects and is caught here to the same honest null.
  const supervision = fetchLeafSupervision(hostId).catch(() => null);
  const schedules = fetchLeafSchedules(hostId).catch(() => null);
  const services = api.host(hostId)
    .get("/hosts/" + hostId + "/services")
    .then(rows => adaptServices(Array.isArray(rows) ? rows : []))
    .catch(() => null);

  return Promise.all([availability, supervision, schedules, services])
    .then(([a, sup, sch, svc]) => ({ availability: a, supervision: sup, schedules: sch, services: svc }));
}

let _gen = 0;

fleetOpsStore.refresh = () => {
  const hosts = hostsStore.getState().list || [];
  if (!hosts.length) return Promise.resolve({});
  const gen = ++_gen;
  fleetOpsStore.setState(s => ({ ...s, status: "loading" }));

  return Promise.all(hosts.map(h => readHost(h.id).then(rec => [h.id, rec])))
    .then(pairs => {
      if (gen !== _gen) return fleetOpsStore.getState().byHost;
      const byHost = {};
      for (const [id, rec] of pairs) byHost[id] = rec;
      fleetOpsStore.setState(s => ({ ...s, byHost, status: "ready", everLoaded: true }));
      return byHost;
    });
};

let _timer = null;

// Started by the dashboard when it mounts, not by the boot sequence: this is one page's data, and
// four requests per node on every login for a page nobody opened is four requests wasted.
function startFleetOps() {
  if (_timer) return;
  fleetOpsStore.refresh();
  _timer = setInterval(() => {
    // A backgrounded tab is not looking at the dashboard; the next foreground tick refreshes it.
    if (typeof document !== "undefined" && document.hidden) return;
    fleetOpsStore.refresh();
  }, REFRESH_MS);
}

function stopFleetOps() {
  if (!_timer) return;
  clearInterval(_timer);
  _timer = null;
}

export { AVAILABILITY_WINDOW, fleetOpsStore, startFleetOps, stopFleetOps };
