// LeafPage — one leaf on one node, with its own sub-tabs. The shell here is deliberately generic:
// identity header, the tab switcher, System, Logs and Settings are IDENTICAL for every leaf, because
// all of that comes from the services row and the leaf config descriptor the leaf already ships. Only
// the middle differs.
//
// The header carries the leaf's name and its status chip and nothing else. Uptime, memory and pid are
// System's; repeating them above every tab put the same row on the page two and three times over.
//
// The trail above the page is the app's own breadcrumb (`components/Breadcrumb.jsx`), which the shell
// renders for every route — this page names its place there rather than drawing a second one.
//
// Adding a leaf's own tabs is therefore a body, not a page: register it in LEAF_TABS below. A leaf
// with nothing special still gets Overview + System + Logs + Settings and needs no code at all. The
// Commands tab is the one that registers itself — it follows the manifest a leaf ships rather than a
// list of leaves kept here, so it arrives with the file.
//
// Admin-only end to end (persona.ROUTE_CAP.leaf = host.manage): every surface it aggregates — the
// service row, the config, the assistant's conversation review — is Admin-policy in kgsm-api.

import React from "react";

import { Icon } from "../../components/Icon.jsx";
import { SubTabs } from "../../components/SubTabs.jsx";
import { useStore } from "../../lib/store.js";
import { useKeyedResource } from "../../lib/keyedResource.js";
import { fetchLeafCommands, fetchLeafReactorProposals, hostsStore, servicesStore, subscribeHostServices } from "../../lib/stores.js";
import { leafIcon, leafStatus } from "../../lib/leaves.js";
import { ROUTE_TABS } from "../../lib/labels.js";
import { AssistantOverview } from "./AssistantOverview.jsx";
import { AssistantConversations } from "./AssistantConversations.jsx";
import { ApiOverview } from "./ApiOverview.jsx";
import { ApiUsers } from "./ApiUsers.jsx";
import { MonitorThresholds } from "./MonitorThresholds.jsx";
import { BotOverview } from "./BotOverview.jsx";
import { FirewallOverview } from "./FirewallOverview.jsx";
import { MonitorOverview } from "./MonitorOverview.jsx";
import { ReactorOverview } from "./ReactorOverview.jsx";
import { ReactorDecisions } from "./ReactorDecisions.jsx";
import { ReactorProposals } from "./ReactorProposals.jsx";
import { ReactorRules } from "./ReactorRules.jsx";
import { SchedulerOverview } from "./SchedulerOverview.jsx";
import { SchedulerWindows } from "./SchedulerWindows.jsx";
import { SpeechOverview } from "./SpeechOverview.jsx";
import { WatchdogOverview } from "./WatchdogOverview.jsx";
import { LeafActivity } from "./LeafActivity.jsx";
import { LeafCommands } from "./LeafCommands.jsx";
import { LeafLogs } from "./LeafLogs.jsx";
import { LeafOverview } from "./LeafOverview.jsx";
import { LeafSettingsTab } from "./LeafSettingsTab.jsx";
import { LeafSystem } from "./LeafSystem.jsx";
import { KgsmOverview } from "./KgsmOverview.jsx";
import { KgsmLibraries } from "./KgsmLibraries.jsx";

