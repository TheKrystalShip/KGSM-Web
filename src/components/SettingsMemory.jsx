import React from "react";
import { Icon } from "./Icon.jsx";
import { SettingsRow, SettingsSection } from "./settings-primitives.jsx";
import { SettingsMemoryEditor } from "./SettingsMemoryEditor.jsx";
import { assistant } from "../lib/assistantClient.js";
import { fmtRelative, fmtTime, parseTs } from "../lib/formatting.js";

// SettingsMemory.jsx — what the assistant has written down about you, on the leaf you're currently
// talking to, and the one place to correct it. Shared by both settings surfaces (the Control Panel's
// account page and the standalone assistant's own settings) so a change to how a memory reads lands
// on both — it depends on nothing but `assistantClient`, `settings-primitives`, `formatting` and the
// editor beside it, so it stays safe for the standalone surface (`npm run check:assistant`).
//
// The leaf, not this card, decides what "yours" means: `assistantClient.js` reaches it directly, the
// same seam a chat turn does, so this can only ever list, write or forget the caller's OWN memory.
//
// `hostId` is the leaf currently being talked to — a real host id in the panel, the fixed `"self"`
// key the standalone surface always uses. `connected` says whether that leaf is reachable right now,
// so the card can say why nothing loaded rather than just showing an empty list.
//
// ⚠ **A memory belongs to one leaf, and the panel drives a cluster.** The defaults below describe the
// standalone surface, which has exactly one assistant and never has to say which — everything that
// makes this card cluster-aware is a prop the panel passes:
//
//   `hostName`   — whose assistant this is, named in the card so a reader is never left inferring it
//                  from whatever the chat dock happens to be pointed at.
//   `candidates` — how many hosts in the cluster run an assistant at all. It exists only to keep
//                  three different facts from wearing one label: nobody runs one, several do and
//                  none is picked, and one is picked but unreachable. The middle case is the trap —
//                  the dock deliberately leaves the target unset when several could answer, so a
//                  cluster full of healthy assistants would otherwise read as having none.
//   `onPickHost` — opens the surface that owns the choice (the chat, where the picker lives). The
//                  choice is not duplicated here: two places to set one target is how they come to
//                  disagree.

function fmtGuard(ts, fn) {
  if (!ts) return "—";
  try { return fn(parseTs(ts)); } catch { return "—"; }
}

// Most recently written first, which is the order the leaf lists them in. A memory just written IS
// the most recent, so replacing-then-prepending reproduces that order exactly and saves a re-read
// whose failure would read as a failed save.
function withWritten(rows, written) {
  return [written, ...rows.filter((m) => m.key !== written.key)];
}

