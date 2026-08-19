import React from "react";
import { BriefCard } from "../components/BriefCard.jsx";
import { Icon } from "../components/Icon.jsx";
import { fmtRelative } from "../lib/formatting.js";
import { conversationTitle } from "./chatConstants.js";

// RecentConversations — the fresh-chat screen's "pick up where you left off" card.
//
// The conversation list is already this surface's own state (hydrated from localStorage, merged
// with what the leaf holds), so this renders it rather than fetching anything: the card is a second
// view of the rail, placed where a person who has just opened a new chat is actually looking. It is
// a plain child of the empty state rather than an injected panel, which is what gives the Control
// Panel and the standalone assistant the same card from one place — it reaches only the shared
// BriefCard shell, so nothing here can pull the panel's data layer into the standalone bundle
// (scripts/check-assistant-bundle.mjs).
//
// The row markup is the alerts card's `.chat-brief__item` family verbatim. Two lists that read
// differently on the same screen would look like two features; sharing the classes means a change
// to the card family lands on both at once.

// When a conversation was last touched. The leaf's `lastActivityAt` when it has said, the creation
// time otherwise — never now(), which would sort every unknown conversation to the top and read as
// a timestamp this surface does not have.
function lastTouched(c) { return c.lastActivity || c.created || 0; }

// How many exchanges are in it. The leaf's count when it has said; otherwise what this browser can
// see in the transcript it holds. A conversation that has neither is listed without a count rather
// than with a guessed one.
function turnCount(c) {
  if (typeof c.turns === "number") return c.turns;
  if (Array.isArray(c.messages)) {
    const n = c.messages.filter(m => m && m.role === "user").length;
    if (n > 0) return n;
  }
  return null;
}

// Worth offering. A conversation nobody has said anything in is the screen the person is already
// looking at, so listing one would offer them a second empty chat.
function hasContent(c) {
  const n = turnCount(c);
  return n != null && n > 0;
}

function RecentConversations({ convos, activeId, onPick, max = 3 }) {
  const recent = React.useMemo(() => (convos || [])
    .filter(c => c && c.id !== activeId && hasContent(c))
    .sort((a, b) => lastTouched(b) - lastTouched(a))
    .slice(0, max), [convos, activeId, max]);

  // Nothing to resume: this is a first conversation, and a card saying so would be a card about
  // the absence of the thing it exists to offer.
  if (recent.length === 0) return null;

  return (
    <BriefCard icon="history" title="Recent conversations" action={null}>
      <div className="chat-brief__list">
        {recent.map(c => {
          const turns = turnCount(c);
          const when = lastTouched(c);
          const detail = [
            turns != null ? turns + (turns === 1 ? " message" : " messages") : null,
            when ? fmtRelative(new Date(when)) : null,
          ].filter(Boolean).join(" · ");
          return (
            <div key={c.id} className="chat-brief__item" onClick={() => onPick(c.id)}>
              <span className="chat-brief__icon"><Icon name="message-square" size={14} /></span>
              <div className="chat-brief__body">
                <span className="chat-brief__item-title">
                  <span className="chat-brief__titletext">{conversationTitle(c)}</span>
                </span>
                {detail && <span className="chat-brief__detail">{detail}</span>}
              </div>
              <span className="chat-brief__ask">Resume <Icon name="arrow-right" size={12} strokeWidth={2.2} /></span>
            </div>
          );
        })}
      </div>
    </BriefCard>
  );
}

export { RecentConversations };
