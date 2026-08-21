import { Icon } from "../components/Icon.jsx";
import { SubTabs } from "../components/SubTabs.jsx";
import { ThemePicker } from "../components/ThemePicker.jsx";
import { SettingsRow, SettingsSection } from "../components/settings-primitives.jsx";
import { SettingsMemory } from "../components/SettingsMemory.jsx";
import { signInMethodLabel } from "../components/host-helpers.jsx";
import { useAssistantDock } from "../components/AssistantDockContext.jsx";
import { capUsable } from "../lib/capabilities.js";
import { ROUTE_TABS } from "../lib/labels.js";
import { SettingsAccess } from "./SettingsAccess.jsx";
import { SettingsIdentities } from "./SettingsIdentities.jsx";
import { SettingsNotifications } from "./SettingsNotifications.jsx";
import { SettingsSessions } from "./SettingsSessions.jsx";
import { SettingsSync } from "./SettingsSync.jsx";

// SettingsPage — YOUR account, and nothing about anybody else's. Tabs in the order somebody actually
// asks the questions: who am I (Profile), how do I get in (Security), where am I signed in (Devices),
// what does the assistant know about me (Memory), how do I get told things (Notifications).
// Appearance lives on Profile.
//
// The subject is what puts a tab here, never which service owns the data — this page is already a
// join across three of them (the node's account store, this browser, and the assistant leaf), held
// together by every one of them being about the person reading it.
//
// Tabbed rather than one long column because the five are genuinely different subjects, and stacked
// as equal cards none of them read as primary — the page became a list of slabs with no hierarchy.
// The tab strip is the same `SubTabs` the server detail, node deep-dive and leaf pages use, so this
// page navigates like the rest of the site rather than inventing a fifth idiom for itself.
//
// The tab lives in the URL (`#/settings/security`), so Back, Forward, refresh and a shared link all
// land where they should. `profile` is the default and is omitted, so the plain `#/settings` the
// sidebar produces is the landing tab's canonical address.
//
// The subject is the person reading it. Administering other people's accounts is the API leaf's
// Users tab (`leaf/ApiUsers.jsx`), where kgsm-api's account store is — a page about who you are is
// the wrong place to decide what everybody else may do.
//
// Your name and username are shown, not edited. They come from whichever door you signed in
// through: a password sign-in carries the account's own display name, a provider sign-in carries
// that provider's rendering of it, re-read at each login. Neither is a field this panel owns, so
// neither is offered as one — an input that silently persists nowhere is worse than a plain value.

// Shared with the breadcrumb, which names the tab the URL carries (lib/labels.js).
const TABS = ROUTE_TABS.settings;

function SettingsPage({ user, onLogout, tab, onTabChange }) {
  // Which door this session came through, derived from the handle the backend returned
  // (`provider:subject`) at login. It decides what the password row can offer, so it is read here
  // once and passed down rather than re-derived.
  const sessionProvider = (user && user.provider) || null;

  // The leaf your chat is currently pointed at — memory lives on that leaf, addressed the same way
  // a turn is, direct to the assistant rather than through kgsm-api's peer relay.
  //
  // ⚠ Which leaf is not incidental here: this page is one page over a whole cluster, and a memory
  // belongs to one assistant. The card is given the host's NAME so it can say whose memory it is
  // showing, and the count of assistant-capable hosts so it can tell "nobody runs one" apart from
  // "several do and the dock is deliberately holding its target unset until you pick". Opening the
  // chat is how that pick is made; this page never offers a second way to set it.
  const { assistantHost, assistantHostList, setAssistantOpen } = useAssistantDock();
  const assistantConnected = !!(assistantHost && capUsable(assistantHost, "assistant"));

  // An unknown tab falls back to the landing one rather than rendering an empty body — a stale or
  // hand-typed URL should land somewhere, not nowhere.
  const active = TABS.some((t) => t.id === tab) ? tab : "profile";

  return (
    <>
      <div className="dash-head">
        <h1>Settings</h1>
        <div className="dash-head__sub">Your account and how Krystal behaves across the site.</div>
      </div>

      <SubTabs tabs={TABS} active={active} onChange={onTabChange} />

      <div className="settings-body">
        {active === "profile" && (
          <>
            <SettingsSection icon="user" title="You">
              <div className="settings-profile">
                {/* The same gradient circle AccountAvatar draws, styled by this card's own rule. An
                    avatar image is not plumbed through the session, so the initial is what there
                    honestly is. */}
                <span className="settings-profile__avatar">
                  {((user && (user.display || user.name)) || "?")[0].toUpperCase()}
                </span>
                <div className="settings-profile__info">
                  <span className="settings-profile__name">{(user && (user.display || user.name)) || "—"}</span>
                  <span className="settings-profile__provider">
                    via {signInMethodLabel(sessionProvider)}
                  </span>
                </div>
              </div>
              <SettingsRow icon="at-sign" title="Account"
                sub={sessionProvider === "local"
                  ? "Your KGSM account name. An administrator changes it."
                  : `From your ${signInMethodLabel(sessionProvider)} account, and re-read each time you sign in.`}>
                <span className="settings-value settings-value--mono">{(user && user.id) || "—"}</span>
              </SettingsRow>
            </SettingsSection>

            {/* What you may do, per node — the one question no other surface answers out loud. */}
            <SettingsAccess />

            {/* Appearance sits with the profile rather than on a tab of its own: it is one
                preference, and a tab holding a single control is an empty screen with a heading. */}
            <SettingsSection icon="palette" title="Appearance"
              meta="Saved on this device, never on a node. Auto follows your system.">
              <ThemePicker />
            </SettingsSection>

            {/* Last on this tab, and on this tab because deleting an account is a fact about who you
                are rather than about how you sign in. */}
            <SettingsSection icon="triangle-alert" title="Danger zone">
              {/* Disabled, and said plainly: no endpoint deletes an account on request yet. The row
                  is here because the capability is intended — but a button that looks live and does
                  nothing is the one thing a danger zone must never be. Until the endpoint exists,
                  the honest route is the one that actually works. */}
              <SettingsRow icon="trash-2" title="Delete account"
                sub="Not available yet. An administrator can remove your account from the node's Users tab.">
                <button className="settings-btn-danger" disabled title="No endpoint for this yet">
                  Delete account
                </button>
              </SettingsRow>
              <div className="settings-notice">
                <Icon name="info" size={13} /> To sign out of every device, use Log out all under
                Devices.
              </div>
            </SettingsSection>
          </>
        )}

        {/* How you get in: the password and the accounts that stand in for it, together. */}
        {active === "security" && <SettingsIdentities sessionProvider={sessionProvider} />}

        {/* Where you are signed in, and the history of getting there. */}
        {/* Devices holds both halves of "this browser versus your others": where you are signed in,
            and whether what you arrange follows you between them. */}
        {active === "devices" && (
          <>
            <SettingsSync />
            <SettingsSessions onLogout={onLogout} />
          </>
        )}

        {active === "memory" && (
          <SettingsMemory
            hostId={assistantHost && assistantHost.id}
            connected={assistantConnected}
            hostName={assistantHost && assistantHost.name}
            candidates={assistantHostList.length}
            onPickHost={() => setAssistantOpen(true)}
          />
        )}

        {active === "notifications" && <SettingsNotifications />}
      </div>
    </>
  );
}

export { SettingsPage };
export default SettingsPage;
