import React from "react";
import { Icon } from "../Icon.jsx";
import { Modal } from "../Modal.jsx";
import { SERVER_ACTION } from "../ServerActions.jsx";
import { capacityForecast, isWholeFleet, partitionSelection, playersAffected } from "./preflight.js";
import { capacityDetail } from "../../lib/capacity.js";
import { dispatchRun, narrowSelectionWhenSettled } from "../../lib/batchRun.js";
import { useStore } from "../../lib/store.js";
import { hostsStore, selectionStore, serversStore } from "../../lib/stores.js";

// BatchPreflight — what a run would do, and the one place it is armed.
//
// ONE confirm for the whole run. The safety is this sheet stating the count, the refusals and the
// players lost — not a gesture repeated N times, because repetition is the friction this feature
// removes and a confirm clicked twenty times is read zero times.
//
// The wording ESCALATES when the selection is every running server, leading with the player total and
// saying so in those words. The gesture does not. Stop is reversible, and the one verb that isn't —
// uninstall — is excluded from batching entirely, so a typed confirmation here would buy ceremony on
// exactly the emergency the feature exists for.
//
// Everything before the press is a prediction; everything after it is read from the nodes' answers.
// The two are drawn as different screens on purpose: the second one may contradict the first, and
// each node's `refused[]` is the authority for its own servers.

const nodeNameOf = (hosts, hostId) => {
  const h = (hosts || []).find((x) => x.id === hostId);
  return (h && h.name) || hostId || "an unknown node";
};

function plural(n, one, many) { return n === 1 ? one : (many || one + "s"); }

/// "9 servers on 3 nodes". The node count is stated whenever a run crosses more than one, because
/// that is the fact an operator cannot see from a list of names.
function scopeLine(servers) {
  const nodes = new Set(servers.map((s) => s.hostId).filter(Boolean));
  const n = servers.length + " " + plural(servers.length, "server");
  return nodes.size > 1 ? n + " on " + nodes.size + " nodes" : n;
}

function PlayerLine({ players, lead }) {
  if (!players.total && !players.unseen) return null;
  const figure = (players.unseen ? "At least " : "") + players.total + " " + plural(players.total, "player");
  return (
    <div className={"batch-sheet__players" + (lead ? " batch-sheet__players--lead" : "")}>
      <Icon name="users" size={14} strokeWidth={2.2} />
      <span>
        {figure} will be disconnected
        {players.unseen > 0 && (
          <span className="batch-sheet__hedge">
            {" · " + players.unseen + " of these can't report who's connected"}
          </span>
        )}
      </span>
    </div>
  );
}

function ServerRow({ server, hosts, showNode, reason, right }) {
  return (
    <li className="batch-sheet__row">
      <span className="batch-sheet__row-name">{server.name || server.id}</span>
      {showNode && <span className="batch-sheet__row-node"><Icon name="server" size={10} strokeWidth={2.2} />{nodeNameOf(hosts, server.hostId)}</span>}
      {reason && <span className="batch-sheet__row-reason">{reason}</span>}
      {right}
    </li>
  );
}

