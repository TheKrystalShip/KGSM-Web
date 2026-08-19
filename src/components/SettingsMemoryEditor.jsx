import React from "react";
import { Icon } from "./Icon.jsx";
import { Modal } from "./Modal.jsx";

// SettingsMemoryEditor.jsx — reading one memory in full and correcting it, in a sheet over the
// settings page. Opened by SettingsMemory for an existing memory or for a new one; it renders on
// both settings surfaces, so it reaches nothing but Icon, Modal and the editor it lazy-loads.
//
// A memory is two fields for one reason: the SUMMARY is injected into every later turn and the BODY
// is not. So the summary gets a single line with a live count against the host's own cap, and the
// body gets an editor with room to think in. Showing them as one blob would hide the only difference
// between them that matters.
//
// ⚠ The KEY is the whole update mechanism — writing one again supersedes what stood there — so it is
// fixed once a memory exists. Renaming is a write plus a forget, which is two changes wearing one
// button, and the copy says so rather than the UI pretending otherwise.
//
// ⚠ `scrimClassName` is passed explicitly. Modal's default (`modal-scrim`) is styled in
// `kit/hosts.css`, which the standalone assistant's style barrel does not import — the default would
// render this as an unstyled block on that surface alone, and `npm run check:assistant` cannot see
// it: that check reads class names written literally in the markup, and a default prop is not one.

// Monaco is heavy (editor core + workers) — lazy so the chunk downloads when somebody actually opens
// a memory, never on the settings page itself. The same instance the file browser and the chat's
// blueprint card use, so theming follows the app for free.
const CodeEditor = React.lazy(() => import("./CodeEditor.jsx"));

// A memory body is prose, and no extension here maps to a language, so Monaco resolves it to
// plaintext. The path still matters: it gives this memory its own model, and with it its own undo
// history and scroll position.
const bodyPath = (key) => (key ? key : "new") + ".memory";

function SettingsMemoryEditor({ memory, limits, onSave, onClose }) {
  const isNew = !memory;
  const [key, setKey] = React.useState(memory ? memory.key : "");
  const [summary, setSummary] = React.useState(memory ? memory.summary || "" : "");
  const [body, setBody] = React.useState(memory ? memory.body || "" : "");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");

  const dirty = isNew
    ? key.trim() !== "" || summary.trim() !== "" || body.trim() !== ""
    : summary !== (memory.summary || "") || body !== (memory.body || "");

  // The caps come from the leaf. Absent — an older host that cannot answer for them — the counters
  // are simply not drawn: the write is still refused server-side with the number in the sentence,
  // which is a late but honest answer, where a guessed limit would be a wrong early one.
  const summaryOver = limits && summary.length > limits.maxSummaryLength;
  const bodyOver = limits && body.length > limits.maxBodyLength;
  const complete = key.trim() !== "" && summary.trim() !== "";
  const canSave = complete && dirty && !summaryOver && !bodyOver && !saving;

  function save() {
    if (!canSave) return;
    setSaving(true);
    setError("");
    Promise.resolve(onSave(key.trim(), { summary: summary.trim(), body: body.trim() }))
      .catch((e) => {
        // Inline, against what is still on the screen. A refusal here names a limit to correct, and
        // a toast would take the note away to say so.
        setError((e && e.userMessage) || "Couldn't save that.");
        setSaving(false);
      });
  }

  return (
    <Modal onClose={onClose} canClose={!saving} scrimClassName="fb-modal-scrim">
      <div className="fb-modal mem-modal" role="dialog" aria-label={isNew ? "Write a memory" : "Edit a memory"}>
        <div className="mem-editor">
          <div className="mem-editor__head">
            <span className="mem-editor__icon">
              <Icon name={isNew || memory.source === "you" ? "user-pen" : "brain"} size={15} />
            </span>
            <div className="mem-editor__titles">
              <span className="mem-editor__title">{isNew ? "Write a memory" : "Edit this memory"}</span>
              <span className="mem-editor__sub">
                {isNew
                  ? "The assistant reads the summary back at the start of every later conversation."
                  : memory.source === "you"
                    ? "You wrote this one."
                    : "The assistant wrote this one down during a conversation. Correcting it makes it yours."}
              </span>
            </div>
            <button type="button" className="mem-editor__close" onClick={onClose} disabled={saving}
              aria-label="Close">
              <Icon name="x" size={16} />
            </button>
          </div>

          <div className="mem-editor__fields">
            <label className="mem-editor__field">
              <span className="mem-editor__label">Name</span>
              {isNew ? (
                <>
                  <input className="settings-input settings-input--mono" value={key} autoFocus
                    placeholder="preferred-test-game" disabled={saving}
                    onChange={(e) => setKey(e.target.value)} />
                  <span className="mem-editor__hint">
                    What this memory is filed under, so it can be corrected or forgotten later. Letters
                    and numbers; spaces become dashes.
                  </span>
                </>
              ) : (
                <>
                  <span className="settings-value settings-value--mono mem-editor__key">{key}</span>
                  <span className="mem-editor__hint">
                    Fixed — writing this name again is what replaces the memory. To rename it, write a
                    new one and forget this.
                  </span>
                </>
              )}
            </label>

            <label className="mem-editor__field">
              <span className="mem-editor__label">
                Summary
                {limits && (
                  <span className={"mem-editor__count" + (summaryOver ? " mem-editor__count--over" : "")}>
                    {summary.length} / {limits.maxSummaryLength}
                  </span>
                )}
              </span>
              <input className="settings-input" value={summary} disabled={saving} autoFocus={!isNew}
                placeholder="States the fact itself — not that a note exists."
                onChange={(e) => setSummary(e.target.value)} />
              <span className="mem-editor__hint">
                This line goes into every later conversation, so keep it to the fact.
              </span>
            </label>
          </div>

          <div className="mem-editor__bodyhead">
            <span className="mem-editor__label">
              Notes
              {limits && (
                <span className={"mem-editor__count" + (bodyOver ? " mem-editor__count--over" : "")}>
                  {body.length} / {limits.maxBodyLength}
                </span>
              )}
            </span>
            <span className="mem-editor__hint">
              Read only when something asks for it, so it can hold the detail the summary leaves out.
            </span>
          </div>

          <div className="mem-editor__monaco fb-editor__monaco-wrap">
            <React.Suspense fallback={<div className="fb-editor__empty"><span className="oauth-spinner" /> Loading editor…</div>}>
              <CodeEditor value={body} onChange={setBody} path={bodyPath(memory ? memory.key : "")}
                readOnly={saving} wrap />
            </React.Suspense>
          </div>

          {error && (
            <div className="mem-editor__error">
              <Icon name="alert-triangle" size={13} /> {error}
            </div>
          )}

          <div className="fb-editor__foot">
            {dirty && <span className="fb-editor__dirty"><span className="dot" /> unsaved changes</span>}
            <span className="fb-editor__spacer" />
            <button type="button" className="fb-editor__btn fb-editor__btn--secondary" onClick={onClose}
              disabled={saving}>
              Cancel
            </button>
            <button type="button" className="fb-editor__btn" onClick={save} disabled={!canSave}>
              {saving
                ? <><span className="oauth-spinner" /> Saving…</>
                : <><Icon name="save" size={14} /> {isNew ? "Remember this" : "Save"}</>}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export { SettingsMemoryEditor };
export default SettingsMemoryEditor;