function SettingsMemory({ hostId, connected = true, hostName = null, candidates = 0, onPickHost = null }) {
  const [memories, setMemories] = React.useState([]);
  const [limits, setLimits] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState(null);
  const [busy, setBusy] = React.useState(null);   // the key being forgotten, or null
  const [editing, setEditing] = React.useState(null); // null | { memory } — a null memory is a new one

  React.useEffect(() => {
    if (!hostId || !connected) { setLoading(false); return undefined; }
    let live = true;
    setLoading(true);
    setErr(null);
    // The limits describe the host and the list describes you; neither waits on the other. A host too
    // old to answer for its limits still lists and forgets — the editor is what needs them.
    Promise.all([
      assistant.host(hostId).memories(),
      assistant.host(hostId).memoryLimits().catch(() => null),
    ]).then(
      ([rows, caps]) => { if (live) { setMemories(rows || []); setLimits(caps); setLoading(false); } },
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
    setErr(null);
    assistant.host(hostId).deleteMemory(key).then(
      () => { setMemories((prev) => prev.filter((m) => m.key !== key)); setBusy(null); },
      (e) => { setBusy(null); setErr((e && e.userMessage) || "Couldn't forget that."); },
    );
  };

  // Resolves to nothing on success and REJECTS with the leaf's own sentence otherwise, because the
  // editor keeps what was typed on the screen and renders the refusal against it — a cap or a length
  // is something to correct in place, not a reason to lose the note.
  const save = (key, memory) =>
    assistant.host(hostId).writeMemory(key, memory).then((written) => {
      setMemories((prev) => withWritten(prev, written));
      setEditing(null);
    });

  // Nothing to read, and three different reasons why. They are told apart rather than collapsed
  // because what to do about each is different, and because a cluster whose assistants are all
  // healthy must never be reported as having none.
  if (!hostId || !connected) {
    const several = !hostId && candidates > 1;
    const none = !hostId && !several;
    return (
      <SettingsSection icon="brain" title="Memory"
        meta="What the assistant has written down about you.">
        {several && (
          <SettingsRow icon="network" title="Several hosts run an assistant"
            sub="A memory belongs to the one you're talking to, so pick that host in the chat and what it remembers shows here.">
            {onPickHost && (
              <button type="button" className="settings-btn-ghost" onClick={onPickHost}>
                <Icon name="message-square" size={13} /> Open the chat
              </button>
            )}
          </SettingsRow>
        )}
        {none && (
          <SettingsRow icon="plug" title="No assistant on this cluster"
            sub="No host here runs one, so nothing has been written down about you." />
        )}
        {/* Targeted but out of reach. ⚠ Not "nothing is remembered" — that is a claim about the
            memory, and the only honest thing available is that it cannot be read right now. */}
        {hostId && !connected && (
          <SettingsRow icon="server-off" tone="warn"
            title={(hostName ? hostName + "'s" : "This host's") + " assistant can't be reached"}
            sub="What it remembers can't be read until it's back. Nothing has been lost — this is a connection, not a memory." />
        )}
      </SettingsSection>
    );
  }

  const full = limits && memories.length >= limits.maxPerOwner;
  // Named, on a surface that drives more than one leaf: a memory belongs to ONE assistant, and which
  // one is what the chat dock's target happens to be. Left unsaid, changing that target silently
  // changes what this card is about.
  const whose = hostName ? `What the assistant on ${hostName} has` : "What the assistant has";
  const meta = limits
    ? `${whose} written down about you, across your conversations. `
      + `${memories.length} of ${limits.maxPerOwner} kept.`
    : `${whose} written down about you, across your conversations.`;

  return (
    <>
      <SettingsSection icon="brain" title="Memory" meta={meta}
        action={(
          <button type="button" className="settings-btn-ghost" disabled={loading || !!err || full}
            title={full ? "You're at the limit — forget one first." : undefined}
            onClick={() => setEditing({ memory: null })}>
            <Icon name="plus" size={13} /> Write one
          </button>
        )}>
        {err && (
          <div className="settings-notice settings-notice--danger">
            <Icon name="alert-triangle" size={13} /> {err}
          </div>
        )}
        {loading && <div className="settings-notice">Loading…</div>}
        {!loading && !err && memories.length === 0 && (
          <div className="settings-notice">
            The assistant hasn't written anything down yet. It writes things down as they come up in a
            conversation, and you can write one yourself.
          </div>
        )}
        {!loading && memories.map((m) => (
          <SettingsRow
            key={m.key}
            icon={m.source === "you" ? "user-pen" : "brain"}
            title={m.summary || m.key}
            sub={(
              <>
                <span className="settings-value settings-value--mono">{m.key}</span>
                {" · " + (m.source === "you" ? "Written by you" : "Learned in a conversation")}
                {" " + fmtGuard(m.writtenAt, (d) => fmtRelative(d))
                  + " (" + fmtGuard(m.writtenAt, fmtTime) + ")"}
                {m.body ? " · has a longer note" : ""}
              </>
            )}
          >
            <button className="settings-btn-ghost" onClick={() => setEditing({ memory: m })}
              disabled={busy != null}>
              <Icon name="pencil" size={13} /> Edit
            </button>
            <button className="settings-btn-danger" onClick={() => forget(m.key)} disabled={busy != null}>
              {busy === m.key ? "Forgetting…" : "Forget"}
            </button>
          </SettingsRow>
        ))}
      </SettingsSection>

      {editing && (
        <SettingsMemoryEditor
          memory={editing.memory}
          limits={limits}
          onSave={save}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

export { SettingsMemory };
export default SettingsMemory;