function BatchPreflight({ verb, servers, onClose }) {
  const hosts = useStore(hostsStore, (s) => s.list);
  const fleet = useStore(serversStore, (s) => s.list);
  const [busy, setBusy] = React.useState(false);
  const [run, setRun] = React.useState(null);

  const def = SERVER_ACTION[verb] || { label: verb, icon: "circle-alert", tone: "update" };
  // Re-read every selected row from the store rather than trusting the snapshot the bar handed over:
  // a server's state can move between opening this sheet and pressing the button, and the partition
  // below is only worth drawing if it is about what is true now.
  const rows = servers.map((s) => fleet.find((f) => f.id === s.id) || s).filter(Boolean);
  const { ready, refused } = partitionSelection(rows, verb);
  const spansNodes = new Set(rows.map((s) => s.hostId).filter(Boolean)).size > 1;
  const players = playersAffected(ready, verb);
  const wholeFleet = (verb === "stop" || verb === "restart") && isWholeFleet(ready, fleet);
  const forecast = capacityForecast(ready, hosts, verb);
  const tight = forecast.tight;

  const fire = () => {
    if (busy || !ready.length) return;
    setBusy(true);
    const selectedIds = selectionStore.getState().ids;
    dispatchRun({ verb, servers: ready, force: tight.length > 0 })
      .then((result) => {
        setRun(result);
        narrowSelectionWhenSettled(result, selectedIds);
      })
      .finally(() => setBusy(false));
  };

  if (run) return <RunResult run={run} hosts={hosts} fleet={fleet} def={def} onClose={onClose} />;

  const title = wholeFleet
    ? def.label + " every running server"
    : def.label + " " + scopeLine(ready);

  return (
    <Modal onClose={busy ? undefined : onClose} canClose={!busy} scrimClassName="k-backdrop">
      <div className="k-modal batch-sheet">
        <div className="k-modal__head">
          <span className={"batch-sheet__glyph batch-sheet__glyph--" + def.tone}><Icon name={def.icon} size={18} strokeWidth={2.2} /></span>
          <span className="k-modal__title">{title}</span>
          <button className="k-modal__close" onClick={onClose} disabled={busy} aria-label="Close"><Icon name="x" size={16} /></button>
        </div>

        <div className="k-modal__body">
          {/* Every running server, and the sentence says so before it says anything else. */}
          {wholeFleet && (
            <div className="batch-sheet__escalate">
              <Icon name="triangle-alert" size={16} strokeWidth={2.2} />
              <div>
                <strong>This is every server that is running.</strong>
                <PlayerLine players={players} lead />
              </div>
            </div>
          )}
          {!wholeFleet && <PlayerLine players={players} />}

          {ready.length > 0 && (
            <section className="batch-sheet__section">
              <h3 className="batch-sheet__h">{scopeLine(ready)} will run</h3>
              <ul className="batch-sheet__list">
                {ready.map((s) => <ServerRow key={s.id} server={s} hosts={hosts} showNode={spansNodes} />)}
              </ul>
            </section>
          )}

          {refused.length > 0 && (
            <section className="batch-sheet__section">
              {/* Predicted here so the sheet can explain itself; each node re-decides on arrival and
                  the result screen reads its answer, which may differ. */}
              <h3 className="batch-sheet__h">{refused.length} won't run</h3>
              <ul className="batch-sheet__list batch-sheet__list--muted">
                {refused.map(({ server, reason }) => (
                  <ServerRow key={server.id} server={server} hosts={hosts} showNode={spansNodes} reason={reason} />
                ))}
              </ul>
            </section>
          )}

          {/* Shown when there is something a single card could not already say. One comfortable start
              gets nothing — that is the card's own rule, and repeating a requirement nobody needs to
              read is noise. Two or more is where the arithmetic itself is the news, because the
              drawdown is invisible from any one row. */}
          {(tight.length > 0 || forecast.measured > 1) && (
            <section className="batch-sheet__section">
              <h3 className="batch-sheet__h">
                <Icon name="gauge" size={13} strokeWidth={2.2} />
                Memory, as this run would consume it
              </h3>
              {/* Figures and no verdict — the same rule the card's hint follows, for the same reason:
                  the requirement is usually a vendor estimate, and an operator who knows a game runs in
                  less is exactly who should override. Each member is judged against what the ones
                  before it have already committed, because MemAvailable lags a process that started
                  two seconds ago. The engine decides at the instant it acts; this is a forecast. */}
              <ul className="batch-sheet__list">
                {forecast.rows.filter((r) => r.hint).map((r) => (
                  <ServerRow
                    key={r.server.id}
                    server={r.server}
                    hosts={hosts}
                    showNode={spansNodes}
                    right={<span className={"batch-sheet__row-fit" + (r.hint.tight ? " is-tight" : "")} title={capacityDetail(r.hint)}>
                      {mb(r.hint.requiredMb)} · {mb(r.hint.freeMb)} free
                    </span>} />
                ))}
              </ul>
              {tight.length > 0 && (
                <p className="batch-sheet__note">
                  {tight.length} of {forecast.measured} would leave the node under its configured floor once the
                  starts before {plural(tight.length, "it", "them")} have taken what they need. Starting anyway is
                  the supported way through — the engine decides for real at the moment it acts.
                </p>
              )}
            </section>
          )}

          {ready.length === 0 && (
            <p className="batch-sheet__note">Nothing in this selection can take {def.label.toLowerCase()} right now.</p>
          )}
        </div>

        <div className="k-modal__foot">
          <button className="k-modal__btn k-modal__btn--secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <span className="batch-sheet__foot-spacer" />
          <button
            className={"k-modal__btn k-modal__btn--primary" + (tight.length ? " k-modal__btn--warned" : "")}
            onClick={fire}
            disabled={busy || !ready.length}>
            <Icon name={tight.length ? "triangle-alert" : def.icon} size={14} strokeWidth={2.4} />
            {busy ? "Dispatching…" : tight.length ? "Start anyway · " + ready.length : def.label + " " + ready.length}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// MB → a short human figure, matching capacity.js's own rounding so the sheet and the card can't
// disagree about one server.
function mb(v) {
  if (v == null) return "—";
  if (v < 1024) return Math.round(v) + " MB";
  const g = v / 1024;
  return (g >= 10 ? Math.round(g) : Math.round(g * 10) / 10) + " GB";
}

/// What the nodes actually said. Reconciled across every response — never assembled from the
/// prediction, and never folding an unreachable node's share in as failures.
function RunResult({ run, hosts, fleet, def, onClose }) {
  const rowFor = (id) => fleet.find((f) => f.id === id) || { id, name: id };
  const spansNodes = run.nodesAsked > 1;
  const partial = run.nodesReached < run.nodesAsked;

  const retry = () => {
    selectionStore.replace(run.undispatched.map((u) => ({ id: u.serverId, hostId: u.hostId })));
    onClose();
  };

  return (
    <Modal onClose={onClose} scrimClassName="k-backdrop">
      <div className="k-modal batch-sheet">
        <div className="k-modal__head">
          <span className={"batch-sheet__glyph batch-sheet__glyph--" + def.tone}><Icon name={def.icon} size={18} strokeWidth={2.2} /></span>
          <span className="k-modal__title">
            {run.admitted.length} {plural(run.admitted.length, "server")} queued
          </span>
          <button className="k-modal__close" onClick={onClose} aria-label="Close"><Icon name="x" size={16} /></button>
        </div>

        <div className="k-modal__body">
          {/* The run is the nodes' now. It survives this tab, so the sheet says so rather than
              pretending the browser is watching it through. */}
          <p className="batch-sheet__note">
            {spansNodes
              ? "Dispatched to " + run.nodesReached + " of " + run.nodesAsked + " nodes. "
              : ""}
            Each node paces its own share and runs it to completion — closing this doesn't stop it.
          </p>

          {partial && (
            <section className="batch-sheet__section">
              {/* Never counted as failed: these commands were never issued. */}
              <h3 className="batch-sheet__h batch-sheet__h--danger">
                <Icon name="plug-zap" size={13} strokeWidth={2.2} />
                {run.undispatched.length} not {def.label.toLowerCase() === "start" ? "started" : "dispatched"}
              </h3>
              <ul className="batch-sheet__list batch-sheet__list--muted">
                {run.undispatched.map((u) => (
                  <ServerRow key={u.serverId} server={rowFor(u.serverId)} hosts={hosts} showNode={spansNodes}
                    reason={nodeNameOf(hosts, u.hostId) + " didn't answer" + (u.err && u.err.message ? " — " + u.err.message : "")} />
                ))}
              </ul>
            </section>
          )}

          {run.refused.length > 0 && (
            <section className="batch-sheet__section">
              <h3 className="batch-sheet__h">{run.refused.length} refused by {plural(new Set(run.refused.map(r => r.hostId)).size, "the node", "their nodes")}</h3>
              <ul className="batch-sheet__list batch-sheet__list--muted">
                {run.refused.map((r) => (
                  <ServerRow key={r.serverId} server={rowFor(r.serverId)} hosts={hosts} showNode={spansNodes} reason={r.reason} />
                ))}
              </ul>
            </section>
          )}
        </div>

        <div className="k-modal__foot">
          {run.undispatched.length > 0 && (
            <button className="k-modal__btn k-modal__btn--secondary" onClick={retry}>
              <Icon name="rotate-cw" size={14} strokeWidth={2.4} />
              Select the {run.undispatched.length} not dispatched
            </button>
          )}
          <span className="batch-sheet__foot-spacer" />
          <button className="k-modal__btn k-modal__btn--primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </Modal>
  );
}

export { BatchPreflight };
