import React from "react";

import { Icon } from "./Icon.jsx";
import { fmtBytes, uptimeShort } from "../lib/formatting.js";
import { leafIcon, leafKind, leafStatus } from "../lib/leaves.js";
import { servicesStore, setLeafProvisioned } from "../lib/stores.js";

// LeafCard — the reusable tile for one KGSM leaf on one node, and the leaf's counterpart to
// the game-server tile: identity, run state, live facts and the controls, in that order.
//
// Its one structural difference from a server tile is the axes strip. A leaf has TWO
// independent states — the unit systemd reports, and the link this panel holds to the leaf —
// and neither implies the other: a leaf can be running and disconnected, or connected and
// dead. The strip gives each a labelled half instead of folding them into one status word,
// and carries the status accent, so the card's colour sits on the row that means something.
//
// A leaf with no link to provision (the api itself, the bot, the speech engine) says so; that
// absence is honest and is never rendered as "disconnected".

// Lifecycle actions have no endpoint yet — a leaf restarts today only as the tail of applying
// a config change. The row is shown disabled rather than hidden so its place is settled, and
// is never wired to an empty config PUT, which returns `unchanged` and restarts nothing.
// Same rule, and the same wording, as the leaf page's System tab.
const LIFECYCLE_HINT = "Starting, restarting and stopping a leaf on its own isn’t available yet — applying a settings change restarts it.";

// The API↔leaf connection, which is what "provisioned" means: whether this panel holds a link
// to the leaf, independent of whether the unit is up. Optimistic, with a rollback — the row is
// re-applied from the store if the host refuses.
function LeafProvisionControl({ svc, hostId }) {
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState(null);
  const connected = svc.provisioned === true;
  const toggle = () => {
    if (busy || !hostId) return;
    const want = !connected;
    setErr(null);
    setBusy(true);
    servicesStore.applyRow(hostId, { ...svc, provisioned: want });
    setLeafProvisioned(hostId, svc.id, want)
      .catch((e) => {
        servicesStore.applyRow(hostId, svc);
        setErr((e && (e.userMessage || e.message)) || "Couldn’t apply");
      })
      .finally(() => setBusy(false));
  };
  return (
    <>
      <button
        className={"svc-prov-btn svc-prov-btn--" + (connected ? "off" : "on")}
        onClick={toggle} disabled={busy}
        title={connected ? "Disconnect this leaf from the API" : "Connect this leaf to the API"}>
        {busy
          ? <Icon name="loader" size={12} className="act-spin" />
          : <Icon name={connected ? "unplug" : "plug"} size={12} strokeWidth={2.2} />}
        {connected ? "Disconnect" : "Connect"}
      </button>
      {err && <span className="svc-prov-err" title={err}><Icon name="triangle-alert" size={11} /> {err}</span>}
    </>
  );
}

// The Link half. Three states, and the third is an absence rather than a value: `provisioned` is null
// for a leaf with no stored connection to arm, which is not the same as "off". Two different reasons
// reach that null — the api and the bot, which this api holds no client to at all, and the speech engine,
// whose presence is read off its socket file rather than stored. Either way there is no switch behind the
// row, so it reads "not applicable" rather than offering one.
function LinkAxis({ svc }) {
  // The engine has no stored connection because none is needed: this panel reaches it by executing
  // it, through kgsm-lib. That is a live path, not an absent one, so it is named rather than
  // rendered as "not applicable".
  if (svc.id === "kgsm") {
    return (
      <div className="svc-card__axis">
        <span className="svc-card__axis-lbl">Link</span>
        <span className="svc-card__axis-val svc-card__axis-val--linked">
          <Icon name="terminal" size={13} strokeWidth={2.2} /> Direct exec
        </span>
        <span className="svc-card__axis-sub">via kgsm-lib</span>
      </div>
    );
  }
  if (svc.provisioned == null) {
    return (
      <div className="svc-card__axis">
        <span className="svc-card__axis-lbl">Link</span>
        <span className="svc-card__axis-val svc-card__axis-val--none">
          <Icon name="ellipsis" size={13} /> Not applicable
        </span>
        <span className="svc-card__axis-sub">not provisionable</span>
      </div>
    );
  }
  return (
    <div className="svc-card__axis">
      <span className="svc-card__axis-lbl">Link</span>
      <span className={"svc-card__axis-val" + (svc.provisioned ? " svc-card__axis-val--linked" : "")}>
        <Icon name={svc.provisioned ? "plug" : "unplug"} size={13} strokeWidth={2.2} />
        {svc.provisioned ? "Connected" : "Disconnected"}
      </span>
      <span className="svc-card__axis-sub">{svc.provisioned ? "this panel" : "no traffic"}</span>
    </div>
  );
}

