import React from "react";

import { Icon } from "../Icon.jsx";
import { ErrorBoundary } from "../ErrorBoundary.jsx";
import { can, canOn } from "../../lib/persona.js";
import { getWidget, paramsComplete, widgetTitle } from "../../lib/widgets/registry.js";
import { serversStore } from "../../lib/stores.js";

// WidgetHost — everything a pinned card should NOT have to own.
//
// A widget is the same component its page renders, and the point of that is that it stays a
// component: it gets its params and renders. Authorization, a missing target, a crash, the lazy
// boundary, the header, the drag grip and the resize handles are this wrapper's, once, rather than
// each of a hundred cards'.
//
// Four outcomes, and they are deliberately different from one another because they send a person
// somewhere different:
//   • gone       — the widget's type is not in this build. The layout outlived a rename.
//   • forbidden  — the role may not see it. Renders NOTHING and stays in the layout (see below).
//   • stale      — bound to something that no longer exists, or never fully bound.
//   • ready      — mount it.

// ---- WidgetContext -------------------------------------------------------
//
// ⚠ CANON: A COMPONENT DOES NOT BRANCH ON WHERE IT IS MOUNTED.
//
// A card renders and behaves identically on its own page and pinned to the dashboard. Its data is a
// function of its PARAMS — which server, which leaf — and never of its placement: a store is keyed
// by the target, not by the surface reading it, and a component that took a different path as a
// widget would be two components to keep in agreement, diverging the first time one was touched.
//
// So this context exists for the WIDGET SYSTEM'S OWN chrome and nothing else. The one legitimate
// reader is `PinButton`, which suppresses itself inside a widget because a pinned card offering to
// pin itself again is a dead control — that is the pin, not the card. If you find yourself reaching
// for this to make a card look or load differently as a widget, the answer is somewhere else: the
// host draws no chrome of its own outside edit mode, and the grid already blocks pointer events into
// a widget's body while it is being arranged.
const WidgetContext = React.createContext(null);
function useWidgetContext() { return React.useContext(WidgetContext); }
function useIsWidget() { return React.useContext(WidgetContext) != null; }

// ---- Authorization -------------------------------------------------------
// "Aggregate for reach, scoped for action" (persona.js) applies here as everywhere: a widget about
// ONE node asks whether the role holds the capability ON that node, not anywhere. An admin on
// hotrod and a viewer on node-b must not see node-b's journal because hotrod made them an admin
// somewhere.
function widgetPermitted(entry, params) {
  if (!entry || !entry.cap) return true;
  const p = params || {};
  if (entry.scope === "host") return p.hostId ? canOn(entry.cap, p.hostId) : can(entry.cap);
  if (entry.scope === "server") {
    const srv = p.serverId ? serversStore.find(p.serverId) : null;
    // A server we have not loaded yet is not a denial — the roster arrives a moment later, and
    // hiding the widget in the meantime would flash it out and back in on every cold load.
    return srv && srv.hostId ? canOn(entry.cap, srv.hostId) : can(entry.cap);
  }
  return can(entry.cap);
}

// ---- The unavailable states ----------------------------------------------
// One shape for every "there is nothing to render, and here is why". It reuses `proc-unavailable`,
// which the leaf pages already use for exactly this — a surface that cannot answer, saying so.
function WidgetUnavailable({ icon, title, sub, tag, onRemove }) {
  return (
    <div className="widget__unavailable proc-unavailable">
      <span className="proc-unavailable__icon"><Icon name={icon || "circle-help"} size={22} strokeWidth={1.9} /></span>
      <div className="proc-unavailable__title">{title}</div>
      {sub && <div className="proc-unavailable__sub">{sub}</div>}
      {tag && <span className="proc-unavailable__tag"><Icon name="activity" size={12} /> {tag}</span>}
      {onRemove && (
        <button type="button" className="widget__remove-btn" onClick={onRemove}>
          <Icon name="trash-2" size={13} strokeWidth={2} /> Remove from dashboard
        </button>
      )}
    </div>
  );
}

// The lazy component, cached per type so a re-render does not re-import and React.lazy is not
// handed a new component identity every time (which would remount the widget on every parent
// render, dropping a console's scrollback).
const _lazyCache = new Map();
function lazyFor(type, entry) {
  let C = _lazyCache.get(type);
  if (!C) {
    C = React.lazy(() => entry.load().then(m => ({ default: typeof m === "function" ? m : (m.default || m) })));
    _lazyCache.set(type, C);
  }
  return C;
}

