// DiagLibraries — the named roots this node places game servers in, and (for an admin) registering,
// renaming and deregistering them.
//
// It sits beside the disk card and is deliberately not folded into it: a disk is a filesystem the
// monitor found, a library is a root somebody declared. One node can hold several libraries on one
// disk, and a mounted disk kgsm knows nothing about is not a place a server can go.

import React from "react";
import { Icon } from "../../components/Icon.jsx";
import { addLibrary, removeLibrary, renameLibrary } from "../../lib/stores.js";
import { fmtBytes } from "../../lib/formatting.js";
import { canOn } from "../../lib/persona.js";

const errText = (e, fallback) => (e && (e.userMessage || e.message)) || fallback;

function DiagLibraries({ host }) {
  const libraries = host.libraries;
  const canManage = canOn("host.manage", host.id);

  const [adding, setAdding] = React.useState(false);
  const [path, setPath] = React.useState("");
  const [name, setName] = React.useState("");
  const [addError, setAddError] = React.useState(null);
  const [addBusy, setAddBusy] = React.useState(false);

  // Which row is being renamed or is holding a refusal. Keyed by library name rather than a boolean,
  // so one row's error can never render under another.
  const [renaming, setRenaming] = React.useState(null);
  const [renameTo, setRenameTo] = React.useState("");
  const [rowError, setRowError] = React.useState({});
  const [rowBusy, setRowBusy] = React.useState(null);

  // A node whose engine predates libraries reports null and this card does not exist — there is no
  // placement surface to draw and inventing one would offer a control the backend cannot act on.
  if (!libraries) return null;

  const setErr = (key, msg) => setRowError(prev => ({ ...prev, [key]: msg }));

  const submitAdd = (e) => {
    e.preventDefault();
    const p = path.trim();
    if (!p) return;
    setAddBusy(true);
    setAddError(null);
    addLibrary(host.id, p, name.trim() || null).then(
      () => { setAddBusy(false); setAdding(false); setPath(""); setName(""); },
      (err) => { setAddBusy(false); setAddError(errText(err, "Couldn’t register that path.")); },
    );
  };

  const submitRename = (e, from) => {
    e.preventDefault();
    const to = renameTo.trim();
    if (!to || to === from) { setRenaming(null); return; }
    setRowBusy(from);
    setErr(from, null);
    renameLibrary(host.id, from, to).then(
      () => { setRowBusy(null); setRenaming(null); },
      (err) => { setRowBusy(null); setErr(from, errText(err, "Couldn’t rename it.")); },
    );
  };

  const submitRemove = (lib) => {
    setRowBusy(lib.name);
    setErr(lib.name, null);
    removeLibrary(host.id, lib.name).then(
      () => setRowBusy(null),
      (err) => { setRowBusy(null); setErr(lib.name, errText(err, "Couldn’t deregister it.")); },
    );
  };

  return (
    <div className="chat-brief" style={{ marginTop: 16 }}>
      <div className="chat-brief__head">
        <span className="chat-brief__title">
          <Icon name="hard-drive" size={13} /> Librar{libraries.length === 1 ? "y" : "ies"}
          <span className="chat-brief__count chat-brief__count--neutral">{libraries.length}</span>
        </span>
        <span style={{ flex: 1 }}></span>
        {canManage && !adding && (
          <button type="button" className="lib-btn" onClick={() => { setAdding(true); setAddError(null); }}>
            <Icon name="plus" size={12} /> Add
          </button>
        )}
      </div>

      {canManage && adding && (
        <form className="lib-add" onSubmit={submitAdd}>
          <div className="lib-add__row">
            <input
              className="mono"
              value={path}
              autoFocus
              placeholder="/mnt/ssd/kgsm"
              onChange={e => setPath(e.target.value)} />
            <input
              value={name}
              placeholder="name (optional)"
              onChange={e => setName(e.target.value)} />
            <button type="submit" className="lib-btn lib-btn--primary" disabled={!path.trim() || addBusy}>
              {addBusy ? "Registering…" : "Register"}
            </button>
            <button type="button" className="lib-btn" onClick={() => { setAdding(false); setAddError(null); }}>
              Cancel
            </button>
          </div>
          {addError && <div className="lib-err">{addError}</div>}
        </form>
      )}

      {libraries.length === 0 ? (
        <div className="lib-empty">
          <Icon name="hard-drive" size={16} strokeWidth={1.8} />
          <span>No library is registered on {host.name}, so nothing can be installed here.</span>
        </div>
      ) : (
        <div className="disk-list">
          {libraries.map((lib) => {
            const measured = lib.online && lib.total_bytes > 0 && lib.free_bytes != null;
            const usedPct = measured
              ? Math.round(((lib.total_bytes - lib.free_bytes) / lib.total_bytes) * 100)
              : 0;
            const tone = usedPct > 90 ? "danger" : usedPct > 80 ? "warn" : "success";
            const busy = rowBusy === lib.name;
            return (
              <div className="disk-row" key={lib.name}>
                <div className="disk-row__head">
                  {renaming === lib.name ? (
                    <form className="lib-rename" onSubmit={e => submitRename(e, lib.name)}>
                      <input
                        value={renameTo}
                        autoFocus
                        onChange={e => setRenameTo(e.target.value)}
                        onKeyDown={e => { if (e.key === "Escape") setRenaming(null); }} />
                      <button type="submit" className="lib-btn lib-btn--primary" disabled={busy}>
                        {busy ? "Saving…" : "Save"}
                      </button>
                      <button type="button" className="lib-btn" onClick={() => setRenaming(null)}>Cancel</button>
                    </form>
                  ) : (
                    <>
                      <code className="disk-row__mount">{lib.name}</code>
                      <span className="disk-row__device">{lib.path}</span>
                      {lib.device && <span className="disk-row__fs">{lib.device}</span>}
                      <span style={{ flex: 1 }}></span>
                      <span className={"lib-state lib-state--" + (lib.online ? "online" : "offline")}>
                        {lib.online ? "online" : "offline"}
                      </span>
                      {canManage && (
                        <span className="lib-row__acts">
                          <button
                            type="button"
                            className="lib-btn"
                            disabled={busy}
                            onClick={() => { setRenameTo(lib.name); setRenaming(lib.name); setErr(lib.name, null); }}>
                            Rename
                          </button>
                          <button
                            type="button"
                            className="lib-btn lib-btn--danger"
                            disabled={busy}
                            onClick={() => submitRemove(lib)}>
                            {busy ? "Working…" : "Deregister"}
                          </button>
                        </span>
                      )}
                    </>
                  )}
                </div>

                {measured && (
                  <div className="disk-row__bar">
                    <i className={"disk-row__fill disk-row__fill--" + tone} style={{ width: usedPct + "%" }}></i>
                  </div>
                )}

                <div className="disk-row__usage">
                  <span>
                    {/* Offline means nothing measured it. A 0 here would read as a full disk, which is
                        the opposite fact and the one somebody would act on. */}
                    {measured
                      ? <><b>{fmtBytes(lib.free_bytes)}</b> free of {fmtBytes(lib.total_bytes)}</>
                      : "capacity unmeasured"}
                  </span>
                  <span style={{ marginLeft: "auto" }}>
                    {lib.instance_count} server{lib.instance_count === 1 ? "" : "s"}
                    {measured ? " · " + usedPct + "%" : ""}
                  </span>
                </div>

                {rowError[lib.name] && <div className="lib-err">{rowError[lib.name]}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export { DiagLibraries };
