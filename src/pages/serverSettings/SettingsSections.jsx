// ServerSettings section components — the three gated setting groups (Startup &
// recovery, Scheduled tasks, Resources), extracted from ServerSettings.jsx.
// The form state and the save/reset/delete handlers stay in the parent; each
// section receives its slice + setters.
//
// Scheduled tasks is the exception that holds state of its own: a window's next fire is the node's
// answer about a candidate expression, so the card asks for it and holds what came back. What it
// EDITS still belongs to the parent, and saves with everything else.

import React from "react";

import { Icon } from "../../components/Icon.jsx";
import { Select } from "../../components/Select.jsx";
import { SettingsRow, SettingsSection, Toggle } from "../../components/settings-primitives.jsx";
import { fmtUntil } from "../../lib/formatting.js";
import { previewMaintenanceWindow } from "../../lib/stores.js";
import {
  CADENCES, DOW, TASK_ORDER, UNITS,
  boundsOf, describeWindow, expressionOf, newWindowDraft, orderTasks,
} from "./maintenanceWindow.js";

function StartupSection({ watchdogDown, watchdogLed, autostart, setAutostart, crashRestart, setCrashRestart, crashMaxRestarts, setCrashMaxRestarts }) {
  return (
    <SettingsSection icon="power" title="Startup & recovery" action={watchdogDown ? watchdogLed : null}>
      {watchdogDown ? (
        <div style={{ padding: "10px 0 4px", color: "var(--fg-3)", fontSize: 12.5, textAlign: "center" }}>
          <Icon name="alert-circle" size={13} strokeWidth={1.8} style={{ verticalAlign: "middle", marginRight: 5 }} />
          Watchdog offline — autostart unavailable
        </div>
      ) : (
        <>
          <SettingsRow icon="power" title="Autostart on boot"
            sub="Automatically start this server when the host boots.">
            {autostart === null ? (
              <span style={{ fontSize: 12, color: "var(--fg-3)" }}>—</span>
            ) : (
              <Toggle on={!!autostart} onChange={setAutostart} />
            )}
          </SettingsRow>

          <SettingsRow icon="refresh-cw" title="Restart on crash"
            sub="Automatically restart if the server exits unexpectedly.">
            <Toggle on={crashRestart} onChange={setCrashRestart} />
          </SettingsRow>

          {crashRestart && (
            <SettingsRow icon="alert-triangle" title="Max consecutive restarts"
              sub="Give up and alert after this many crashes in a row without reaching stability.">
              <Select
                value={String(crashMaxRestarts)}
                options={[
                  { value: "1", label: "1" },
                  { value: "2", label: "2" },
                  { value: "3", label: "3" },
                  { value: "5", label: "5" },
                  { value: "10", label: "10" },
                ]}
                onChange={e => setCrashMaxRestarts(Number(e.target.value))}
              />
            </SettingsRow>
          )}
        </>
      )}
    </SettingsSection>
  );
}

// What a task does, in the words the chip carries.
const TASK_META = {
  backup: { label: "Back up", icon: "archive" },
  update: { label: "Update", icon: "download" },
  restart: { label: "Restart", icon: "refresh-cw" },
};

// Every disruptive task is issued through the watchdog, and the watchdog supervises native instances
// only — so a container carrying one would record a skipped task every week instead of running.
const CONTAINER_RULE =
  "The watchdog performs update and restart, and it supervises native instances only — "
  + "a container window can carry a backup alone.";

function ScheduleSection({
  schedulerDown, schedulerLed, hostId, serverId, isContainer,
  windows, setWindows, savedWindows, timezone, setTimezone,
  backupRetention, setBackupRetention,
}) {
  // A window is identified by its schedule, so what is saved is found by expression: an edited card
  // stops matching the moment its schedule moves, which is exactly when the node has to be asked
  // again rather than the leaf's own reading being reused.
  const saved = React.useMemo(() => {
    const map = new Map();
    for (const w of savedWindows || []) map.set(w.expression, w);
    return map;
  }, [savedWindows]);

  const patchWindow = (uid, changes) =>
    setWindows((list) => list.map((w) => (w.uid === uid ? { ...w, ...changes } : w)));
  const removeWindow = (uid) => setWindows((list) => list.filter((w) => w.uid !== uid));
  const addWindow = () => setWindows((list) => [...list, newWindowDraft()]);

  return (
    <SettingsSection icon="calendar-clock" title="Scheduled tasks" className="mw-card"
      count={schedulerDown ? null : windows.length} countTone="neutral"
      action={schedulerDown ? schedulerLed : null}>
      {schedulerDown ? (
        <div style={{ padding: "10px 0 4px", color: "var(--fg-3)", fontSize: 12.5, textAlign: "center" }}>
          <Icon name="alert-circle" size={13} strokeWidth={1.8} style={{ verticalAlign: "middle", marginRight: 5 }} />
          Scheduler leaf not deployed — scheduled maintenance unavailable
        </div>
      ) : (
        <>
          {isContainer && <div className="settings-notice">{CONTAINER_RULE}</div>}

          {windows.length === 0 && <div className="settings-notice">No maintenance windows.</div>}

          {windows.map((draft) => (
            <WindowRow key={draft.uid} draft={draft} hostId={hostId} serverId={serverId}
              timezone={timezone} isContainer={isContainer} saved={saved}
              onChange={patchWindow} onRemove={removeWindow} />
          ))}

          <div className="mw-add">
            <button type="button" className="lcf-btn lcf-btn--ghost" onClick={addWindow}>
              <Icon name="plus" size={14} /> Add window
            </button>
          </div>

          <SettingsRow icon="globe" title="Timezone"
            sub="IANA timezone appointments are read in (empty = host-local). Intervals ignore it.">
            <input
              type="text"
              className="settings-input"
              value={timezone ?? ""}
              placeholder="e.g. Europe/Madrid"
              onChange={e => setTimezone(e.target.value)}
            />
          </SettingsRow>

          <SettingsRow icon="layers" title="Keep backups"
            sub="How many recent backups to retain (older ones are pruned).">
            <input
              type="number"
              className="settings-input settings-input--num"
              min={1}
              max={100}
              value={backupRetention ?? 5}
              onChange={e => setBackupRetention(Number(e.target.value))}
            />
          </SettingsRow>
        </>
      )}
    </SettingsSection>
  );
}

