import React from "react";

import { Icon } from "../components/Icon.jsx";
import { Modal } from "../components/Modal.jsx";

// FirstRunWelcome — the one-time tour of what the dashboard can do.
//
// The dashboard is composed rather than fixed, and nothing on screen says so: a person who never
// presses Customize sees a page that looks exactly like a page. Five cards, each one line of text
// over a small animation of the gesture it describes, because a wall of instructions is a wall
// people skip. Everything here is drawn from divs — no images, no assets to ship or fail to load.
//
// WHEN IT SHOWS: mounted by the shell inside the app frame, which is past every gate — the sign-in
// screen, the "waiting for approval" screen, the add-a-host screen, the cold-start failure and the
// boot landing all return before it. So it appears only for somebody who is signed in, approved,
// and one render away from the dashboard, never mid-login.
//
// SHOWN ONCE. The key is new, so everybody with an existing session sees it once on their next
// visit. Dismissing counts as done — re-showing a modal somebody has closed, on every load, teaches
// them to close it faster rather than to read it. Clearing site data brings it back.
//
// The key is VERSIONED. Bump it to re-show the tour after the mechanics change; the old key is
// then simply a different key, and nobody has it.
const SEEN_KEY = "krystal:welcome:v1";

function hasSeenWelcome() {
  try { return localStorage.getItem(SEEN_KEY) === "1"; } catch { return true; }
}
function markWelcomeSeen() {
  // Storage blocked or full is not a reason to trap somebody in a tour — fail to "seen".
  try { localStorage.setItem(SEEN_KEY, "1"); } catch { /* best effort */ }
}

// ---- The stages ----------------------------------------------------------
// Each is a small mock dashboard, animated in CSS. They are decorative: `aria-hidden`, so a screen
// reader gets the heading and the sentence and skips the diagram, which describes a mouse gesture it
// has no use for. Every animation honours prefers-reduced-motion (kit/welcome.css).

function Frame({ children, className = "" }) {
  return (
    <div className={"wtour__stage " + className} aria-hidden="true">
      <div className="wtour__win">
        <span className="wtour__winbar">
          <i /><i /><i />
        </span>
        {children}
      </div>
    </div>
  );
}

// A grid of cards assembling — the dashboard is a set of parts, not one page.
const StageIntro = () => (
  <Frame className="wtour__stage--intro">
    <div className="wtour__grid">
      {[0, 1, 2, 3, 4, 5].map(i => (
        <span key={i} className={"wtour__card wtour__card--in wtour__card--d" + i} />
      ))}
    </div>
  </Frame>
);

// Customize → Add widget → a new card lands in the grid.
const StageAdd = () => (
  <Frame>
    <div className="wtour__toolbar">
      <span className="wtour__btn wtour__btn--accent">
        <Icon name="plus" size={9} strokeWidth={2.6} /> Add
      </span>
    </div>
    <div className="wtour__grid">
      <span className="wtour__card" />
      <span className="wtour__card" />
      <span className="wtour__card wtour__card--appear" />
      <span className="wtour__card" />
      <span className="wtour__card" />
      <span className="wtour__card wtour__card--ghost" />
    </div>
    <span className="wtour__cursor wtour__cursor--add"><Icon name="mouse-pointer-2" size={13} /></span>
  </Frame>
);

// One card lifts by its grip and lands in another slot.
const StageMove = () => (
  <Frame>
    <div className="wtour__grid">
      <span className="wtour__card wtour__card--lift"><i className="wtour__grip" /></span>
      <span className="wtour__card wtour__card--shift" />
      <span className="wtour__card" />
      <span className="wtour__card" />
      <span className="wtour__card" />
      <span className="wtour__card" />
    </div>
    <span className="wtour__cursor wtour__cursor--move"><Icon name="mouse-pointer-2" size={13} /></span>
  </Frame>
);

// A card's edge is pulled and it widens.
const StageResize = () => (
  <Frame>
    <div className="wtour__grid wtour__grid--resize">
      <span className="wtour__card wtour__card--grow"><i className="wtour__handle" /></span>
      <span className="wtour__card wtour__card--squeeze" />
      <span className="wtour__card" />
      <span className="wtour__card" />
    </div>
    <span className="wtour__cursor wtour__cursor--resize"><Icon name="mouse-pointer-2" size={13} /></span>
  </Frame>
);

