// Live CHAT validation: drive the SPA's OWN assistant-turn seam (api.host(id).turn)
// and its pure §5·a reducer (ChatPage.reduceTurnFrame) against a RUNNING kgsm-api +
// assistant + real model — no stubbed fetch (unlike smoke-live Phase 6, which canned
// the SSE). Proves the real chat path: POST /assistant/turn → streamed §5·a frames →
// folded into the thread (streaming bubble + resolved tool pill + final reply).
//
//   Usage: KGSM_API=http://127.0.0.1:8080 node scripts/validate-chat-live.mjs
//
// Mirrors scripts/smoke-live.mjs's jsdom + vite bootstrap so the SPA modules load
// exactly as they do in the browser. Expects an auth-DISABLED backend (no bearer).
import { createServer } from "vite";
import { JSDOM } from "jsdom";
import { writeFileSync, unlinkSync, existsSync, readFileSync } from "node:fs";

const API = process.env.KGSM_API || "http://127.0.0.1:8080";
const PROMPT = process.env.PROMPT || "List all my game server instances and tell me each one's current run status.";

try {
  const r = await fetch(API + "/api/v1");
  if (!r.ok) throw new Error("status " + r.status);
} catch (e) {
  console.error(`✗ backend not reachable at ${API}/api/v1 (${e.message}). Start kgsm-api first.`);
  process.exit(2);
}

// Vite reads VITE_API_BASE from .env.local — seed it just for this run, then restore.
const ENV = new URL("../.env.local", import.meta.url).pathname;
const hadEnv = existsSync(ENV);
const prevEnv = hadEnv ? readFileSync(ENV, "utf8") : null;
writeFileSync(ENV, `VITE_API_BASE=${API}\n`);
const restoreEnv = () => { try { if (hadEnv) writeFileSync(ENV, prevEnv); else unlinkSync(ENV); } catch {} };

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });

let fail = 0;
const assert = (cond, label) => { console.log(`${cond ? "✓" : "✗"} ${label}`); if (!cond) fail++; };

try {
  const cfg = await vite.ssrLoadModule("/src/lib/config.js");
  // "Live" = at least one connection (the VITE_API_BASE seed) resolving to this API.
  // (config.js has no LIVE/MOCK duality any more — CONNECTIONS is the only signal.)
  const base = cfg.apiV1ForConn(cfg.CONNECTIONS[0]);
  assert(cfg.CONNECTIONS.length >= 1 && base === API + "/api/v1", `SPA config wired live → ${base}`);

  const { api } = await vite.ssrLoadModule("/src/lib/apiClient.js");
  const { reduceTurnFrame } = await vite.ssrLoadModule("/src/pages/ChatPage.jsx");

  // Drive a REAL turn through the SPA's own seam, folding each frame into the thread
  // exactly as ChatPage.sendLive does (the pure reducer is the actual UI translation).
  console.log(`\n→ POST /assistant/turn (real model)  prompt: "${PROMPT}"\n`);
  let messages = [{ role: "user", content: PROMPT }, { role: "assistant", content: "" }];
  const frames = [];
  const t0 = Date.now();
  try {
    await api.host("hotrod").turn(
      { prompt: PROMPT },
      { onEvent: (ev) => { frames.push(ev); messages = reduceTurnFrame(messages, ev); } });
  } catch (e) {
    assert(false, `turn threw before/while streaming: ${e && (e.userMessage || e.message)} (code=${e && e.code})`);
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  const types = frames.map(f => f.type);
  console.log(`  frames (${frames.length} in ${secs}s): ${[...new Set(types)].join(", ")}`);

  // --- frame-level assertions: streaming + tool calling came over the REAL relay ---
  assert(types.includes("text.delta"), "stream: text.delta slices arrived (streaming works)");
  assert(types.filter(t => t === "text.delta").length > 1, "stream: reply streamed in MULTIPLE deltas (not one buffered blob)");
  assert(types.includes("tool.start"), "tools: tool.start arrived (the model called a tool)");
  assert(types.includes("tool.result"), "tools: tool.result arrived");
  assert(types.includes("done"), "stream: terminal done frame arrived");
  assert(!types.includes("error"), "stream: no in-band error frame");

  // tool.start/result pair by id
  const ts = frames.find(f => f.type === "tool.start");
  const tr = frames.find(f => f.type === "tool.result");
  assert(ts && tr && ts.id === tr.id, `tools: start/result pair by id (${ts && ts.id})  tool=${ts && ts.tool}`);

  // --- reducer-level assertions: the thread the UI would render ---
  const pill = messages.find(m => m.role === "context");
  assert(pill && pill.state === "done", "thread: tool pill spliced in and RESOLVED to done");
  const bubble = messages[messages.length - 1];
  assert(bubble && bubble.role === "assistant" && (bubble.content || "").trim().length > 0,
    "thread: assistant bubble has the final non-empty reply");

  console.log(`\n  tool pill : "${pill && pill.label}"`);
  console.log(`  reply     : ${JSON.stringify(((bubble && bubble.content) || "").slice(0, 400))}`);

  // --- the Actions toggle: the SPA seam forwards `actions` and the assistant proposes a command ---
  // (Auth-disabled api ⇒ admin tier, so actions:true ⇒ canAct; this proves the SPA body carries the
  //  toggle and a command.proposed flows back. The viewer/operator tier matrix is validate-action-toggle.sh.)
  // The model's DECISION to call server_command is probabilistic (gemma4:12b), so retry a few times —
  // we're proving the seam forwards the toggle + the backend can propose, not the model's determinism.
  console.log(`\n→ POST /assistant/turn { actions: true }  (operator toggle on; retry until proposed)`);
  let proposed = null;
  for (let attempt = 1; attempt <= 4 && !proposed; attempt++) {
    const aFrames = [];
    try {
      await api.host("hotrod").turn(
        { prompt: "Use your start action to start the factorio-test server now. Do not just describe it — propose the start.", actions: true },
        { onEvent: (ev) => aFrames.push(ev) });
    } catch (e) {
      assert(false, `actions turn threw: ${e && (e.userMessage || e.message)}`);
      break;
    }
    proposed = aFrames.find(f => f.type === "command.proposed");
    console.log(`  attempt ${attempt}: ${[...new Set(aFrames.map(f => f.type))].join(", ")}${proposed ? "  → PROPOSED" : ""}`);
  }
  assert(!!proposed, "actions toggle: the SPA seam forwarded actions:true → assistant emitted command.proposed");
  assert(proposed && proposed.verb === "start" && proposed.subject && proposed.subject.id === "factorio-test",
    `actions toggle: proposal is start factorio-test (verb=${proposed && proposed.verb})`);
} catch (e) {
  console.error("✗ harness error:", e && (e.stack || e.message));
  fail++;
} finally {
  await vite.close();
  restoreEnv();
}

console.log(`\n${fail === 0 ? "✓ chat works end-to-end against the live relay" : `✗ ${fail} check(s) failed`}`);
await sleep(50);
process.exit(fail === 0 ? 0 : 1);
