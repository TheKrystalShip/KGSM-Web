import React from "react";
import { Icon } from "./Icon.jsx";
import { sortByAccessor } from "../lib/sorting.js";

// CardTable — tabular data dressed in the shared briefing-card chrome. It
// reuses .chat-brief for the frame + header, so a table sits in the same card
// family as Alerts and Recent activity (titled header, count pill, optional
// "View all →"). One fixed grid template drives the column-header row AND every
// body row, so cells line up regardless of content.
//
// Generic on purpose — first used by the diagnostics "Processes" panel, but
// built to be reused for any compact, headered table.
//
//   columns: [{ key, label, width, align, render(row), sort(row) }]
//     width  — any CSS grid track ("minmax(0,1.7fr)", "56px"); default "1fr".
//     align  — "right" or "center" aligns the header + cells (tabular
//              numerals); default is left.
//     render — returns the cell node; without it the cell shows row[key].
//     sort   — value accessor that makes the column sortable: returns the
//              VALUE to order by — a number, a Date, or a string — never the
//              text the cell renders. Columns without it have no sort control.
//              `lib/sorting.js` owns the rules, including the one worth knowing
//              at the call site: return null (or a Date, or the raw number) for
//              a value the backend didn't measure, NOT a 0 or a "" standing in
//              for it. Missing rows sink to the bottom in both directions.
//   rows:    array of records. Pass getKey(row) for a stable React key
//            (falls back to row.id, then the index).
//   defaultSort: { key, dir } — initial ordering ("asc" | "desc").
//   rowClass(row): optional — extra className appended to that row's element
//                  (e.g. tint a "stuck" process row). Purely additive.
//   onRowClick(row): optional — makes rows selectable. The handler receives the
//                  ROW RECORD, not an index, because the table sorts internally:
//                  anything resolving a click by position would silently pick the
//                  wrong record the moment a column header is used. Omitted by
//                  every consumer that doesn't want click behaviour, and the
//                  clickable affordance only appears when it is supplied.
//   max:     cap the number of rows shown AFTER sorting (so "show the top N by
//            whatever column is active" works); omit to show every row.
//
// The card header (title / count / "View all") is only rendered when at least
// one of title, count, or onViewAll is given — pass none to get a bare table
// (just column heads + rows) that can sit under an external toolbar.
function CardTable({ icon, title, count, pin, onViewAll, viewAllLabel = "View all", columns, rows = [], getKey, max, defaultSort = null, rowClass, onRowClick, empty = "Nothing to show" }) {
  const [sort, setSort] = React.useState(defaultSort);
  const template = columns.map(c => c.width || "1fr").join(" ");
  const keyFor = (row, i) => (getKey ? getKey(row) : (row.id != null ? row.id : i));

  const toggleSort = (col) => {
    if (!col.sort) return;
    setSort(prev =>
      (prev && prev.key === col.key)
        ? { key: col.key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key: col.key, dir: col.defaultDir || "desc" });
  };

  const ordered = React.useMemo(() => {
    let r = rows;
    if (sort) {
      const col = columns.find(c => c.key === sort.key);
      if (col && col.sort) r = sortByAccessor(rows, col.sort, sort.dir);
    }
    return max != null ? r.slice(0, max) : r;
  }, [rows, sort, columns, max]);

  return (
    <div className="chat-brief card-table">
      {(title != null || count != null || onViewAll || pin) && (
        <div className="chat-brief__head">
          <span className="chat-brief__title">
            {icon && <Icon name={icon} size={13} />}{title}
            {count != null && <span className="chat-brief__count chat-brief__count--neutral">{count}</span>}
          </span>
          {pin}
          {onViewAll && (
            <button className="dash-section__more" onClick={onViewAll}>
              {viewAllLabel} <Icon name="arrow-right" size={11} strokeWidth={2.2} />
            </button>
          )}
        </div>
      )}
      <div className="card-table__head" style={{ gridTemplateColumns: template }}>
        {columns.map(c => {
          const active = sort && sort.key === c.key;
          const cls = "card-table__th" + (c.align ? " card-table__th--" + c.align : "");
          if (!c.sort) return <span key={c.key} className={cls}>{c.label}</span>;
          // The glyph carries the DIRECTION, and an unsorted column draws neither arrow. A
          // column that renders mixed units ("27.0 s" over "878 ms") is unreadable without
          // it: told which way the column runs, that order is obvious, and left to guess,
          // the honest reading is that the table sorted the text.
          const dirLabel = active ? (sort.dir === "asc" ? " (ascending)" : " (descending)") : "";
          return (
            <button
              key={c.key}
              type="button"
              className={cls + " card-table__th--sort" + (active ? " is-active" : "")}
              onClick={() => toggleSort(c)}
              title={"Sort by " + c.label + dirLabel}
              aria-label={"Sort by " + c.label + dirLabel}>
              <span className="card-table__th-label">{c.label}</span>
              <Icon
                name={!active ? "chevrons-up-down" : sort.dir === "asc" ? "chevron-up" : "chevron-down"}
                size={12} strokeWidth={2.4} className="card-table__sort-ico" />
            </button>
          );
        })}
      </div>
      <div className="card-table__body">
        {ordered.length === 0 ? (
          <div className="card-table__empty">{empty}</div>
        ) : ordered.map((row, i) => (
          <div
            className={"card-table__row" + (rowClass ? " " + rowClass(row) : "") + (onRowClick ? " card-table__row--click" : "")}
            key={keyFor(row, i)}
            style={{ gridTemplateColumns: template }}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            role={onRowClick ? "button" : undefined}
            tabIndex={onRowClick ? 0 : undefined}
            onKeyDown={onRowClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onRowClick(row); } } : undefined}>
            {columns.map(c => (
              <span key={c.key} className={"card-table__cell" + (c.align ? " card-table__cell--" + c.align : "")}>
                {c.render ? c.render(row) : row[c.key]}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export { CardTable };