// Per-leaf tabs, inserted between the always-present Overview and Settings. A leaf absent from this
// map simply has none — which is the correct answer for most of them today.
const LEAF_TABS = {
  // The engine's pseudo-leaf page. Library management sits here because a placement root is engine
  // domain — a root somebody declared to kgsm, not a filesystem the monitor found.
  kgsm: [
    { id: "library", label: "Library", icon: "hard-drive", render: (p) => <KgsmLibraries {...p} /> },
  ],
  assistant: [
    { id: "conversations", label: "Conversations", icon: "messages-square", render: (p) => <AssistantConversations {...p} /> },
  ],
  // Accounts belong to the API leaf because kgsm-api is what holds the account store — administered
  // where the service is, next to its logs and its configuration.
  api: [
    { id: "users", label: "Users", icon: "users", render: (p) => <ApiUsers {...p} /> },
  ],
  // Thresholds belong to the Monitor leaf for the same reason: the monitor is what evaluates them,
  // sample by sample, and the API only mirrors its verdicts into the alert feed.
  monitor: [
    { id: "thresholds", label: "Thresholds", icon: "gauge", render: (p) => <MonitorThresholds {...p} /> },
  ],
  // Windows belong to the scheduler for the same reason: the daemon is what holds each window's next
  // fire and its record of the last run, and it is the only thing that can move one. What a window IS
  // is written on the instance and edited on the server's own settings page.
  scheduler: [
    { id: "windows", label: "Windows", icon: "calendar-clock", render: (p) => <SchedulerWindows {...p} /> },
  ],
  // Decisions belong to the reactor for the same reason thresholds belong to the monitor: the reactor is
  // what reaches them, from its own ledger, and this is the review its plan gates propose and act mode
  // behind. Its own tab rather than a card on Overview because it is read deliberately, at a chosen
  // window, rather than glanced at.
  // Rules before Decisions: the rules are what the decisions are decisions OF, and a reader arriving at
  // this leaf for the first time needs the catalog before the log makes sense.
  // Proposals last of the three and badged, because it is the only one that is ever WAITING on
  // somebody: rules and decisions are read when a person chooses to, and an unanswered offer expires
  // whether or not anybody came looking.
  reactor: [
    { id: "rules", label: "Rules", icon: "scale", render: (p) => <ReactorRules {...p} /> },
    { id: "decisions", label: "Decisions", icon: "gavel", render: (p) => <ReactorDecisions {...p} /> },
    { id: "proposals", label: "Proposals", icon: "hand", render: (p) => <ReactorProposals {...p} /> },
  ],
};

// The Overview body a leaf renders. Falls back to the generic one, which is built purely from the
// service row + config descriptor and therefore works for any leaf.
const LEAF_OVERVIEW = {
  kgsm: (p) => <KgsmOverview {...p} />,
  assistant: (p) => <AssistantOverview {...p} />,
  firewall: (p) => <FirewallOverview {...p} />,
  api: (p) => <ApiOverview {...p} />,
  monitor: (p) => <MonitorOverview {...p} />,
  bot: (p) => <BotOverview {...p} />,
  scheduler: (p) => <SchedulerOverview {...p} />,
  reactor: (p) => <ReactorOverview {...p} />,
  speech: (p) => <SpeechOverview {...p} />,
  watchdog: (p) => <WatchdogOverview {...p} />,
};

