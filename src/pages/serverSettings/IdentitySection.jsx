// IdentitySection — the two names a server has: the label people read it by, and the id everything
// else keys on.
//
// Self-contained like PlacementSection, and for the same reason: the rest of the page is a form saved
// with one button, and this writes the moment it is confirmed. It also owns its own outcome — a
// refusal here is the engine's own sentence about the label that was typed, and a toast would carry
// it away from the field it is about.

import React from "react";
import { Icon } from "../../components/Icon.jsx";
import { SettingsRow, SettingsSection } from "../../components/settings-primitives.jsx";
import { serverOperable } from "../../lib/persona.js";
import { DISPLAY_NAME_MAX } from "../../lib/servers.js";
import { setServerDisplayName } from "../../lib/stores.js";

// kgsm's own error lines are prefixed with the script that raised them ("[ERROR] instances.sh: …").
// That prefix names a file nobody reading this page can open, so it is dropped and the sentence after
// it — which is the part about their label — is what shows.
const engineText = (e, fallback) => {
  const raw = (e && (e.userMessage || e.message)) || "";
  const cleaned = raw.replace(/^\s*\[(ERROR|WARNING)\]\s*[\w.-]+\.sh:\s*/gim, "").trim();
  return cleaned || fallback;
};

function IdentitySection({ server }) {
  const canRename = serverOperable(server);
  // The label as the backend last reported it. Never blank — an unlabelled instance reads as its id —
  // so "is this server named" is the comparison against the id, not an emptiness check.
  const label = server.name || server.id;
  const named = label !== server.id;

  const [draft, setDraft] = React.useState(label);
  const [phase, setPhase] = React.useState("idle"); // "idle" | "saving" | "clearing"
  const [error, setError] = React.useState(null);
  const [saved, setSaved] = React.useState(false);

  // Re-seed on a switch to another server, and whenever the label itself moves — a rename made
  // elsewhere arrives on the servers stream, and a field still holding the old text would write it
  // back over the new one on the next save.
  React.useEffect(() => { setDraft(label); setError(null); setSaved(false); }, [server.id, label]);

  const trimmed = draft.trim();
  // The cap kgsm-api enforces, mirrored so it is visible while typing. It measures what will be
  // stored and REJECTS rather than truncating, which is why nothing here clips the field.
  const tooLong = trimmed.length > DISPLAY_NAME_MAX;
  const busy = phase !== "idle";
  const dirty = trimmed !== label;

  const write = (next, kind) => {
    setPhase(kind);
    setError(null);
    setSaved(false);
    setServerDisplayName(server.hostId, server.id, next).then(
      (name) => { setPhase("idle"); setDraft(name); setSaved(true); },
      (e) => { setPhase("idle"); setError(engineText(e, "Couldn’t change the display name.")); },
    );
  };

  const submit = (e) => {
    e.preventDefault();
    if (busy || tooLong || !trimmed || !dirty) return;
    write(trimmed, "saving");
  };

  return (
    <SettingsSection icon="tag" title="Identity">
      {!canRename && (
        <SettingsRow icon="tag" title="Display name">
          <span style={{ fontSize: 13, color: "var(--fg-1)" }}>{label}</span>
        </SettingsRow>
      )}

      <SettingsRow icon="hash" title="Instance id">
        <code style={{ fontSize: 12.5 }}>{server.id}</code>
      </SettingsRow>

      {canRename && (
        <div className="srv-rename">
          <form className="srv-rename__row" onSubmit={submit}>
            <label className="srv-move__label" htmlFor="srv-rename-input">Display name</label>
            <input
              id="srv-rename-input"
              value={draft}
              disabled={busy}
              placeholder={server.id}
              onChange={(e) => { setDraft(e.target.value); setError(null); setSaved(false); }} />
            <button type="submit" className="lib-btn lib-btn--primary" disabled={busy || tooLong || !trimmed || !dirty}>
              {phase === "saving" ? "Saving…" : "Save"}
            </button>
            {named && (
              <button
                type="button"
                className="lib-btn"
                disabled={busy}
                onClick={() => write("", "clearing")}>
                <Icon name="eraser" size={12} /> {phase === "clearing" ? "Clearing…" : "Clear"}
              </button>
            )}
            {tooLong && (
              <span className="srv-rename__count">{trimmed.length}/{DISPLAY_NAME_MAX}</span>
            )}
            {saved && !error && (
              <span className="srv-rename__ok"><Icon name="check" size={12} strokeWidth={2.4} /> Saved</span>
            )}
          </form>
          {error && <div className="lib-err">{error}</div>}
        </div>
      )}
    </SettingsSection>
  );
}

export { IdentitySection };
