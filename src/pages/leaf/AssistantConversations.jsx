// AssistantConversations — the assistant leaf's Conversations tab: pick a person, then a conversation,
// and read it. The transcript itself opens READ-ONLY IN THE ASSISTANT DOCK, so a reviewer sees exactly
// what that person saw, rendered by the very same components — not a second viewer built to drift.
//
// Every conversation is listed, including soft-deleted ones (flagged) and including the synthetic
// `dev`/probe actors: the corpus is what it is, and quietly filtering it would misrepresent what the
// assistant has actually been asked.
//
// There is no write here of any kind. The backend has no admin write — no editing, deleting or
// compacting someone else's conversation — and this surface must not imply one exists.

import React from "react";

import { CardTable } from "../../components/CardTable.jsx";
import { Icon } from "../../components/Icon.jsx";
import { conversationTitle } from "../../chat/chatConstants.js";
import { Toolbar, ToolbarButton, ToolbarCount, ToolbarSearch, ToolbarSpacer } from "../../components/Toolbar.jsx";
import { fmtRelative, parseTs } from "../../lib/formatting.js";
import { fetchAssistantConversations, fetchAssistantReviewUsers } from "../../lib/stores.js";
import { ReviewAuthorityUnavailable, ReviewForbidden, reviewErrorState } from "./reviewAuthority.jsx";