function LeafCard({ svc, hostId, canManage, onOpen, onConfigure }) {
  const s = leafStatus(svc);
  const kind = leafKind(svc.id);
  const icon = leafIcon(svc.id);
  // The engine's pseudo-leaf row: a stateless CLI, not a unit. Runtime facts (memory, pid, boot),
  // lifecycle controls and the config page are all unit-vocabulary, so none of them render for it.
  const engine = svc.id === "kgsm";
  const running = svc.state === "active";
  // Runtime facts belong to a running unit. A stopped or absent one reports nothing, and the
  // card shows that as an em-dash rather than borrowing the last reading it had.
  const mem = running ? fmtBytes(svc.memoryBytes) : null;
  const up = running && svc.since ? uptimeShort(svc.since) : null;
  const pid = running && svc.mainPid ? svc.mainPid : null;
  const unhealthy = !!(svc.health && svc.health.status === "down");

  return (
    <article className={"svc-card svc-card--" + s.tone}>
      <div className="svc-card__head">
        <span className="svc-card__plate"><Icon name={icon} size={18} /></span>
        <div className="svc-card__id">
          {kind && <span className="svc-card__kind">{kind}</span>}
          <div className="svc-card__name" title={svc.displayName}>{svc.displayName}</div>
          <div className="svc-card__unit" title={svc.unit || undefined}>
            {svc.unit || (engine ? "stateless CLI — no resident process" : "")}
          </div>
        </div>
        <button className="svc-cfg-btn svc-cfg-btn--go" onClick={onOpen} title={"Open " + svc.displayName}>
          Open <Icon name="arrow-right" size={12} strokeWidth={2} />
        </button>
      </div>

      <div className="svc-card__axes">
        <span className="svc-card__mark" aria-hidden="true"><Icon name={icon} size={62} strokeWidth={1.4} /></span>
        <div className="svc-card__axis">
          <span className="svc-card__axis-lbl">Unit</span>
          <span className="svc-card__axis-val svc-card__axis-val--unit">
            <span className={"svc-dot svc-dot--" + s.tone}></span>{s.label}
          </span>
          <span className="svc-card__axis-sub">{s.note || (up ? "up " + up : "—")}</span>
        </div>
        <LinkAxis svc={svc} />
      </div>

      <div className="svc-card__body">
        {/* Rendered even when the leaf reports no role: the slot is a fixed two lines, and it
            holding its height for every card is what keeps the rows below it aligned. */}
        <div className="svc-card__role" title={svc.role || undefined}>{svc.role}</div>
        {unhealthy && svc.health.message && (
          <div className="svc-card__health"><Icon name="triangle-alert" size={12} /> {svc.health.message}</div>
        )}
        {!engine && (
          <div className="svc-card__meta">
            <span className="svc-fact" title="memory (systemd cgroup accounting)">
              <Icon name="memory-stick" size={11} />{mem || "—"}
            </span>
            <span className="svc-fact" title="main pid"><Icon name="hash" size={11} />{pid || "—"}</span>
            <span className={"svc-fact svc-fact--boot" + (svc.enabled ? " is-on" : "")} title="starts on boot">
              <Icon name={svc.enabled ? "power" : "power-off"} size={11} />
              {svc.enabled == null ? "—" : svc.enabled ? "boot" : "manual"}
            </span>
          </div>
        )}

        {canManage && !engine && (
          <div className="svc-card__quick">
            <button className="svc-cfg-btn" disabled title={LIFECYCLE_HINT}>
              <Icon name="play" size={12} /> Start
            </button>
            <button className="svc-cfg-btn" disabled title={LIFECYCLE_HINT}>
              <Icon name="rotate-cw" size={12} /> Restart
            </button>
            <button className="svc-cfg-btn" disabled title={LIFECYCLE_HINT}>
              <Icon name="square" size={12} /> Stop
            </button>
          </div>
        )}

        {canManage && !engine && (
          <div className="svc-card__prov">
            {svc.provisioned != null && <LeafProvisionControl svc={svc} hostId={hostId} />}
            {/* Configuration is one tab of the leaf's own page — the all-leaves config page is
                still its own route at #/config/{host}. */}
            <button className="svc-cfg-btn svc-card__cfg" onClick={onConfigure} title={"Configure " + svc.displayName}>
              <Icon name="sliders-horizontal" size={12} /> Configure
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

export { LeafCard, LeafProvisionControl };
