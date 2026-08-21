import { NeedsAttention } from "../../../components/NeedsAttention.jsx";
import { useNav } from "../../../components/NavContext.jsx";
import { RecentActivity } from "../../../components/RecentActivity.jsx";
import { useAssistantDock } from "../../../components/AssistantDockContext.jsx";
import { runServerAction } from "../../../lib/serverActions.js";

// The two feed cards, each on its own now that they are placeable separately: "needs me now" and
// "what just happened". They were one band because they were laid out as a pair; as widgets each is
// its own thing, and somebody who only wants alerts is no longer given both.
//
// Both are already store-fed and already accept their own props, so these are thin — they supply the
// wiring the dashboard page used to pass down.

// Alerts shows its all-clear empty state: an alerts card that vanishes when nothing is firing would
// make "no alerts" and "no alerts widget" look identical.
function AlertsLatest() {
  const nav = useNav();
  const { askAboutAlert } = useAssistantDock();
  return (
    <NeedsAttention
      title="Alerts - Latest"
      max={3}
      emptyState
      onPick={askAboutAlert}
      onRun={(id, action) => runServerAction(action, id)}
      onViewAll={() => nav.alerts()}
    />
  );
}

// The same feed the Audit page renders, newest-first across every node — this is a compact window
// onto it, and the page owns the full searchable list.
function ActivityRecent() {
  const nav = useNav();
  return (
    <RecentActivity
      title="Audit - Recent activity"
      max={3}
      onViewAll={() => nav.audit()}
    />
  );
}

export { ActivityRecent, AlertsLatest };
