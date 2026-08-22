import React from "react";
import { Icon } from "../Icon.jsx";
import { BatchPreflight } from "./BatchPreflight.jsx";
import { partitionSelection } from "./preflight.js";
import { SERVER_ACTION } from "../ServerActions.jsx";
import { useStore } from "../../lib/store.js";
import { selectionStore, serversStore } from "../../lib/stores.js";

// SelectionBar — what is picked, and the four verbs that can be applied to it.
//
// It appears only when something is selected, because an always-present strip would charge the whole
// page for a gesture most visits never make. "Select all N matching" lives in the toolbar instead, for
// the opposite reason: it is how a selection STARTS, and a control that only appears once you have
// selected something cannot be the thing that starts one.
//
// A verb whose selection contains nothing it can run against is disabled and says how it counted. That
// is the same partition the preflight sheet draws, run early — a sheet that opens only to say "nothing
// in this selection can take stop" is a click spent on an answer the bar already had.

const VERBS = ["start", "stop", "restart", "update"];

function SelectionBar() {
  const ids = useStore(selectionStore, (s) => s.ids);
  const fleet = useStore(serversStore, (s) => s.list);
  // The sheet holds the servers it was OPENED with. A settled run narrows the selection, and a run
  // that settles on arrival — every member refused — would otherwise empty the selection and take the
  // result screen down with it before anyone had read it.
  const [sheet, setSheet] = React.useState(null);

  const rows = React.useMemo(
    () => ids.map((id) => fleet.find((f) => f.id === id)).filter(Boolean),
    [ids, fleet],
  );
  const nodes = React.useMemo(
    () => new Set(rows.map((s) => s.hostId).filter(Boolean)).size,
    [rows],
  );
  const readyCounts = React.useMemo(() => {
    const out = {};
    for (const verb of VERBS) out[verb] = partitionSelection(rows, verb).ready.length;
    return out;
  }, [rows]);

  return (
    <>
      {ids.length > 0 && (
      <div className="sel-bar" role="region" aria-label="Selected servers">
        <span className="sel-bar__count">
          <Icon name="check-check" size={14} strokeWidth={2.4} />
          {ids.length} selected
          {/* The node count is stated whenever the selection crosses more than one: the work is owned
              by the nodes, and a run that spans three of them is three batches. */}
          {nodes > 1 && <span className="sel-bar__nodes">on {nodes} nodes</span>}
        </span>

        <span className="sel-bar__verbs">
          {VERBS.map((verb) => {
            const def = SERVER_ACTION[verb];
            const n = readyCounts[verb];
            return (
              <button
                key={verb}
                type="button"
                className={"sel-bar__verb sel-bar__verb--" + def.tone}
                disabled={n === 0}
                title={n === 0
                  ? "Nothing in this selection can " + def.label.toLowerCase() + " right now"
                  : def.label + " " + n + " of " + ids.length}
                onClick={() => setSheet({ verb, servers: rows })}>
                <Icon name={def.icon} size={13} strokeWidth={2.2} />
                {def.label}
                <span className="sel-bar__verb-n">{n}</span>
              </button>
            );
          })}
        </span>

        <span className="sel-bar__spacer" />
        <button type="button" className="sel-bar__clear" onClick={() => selectionStore.clear()}>
          <Icon name="x" size={13} strokeWidth={2.4} />
          Clear
        </button>
      </div>
      )}

      {sheet && (
        <BatchPreflight verb={sheet.verb} servers={sheet.servers} onClose={() => setSheet(null)} />
      )}
    </>
  );
}

export { SelectionBar };
