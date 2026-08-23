import React from "react";
import { Icon } from "./Icon.jsx";
import { Modal } from "./Modal.jsx";
import { Select } from "./Select.jsx";
import { artBg } from "../lib/art.js";
import { fmtBytes, fmtFootprintMb } from "../lib/formatting.js";
import { FIT_LABEL, fitSummary, nodeFit, recommendedNode } from "../lib/placement.js";
import { instanceIdSlug, isValidInstanceId, offeringHosts } from "../lib/servers.js";
import { Toggle } from "./settings-primitives.jsx";

// InstallModal — overlay form for spinning up a new game server.
// Props:
//   game     — catalog entry from the library store (name, art, rawg_slug…)
//   onClose  — () => void
//   onInstall — (config) => void   // called when user confirms
//   error    — the refusal the last submit came back with, rendered beside the controls

// Standard build channels — offered until the backend reports per-game versions.
const VERSION_OPTIONS = [
  { value: "stable",      label: "Latest stable" },
  { value: "beta",        label: "Public beta" },
  { value: "experimental", label: "Experimental" },
];

function InstallModal({ game, onClose, onInstall, hosts = [], error = null }) {
  // Seed the form from the backend blueprint DTO — never a hardcoded per-game
  // map. `ports` is served today so the game port pre-fills for real; the query
  // port has no honest blueprint designation (left blank/optional) and max
  // players comes from `specs.maxPlayers` (null today → blank).
  const defaultPort = (game.ports && game.ports[0] && game.ports[0].start) || "";
  const defaultSlots = (game.specs && game.specs.maxPlayers != null) ? game.specs.maxPlayers : "";
  // Only hosts that OFFER this blueprint can install it. Absent game.hosts =
  // every host offers it (the common case). The catalog is the union across
  // the fleet, so a game added by one host alone is installable only there.
  const offered = offeringHosts(game, hosts);
  const restricted = offered.length > 0 && offered.length < hosts.length;
  // Which node this server lands on is a PLACEMENT decision, measured: the
  // blueprint's declared RAM/disk against each node's live headroom. A sole
  // candidate is preselected because it is the only choice (its fit is still
  // shown, however it reads); beyond that, only a node measured to have room is
  // preselected. Nothing measurable ⇒ no preselection and the user picks — never
  // a fall back to whichever node sorted first.
  const initialHost = offered.length === 1 ? offered[0].id : recommendedNode(game, offered);
  const [form, setForm] = React.useState({
    name:    `My ${game.name.split(":")[0]} Server`,
    version: "stable",
    hostId:  initialHost,
    port:    defaultPort,
    query:   "",
    slots:   defaultSlots,
    password: "",
    autostart: false,
    library: "",
    id: "",
  });
  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  // The two names a server gets. `name` is the label — free text, and the only one a person is asked
  // for. The id is derived from it by the same rule the backend uses, shown so it is not a surprise,
  // and sent only once somebody takes it over: an id this form guessed is a courtesy the engine may
  // refuse, and letting it fall through to the engine's own generated id is what keeps a name with no
  // usable slug (one written in Japanese, a row of emoji) from failing a create nobody asked to be
  // picky about.
  const [ownId, setOwnId] = React.useState(false);
  const derivedId = instanceIdSlug(form.name);
  const chosenId = ownId ? form.id.trim() : "";
  const idRefused = ownId && chosenId.length > 0 && !isValidInstanceId(chosenId);
  // Reveal-password toggle for the (optional) server password field.
  const [showPw, setShowPw] = React.useState(false);

  // Which disk the server lands on, once a node is picked. A host reporting `null` libraries runs an
  // engine that has no such concept, and the field is not rendered at all — offering a choice the
  // backend cannot act on would be a fabricated control. An OFFLINE library is listed and disabled
  // rather than hidden, because "the drive isn't mounted" is why it is missing and a silently shorter
  // list makes that unanswerable.
  const pickedHost = form.hostId ? offered.find(h => h.id === form.hostId) : null;
  const libraries = pickedHost ? pickedHost.libraries : null;
  const onlineLibraries = libraries ? libraries.filter(l => l.online) : [];
  // Preselected only when there is exactly one place it could go. Beyond that the person picks: the
  // engine's own default is not visible from here, and guessing at it would put a server on a disk
  // nobody chose.
  const soleLibrary = onlineLibraries.length === 1 ? onlineLibraries[0].name : "";
  const libraryKey = libraries ? libraries.map(l => l.name + ":" + l.online).join(",") : "";
  React.useEffect(() => {
    set("library", soleLibrary);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-seed only when the picked node's library set changes; a person's own pick must survive every other render
  }, [libraryKey]);


  // If the offering changes while the modal is open (a host syncs its catalog)
  // and the picked node no longer offers the game, re-derive by the same measured
  // rule rather than pinning whatever is left at the top of the list.
  const offeredIds = offered.map(h => h.id).join(",");
  React.useEffect(() => {
    if (form.hostId && !offered.some(h => h.id === form.hostId)) {
      set("hostId", offered.length === 1 ? offered[0].id : recommendedNode(game, offered));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-validate the picked node only when the offering (offeredIds) changes; form.hostId and the fit inputs are read fresh at that point
  }, [offeredIds]);

  // Fit is recomputed every render rather than memoised: it reads live host
  // capacity, so a cached verdict would go stale against the next metrics tick.
  const fits = {};
  for (const h of offered) fits[h.id] = nodeFit(game, h);
  const picked = form.hostId ? fits[form.hostId] : null;
  const needsPick = offered.length > 1 && !form.hostId;

  // Blocked while a choice the backend needs is unmade: a node, and — where the host reports a
  // library set — which of them. Both refuse rather than defaulting, for the same reason.
  const blocked = (offered.length > 0 && !form.hostId)
    || (libraries != null && libraries.length > 0 && !form.library)
    || idRefused;

  const submit = (e) => {
    e.preventDefault();
    if (blocked) return;
    onInstall({ game, ...form, id: chosenId || null });
  };

  // Cover art comes from the backend on the catalog entry (game.cover); falls
  // back to the themed gradient placeholder.
  const art = artBg(game.hero, game.cover);

  return (
    <Modal onClose={onClose} scrimClassName="k-backdrop">
      <form className="k-modal" onSubmit={submit}>
        <div className="k-modal__art" style={{ backgroundImage: art, backgroundSize: "cover", backgroundPosition: "center" }}></div>
        <div className="k-modal__head">
          <Icon name="download" size={18} style={{ color: "var(--krystal-teal)" }} />
          <span className="k-modal__title">Install {game.name}</span>
          <button type="button" className="k-modal__close" onClick={onClose} aria-label="Close">
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="k-modal__sub">
          Krystal will download the server build, allocate ports, and write a starter config you can edit later.
        </div>

        <div className="k-modal__body">
          {offered.length > 0 && (
            <div className="k-field">
              <label>Node</label>
              <Select value={form.hostId || ""} onChange={e => set("hostId", e.target.value || null)} disabled={offered.length <= 1}>
                {needsPick && <option value="">Choose a node…</option>}
                {offered.map(h => (
                  <option key={h.id} value={h.id}>
                    {h.name} — {h.hostname} · {FIT_LABEL[fits[h.id].fit]}
                  </option>
                ))}
              </Select>
              <span className="k-field__help">
                {picked
                  ? fitSummary(picked)
                  : "No node measures as having room for this blueprint — pick where it should land."}
              </span>
              {restricted && (
                <span className="k-field__help">
                  <Icon name="server" size={11} />&nbsp; Only {offered.map(h => h.name).join(", ")} {offered.length === 1 ? "offers" : "offer"} {game.name.split(":")[0]}.
                </span>
              )}
            </div>
          )}

          {libraries && libraries.length > 0 && (
            <div className="k-field">
              <label>Library</label>
              <Select value={form.library} onChange={e => set("library", e.target.value)}>
                {onlineLibraries.length !== 1 && <option value="">Choose a library…</option>}
                {libraries.map(l => (
                  <option key={l.name} value={l.name} disabled={!l.online}>
                    {l.name} — {l.online
                      ? (l.free_bytes != null ? fmtBytes(l.free_bytes) + " free" : "free space unknown")
                      : "offline"}
                  </option>
                ))}
              </Select>
              {form.library && (
                <span className="k-field__help mono">
                  {(libraries.find(l => l.name === form.library) || {}).path}
                </span>
              )}
              {onlineLibraries.length === 0 && (
                <span className="k-field__help">
                  <Icon name="triangle-alert" size={11} />&nbsp;
                  Every library on {pickedHost.name} is offline — nothing can be installed there.
                </span>
              )}
            </div>
          )}

          <div className="k-field">
            <label>Display name</label>
            <input value={form.name} onChange={e => set("name", e.target.value)} autoFocus />
            <span className="k-field__help">Shown in the sidebar and Discord notifications.</span>
          </div>

          <div className="k-field">
            <label>Instance id</label>
            {ownId ? (
              <div className="k-idpreview k-idpreview--editing">
                <input
                  className="mono"
                  value={form.id}
                  autoFocus
                  placeholder={derivedId || game.id}
                  onChange={e => set("id", e.target.value)} />
                <button type="button" className="lib-btn" onClick={() => { setOwnId(false); set("id", ""); }}>
                  <Icon name="undo-2" size={12} /> Use the name
                </button>
              </div>
            ) : (
              <div className="k-idpreview">
                <code>{derivedId || "assigned by the engine"}</code>
                <span style={{ flex: 1 }}></span>
                <button type="button" className="lib-btn" onClick={() => { setOwnId(true); set("id", derivedId || ""); }}>
                  <Icon name="pencil" size={12} /> Change
                </button>
              </div>
            )}
            <span className="k-field__help">
              {idRefused
                ? "Letters, digits, then any of . _ - — up to 64 characters."
                : "Paths, logs and commands use this. It never changes."}
            </span>
          </div>

          <div className="k-field">
            <label>Version</label>
            <Select value={form.version} disabled>
              {VERSION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
            <span className="k-field__help">Version selection isn't available yet — the latest build is installed.</span>
          </div>

          <div className="k-field__row">
            <div className="k-field">
              <label>Game port</label>
              <input type="number" className="mono" value={form.port} onChange={e => set("port", +e.target.value)} />
            </div>
            <div className="k-field">
              <label>Query port <small>(optional)</small></label>
              <input type="number" className="mono" value={form.query} placeholder="—" onChange={e => set("query", e.target.value ? +e.target.value : "")} />
            </div>
          </div>

          <div className="k-field__row">
            <div className="k-field">
              <label>Max players</label>
              <input type="number" className="mono" value={form.slots} onChange={e => set("slots", +e.target.value)} />
            </div>
            <div className="k-field">
              <label>Password <small>(optional)</small></label>
              <div className="k-input-affix">
                <input
                  type={showPw ? "text" : "password"}
                  value={form.password}
                  placeholder="leave blank for open"
                  onChange={e => set("password", e.target.value)} />
                <button
                  type="button"
                  className="k-input-affix__btn"
                  tabIndex={-1}
                  onClick={() => setShowPw(v => !v)}
                  aria-label={showPw ? "Hide password" : "Show password"}
                  title={showPw ? "Hide password" : "Show password"}>
                  <Icon name={showPw ? "eye-off" : "eye"} size={15} />
                </button>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "4px 0 6px" }}>
            <Toggle on={form.autostart} onChange={v => set("autostart", v)} />
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ color: "var(--fg-1)", fontSize: 13.5, fontWeight: 500 }}>Start immediately after install</span>
              <span style={{ color: "var(--fg-3)", fontSize: 12 }}>Otherwise it'll sit at "offline" until you hit Start.</span>
            </div>
          </div>
        </div>

        {/* The node's refusal, in the form that caused it. An id it will not take is the common one,
            and the sentence naming it belongs beside the field that has to change, not in a toast
            over a modal that is still open with the answer on screen. */}
        {error && <div className="lib-err" style={{ margin: "0 22px" }}>{error}</div>}

        <div className="k-modal__foot">
          <span style={{ flex: 1, color: "var(--fg-3)", fontSize: 12 }}>
            <Icon name="hard-drive" size={12} />&nbsp;
            {game.specs && game.specs.baseDiskMb != null
              ? <>~{fmtFootprintMb(game.specs.baseDiskMb)} download</>
              : "Download size unknown"}
          </span>
          <button type="button" className="k-modal__btn k-modal__btn--secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="k-modal__btn k-modal__btn--primary" disabled={blocked}>
            <Icon name="download" size={14} strokeWidth={2.2} />&nbsp;Install
          </button>
        </div>
      </form>
    </Modal>
  );
}

export { InstallModal };