function AssistantConversations({ hostId, onReviewConversation }) {
  const [users, setUsers] = React.useState([]);
  const [state, setState] = React.useState("loading");
  const [selected, setSelected] = React.useState(null);
  const [conversations, setConversations] = React.useState([]);
  const [convState, setConvState] = React.useState("idle");
  const [query, setQuery] = React.useState("");
  const [onlyRatedDown, setOnlyRatedDown] = React.useState(false);
  const [reloadKey, setReloadKey] = React.useState(0);

  React.useEffect(() => {
    if (!hostId) return undefined;
    let cancelled = false;
    setState("loading");
    fetchAssistantReviewUsers(hostId).then(
      (rows) => {
        if (cancelled) return;
        setUsers(rows);
        setState("ready");
        // Open on the most recently active person, so the tab lands on something to read rather than
        // an empty right-hand pane.
        if (rows.length > 0) setSelected(rows[0].userId);
      },
      (e) => { if (!cancelled) setState(reviewErrorState(e)); },
    );
    return () => { cancelled = true; };
  }, [hostId, reloadKey]);

  React.useEffect(() => {
    if (!hostId || !selected) { setConversations([]); return undefined; }
    let cancelled = false;
    setConvState("loading");
    fetchAssistantConversations(hostId, selected).then(
      (rows) => { if (!cancelled) { setConversations(rows); setConvState("ready"); } },
      () => { if (!cancelled) setConvState("error"); },
    );
    return () => { cancelled = true; };
  }, [hostId, selected]);

  const activeUser = users.find(u => u.userId === selected) || null;
  const q = query.trim().toLowerCase();
  let shown = q
    ? conversations.filter(c => (c.title || "").toLowerCase().includes(q))
    : conversations;
  if (onlyRatedDown) shown = shown.filter(c => c.negativeTurns > 0);
  const flagged = conversations.filter(c => c.negativeTurns > 0).length;

  if (state === "loading") {
    return <div className="chat-brief"><div className="chat-brief__empty">Reading who has talked to this assistant…</div></div>;
  }
  if (state === "none") {
    return (
      <div className="chat-brief">
        <div className="chat-brief__empty chat-brief__empty--neutral">
          <div className="chat-brief__empty-title">No assistant on this node</div>
          <div className="chat-brief__empty-sub">This host doesn’t serve an assistant, so there are no conversations to review.</div>
        </div>
      </div>
    );
  }
  if (state === "unavailable") {
    return <ReviewAuthorityUnavailable onRetry={() => setReloadKey(k => k + 1)} />;
  }
  if (state === "forbidden") {
    return <ReviewForbidden />;
  }
  if (state === "error") {
    return (
      <div className="chat-brief">
        <div className="chat-brief__empty chat-brief__empty--neutral">
          <div className="chat-brief__empty-title">Conversations unavailable</div>
          <div className="chat-brief__empty-sub">The assistant didn’t answer for its conversation index.</div>
        </div>
      </div>
    );
  }
  if (users.length === 0) {
    return (
      <div className="chat-brief">
        <div className="chat-brief__empty chat-brief__empty--neutral">
          <div className="chat-brief__empty-title">Nobody has talked to this assistant yet</div>
          <div className="chat-brief__empty-sub">Conversations appear here once someone uses it.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="lcf-body">
      <Toolbar>
        <ToolbarSearch value={query} onChange={setQuery} placeholder="Search conversation titles…" />
        {/* Only offered when there is something to filter TO. A toggle that can only ever empty the
            list is an invitation to conclude the data is broken. */}
        {flagged > 0 && (
          <ToolbarButton
            icon="thumbs-down"
            active={onlyRatedDown}
            onClick={() => setOnlyRatedDown(v => !v)}
            title="Show only conversations with an answer marked unhelpful">
            {"Marked unhelpful (" + flagged + ")"}
          </ToolbarButton>
        )}
        <ToolbarSpacer />
        <ToolbarCount shown={shown.length} total={conversations.length} unit="conversations" />
      </Toolbar>

      <div className="leaf-split">
        <CardTable
          icon="users" title="People" count={users.length}
          columns={[
            {
              key: "user", label: "Person", width: "minmax(0,1.4fr)", sort: r => r.displayName || r.userId,
              render: r => (
                <span>
                  {/* No recorded name means the raw id is shown. A name is never derived from a
                      Discord snowflake — that would be fabricating an identity. */}
                  {r.displayName || <span className="svc-fact svc-fact--unit">{r.userId}</span>}
                  {r.userId === selected && <span className="cluster-chip cluster-chip--ok" style={{ marginLeft: 8 }}>viewing</span>}
                </span>
              ),
            },
            // Chats + recency only. A per-person turn count is real but it is not what anyone picks a
            // person by, and at this width every fixed column is taken straight out of the id.
            { key: "conversationCount", label: "Chats", width: "58px", align: "right", sort: r => r.conversationCount, defaultDir: "desc" },
            {
              key: "lastActivityAt", label: "Last seen", width: "88px", align: "right",
              // The instant, not the "3d ago" the cell renders and not a 0 for someone with
              // no recorded activity.
              sort: r => (r.lastActivityAt ? parseTs(r.lastActivityAt) : null),
              render: r => (r.lastActivityAt ? fmtRelative(parseTs(r.lastActivityAt)) : "—"),
            },
          ]}
          rows={users}
          getKey={r => r.userId}
          onRowClick={r => setSelected(r.userId)}
          rowClass={r => (r.userId === selected ? "is-active" : "")}
          defaultSort={{ key: "lastActivityAt", dir: "desc" }}
          empty="Nobody yet." />

        <CardTable
          icon="messages-square"
          title={activeUser ? "Conversations · " + (activeUser.displayName || activeUser.userId) : "Conversations"}
          count={shown.length}
          columns={[
            {
              key: "title", label: "Conversation", width: "minmax(0,1.8fr)", sort: r => r.title,
              render: r => (
                <span>
                  {conversationTitle(r)}
                  {r.deleted && <span className="cluster-chip cluster-chip--muted" style={{ marginLeft: 8 }}>deleted</span>}
                  {r.errorTurns > 0 && <span className="cluster-chip cluster-chip--danger" style={{ marginLeft: 8 }}>{r.errorTurns} err</span>}
                  {/* An answer this person marked unhelpful. Beside the error chip on purpose: a turn
                      that ran cleanly and still failed its reader is the one a reviewer would otherwise
                      never find, since nothing else in the row is wrong. */}
                  {r.negativeTurns > 0 && (
                    <span className="cluster-chip cluster-chip--danger" style={{ marginLeft: 8 }}>
                      {/* The lucide glyph, not the emoji: an emoji here depends on a font the host may
                          not have, and it rendered as a blank box rather than a thumb. */}
                      <Icon name="thumbs-down" size={11} strokeWidth={2.4} /> {r.negativeTurns}
                    </span>
                  )}
                </span>
              ),
            },
            { key: "turnCount", label: "Turns", width: "58px", align: "right", sort: r => r.turnCount },
            {
              key: "lastActivityAt", label: "Last", width: "88px", align: "right",
              sort: r => (r.lastActivityAt ? parseTs(r.lastActivityAt) : null), defaultDir: "desc",
              render: r => (r.lastActivityAt ? fmtRelative(parseTs(r.lastActivityAt)) : "—"),
            },
          ]}
          rows={shown}
          getKey={r => r.id}
          onRowClick={r => onReviewConversation && onReviewConversation({ ...r, user: activeUser })}
          defaultSort={{ key: "lastActivityAt", dir: "desc" }}
          empty={convState === "loading" ? "Loading…" : convState === "error" ? "Couldn’t read this person’s conversations." : "No conversations."} />
      </div>

    </div>
  );
}

export { AssistantConversations };
