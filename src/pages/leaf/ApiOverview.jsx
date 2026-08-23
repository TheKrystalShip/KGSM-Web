// ApiOverview — the one leaf whose page is served by the leaf it describes.
//
// Everything else in the Control Panel reaches its subject through this API. This page turns that around
// and asks what the API itself is: which build is answering, which leaves it can currently reach, who is
// signed in to it, and which other nodes it is federated with. Nothing here is a new measurement — it is
// the data the API already publishes about itself, gathered onto the page where someone would look for it.
//
// The Settings tab for this leaf is inert by design (its descriptor is readOnly — applying a change here
// would mean restarting the process serving the request), which is exactly why the Overview carries more
// than the others: it is the only tab with anything to say.
//
// The three sources degrade independently. Identity is the page; sessions and peers are additive, and
// each says so when it can't be read rather than rendering an empty list that would read as "nobody is
// signed in" or "this node stands alone".

import { BriefCard } from "../../components/BriefCard.jsx";
import { CardTable } from "../../components/CardTable.jsx";
import { KPI } from "../../components/KPI.jsx";
import { api } from "../../lib/apiClient.js";
import { fmtRelative, parseTs } from "../../lib/formatting.js";
import { leafIcon } from "../../lib/leaves.js";
import { fetchHostDetail } from "../../lib/stores.js";
import {
  LeafBriefEmpty, LeafBriefItem, LeafFacts, LeafLoading, LeafUnreadable, useLeafResource,
} from "./leafOverviewKit.jsx";

// The capability vocabulary, in the panel's tones. `absent` is muted rather than red: a leaf this host
// was never given is not a leaf that broke, and the Services board is where you'd go to connect one.
const CAP_STATE = {
  operational: { tone: "ok",     label: "reachable" },
  degraded:    { tone: "warn",   label: "degraded" },
  down:        { tone: "danger", label: "not answering" },
  unknown:     { tone: "muted",  label: "unknown" },
  absent:      { tone: "muted",  label: "not connected" },
};
const capState = (c) => CAP_STATE[(c && c.status) || "unknown"] || CAP_STATE.unknown;

const chipTone = (tone) => (tone === "ok" ? "ok" : tone === "danger" || tone === "warn" ? "danger" : "muted");

// Identity is the page and must succeed; the other two are additive and resolve to null on any failure,
// so one unreadable source never costs the whole Overview.
function loadApiOverview(hostId) {
  return Promise.all([
    fetchHostDetail(hostId),
    api.sessions(hostId).list().catch(() => null),
    api.peers(hostId).roster().catch(() => null),
  ]).then(([host, sessions, peers]) => (host ? { host, sessions, peers } : null));
}

