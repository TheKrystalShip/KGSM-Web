import { Icon } from "../../components/Icon.jsx";

// DashboardEmpty — a dashboard somebody has cleared.
//
// This is NOT the first-run state: a new account is seeded a layout, so an empty grid means every
// widget was deliberately removed. Both ways back are offered because they answer different
// intentions — "I want to build my own" and "I've made a mess of this".

function DashboardEmpty({ onAdd, onRestore }) {
  return (
    <div className="dash-empty">
      <span className="dash-empty__icon"><Icon name="layout-dashboard" size={28} strokeWidth={1.7} /></span>
      <div className="dash-empty__title">Your dashboard is empty</div>
      <div className="dash-empty__sub">
        Add a widget to start building it, or put the default set back. You can also pin most cards
        straight from the page they live on, while you're browsing.
      </div>
      <div className="dash-empty__cta">
        <button type="button" className="host-btn host-btn--primary" onClick={onAdd}>
          <Icon name="plus" size={14} strokeWidth={2.2} /> Add a widget
        </button>
        <button type="button" className="host-btn host-btn--ghost" onClick={onRestore}>
          <Icon name="rotate-ccw" size={14} strokeWidth={2} /> Restore the defaults
        </button>
      </div>
    </div>
  );
}

export { DashboardEmpty };
