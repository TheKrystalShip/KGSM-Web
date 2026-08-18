import React from "react";
import { BriefCard } from "../components/BriefCard.jsx";
import { Icon } from "../components/Icon.jsx";
import { api } from "../lib/apiClient.js";
import { apiOriginOf } from "../lib/config.js";
import { awaitJob } from "../lib/stores.js";
import { formatBytes, fmtRelative } from "../lib/formatting.js";
import { useConfirmAction } from "../components/ServerActions.jsx";

// Backups list — one row per snapshot. Rendered through the shared BriefCard
// shell; each entry uses the same .chat-brief__item row style as the dashboard's
// Alerts / Recent activity cards. The whole tab is operator-gated upstream
// (App.ServerDetailPage hides it for viewers), so the create/restore actions are
// safe to show here without a second gate.
//
// The backend (GET /servers/{id}/backups) reports each backup's id as `name`
// plus whatever its manifest recorded — size, creation time, captured version.
// Any of those may be absent (a backup the engine lists but has no manifest
// for), and an absent field is simply not rendered: never a fabricated size or
// age, never a "0 B" standing in for unknown.
//
// A backup also records WHY it was taken and WHETHER retention may delete it.
// The two are separate on the wire and stay separate here: the reason rides the
// subtitle (including when it is unknown), and pinned is a badge on the row plus
// the pin/unpin toggle beside Restore. Pinning is not a delete guard — the trash
// still removes a pinned backup — so the toggle is a plain button with no arming.
//
// Delete is arm-then-fire (the shared useConfirmAction, as the lifecycle buttons
// use): the trash swaps to a check for a few seconds and only the second click
// sends. There is no undo behind it — the snapshot is gone from the host — and
// this is an icon in a dense row next to Restore, so a single misclick must not
// be enough.
//
// Download is a two-step: POST a download-ticket, then send the browser to the
// URL it returns. It cannot be a fetch — the archive is unbounded (several GB
// for an instance whose install is captured), and fetch→blob buffers the whole
// thing in memory before the save dialog appears. The ticket exists precisely so
// a plain navigation, which can carry no Authorization header, still
// authenticates; the browser then streams to disk with its own progress and
// resume. Only a COMPRESSED backup can be downloaded: an uncompressed one is a
// directory tree, not one file, and the backend refuses it — so the button is
// disabled with that reason rather than offering a click that always fails.
// How a backup's `reason` reads. The engine's vocabulary is five words; anything
// else is passed through as-is rather than dropped, so a value added to the
// engine shows up here instead of vanishing.
const REASON_LABELS = {
  manual: "manual",
  scheduled: "scheduled",
  "pre-update": "before an update",
  "pre-restore": "before a restore",
  incident: "incident",
};

// The one-line subtitle under a backup's id: age · size · version · why, built
// only from the fields the manifest actually carried. A backup with no manifest
// contributes nothing here and renders as its id alone.
//
// The reason is the one field rendered when it is ABSENT too. Null means the
// manifest records none — a backup taken before the engine wrote one, which
// cannot be identified after the fact — and "reason unknown" is that, stated.
// Leaving it blank would read as an ordinary backup, which is the confusion the
// field exists to remove: a snapshot of a broken server and a routine one are
// not interchangeable. It is only claimed for a backup we have a manifest for;
// one listed with no manifest at all says nothing about anything.
function metaFor(b) {
  const parts = [];
  if (b.createdAt) {
    const d = new Date(b.createdAt);
    if (!Number.isNaN(d.getTime())) parts.push(fmtRelative(d));
  }
  if (b.sizeBytes != null) parts.push(formatBytes(b.sizeBytes));
  if (b.version) parts.push("v" + b.version);
  if (b.reason) parts.push(REASON_LABELS[b.reason] || b.reason);
  else if (b.createdAt) parts.push("reason unknown");
  return parts.join(" · ");
}

// Its own component because the arm/fire state is a hook, and a hook cannot live inside the row map.
// Armed, it shows a check and says so — the icon changing is the only thing telling a user their first
// click did something other than nothing.
function DeleteBackupButton({ name, busy, deleting, onDelete }) {
  const { armed, trigger } = useConfirmAction(() => onDelete(name));
  return (
    <button
      className={"icon-btn icon-btn--danger" + (armed ? " is-armed" : "")}
      title={armed ? "Click again to delete — this cannot be undone" : "Delete"}
      aria-label={armed ? "Confirm delete" : "Delete"}
      onClick={trigger}
      disabled={!!busy}
    >
      {deleting ? <span className="oauth-spinner" />
        : <Icon name={armed ? "check" : "trash-2"} size={14} strokeWidth={armed ? 2.6 : 2} />}
    </button>
  );
}

