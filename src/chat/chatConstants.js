// chat constants — command metadata, the runnable verbs, and tool labels.
// Separated from chatUtils.js so components can import constants without
// pulling in the heavier pure functions.

// The verbs a proposed command's Run button performs, by handing the token back to the leaf that
// staged it. It is the leaf's ConfirmationKind set minus `blueprint`, which the review card owns
// its own Save for. Nothing here is executed anywhere else — a verb missing from this set renders
// as a proposal with no Run, which is how `update` and `backup` used to read despite the leaf
// having always been able to perform them.
const LEAF_COMMAND_VERBS = new Set([
  "start", "stop", "restart", "update", "backup",
  "install", "uninstall", "set_config", "write_file",
]);
const COMMAND_META = {
  start:      { label: "Start",         icon: "play",      tone: "success" },
  stop:       { label: "Stop",          icon: "square",    tone: "danger" },
  restart:    { label: "Restart",       icon: "rotate-cw", tone: "update" },
  update:     { label: "Update",        icon: "download",  tone: "info" },
  install:    { label: "Install",       icon: "download",  tone: "success" },
  uninstall:  { label: "Uninstall",     icon: "trash-2",   tone: "danger" },
  backup:     { label: "Back up",       icon: "database",  tone: "info" },
  set_config: { label: "Update config", icon: "settings",  tone: "info" },
  write_file: { label: "Update config file", icon: "file-pen", tone: "info" },
};
function commandMeta(verb) {
  return COMMAND_META[verb] || { label: (verb || "Run").replace(/_/g, " "), icon: "zap", tone: "info" };
}

// Greetings for the empty-chat screen. One is drawn at random per conversation so
// opening a new chat feels like being greeted rather than reading a label. Keep them
// short, warm, and free of host/product names — the header's host picker and the
// composer placeholder already say WHICH assistant is answering.
const CHAT_GREETINGS = [
  "Hello, what can I do for you?",
  "Hi there — what can I help with?",
  "What can I do for you today?",
  "Hey — what are we working on?",
  "Ready when you are. What do you need?",
  "Hi! What would you like to do?",
  "Good to see you. What can I help with?",
  "What's on your mind?",
];
function pickGreeting() {
  return CHAT_GREETINGS[Math.floor(Math.random() * CHAT_GREETINGS.length)];
}

// The standing disclosure shown under the composer for the whole conversation, not
// just on the empty screen: conversations are stored server-side (they are the
// assistant's memory AND the corpus its tuning is judged from), so a user should
// never discover after the fact that an administrator can read one back.
const CHAT_PRIVACY_NOTICE =
  "Conversations are saved and may be reviewed by an administrator to improve the assistant.";

// What a conversation with nothing said in it is called.
//
// ⚠ The leaf names every conversation it holds, including this one — `title` on a listing row is never
// null (`kgsm-llm/docs/wire-contract.md`, "A conversation is named by the leaf"). This constant is NOT
// a second opinion about that; it covers the one conversation the leaf has no opinion on yet: the row
// this browser mints between pressing New chat and `/new` answering, and the same row on a leaf too old
// to name it. It has to be the leaf's word, which is why the wire contract states the string rather
// than leaving each side to pick one — two words for one conversation is exactly the bug this replaced.
const NEW_CHAT_TITLE = "New chat";

// What to put on a conversation row. One helper rather than a fallback repeated at each render, so
// there is one answer to "what is this chat called" and no surface can drift from it.
function conversationTitle(convo) {
  return (convo && convo.title) || NEW_CHAT_TITLE;
}

export {
  LEAF_COMMAND_VERBS, CHAT_GREETINGS, CHAT_PRIVACY_NOTICE, COMMAND_META, commandMeta, pickGreeting,
  NEW_CHAT_TITLE, conversationTitle,
};