function LeafPage({ hostId, leafId, tab, onSelectTab, onReviewConversation, onAudit }) {
  const hosts = useStore(hostsStore, s => s.list);
  const svcEntry = useStore(servicesStore, s => (hostId ? s.byHost[hostId] : null));

  useKeyedResource(
    hostId ? "host-services/" + hostId : null,
    () => servicesStore.refresh(hostId).catch(() => {}),
    () => subscribeHostServices(hostId));

  const host = hosts.find(h => h.id === hostId) || null;
  const ready = !!svcEntry;
  const svc = ready && Array.isArray(svcEntry.list) ? svcEntry.list.find(s => s.id === leafId) || null : null;

  // The Commands tab is NOT in the map above: which leaves take commands is the leaves' own answer,
  // shipped as a manifest kgsm-api scans for, so the tab follows the file rather than a list kept
  // here. A leaf that grows a command surface gains the tab with no change to this page.
  // A leaf that ships none, and a host that could not be asked, both come back with nothing to show —
  // so neither gets a tab. Claiming a command surface we have not read would be the worse answer.
  const [commands, setCommands] = React.useState(null);

  React.useEffect(() => {
    if (!hostId || !leafId) return undefined;
    let cancelled = false;
    setCommands(null);
    // The engine takes no leaf commands — it is not in the leaf catalog, so asking would be a
    // guaranteed 404 per page load.
    if (leafId === "kgsm") return undefined;
    fetchLeafCommands(hostId, leafId).then(
      (m) => { if (!cancelled) setCommands(m); },
      () => { if (!cancelled) setCommands(null); },
    );
    return () => { cancelled = true; };
  }, [hostId, leafId]);

  // How many offers are waiting for an answer, so the tab can say so without being opened. Its own
  // read rather than a store: it is one number, wanted on one page, and it has to be re-asked after
  // an offer is answered — which the tab body does by remounting on every visit.
  //
  // A failure leaves it null and the badge absent. Rendering a zero would say "nothing is waiting"
  // on a host that could not be asked, which is the one answer this must never give.
  const [openOffers, setOpenOffers] = React.useState(null);
  React.useEffect(() => {
    setOpenOffers(null);
    if (!hostId || leafId !== "reactor") return undefined;
    let cancelled = false;
    fetchLeafReactorProposals(hostId).then(
      (board) => { if (!cancelled) setOpenOffers(Array.isArray(board?.open) ? board.open.length : null); },
      () => { if (!cancelled) setOpenOffers(null); },
    );
    return () => { cancelled = true; };
  }, [hostId, leafId, tab]);

  const extraTabs = [
    ...(LEAF_TABS[leafId] || []),
    // Only once a manifest is actually in hand — a tab that appears and then turns out to be empty
    // is worse than one that appears a moment late.
    ...(commands ? [{
      id: "commands", label: "Commands", icon: "terminal",
      render: (p) => <LeafCommands {...p} />,
    }] : []),
  ];
  // System, Logs and Settings are here for every leaf, not per-leaf like the map above: each one is a
  // systemd unit, so each one has both a unit to report on and a journal. The shell's four come from
  // the shared table the breadcrumb reads (lib/labels.js); a leaf's own tabs slot in after Overview.
  // The engine is the exception — a stateless CLI with no unit, no journal and no config descriptor,
  // so its page is Overview plus its own tabs and none of the unit-vocabulary ones.
  const shell = leafId === "kgsm" ? [ROUTE_TABS.leaf[0]] : ROUTE_TABS.leaf;
  const tabs = [
    shell[0],
    ...extraTabs.map(t => ({
      id: t.id, label: t.label, icon: t.icon,
      ...(t.id === "proposals" && openOffers ? { badge: openOffers, badgeTone: "warn", badgeNoun: "offer" } : {}),
    })),
    ...shell.slice(1),
  ];
  const active = tabs.some(t => t.id === tab) ? tab : "overview";

  // The service row is the authority on liveness. Until it arrives the header shows the leaf id and
  // nothing else — an unknown state is left blank rather than guessed at.
  const status = svc ? leafStatus(svc) : null;
  const bodyProps = { hostId, leafId, svc, host, onReviewConversation, commands };

  const renderBody = () => {
    if (active === "system") return <LeafSystem hostId={hostId} leafId={leafId} svc={svc} />;
    if (active === "logs") return <LeafLogs hostId={hostId} leafId={leafId} svc={svc} />;
    if (active === "settings") return <LeafSettingsTab hostId={hostId} leafId={leafId} />;
    const extra = extraTabs.find(t => t.id === active);
    if (extra) return extra.render(bodyProps);
    // The activity lane sits under whichever Overview a leaf has, rather than inside each of them: the
    // rows come from the audit feed, not from the leaf, so it is the same card everywhere it appears and
    // belongs to the page rather than to any one body. It renders nothing for a leaf whose actions the
    // audit cannot honestly attribute (see LEAF_ACTIVITY).
    const overview = LEAF_OVERVIEW[leafId];
    return (
      <>
        {overview ? overview(bodyProps) : <LeafOverview {...bodyProps} />}
        <LeafActivity hostId={hostId} leafId={leafId} onViewAll={onAudit} />
      </>
    );
  };

  return (
    <>
      <div className="dash-head dash-head--actions">
        <div className="dash-head__titles">
          <h1>
            <Icon name={leafIcon(leafId)} size={20} />{" "}
            {(svc && svc.displayName) || leafId}
            {status && (
              <span className={"cluster-chip cluster-chip--" + (status.tone === "up" ? "ok" : status.tone === "warn" ? "danger" : "muted")}>
                <span className={"status-led status-led--" + (status.tone === "up" ? "live" : status.tone === "warn" ? "down" : "idle")}></span>
                {status.label}
              </span>
            )}
          </h1>
          <div className="dash-head__sub">
            {svc && svc.role ? svc.role : " "}
            {svc && svc.unit && <> &middot; <span className="svc-fact svc-fact--unit">{svc.unit}</span></>}
          </div>
        </div>
      </div>

      <SubTabs tabs={tabs} active={active} onChange={onSelectTab} />

      {renderBody()}
    </>
  );
}

export { LeafPage };
export default LeafPage;
