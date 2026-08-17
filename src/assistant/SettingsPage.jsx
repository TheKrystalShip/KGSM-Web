import React from "react";

import { Icon } from "../components/Icon.jsx";
import { SubTabs } from "../components/SubTabs.jsx";
import { ThemePicker } from "../components/ThemePicker.jsx";
import { SettingsRow, SettingsSection, Toggle } from "../components/settings-primitives.jsx";
import { SettingsMemory } from "../components/SettingsMemory.jsx";
import * as push from "./push.js";
import { SETTINGS_TABS } from "./route.js";
import { SELF } from "./self.js";

// The standalone assistant's settings — the preferences that belong to this surface and this
// device, on a page of their own rather than tucked under the conversation rail.
//
// It is built from the Control Panel's own settings furniture (`SubTabs`, `SettingsSection`,
// `SettingsRow`, `ThemePicker`) so somebody who knows one screen knows this one, and so a change to
// how a settings row looks lands on both. What it does NOT borrow is the panel's page: that one is
// about a KGSM account across a cluster — access per node, sessions, connected identities — and
// none of those questions exist on a surface that talks to one leaf.
//
// Three tabs, in the order the questions get asked: how this looks, what it remembers about you,
// and how it gets hold of you.
//
// The tab lives in the URL (`#/settings/notifications`), so Back, Forward, refresh and a shared
// link all land on the right one; `appearance` is the default and is omitted.

const TABS = [
  { id: "appearance", label: "Appearance", icon: "palette" },
  { id: "memory", label: "Memory", icon: "brain" },
  { id: "notifications", label: "Notifications", icon: "bell" },
];

function SettingsPage({ tab, onTabChange, onBack }) {
  const active = TABS.some((t) => t.id === tab) ? tab : SETTINGS_TABS[0];

  return (
    <div className="assistant-settings">
      {/* The way back is the only chrome this surface has: there is no sidebar to return to and no
          breadcrumb trail behind it, so the page carries its own exit. */}
      <div className="assistant-settings__bar">
        <button type="button" className="assistant-settings__back" onClick={onBack}>
          <Icon name="arrow-left" size={16} />
          <span>Back to chat</span>
        </button>
      </div>

      <div className="assistant-settings__body">
        <div className="dash-head">
          <h1>Settings</h1>
          <div className="dash-head__sub">How the assistant looks and how it reaches you.</div>
        </div>

        <SubTabs tabs={TABS} active={active} onChange={onTabChange} />

        <div className="settings-body">
          {active === "appearance" && (
            <SettingsSection icon="palette" title="Theme"
              meta="Saved on this device, never on a node. Auto follows your system.">
              <ThemePicker />
            </SettingsSection>
          )}

          {active === "memory" && <SettingsMemory hostId={SELF} />}

          {active === "notifications" && <Notifications />}
        </div>
      </div>
    </div>
  );
}

// One switch, for one thing: being told about an action the assistant staged and is waiting on you
// for, once you have stopped looking at the chat.
//
// It is per DEVICE rather than per account, because that is what a push subscription is — this
// browser, on this origin, with keys it minted itself. Signing in on a second phone notifies neither
// until that one is registered too.
//
// ⚠ What this deliberately does NOT offer is a list of events. The assistant announces the one thing
// that is its own; a crash or a finished update is the Control Panel's, on its own origin with its
// own key, and offering them here would be one person notified twice from two apps.
function Notifications() {
  const [state, setState] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  const refresh = React.useCallback(() => {
    push.status().then(setState).catch(() => setState({ state: "unsupported", registered: false }));
  }, []);

  React.useEffect(refresh, [refresh]);

  async function toggle(next) {
    setBusy(true);
    setError("");
    try {
      // ⚠ Called straight off the click. The permission prompt has to come from a real gesture, and
      // an `await` before it is what turns a prompt into a silent denial on some browsers.
      if (next) await push.subscribe();
      else await push.unsubscribe();
      refresh();
    } catch (e) {
      setError(e && e.message ? e.message : "That didn’t work.");
    } finally {
      setBusy(false);
    }
  }

  if (!state) {
    return (
      <SettingsSection icon="bell" title="Notifications">
        <SettingsRow icon="loader" title="Checking this device…" />
      </SettingsSection>
    );
  }

  // The three states where there is nothing to toggle each get their own sentence, because the thing
  // to do about them is different — and "unsupported" would be false for two of them.
  const blocked = {
    "needs-install": {
      icon: "smartphone",
      title: "Add the assistant to your Home Screen first",
      sub: "On iPhone and iPad, notifications only work once this is installed as an app. Share → Add to Home Screen, then open it from there.",
    },
    unsupported: {
      icon: "bell-off",
      title: "This browser can’t receive notifications",
      sub: "It doesn’t support the Push API. A recent Chrome, Firefox, Edge or Safari does.",
    },
    denied: {
      icon: "bell-off",
      title: "Notifications are blocked for this site",
      sub: "The browser won’t ask again — you’ll have to re-allow them in its site settings.",
    },
  }[state.state];

  return (
    <SettingsSection icon="bell" title="Notifications"
      meta="This device only. A push subscription belongs to one browser.">
      {blocked
        ? <SettingsRow icon={blocked.icon} title={blocked.title} sub={blocked.sub} tone="warn" />
        : (
          <SettingsRow icon="bell" title="Tell me about actions waiting on me"
            sub={state.enabled
              ? "When the assistant proposes something and you’ve closed the chat, it’ll send it here with Confirm and Cancel. A proposal expires a few minutes after it’s made, so this is a nudge, not an inbox."
              : "Switched off for this host by whoever runs it, so nothing would be sent."}>
            <Toggle on={state.registered} disabled={busy || !state.enabled}
              onChange={toggle} label="Notify this device about waiting actions" />
          </SettingsRow>
        )}

      {state.unreachable && (
        <div className="settings-notice">
          <Icon name="alert-triangle" size={13} /> {state.reason || "The assistant didn’t answer."}
        </div>
      )}

      {error && (
        <div className="settings-notice">
          <Icon name="alert-triangle" size={13} /> {error}
        </div>
      )}

      <div className="settings-notice">
        <Icon name="info" size={13} /> Notifications about your servers — a crash, a finished
        update — are the Control Panel’s, per device, under Settings → Notifications.
      </div>
    </SettingsSection>
  );
}

export { SettingsPage };
export default SettingsPage;
