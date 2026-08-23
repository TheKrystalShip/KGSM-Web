import React from "react";
import { Icon } from "../components/Icon.jsx";
import { SettingsRow, SettingsSection, Toggle } from "../components/settings-primitives.jsx";
import { serverCapUsable } from "../lib/capabilities.js";
import { fetchSettings, patchSettings, deleteServer } from "../lib/stores.js";
import { StartupSection, ScheduleSection, ResourcesSection } from "./serverSettings/SettingsSections.jsx";
import { PlacementSection } from "./serverSettings/PlacementSection.jsx";

// Settings panel — for things that don't belong in raw config files.
// Autostart, scheduled restarts, crash recovery, update policy, resource caps,
// player notifications.

function ServerSettings({ server, onDeleted }) {
  // watchdog capability check (unchanged — used by the watchdog-gated sections)
  const watchdogDown = !serverCapUsable(server, "watchdog");
  // scheduler capability — the kgsm-scheduler leaf may not be deployed on this host.
  const schedulerDown = !serverCapUsable(server, "scheduler");

  // ---- API-loaded settings state ----
  const [loadState, setLoadState] = React.useState("loading"); // "loading" | "ready" | "error"
  const [loadError, setLoadError] = React.useState(null);

  // ---- Form state (only Phase 0 live fields) ----
  const [autoUpdate, setAutoUpdate] = React.useState(null); // null = not loaded yet
  const [autostart, setAutostart] = React.useState(null); // null = not loaded or watchdog absent
  const [crashRestart, setCrashRestart] = React.useState(true);
  const [crashMaxRestarts, setCrashMaxRestarts] = React.useState(5);
  const [cpuPriority, setCpuPriority] = React.useState(null); // null = not loaded
  const [memoryCapMb, setMemoryCapMb] = React.useState(null); // null = not loaded (0 = uncapped is valid)
  const [scheduledRestart, setScheduledRestart] = React.useState(null); // null = not loaded
  const [restartTime, setRestartTime] = React.useState(null); // "HH:MM"
  const [restartDay, setRestartDay] = React.useState(null); // sun..sat
  const [timezone, setTimezone] = React.useState(null); // IANA string, "" = host-local
  const [nextFireUtc, setNextFireUtc] = React.useState(null); // read-only; null = scheduler absent/unknown
  const [backupSchedule, setBackupSchedule] = React.useState(null); // null = not loaded
  const [backupTime, setBackupTime] = React.useState(null); // "HH:MM"
  const [backupDay, setBackupDay] = React.useState(null); // sun..sat
  const [nextBackupUtc, setNextBackupUtc] = React.useState(null); // read-only; null = scheduler absent/unknown
  const [backupRetention, setBackupRetention] = React.useState(5);
  const [lastBackupUtc, setLastBackupUtc] = React.useState(null); // read-only; from scheduler status
  const [lastBackupOk, setLastBackupOk] = React.useState(null); // read-only; null = unknown

  // ---- Save / Reset state ----
  const [saving, setSaving] = React.useState(false);
  const [saveMsg, setSaveMsg] = React.useState(null); // { ok, text }

  // ---- Delete state ----
  const [deletePhase, setDeletePhase] = React.useState("idle"); // "idle" | "confirm" | "deleting"
  const [deleteError, setDeleteError] = React.useState(null);

  // Load on mount
  React.useEffect(() => {
    if (!server || !server.id) return;
    setLoadState("loading");
    fetchSettings(server.hostId, server.id).then(
      (data) => {
        setAutoUpdate(!!data.autoUpdate);
        setAutostart(data.autostart != null ? !!data.autostart : null);
        setCrashRestart(data.crashRestart ?? true);
        setCrashMaxRestarts(data.crashMaxRestarts ?? 5);
        setCpuPriority(data.cpuPriority ?? null);
        setMemoryCapMb(data.memoryCapMb ?? null);
        setScheduledRestart(data.scheduledRestart ?? "off");
        setRestartTime(data.restartTime ?? "04:00");
        setRestartDay(data.restartDay ?? "sun");
        setTimezone(data.timezone ?? "");
        setNextFireUtc(data.nextFireUtc ?? null);
        setBackupSchedule(data.backupSchedule ?? "off");
        setBackupTime(data.backupTime ?? "05:00");
        setBackupDay(data.backupDay ?? "sun");
        setNextBackupUtc(data.nextBackupUtc ?? null);
        setBackupRetention(data.backupRetention ?? 5);
        setLastBackupUtc(data.lastBackupUtc ?? null);
        setLastBackupOk(data.lastBackupOk ?? null);
        setLoadState("ready");
      },
      (err) => {
        setLoadError(err && err.message ? err.message : "Failed to load settings");
        setLoadState("error");
      }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only server.id/hostId are used (and in deps); the full object churns each render
  }, [server && server.id, server && server.hostId]);

  const handleSave = () => {
    if (saving) return;
    setSaving(true);
    setSaveMsg(null);
    patchSettings(server.hostId, server.id, {
      autoUpdate, autostart, crashRestart, crashMaxRestarts, cpuPriority, memoryCapMb,
      scheduledRestart, restartTime, restartDay, timezone,
      backupSchedule, backupTime, backupDay, backupRetention: Number(backupRetention),
      origin: "ui",
    }).then(
      (data) => {
        if (data && data.settings) {
          if (data.settings.autostart != null) setAutostart(!!data.settings.autostart);
          if (data.settings.crashRestart !== undefined) setCrashRestart(data.settings.crashRestart ?? true);
          if (data.settings.crashMaxRestarts !== undefined) setCrashMaxRestarts(data.settings.crashMaxRestarts ?? 5);
          if (data.settings.cpuPriority !== undefined) setCpuPriority(data.settings.cpuPriority);
          if (data.settings.memoryCapMb !== undefined) setMemoryCapMb(data.settings.memoryCapMb);
          if (data.settings.scheduledRestart !== undefined) setScheduledRestart(data.settings.scheduledRestart ?? "off");
          if (data.settings.restartTime !== undefined) setRestartTime(data.settings.restartTime ?? "04:00");
          if (data.settings.restartDay !== undefined) setRestartDay(data.settings.restartDay ?? "sun");
          if (data.settings.timezone !== undefined) setTimezone(data.settings.timezone ?? "");
          if (data.settings.nextFireUtc !== undefined) setNextFireUtc(data.settings.nextFireUtc ?? null);
          if (data.settings.backupSchedule !== undefined) setBackupSchedule(data.settings.backupSchedule ?? "off");
          if (data.settings.backupTime !== undefined) setBackupTime(data.settings.backupTime ?? "05:00");
          if (data.settings.backupDay !== undefined) setBackupDay(data.settings.backupDay ?? "sun");
          if (data.settings.nextBackupUtc !== undefined) setNextBackupUtc(data.settings.nextBackupUtc ?? null);
          if (data.settings.backupRetention !== undefined) setBackupRetention(data.settings.backupRetention ?? 5);
          if (data.settings.lastBackupUtc !== undefined) setLastBackupUtc(data.settings.lastBackupUtc ?? null);
          if (data.settings.lastBackupOk !== undefined) setLastBackupOk(data.settings.lastBackupOk ?? null);
        }
        setSaving(false);
        setSaveMsg({ ok: true, text: "Saved" });
        setTimeout(() => setSaveMsg(null), 3000);
      },
      (err) => {
        setSaving(false);
        setSaveMsg({ ok: false, text: (err && err.message) ? err.message : "Save failed" });
      }
    );
  };

  const handleReset = () => {
    if (saving) return;
    setSaving(true);
    setSaveMsg(null);
    // Reset: clear auto_update override by sending null
    patchSettings(server.hostId, server.id, {
      autoUpdate: null, autostart: null, crashRestart: null, crashMaxRestarts: null, cpuPriority: null, memoryCapMb: null,
      scheduledRestart: null, restartTime: null, restartDay: null, timezone: null,
      backupSchedule: null, backupTime: null, backupDay: null, backupRetention: null,
      origin: "ui",
    }).then(
      (data) => {
        if (data && data.settings) {
          setAutoUpdate(!!data.settings.autoUpdate);
          if (data.settings.autostart != null) setAutostart(!!data.settings.autostart);
          if (data.settings.crashRestart !== undefined) setCrashRestart(data.settings.crashRestart ?? true);
          if (data.settings.crashMaxRestarts !== undefined) setCrashMaxRestarts(data.settings.crashMaxRestarts ?? 5);
          if (data.settings.cpuPriority !== undefined) setCpuPriority(data.settings.cpuPriority ?? null);
          if (data.settings.memoryCapMb !== undefined) setMemoryCapMb(data.settings.memoryCapMb ?? null);
          if (data.settings.scheduledRestart !== undefined) setScheduledRestart(data.settings.scheduledRestart ?? "off");
          if (data.settings.restartTime !== undefined) setRestartTime(data.settings.restartTime ?? "04:00");
          if (data.settings.restartDay !== undefined) setRestartDay(data.settings.restartDay ?? "sun");
          if (data.settings.timezone !== undefined) setTimezone(data.settings.timezone ?? "");
          if (data.settings.nextFireUtc !== undefined) setNextFireUtc(data.settings.nextFireUtc ?? null);
          if (data.settings.backupSchedule !== undefined) setBackupSchedule(data.settings.backupSchedule ?? "off");
          if (data.settings.backupTime !== undefined) setBackupTime(data.settings.backupTime ?? "05:00");
          if (data.settings.backupDay !== undefined) setBackupDay(data.settings.backupDay ?? "sun");
          if (data.settings.nextBackupUtc !== undefined) setNextBackupUtc(data.settings.nextBackupUtc ?? null);
          if (data.settings.backupRetention !== undefined) setBackupRetention(data.settings.backupRetention ?? 5);
          if (data.settings.lastBackupUtc !== undefined) setLastBackupUtc(data.settings.lastBackupUtc ?? null);
          if (data.settings.lastBackupOk !== undefined) setLastBackupOk(data.settings.lastBackupOk ?? null);
        }
        setSaving(false);
        setSaveMsg({ ok: true, text: "Reset to defaults" });
        setTimeout(() => setSaveMsg(null), 3000);
      },
      () => {
        setSaving(false);
        setSaveMsg({ ok: false, text: "Reset failed" });
      }
    );
  };

  const handleDelete = () => {
    if (deletePhase === "idle") { setDeletePhase("confirm"); return; }
    if (deletePhase !== "confirm") return;
    setDeletePhase("deleting");
    setDeleteError(null);
    deleteServer(server.hostId, server.id, "ui").then(
      () => {
        // 202 accepted — the server is being removed. Navigate away.
        if (onDeleted) onDeleted();
      },
      (err) => {
        setDeletePhase("idle");
        setDeleteError((err && err.message) ? err.message : "Delete failed");
      }
    );
  };

  // Show full-tab loading / error states
  if (loadState === "loading") {
    return (
      <div style={{ textAlign: "center", padding: "40px 0", color: "var(--fg-3)" }}>
        <Icon name="loader" size={22} strokeWidth={1.6} />
        <div style={{ marginTop: 10, fontSize: 13 }}>Loading settings…</div>
      </div>
    );
  }
  if (loadState === "error") {
    return (
      <div style={{ textAlign: "center", padding: "40px 0", color: "var(--fg-3)" }}>
        <Icon name="alert-circle" size={22} strokeWidth={1.6} />
        <div style={{ marginTop: 10, fontSize: 13, color: "var(--fg-2)" }}>{loadError || "Failed to load settings"}</div>
      </div>
    );
  }

  // Per-card watchdog indicator (replaces the page banner): "Watchdog down ●".
  const watchdogLed = (
    <span className="led-group">
      <span className="led-group__age">Watchdog down</span>
      <span className="status-led status-led--down"></span>
    </span>
  );
  const schedulerLed = (
    <span className="led-group">
      <span className="led-group__age">Scheduler down</span>
      <span className="status-led status-led--down"></span>
    </span>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* Startup & recovery — Phase 1 */}
      <StartupSection watchdogDown={watchdogDown} watchdogLed={watchdogLed}
        autostart={autostart} setAutostart={setAutostart}
        crashRestart={crashRestart} setCrashRestart={setCrashRestart}
        crashMaxRestarts={crashMaxRestarts} setCrashMaxRestarts={setCrashMaxRestarts} />

      {/* Scheduled tasks — Phase 3 (scheduler-leaf gated) */}
      <ScheduleSection schedulerDown={schedulerDown} schedulerLed={schedulerLed}
        scheduledRestart={scheduledRestart} setScheduledRestart={setScheduledRestart}
        restartTime={restartTime} setRestartTime={setRestartTime}
        restartDay={restartDay} setRestartDay={setRestartDay}
        timezone={timezone} setTimezone={setTimezone}
        backupSchedule={backupSchedule} setBackupSchedule={setBackupSchedule}
        backupTime={backupTime} setBackupTime={setBackupTime}
        backupDay={backupDay} setBackupDay={setBackupDay}
        nextBackupUtc={nextBackupUtc}
        backupRetention={backupRetention} setBackupRetention={setBackupRetention}
        lastBackupUtc={lastBackupUtc} lastBackupOk={lastBackupOk} nextFireUtc={nextFireUtc} />

      {/* Updates — LIVE in Phase 0 */}
      <SettingsSection icon="download" title="Updates">
        <SettingsRow icon="download" title="Auto-update"
          sub="Apply the latest version on next restart (when available).">
          <Toggle on={!!autoUpdate} onChange={setAutoUpdate} />
        </SettingsRow>
      </SettingsSection>

      {/* Resources — LIVE in Phase 2 */}
      <ResourcesSection watchdogDown={watchdogDown} watchdogLed={watchdogLed}
        cpuPriority={cpuPriority} setCpuPriority={setCpuPriority}
        memoryCapMb={memoryCapMb} setMemoryCapMb={setMemoryCapMb} />

      {/* Which disk it is on. Reads and writes on its own — a move starts the moment it is confirmed,
          so it belongs to neither the form's dirty state nor its Save button. */}
      <PlacementSection server={server} />

      {/* Button row */}
      <div style={{ display: "flex", gap: 10, padding: "8px 0", alignItems: "center", flexWrap: "wrap" }}>
        {deletePhase === "idle" && (
          <button className="icon-btn icon-btn--danger"
            style={{ width: "auto", padding: "0 14px", fontSize: 13, fontWeight: 600 }}
            onClick={handleDelete}>
            <Icon name="trash-2" size={14} />&nbsp;Delete server
          </button>
        )}
        {deletePhase === "confirm" && (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 13, color: "var(--fg-2)" }}>Permanently delete? This cannot be undone.</span>
            <button className="icon-btn icon-btn--danger"
              style={{ width: "auto", padding: "0 12px", fontSize: 13 }}
              onClick={handleDelete}>Confirm delete</button>
            <button className="icon-btn"
              style={{ width: "auto", padding: "0 12px", fontSize: 13 }}
              onClick={() => setDeletePhase("idle")}>Cancel</button>
          </div>
        )}
        {deletePhase === "deleting" && (
          <span style={{ fontSize: 13, color: "var(--fg-3)" }}>Deleting…</span>
        )}
        {deleteError && (
          <span style={{ fontSize: 12.5, color: "var(--danger, #e55)" }}>{deleteError}</span>
        )}
        <span style={{ flex: 1 }}></span>
        {saveMsg && (
          <span style={{ fontSize: 12.5, color: saveMsg.ok ? "var(--krystal-teal)" : "var(--danger, #e55)", marginRight: 4 }}>
            {saveMsg.text}
          </span>
        )}
        <button className="icon-btn" disabled={saving}
          style={{ width: "auto", padding: "0 14px", fontSize: 13, fontWeight: 600 }}
          onClick={handleReset}>Reset to defaults</button>
        <button className="fb-editor__btn" disabled={saving} onClick={handleSave}>
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}

export { ServerSettings };
