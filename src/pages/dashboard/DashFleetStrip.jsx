// DashFleetStrip — the dashboard's "Cluster capacity" card: one row per CLUSTER
// NODE (connected host + federation "ghost" peers this browser holds no host
// session for), built from the same `buildClusterNodes` merge the Cluster page
// renders from — capacity can't be averaged across machines, so it's one row per
// node.
//
// The row states what a node is carrying and navigates to it: status dot, name,
// round trip, the three capacity meters with their absolute readings, and what is
// running on it. It is the `dash-fleet-row` idiom the Cluster page's node list
// uses, so the two surfaces are the same row with the same measurements.
//
// Card height is therefore a function of the node count and nothing else, which is
// what lets the widget declare a one-row span: a grid row span is a MINIMUM, so a
// card that states its own height leaves no cell underfilled.
//
// Everything rendered is a field the host DTO already carries. A node whose
// metrics feed is down has no capacity to show and says so — never a zero.

import React from "react";
import { BriefCard } from "../../components/BriefCard.jsx";
import { alertsTone, anchoredAlerts } from "../../components/ContextualAlerts.jsx";
import { HostMeters, hostHealth, hostMetricsFreshness } from "../../components/HostCardBody.jsx";
import { Icon } from "../../components/Icon.jsx";
import { playerTally } from "../../lib/servers.js";
import { useStore } from "../../lib/store.js";
import { serversStore } from "../../lib/stores.js";
import { membershipRowTone } from "../diagnostics/clusterBadges.jsx";

// What a node is carrying. `unseen` counts servers that cannot report a roster —
// their players are not zero, they are unknown, so the tally says "+" and names
// how many in its tooltip rather than absorbing them into the number.
function NodeCounts({ servers }) {
  const running = servers.filter(s => s.status === "online").length;
  const { total: players, unseen } = playerTally(servers);
  return (
    <span className="dash-fleet-row__counts">
      <b>{running} / {servers.length} running</b>
      <span title={unseen ? unseen + (unseen === 1 ? " server can't report who's on" : " servers can't report who's on") : undefined}>
        {players}{unseen ? "+" : ""} {players === 1 && !unseen ? "player" : "players"} connected
      </span>
    </span>
  );
}

// A federation peer with no connected host: nothing about it is measured here, so
// the meter slot says exactly that and the counts slot stays honest about it too.
function GhostRow({ n, onOpenDiagnostics }) {
  const tone = membershipRowTone(n.fed.membership);
  return (
    <button className={"dash-fleet-row dash-fleet-row--" + tone + " dash-fleet-row--ghost dash-fleet-row--counts"}
      onClick={onOpenDiagnostics}>
      <span className="dash-fleet-row__id">
        <span className={"dash-fleet-row__dot dash-fleet-row__dot--" + tone}></span>
        <span className="dash-fleet-row__name">{n.fed.label}</span>
        {n.latencyMs != null && <span className="dash-fleet-row__latency">{Math.round(n.latencyMs)}ms</span>}
      </span>
      <span className="dash-fleet-row__offline dash-fleet-row__offline--ghost">
        <Icon name="radar" size={13} /> Discovered · not connected
      </span>
      <span className="dash-fleet-row__counts">
        <b>—</b>
        <span>not connected</span>
      </span>
      <span className="dash-fleet-row__end">
        <Icon name="chevron-right" size={16} className="dash-fleet-row__go" />
      </span>
    </button>
  );
}

function NodeRow({ n, servers, onOpenHost }) {
  const h = n.host;
  const alerts = anchoredAlerts(an => an.surface === "diagnostics" && an.hostId === h.id);
  const { denied, metricsDown, meters, tone } = hostHealth(h);
  const fresh = hostMetricsFreshness(h);
  const mine = React.useMemo(() => servers.filter(s => s.hostId === h.id), [servers, h.id]);
  // Frozen is a statement ABOUT readings, so it is only worth making where there
  // are readings to qualify. A node showing no meters already says why in their
  // place, and saying it twice reads as two different faults.
  const stale = fresh.frozen && meters.length > 0;

  return (
    <button className={"dash-fleet-row dash-fleet-row--" + tone + " dash-fleet-row--counts" + (stale ? " is-frozen" : "")}
      onClick={() => onOpenHost && onOpenHost(h.id)}>
      <span className="dash-fleet-row__id">
        <span className={"dash-fleet-row__dot dash-fleet-row__dot--" + tone}></span>
        <span className="dash-fleet-row__name">{h.name}</span>
        {h.region && h.region !== "—" && <span className="dash-fleet-row__region">{h.region}</span>}
        {/* Readings we HAVE but that stopped updating are worse than none shown: say
            they are frozen, in place of a round trip that is equally stale. */}
        {stale
          ? <span className="dash-fleet-row__latency dash-fleet-row__latency--stale" title="These are the last readings measured, not live">
              frozen{fresh.label ? " · " + fresh.label.replace(/\s*ago$/, "") : ""}
            </span>
          : n.latencyMs != null && <span className="dash-fleet-row__latency">{Math.round(n.latencyMs)}ms</span>}
      </span>

      {meters.length ? (
        <span className="dash-fleet-row__meters">
          <HostMeters meters={meters} detail />
        </span>
      ) : denied ? (
        <span className="dash-fleet-row__offline dash-fleet-row__offline--denied">
          <Icon name="lock" size={13} /> No access on this node
        </span>
      ) : metricsDown ? (
        <span className="dash-fleet-row__offline dash-fleet-row__offline--metrics">
          <Icon name="activity" size={13} /> Metrics unavailable — capacity unknown
        </span>
      ) : (
        <span className="dash-fleet-row__offline">
          <Icon name={h._pending ? "loader-2" : "moon"} size={13} className={h._pending ? "is-spinning" : ""} />
          {h._pending ? "Awaiting telemetry" : "Disconnected"}
        </span>
      )}

      <NodeCounts servers={mine} />

      <span className="dash-fleet-row__end">
        {alerts.length > 0 && (
          <span className={"fleet-card__alerts fleet-card__alerts--" + (alertsTone(alerts) === "danger" ? "danger" : "warn")}>
            <Icon name="triangle-alert" size={11} strokeWidth={2.4} />{alerts.length}
          </span>
        )}
        <Icon name="chevron-right" size={16} className="dash-fleet-row__go" />
      </span>
    </button>
  );
}

function DashFleetStrip({ nodes, onOpenDiagnostics, onOpenHost }) {
  const servers = useStore(serversStore, s => s.list);

  return (
    <BriefCard
      icon="network"
      title="Cluster capacity"
      // With one node the count restates a row that is fully visible below it, and
      // the sidebar already says how many nodes there are.
      count={nodes.length > 1 ? nodes.length : null}
      countTone="neutral"
      onViewAll={onOpenDiagnostics}
      className="dash-fleet"
    >
      <div className="dash-fleet__rows">
        {nodes.map(n => n.ghost
          ? <GhostRow key={n.key} n={n} onOpenDiagnostics={onOpenDiagnostics} />
          : <NodeRow key={n.key} n={n} servers={servers} onOpenHost={onOpenHost} />)}
      </div>
    </BriefCard>
  );
}

export { DashFleetStrip };
