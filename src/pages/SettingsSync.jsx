import React from "react";

import { Icon } from "../components/Icon.jsx";
import { SettingsRow, SettingsSection, Toggle } from "../components/settings-primitives.jsx";
import { fmtRelative, parseTs } from "../lib/formatting.js";
import { useStore } from "../lib/store.js";
import { prefsStore } from "../lib/stores/prefs.js";

// SettingsSync — whether the things you arrange follow you between browsers.
//
// It sits on Devices because that is the tab about this browser and your others, and the switch is
// precisely a statement about the relationship between them.
//
// ⚠ The copy has to be exact about what enabling does, because it is not a merge. The device that
// turns it on becomes the source and **overwrites the others** — which is the only rule that
// converges without asking somebody to reconcile two dashboards by hand, and the only one that would
// be a nasty surprise if the button just said "Sync".

const STATUS = {
  local: { icon: "cloud-off", tone: "muted", label: "Not saved to a node",
    note: "Kept in this browser only. Preferences reach a node once you are signed in to one." },
  syncing: { icon: "refresh-cw", tone: "info", label: "Saving…", note: null },
  synced: { icon: "cloud", tone: "ok", label: "Saved",
    note: "Your preferences are stored on the node, so they survive this browser." },
  error: { icon: "cloud-alert", tone: "warn", label: "Not reaching the node",
    note: "Everything still works and nothing is lost — your preferences are saved here and will go up on the next change that lands." },
};

function SettingsSync() {
  const sync = useStore(prefsStore, s => s.sync);
  const status = useStore(prefsStore, s => s.status);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState(null);

  const st = STATUS[status] || STATUS.local;
  const device = prefsStore.device();
  const enabled = !!(sync && sync.enabled);
  // The source device is the one that turned it on. Naming it matters when it is NOT this browser:
  // "another device is the source" is the difference between an arrangement you can change and one
  // that was handed to you.
  const isSource = enabled && sync.sourceDevice === device;

  const toggle = async (next) => {
    setBusy(true); setErr(null);
    try { await prefsStore.setSync(next); }
    catch (e) { setErr(e); }
    finally { setBusy(false); }
  };

  return (
    <SettingsSection icon="refresh-cw" title="Preference sync"
      meta="Your dashboard layout, and anything else you arrange.">

      <SettingsRow icon={st.icon} title="This browser" sub={st.note} tone={st.tone}>
        <span className="settings-value">{st.label}</span>
      </SettingsRow>

      <SettingsRow icon="fingerprint" title="Device id"
        sub="Identifies this browser to the node. Clearing site data mints a new one, and this browser starts fresh.">
        <span className="settings-value settings-value--mono">{device}</span>
      </SettingsRow>

      <SettingsRow icon="cloud-cog" title="Sync across my devices"
        sub={enabled
          ? (isSource
            ? "On. This browser's arrangement is the one your other devices use."
            : "On. Every device shares one arrangement, set from another device.")
          : "Off. Each browser keeps its own arrangement."}>
        <Toggle on={enabled} disabled={busy || status === "local"} onChange={toggle}
          label="Sync preferences across my devices" />
      </SettingsRow>

      {/* Said BEFORE the switch is thrown, not after. Enabling is destructive to every other
          device's arrangement, and a person cannot consent to that from the word "sync". */}
      {!enabled && (
        <div className="settings-notice">
          <Icon name="info" size={13} /> Turning this on makes <b>this</b> browser's arrangement the
          one every device uses. Your other devices' current layouts are replaced.
        </div>
      )}

      {enabled && sync.updated && (
        <div className="settings-notice">
          <Icon name="check" size={13} /> Shared arrangement, set{isSource ? " here" : " from another device"}
          {" "}{fmtRelative(parseTs(sync.updated), new Date())}. Turning it off leaves every device
          holding a copy of it.
        </div>
      )}

      {status === "local" && (
        <div className="settings-notice">
          <Icon name="info" size={13} /> Sync needs a node to store preferences on. Connect one to
          turn it on.
        </div>
      )}

      {err && (
        <div className="settings-notice settings-notice--danger">
          <Icon name="circle-x" size={13} /> Couldn’t change the setting
          {err.userMessage ? " — " + err.userMessage : "."} Nothing was changed on your devices.
        </div>
      )}
    </SettingsSection>
  );
}

export { SettingsSync };
