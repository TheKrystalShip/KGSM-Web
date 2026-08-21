// Spacer — deliberate empty room on the dashboard.
//
// The grid is a flow: order is position, and a gap exists only as a CONSEQUENCE of a widget being
// too wide for what is left of its row. That makes one thing inexpressible — leaving a hole on
// purpose — because the flow closes any space nothing occupies. This occupies it.
//
// It renders nothing, which is the entire point: at rest it is invisible, and the dashboard simply
// has a hole where it sits. Only in Customize does it need to be visible enough to grab, and that
// outline is drawn by the widget host's own `.widget--edit` state in kit/widgets.css — this
// component does not know or ask whether it is being arranged, in keeping with the canon that a
// component never branches on where it is mounted.
//
// `aria-hidden`, because there is nothing here to announce. The grip and the remove button in edit
// mode carry their own labels, so it stays reachable without a pointer.
function Spacer() {
  return <div className="widget-spacer" aria-hidden="true" />;
}

export { Spacer };
export default Spacer;
