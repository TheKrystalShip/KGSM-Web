import React from "react";
import { Icon } from "./Icon.jsx";
import { SettingsRow, SettingsSection } from "./settings-primitives.jsx";
import { assistant } from "../lib/assistantClient.js";
import { fmtRelative, fmtTime, parseTs } from "../lib/formatting.js";

// SettingsMemory.jsx — what the assistant has written down about you, on the leaf you're currently
// talking to. Shared by both settings surfaces (the Control Panel's account page and the standalone
// assistant's own settings) so a change to how a memory row looks lands on both — it depends on
// nothing but `assistantClient`, `settings-primitives` and `formatting`, so it stays safe for the
// standalone surface (`npm run check:assistant`).
//
// The leaf, not this card, decides what "yours" means: `assistantClient.js` reaches it directly, the
// same seam a chat turn does, so this can only ever list or forget the caller's OWN memory.
//
// `hostId` is the leaf currently being talked to — a real host id in the panel, the fixed `"self"`
// key the standalone surface always uses. `connected` says whether that leaf is reachable right now,
// so the card can say why nothing loaded rather than just showing an empty list.

function fmtGuard(ts, fn) {
  if (!ts) return "—";
  try { return fn(parseTs(ts)); } catch { return "—"; }
}

function SettingsMemory({ hostId, connected = true }) {
  const [memories, setMemories] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState(null);
  const [busy, setBusy] = React.useState(null); // the key being forgotten, or null

  React.useEffect(() => {
    if (!hostId || !connected) { setLoading(false); return undefined; }
    let live = true;
    setLoading(true);
    setErr(null);
    assistant.host(hostId).memories().then(
      (rows) => { if (live) { setMemories(rows || []); setLoading(false); } },
      (e) => {
        if (!live) return;
        setErr((e && e.userMessage) || "Couldn't load what the assistant remembers.");
        setLoading(false);
      },
    );
    return () => { live = false; };
  }, [hostId, connected]);

  const forget = (key) => {
    setBusy(key);
    assistant.host(hostId).deleteMemory(key).then(
      () => { setMemories((prev) => prev.filter((m) => m.key !== key)); setBusy(null); },
      (e) => { setBusy(null); setErr((e && e.userMessage) || "Couldn't forget that."); },
    );
  };

  if (!hostId || !connected) {
    return (
      <SettingsSection icon="brain" title="Memory" meta="What the assistant has written down about you.">
        <SettingsRow icon="plug" title="No assistant connected"
          sub="Connect to a host's assistant to see what it remembers." />
      </SettingsSection>
    );
  }

  return (
    <SettingsSection icon="brain" title="Memory"
      meta="What the assistant has written down about you, across your conversations.">
      {err && (
        <div className="settings-notice settings-notice--danger">
          <Icon name="alert-triangle" size={13} /> {err}
        </div>
      )}
      {loading && <div className="settings-notice">Loading…</div>}
      {!loading && !err && memories.length === 0 && (
        <div className="settings-notice">The assistant hasn't written anything down yet.</div>
      )}
      {!loading && memories.map((m) => (
        <SettingsRow
          key={m.key}
          icon="brain"
          title={m.summary || m.key}
          sub={
            <>
              <span className="settings-value settings-value--mono">{m.key}</span>
              {" · Written " + fmtGuard(m.writtenAt, (d) => fmtRelative(d))
                + " (" + fmtGuard(m.writtenAt, fmtTime) + ")"}
            </>
          }
        >
          <button className="settings-btn-danger" onClick={() => forget(m.key)} disabled={busy != null}>
            {busy === m.key ? "Forgetting…" : "Forget"}
          </button>
        </SettingsRow>
      ))}
    </SettingsSection>
  );
}

export { SettingsMemory };
export default SettingsMemory;
