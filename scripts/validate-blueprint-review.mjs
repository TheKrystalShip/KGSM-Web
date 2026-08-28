// Frame + adapter unit check for the in-chat blueprint-REVIEW checkpoint (assistant-
// blueprint-review-plan.md P2): the mandatory Monaco review card, its Save/finalize round-trip,
// and the repair-exhaustion re-edit loop. No live backend — this drives the SPA's OWN pure
// functions (chatUtils.reduceTurnFrame / adaptResultCard / adaptBlueprintConfirm) with SYNTHETIC
// frames + a synthetic /confirm response and asserts on the resulting state. Same seam + jsdom
// harness as validate-blueprint-progress.mjs (this repo has no jest/vitest — CLAUDE.md).
//
// Wire contract (reconciled against kgsm-llm SseTurnWriter + Program.cs /confirm):
//  - A DraftReady drafts TWO turn frames: a create_blueprint tool.result (outcome "draftReady")
//    AND a command.proposed (verb "blueprint"). Only the command.proposed carries the confirmation
//    TOKEN, so IT drives the editable card; the tool.result twin is SUPPRESSED (adaptResultCard →
//    null) so the draft renders once. The frame's `configValue` is the draft YAML; `instanceName`
//    is the game; `subject.id` is the slug.
//  - Save POSTs { token, editedContent } → the assistant re-validates + test-installs + verifies,
//    returning ConfirmResponse { text, success, card, confirmations }. `card.data.outcome` is the
//    authority: "verified" (+success) is the only catalog win; "draftReady" comes back with a fresh
//    token (confirmations[0]) + boot `evidence` for a second edit; anything else is honest failure.
//
//   Usage: node scripts/validate-blueprint-review.mjs
import { createServer } from "vite";
import { JSDOM } from "jsdom";

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: "http://localhost:5173/", pretendToBeVisual: true,
});
const w = dom.window;
globalThis.window = w;
for (const k of ["document", "localStorage", "sessionStorage", "HTMLElement", "Node", "getComputedStyle", "DOMParser", "Event", "CustomEvent", "navigator", "location", "history"]) {
  try { if (!globalThis[k]) globalThis[k] = w[k]; } catch {}
}
w.matchMedia = w.matchMedia || ((q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let fail = 0;
const assert = (cond, label) => { console.log(`${cond ? "✓" : "✗"} ${label}`); if (!cond) fail++; };

const DRAFT_YAML = "name: mindustry\nruntime: native\nports:\n  - { start: 6567, end: 6567, protocol: udp }\nexecutable_file: server.sh\n";

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
try {
  const { reduceTurnFrame, adaptResultCard, adaptBlueprintConfirm } =
    await vite.ssrLoadModule("/src/pages/chat/chatUtils.jsx");

  const feed = (messages, frames) => frames.reduce((m, ev) => reduceTurnFrame(m, ev), messages);
  const seed = (prompt) => [{ role: "user", content: prompt }, { role: "assistant", content: "" }];

  // ---------- 1) DraftReady → interactive card driven by command.proposed, tool.result suppressed ----------
  console.log("\n→ DraftReady renders once, as the editable review card\n");
  const draftFrames = [
    { type: "tool.start", id: "tc_1", tool: "create_blueprint" },
    { type: "progress", tool: "create_blueprint", key: "research", label: "Looking it up online…", status: "active" },
    { type: "progress", tool: "create_blueprint", key: "draft", label: "Building a config…", status: "active" },
    // The tool.result twin — MUST be suppressed (it lacks the token; the command.proposed drives the card).
    { type: "tool.result", id: "tc_1", tool: "create_blueprint", summary: "drafted", result: {
      tool: "create_blueprint", confidence: "possible",
      subject: { kind: "blueprint", id: "mindustry" },
      data: { outcome: "draftReady", game: "Mindustry", draftYaml: DRAFT_YAML, editable: true },
    } },
    // The command.proposed — the real card driver: token + the draft YAML in configValue.
    { type: "command.proposed", id: "cmd_0", verb: "blueprint",
      subject: { resource: "server", id: "mindustry" }, instanceName: "Mindustry",
      token: "tok-draft-1", configValue: DRAFT_YAML },
    { type: "text.delta", text: "I drafted a starting config — review it and save when ready." },
    { type: "done", text: "I drafted a starting config — review it and save when ready." },
  ];
  const draftMsgs = feed(seed("Can you add Mindustry?"), draftFrames);
  const bpCmd = draftMsgs.find(m => m.role === "command" && m.verb === "blueprint");
  const bubble = draftMsgs.find(m => m.role === "assistant");

  assert(!!bpCmd, "a blueprint command message is spliced in from command.proposed");
  assert(bpCmd && bpCmd.token === "tok-draft-1", "it carries the confirmation token");
  assert(bpCmd && bpCmd.draftYaml === DRAFT_YAML, "it carries the draft YAML (from configValue) as the editor seed");
  assert(bpCmd && bpCmd.instanceName === "Mindustry", "it carries the game display name");
  assert(bpCmd && bpCmd.subjectId === "mindustry", "it carries the slug (subject.id)");
  assert(bpCmd && bpCmd.bpState === "proposed", "it starts at the review checkpoint (bpState 'proposed')");
  assert(!bpCmd.evidence, "no boot evidence on the initial review (only on the re-edit loop)");
  const promoted = (bubble && bubble.cards) || [];
  assert(!promoted.some(c => c && c.kind === "blueprintOutcome"),
    "the tool.result draftReady twin is SUPPRESSED — no dead 'couldn’t add' outcome card");

  // adaptResultCard directly: draftReady → null; a terminal outcome still maps to a card.
  assert(adaptResultCard({ tool: "create_blueprint", subject: { id: "x" }, data: { outcome: "draftReady", game: "X", draftYaml: "y" } }) === null,
    "adaptResultCard: outcome='draftReady' returns null (suppressed)");
  assert((adaptResultCard({ tool: "create_blueprint", subject: { id: "x" }, data: { outcome: "verified", game: "X", proofLine: "booted" } }) || {}).kind === "blueprintOutcome",
    "adaptResultCard: a terminal 'verified' still maps to a blueprintOutcome card (regression)");

  // ---------- 1b) A revise_blueprint draft supersedes the prior open draft ----------
  console.log("\n→ A new draft (revise) retires the earlier one to read-only 'superseded'\n");
  const revisedFrames = [
    { type: "command.proposed", id: "cmd_1", verb: "blueprint",
      subject: { resource: "server", id: "mindustry" }, instanceName: "Mindustry",
      token: "tok-draft-2", configValue: DRAFT_YAML + "\nmetadata:\n  max_players: 8\n" },
    { type: "done", text: "Updated the draft with max players." },
  ];
  // A real second turn appends a fresh user + assistant bubble before the frames stream in (sendLive).
  const revisedMsgs = feed([...draftMsgs, { role: "user", content: "set max players to 8" }, { role: "assistant", content: "" }], revisedFrames);
  const bpCards = revisedMsgs.filter(m => m.role === "command" && m.verb === "blueprint");
  assert(bpCards.length === 2, "the revised draft is a NEW card (two blueprint cards now)");
  const oldCard = bpCards.find(m => m.token === "tok-draft-1");
  const newCard = bpCards.find(m => m.token === "tok-draft-2");
  assert(oldCard && oldCard.bpState === "superseded", "the earlier draft is retired to 'superseded' (read-only, no buttons)");
  assert(newCard && newCard.bpState === "proposed", "the new draft is the live editable one ('proposed')");

  // ---------- 2) Save → verified (the happy path) ----------
  console.log("\n→ Save finalizes to a verified catalog win\n");
  const verifiedResp = {
    text: "Mindustry is now in the catalog.", success: true,
    card: { tool: "create_blueprint", confidence: "confirmed",
      subject: { kind: "blueprint", id: "mindustry" },
      data: { outcome: "verified", game: "Mindustry", proofLine: "booted and answered on port 6567" } },
    confirmations: null,
  };
  const v = adaptBlueprintConfirm(verifiedResp);
  assert(v.state === "verified", "verified response → state 'verified'");
  assert(v.slug === "mindustry", "verified: slug from subject.id (drives 'Make me a server')");
  assert(v.displayName === "Mindustry", "verified: displayName from data.game");
  assert(v.proof === "booted and answered on port 6567", "verified: proof from data.proofLine");

  // ---------- 3) Save → repair exhausted → editable re-edit with a fresh token + boot evidence ----------
  console.log("\n→ Repair exhaustion loops back to an editable card (re-edit loop)\n");
  const REPAIRED_YAML = DRAFT_YAML + "startup_success_regex: 'Server loaded'\n";
  const reEditResp = {
    text: "It didn’t boot cleanly — tweak it and try again.", success: false,
    card: { tool: "create_blueprint", confidence: "possible",
      subject: { kind: "blueprint", id: "mindustry" },
      data: { outcome: "draftReady", game: "Mindustry", draftYaml: REPAIRED_YAML,
        evidence: "[boot] loading world…\n[boot] FATAL: no valid save\n", editable: true } },
    confirmations: [{ verb: "blueprint", target: "mindustry", instanceName: "Mindustry", token: "tok-draft-2" }],
  };
  const re = adaptBlueprintConfirm(reEditResp);
  assert(re.state === "proposed", "re-edit response → back to editable 'proposed'");
  assert(re.token === "tok-draft-2", "re-edit: adopts the FRESH token from confirmations[0]");
  assert(re.draftYaml === REPAIRED_YAML, "re-edit: adopts the returned (repaired) draft as the new editor seed");
  assert(re.evidence && re.evidence.includes("FATAL"), "re-edit: carries the boot-log evidence for the second pass");
  // A DraftReady WITHOUT a fresh token degrades to an honest failure (never a stuck editable card).
  const noTok = adaptBlueprintConfirm({ success: false, card: { data: { outcome: "draftReady", game: "M", draftYaml: "y" } }, confirmations: null });
  assert(noTok.state === "failed", "draftReady with no fresh token degrades to 'failed' (never a save-less loop)");

  // ---------- 4) Save → honest terminal failure ----------
  console.log("\n→ A non-verified, non-loop outcome is an honest failure\n");
  const failResp = {
    text: "Couldn’t add it.", success: false,
    card: { tool: "create_blueprint", subject: { id: "mindustry" },
      data: { outcome: "failed", game: "Mindustry", reason: "the download kept failing" } },
    confirmations: null,
  };
  const f = adaptBlueprintConfirm(failResp);
  assert(f.state === "failed", "failed response → state 'failed'");
  assert(f.reason === "the download kept failing", "failed: reason carried verbatim");

  // An empty/garbage response never reads as success (measured-or-unknown).
  assert(adaptBlueprintConfirm({}).state === "failed", "empty response → 'failed', never a fabricated win");
  assert(adaptBlueprintConfirm({ success: true, card: { data: {} } }).state === "failed",
    "success flag WITHOUT a verified outcome → 'failed' (outcome is the authority, not the flag)");

  // ---------- 5) end-to-end state walk: proposed → (edit) → save → re-edit → save → verified ----------
  console.log("\n→ Full round-trip state walk\n");
  let msg = { role: "command", verb: "blueprint", cmdId: "cmd_0", subjectId: "mindustry",
    instanceName: "Mindustry", token: "tok-draft-1", draftYaml: DRAFT_YAML, bpState: "proposed" };
  const applyPatch = (r) => {
    if (r.state === "verified") return { ...msg, bpState: "verified", bpSlug: r.slug, bpDisplayName: r.displayName, bpProof: r.proof };
    if (r.state === "proposed") return { ...msg, bpState: "proposed", token: r.token, draftYaml: r.draftYaml, evidence: r.evidence, bpDisplayName: r.displayName };
    return { ...msg, bpState: "failed", bpReason: r.reason };
  };
  msg = applyPatch(adaptBlueprintConfirm(reEditResp));
  assert(msg.bpState === "proposed" && msg.token === "tok-draft-2" && msg.evidence.includes("FATAL"),
    "walk: first Save → editable again with new token + evidence");
  msg = applyPatch(adaptBlueprintConfirm(verifiedResp));
  assert(msg.bpState === "verified" && msg.bpSlug === "mindustry" && msg.bpProof.includes("port 6567"),
    "walk: second Save → verified, slug + proof set for the install CTA");
} catch (e) {
  console.error("✗ harness error:", e && (e.stack || e.message));
  fail++;
} finally {
  await vite.close();
}

console.log(`\n${fail === 0 ? "✓ blueprint review checkpoint reduces + finalizes correctly" : `✗ ${fail} check(s) failed`}`);
process.exit(fail === 0 ? 0 : 1);
