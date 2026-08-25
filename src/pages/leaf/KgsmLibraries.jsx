// KgsmLibraries — the Library tab of the engine's page: the named roots this node places game
// servers in, and (for an admin) registering, renaming and deregistering them.
//
// A library is engine domain, not host telemetry — a root somebody declared, not a filesystem the
// monitor found. One node can hold several libraries on one disk, and a mounted disk kgsm knows
// nothing about is not a place a server can go. That is why this lives on the engine's page rather
// than among the node's resource cards.

import React from "react";
import { Icon } from "../../components/Icon.jsx";
import { Select } from "../../components/Select.jsx";
import { addLibrary, removeLibrary, renameLibrary } from "../../lib/stores.js";
import { fmtBytes } from "../../lib/formatting.js";
import { canOn } from "../../lib/persona.js";
import { LeafNotice } from "./leafOverviewKit.jsx";

const errText = (e, fallback) => (e && (e.userMessage || e.message)) || fallback;

function KgsmLibraries({ host }) {
  const libraries = host && host.libraries;
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

  // Which row is offering to drain, and where to. Keyed by name for the same reason the errors are:
  // one row's picker must never appear under another's.
  const [draining, setDraining] = React.useState(null);
  const [drainTo, setDrainTo] = React.useState("");

  // A null registry means the engine could not report this node's placement roots — a node whose
  // engine predates libraries, or one that would not answer. There is no placement surface to draw
  // and inventing one would offer a control the backend cannot act on, so the tab says exactly that.
  if (!libraries) {
    return (
      <LeafNotice title="Libraries unreadable">
        The engine could not report this node’s placement roots — it may predate libraries, or it
        didn’t answer.
      </LeafNotice>
    );
  }

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

  // A bare deregistration. The node refuses one that still holds servers and names every one of them;
  // that refusal renders in this row, and offering to drain is the way past it.
  const submitRemove = (lib) => {
    setRowBusy(lib.name);
    setErr(lib.name, null);
    removeLibrary(host.id, lib.name).then(
      () => setRowBusy(null),
      (err) => {
        setRowBusy(null);
        setErr(lib.name, errText(err, "Couldn’t deregister it."));
        // Only where there is somewhere to drain INTO. Offering the alternative on a node with one
        // other unreachable library would be a control that cannot work.
        if (lib.instance_count > 0 && drainTargets(lib).length > 0) {
          setDrainTo("");
          setDraining(lib.name);
        }
      },
    );
  };

  // Emptying it first, then deregistering. ⚠ This runs for as long as the copy takes — minutes per
  // server — and nothing brackets it, so there is no progress to show and the row simply waits.
  const submitDrain = (lib) => {
    if (!drainTo) return;
    setRowBusy(lib.name);
    setErr(lib.name, null);
    removeLibrary(host.id, lib.name, drainTo).then(
      () => { setRowBusy(null); setDraining(null); setDrainTo(""); },
      (err) => { setRowBusy(null); setErr(lib.name, errText(err, "Couldn’t empty it.")); },
    );
  };

  // Where a library's servers could go: online, and not itself. An offline one is not offered —
  // the node refuses placement into a root it cannot reach.
  const drainTargets = (lib) => libraries.filter(l => l.online && l.name !== lib.name);

  return (
    <div className="chat-brief">
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
                          {lib.instance_count > 0 && drainTargets(lib).length > 0 && draining !== lib.name && (
                            <button
                              type="button"
                              className="lib-btn"
                              disabled={busy}
                              onClick={() => { setDrainTo(""); setErr(lib.name, null); setDraining(lib.name); }}>
                              Empty &amp; remove
                            </button>
                          )}
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

                {canManage && draining === lib.name && (
                  <form className="lib-drain" onSubmit={e => { e.preventDefault(); submitDrain(lib); }}>
                    <label className="lib-drain__label">
                      Move {lib.instance_count} server{lib.instance_count === 1 ? "" : "s"} to
                    </label>
                    <Select
                      className="lib-drain__pick"
                      value={drainTo}
                      autoFocus
                      onChange={e => setDrainTo(e.target.value)}
                      options={[{ value: "", label: "Choose a library…" }].concat(
                        drainTargets(lib).map(t => ({
                          value: t.name,
                          // Free space beside the name: it is what decides whether the whole
                          // library will fit, and it is the figure somebody is choosing on.
                          label: t.free_bytes != null
                            ? t.name + " · " + fmtBytes(t.free_bytes) + " free"
                            : t.name,
                        })),
                      )} />
                    <button type="submit" className="lib-btn lib-btn--primary" disabled={!drainTo || busy}>
                      {busy ? "Moving…" : "Empty & remove"}
                    </button>
                    <button type="button" className="lib-btn" onClick={() => setDraining(null)}>Cancel</button>
                    {/* Every server has to be stopped first — the node lists the running ones and
                        moves nothing rather than shutting somebody's server down for them. */}
                    <span className="lib-drain__note">
                      Every server here has to be stopped first. Each is copied, started once on its
                      new disk to confirm it runs there, and only then removed from this one.
                    </span>
                  </form>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export { KgsmLibraries };
