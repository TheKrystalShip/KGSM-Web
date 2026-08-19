// ChatHistory — conversation list as a portaled popover, matching the host
// switcher / account menus. Opens from the header's history button.

import React from "react";
import { createPortal } from "react-dom";
import { Icon } from "../components/Icon.jsx";
import { usePortalPopover } from "../hooks/usePortalPopover.js";
import { conversationTitle } from "./chatConstants.js";

function ChatHistory({ convos, activeId, onPick, onDelete, onOpen, loading }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  const { pos, menuRef } = usePortalPopover(open, setOpen, ref);
  const toggle = () => setOpen(o => { const next = !o; if (next && onOpen) onOpen(); return next; });
  return (
    <div className="chat-hist" ref={ref}>
      <button className={"chat-headbtn" + (open ? " chat-headbtn--on" : "")} onClick={toggle} title="Chat history" aria-label="Chat history" aria-haspopup="menu" aria-expanded={open}>
        <Icon name="history" size={16} />
      </button>
      {open && pos && createPortal(
        <div className="chat-hist__menu" role="menu" ref={menuRef} style={pos}>
          <div className="chat-hist__head">
            <span className="chat-hist__head-label">Chat history</span>
          </div>
          <div className="chat-hist__list">
            {convos.length === 0 && !loading && <div className="chat-rail__empty">No conversations yet.</div>}
            {convos.map(c => (
              <div key={c.id}
                className={"chat-rail__item" + (c.id === activeId ? " chat-rail__item--active" : "")}
                onClick={() => { onPick(c.id); setOpen(false); }}>
                <Icon name="message-square" size={14} />
                <span className="chat-rail__title">{conversationTitle(c)}</span>
                <button className="chat-rail__del" onClick={(e) => onDelete(c.id, e)} title="Delete">
                  <Icon name="trash-2" size={13} />
                </button>
              </div>
            ))}
            {loading && (
              <div className="chat-rail__empty" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                <span className="oauth-spinner"></span> Loading chat history…
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

export { ChatHistory };