// A pin on a card elsewhere in the panel, and the card arriving on the dashboard.
const StagePin = () => (
  <Frame>
    <div className="wtour__page">
      <span className="wtour__pagecard">
        <i className="wtour__pin"><Icon name="pin" size={9} strokeWidth={2.4} /></i>
      </span>
    </div>
    <span className="wtour__fly" />
    <div className="wtour__grid wtour__grid--pin">
      <span className="wtour__card" />
      <span className="wtour__card" />
      <span className="wtour__card wtour__card--landed" />
      <span className="wtour__card" />
    </div>
  </Frame>
);

// ---- The steps -----------------------------------------------------------
// One line each. The animation carries the "how"; the sentence only has to name the thing and say
// where it lives.
const STEPS = [
  {
    icon: "layout-dashboard",
    title: "Your dashboard is yours",
    body: "It is built from widgets you choose. Here is how to arrange it.",
    stage: StageIntro,
  },
  {
    icon: "plus",
    title: "Add what you want",
    body: "Press Customize, then Add widget.",
    stage: StageAdd,
  },
  {
    icon: "grip-vertical",
    title: "Move it anywhere",
    body: "In Customize, drag a widget by its grip.",
    stage: StageMove,
  },
  {
    icon: "move-horizontal",
    title: "Size it how you like",
    body: "Pull a widget's edge or corner.",
    stage: StageResize,
  },
  {
    icon: "pin",
    title: "Pin from anywhere",
    body: "Most cards in the panel have a pin. It sends that card here.",
    stage: StagePin,
  },
];

function FirstRunWelcome({ user, onClose }) {
  const [step, setStep] = React.useState(0);
  const last = step === STEPS.length - 1;
  const S = STEPS[step];
  const Stage = S.stage;

  const done = React.useCallback(() => { markWelcomeSeen(); onClose(); }, [onClose]);
  const next = () => (last ? done() : setStep(s => s + 1));
  const back = () => setStep(s => Math.max(0, s - 1));

  // Arrow keys walk the tour. Escape is the Modal's, and lands on the same `done`, so every way out
  // records it as seen — a dismissal is a decision, and re-showing this on the next load would teach
  // people to close it faster rather than to read it.
  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key === "ArrowRight") { e.preventDefault(); next(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); back(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const name = (user && (user.display || user.name)) || null;

  return (
    <Modal onClose={done} scrimClassName="modal-scrim wtour__scrim">
      <div className="modal wtour" role="dialog" aria-modal="true" aria-labelledby="wtour-title">
        <button type="button" className="wtour__close" onClick={done} aria-label="Close">
          <Icon name="x" size={16} strokeWidth={2.2} />
        </button>

        {/* The greeting is on the first card only — repeating somebody's name five times is not
            warmth, it is a mail merge. */}
        {step === 0 && (
          <div className="wtour__hello">{name ? "Welcome aboard, " + name : "Welcome aboard"}</div>
        )}

        <Stage key={step} />

        <div className="wtour__copy">
          <div className="wtour__title" id="wtour-title">
            <Icon name={S.icon} size={15} strokeWidth={2.2} /> {S.title}
          </div>
          <p className="wtour__body">{S.body}</p>
        </div>

        <div className="wtour__foot">
          <div className="wtour__dots" role="tablist" aria-label="Tour steps">
            {STEPS.map((s, i) => (
              <button
                key={s.title}
                type="button"
                role="tab"
                aria-selected={i === step}
                aria-label={s.title}
                className={"wtour__dot" + (i === step ? " wtour__dot--on" : "")}
                onClick={() => setStep(i)}
              />
            ))}
          </div>
          <div className="wtour__actions">
            {step > 0 && (
              <button type="button" className="host-btn host-btn--ghost" onClick={back}>Back</button>
            )}
            {!last && (
              <button type="button" className="wtour__skip" onClick={done}>Skip</button>
            )}
            <button type="button" className="host-btn host-btn--primary" onClick={next}>
              {last ? "Get started" : "Next"}
              {!last && <Icon name="arrow-right" size={13} strokeWidth={2.4} />}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export { FirstRunWelcome, hasSeenWelcome, markWelcomeSeen, SEEN_KEY };
