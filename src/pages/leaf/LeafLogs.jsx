// LeafLogs — one leaf's journal. The host's Logs tab merges every leaf and offers a source picker;
// this one is already scoped by what it was bound to, so it asks journald for that single source and
// shows it with no picker to set.
//
// It renders through the same ConsoleView as the host logs and the game console, so a journal reads
// identically wherever you open it — same gutter, same levels, same full-screen pop-out.
//
// It is bound by PROPS and reads a KEYED store, which is what lets it be pinned: two of these can be
// on screen at once — two leaves side by side on the dashboard, or one pinned while its own page is
// open — and they share one hydrate and one live subscription per (host, leaf) rather than fighting
// over a single slot. See lib/keyedResource.js.

import { ConsoleView } from "../../components/ConsoleView.jsx";
import { Icon } from "../../components/Icon.jsx";
import { PinButton } from "../../components/widgets/PinButton.jsx";
import { useKeyedResource } from "../../lib/keyedResource.js";
import { useStore } from "../../lib/store.js";
import { leafLogsKey, leafLogsStore, subscribeLeafLogs } from "../../lib/stores.js";

function LeafLogs({ hostId, leafId, svc }) {
  const key = hostId && leafId ? leafLogsKey(hostId, leafId) : null;
  const entry = useStore(leafLogsStore, s => (key ? s.byKey[key] : null));

  useKeyedResource(
    key,
    () => leafLogsStore.refresh(hostId, leafId).catch(() => {}),
    () => subscribeLeafLogs(hostId, leafId));

  const label = (svc && svc.displayName) || leafId;
  const ready = !!entry;
  const lines = ready && Array.isArray(entry.list) ? entry.list.slice().reverse() : [];
  const pin = <PinButton type="leaf.logs" params={{ hostId, leafId }} label={label + "'s journal"} />;

  if (ready && lines.length) {
    return (
      <ConsoleView
        title={label + " · journal"}
        icon="scroll-text"
        lines={lines}
        count={lines.length}
        pill={{ label: "Live", live: true }}
        pin={pin}
        resetKey={hostId + "/" + leafId} />
    );
  }

  // A host whose log source map is configured by hand can leave a leaf out of it — the API answers
  // 400 for a source it doesn't carry, which is a different fact from "this leaf has been quiet".
  const unmapped = ready && entry.status === "error" && entry.error && entry.error.status === 400;
  const phase = !ready || entry.status === "loading" ? "loading"
    : unmapped ? "unmapped"
      : entry.status === "error" ? "error" : "quiet";

  const TITLE = {
    loading: "Loading " + label + " logs…",
    unmapped: "No journal source for " + label,
    error: label + " logs unavailable",
    quiet: "No recent log lines",
  };
  const SUB = {
    loading: "Reading this leaf’s systemd journal" + (svc && svc.unit ? " (" + svc.unit + ")." : "."),
    unmapped: "This host doesn’t publish a log source for this leaf, so there is no journal to read.",
    error: "Couldn’t read the journal — the host’s log source didn’t respond.",
    quiet: label + " hasn’t logged anything in the recent window.",
  };
  const TAG = { loading: "loading", unmapped: "no log source", error: "unavailable", quiet: "quiet" };

  // The pin belongs on this branch too. A leaf that has been quiet is exactly the one somebody wants
  // in front of them, and offering the control only once there are lines would mean the journals you
  // most want to watch are the ones you cannot pin. It is dropped only for `unmapped`, where there
  // is no journal to follow at all and pinning would add a widget that can never say anything.
  return (
    <div className="proc-unavailable">
      <span className="proc-unavailable__icon"><Icon name="scroll-text" size={26} strokeWidth={1.9} /></span>
      <div className="proc-unavailable__title">{TITLE[phase]}</div>
      <div className="proc-unavailable__sub">{SUB[phase]}</div>
      <span className="proc-unavailable__tag"><Icon name="activity" size={12} /> {TAG[phase]}</span>
      {phase !== "unmapped" && <div className="proc-unavailable__pin">{pin}</div>}
    </div>
  );
}

export { LeafLogs };
export default LeafLogs;
