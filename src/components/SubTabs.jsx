import { Icon } from "./Icon.jsx";

// SubTabs — the shared in-page section switcher (desktop button strip + a mobile
// <select>). Used by the server-detail tabs (App.jsx) and the host diagnostics
// deep-dive (DiagnosticsPage.jsx). Lives here, not inlined in either, so the two
// can't drift and neither has to import the other (the diagnostics page is imported
// BY App, so pulling SubTabs from App would be a circular import — this was the
// "SubTabs is not defined" crash the host deep-dive hit once it rendered with
// real telemetry).
// A tab may carry an optional `title` for a hover hint (the leaf config page puts each leaf's
// role there). Everything else is unchanged.
export function SubTabs({ tabs, active, onChange }) {
  const current = tabs.find(t => t.id === active) || tabs[0];
  return (
    <>
      <div className="subtabs">
        {tabs.map(t => (
          <button key={t.id}
            className={"subtab" + (t.id === active ? " subtab--active" : "")}
            onClick={() => onChange(t.id)}
            title={t.title}>
            <Icon name={t.icon} size={14} />
            {t.label}
            {t.badge > 0 && <span className={"subtab__badge subtab__badge--" + (t.badgeTone || "info")}>{t.badge}</span>}
          </button>
        ))}
      </div>
      <label className="subtabs-mobile" aria-label="Section">
        <Icon name={current.icon} size={16} />
        <span className="subtabs-mobile__label">{current.label}</span>
        {/* The badge's noun is the tab's own, because a badge counts whatever that tab holds — alerts
            on one page and unanswered offers on another, and "2 alerts" over a list of offers would
            name something that is not there. */}
        <select value={active} onChange={e => onChange(e.target.value)}>
          {tabs.map(t => (
            <option key={t.id} value={t.id}>
              {t.label}
              {t.badge ? " · " + t.badge + " " + (t.badgeNoun || "alert") + (t.badge === 1 ? "" : "s") : ""}
            </option>
          ))}
        </select>
        <Icon name="chevron-down" size={16} />
      </label>
    </>
  );
}
