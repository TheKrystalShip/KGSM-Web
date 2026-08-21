// widgets/registry.js — what a widget TYPE is, and the catalog of them.
//
// A registry entry is everything the dashboard needs to reconstruct a card from a saved descriptor
// without the page that normally renders it: which component, what it must be bound to, who may see
// it, how big it wants to be, and what to call it.
//
// THE RULE: an entry points at the component the PAGE renders. There are no widget-only forks. When
// a component cannot be pinned as it stands, that is a fact about the component — a card that only
// works when a specific parent feeds it is a card that is hard to reuse anywhere, and fixing it
// improves its own page too.

const _types = new Map();

/// Register one widget type.
///
///   type      stable key. It is PERSISTED in every layout that uses it, so renaming one orphans
///             those widgets — treat a shipped type name as immutable.
///   label     what the add-widget catalog calls it.
///   icon      lucide name for the catalog and the widget's own header.
///   group     catalog section ("Fleet", "Servers", "Nodes", "Activity").
///   cap       persona capability required to render it. Omit for anything any role may see.
///   scope     which param dimension gates the capability: "host" checks canOn(cap, hostId),
///             "server" resolves the server's host first, absent checks can(cap) fleet-wide.
///   params    the param names this type must be bound to. A descriptor missing one is stale and
///             renders as such rather than mounting a component with an undefined target.
///   describe  (params) => the instance's own title. Two journals differ only by their params, so
///             the title has to be built from them or the dashboard shows the same name twice.
///   size      { w, h, minW, minH } in columns/rows. w is in twelfths.
///   load      () => Promise<Component>. Lazy, so the dashboard's chunk does not contain every
///             page's code — the router already lazy-loads pages for the same reason.
function registerWidget(entry) {
  if (!entry || !entry.type) throw new Error("registerWidget: a type is required");
  if (_types.has(entry.type)) throw new Error("registerWidget: duplicate type " + entry.type);
  _types.set(entry.type, {
    group: "Fleet",
    params: [],
    size: { w: 12, h: 3 },
    ...entry,
  });
  return entry.type;
}

function getWidget(type) {
  return _types.get(type) || null;
}

function hasWidget(type) {
  return _types.has(type);
}

function allWidgets() {
  return [..._types.values()];
}

// The title for one instance: the user's override, else the type's own description of these params,
// else the bare label. A `describe` that throws on a half-bound descriptor must not take the card
// down, so it falls back rather than propagating.
function widgetTitle(entry, descriptor) {
  if (descriptor && descriptor.title) return descriptor.title;
  if (entry && typeof entry.describe === "function") {
    try {
      const t = entry.describe((descriptor && descriptor.params) || {});
      if (t) return t;
    } catch { /* fall through to the label */ }
  }
  return (entry && entry.label) || "Widget";
}

// Is this descriptor bound to everything its type needs? Answers only the SHAPE question — whether
// the named server still exists is a live question the host asks separately.
function paramsComplete(entry, params) {
  if (!entry || !entry.params || !entry.params.length) return true;
  const p = params || {};
  return entry.params.every(k => p[k] != null && p[k] !== "");
}

export { allWidgets, getWidget, hasWidget, paramsComplete, registerWidget, widgetTitle };
