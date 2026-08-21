import React from "react";

import { Icon } from "../../components/Icon.jsx";
import { Modal } from "../../components/Modal.jsx";
import { widgetPermitted } from "../../components/widgets/WidgetHost.jsx";
import { useStore } from "../../lib/store.js";
import { dashboardStore } from "../../lib/widgets/dashboardStore.js";
import { allWidgets } from "../../lib/widgets/registry.js";

// AddWidgetSheet — the catalog of what can go on the dashboard.
//
// Pinning by navigation is the primary route (find a card, pin it), but it is not a discoverable
// one: somebody arriving at an empty dashboard would have to already know where a thing lives in
// order to put it in front of themselves. This is the list that answers "what can I even have".
//
// Types needing PARAMETERS are not offered here. A journal is pinned from the leaf whose journal it
// is — that is where the binding comes from, and asking somebody to pick a node and then a leaf from
// a dropdown would be a worse version of walking to the page. This sheet offers the fleet-wide
// widgets, which are bound to nothing and therefore complete on their own.
//
// Most types are a TOGGLE: the card is either on the dashboard or it is not, and a second copy of
// one catalog would be the same list twice. A `repeatable` type is the exception — two spacers are
// two different spaces — so it stays an Add button however many are already there, and comes off
// through its own remove control in Customize rather than from here.

function AddWidgetSheet({ onClose }) {
  const layout = useStore(dashboardStore, s => s.layout);
  const pinned = React.useMemo(() => new Set(layout.map(w => w.type)), [layout]);

  // Only what this role may actually see, and only what needs no binding.
  const offered = allWidgets()
    .filter(e => !e.hidden)
    .filter(e => !e.params || e.params.length === 0)
    .filter(e => widgetPermitted(e, {}));

  const groups = offered.reduce((acc, e) => {
    (acc[e.group] = acc[e.group] || []).push(e);
    return acc;
  }, {});

  const add = (entry) => dashboardStore.pin(entry.type, {}, entry.size);
  const countOf = (type) => layout.reduce((n, w) => n + (w.type === type ? 1 : 0), 0);

  return (
    <Modal onClose={onClose}>
      <div className="modal widget-catalog">
        <div className="widget-catalog__head">
          <span className="widget-catalog__head-title">
            <Icon name="layout-dashboard" size={16} /> Add a widget
          </span>
          <button type="button" className="widget-catalog__close" onClick={onClose} aria-label="Close">
            <Icon name="x" size={16} strokeWidth={2.2} />
          </button>
        </div>

        <p className="widget-catalog__lede">
          Anything here can sit on your dashboard. Most cards elsewhere in the panel can be pinned
          too — look for the pin on a card's header while you're browsing.
        </p>

        {Object.keys(groups).map(group => (
          <div className="widget-catalog__group" key={group}>
            <div className="widget-catalog__group-title">{group}</div>
            <div className="widget-catalog__items">
              {groups[group].map(entry => {
                const already = !entry.repeatable && pinned.has(entry.type);
                const many = entry.repeatable ? countOf(entry.type) : 0;
                return (
                  <button
                    type="button"
                    key={entry.type}
                    className={"widget-catalog__item" + (already ? " widget-catalog__item--on" : "")}
                    onClick={() => already ? dashboardStore.unpinTarget(entry.type, {}) : add(entry)}
                  >
                    <span className="widget-catalog__icon"><Icon name={entry.icon || "square"} size={16} /></span>
                    <span className="widget-catalog__label">
                      {entry.label}
                      {many > 0 && <span className="widget-catalog__count">{"\u00d7" + many}</span>}
                    </span>
                    <span className="widget-catalog__state">
                      {already
                        ? <><Icon name="check" size={13} strokeWidth={2.4} /> On</>
                        : <><Icon name="plus" size={13} strokeWidth={2.4} /> Add</>}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {offered.length === 0 && (
          <div className="widget-catalog__empty">
            There are no widgets available to your account.
          </div>
        )}

        <div className="widget-catalog__foot">
          <button type="button" className="host-btn host-btn--ghost" onClick={onClose}>Done</button>
        </div>
      </div>
    </Modal>
  );
}

export { AddWidgetSheet };