function WidgetBody({ entry, descriptor }) {
  const C = lazyFor(descriptor.type, entry);
  return <C {...(descriptor.params || {})} />;
}

/// One widget in the grid.
///
///   descriptor  the stored { i, type, params, w, h, title }
///   editing     the grid is in Customize mode — show the grip and the handles
///   onRemove    unpin this instance
///   onGripDown  pointer-down on the drag grip (the grid owns the drag itself)
///   onResize    pointer-down on a resize handle: (edge, event)
function WidgetHost({ descriptor, editing, onRemove, onGripDown, onResize }) {
  const entry = getWidget(descriptor.type);
  const params = descriptor.params || {};

  // A type this build does not have. Says so and offers removal rather than disappearing — a widget
  // that silently vanishes reads as data loss, and the person cannot tell whether it broke or they
  // imagined pinning it.
  if (!entry) {
    return (
      <div className="widget widget--unavailable">
        <WidgetUnavailable
          icon="puzzle" title="This widget is no longer available"
          sub={"Nothing in this build renders “" + descriptor.type + "”."}
          tag="unknown widget" onRemove={onRemove} />
      </div>
    );
  }

  // Not permitted. Renders NOTHING — not a locked placeholder, which would leak both that the thing
  // exists and what it is called. It stays in the stored layout on purpose: a role is per host and
  // can be restored, and silently dropping widgets on a demotion would mean a re-promoted admin
  // rebuilding their dashboard by hand.
  if (!widgetPermitted(entry, params)) return null;

  const title = widgetTitle(entry, descriptor);

  // Bound to nothing, or half-bound. Distinct from "the server was deleted", which the component
  // itself reports from live data — this one is about the DESCRIPTOR, and no fetch will fix it.
  const incomplete = !paramsComplete(entry, params);

  return (
    <WidgetContext.Provider value={{ type: descriptor.type, params, editing }}>
      <div className={"widget" + (editing ? " widget--edit" : "")} data-widget-type={descriptor.type}>
        <div className="widget__head">
          {editing && (
            <button
              type="button"
              className="widget__grip"
              data-hswipe=""
              aria-label={"Move " + title + " — drag, or use the arrow keys"}
              title="Drag to move"
              onPointerDown={(e) => onGripDown && onGripDown(descriptor.i, e)}
            >
              <Icon name="grip-vertical" size={14} strokeWidth={2} />
            </button>
          )}
          <span className="widget__title">
            {entry.icon && <Icon name={entry.icon} size={12} />} {title}
          </span>
          {editing && onRemove && (
            <button type="button" className="widget__unpin" onClick={onRemove}
              aria-label={"Remove " + title + " from the dashboard"} title="Remove from dashboard">
              <Icon name="x" size={14} strokeWidth={2.2} />
            </button>
          )}
        </div>

        <div className="widget__body">
          {incomplete ? (
            <WidgetUnavailable
              icon="unlink" title="This widget isn't pointed at anything"
              sub={"It needs " + entry.params.join(" and ") + ", which this saved layout doesn't carry."}
              tag="not bound" onRemove={onRemove} />
          ) : (
            <ErrorBoundary
              resetKey={descriptor.i}
              fallback={(reset) => (
                <WidgetUnavailable
                  icon="triangle-alert" title={title + " stopped rendering"}
                  sub="Something in this card threw while drawing. The rest of the dashboard is unaffected."
                  tag="crashed"
                  onRemove={onRemove}
                />
              )}>
              <React.Suspense fallback={<div className="widget__loading"><Icon name="loader-2" size={18} /></div>}>
                <WidgetBody entry={entry} descriptor={descriptor} />
              </React.Suspense>
            </ErrorBoundary>
          )}
        </div>

        {editing && onResize && (
          <>
            <button type="button" className="widget__handle widget__handle--e" data-hswipe=""
              aria-label={"Resize " + title + " horizontally"} title="Drag to resize"
              onPointerDown={(e) => onResize(descriptor.i, "e", e)} />
            <button type="button" className="widget__handle widget__handle--s"
              aria-label={"Resize " + title + " vertically"} title="Drag to resize"
              onPointerDown={(e) => onResize(descriptor.i, "s", e)} />
            <button type="button" className="widget__handle widget__handle--se" data-hswipe=""
              aria-label={"Resize " + title} title="Drag to resize"
              onPointerDown={(e) => onResize(descriptor.i, "se", e)} />
          </>
        )}
      </div>
    </WidgetContext.Provider>
  );
}

export { WidgetContext, WidgetHost, WidgetUnavailable, useIsWidget, useWidgetContext, widgetPermitted };