// One window. The row says what it is and when it next fires; the fields under it are what a person
// changes. The next fire and the verdict are the node's — the leaf's where it has one, and the
// preview endpoint's otherwise, which runs the same clock the scheduler fires on.
function WindowRow({ draft, hostId, serverId, timezone, isContainer, saved, onChange, onRemove }) {
  const expression = expressionOf(draft);
  const savedRow = saved.get(expression) || null;
  // The leaf answers both questions for a window it has already read. Ask the node for the rest —
  // an unsaved window, an edited one, and one the daemon has not swept yet.
  const needPreview = !savedRow || (savedRow.valid && !savedRow.nextFireUtc);

  const [preview, setPreview] = React.useState(null);
  const [previewing, setPreviewing] = React.useState(false);
  const [previewError, setPreviewError] = React.useState(null);

  React.useEffect(() => {
    if (!needPreview || !hostId || !serverId) { setPreview(null); setPreviewError(null); return undefined; }
    let live = true;
    setPreviewing(true);
    // Typing a time or a day of the month walks through expressions nobody means; the pause is what
    // keeps one edit to one question.
    const t = setTimeout(() => {
      previewMaintenanceWindow(hostId, serverId, expression, timezone, 1).then(
        (res) => { if (live) { setPreview(res); setPreviewError(null); setPreviewing(false); } },
        (e) => { if (live) { setPreview(null); setPreviewError(messageOf(e)); setPreviewing(false); } });
    }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [needPreview, hostId, serverId, expression, timezone]);

  const valid = savedRow ? savedRow.valid : (preview ? preview.valid : true);
  const error = savedRow ? savedRow.error : (preview ? preview.error : null);
  const nextFire = savedRow?.nextFireUtc || preview?.fires?.[0] || null;

  const toggleTask = (task) => {
    const held = new Set(draft.tasks);
    if (held.has(task)) held.delete(task); else held.add(task);
    onChange(draft.uid, { tasks: orderTasks([...held]) });
  };

  return (
    <div className={"chat-brief__item chat-brief__item--static mw-row" + (valid ? "" : " chat-brief__item--danger")}>
      <span className="chat-brief__icon">
        <Icon name={draft.kind === "interval" ? "timer" : "calendar-clock"} size={14} />
      </span>
      <div className="chat-brief__body">
        <span className="chat-brief__item-title">
          <span className="chat-brief__titletext">{describeWindow(draft)}</span>
          {!valid && <span className="thr-tag">invalid</span>}
        </span>
        <span className="chat-brief__detail" style={{ whiteSpace: "normal" }}>
          {detailOf({ valid, error, nextFire, previewing, previewError })}
        </span>

        <div className="mw-fields">
          {draft.raw != null ? (
            <label className="thr-field mw-field--raw">
              <span className="thr-field__label">Expression</span>
              <input className="settings-input settings-input--mono" value={draft.raw}
                onChange={(e) => onChange(draft.uid, { raw: e.target.value })} />
            </label>
          ) : (
            <>
              <label className="thr-field mw-field--kind">
                <span className="thr-field__label">When</span>
                <Select value={draft.kind}
                  options={[
                    { value: "appointment", label: "At a time of day" },
                    { value: "interval", label: "Every so often" },
                  ]}
                  onChange={(e) => onChange(draft.uid, { kind: e.target.value })} />
              </label>

              {draft.kind === "appointment" ? (
                <>
                  <label className="thr-field mw-field--cadence">
                    <span className="thr-field__label">Repeats</span>
                    <Select value={draft.cadence} options={CADENCES}
                      onChange={(e) => onChange(draft.uid, { cadence: e.target.value })} />
                  </label>

                  {draft.cadence === "weekly" && (
                    <label className="thr-field mw-field--day">
                      <span className="thr-field__label">On</span>
                      <Select value={draft.dow} options={DOW}
                        onChange={(e) => onChange(draft.uid, { dow: e.target.value })} />
                    </label>
                  )}

                  {draft.cadence === "monthly" && (
                    <label className="thr-field mw-field--num">
                      <span className="thr-field__label">Day</span>
                      <span className="thr-field__input">
                        <input type="number" min={1} max={31} value={draft.dom}
                          onChange={(e) => onChange(draft.uid, { dom: Number(e.target.value) })} />
                      </span>
                    </label>
                  )}

                  <label className="thr-field mw-field--time">
                    <span className="thr-field__label">At</span>
                    <input type="time" className="settings-input settings-input--time" value={draft.time}
                      onChange={(e) => onChange(draft.uid, { time: e.target.value })} />
                  </label>
                </>
              ) : (
                <>
                  <label className="thr-field mw-field--num">
                    <span className="thr-field__label">Every</span>
                    <span className="thr-field__input">
                      <input type="number" min={boundsOf(draft.unit).min} max={boundsOf(draft.unit).max}
                        value={draft.every}
                        onChange={(e) => onChange(draft.uid, { every: Number(e.target.value) })} />
                    </span>
                  </label>

                  <label className="thr-field mw-field--cadence">
                    <span className="thr-field__label">Unit</span>
                    <Select value={draft.unit} options={UNITS}
                      onChange={(e) => onChange(draft.uid, { unit: e.target.value })} />
                  </label>
                </>
              )}
            </>
          )}

          <div className="thr-field mw-field--tasks">
            <span className="thr-field__label">Tasks</span>
            <div className="mw-tasks">
              {TASK_ORDER.map((task) => {
                const refused = isContainer && task !== "backup";
                const on = draft.tasks.includes(task);
                return (
                  <button key={task} type="button" disabled={refused} aria-pressed={on}
                    title={refused ? CONTAINER_RULE : ""}
                    className={"lcf-btn lcf-btn--ghost" + (on ? " is-on" : "")}
                    onClick={() => toggleTask(task)}>
                    <Icon name={TASK_META[task].icon} size={13} /> {TASK_META[task].label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      <div className="settings-row__controls">
        <button type="button" className="lcf-iconbtn" aria-label="Remove this window"
          title="Remove this window" onClick={() => onRemove(draft.uid)}>
          <Icon name="trash-2" size={14} />
        </button>
      </div>
    </div>
  );
}

// The line under a window's name: what stops it firing, or when it fires next. Never both, and never
// a time this browser worked out for itself.
function detailOf({ valid, error, nextFire, previewing, previewError }) {
  if (!valid) return error || "This window will not fire.";
  if (previewError) return previewError;
  if (nextFire) {
    const when = new Date(nextFire);
    const until = fmtUntil(when);
    return "Next " + when.toLocaleString() + (until ? " · " + until : "");
  }
  if (previewing) return "Reading the next fire…";
  return "No next fire reported.";
}

function messageOf(e) {
  const m = e && (e.message || (e.body && e.body.error && e.body.error.message));
  return m || "Couldn’t read this window’s next fire.";
}

function ResourcesSection({ watchdogDown, watchdogLed, cpuPriority, setCpuPriority, memoryCapMb, setMemoryCapMb }) {
  return (
    <SettingsSection icon="cpu" title="Resources" action={watchdogDown ? watchdogLed : null}>
      {watchdogDown ? (
        <div style={{ padding: "10px 0 4px", color: "var(--fg-3)", fontSize: 12.5, textAlign: "center" }}>
          <Icon name="alert-circle" size={13} strokeWidth={1.8} style={{ verticalAlign: "middle", marginRight: 5 }} />
          Watchdog offline — resource caps unavailable
        </div>
      ) : (
        <>
          <SettingsRow icon="cpu" title="CPU priority"
            sub="Scheduling weight for this server's cgroup (low=50, normal=100, high=400).">
            <Select
              value={cpuPriority ?? "normal"}
              options={[
                { value: "low",    label: "Low" },
                { value: "normal", label: "Normal" },
                { value: "high",   label: "High" },
              ]}
              onChange={e => setCpuPriority(e.target.value)}
            />
          </SettingsRow>
          <SettingsRow icon="database" title="Memory cap"
            sub="Maximum RAM for this server (0 = uncapped). Takes effect at next restart.">
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="number"
                className="settings-input settings-input--num"
                min={0}
                step={256}
                value={memoryCapMb ?? 0}
                onChange={e => setMemoryCapMb(Number(e.target.value))}
              />
              <span style={{ fontSize: 12, color: "var(--fg-3)" }}>MiB</span>
            </div>
          </SettingsRow>
        </>
      )}
    </SettingsSection>
  );
}

export { StartupSection, ScheduleSection, ResourcesSection };