function ApiOverview({ hostId, leafId }) {
  const { state, data, error, reload } = useLeafResource(hostId, leafId, (h) => loadApiOverview(h));

  if (state === "loading") return <LeafLoading what="Reading this node’s identity…" />;
  if (state === "error" || state === "none") {
    return <LeafUnreadable what="Node identity" error={error} onRetry={reload} />;
  }

  const host = data.host;
  const sessions = data.sessions ? data.sessions.sessions : null;
  const peers = Array.isArray(data.peers) ? data.peers : null;
  const now = new Date();

  // The capability block keyed by leaf, in the order the Services board uses. `api` is excluded — this
  // API does not hold a capability describing itself, and inventing one would be circular.
  const caps = host.capabilities || {};
  const capRows = Object.keys(caps)
    .filter(k => k !== "api")
    .map(k => ({ id: k, cap: caps[k], ...capState(caps[k]) }));
  const reachable = capRows.filter(r => r.cap && r.cap.status === "operational");
  const provisioned = capRows.filter(r => r.cap && r.cap.provisioned);

  // A dash is an unread value, not a missing one, so the identity rows say which they are.
  const unknown = <span className="svc-fact svc-fact--unit">not reported</span>;

  // `0.64.0+6f37d941bf20` → the version and the commit apart. A build with no `+` (outside a git
  // checkout, where the SHA is honestly absent rather than fabricated) yields no sha and reads fine.
  const build = host.panel_version && host.panel_version !== "—" ? host.panel_version : null;
  const [buildVersion, buildSha] = build ? build.split("+") : [null, null];

  return (
    <>
      <div className="dash-summary">
        {/* Split at the `+`: the KPI's big-number slot fits a semantic version and clips a 12-character
            commit hash. The version is what identifies the build to a person; the hash is what
            identifies it to git, so it travels in the sub line and in full on the card below. */}
        <KPI icon="tag" label="Build" value={buildVersion || "—"} tone="muted"
          sub={[buildSha, host.runtime ? "on " + host.runtime : null].filter(Boolean).join(" · ")
            || "runtime not reported"} />
        <KPI icon="plug" label="Leaves reachable" value={capRows.length ? reachable.length : "—"}
          tone={!capRows.length ? "muted" : reachable.length === provisioned.length ? "ok" : "warn"}
          sub={capRows.length
            ? "of " + provisioned.length + " connected on this host"
            : "no capabilities reported"}
          barPct={provisioned.length ? (reachable.length / provisioned.length) * 100 : undefined} />
        {/* Null is "we couldn't read the session registry", which is not zero people signed in. */}
        <KPI icon="users" label="Active sessions" value={sessions ? sessions.length : "—"} tone="muted"
          sub={sessions
            ? (sessions.length === 1 ? "one signed-in browser" : "signed-in browsers on this node")
            : "the session registry didn’t answer"} />
        <KPI icon="network" label="Cluster peers" value={peers ? peers.length : "—"} tone="muted"
          sub={peers
            ? (peers.length === 0 ? "this node stands alone" : "nodes in the converged roster")
            : "the peer roster didn’t answer"} />
      </div>

      <div className="dash-feed">
        <BriefCard icon="server-cog" title="This node"
          meta="Who this API says it is, and what it is running on.">
          <LeafFacts rows={[
            ["Host id", host.id],
            ["Label", host.name || unknown],
            ["Hostname", host.hostname || unknown],
            ["Region", host.region && host.region !== "—" ? host.region : unknown,
              "Operator-declared, not derived — it is whatever this host was configured to call itself."],
            ["Build", host.panel_version || unknown,
              "The API assembly version with the git commit it was built from."],
            ["Runtime", host.runtime || unknown],
            ["OS", host.os && host.os !== "—" ? host.os + (host.kernel && host.kernel !== "—" ? " · " + host.kernel : "") : unknown],
            ["Libraries", host.libraries
              ? (host.libraries.length === 0
                  ? "none registered"
                  : host.libraries.map(l => l.name).join(", "))
              : unknown,
              "The named roots kgsm places game servers in on this box."],
          ]} />
        </BriefCard>

        <BriefCard icon="plug" title="Leaves this API reaches" count={capRows.length || null} countTone="neutral"
          meta="The capability view — provisioning is what’s connected, status is what answers right now.">
          {capRows.length === 0 ? (
            <LeafBriefEmpty title="No capabilities reported">
              This host answered without a capability block, so what the API can reach can’t be read here.
            </LeafBriefEmpty>
          ) : (
            <div className="chat-brief__list">
              {capRows.map(r => (
                <LeafBriefItem key={r.id}
                  tone={r.tone === "ok" ? "info" : r.tone === "muted" ? "info" : r.tone}
                  icon={leafIcon(r.id)}
                  title={r.id}
                  detail={r.cap && r.cap.provisioned === false
                    ? "not connected on this host"
                    : r.label + (r.cap && r.cap.message ? " — " + r.cap.message : "")} />
              ))}
            </div>
          )}
        </BriefCard>
      </div>

      <CardTable
        icon="users" title="Active sessions" count={sessions ? sessions.length : 0}
        columns={[
          {
            key: "userId", label: "User", width: "minmax(0,1.3fr)", sort: r => r.userId,
            render: r => (
              <>
                {r.userId}
                {r.current && <span className="cluster-chip cluster-chip--ok" style={{ marginLeft: 8 }}>this browser</span>}
              </>
            ),
          },
          {
            key: "userAgent", label: "Client", width: "minmax(0,1.6fr)", sort: r => r.userAgent,
            render: r => (r.userAgent || <span className="svc-fact svc-fact--unit">not recorded</span>),
          },
          {
            key: "lastSeen", label: "Last seen", width: "130px", align: "right",
            sort: r => (r.lastSeen ? parseTs(r.lastSeen) : null), defaultDir: "desc",
            render: r => (r.lastSeen
              ? <span title={parseTs(r.lastSeen).toLocaleString()}>{fmtRelative(parseTs(r.lastSeen), now)}</span>
              : "—"),
          },
          {
            key: "expires", label: "Expires", width: "150px", align: "right",
            sort: r => (r.expires ? parseTs(r.expires) : null),
            render: r => (r.expires
              ? <span title={parseTs(r.expires).toLocaleString()}>{parseTs(r.expires).toLocaleString()}</span>
              : "—"),
          },
        ]}
        rows={sessions || []}
        getKey={r => r.sid}
        defaultSort={{ key: "lastSeen", dir: "desc" }}
        empty={sessions
          ? "No active sessions on this node."
          : "The session registry didn’t answer — this is not “nobody is signed in”."} />

      {/* Rendered even at zero peers, because "this node stands alone" is an answer someone came here for
          — and a table that vanishes at zero cannot distinguish it from one that failed to load. */}
      <CardTable
        icon="network" title="Cluster peers" count={peers ? peers.length : 0}
        columns={[
          { key: "label", label: "Node", width: "minmax(0,1.3fr)", sort: r => r.label || r.nodeId },
          {
            key: "status", label: "Status", width: "120px", sort: r => r.status,
            render: r => {
              const tone = r.status === "alive" || r.status === "online" ? "ok"
                : r.status === "unknown" ? "muted" : "danger";
              return <span className={"cluster-chip cluster-chip--" + chipTone(tone)}>{r.status}</span>;
            },
          },
          { key: "membership", label: "Membership", width: "130px", sort: r => r.membership },
          {
            key: "latencyMs", label: "Latency", width: "100px", align: "right", sort: r => r.latencyMs,
            // The raw number sorts; an unmeasured link renders "—" and sinks, never 0ms (which would
            // read as the fastest node in the cluster).
            render: r => (r.latencyMs == null ? "—" : Math.round(r.latencyMs) + " ms"),
          },
          {
            key: "clientUrl", label: "Address", width: "minmax(0,1.4fr)", sort: r => r.clientUrl,
            render: r => (r.clientUrl || <span className="svc-fact svc-fact--unit">not reported</span>),
          },
        ]}
        rows={peers || []}
        getKey={r => r.nodeId}
        defaultSort={{ key: "label", dir: "asc" }}
        empty={peers
          ? "This node isn’t federated with any peer — it stands alone."
          : "The peer roster didn’t answer."} />
    </>
  );
}

export { ApiOverview };
