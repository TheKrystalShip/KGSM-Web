// Verify the registry-corruption fix (the https://hotrod login bug):
//  1) a pre-existing corrupt entry (url is a bare hostname, no scheme) is SELF-HEALED — config
//     drops it, so CONNECTIONS falls back to the VITE_API_BASE seed (a reachable http origin),
//     NOT https://hotrod.
//  2) apiOriginOf(hostId) — the value register() now stores instead of host.hostname — resolves
//     to the real connection origin (the seed), never the bare host id.
//
//   Usage: KGSM_API=http://127.0.0.1:8080 node scripts/validate-registry-fix.mjs
import { createServer } from "vite";
import { JSDOM } from "jsdom";
import { writeFileSync, existsSync, readFileSync, unlinkSync } from "node:fs";

const API = process.env.KGSM_API || "http://127.0.0.1:8080";
const ENV = new URL("../.env.local", import.meta.url).pathname;
const hadEnv = existsSync(ENV);
const prevEnv = hadEnv ? readFileSync(ENV, "utf8") : null;
writeFileSync(ENV, `VITE_API_BASE=${API}\n`);
const restore = () => { try { if (hadEnv) writeFileSync(ENV, prevEnv); else unlinkSync(ENV); } catch {} };

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: "http://localhost:5173/" });
globalThis.window = dom.window;
globalThis.localStorage = dom.window.localStorage;
// Pre-seed the EXACT corruption the bug produced: a registry entry whose url is the bare backend
// hostname (no scheme) — what sessionStore.register used to write from a GET /hosts host.
localStorage.setItem("krystal:hosts:registry",
  JSON.stringify([{ id: "hotrod", url: "hotrod", name: "hotrod" }]));

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
let fail = 0;
const assert = (c, label, extra = "") => { console.log(`${c ? "✓" : "✗"} ${label}${extra}`); if (!c) fail++; };
try {
  const cfg = await vite.ssrLoadModule("/src/lib/config.js");
  assert(cfg.CONNECTIONS.length === 1 && cfg.CONNECTIONS[0].seed === true,
    "corrupt bare-host entry dropped → CONNECTIONS falls back to the seed", ` (n=${cfg.CONNECTIONS.length})`);
  const seedOrigin = cfg.soleConnectionOrigin();
  assert(seedOrigin === API, "the sign-in origin is the reachable seed, NOT https://hotrod", ` (${seedOrigin})`);
  assert(!/hotrod/.test(seedOrigin), "the sign-in origin contains no bare backend hostname");
  // The login redirect target the LoginPage builds (origin + /auth/discord/start):
  assert((seedOrigin + "/auth/discord/start") === API + "/auth/discord/start",
    "Discord login URL targets the real api origin");
  // What register() stores for a /hosts host (no url) instead of host.hostname:
  assert(cfg.originOfHost("hotrod") === API,
    "originOfHost(hostId) → the connection origin register() will persist", ` (${cfg.originOfHost("hotrod")})`);
} catch (e) {
  console.error("✗ harness error:", e && (e.stack || e.message)); fail++;
} finally {
  await vite.close(); restore();
}
console.log(`\n${fail === 0 ? "✓ registry corruption fixed + self-heals" : `✗ ${fail} failed`}`);
process.exit(fail ? 1 : 0);
