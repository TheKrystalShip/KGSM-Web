// PlacementSection — which disk this server's files are on, and (for an admin) moving them onto
// another one.
//
// Self-contained: it reads the node's library set out of hostsStore itself rather than taking it from
// the settings form, because placement is not a setting. Every other row on that page is a value saved
// with the rest on "Save changes"; this one is minutes of copying that starts the moment it is
// confirmed, and folding it into a form's dirty state would make a Save button move a server.

import React from "react";
import { Icon } from "../../components/Icon.jsx";
import { Select } from "../../components/Select.jsx";
import { SettingsRow, SettingsSection } from "../../components/settings-primitives.jsx";
import { hostsStore, moveServer } from "../../lib/stores.js";
import { useStore } from "../../lib/store.js";
import { fmtBytes } from "../../lib/formatting.js";
import { canOn } from "../../lib/persona.js";

const errText = (e, fallback) => (e && (e.userMessage || e.message)) || fallback;

function PlacementSection({ server }) {
  const hostId = server && server.hostId;
  const host = useStore(hostsStore, s => s.list.find(h => h.id === hostId) || null);
  const canManage = canOn("host.manage", hostId);

  const [target, setTarget] = React.useState("");
  const [phase, setPhase] = React.useState("idle"); // "idle" | "confirm" | "sending"
  const [error, setError] = React.useState(null);

  const libraries = host ? host.libraries : null;

  // A node whose engine predates libraries reports null, and there is nothing here to draw: no library
  // to name and no set to move between. Offering the control anyway would be a fabricated one.
  if (!libraries) return null;

  // Where it could go: online, and not where it already is. An OFFLINE library is deliberately not an
  // option — the node refuses placement into an unreachable root — and the row below says how many are
  // out of reach rather than quietly showing a shorter list.
  const targets = libraries.filter(l => l.online && l.name !== server.library);
  const unreachable = libraries.filter(l => !l.online).length;

  const moving = server.status === "moving";
  const running = server.status === "online" || server.status === "starting";
  const away = server.libraryState === "offline";

  const blocked =
    moving ? "This server is being moved."
      : away ? "Its library isn’t mounted — nothing can be copied off a disk that isn’t there."
        : running ? "Stop the server before moving it."
          : targets.length === 0
            ? (unreachable > 0
              ? "No other library on this node is reachable right now."
              : "This node has nowhere else to put it.")
            : null;

  const submit = () => {
    if (!target) return;
    setPhase("sending");
    setError(null);
    moveServer(hostId, server.id, target).then(
      () => { setPhase("idle"); setTarget(""); },
      (err) => { setPhase("idle"); setError(errText(err, "Couldn’t start the move.")); },
    );
  };

  return (
    <SettingsSection icon="hard-drive" title="Storage">
      <SettingsRow
        icon="hard-drive"
        title="Library"
        sub={server.libraryPath || "The disk this server's files live on."}>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <code style={{ fontSize: 12.5 }}>{server.library || "—"}</code>
          {/* Rendered only when it is NOT the ordinary state: a chip on every row would say nothing,
              and the two that matter are a disk that is gone and a root this node has no entry for. */}
          {server.libraryState && server.libraryState !== "online" && (
            <span className={"lib-state lib-state--" + (away ? "offline" : "unregistered")}>
              {away ? "not mounted" : server.libraryState}
            </span>
          )}
        </span>
      </SettingsRow>

      {/* Its own strip rather than a settings row: the controls column beside a row's text is sized
          for a toggle, and this is a picker, a button and a sentence about restarting somebody's
          server. It also owns its error where it happened — a refusal names the disk or the state
          that blocked it, and a toast would carry that away from the picker it is about. */}
      {canManage && (
        <div className="srv-move">
          <div className="srv-move__row">
            {phase === "confirm" ? (
              <>
                <span className="srv-move__ask">
                  Copy <b>{server.name || server.id}</b> to <code>{target}</code>? It is stopped for the
                  copy and started once on its new disk to confirm it runs there.
                </span>
                <span style={{ flex: 1 }}></span>
                <button className="lib-btn lib-btn--primary" onClick={submit}>Confirm move</button>
                <button className="lib-btn" onClick={() => setPhase("idle")}>Cancel</button>
              </>
            ) : (
              <>
                <label className="srv-move__label" htmlFor="srv-move-target">Move to another library</label>
                <Select
                  id="srv-move-target"
                  value={target}
                  disabled={!!blocked || phase === "sending"}
                  onChange={e => { setTarget(e.target.value); setError(null); }}
                  options={[{ value: "", label: "Choose a library…" }].concat(
                    targets.map(l => ({
                      value: l.name,
                      // Free space beside the name, because it is the one figure that decides
                      // whether the move can happen at all. Omitted when nothing measured it rather
                      // than shown as a zero, which would read as a full disk.
                      label: l.free_bytes != null
                        ? l.name + " · " + fmtBytes(l.free_bytes) + " free"
                        : l.name,
                    })),
                  )} />
                <span style={{ flex: 1 }}></span>
                {phase === "sending"
                  ? <span className="srv-move__note">Starting the move…</span>
                  : (
                    <button
                      className="lib-btn"
                      disabled={!!blocked || !target}
                      onClick={() => { setError(null); setPhase("confirm"); }}>
                      <Icon name="move" size={12} /> Move
                    </button>
                  )}
              </>
            )}
          </div>

          <div className="srv-move__note">
            {blocked
              || "The copy takes as long as the server is large. Its backups stay where they are."}
          </div>

          {error && <div className="lib-err">{error}</div>}
        </div>
      )}

    </SettingsSection>
  );
}

export { PlacementSection };