function BackupsList({ server }) {
  const [list, setList] = React.useState(null);   // null = loading, [] = none
  const [error, setError] = React.useState(null);
  const [busy, setBusy] = React.useState(null);   // "create" | "restore:<name>" | "download:<name>" | "delete:<name>" | null

  const load = React.useCallback(() => {
    if (!server || !server.hostId) return Promise.resolve();
    setError(null);
    return api.host(server.hostId).get("/servers/" + server.id + "/backups").then(
      (res) => setList(Array.isArray(res && res.backups) ? res.backups : []),
      (err) => { setList([]); setError(err && (err.userMessage || err.message) || "Could not load backups."); }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only server.id/hostId are used (and in deps); the full object churns each render
  }, [server && server.id, server && server.hostId]);

  React.useEffect(() => { setList(null); load(); }, [load]);

  // Create / restore are async jobs (202 + { job }); the snapshot is taken off
  // request and shows up on a re-list once the job settles. We await the job over
  // the `jobs` WS (the shared awaitJob), then refetch — never fabricating a row.
  const runJob = (label, call) => {
    setBusy(label);
    setError(null);
    call().then(
      (resp) => {
        const job = resp && resp.job;
        const done = (job && job.id) ? awaitJob(job.id, server.hostId) : Promise.resolve();
        return done.then(() => load()).finally(() => setBusy(null));
      },
      (err) => { setError(err && (err.userMessage || err.message) || "Action failed."); setBusy(null); }
    );
  };
  const createBackup = () => runJob("create", () => api.host(server.hostId).post("/servers/" + server.id + "/backups", { origin: "ui" }));
  const restoreBackup = (name) => runJob("restore:" + name, () => api.host(server.hostId).post("/servers/" + server.id + "/backups/restore", { backup: name, origin: "ui" }));

  // Download is NOT a job — nothing runs on the host, so there is no job to await and no re-list to
  // do. Mint the ticket through the normal authenticated seam, then hand the browser the URL it
  // returns. The ticket's URL is server-RELATIVE, so it is resolved against the owning node's origin
  // here: in a cluster the backup lives on one specific node, and pointing the browser at whichever
  // node the panel was opened from would 404.
  const downloadBackup = (name) => {
    setBusy("download:" + name);
    setError(null);
    api.host(server.hostId).post("/servers/" + server.id + "/backups/" + encodeURIComponent(name) + "/download-ticket", { origin: "ui" }).then(
      (res) => {
        const origin = apiOriginOf(server.hostId);
        if (!res || !res.url || !origin) throw new Error("Could not start the download.");
        // A hidden anchor rather than location.href: navigating the page away would tear down the SPA,
        // and `download` keeps the browser treating it as a file even before it reads the headers.
        const a = document.createElement("a");
        a.href = origin + res.url;
        a.download = "";
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setBusy(null);
      },
      (err) => { setError(err && (err.userMessage || err.message) || "Could not start the download."); setBusy(null); }
    );
  };

  // Pin/unpin is NOT a job — the backend rewrites one manifest inside the request and answers 204,
  // so the only thing left to do is re-list. Re-listed rather than flipped locally: the badge must
  // say what the host records, not what we asked for.
  const setPinned = (name, pinned) => {
    setBusy("pin:" + name);
    setError(null);
    const verb = pinned ? "pin" : "unpin";
    api.host(server.hostId)
      .post("/servers/" + server.id + "/backups/" + encodeURIComponent(name) + "/" + verb, { origin: "ui" })
      .then(
        () => load().finally(() => setBusy(null)),
        (err) => { setError(err && (err.userMessage || err.message) || "Could not change the backup's retention."); setBusy(null); }
      );
  };

  // Delete is NOT a job either — the backend unlinks the snapshot inside the request and answers 204,
  // so the only thing left to do is re-list. The row is dropped because the backend said it is gone,
  // never optimistically ahead of it: a delete that failed must leave the backup visibly still there.
  const deleteBackup = (name) => {
    setBusy("delete:" + name);
    setError(null);
    api.host(server.hostId).del("/servers/" + server.id + "/backups/" + encodeURIComponent(name) + "?origin=ui").then(
      () => load().finally(() => setBusy(null)),
      (err) => { setError(err && (err.userMessage || err.message) || "Could not delete the backup."); setBusy(null); }
    );
  };

  const count = list == null ? "—" : (list.length + (list.length === 1 ? " snapshot" : " snapshots"));
  return (
    <BriefCard
      icon="database"
      title="Backups"
      count={count}
      countTone="neutral"
      meta="Snapshots taken by the engine · newest first"
      action={
        <button className="fb-editor__btn" onClick={createBackup} disabled={busy === "create"}>
          {busy === "create"
            ? (<><span className="oauth-spinner" /> &nbsp;Backing up…</>)
            : (<><Icon name="plus" size={14} strokeWidth={2.2} /> &nbsp;Back up now</>)}
        </button>
      }
    >
      {error && (
        <div className="chat-brief__detail" style={{ color: "var(--danger)", padding: "4px 2px 10px" }}>
          <Icon name="alert-triangle" size={13} /> {error}
        </div>
      )}
      {list == null ? (
        <div className="chat-brief__detail" style={{ padding: "8px 2px" }}>Loading backups…</div>
      ) : list.length === 0 ? (
        <div style={{ textAlign: "center", padding: "24px 0", color: "var(--fg-3)" }}>
          <Icon name="database" size={22} strokeWidth={1.6} />
          <div style={{ marginTop: 10, fontSize: 14, color: "var(--fg-2)", fontWeight: 600 }}>No backups yet</div>
          <div style={{ marginTop: 4, fontSize: 12.5 }}>Take a snapshot with “Back up now”.</div>
        </div>
      ) : (
        <div className="chat-brief__list">
          {list.map((b) => {
            const restoring = busy === ("restore:" + b.name);
            const downloading = busy === ("download:" + b.name);
            const deleting = busy === ("delete:" + b.name);
            const pinning = busy === ("pin:" + b.name);
            // `compressed` may be absent entirely (a backup the engine lists but whose manifest we
            // could not read). That is "we don't know", not "it's compressed" — and offering a
            // download that the backend would refuse is worse than not offering one, so an unknown
            // reads the same as uncompressed here.
            const canDownload = b.compressed === true;
            return (
              <div className="chat-brief__item chat-brief__item--static" key={b.name}>
                <span className="chat-brief__icon"><Icon name="database" size={14} /></span>
                <div className="chat-brief__body">
                  <span className="chat-brief__item-title chat-brief__item-title--mono">
                    <span className="chat-brief__titletext">{b.name}</span>
                    {b.pinned && (
                      <span className="backup-row__tag backup-row__tag--pinned" title="Pinned — retention will not delete this backup">
                        <Icon name="pin" size={11} strokeWidth={2.2} /> Pinned
                      </span>
                    )}
                  </span>
                  {metaFor(b) && <span className="chat-brief__detail">{metaFor(b)}</span>}
                </div>
                <div className="backup-row__actions">
                  <button className="icon-btn" title="Restore" onClick={() => restoreBackup(b.name)} disabled={!!busy}>
                    {restoring ? <span className="oauth-spinner" /> : <Icon name="rotate-ccw" size={14} />}
                  </button>
                  <button
                    className="icon-btn"
                    title={canDownload
                      ? "Download"
                      : "Download — this backup is an uncompressed folder, not a single file"}
                    onClick={() => downloadBackup(b.name)}
                    disabled={!!busy || !canDownload}
                  >
                    {downloading ? <span className="oauth-spinner" /> : <Icon name="download" size={14} />}
                  </button>
                  <button
                    className={"icon-btn" + (b.pinned ? " is-armed" : "")}
                    title={b.pinned
                      ? "Unpin — let retention delete this backup again"
                      : "Pin — keep retention from deleting this backup"}
                    aria-label={b.pinned ? "Unpin backup" : "Pin backup"}
                    onClick={() => setPinned(b.name, !b.pinned)}
                    disabled={!!busy}
                  >
                    {pinning ? <span className="oauth-spinner" /> : <Icon name={b.pinned ? "pin-off" : "pin"} size={14} />}
                  </button>
                  <DeleteBackupButton
                    name={b.name}
                    busy={busy}
                    deleting={deleting}
                    onDelete={deleteBackup}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </BriefCard>
  );
}

export { BackupsList };
