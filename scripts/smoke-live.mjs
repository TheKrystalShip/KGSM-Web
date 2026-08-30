// Live wiring smoke: point the SPA at a real kgsm-api (VITE_API_BASE) and mount
// the read-path routes in jsdom so the boot-hydrate fetch + adapters + render
// actually run against the backend. Asserts real backend data appears (not the
// fixtures) and that no route throws / falls back to the crash boundary.
//
//   Usage: KGSM_API=http://127.0.0.1:8097 node scripts/smoke-live.mjs
//   (defaults to http://127.0.0.1:8097)
import { createServer } from "vite";
import { JSDOM } from "jsdom";
import React from "react";
import { createRoot } from "react-dom/client";
import { writeFileSync, unlinkSync, existsSync, readFileSync } from "node:fs";

const API = process.env.KGSM_API || "http://127.0.0.1:8097";

// ── THE ONE RULE: this smoke never mutates the host ───────────────────────────
// It is a FRONT-END suite. It proves the SPA's module graph, adapters, stores and
// components behave against REAL backend shapes — it is not the place to prove the
// engine's or the api's write contracts (those belong to kgsm-api's own suite, which
// owns a disposable instance and its own db).
//
// So every assertion below is one of exactly two kinds:
//   • a READ against the live backend, or
//   • a WRITE INTERCEPTED at the fetch seam (assert the request the SPA *builds*,
//     answer it synthetically) — the pattern already used for install/uninstall/
//     commands/blueprint writes.
//
// This is not fastidiousness. kgsm's event transport is a single host-wide journal
// (/var/lib/kgsm/events/*.ndjson) indexed by ONE kgsm-monitor, and every kgsm-api on
// the box — including the operator's :8097 — merges its engine history from that one
// monitor. There is no such thing as a write scoped to the backend under test: anything
// reaching the engine lands in the operator's real audit log, permanently, and rides the
// live consumer out to their notification integrations. A run must leave NOTHING behind,
// which is achieved by writing nothing — not by cleaning up afterwards.
//
// Corollary: no `kgsm.sh events emit`, no engine-touching PUT/DELETE, and nothing that
// needs this process to be co-located with the engine or to hold a sqlite3 CLI.
// The live-transport and note-round-trip proofs this rule gives up are covered by
// kgsm-api's ServerNoteWriteTests / AuditJournalRelayTests.

// Preflight: the backend must be reachable, else this smoke is meaningless.
try {
  const r = await fetch(API + "/api/v1");
  if (!r.ok) throw new Error("status " + r.status);
} catch (e) {
  console.error(`✗ backend not reachable at ${API}/api/v1 (${e.message}). Start kgsm-api first.`);
  process.exit(2);
}

// …and it must be AUTH-DISABLED. This harness sends no bearer, so against a real
// auth-enabled host every gated read 401s and the whole suite degrades into a wall
// of failures whose actual cause is one missing token. Say that once, up front,
// instead of forty times downstream. `scripts/visual-harness/dev-api.sh` is the
// auth-off backend this expects (:8096); the prod unit on :8097 has auth ON.
{
  const r = await fetch(API + "/api/v1/me", { headers: { Accept: "application/json" } });
  if (r.status === 401 || r.status === 403) {
    console.error(`✗ ${API} has auth ENABLED (/me → ${r.status}). This smoke runs unauthenticated and`);
    console.error(`  needs an auth-disabled backend: scripts/visual-harness/dev-api.sh, then`);
    console.error(`  KGSM_API=http://127.0.0.1:8096 npm run smoke`);
    process.exit(2);
  }
}

// Point the module graph at THIS run's backend. The vite server below boots in
// "development" mode, and Vite ranks a mode-specific env file ABOVE a plain one —
// `.env.development` (committed, seeding the :8090 dev api) beats `.env.local`.
// `.env.development.local` is the top of that order and is the override
// `.env.development` itself documents, so it is the only file that actually wins.
const ENV = new URL("../.env.development.local", import.meta.url).pathname;
const hadEnv = existsSync(ENV);
const prevEnv = hadEnv ? readFileSync(ENV, "utf8") : null;
writeFileSync(ENV, `VITE_API_BASE=${API}\n`);
const restoreEnv = () => { try { if (hadEnv) writeFileSync(ENV, prevEnv); else unlinkSync(ENV); } catch {} };

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: "http://localhost:5173/", pretendToBeVisual: true,
});
const w = dom.window;
globalThis.window = w;
// Monaco reaches for DOM constructors as BARE globals, not off `window` — an unassigned
// one throws inside the editor's own mount and the page it lives on lands in the error
// boundary, which reads like a product bug rather than a missing jsdom binding. Mirror the
// whole set the editor touches, not just the shell's.
for (const k of ["document", "localStorage", "sessionStorage", "HTMLElement", "Node", "getComputedStyle", "DOMParser", "Event", "CustomEvent", "navigator", "location", "history",
                 "UIEvent", "MouseEvent", "KeyboardEvent", "FocusEvent", "WheelEvent", "InputEvent", "PointerEvent", "DragEvent", "ClipboardEvent",
                 "Element", "HTMLDivElement", "HTMLTextAreaElement", "HTMLInputElement", "HTMLStyleElement", "HTMLAnchorElement",
                 "MutationObserver", "DOMRect", "Range", "Selection", "NodeFilter", "Blob", "URL", "URLSearchParams"]) {
  try { if (!globalThis[k]) globalThis[k] = w[k]; } catch {}
}
w.matchMedia = w.matchMedia || ((q) => ({ matches: false, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }));
w.scrollTo = () => {};
// jsdom implements no layout, so it ships neither Element.scrollTo nor scrollIntoView.
// Components that auto-scroll (the console tail, the chat transcript) call them during a
// normal render, and an unhandled TypeError there aborts the whole run rather than failing
// one check. Scroll position is invisible to this suite, so no-ops are the honest stub.
w.Element.prototype.scrollTo = w.Element.prototype.scrollTo || function () {};

w.Element.prototype.scrollIntoView = w.Element.prototype.scrollIntoView || function () {};
w.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
w.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.ResizeObserver = w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
globalThis.IntersectionObserver = w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
w.localStorage.setItem("krystal:auth", JSON.stringify({ name: "dev", provider: "discord", stay: true, role: "admin", id: "u_dev" }));

const errors = [];
w.addEventListener("error", (e) => errors.push("window.error: " + (e?.error?.message || e?.message)));
process.on("unhandledRejection", (r) => errors.push("unhandledRejection: " + (r?.message || r)));
const origErr = console.error;
console.error = (...a) => { const s = a.join(" "); if (!/not wrapped in act|ReactDOM.render|useLayoutEffect does nothing on the server/.test(s)) errors.push("console.error: " + s.slice(0, 200)); };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Monaco is swapped for a textarea in this suite. It is a real code editor built for a
// real browser — it imports `.css`, reads layout, and calls DOM APIs jsdom does not
// implement — and left in place it throws from inside its own mount, which surfaces as the
// PAGE hitting its error boundary and reads like a product bug. Every surface that hosts it
// (the blueprint editor on a game page, the create page, the server file editor, the chat
// draft card) is invisible to this suite until it is stubbed. Nothing is lost: this is
// jsdom, which lays out nothing, so the editor's own behaviour was never observable here —
// it is proven in a real browser by scripts/visual-harness. What IS asserted is everything
// around it: that those pages mount, hydrate, and wire their buttons to the right calls.
const stubMonaco = {
  name: "smoke-stub-code-editor",
  enforce: "pre",
  load(id) {
    if (!id.endsWith("/src/components/CodeEditor.jsx")) return null;
    return [
      'import React from "react";',
      "function CodeEditor({ value, onChange, path, readOnly }) {",
      '  return React.createElement("textarea", {',
      '    className: "smoke-code-editor", "data-path": path || "", readOnly: !!readOnly,',
      '    value: value == null ? "" : value,',
      "    onChange: (e) => onChange && onChange(e.target.value),",
      "  });",
      "}",
      "export { CodeEditor };",
      "export default CodeEditor;",
    ].join("\n");
  },
};
const vite = await createServer({
  server: { middlewareMode: true }, appType: "custom", logLevel: "error",
  plugins: [stubMonaco],
});

let fail = 0;
try {
  const cfg = await vite.ssrLoadModule("/src/lib/config.js");
  // "Live" = at least one resolved connection (the VITE_API_BASE seed). config.js dropped
  // the old LIVE/MOCK duality, so CONNECTIONS is the only signal (cfg.LIVE is gone — the
  // old check silently always-failed, swallowed by the console.error wrapper).
  const seedBase = cfg.apiV1ForConn(cfg.CONNECTIONS[0]);
  if (!cfg.CONNECTIONS || cfg.CONNECTIONS.length < 1 || seedBase !== API + "/api/v1") {
    console.error(`✗ config not live: CONNECTIONS=${cfg.CONNECTIONS && cfg.CONNECTIONS.length} base=${seedBase} (expected ${API}/api/v1)`);
    fail++;
  } else {
    console.log(`✓ config wired live → ${seedBase}`);
  }

  // ---- OAuth fragment capture (mechanical) --------------------------------
  // Simulate the kgsm-api callback redirect landing on the SPA with the session
  // in the URL fragment; the SPA must parse + stash + strip it before the hash
  // router sees it (the real Discord consent round-trip is owed-to-human).
  const assertEarly = (cond, label) => { console.log(`${cond ? "✓" : "✗"} ${label}`); if (!cond) fail++; };
  {
    const ar = await vite.ssrLoadModule("/src/lib/authRedirect.js");
    w.history.replaceState(null, "", "/#access=tok_AAA&refresh=tok_BBB");
    const cap = ar.captureOAuthFragment();
    assertEarly(cap && cap.access === "tok_AAA" && cap.refresh === "tok_BBB", "OAuth fragment parsed (access+refresh)");
    assertEarly(!String(w.location.hash || "").includes("access="), "OAuth fragment stripped from URL after capture");
    const p = ar.takePendingTokens();
    assertEarly(p && p.access === "tok_AAA", "pending tokens stashed for the session layer");
    assertEarly(ar.takePendingTokens() === null, "pending tokens are one-shot (no replay)");
    w.history.replaceState(null, "", "/#error=denied");
    const cerr = ar.captureOAuthFragment();
    assertEarly(cerr && cerr.error === "denied", "OAuth error fragment parsed (#error=denied)");
    assertEarly(ar.takeOAuthError() === "denied", "OAuth error surfaced one-shot to LoginPage");
    w.history.replaceState(null, "", "/");   // clean slate for the render phases
  }

  // ---- Phase 1: data-level honest mapping (persona-independent) -----------
  // Fetch real backend payloads and run them through the adapters; assert the
  // honest-unknown contract holds (no fabricated 0s) and the no-fabricated-meters
  // guard returns [] when the host's metrics capability is down.
  const adapt = await vite.ssrLoadModule("/src/lib/adapters.js");
  const diag = await vite.ssrLoadModule("/src/pages/DiagnosticsPage.jsx");
  const assert = (cond, label) => { console.log(`${cond ? "✓" : "✗"} ${label}`); if (!cond) fail++; };

  // ---- connect-at-login: probe the REAL backend (not the stub) ------------
  // smoke-offline unit-tests connectHost with a stubbed fetch; this proves it
  // against the live API's actual shapes (handshake + /me + /hosts) — the real
  // exchange a browser performs on the connect screen (minus the reload). Catches
  // stub-vs-reality drift in the probe.
  const conn = await vite.ssrLoadModule("/src/lib/connect.js");
  const cr = await conn.connectHost(API);   // real global fetch → the running backend
  assert(cr.status === "ok", `connectHost(real backend) → ok (handshake + /me resolved)`);
  assert(cr.hostId && typeof cr.hostId === "string", `connectHost: real host id probed from GET /hosts (${cr.hostId})`);
  // The provider is DERIVED from the id the backend returned (`provider:subject`), never
  // assumed — stamping "discord" on a local account puts the wrong mark beside somebody's name
  // everywhere it is shown and offers them the wrong controls in Settings. So the assertion is
  // the derivation, which holds whichever door the account came through.
  const wantProvider = String((cr.user && cr.user.id) || "").includes(":")
    ? String(cr.user.id).split(":")[0] : "local";
  assert(cr.user && cr.tier && cr.user.provider === wantProvider,
    `connectHost: identity + tier resolved from /me (${cr.user && cr.user.provider}, tier=${cr.tier})`);

  const rawServers = await (await fetch(API + "/api/v1/servers")).json();
  const servers = adapt.adaptServers(rawServers);
  assert(servers.length === rawServers.length && servers.length > 0, `adaptServers maps ${servers.length} server(s)`);
  // The count is sourced now, and the null it can still carry is load-bearing: a server whose presence
  // this host cannot see must arrive as null, NOT as the 0 that would silently join a fleet total.
  assert(
    servers.every((s) => s.players === null || (Number.isInteger(s.players.current) && s.players.max === null)),
    "servers: players → a measured count, or null when presence is unobservable");
  assert(
    servers.every((s, i) => (rawServers[i].onlinePlayers == null) === (s.players === null)),
    "servers: an unobservable presence survives the adapter as null (never fabricated as 0)");
  assert(
    servers.every((s, i) => s.players === null || s.players.current === rawServers[i].onlinePlayers),
    "servers: the count is the backend's, carried through untouched");
  assert(servers.every((s) => ["online", "offline", "unknown"].includes(s.status)), "servers: status vocab remapped");
  assert(servers.every((s) => (s.metrics == null ? s.cpu === null && s.ram === null : true)), "servers: cpu/ram → null when no metrics (not 0)");
  assert(servers.every((s) => Array.isArray(s.log)), "servers: log → [] (console is a separate endpoint, not on the server DTO)");

  // Which library a server lives in, and whether that root is mounted — two fields, kept apart from
  // status. `unregistered` is the engine's own word for a server on a disk nothing declares, so it has
  // to survive the adapter as itself rather than being folded into "unknown".
  assert(
    servers.every((s, i) => s.library === (rawServers[i].library || null)),
    "servers: library name carried through verbatim");
  assert(
    servers.every((s) => s.libraryState === null
      || ["online", "offline", "unregistered"].includes(s.libraryState)),
    "servers: libraryState is online|offline|unregistered, or null when the registry is unreadable");
  assert(
    servers.every((s) => s.libraryState !== "offline" || s.library),
    "servers: a server reported on an offline library still names which one");
  // The supervision type, and the one case there is no honest answer for it. The engine omits
  // `runtime` for a server whose library is not mounted, so null has to survive as null — a
  // "native" there sends a console offer to what might be a container.
  assert(
    servers.every((s) => s.runtime === null || ["native", "container"].includes(s.runtime)),
    "servers: runtime is native|container, or null when the node reported none");
  assert(
    servers.every((s, i) => s.runtime === (rawServers[i].runtime ?? null)),
    "servers: runtime carried through verbatim, never defaulted");

  // ---- the probe instances, DERIVED from the live roster ------------------
  // Every check below that needs a real server picks it from what the backend
  // actually reports. KGSM instances are disposable — they get installed and
  // uninstalled constantly on a dev host — so a hardcoded name does not stay
  // true, and when it rots the whole suite fails in a way that reads like an SPA
  // regression instead of a stale fixture. PROBE and OTHER are on DIFFERENT
  // blueprints (that difference is what the blueprint-scoping checks assert), and
  // neither id may contain the other or the "shows X, not Y" negatives would be
  // unfalsifiable.
  const distinct = (a, b) => a && b && !a.id.includes(b.id) && !b.id.includes(a.id);
  const PROBE = servers[0] || null;
  const OTHER = servers.find((s) => PROBE && s.blueprint !== PROBE.blueprint && distinct(s, PROBE)) || null;
  assert(PROBE != null, `probe instance derived from the live roster (${PROBE ? PROBE.id : "none"})`);
  if (!PROBE) { console.error("✗ the backend reports no servers — install one (factorio/terraria are quickest) and re-run."); throw new Error("no roster"); }
  if (!OTHER) console.log(`  · only one blueprint has instances — the blueprint-scoping negatives are skipped`);

  const rawHosts = await (await fetch(API + "/api/v1/hosts")).json();
  const hosts = adapt.adaptHosts(rawHosts);
  assert(hosts.length === rawHosts.length && hosts.length > 0, `adaptHosts maps ${hosts.length} host(s)`);
  assert(hosts.every((h) => typeof h.online === "boolean" && h.name != null), "hosts: status→online bool, label→name");
  assert(hosts.every((h) => h.capabilities && h.capabilities.metrics), "hosts: capabilities passthrough intact");

  // ---- libraries: the named roots a node places servers in ----------------
  // Read-only, off the same live host aggregate the panel renders. The two facts worth locking are
  // the ones a fabrication would quietly break: null (the engine could not answer) must never become
  // an empty list, and an offline library must report NO capacity rather than a zero — a 0 free-byte
  // figure renders as a full disk, which is the opposite of what an unplugged one means.
  assert(
    hosts.every((h, i) => (rawHosts[i].libraries == null) === (h.libraries === null)),
    "hosts: a node that could not report its libraries stays null (never an empty list)");
  {
    const libs = hosts.flatMap((h) => h.libraries || []);
    assert(libs.length > 0, `hosts: ${libs.length} librar(y|ies) rendered from live data`);
    assert(
      libs.every((l) => typeof l.name === "string" && l.name.length > 0
        && typeof l.path === "string" && l.path.startsWith("/")
        && typeof l.online === "boolean" && Number.isInteger(l.instance_count)),
      "hosts: every library carries a name, an absolute path, a state and a count");
    assert(
      libs.every((l) => l.online || (l.free_bytes === null && l.total_bytes === null)),
      "hosts: an offline library reports no capacity (null, never 0)");
    assert(
      libs.every((l, i) => {
        const raw = hosts.flatMap((h) => (h.libraries ? rawHosts[hosts.indexOf(h)].libraries : []))[i];
        return raw && l.free_bytes === (raw.freeBytes ?? null) && l.total_bytes === (raw.totalBytes ?? null);
      }),
      "hosts: capacity is the backend's bytes, carried through untouched");
  }
  // Diagnostics B-enrichment: when the metrics capability is operational (a live monitor), the adapter
  // maps the full snapshot — per-core, load, swap, fs, disk-IO, interfaces, hostname, uptime — AND keeps
  // every unsourced field honestly null/"—", never a fabricated 0°C / SMART "ok" / iface address.
  const opHost = hosts.find((h) => h.capabilities.metrics && h.capabilities.metrics.status === "operational");
  if (opHost) {
    assert(diag.hostCapacityMeters(opHost).length === 3, "hostCapacityMeters → 3 real meters when metrics operational (live monitor)");
    assert(Array.isArray(opHost.cpu.per_core) && opHost.cpu.per_core.length > 0 && opHost.cpu.cores === opHost.cpu.per_core.length,
      `host cpu: per_core[${opHost.cpu.per_core.length}] mapped + cores derived from it`);
    assert(Array.isArray(opHost.cpu.load_avg) && opHost.cpu.load_avg.length === 3, "host cpu: load_avg [1m,5m,15m] mapped");
    assert(opHost.ram.total_gb > 0 && opHost.ram.free_gb != null && opHost.ram.swap_total_gb != null, "host mem: total/free/swap mapped");
    assert(opHost.disks.length > 0 && opHost.disks.every((d) => d.fs && d.fs !== "—"), "host disks: filesystem type mapped");
    assert(typeof opHost.hostname === "string" && opHost.hostname.length > 0 && opHost.boot_time != null,
      "host: hostname + boot_time (derived from uptime) mapped");
    assert(Array.isArray(opHost.network.interfaces) && opHost.network.interfaces.length > 0
           && opHost.network.interfaces.every((i) => typeof i.rx_kbps === "number"),
      "host net: interface throughput mapped (bytes/s → kbps)");
    // M-diag depth (Monitor.Contracts 1.1.0) is now SOURCED — the adapter stopped discarding cpu identity,
    // sensors, mem cached/buffers, disk device, iface mac. Assert they're real…
    assert(typeof opHost.cpu.model === "string" && opHost.cpu.model !== "—",
      "host cpu: model sourced (M-diag depth — not the '—' placeholder)");
    assert(Array.isArray(opHost.sensors) && opHost.sensors.length > 0 && opHost.sensors.every((s) => typeof s.value_c === "number"),
      "host sensors: hwmon temps sourced (real °C, not a hidden temp KPI)");
    assert(opHost.ram.cached_gb != null && opHost.ram.buffers_gb != null, "host mem: cached/buffers sourced (M-diag depth)");
    assert(opHost.disks.every((d) => d.device && d.device !== "—"), "host disks: backing-device model sourced");
    // A MAC is sourced where the device HAS one. A layer-3 tunnel (wireguard, tun) has no link-layer
    // address at all — sysfs `address` is empty — so null is the measurement there, not a gap. Assert
    // the field is really read (at least one real address) and that every value is either a well-formed
    // MAC or an honest null, which is what a fabricated "—" / all-zeroes placeholder would fail.
    const macs = opHost.network.interfaces.map((i) => i.mac);
    assert(macs.some((m) => /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(m || "")),
      "host net: interface MAC sourced (M-diag depth — a real hardware address, not discarded)");
    assert(macs.every((m) => m === null || (/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(m) && !/^(00:){5}00$/.test(m))),
      "host net: a MAC-less interface stays null — never a placeholder or an all-zero address");
    // …while the fields that STILL have no honest source stay null/"—" beside the real data.
    assert(opHost.cpu.temp_c === null, "host cpu: temp_c stays null (temps live in sensors, never a fabricated cpu field)");
    assert(opHost.disks.every((d) => d.smart === null) && opHost.network.interfaces.every((i) => i.ip === null),
      "host: SMART health / iface IP honest-null (no source → no fabricated claim or address)");
    // The kgsm.slice aggregate and the GPUs. Both are honest-conditional: null when the host has no
    // slice / no readable card, adapted 1:1 when it does — and slice cpu may be null on the monitor's
    // first observation (no delta yet), which must never read as 0.
    const rawOp = rawHosts[hosts.indexOf(opHost)];
    assert((rawOp.slice == null) === (opHost.slice === null),
      "host slice: absent stays null (no kgsm.slice is an ordinary host, not an empty sample)");
    if (opHost.slice) {
      assert((opHost.slice.mem_bytes === (rawOp.slice.memBytes ?? null))
        && (opHost.slice.cpu_pct_core === (rawOp.slice.cpuPctCore ?? null))
        && (opHost.slice.pids === (rawOp.slice.pids ?? null)),
        "host slice: cpu/mem/pids carried through untouched (nulls preserved, never zeroed)");
    }
    assert((rawOp.gpus == null) === (opHost.gpus === null),
      "host gpus: a host with no readable card stays null (the card simply doesn't render)");
    if (opHost.gpus) {
      assert(opHost.gpus.every((g, i) => g.name && g.uuid
        && g.mem_total_gb === (rawOp.gpus[i].memTotal ?? null)
        && g.sm_pct === (rawOp.gpus[i].smPct ?? null)),
        `host gpus: ${opHost.gpus.length} device(s) adapted 1:1 (VRAM in GiB, nullable SM/temp/power preserved)`);
    }
    // Host metrics HISTORY — the monitor's host-entity series relayed verbatim by the api. cpuTotalPct
    // is always persisted, so a live monitor with history on must answer with it.
    const hh = await fetch(API + "/api/v1/hosts/" + opHost.id + "/metrics/history?range=1h").then(r => (r.ok ? r.json() : null));
    if (hh) {
      assert(hh.series && Array.isArray(hh.series.cpuTotalPct) && hh.series.cpuTotalPct.length > 0
        && typeof hh.step === "number",
        `host history: cpuTotalPct relayed (${hh.series.cpuTotalPct.length} pts, ${hh.tier} tier, step ${hh.step}s)`);
    } else {
      console.log("· host history: this backend serves no /metrics/history (monitor history off) — not exercised");
    }
  } else {
    // Metrics capability down → meters must be empty (no fabricated CPU/RAM bars).
    assert(diag.hostCapacityMeters(hosts[0]).length === 0, "hostCapacityMeters([] when metrics down — no fabricated meters)");
  }

  // Alerts adapter: the API carries no `icon` (presentation, not a measured
  // fact) → derive one from the honest source/severity, pass everything else
  // through. Deterministic (live /alerts is empty until a crash fires), so feed
  // a synthetic watchdog crash record and assert the derive + passthrough.
  const adaptedAlerts = adapt.adaptAlerts({ data: [
    { id: "crash:x", severity: "danger", source: "watchdog", title: "t", detail: "d",
      serverId: "x", hostId: "h", status: "firing", raisedAt: "2026-06-20T00:00:00Z", escalated: false, attempts: 1 },
  ] });
  assert(adaptedAlerts.length === 1 && adaptedAlerts[0].icon === "alert-triangle" && adaptedAlerts[0].status === "firing",
    "adaptAlerts derives an icon from source + passes status through");

  // ---- Phase 2: live UI render (viewer-reachable routes) ------------------
  // Mount once, navigate via hashchange (the App's own listener). NOTE: with no
  // per-host session yet, the frontend persona is tier "none" → admin surfaces
  // (dashboard/fleet) resolve to the viewer home (servers). Those are gated
  // until the auth slice; here we verify the viewer-reachable read path renders
  // real backend data without crashing.
  const { App } = await vite.ssrLoadModule("/src/App.jsx");
  w.sessionStorage.clear();
  w.location.hash = "#/servers";
  const root = createRoot(w.document.getElementById("root"));
  root.render(React.createElement(App));
  await sleep(800);                           // boot fetch + adapters + first paint

  const nav = async (hash) => {
    w.location.hash = hash;
    w.dispatchEvent(new w.Event("hashchange"));   // App keys off location.hash, not event data
    await sleep(400);
    return w.document.getElementById("root").innerHTML;
  };

  const CASES = [
    { hash: "#/servers", must: [PROBE.id, ...(OTHER ? [OTHER.id] : [])], label: "Servers roster (live)" },
    { hash: "#/servers/" + PROBE.id, must: [PROBE.id, "Players", PROBE.runtime], label: "Server detail (live)" },  // runtime = the chip
  ];
  for (const c of CASES) {
    errors.length = 0;
    let ok = false, html = "";
    try {
      html = await nav(c.hash);
      const crashed = /Something went wrong|AppCrash|crash-screen/i.test(html);
      const missing = c.must.filter((s) => !html.includes(s));
      ok = html.length > 200 && !crashed && errors.length === 0 && missing.length === 0;
      const why = [];
      if (crashed) why.push("CRASH FALLBACK");
      if (missing.length) why.push("missing: " + missing.join(","));
      if (errors.length) why.push("errors: " + errors.slice(0, 2).join(" | "));
      console.log(`${ok ? "✓" : "✗"} ${c.label.padEnd(26)} ${html.length} chars${why.length ? "  " + why.join("; ") : ""}`);
    } catch (e) {
      console.log(`✗ ${c.label.padEnd(26)} THROW: ${(e.message || e).toString().split("\n")[0]}`);
    }
    if (!ok) fail++;
  }
  // honest-unknown is actually on screen (offline servers report no players/cpu/ram).
  const rosterHtml = await nav("#/servers");
  assert(rosterHtml.includes("—"), "roster shows '—' for unmeasured fields (honest-unknown on screen)");

  // game-name resolution ran: every server's display `game` equals the /library
  // name for its blueprint (a no-op today since curated name==id upstream, but it
  // proves the cross-store join is wired + consistent and will self-heal on
  // curation). Reads the live singleton stores App just cold-booted.
  const st = await vite.ssrLoadModule("/src/lib/stores.js");
  // The store may be a freshly-evaluated module instance still mid cold-boot —
  // wait for both lists to hydrate. resolveGameNames runs synchronously inside
  // setState's emit, so once both are populated the join is already applied.
  let svList = [], libList = [];
  for (let i = 0; i < 30; i++) {
    svList = st.serversStore.getState().list;
    libList = st.libraryStore.getState().list;
    if (svList.length && libList.length) break;
    await sleep(100);
  }
  const byId = new Map(libList.map((g) => [g.id, g.name]));
  const joinOk = libList.length > 0 && svList.length > 0 &&
    svList.every((s) => byId.has(s.blueprint) && s.game === byId.get(s.blueprint));
  assert(joinOk, `game name joined via /library by blueprint (${svList.length} servers, ${libList.length} catalog)`);

  // ---- Phase 3: gated surfaces, ungated by the /me-driven tier ------------
  // Auth is now wired: the per-host tier comes from GET /me (admin, since the
  // backend runs auth-disabled) — NOT a forced "Preview as" lens. So fleet /
  // library / audit / alerts must render without bouncing to the viewer home,
  // proving the tier resolution + persona gate work against the live backend.
  // (No `persona` key here on purpose — the gate must come from /me alone.)
  w.localStorage.setItem("krystal:auth", JSON.stringify({ name: "dev", provider: "discord", stay: true, id: "u_dev" }));
  const FAB = /0 cores|load 0\.0|CPU 0%/;          // fabricated zero readouts must NOT appear
  const GATED = [
    { hash: "#/cluster",       label: "Cluster (admin)",      must: ["Cluster"] },
    { hash: "#/cluster/hotrod",  label: "Node deep-dive (admin)", must: ["hotrod"], noFab: true },
    { hash: "#/library",       label: "Library (admin, live)", must: ["Catalog"] },
    { hash: "#/audit",         label: "Audit (admin, live)", must: [] },
    { hash: "#/alerts",        label: "Alerts (admin, live)", must: [] },
    // Account settings is tabbed, so each case asserts a string from the TAB BODY rather than one
    // from the tab strip — every label in the strip is present on every tab, which would make the
    // assertion pass without the body ever rendering.
    //
    // Profile's danger zone and Devices' own subtitle are both unconditional: neither waits on a
    // fetch, and both render in the no-node branch. The "Signing in" and "Your access" sections are
    // deliberately NOT asserted — both render only for a node this browser holds a live session on,
    // which an auth-disabled backend does not give the smoke.
    // Devices asserts only that its tab mounts. Its two branches (a live node, and none) share no
    // body string that isn't also a tab label, and an auth-disabled backend always takes the second
    // — so any string assertion here would either pin the empty state or pass off the strip alone.
    // The populated branch is proven in a real browser by scripts/visual-harness/settings-page.mjs.
    { hash: "#/settings",         label: "Settings — profile",  must: ["Danger zone"] },
    { hash: "#/settings/devices", label: "Settings — devices",  must: [] },
  ];
  for (const c of GATED) {
    errors.length = 0;
    let ok = false, html = "";
    try {
      html = await nav(c.hash);
      const txt = html.replace(/<[^>]+>/g, " ");
      const crashed = /Something went wrong|AppCrash|crash-screen/i.test(html);
      const redirected = txt.includes("installed ·");      // bounced to the servers home
      const missing = c.must.filter((s) => !html.includes(s));
      const fab = c.noFab && FAB.test(txt);
      ok = html.length > 200 && !crashed && !redirected && !fab && errors.length === 0 && missing.length === 0;
      const why = [];
      if (crashed) why.push("CRASH");
      if (redirected) why.push("redirected→servers");
      if (fab) why.push("FABRICATED ZEROS");
      if (missing.length) why.push("missing: " + missing.join(","));
      if (errors.length) why.push("errors: " + errors.slice(0, 2).join(" | "));
      console.log(`${ok ? "✓" : "✗"} ${c.label.padEnd(26)} ${html.length} chars${why.length ? "  " + why.join("; ") : ""}`);
    } catch (e) {
      console.log(`✗ ${c.label.padEnd(26)} THROW: ${(e.message || e).toString().split("\n")[0]}`);
    }
    if (!ok) fail++;
  }
  // Diagnostics: the htop-style Processes tab (which never had an honest source) was replaced by the
  // Services leaf control center. The deep-dive must now surface the "Services" tab/summary and NO LONGER
  // the old fabricated-zeros guard text ("expose a process list") — proving the swap landed cleanly.
  const deepHtml = await nav("#/cluster/hotrod");
  assert(deepHtml.includes("Services") && !deepHtml.includes("expose a process list"),
    "host deep-dive: the Overview surfaces the new Services tab/summary (the old htop process card is gone)");

  // alerts must NOT carry the demo fixtures in live mode (they'd read as real).
  const alertsHtml = await nav("#/alerts");
  assert(!/won.t stay up|backups 94% full|zombie/i.test(alertsHtml), "alerts: no fixture leakage in live mode");

  // Alerts read is now wired live (was deliberately empty before this slice):
  // the store hydrates from GET /alerts (firing + 24h resolved), so its feed must
  // match the live count exactly — proving the fetch ran and no fixtures leaked.
  const aApi = await vite.ssrLoadModule("/src/lib/alertsApi.js");
  await aApi.alertsStore.refresh().catch(() => {});
  const rawAlerts = await (await fetch(API + "/api/v1/alerts")).json();
  const liveAlertCount = (rawAlerts.data || []).length;
  assert(typeof aApi.alertsStore.refresh === "function", "alertsStore.refresh wired (live hydrate)");
  assert(aApi.alertsStore.getState().list.length === liveAlertCount,
    `alerts hydrated from GET /alerts (${liveAlertCount} live, no fixtures)`);

  // Render-with-data: live /alerts is empty and the mock smoke's fixtures carry
  // their own icon, so the adaptAlerts→AlertCard composition (with a DERIVED
  // icon) renders nowhere else. Inject two API-shaped alerts via ingest — a
  // watchdog crash (the live producer → alert-triangle) and a host-monitor one
  // (a fallback → server) — and assert both titles + their derived lucide glyphs
  // render, then retract so the no-fixture-leakage invariant stays clean.
  const synth = (id, source) => adapt.adaptAlerts({ data: [
    { id, severity: "danger", source, title: `SMOKE ${source} alert`, detail: "synthetic",
      serverId: "factorio-test", hostId: "hotrod", status: "firing",
      raisedAt: "2026-06-20T00:00:00Z", escalated: false, attempts: 1 },
  ] })[0];
  aApi.KrystalAlerts.ingest({ kind: "raise", alert: synth("crash:smoke", "watchdog") });
  aApi.KrystalAlerts.ingest({ kind: "raise", alert: synth("hm:smoke", "host-monitor") });
  // Metrics-threshold sources (M6·a increment 1): a per-server 'metrics' alert (→ gauge) and a
  // HOST-SCOPE alert with NO serverId (anchor.surface "host") — proves the null-serverId host alert
  // renders and offers "Open host" (not "Open server").
  const synthHost = (id, source) => adapt.adaptAlerts({ data: [
    { id, severity: "warn", source, title: `SMOKE ${source} host alert`, detail: "synthetic",
      serverId: null, hostId: "hotrod", anchor: { surface: "host", hostId: "hotrod", tab: "resources" },
      status: "firing", raisedAt: "2026-06-20T00:00:00Z", escalated: false, attempts: 0 },
  ] })[0];
  aApi.KrystalAlerts.ingest({ kind: "raise", alert: synth("metric:srv-pids:factorio-test", "metrics") });
  aApi.KrystalAlerts.ingest({ kind: "raise", alert: synthHost("metric:host-mem", "host-monitor") });
  const renderHtml = await nav("#/alerts");
  assert(renderHtml.includes("SMOKE watchdog alert") && renderHtml.includes("SMOKE host-monitor alert"),
    "alerts render-with-data: adaptAlerts→AlertCard shows the titles");
  assert(renderHtml.includes("lucide-triangle-alert") && renderHtml.includes("lucide-server"),
    "alerts render-with-data: derived icons resolve to real lucide glyphs (source→icon)");
  assert(renderHtml.includes("lucide-gauge"),
    "alerts render-with-data: metrics source → gauge icon (metrics-threshold source)");
  assert(renderHtml.includes("Open host"),
    "alerts render-with-data: host-scope alert (null serverId) offers Open host, not Open server");
  aApi.KrystalAlerts.ingest({ kind: "retract", id: "crash:smoke" });
  aApi.KrystalAlerts.ingest({ kind: "retract", id: "hm:smoke" });
  aApi.KrystalAlerts.ingest({ kind: "retract", id: "metric:srv-pids:factorio-test" });
  aApi.KrystalAlerts.ingest({ kind: "retract", id: "metric:host-mem" });

  // GamePage instances are scoped by blueprint, not the null===null match-all:
  // PROBE's blueprint page must list PROBE and NOT OTHER (a different blueprint).
  // Scope the check to the PAGE content — the global assistant dock's scope chip
  // lists every server on the host (so it carries OTHER whenever the assistant
  // capability is operational), which would falsely trip the negative check.
  // Clone + strip `.chat-page` so this asserts GamePage's scoping, not the dock's
  // roster. (Non-destructive: the live React tree is untouched.)
  // The instances live on the page's Servers tab, so the check names it — a tab
  // the URL doesn't carry isn't mounted.
  await nav("#/library/" + PROBE.blueprint + "/servers");
  const bpClone = w.document.getElementById("root").cloneNode(true);
  bpClone.querySelectorAll(".chat-page").forEach((n) => n.remove());
  const bpHtml = bpClone.innerHTML;
  const showsProbe = bpHtml.includes(PROBE.id);
  const leaksOther = !!OTHER && bpHtml.includes(OTHER.id);
  assert(showsProbe && !leaksOther,
    `GamePage instances scoped by blueprint (${PROBE.blueprint} shows ${PROBE.id}: ${showsProbe ? "yes" : "NO"}`
    + `${OTHER ? `; leaks ${OTHER.id}: ${leaksOther ? "YES" : "no"}` : ""})`);

  // Library cards share the same blueprint join: each card counts only ITS OWN
  // instances. A match-all join would make every card claim the whole roster, so
  // the real per-blueprint count must appear and the roster-wide one must not
  // (skipped when one blueprint legitimately owns every instance).
  const libHtml2 = await nav("#/library");
  const bpCount = servers.filter((s) => s.blueprint === PROBE.blueprint).length;
  const label = (n) => `${n} server` + (n === 1 ? "" : "s");
  assert(libHtml2.includes(label(bpCount))
    && (bpCount === servers.length || !libHtml2.includes(label(servers.length))),
    `library cards count per blueprint (${label(bpCount)} for ${PROBE.blueprint}, not the match-all ${label(servers.length)})`);

  // The gate is driven by the /me tier, not a persona override: confirm the live
  // host's session resolved to admin (auth-disabled → admin) from GET /me.
  const ss = await vite.ssrLoadModule("/src/lib/sessionStore.js");
  const hid = (st.hostsStore.getState().list[0] || {}).id;
  let tier = null;
  for (let i = 0; i < 30; i++) { tier = ss.sessionStore.tierOf(hid); if (tier && tier !== "none") break; await sleep(100); }
  assert(tier === "admin", `tier resolved from GET /me (${hid} → ${tier}); gates via /me, not a persona lens`);

  // ---- Phase 4: realtime (real stream) ------------------------------------
  // The app boots a real stream to /api/v1/stream (createLiveStream). Prove the
  // transport reaches "live" against the real backend, then that the audit.append/
  // server.patch/server.removed/job.patch remaps mutate the stores. The four frames
  // are injected at the dispatch seam (api.__dispatch — RAW server frame → adapt →
  // dispatch), exactly as the socket would deliver them: what belongs to the SPA is
  // the reshape-and-store step, and driving it from a real engine event would mean
  // writing to the host's journal (see THE ONE RULE). That the api relays a journal
  // event onto this topic at all is kgsm-api's contract, covered by its
  // AuditJournalRelayTests.
  const { api, realtimeStore } = await vite.ssrLoadModule("/src/lib/apiClient.js");

  // (a) the socket reaches "live"
  let rtMode = null;
  for (let i = 0; i < 40; i++) {
    rtMode = (Object.values(realtimeStore.getState().hosts || {})[0] || {}).mode;
    if (rtMode === "live") break;
    await sleep(150);
  }
  assert(rtMode === "live", `realtime stream connected (mode=${rtMode})`);

  // (a2) `me.patch` — the node stating this account's role while the panel is open. Injected at the
  // same dispatch seam as every other frame, because what belongs to the SPA is the write, the
  // re-gate and the delta it announces; that the node emits one is kgsm-api's contract. The tier is
  // put back before anything below runs, since every gated surface after this reads it.
  {
    assert(api.__topics().includes("me"),
      "the primary stream asks for `me` — a role change needs no reconnect to arrive");

    const { can, resolveRoute } = await vite.ssrLoadModule("/src/lib/persona.js");
    const seen = [];
    const off = ss.sessionStore.onTierChange((d) => seen.push(d));
    const push = (t) => api.__dispatch({ topic: "me", type: "me.patch", data: { tier: t, status: "active" } }, hid);

    push("viewer");
    assert(ss.sessionStore.tierOf(hid) === "viewer",
      "me.patch is the authority: a pushed demotion is written to the session record, never refused as a downgrade");
    assert(!can("nav.cluster") && !can("server.operate"),
      "the demotion re-gates the policy layer at once — no cluster, no operating");
    assert(resolveRoute({ kind: "cluster" }).kind !== "cluster",
      "a route the new role may not occupy resolves away from itself");
    assert(seen.length === 1 && seen[0].from === "admin" && seen[0].to === "viewer",
      "the change is announced once, naming what it moved between");

    push("viewer");
    assert(seen.length === 1, "a frame restating the tier already held announces nothing");

    push("admin");
    off();
    assert(ss.sessionStore.tierOf(hid) === "admin" && can("nav.cluster") && can("server.operate"),
      "a promotion lands the same way and the gates come back with it");
  }

  // (b) audit.append → auditStore prepends. The frame carries the real AuditRecord wire
  // shape (id/ts/origin/actor/action/severity/target/serverId/summary); audit is NOT in
  // adaptStreamMessage's remap table, so the store holds the wire row as-is and this
  // asserts exactly that passthrough + the prepend.
  const beforeTop = (st.auditStore.getState().list[0] || {}).id;
  const injectedId = "evt_smoke_" + Date.now().toString(36);
  api.__dispatch({
    topic: "audit", type: "audit.append",
    data: {
      id: injectedId, ts: new Date().toISOString(), origin: "ui",
      actor: { kind: "user", name: "smoke", provider: "discord" },
      action: "server.start", severity: "info",
      target: { kind: "server", id: PROBE.id, name: PROBE.id },
      serverId: PROBE.id, hostId: PROBE.hostId, summary: "started " + PROBE.id, meta: null,
    },
  });
  const top = st.auditStore.getState().list[0];
  assert(top && top.id === injectedId && top.id !== beforeTop && top.action === "server.start",
    "audit.append: a stream frame prepends a server.start row onto auditStore (wire shape passes through unadapted)");

  // (b2) The two bindings that turn a row into pixels, keyed on what the row CARRIES: the shape of
  // its dotted name and the severity its producer stamped. An event this build has never heard of
  // falls to a shorter prefix and reads plain — the failure that stays cosmetic instead of lying.
  {
    const { auditTone, eventIcon, humanizeAction } = await vite.ssrLoadModule("/src/lib/formatting.js");
    assert(eventIcon("server.rename") !== "circle-dot" && eventIcon("server.renamed") === eventIcon("server.rename"),
      `audit: the icon trie reaches a rename in either tense (${eventIcon("server.rename")}) — never the root glyph`);
    assert(eventIcon("network.ports.open") !== eventIcon("network.upnp.open"),
      "audit: a host firewall rule and a router forward draw different glyphs");
    assert(eventIcon("network.pinhole.opened") === eventIcon("network.something.else"),
      "audit: an unrecognised segment falls back to its namespace rather than leaving a gap");
    assert(eventIcon("nobody.declared.this") === "circle-dot" && auditTone({ severity: undefined }) === "info",
      "audit: an event nobody declared renders plain and info — never invisible, never mis-coloured");
    assert(auditTone({ severity: "danger", outcome: "success" }) === "danger"
      && auditTone({ severity: "info", outcome: "success" }) === "success"
      && auditTone({ severity: "info" }) === "info",
      "audit: severity is final; outcome only separates a good routine fact from a neutral one");
    assert(humanizeAction("server.update.failed") === "Server update failed",
      "audit: the label is the producer's own name spelled for a person, from no table");
    const { AuditEventRow } = await vite.ssrLoadModule("/src/components/AuditEventRow.jsx");
    const node = w.document.createElement("div");
    const root = createRoot(node);
    root.render(React.createElement(AuditEventRow, {
      ev: {
        id: "evt_rename_smoke", ts: new Date().toISOString(), origin: "ui",
        actor: { kind: "user", name: "smoke", provider: "discord" },
        action: "server.rename", severity: "info",
        target: { kind: "server", id: PROBE.id, name: PROBE.id },
        serverId: PROBE.id, hostId: PROBE.hostId,
        summary: "renamed " + PROBE.id + " from 'A' to 'B'",
        meta: { oldDisplayName: "A", newDisplayName: "B" },
      },
      now: Date.now(), hosts: st.hostsStore.getState().list,
    }));
    await sleep(30);
    const rowHtml = node.innerHTML;
    root.unmount();
    assert(rowHtml.includes("server.rename") && rowHtml.includes("renamed " + PROBE.id)
      && rowHtml.includes("oldDisplayName") && rowHtml.includes("newDisplayName"),
      "AuditEventRow: a server.rename row states the action, the backend's summary and both labels it moved between");
    assert(!/lucide-circle-dot/.test(rowHtml),
      "AuditEventRow: server.rename draws its OWN icon, never the unmapped grey dot");
  }

  // (c) server.patch remap: RAW API status 'running' → adapted 'online'. Patched onto a
  // REAL roster row so this proves the merge-by-id path, not an insert — then the row's
  // true status is put back, because later checks (the Performance tab needs a genuinely
  // running server) read this same store and must not see a synthetic online.
  const rawProbe = rawServers.find((s) => s.id === PROBE.id);
  const patchProbe = (status) => api.__dispatch({ topic: "servers", type: "server.patch",
    data: { ...rawProbe, status } });
  patchProbe("running");
  assert((st.serversStore.find(PROBE.id) || {}).status === "online",
    "server.patch: raw 'running' adapted to 'online' and merged by id");
  patchProbe(rawProbe.status);

  // (c2) a RENAME arrives as an ordinary server.patch carrying a new `name`, and it must re-label
  // the row everywhere without a reload. The id is untouched, so nothing keyed on it moves — which
  // is the whole point of the design and the thing to prove: the label changes and the row is still
  // found, opened and acted on by the same id.
  const probeNameBefore = (st.serversStore.find(PROBE.id) || {}).name;
  const RENAMED = "Smoke Renamed \u2714 Server";
  api.__dispatch({ topic: "servers", type: "server.patch", data: { ...rawProbe, name: RENAMED } });
  const renamedRow = st.serversStore.find(PROBE.id);
  assert(renamedRow && renamedRow.name === RENAMED && renamedRow.id === PROBE.id,
    "server.patch: a name diff re-labels the row in place and leaves the id alone (a rename is not a new server)");
  {
    // The label reaches the surfaces that render it, live — not just the store. The servers list is
    // the one that would most obviously go stale, since it holds a filtered+sorted copy.
    const renamedList = await nav("#/servers");
    assert(renamedList.includes(RENAMED),
      "a renamed server re-renders under its new label on the servers list, with no reload");
    // And it is still reachable by the id somebody knows it as, which is what keeps a rename from
    // hiding a server from the person who typed its engine name.
    const { instanceIdSlug, isValidInstanceId } = await vite.ssrLoadModule("/src/lib/servers.js");
    assert(instanceIdSlug("Typo Proof \u2714 Server") === "typo-proof-server",
      "instanceIdSlug: runs of anything outside [a-z0-9] collapse to one '-' (mirrors kgsm-api's InstanceIdSlug)");
    assert(instanceIdSlug("  My  Server!!  ") === "my-server",
      "instanceIdSlug: no leading or trailing separator, however the label is spaced or punctuated");
    assert(instanceIdSlug("Factorio_2.0") === "factorio-2-0",
      "instanceIdSlug: '.' and '_' are separators too — the slug is lower-case ASCII alphanumerics and hyphens");
    assert(instanceIdSlug("\u3042\u3044\u3046") === null && instanceIdSlug("   ") === null,
      "instanceIdSlug: a label with nothing usable in it yields null — the engine mints the id, never a placeholder");
    assert(instanceIdSlug("x".repeat(80)).length === 64,
      "instanceIdSlug: capped at the engine's 64 characters");
    assert(isValidInstanceId("factorio-42") && isValidInstanceId("a") && !isValidInstanceId("-nope")
      && !isValidInstanceId("bad name") && !isValidInstanceId("x".repeat(65)),
      "isValidInstanceId: the engine's charset ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$");
  }
  api.__dispatch({ topic: "servers", type: "server.patch", data: { ...rawProbe, name: probeNameBefore } });

  // (d) server.removed tombstone drops the instance
  api.__dispatch({ topic: "servers", type: "server.patch",
    data: { id: "smoke-srv", name: "smoke", blueprint: "factorio", status: "running", runtime: "native", hostId: "hotrod" } });
  const wasAdded = !!st.serversStore.find("smoke-srv");
  api.__dispatch({ topic: "servers", type: "server.removed", data: { id: "smoke-srv" } });
  assert(wasAdded && !st.serversStore.find("smoke-srv"), "server.removed: tombstone drops the instance from the roster");

  // (e) job.patch remap: running → {verb,state}; terminal succeeded → cleared
  api.__dispatch({ topic: "jobs", type: "job.patch", data: { id: "j1", serverId: PROBE.id, verb: "start", state: "running" } });
  const jobRunning = (st.serversStore.find(PROBE.id) || {}).job;
  api.__dispatch({ topic: "jobs", type: "job.patch", data: { id: "j1", serverId: PROBE.id, verb: "start", state: "succeeded" } });
  const jobCleared = (st.serversStore.find(PROBE.id) || {}).job;
  assert(jobRunning && jobRunning.state === "running" && jobCleared == null,
    "job.patch: running tracked; terminal (succeeded) clears the job");

  // (f) alert.raise over the FULL WS chain: adaptStreamMessage → adaptAlert
  // (derived icon) → dispatch → alertsStore upsert (slice 3 only tested REST +
  // a direct ingest, skipping the stream adaptation — this closes the chain).
  api.__dispatch({ topic: "alerts", type: "alert.raise",
    data: { id: "crash:wschain", severity: "danger", source: "watchdog", title: "WS chain alert",
      detail: "synthetic", serverId: "factorio-test", hostId: "hotrod", status: "firing",
      raisedAt: "2026-06-20T00:00:00Z", escalated: false, attempts: 1 } });
  const wsAlert = aApi.alertsStore.getState().list.find(a => a.id === "crash:wschain");
  assert(wsAlert && wsAlert.icon === "alert-triangle",
    "alert.raise: WS frame → adaptAlert (derived icon) → alertsStore upsert");
  aApi.KrystalAlerts.ingest({ kind: "retract", id: "crash:wschain" });

  // (g) host.metrics live tick (slice 7 follow-on) -------------------------
  // The diagnostics deep-dive subscribes hosts/{id}/metrics while open; each tick
  // merges clobber-safe (telemetry only — never the capability block or firewall grid).
  const hmId = (st.hostsStore.getState().list[0] || {}).id;
  const synthSnap = (cpu) => ({
    cpuPct: cpu, mem: { used: 4, total: 16, available: 12, swapUsed: 0, swapTotal: 2 },
    disks: [{ mount: "/", used: 50, total: 100, fs: "ext4" }],
    perCore: [cpu, cpu], load: { one: 0.5, five: 0.6, fifteen: 0.7 },
    diskIo: { readBps: 1000, writeBps: 2000 },
    interfaces: [{ name: "eth0", rxBps: 1000, txBps: 2000, rxPps: 10, txPps: 20 }],
    uptimeSec: 12345, sampleTs: 1718400000000,
  });

  // (g1) CLOBBER-SAFETY (store-level, race-free) — a tick must NEVER wipe the firewall
  // open-ports grid or a capability. Seed those (the tick carries none of them), merge a
  // tick directly, and assert they survive while only the telemetry fields change.
  // Guarded: an unhydrated hosts store used to make this throw and abort the whole
  // process mid-suite, so every check after it silently never ran and the summary
  // never printed. A missing seed is one reported failure, not a lost run.
  const seed0 = st.hostsStore.find(hmId);
  assert(seed0 != null, `host seeded for the metrics-merge checks (${hmId || "no host"})`);
  if (seed0) {
  st.hostsStore.patch(hmId, {
    network: { ...(seed0.network || {}), open_ports: [{ port: 25565, proto: "tcp", server: "factorio-test", app: "factorio" }] },
    sensors: [{ label: "pkg", value_c: 42 }],
    processes: [{ pid: 1, name: "init", cpu_pct: 0, ram_mb: 1, threads: 1, fds: 1, state: "running" }],
    capabilities: { ...seed0.capabilities, metrics: { ...(seed0.capabilities.metrics || {}), status: "operational", provisioned: true } },
  });
  st.hostsStore.mergeMetrics(hmId, adapt.adaptHostMetrics(synthSnap(73)));
  const merged = st.hostsStore.find(hmId);
  assert(merged.cpu.usage_pct === 73 && merged.ram.total_gb === 16 && merged.network.interfaces[0].name === "eth0",
    "host.metrics merge: cpu / mem / iface throughput swapped in from the tick");
  assert(merged.network.open_ports.length === 1 && merged.network.open_ports[0].port === 25565,
    "host.metrics merge: firewall open_ports PRESERVED (tick carries interfaces only — clobber-safe)");
  assert(merged.sensors.length === 1 && merged.processes.length === 1 && merged.capabilities.metrics.status === "operational",
    "host.metrics merge: a sensor-less tick doesn't wipe seeded sensors / processes / capability status");
  assert(merged.capabilities.metrics.last_sample_at != null, "host.metrics merge: per-tick freshness stamped (receipt time)");
  // sensors ARE dynamic depth now — a tick that CARRIES them updates in place (honest live temps).
  st.hostsStore.mergeMetrics(hmId, adapt.adaptHostMetrics({ ...synthSnap(73), sensors: [{ chip: "k10temp", label: "Tctl", valueC: 55 }] }));
  const mergedS = st.hostsStore.find(hmId);
  assert(mergedS.sensors.length === 1 && mergedS.sensors[0].value_c === 55,
    "host.metrics merge: a tick carrying sensors updates them (dynamic depth)");
  // STATIC cpu identity (model/threads — Host-view-only) set by REST must survive a tick that omits it.
  st.hostsStore.patch(hmId, { cpu: { ...(mergedS.cpu || {}), model: "Test CPU", threads: 16 } });
  st.hostsStore.mergeMetrics(hmId, adapt.adaptHostMetrics(synthSnap(80)));
  const mergedC = st.hostsStore.find(hmId);
  assert(mergedC.cpu.model === "Test CPU" && mergedC.cpu.threads === 16 && mergedC.cpu.usage_pct === 80,
    "host.metrics merge: static cpu identity (model/threads) PRESERVED while dynamic usage updates");

  // (g2) EFFECT SUBSCRIPTION + live re-render — nav into the deep-dive, clear the stamp,
  // then push a tick through the dispatch seam. It merges ONLY if the deep-dive's effect
  // subscribed hosts/{id}/metrics (there is no module-level listener for this topic). The
  // value read is synchronous (race-free vs the real monitor's own ~1s ticks).
  await nav("#/cluster/" + hmId);
  st.hostsStore.clearMetricsStamp(hmId);
  api.__dispatch({ topic: "hosts/" + hmId + "/metrics", type: "host.metrics", data: synthSnap(91) });
  const tick = st.hostsStore.find(hmId);
  assert(tick && tick.cpu.usage_pct === 91 && (tick.capabilities.metrics || {}).last_sample_at != null,
    "host.metrics: deep-dive effect subscribed → tick merged (cpu updated + freshness stamped)");
  await sleep(150);
  assert(w.document.getElementById("root").innerHTML.includes(hmId),
    "host deep-dive re-rendered after the live tick (subscribe → merge → render)");
  }   // end: host seeded

  // (g3) DISPOSER lifecycle — leaving the deep-dive unsubscribes the socket topic AND clears
  // the stamp, so the WS-frozen treatment never leaks to the per-server surfaces that share
  // hostMetricsFreshness once you stop inspecting the host.
  await nav("#/cluster");
  await sleep(150);
  assert((st.hostsStore.find(hmId).capabilities.metrics || {}).last_sample_at == null,
    "host.metrics: leaving the deep-dive clears the freshness stamp (disposer ran)");

  // (h) live console (#8) — REST tail hydrate + per-server WS follow. Assert the
  // scrollback shape, then mount a server's overview and prove a live console.line
  // followed onto the rendered panel (the full subscribe → append → render path).
  const cSv = st.serversStore.find(PROBE.id) || st.serversStore.getState().list[0];
  if (cSv) {
    const tailRes = await api.host(cSv.hostId).get("/servers/" + cSv.id + "/console?tail=5");
    assert(tailRes && Array.isArray(tailRes.lines), "console REST: GET ?tail=N → { lines:[...] } (scrollback shape)");
    await nav("#/servers/" + cSv.id);
    // Poll for the hydrate instead of sleeping a guessed interval: the claim is that the
    // REST tail lands, not that it lands inside 220ms, and a fixed wait turns a slow
    // engine read into a phantom failure.
    let consoleReady = false;
    for (let i = 0; i < 30; i++) {
      if (!w.document.getElementById("root").innerHTML.includes("Loading console…")) { consoleReady = true; break; }
      await sleep(120);
    }
    assert(consoleReady, "console: hydrated past the loading state (REST tail landed)");
    const SENT = "SMOKE_CONSOLE_FOLLOW_LINE";
    api.__dispatch({ topic: "servers/" + cSv.id + "/console", type: "console.line", data: { id: cSv.id, seq: 999999, line: SENT } });
    await sleep(140);
    const followHtml = w.document.getElementById("root").innerHTML;
    assert(followHtml.includes(SENT),
      "console: a live console.line followed onto the panel (subscribe → append → render)");
    // The live line carries an observed-at timestamp in the gutter (the game console now matches the
    // host-logs card — the shared ConsoleView, ts-mode on once a line is timed).
    assert(followHtml.includes("console-card__body--ts") && /<span class="ts">\d{1,2}:\d{2}:\d{2}<\/span>/.test(followHtml),
      "console: the live line shows a HH:MM:SS timestamp gutter (the shared ConsoleView)");

    // The scrollback is a capped WINDOW, not a transcript: the feed follows for as long as the panel
    // is open, so an uncapped buffer is an unbounded DOM. Push past the cap and prove the oldest
    // lines fall off — the REST tail first, then the earliest live ones. Dispatch is the client-side
    // hook; this reaches no backend.
    const CAP = 1000, OVER = 200;
    for (let i = 0; i < CAP + OVER; i++)
      api.__dispatch({ topic: "servers/" + cSv.id + "/console", type: "console.line",
        data: { id: cSv.id, seq: 1000000 + i, line: "SMOKE_CAP_" + i } });
    await sleep(200);
    const capHtml = w.document.getElementById("root").innerHTML;
    const rendered = (capHtml.match(/<div class="ln"/g) || []).length;
    assert(rendered === CAP, `console: the scrollback holds the newest ${CAP} lines (rendered ${rendered})`);
    assert(capHtml.includes("SMOKE_CAP_" + (CAP + OVER - 1) + "</span>") && !capHtml.includes("SMOKE_CAP_0</span>"),
      "console: the newest line is present and the oldest was trimmed (window slides, doesn't grow)");
    assert(!capHtml.includes(SENT),
      "console: lines older than the window are gone, scrollback dropped first");

    // (h2) Players is wired to the live presence roster. Whatever the backend
    // answers, the tab must render a state that came FROM it — the live roster, the
    // honest "detection unknown" state, or a load error — and never the old fixture
    // roster or a fabricated "0 players online" standing in for an unanswered call.
    // The full contract matrix (unknown / configured+empty / configured+populated /
    // live join+leave) is proven deterministically further down via intercepted REST.
    const ovHtml = w.document.getElementById("root").innerHTML;
    const HONEST_PLAYER_STATES = ["Couldn't load the roster", "player", "Player", "not report"];
    assert(HONEST_PLAYER_STATES.some((s) => ovHtml.includes(s)),
      "players: the tab renders a backend-sourced state (roster, honest-unknown, or load error — never a fixture)");
    await nav("#/cluster");
  }

  // (i) per-server LIVE metrics (Performance deep-dive) ---------------------
  // The monitor samples each RUNNING server's cgroup/proc tree at ~1 Hz and kgsm-api
  // re-publishes it on servers/{id}/metrics (metrics.tick). The tab seeds from the REST
  // metrics block then follows the tick into a live rolling window. There is NO history
  // store anywhere → this is live-only by design. Prove the adapter, the WS subscribe→
  // point chain (deterministic), and a REAL monitor tick growing the rendered window.

  // (i1) adapter: ServerMetricsDto → chart point. cpu is % of ONE core (UNCAPPED — a
  // multithreaded server exceeds 100); mem/disk are raw bytes; null io/net/disk stay null.
  const pAdapt = adapt.adaptServerMetrics({ cpuPctCore: 250.37, memBytes: 2147483648, ioReadBps: 1024, ioWriteBps: 2048, pids: 12, diskBytes: 5e8, rxBps: 65536, txBps: 131072 });
  assert(pAdapt.cpu === 250.4 && pAdapt.memBytes === 2147483648 && pAdapt.ioReadBps === 1024 && pAdapt.pids === 12,
    "adaptServerMetrics: cpu rounded + UNCAPPED (>100), mem/disk raw bytes, io passthrough");
  assert(pAdapt.rxBps === 65536 && pAdapt.txBps === 131072,
    "adaptServerMetrics: network rxBps/txBps surface (bytes/sec — native eBPF meter)");
  // null io/net/disk stay null — the honest-unknown invariant: an unmetered server
  // (container / un-metered host) must NOT be coerced to a fabricated 0 rate.
  const pNull = adapt.adaptServerMetrics({ cpuPctCore: 1, memBytes: 1, ioReadBps: null, ioWriteBps: null, pids: 1, diskBytes: null, rxBps: null, txBps: null });
  assert(pNull.ioReadBps === null && pNull.rxBps === null && pNull.txBps === null
      && adapt.adaptServerMetrics(null) === null,
    "adaptServerMetrics: null io/net/disk stay null (never fabricated 0); null sample → null");

  // (i2) WS chain: a raw metrics.tick frame → adaptStreamMessage → dispatch →
  // subscribeServerMetrics callback. The server id is in the TOPIC, not the payload.
  let pPoint = null;
  const disposeSM = st.subscribeServerMetrics("factorio-test", (p) => { pPoint = p; });
  api.__dispatch({ topic: "servers/factorio-test/metrics", type: "metrics.tick",
    data: { cpuPctCore: 312.9, memBytes: 1073741824, ioReadBps: 4096, ioWriteBps: 8192, pids: 7, diskBytes: 9e8, rxBps: 262144, txBps: 524288 } });
  assert(pPoint && pPoint.cpu === 312.9 && pPoint.memBytes === 1073741824 && pPoint.ioWriteBps === 8192,
    "metrics.tick: WS frame → adaptServerMetrics → subscribeServerMetrics callback (full chain, cpu uncapped)");
  assert(pPoint && pPoint.rxBps === 262144 && pPoint.txBps === 524288,
    "metrics.tick: network rxBps/txBps ride the tick through adaptServerMetrics into the live window");
  // a tick with null network (unmetered server) keeps rx/tx null — no fabricated 0 on the wire→window path.
  let pNullNet = null;
  const disposeSM2 = st.subscribeServerMetrics("factorio-test", (p) => { pNullNet = p; });
  api.__dispatch({ topic: "servers/factorio-test/metrics", type: "metrics.tick",
    data: { cpuPctCore: 10, memBytes: 1, ioReadBps: null, ioWriteBps: null, pids: 1, diskBytes: null, rxBps: null, txBps: null } });
  assert(pNullNet && pNullNet.rxBps === null && pNullNet.txBps === null,
    "metrics.tick: an unmetered tick keeps rxBps/txBps null through the window (not coerced to 0)");
  disposeSM2();
  disposeSM();

  // (i3) REAL pipeline render: open a RUNNING server's Performance tab. It seeds from the
  // REST metrics block (immediate chart) then a real monitor tick grows the live window.
  const liveSv = st.serversStore.getState().list.find((s) => s.status === "online");
  if (liveSv) {
    await nav("#/servers/" + liveSv.id + "/performance");
    await sleep(250);   // mount + REST seed
    const perfHtml = w.document.getElementById("root").innerHTML;
    assert(/live · 1 Hz|% core/.test(perfHtml) && !perfHtml.includes("Work in progress"),
      "performance: live charts render from the REST seed (subscribe → seed → chart, not the old WIP state)");
    // The subscriber-gated pump now ticks ~1 Hz → the rendered "live window · N samples" grows past the seed.
    let grew = false;
    for (let i = 0; i < 60; i++) {
      const m = w.document.getElementById("root").innerHTML.match(/live window · (\d+) sample/);
      if (m && Number(m[1]) >= 2) { grew = true; break; }
      await sleep(150);
    }
    assert(grew, "performance: a REAL monitor metrics.tick grew the live window (subscribe → WS → render)");
    await nav("#/cluster");
  } else {
    console.log("  skip performance (i3): no running server on this backend to prove live ticks");
  }

  // ---- Phase 5: command + install write paths (slice 6) -------------------
  // The two mutation paths into the engine, both through the host-scoped client
  // (origin:"ui" stamped, bearer injected when held). NON-DESTRUCTIVE: intercept
  // the outbound POST and return a synthetic 202 { job }, so no real start /
  // install runs on the host — we assert only the request the FE constructs (the
  // live start→watchdog and install→download round-trips need the full engine up
  // and are validated by hand, not in this smoke).
  const realFetch = globalThis.fetch;
  let captured = null;
  globalThis.fetch = async (url, opts) => {
    const u = typeof url === "string" ? url : (url && url.url) || "";
    if (opts && opts.method === "POST" && /\/api\/v1\/servers(\/[^/]+\/commands)?$/.test(u)) {
      captured = { url: u, body: JSON.parse(opts.body || "null") };
      return new Response(JSON.stringify({ job: {
        id: "job_smoke", serverId: "factorio-test", verb: (captured.body || {}).verb || "install",
        state: "queued", createdAt: "2026-06-20T00:00:00Z", settledAt: null, error: null,
      } }), { status: 202, headers: { "content-type": "application/json" } });
    }
    return realFetch(url, opts);
  };
  await st.commandServer({ id: "factorio-test", hostId: hmId }, "start").catch(() => {});
  assert(captured && captured.url.endsWith("/api/v1/servers/factorio-test/commands")
    && captured.body.verb === "start" && captured.body.origin === "ui",
    "commandServer → POST /servers/{id}/commands { verb, origin:'ui' } via the host-scoped client");
  captured = null;
  await st.installServer({ game: { id: "factorio" }, name: "My Factorio", hostId: hmId }).catch(() => {});
  assert(captured && captured.url.endsWith("/api/v1/servers")
    && captured.body.blueprint === "factorio" && captured.body.name === "My Factorio" && captured.body.origin === "ui",
    "installServer → POST /servers { blueprint, name, origin:'ui' } (no fabricated server row)");
  // The node-capacity hint: the panel's PREDICTION of what the engine will decide, computed from the
  // three numbers the gate compares. Asserted as a pure function against fixed inputs — the live host
  // has plenty of memory, so the tight case would never occur naturally, and the arithmetic is exactly
  // what must not drift from kgsm's.
  const cap = await vite.ssrLoadModule("/src/lib/capacity.js");
  const NODE = (freeMb, headroomMb = 1024) =>
    ({ ram: { free_mb: freeMb }, memory_gate: { enabled: true, headroom_mb: headroomMb } });
  const SRV = (mb, source = "blueprint") => ({ start_memory_mb: mb, start_memory_source: source });

  assert(cap.startLooksTight(SRV(8192), NODE(8192)) === true,
    "capacity: a start leaving 0MB against a 1024MB floor is tight (the PZ-on-8GB case)");
  assert(cap.startLooksTight(SRV(8192), NODE(20000)) === false,
    "capacity: the same start on a node with room is not tight");
  assert(cap.startLooksTight(SRV(8192), NODE(9215)) === true,
    "capacity: the FLOOR is what refuses — 1023MB left is still short of 1024");
  assert(cap.startLooksTight(SRV(8192), NODE(9216)) === false,
    "capacity: exactly the floor fits (>=, matching the engine)");

  // Every missing input means "say nothing", never a substituted default — most servers declare no
  // requirement at all, so this is the common path rather than an edge.
  assert(cap.capacityHint(SRV(null), NODE(512)) === null,
    "capacity: no declared requirement → no hint (never an invented figure)");
  assert(cap.capacityHint(SRV(8192), { ram: { free_mb: null }, memory_gate: { enabled: true, headroom_mb: 1024 } }) === null,
    "capacity: no MemAvailable reading → no hint (total-used is not a substitute)");
  assert(cap.capacityHint(SRV(8192), { ram: { free_mb: 512 }, memory_gate: null }) === null,
    "capacity: a node publishing no gate policy → no hint (the floor is not guessed)");
  assert(cap.capacityHint(SRV(8192), { ram: { free_mb: 512 }, memory_gate: { enabled: false, headroom_mb: 1024 } }) === null,
    "capacity: a DISABLED gate refuses nothing, so warning would be a lie");

  // The sentence states the two figures and no verdict — an operator who knows the estimate is wrong
  // can only judge that if the numbers are visible.
  const tightHint = cap.capacityHint(SRV(8192), NODE(2048));
  assert(/8 GB/.test(cap.capacityText(tightHint)) && /2 GB free/.test(cap.capacityText(tightHint)),
    "capacity: the hint names what it needs and what is free");
  assert(/blueprint's estimate/.test(cap.capacityDetail(tightHint)),
    "capacity: a blueprint-sourced figure says so, since that is what makes overriding reasonable");
  assert(!/blueprint's estimate/.test(cap.capacityDetail(cap.capacityHint(SRV(8192, "cap"), NODE(2048)))),
    "capacity: an enforced cap is NOT hedged as an estimate");

  // force reaches the wire only when asked for, and only on start — the API refuses it elsewhere.
  globalThis.fetch = async (url, opts) => {
    const u = typeof url === "string" ? url : (url && url.url) || "";
    if (opts && opts.method === "POST" && /\/api\/v1\/servers\/[^/]+\/commands$/.test(u)) {
      captured = { url: u, body: JSON.parse(opts.body || "null") };
      return new Response(JSON.stringify({ job: {
        id: "job_forced", serverId: "factorio-test", verb: "start",
        state: "queued", createdAt: "2026-06-20T00:00:00Z", settledAt: null, error: null,
      } }), { status: 202, headers: { "content-type": "application/json" } });
    }
    return realFetch(url, opts);
  };
  captured = null;
  await st.commandServer({ id: "factorio-test", hostId: hmId }, "start", "ui", true);
  assert(captured && captured.body.force === true,
    "commandServer(force) → POST body carries force:true");
  captured = null;
  await st.commandServer({ id: "factorio-test", hostId: hmId }, "start");
  assert(captured && captured.body.force === undefined,
    "a start that did not ask to override sends NO force field (the protection is the default)");
  globalThis.fetch = realFetch;

  // ---- Phase 5b: one verb, a SET of servers (the batch dispatcher) ---------
  // A run is one verb, one cluster-wide set, one outcome; a batch is one node's share of it. The
  // browser's whole job is minting a run id, grouping by node and firing one POST per node — so what
  // this proves is the REQUEST it builds and what it does with each answer.
  //
  // NON-DESTRUCTIVE, and this one matters more than most: a real POST here would start or stop real
  // game servers on the host, several at once. Every batch call below is intercepted at the fetch
  // seam and answered synthetically; nothing reaches a node.
  const batch = await vite.ssrLoadModule("/src/lib/batchRun.js");
  const pre = await vite.ssrLoadModule("/src/components/batch/preflight.js");
  const sel = (await vite.ssrLoadModule("/src/lib/stores/selection.js")).selectionStore;

  let batchReq = null;
  const answerBatch = (body) => {
    globalThis.fetch = async (url, opts) => {
      const u = typeof url === "string" ? url : (url && url.url) || "";
      if (opts && opts.method === "POST" && /\/api\/v1\/servers\/commands$/.test(u)) {
        batchReq = { url: u, body: JSON.parse(opts.body || "null") };
        return new Response(JSON.stringify(body(batchReq.body)), { status: 202, headers: { "content-type": "application/json" } });
      }
      return realFetch(url, opts);
    };
  };

  answerBatch((req) => ({
    batchId: "batch_smoke1", runId: req.runId, verb: req.verb,
    admitted: [PROBE.id], refused: [{ serverId: "not-here", reason: "no such server on this host" }],
  }));
  const run1 = await batch.dispatchRun({
    verb: "stop",
    servers: [{ id: PROBE.id, hostId: hmId }, { id: "not-here", hostId: hmId }],
  });
  assert(batchReq && /\/api\/v1\/servers\/commands$/.test(batchReq.url)
    && batchReq.body.verb === "stop" && batchReq.body.origin === "ui"
    && Array.isArray(batchReq.body.serverIds) && batchReq.body.serverIds.length === 2,
    "dispatchRun → ONE POST /servers/commands per node, carrying the verb and every id for that node");
  assert(typeof batchReq.body.runId === "string" && batchReq.body.runId.startsWith("run_")
    && batchReq.body.runId === run1.runId,
    "the run id is minted by the CLIENT and sent verbatim — what makes a run reassemblable afterwards");
  assert(batchReq.body.force === undefined,
    "a run that did not ask to override sends NO force field");
  assert(run1.admitted.length === 1 && run1.admitted[0].serverId === PROBE.id
    && run1.refused.length === 1 && run1.refused[0].reason === "no such server on this host"
    && run1.undispatched.length === 0,
    "the summary is read from the node's answer — its refused[] is the authority for its own servers");

  // The fabrication guard. A batch member is patched QUEUED, never "running": writing "running" for
  // work sitting behind seven other servers claims something that is not happening.
  const queuedRow = st.serversStore.find(PROBE.id);
  assert(queuedRow && queuedRow.job && queuedRow.job.state === "queued" && queuedRow.job.verb === "stop",
    "an admitted member is patched QUEUED from the accept — never 'running'");
  assert(queuedRow.job.batchId === "batch_smoke1",
    "the queued job carries its batch, so a row is a way into the run it belongs to");
  // …and a queued job does not own the row's display status. A queued stop leaves the server reading
  // exactly what it is; "Stopping…" for twenty minutes about a server that is running is the same
  // fabrication wearing a pill.
  assert(queuedRow.status === queuedRow.runStatus,
    "a QUEUED job leaves the server's own run-state alone (only a running job owns the pill)");
  st.serversStore.patch(PROBE.id, { job: null });   // local only — nothing was ever sent

  // force reaches the wire only when asked for, and only on start.
  batchReq = null;
  answerBatch((req) => ({ batchId: "batch_smoke2", runId: req.runId, verb: req.verb, admitted: [], refused: [] }));
  await batch.dispatchRun({ verb: "start", servers: [{ id: PROBE.id, hostId: hmId }], force: true });
  assert(batchReq.body.force === true, "dispatchRun(force) → the whole batch carries force:true");
  batchReq = null;
  await batch.dispatchRun({ verb: "stop", servers: [{ id: PROBE.id, hostId: hmId }], force: true });
  assert(batchReq.body.force === undefined,
    "force is dropped on any verb but start — the API refuses it there, so it is never sent");

  // A node that never answered is UNDISPATCHED, not failed. Its share was never issued, and counting
  // it as a failure would claim commands nobody sent.
  globalThis.fetch = async (url, opts) => {
    const u = typeof url === "string" ? url : (url && url.url) || "";
    if (opts && opts.method === "POST" && /\/api\/v1\/servers\/commands$/.test(u)) throw new Error("connection refused");
    return realFetch(url, opts);
  };
  const runDead = await batch.dispatchRun({ verb: "stop", servers: [{ id: PROBE.id, hostId: hmId }] });
  assert(runDead.undispatched.length === 1 && runDead.undispatched[0].serverId === PROBE.id
    && runDead.admitted.length === 0 && runDead.refused.length === 0
    && runDead.nodesReached === 0 && runDead.nodesAsked === 1,
    "a node that never answered is reported UNDISPATCHED — never folded in as a failure");
  assert(!st.serversStore.find(PROBE.id).job,
    "nothing is patched for a node that never answered (no phantom queue on a server nobody asked)");
  globalThis.fetch = realFetch;

  // ---- the preflight's two gates verbGuard does not cover -------------------
  const stopped = { id: "s-idle", hostId: hmId, name: "s-idle", status: "online", capabilities: { watchdog: { status: "ok" } } };
  const busy = { ...stopped, id: "s-busy", name: "s-busy", job: { verb: "update", state: "running" } };
  const waiting = { ...stopped, id: "s-wait", name: "s-wait", job: { verb: "stop", state: "queued" } };
  const part = pre.partitionSelection([stopped, busy, waiting], "stop");
  assert(part.ready.length === 1 && part.ready[0].id === "s-idle",
    "preflight: a server with work already in flight is held back — verbGuard reads status only");
  const busyReason = part.refused.find(r => r.server.id === "s-busy").reason;
  const waitReason = part.refused.find(r => r.server.id === "s-wait").reason;
  assert(/update/i.test(busyReason) && /running/i.test(busyReason),
    "preflight: the refusal NAMES what is already happening (a reason that doesn't invites the identical retry)");
  assert(/stop/i.test(waitReason) && /queued/i.test(waitReason),
    "preflight: a QUEUED job is named as queued, not as 'already running' — it has not started");

  // The cumulative capacity forecast. capacityHint answers for one server against a live reading;
  // over a set, each member has to be judged against what the ones before it already committed,
  // because MemAvailable lags a process that started two seconds ago.
  const NODE2 = (freeMb) => ({ id: hmId, ram: { free_mb: freeMb }, memory_gate: { enabled: true, headroom_mb: 1024 } });
  const need = (id, mb) => ({ id, name: id, hostId: hmId, start_memory_mb: mb, start_memory_source: "blueprint" });
  const fc = pre.capacityForecast([need("a", 4096), need("b", 4096), need("c", 4096)], [NODE2(13000)], "start");
  assert(fc.rows[0].hint.freeMb === 13000 && fc.rows[1].hint.freeMb === 8904 && fc.rows[2].hint.freeMb === 4808,
    "capacity forecast: each member is judged against what the run has already committed on that node");
  assert(!fc.rows[0].hint.tight && !fc.rows[1].hint.tight && fc.rows[2].hint.tight && fc.tight.length === 1,
    "capacity forecast: the third start is the one that crosses the floor — the first two look fine alone");
  const fcNone = pre.capacityForecast([need("a", null), need("b", 4096)], [NODE2(13312)], "start");
  assert(fcNone.rows[0].hint === null && fcNone.rows[1].hint.freeMb === 13312,
    "capacity forecast: a member declaring no requirement commits NOTHING (the gate allows it rather than inventing a figure)");
  assert(pre.capacityForecast([need("a", 4096)], [NODE2(13312)], "stop").rows.length === 0,
    "capacity forecast: only a start has a capacity question to answer");

  // ---- the queued rendering: idle · queued · running ------------------------
  const { ServerActionButton } = await vite.ssrLoadModule("/src/components/ServerActions.jsx");
  const renderBtn = async (props) => {
    const node = w.document.createElement("div");
    const root = createRoot(node);
    root.render(React.createElement(ServerActionButton, { onRun: () => {}, ...props }));
    await sleep(30);
    const html = node.innerHTML;
    root.unmount();
    return html;
  };
  const qHtml = await renderBtn({ verb: "stop", variant: "chip", queuedVerb: "stop", queuedPosition: 3, queuedTotal: 8 });
  assert(qHtml.includes("Stop queued · 3rd of 8"),
    "a queued verb states its PLACE in the line — a count, never a predicted time");
  assert(!qHtml.includes("act-spin"),
    "a queued verb draws NO spinner — nothing is spinning");
  assert(/disabled/.test(qHtml), "a queued verb's own button is locked: the work is already committed");
  const noTotal = await renderBtn({ verb: "stop", variant: "chip", queuedVerb: "stop", queuedPosition: 3, queuedTotal: null });
  assert(noTotal.includes("Stop queued · 3rd") && !noTotal.includes(" of "),
    "with no member count stated yet, the label degrades to the position rather than guessing a denominator");
  const sibling = await renderBtn({ verb: "start", variant: "chip", queuedVerb: "stop", queuedPosition: 1, queuedTotal: 4 });
  assert(/disabled/.test(sibling) && !sibling.includes("queued"),
    "a sibling verb locks while another is queued, without claiming to be queued itself");
  const idle = await renderBtn({ verb: "stop", variant: "chip" });
  assert(!idle.includes("queued") && !/disabled/.test(idle), "idle is still idle");
  // The two constrained variants drop the verb rather than let an ellipsis eat the position. Measured
  // in Chromium: the tile's quick row gives a label ~82px and the hero's button 136px, and neither
  // fits the sentence. The verb is what the button already says; the place is what only the label can.
  const quickHtml = await renderBtn({ verb: "stop", variant: "quick", queuedVerb: "stop", queuedPosition: 3, queuedTotal: 8 });
  assert(/class="act-label">3rd of 8</.test(quickHtml),
    "the tile's quick row keeps the place and drops the verb — the row is 3 equal columns");
  const glassHtml = await renderBtn({ verb: "stop", variant: "glass", queuedVerb: "stop", queuedPosition: 3, queuedTotal: 8 });
  assert(glassHtml.includes("Queued · 3rd of 8"),
    "the hero's button has room for the state word as well as the place");
  assert(/title="Stop queued · 3rd of 8/.test(quickHtml) && /title="Stop queued · 3rd of 8/.test(glassHtml),
    "whatever the label had room for, the tooltip carries the whole sentence");

  const { ordinal } = await vite.ssrLoadModule("/src/lib/formatting.js");
  assert(ordinal(1) === "1st" && ordinal(2) === "2nd" && ordinal(3) === "3rd" && ordinal(4) === "4th"
    && ordinal(11) === "11th" && ordinal(12) === "12th" && ordinal(13) === "13th" && ordinal(21) === "21st",
    "ordinal: the teens are the exception a last-digit rule gets wrong");


  // ---- the node's job queue: two lanes, and the tail the store keeps --------
  // What a node is DOING and about to do. A settled command is not shown at all — it is an audit
  // row. Nothing here dispatches anything: the frames go in at the stream seam and the roster row is
  // patched and put back, the way the queued-button checks above work.
  const jobFrame = (id, over) => ({
    id, serverId: "jq-" + id, verb: "stop", state: "succeeded",
    createdAt: "2026-06-20T00:00:00Z", settledAt: "2026-06-20T00:00:01Z", error: null, ...over,
  });

  // (a) the envelope's origin reaches the stored job. A serverId no roster row carries, so the
  // accompanying server patch is a no-op for every other check in this file.
  api.__dispatch({ topic: "jobs", type: "job.patch", data: jobFrame("jq_origin", { state: "running" }) }, "jq-node-a");
  assert(st.jobsStore.get("jq_origin").hostId === "jq-node-a",
    "a job frame's ORIGIN reaches the stored job — a per-node queue is then a filter, not a roster lookup per row");
  api.__dispatch({ topic: "jobs", type: "job.patch", data: jobFrame("jq_origin") });
  assert(st.jobsStore.get("jq_origin").hostId === "jq-node-a",
    "a later frame carrying no origin does not erase the node already recorded for that job");

  // (b) a terminal state closes the row AND says what became of it. Collapsing all three terminal
  // words leaves only `error` to tell them apart, which reads a job nobody ran as one that succeeded.
  const jqCancelled = adapt.adaptJob({ id: "c", serverId: "s", verb: "stop", state: "cancelled",
    createdAt: "2026-06-20T00:00:00Z", settledAt: "2026-06-20T00:00:02Z" });
  assert(jqCancelled.state === "done" && jqCancelled.outcome === "cancelled" && jqCancelled.settledAt === "2026-06-20T00:00:02Z",
    "adaptJob: cancelled is terminal, names itself as the outcome, and carries the node's settle time");
  assert(adapt.adaptJob({ id: "c", serverId: "s", verb: "stop", state: "running" }).outcome === null,
    "adaptJob: a live job has no outcome — nobody has observed one");

  // (c) the settled tail is capped PER NODE, and live work is never in it. Nothing DISPLAYS the tail
  // — it is the eviction order that bounds `byId`, which `awaitJob` reads — and a tab fed by every
  // connected node for a week would otherwise hold every job the cluster ever ran.
  const JQ_CAP = 25;
  api.__dispatch({ topic: "jobs", type: "job.patch", data: jobFrame("jq_live", { state: "queued" }) }, "jq-node-a");
  for (let i = 0; i < JQ_CAP + 4; i++)
    api.__dispatch({ topic: "jobs", type: "job.patch", data: jobFrame("jq_a" + i) }, "jq-node-a");
  api.__dispatch({ topic: "jobs", type: "job.patch", data: jobFrame("jq_b0") }, "jq-node-b");
  api.__dispatch({ topic: "jobs", type: "job.patch", data: jobFrame("jq_b1") }, "jq-node-b");
  const jqSettled = (h) => st.jobsStore.getState().settled.map(id => st.jobsStore.get(id)).filter(j => j && j.hostId === h);
  assert(jqSettled("jq-node-a").length === JQ_CAP,
    `the settled tail keeps the last ${JQ_CAP} per node (kept ${jqSettled("jq-node-a").length} of ${JQ_CAP + 5})`);
  assert(!st.jobsStore.get("jq_a0") && !!st.jobsStore.get("jq_a" + (JQ_CAP + 3)),
    "the tail drops the OLDEST settled job, not the newest");
  assert(jqSettled("jq-node-b").length === 2,
    "the cap is per node — one busy node never evicts another node's settled work");
  assert(!!st.jobsStore.get("jq_live") && st.jobsStore.get("jq_live").state === "queued",
    "queued and running work is never dropped: only the settled tail is trimmed");

  // (d) the two cards, empty, and no prose. An empty queue is a node with nothing to do and reads
  // that way from the card titles alone. A reusable component states the data it has and nothing
  // else: no sentence explaining where history lives, what the registry is made of, or how a batch
  // is paced. Asserted as an ABSENCE because that is the only way the rule holds under a later edit.
  const JQ_HOST = PROBE.hostId;
  const jqEmpty = await nav("#/cluster/" + JQ_HOST + "/jobs");
  assert(jqEmpty.includes("Queued") && jqEmpty.includes("Running") && !jqEmpty.includes("Recently settled"),
    "the Jobs sub-tab renders both cards and shows no settled work");
  assert(jqEmpty.includes("Nothing queued") && jqEmpty.includes("Nothing running"),
    "an empty queue says so in each lane's own words");
  const jqCards = [...w.document.querySelectorAll(".jobq-card")];
  assert(jqCards.length === 2,
    "Queued and Running are TWO cards — independent components, each placeable on its own");
  assert(jqCards.every((c) => !/audit log|lives in|this browser|restart of that service/i.test(c.textContent || "")),
    "the job cards carry no explanatory prose — a component shows its data, it does not teach the system");
  assert(jqCards.every((c) => !!c.querySelector(".pin-btn")),
    "each card carries its OWN pin: either can go to a dashboard without the other");

  // (e) busy: a queued member states its place in the line, and a running one spins.
  const jqName = (st.serversStore.find(PROBE.id) || {}).name || PROBE.id;
  st.batchesStore.upsert("jq_batch", { counts: { total: 8 } });
  st.serversStore.patch(PROBE.id, { job: { verb: "stop", state: "queued", batchId: "jq_batch", queuedPosition: 3 } });
  const jqQueued = await nav("#/cluster/" + JQ_HOST + "/jobs");
  assert(jqQueued.includes("3rd of 8") && jqQueued.includes(jqName) && !jqQueued.includes("Nothing queued"),
    "a queued member names its server and its place in the batch's line — a count, never a predicted time");
  assert(jqQueued.includes("part of a batch"),
    "a row that belongs to a batch says so; a hand-issued command does not");

  st.serversStore.patch(PROBE.id, { job: { verb: "update", state: "running" } });
  const jqRunning = await nav("#/cluster/" + JQ_HOST + "/jobs");
  assert(jqRunning.includes("Updating…") && jqRunning.includes("act-spin") && jqRunning.includes("Nothing queued"),
    "running work is its own lane, with a spinner because something IS spinning — and queued is empty again");
  st.serversStore.patch(PROBE.id, { job: null });

  // ---- S4: the runs board — one run, however many nodes --------------------
  // A run is what a person started; a batch is one node's share of it. No node knows about any
  // other, so the run id every node was handed verbatim is the only thing that puts the shares back
  // together — including a run this browser never dispatched.
  //
  // NON-DESTRUCTIVE throughout: the hydrate is a real READ against the live backend, and the cancel
  // below is intercepted at the fetch seam. Nothing is dispatched and no batch is cancelled on a node.
  const hydrated = await st.batchesStore.refresh();
  assert(hydrated.hydrated === true && Object.values(hydrated.nodes).length > 0
    && Object.values(hydrated.nodes).every((n) => n.ok),
    "the tray hydrates from GET /batches?active=true on every connected node — a run that started before this tab opened is exactly who it is for");

  const TRAY_RUN = "run_smoke_tray";
  const trayMember = (serverId, state, extra) => ({ serverId, state, jobId: "j_" + serverId, error: null, settledAt: null, ...extra });
  const trayBatch = (id, hostId, state, counts, members, extra) => st.batchesStore.upsert(id, {
    id, hostId, runId: TRAY_RUN, verb: "update", state, actor: "smoke", origin: "ui",
    createdAt: "2026-08-22T10:00:00Z", settledAt: state === "settled" ? "2026-08-22T10:04:00Z" : null,
    counts, members, ...extra,
  });
  trayBatch("b_tray1", "tray-n1", "active",
    { total: 2, pending: 1, running: 1, succeeded: 0, failed: 0, refused: 0, cancelled: 0, unknown: 0 },
    [trayMember("tray-s1", "running"), trayMember("tray-s2", "pending", { queuedPosition: 2 })]);
  trayBatch("b_tray2", "tray-n2", "settled",
    { total: 2, pending: 0, running: 0, succeeded: 1, failed: 1, refused: 0, cancelled: 0, unknown: 0 },
    [trayMember("tray-s3", "succeeded"), trayMember("tray-s4", "failed", { error: "the engine refused it" })]);
  trayBatch("b_tray3", "tray-n3", "settled",
    { total: 1, pending: 0, running: 0, succeeded: 0, failed: 0, refused: 0, cancelled: 0, unknown: 1 },
    [trayMember("tray-s5", "unknown")]);

  const trayRuns = () => st.runsFrom(st.batchesStore.getState().byId);
  let trayRun = trayRuns().find((r) => r.runId === TRAY_RUN);
  assert(trayRun && trayRun.batches.length === 3 && trayRun.nodes.length === 3,
    "three nodes' batches carrying one run id reassemble into ONE run — the grouping IS the correlation");
  assert(trayRun.counts.total === 5 && trayRun.counts.succeeded === 1 && trayRun.counts.unknown === 1
    && trayRun.countsPartial === false,
    "the counts are each node's own `counts` summed — never re-derived from the member rows");
  assert(trayRun.state === "active",
    "a run is still active while ANY node's share is: two settled shares do not finish a run");
  assert(trayRun.members.length === 5 && trayRun.members.every((m) => m.hostId),
    "every member carries the node it belongs to — the merge unions and de-dups, and invents no attribution");

  // A node that has not stated its counts is NAMED as unreported rather than folded in as zero, which
  // would draw a run further along than anybody has been told it is.
  st.batchesStore.upsert("b_tray4", { id: "b_tray4", hostId: "tray-n4", runId: TRAY_RUN, verb: "update", state: "active", members: [] });
  trayRun = trayRuns().find((r) => r.runId === TRAY_RUN);
  assert(trayRun.countsPartial === true && trayRun.counts.total === 5,
    "a share that has reported no counts is stated as unreported — never counted as zero members");
  st.batchesStore.drop("b_tray4");

  // A node that recorded no run id holds a run of one. Pooling every id-less batch under one key
  // would invent a run nobody started.
  st.batchesStore.upsert("b_lonely", { id: "b_lonely", hostId: "tray-n1", runId: null, verb: "stop", state: "settled",
    createdAt: "2026-08-22T09:00:00Z", settledAt: "2026-08-22T09:01:00Z",
    counts: { total: 1, pending: 0, running: 0, succeeded: 1, failed: 0, refused: 0, cancelled: 0, unknown: 0 },
    members: [trayMember("tray-s9", "succeeded")] });
  assert(trayRuns().some((r) => r.key === "batch:b_lonely" && r.batches.length === 1),
    "a batch whose node recorded no run id is a run of ONE — never pooled with every other id-less batch");
  assert(trayRuns()[0].state === "active",
    "live runs sort ahead of finished ones: a run still going is why the tray is open");

  // Cancel. The request is asserted, never sent: a real DELETE here would stop work on a live node.
  st.batchesStore.upsert("b_live", { id: "b_live", hostId: hmId, runId: "run_smoke_cancel", verb: "stop", state: "active",
    createdAt: "2026-08-22T10:00:00Z",
    counts: { total: 3, pending: 2, running: 1, succeeded: 0, failed: 0, refused: 0, cancelled: 0, unknown: 0 },
    members: [trayMember("c-s1", "running"), trayMember("c-s2", "pending", { queuedPosition: 2 }), trayMember("c-s3", "pending", { queuedPosition: 3 })] });
  const deletes = [];
  globalThis.fetch = async (url, opts) => {
    const u = typeof url === "string" ? url : (url && url.url) || "";
    if (opts && opts.method === "DELETE" && /\/api\/v1\/batches\//.test(u)) {
      deletes.push(u);
      return new Response(JSON.stringify({ batchId: "b_live", cancelled: ["c-s2", "c-s3"], stillRunning: ["c-s1"] }),
        { status: 200, headers: { "content-type": "application/json" } });
    }
    return realFetch(url, opts);
  };
  const cancelled = await batch.cancelRun(trayRuns().find((r) => r.runId === "run_smoke_cancel"));
  assert(deletes.length === 1 && /\/api\/v1\/batches\/b_live\?/.test(deletes[0]),
    "cancelling a run is one DELETE per node holding a share of it — addressed to the node that owns the batch");
  assert(deletes[0].includes("origin=ui"),
    "the cancel declares its origin: the node writes an audit row for it, and the endpoint's default would file a panel cancel as an unattributed API call");
  assert(cancelled.cancelled.length === 2 && cancelled.stillRunning.length === 1
    && cancelled.stillRunning[0].serverId === "c-s1",
    "cancel reports what it could NOT stop as still running — an operator who reads 'cancelled' and watches a server stop anyway has been misled");
  assert(cancelled.untouched.length === 0 && cancelled.nodesReached === 1,
    "a node that answered is not reported as untouched");
  globalThis.fetch = realFetch;
  // The re-read the cancel fires settles the record: this node no longer has a batch by that id, so
  // it leaves the board rather than sitting on it as live work nobody can account for.
  await sleep(400);
  assert(!st.batchesStore.get("b_live"),
    "a batch the owning node no longer has a record of is dropped on the next read — never left on the board as live work");

  // A node that cannot be reached is STATED. Its share of any run is unknown, which is a different
  // sentence from having none — and the runs already known are not shrunk to match its silence.
  globalThis.fetch = async (url, opts) => {
    const u = typeof url === "string" ? url : (url && url.url) || "";
    if (/\/api\/v1\/batches/.test(u)) throw new Error("connection refused");
    return realFetch(url, opts);
  };
  await st.batchesStore.refresh();
  assert(st.batchesStore.unreachableNodes().length === 1,
    "a node that didn't answer the hydrate is recorded unreachable — never silently skipped");
  assert(trayRuns().find((r) => r.runId === TRAY_RUN).batches.length === 3,
    "a node going quiet does not shrink the runs already known: its silence is about ITS share");

  // The board itself, drawn with that node still silent so it has to say so. It reaches the
  // dashboard as the `fleet.runs` widget and lives nowhere else, so it is mounted the way the widget
  // host mounts it rather than opened out of a sidebar.
  const shellHtml = await nav("#/servers");
  assert(shellHtml.length > 200, "the shell still renders");
  assert(!w.document.querySelector(".opstray"),
    "the sidebar's foot holds no runs tray: the board is a widget somebody pins, and two trays a foot apart would read as one list");
  assert(!!w.document.querySelector(".notif .nav-item"),
    "the notifications tray keeps its place — it is this browser's own history and is what the foot is for");
  {
    const { getWidget } = await vite.ssrLoadModule("/src/lib/widgets/registry.js");
    await vite.ssrLoadModule("/src/pages/dashboard/catalog.js");
    const entry = getWidget("fleet.runs");
    assert(!!entry && (entry.params || []).length === 0,
      "the board is registered as `fleet.runs` and is bound to no node — which is what lets the Add-widget catalog offer it at all");
  }
  const { RunsBoard } = await vite.ssrLoadModule("/src/components/batch/RunsBoard.jsx");
  const boardNode = w.document.createElement("div");
  const boardRoot = createRoot(boardNode);
  boardRoot.render(React.createElement(RunsBoard));
  await sleep(300);
  const popText = boardNode.textContent || "";
  assert(popText.includes("Update") && popText.includes("on 3 nodes"),
    "a run names its verb once for the whole run and states the node count whenever it crosses more than one");
  assert(/couldn.t be read/.test(popText),
    "a node the board could not read is NAMED — a run drawn from the rest without saying so is a smaller run than the real one");
  assert(popText.includes("1 running") && popText.includes("1 queued") && popText.includes("1 unknown"),
    "the run's progress is the nodes' own counts, in their own words — 'unknown' keeps its hedge");
  assert(!/audit log|lives in|this browser|closing this doesn/i.test(popText),
    "the runs board carries no explanatory prose — a component shows its data, it does not teach the system");
  boardRoot.unmount();
  globalThis.fetch = realFetch;
  st.batchesStore.drop("b_tray1"); st.batchesStore.drop("b_tray2");
  st.batchesStore.drop("b_tray3"); st.batchesStore.drop("b_lonely");

  // ---- the selection store --------------------------------------------------
  sel.clear();
  sel.add([{ id: "x1", hostId: "n1" }, { id: "x2", hostId: "n2" }, { id: "x1", hostId: "n1" }]);
  assert(sel.getState().ids.length === 2 && sel.has("x1") && sel.has("x2"),
    "selection: ids are a set, and each carries the node its server belongs to");
  assert(JSON.stringify(batch.groupByHost(sel.entries()).get("n1")) === '["x1"]',
    "selection: grouped by node — a run that spans three nodes is three batches");
  sel.set({ id: "x1", hostId: "n1" }, false);
  assert(!sel.has("x1") && sel.has("x2"), "selection: deselecting drops the id and its node together");
  sel.keep(["x2"]);
  assert(sel.getState().ids.length === 1, "selection: a settled run narrows it to what still needs doing");
  sel.replace([{ id: "y1", hostId: "n1" }]);
  assert(sel.getState().ids.length === 1 && sel.has("y1"), "selection: replace takes exactly the set it is given");
  sel.clear();
  assert(sel.getState().ids.length === 0 && !w.localStorage.getItem("krystal:selection"),
    "selection: cleared, and NEVER persisted — it is a gesture, not a preference");

  // ---- favourites: an account preference, and the sidebar's shortcuts -------
  //
  // The opposite of the selection above: a favourite IS a preference, so it is persisted — and to
  // the account rather than to this browser, because it decides what the sidebar keeps a permanent
  // shortcut to and shortcuts that differ per device could not be reconciled by anybody.
  //
  // Nothing here reaches the node. The PUT is intercepted: this suite does not write to the host,
  // and a preference is still the host's state.
  {
    const { PREF_KEYS, prefsStore } = await vite.ssrLoadModule("/src/lib/stores/prefs.js");
    const fav = st.favoritesStore;
    const puts = [];
    globalThis.fetch = async (url, opts) => {
      const u = typeof url === "string" ? url : (url && url.url) || "";
      if (/\/me\/preferences\//.test(u) && opts && opts.method === "PUT") {
        puts.push({ url: u, body: JSON.parse(opts.body) });
        return new Response(JSON.stringify({ version: puts.length }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return realFetch(url, opts);
    };

    const before = fav.getState().ids.slice();
    for (const id of before) fav.set(id, false);
    puts.length = 0;

    // Starred from a server ROW, which is what records the node. The persisted entry carries both,
    // because a favourite the roster cannot find has two very different explanations and the node is
    // the only thing that tells them apart.
    fav.toggle(PROBE);
    assert(fav.has(PROBE.id) && fav.hostOf(PROBE.id) === PROBE.hostId,
      "a favourite records the NODE its server is on — an id alone cannot tell an unreachable node from a deleted server");
    assert(!w.localStorage.getItem("krystal:favorites")
      && JSON.parse(w.localStorage.getItem("krystal:pref:servers.favorites") || "[]").some((e) => e.id === PROBE.id),
      "it lands under the PREFERENCE key, not the browser-local one it used to live in");
    // The mirror is fire-and-forget by design — a write lands locally and returns, and the PUT
    // follows. So the value is asserted first, and the request after it has had a tick to leave.
    await sleep(80);
    assert(puts.length === 1 && puts[0].url.includes(encodeURIComponent(PREF_KEYS.SERVER_FAVORITES)),
      "favouriting writes the account preference `servers.favorites` — not a browser-local key");
    assert(Array.isArray(puts[0].body.value) && puts[0].body.value[0]
      && puts[0].body.value[0].id === PROBE.id && puts[0].body.value[0].hostId === PROBE.hostId,
      "the stored shape is {id, hostId} per entry — the node rides with the favourite, not beside it");
    assert(prefsStore.get(PREF_KEYS.SERVER_FAVORITES, null) !== null,
      "the value is readable synchronously the moment it is written — local-first, so the first render never waits on a round trip");

    // A bare id is still accepted (nothing in the app writes one, but a preference read back from an
    // older device can be a plain string array), and it records the node as unknown rather than
    // guessing one.
    fav.set("ghost-server", true);
    assert(fav.has("ghost-server") && fav.hostOf("ghost-server") === null,
      "a favourite made from an id alone holds a null node — never a guessed one");

    // Order is insertion order and NOTHING re-sorts it. A dock whose entries move when a server
    // changes state has stopped being a dock.
    if (OTHER) {
      fav.toggle(OTHER);
      assert(JSON.stringify(fav.getState().ids) === JSON.stringify([PROBE.id, "ghost-server", OTHER.id]),
        "favourites keep the order they were starred in — status never reorders a shortcut");
    }

    // The sidebar. Rendered directly, because what is being asserted is which rows it draws for a
    // given set of favourites — not how the shell arranges around it.
    const { Sidebar } = await vite.ssrLoadModule("/src/components/Sidebar.jsx");
    const hostsNow = st.hostsStore.getState().list;
    const sbNode = w.document.createElement("div");
    const sbRoot = createRoot(sbNode);
    const drawSidebar = async () => {
      sbRoot.render(React.createElement(Sidebar, {
        route: { kind: "home" }, onNavigate: () => {}, hosts: hostsNow,
        user: { name: "smoke", provider: "local" },
      }));
      await sleep(120);
      return sbNode;
    };

    await drawSidebar();
    const favRows = sbNode.querySelectorAll(".sidebar__favs .server-row");
    assert(favRows.length === fav.getState().ids.length,
      "the sidebar draws one row per favourite");
    assert(sbNode.querySelector(".sidebar__favs").textContent.includes(PROBE.name || PROBE.id),
      "a favourite's row names its server");

    // The favourite the roster does not hold. Its node is live and has no such server, so the
    // shortcut is stale and can be cleared from here.
    const ghostRow = [...favRows].find((r) => (r.getAttribute("data-tip") || "").startsWith("ghost-server"));
    assert(!!ghostRow && ghostRow.classList.contains("server-row--unknown"),
      "a favourite the roster cannot find is still DRAWN — one that vanished while a node rebooted would read as one somebody deleted");
    assert(!!ghostRow.querySelector(".server-row__dot--unknown") && !ghostRow.querySelector(".server-row__dot[style]"),
      "it carries the hollow dot: there is no reading, and a grey one would sit in the same vocabulary as 'offline'");
    assert(/records no node/.test(ghostRow.getAttribute("data-tip") || ""),
      "and it says WHY it cannot be read, rather than showing an unexplained blank");

    // Nothing starred → nothing rendered. No header, no placeholder, no invitation. This is what
    // lets the block hold permanent chrome at all.
    for (const id of fav.getState().ids.slice()) fav.set(id, false);
    await drawSidebar();
    assert(!sbNode.querySelector(".sidebar__favs"),
      "with no favourites the block renders NOTHING — not an empty state, which is how a sidebar entry earns permanence");
    assert(!!sbNode.querySelector(".nav-item"),
      "and the rest of the nav is untouched by its absence");

    sbRoot.unmount();
    // Put back whatever this profile held — while the mirror is STILL intercepted, so restoring the
    // suite's own state cannot become a write to the host.
    for (const id of before) fav.set(id, true);
    await sleep(80);
    globalThis.fetch = realFetch;
  }

  // kgsm's own words for a start the node has no room for, quoted exactly as the engine emits them
  // so a reworded message on either side fails this rather than passing quietly.
  const ENGINE_REFUSAL =
    "Not enough memory to start factorio-test: it needs 8192MB, the node has 2048MB available, "
    + "and starting it would leave -6144MB against a required floor of 1024MB.";
  const { runServerAction } = await vite.ssrLoadModule("/src/lib/serverActions.js");
  const { toastStore } = await vite.ssrLoadModule("/src/lib/toasts.js");

  // An ACCEPTED command that then FAILS must say why. This is the engine-refusal path — the memory
  // gate is the live instance of it: kgsm refuses a start the node has no room for, which happens
  // INSIDE the job, long after the 202. The reason rides the settled job's `error`, and nothing used
  // to read it, so a refused start was indistinguishable from one that never happened.
  //
  // Driven end to end: intercept the POST (nothing reaches the engine), then push the settle frame
  // the backend would have pushed, and assert the toast carries the engine's sentence VERBATIM —
  // that sentence is the half naming what to do about it.
  globalThis.fetch = async (url, opts) => {
    const u = typeof url === "string" ? url : (url && url.url) || "";
    if (opts && opts.method === "POST" && /\/api\/v1\/servers\/[^/]+\/commands$/.test(u)) {
      // Settle the job on the next turn, the way the real stream does: after the POST resolves and
      // `runServerAction` has begun awaiting it.
      setTimeout(() => api.__dispatch({
        topic: "jobs", type: "job.patch",
        data: {
          id: "job_refused", serverId: "factorio-test", verb: "start", state: "failed",
          createdAt: "2026-06-20T00:00:00Z", settledAt: "2026-06-20T00:00:01Z",
          error: ENGINE_REFUSAL,
        },
      }), 0);
      return new Response(JSON.stringify({ job: {
        id: "job_refused", serverId: "factorio-test", verb: "start",
        state: "queued", createdAt: "2026-06-20T00:00:00Z", settledAt: null, error: null,
      } }), { status: 202, headers: { "content-type": "application/json" } });
    }
    return realFetch(url, opts);
  };
  const toastsBefore = toastStore.getState().history.length;
  await runServerAction("start", { id: "factorio-test", hostId: hmId, name: "factorio-test", status: "offline" });
  const refusalToast = toastStore.getState().history.find(t => t.detail === ENGINE_REFUSAL);
  assert(!!refusalToast && refusalToast.tone === "error",
    "an accepted-then-failed start reports the ENGINE's reason verbatim (the memory-gate path)");
  assert(toastStore.getState().history.length > toastsBefore,
    "the refusal is recorded in the notifications history, not only on screen");
  globalThis.fetch = realFetch;

  // The Update chip is gated on the server's REAL state: lit only when the update-check
  // found a newer build AND the instance is stopped (kgsm refuses to update files in use),
  // and otherwise disabled carrying the reason the gate computed — a reason renders into
  // the title ONLY when the button is disabled, so its presence proves the gate ran. The
  // expectation is derived from the live row, so a probe server in any state is a valid
  // subject rather than a stale hardcoded one.
  const detailHtml = await nav("#/servers/" + PROBE.id);
  const pRow = st.serversStore.find(PROBE.id) || {};
  const updEnabled = !!pRow.update_available && pRow.status !== "online" && pRow.status !== "starting";
  const UPD_REASONS = ["Watchdog unavailable on this host", "On the latest build",
    "Checking for updates…", "Server must be stopped before updating"];
  const shownReason = UPD_REASONS.find((r) => detailHtml.includes(r)) || null;
  assert(updEnabled ? shownReason === null : shownReason !== null,
    `server detail: Update chip gated on live state (${updEnabled ? "enabled — stopped with a newer build" : "disabled: " + shownReason})`);

  // ---- placement: which disk the server is on, and moving it --------------
  // Read-only. The settings tab's Storage card names the library the LIVE row reports — nothing is
  // hardcoded, so a probe on any library is a valid subject — and the move control is gated on the
  // same fields the API gates on, so a card cannot offer what the node would refuse.
  {
    const settingsHtml = await nav("#/servers/" + PROBE.id + "/settings");
    const row = st.serversStore.find(PROBE.id) || {};
    if (row.library) {
      assert(settingsHtml.includes("Storage") && settingsHtml.includes(row.library),
        `server settings: Storage names the library the node reports (${row.library})`);
      // The reason renders in place of the blurb whenever the move cannot run — a running server,
      // an unmounted disk, or nowhere else to go. Its presence proves the gate ran rather than the
      // control being drawn blind.
      const BLOCKED = ["Stop the server before moving it.", "This server is being moved.",
        "Its library isn’t mounted", "nowhere else to put it", "No other library on this node is reachable"];
      const hostRow = st.hostsStore.find(row.hostId) || {};
      const elsewhere = (hostRow.libraries || []).filter((l) => l.online && l.name !== row.library);
      const movable = elsewhere.length > 0 && row.status !== "online" && row.status !== "starting"
        && row.status !== "moving" && row.libraryState !== "offline";
      const blockedReason = BLOCKED.find((r) => settingsHtml.includes(r)) || null;
      assert(movable ? blockedReason === null : blockedReason !== null,
        `server settings: the move control is gated on live state (${movable ? "offered" : "blocked: " + blockedReason})`);
    }
  }

  // The job verb a node reports for a move becomes the row's own busy word, which is what masks the
  // start/stop the engine performs partway through to confirm the server runs on its new disk. A pure
  // derivation over a synthetic frame — nothing is asked of the backend and no server is touched.
  {
    const probe = st.serversStore.find(PROBE.id) || {};
    const before = probe.status;
    st.serversStore.patch(PROBE.id, { job: { id: "job_smoke", verb: "move", state: "running" } });
    const during = (st.serversStore.find(PROBE.id) || {}).status;
    st.serversStore.patch(PROBE.id, { job: null });
    const after = (st.serversStore.find(PROBE.id) || {}).status;
    assert(during === "moving" || probe.libraryState === "offline",
      `servers store: a running move owns the row's status ("${before}" → "${during}")`);
    assert(after === before,
      `servers store: the settled move gives the run-state back ("${after}")`);
  }

  // ---- Phase 6: assistant turn SSE ----------------------------------------
  // The turn goes STRAIGHT to the assistant leaf on its own public origin, with a session the
  // leaf issued — kgsm-api is not in the path. NON-LEAF + deterministic: seed the route (the
  // capability's info.url) and a session, then intercept the outbound POST and feed a canned
  // stream, so the seam's SSE parser + frame translation are asserted whether or not a leaf is
  // running. Seeding touches only this process's stores; nothing reaches a backend.
  const { assistant } = await vite.ssrLoadModule("/src/lib/assistantClient.js");
  const { assistantSession } = await vite.ssrLoadModule("/src/lib/assistantSession.js");
  const LEAF = "https://assistant.smoke.invalid";
  st.hostsStore.patch(hmId, {
    capabilities: { ...(st.hostsStore.find(hmId).capabilities || {}),
      assistant: { provisioned: true, status: "operational", info: { url: LEAF } } },
  });
  assistantSession.adopt(hmId, { token: "smoke-leaf-token", refresh: null, tier: "admin" });
  assert(assistantSession.originOf(hmId) === LEAF && assistantSession.tokenOf(hmId) === "smoke-leaf-token",
    "assistant session: the leaf origin comes from the capability's info.url, with its own bearer");

  // ---- silent sign-in: what it costs, and what stops it looping ----------------------------
  // The assistant's sign-in is a full-page redirect, so `ensureSession` is ranked by cost and
  // guarded so it can never navigate the browser twice. `signIn` is spied at the seam (jsdom will
  // not navigate, and a real bounce would end the run).
  const SIGNIN_HOST = "silent-sso-host";
  st.hostsStore.add({
    id: SIGNIN_HOST, name: "Silent", capabilities: {
      assistant: { provisioned: true, status: "operational", info: { url: LEAF } } },
  });
  let signInCalls = [];
  assistantSession.__setNavigator((url) => signInCalls.push(url));

  // A live session buys nothing with a redirect.
  assert((await assistantSession.ensureSession(hmId)) === true && signInCalls.length === 0,
    "ensureSession: a live session neither rotates nor redirects");

  // A held refresh token is one silent request; spending a page navigation on it would be absurd.
  assistantSession.adopt(SIGNIN_HOST, { token: "t", refresh: "r", tier: "admin" });
  globalThis.fetch = async (url, opts) => {
    const u = typeof url === "string" ? url : (url && url.url) || "";
    if (opts && opts.method === "POST" && u === LEAF + "/auth/session/refresh")
      return new Response(JSON.stringify({ access: "rotated", refresh: "r2", tier: "admin" }),
        { status: 200, headers: { "content-type": "application/json" } });
    return realFetch(url, opts);
  };
  sessionStorage.removeItem("krystal:assistant:session:" + SIGNIN_HOST);   // a new tab: refresh only, no access
  assistantSession.seed();
  assert(assistantSession.statusOf(SIGNIN_HOST) === "bootstrapping",
    "seed: a refresh token with no access token is `bootstrapping`, not a reason to ask for a sign-in");
  const rotated = await assistantSession.ensureSession(SIGNIN_HOST);
  globalThis.fetch = realFetch;
  assert(rotated === true && signInCalls.length === 0,
    "ensureSession: a held refresh token is spent on a silent rotate, never on a redirect");

  // ---- what ends a leaf session, and what merely failed to ask ----------------------------
  // The refresh token is a thirty-day credential and the only thing standing between the user and
  // another sign-in, so it is discarded ONLY when the leaf refuses it. Each case drives the real
  // rotate through the fetch seam on its own host, so nothing here perturbs the sign-in assertions.
  const ROTATE_HOST = "rotate-host";
  st.hostsStore.add({
    id: ROTATE_HOST, name: "Rotate", capabilities: {
      assistant: { provisioned: true, status: "operational", info: { url: LEAF } } },
  });
  const refreshOf = () => localStorage.getItem("krystal:assistant:refresh:" + ROTATE_HOST);
  const answerRefresh = (fn) => {
    globalThis.fetch = async (url, opts) => {
      const u = typeof url === "string" ? url : (url && url.url) || "";
      if (u === LEAF + "/auth/session/refresh") return fn(JSON.parse(opts.body).refresh);
      return realFetch(url, opts);
    };
  };

  // The leaf never answered. We know nothing about the session, so the credential stays.
  assistantSession.adopt(ROTATE_HOST, { token: "t", refresh: "keep-me", tier: "admin" });
  answerRefresh(() => { throw new TypeError("Failed to fetch"); });
  assert((await assistantSession.rotate(ROTATE_HOST)) === null && refreshOf() === "keep-me"
      && assistantSession.statusOf(ROTATE_HOST) === "bootstrapping",
    "rotate: an unreachable leaf keeps the refresh token — a dropped packet is not a sign-out");

  // A leaf mid-restart answers 503. Same reasoning: it did not refuse, it did not answer.
  answerRefresh(() => new Response("nope", { status: 503 }));
  assert((await assistantSession.rotate(ROTATE_HOST)) === null && refreshOf() === "keep-me"
      && assistantSession.statusOf(ROTATE_HOST) === "bootstrapping",
    "rotate: a 5xx keeps the refresh token (the leaf did not refuse it — it did not answer)");

  // Two tabs, one shared token: the other tab rotated first, so ours is refused and the token it
  // won is already in storage. That is a superseded credential, not a dead session.
  localStorage.setItem("krystal:assistant:refresh:" + ROTATE_HOST, "won-by-another-tab");
  const presentedTokens = [];
  answerRefresh((presented) => {
    presentedTokens.push(presented);
    return presented === "won-by-another-tab"
      ? new Response(JSON.stringify({ access: "fresh", refresh: "r3", tier: "admin" }),
        { status: 200, headers: { "content-type": "application/json" } })
      : new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  });
  const healed = await assistantSession.rotate(ROTATE_HOST);
  assert(healed === "fresh" && presentedTokens.length === 2 && refreshOf() === "r3"
      && assistantSession.statusOf(ROTATE_HOST) === "live",
    "rotate: a 401 re-reads storage and retries with the token another tab won — neither tab is signed out");

  // Nothing newer to try: this is the session actually ending.
  answerRefresh(() => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }));
  assert((await assistantSession.rotate(ROTATE_HOST)) === null && refreshOf() === null
      && assistantSession.statusOf(ROTATE_HOST) === "expired",
    "rotate: a refused token with nothing newer behind it IS terminal — cleared, not kept");

  // A token whose own `exp` has passed buys nothing by being sent: the seam rotates first, so the
  // leaf never sees a bearer it was always going to refuse.
  // Padded base64 with the url-safe substitutions the seam undoes — an unpadded payload is a
  // decode the browser's atob may reject, which would test the catch rather than the expiry.
  const deadJwt = "x." + Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) - 60 }))
    .toString("base64").replace(/\+/g, "-").replace(/\//g, "_") + ".y";
  assistantSession.adopt(ROTATE_HOST, { token: deadJwt, refresh: "r4", tier: "admin" });
  const seen = [];
  globalThis.fetch = async (url, opts) => {
    const u = typeof url === "string" ? url : (url && url.url) || "";
    seen.push(u);
    if (u === LEAF + "/auth/session/refresh")
      return new Response(JSON.stringify({ access: "live-token", refresh: "r5", tier: "admin" }),
        { status: 200, headers: { "content-type": "application/json" } });
    if (u === LEAF + "/conversations")
      return new Response(JSON.stringify(
        { authorization: (opts.headers || {}).Authorization, conversations: [] }),
      { status: 200, headers: { "content-type": "application/json" } });
    return realFetch(url, opts);
  };
  const read = await assistant.host(ROTATE_HOST).conversations();
  globalThis.fetch = realFetch;
  assert(seen[0] === LEAF + "/auth/session/refresh" && seen.length === 2
      && read.authorization === "Bearer live-token",
    "assistant seam: a lapsed access token is rotated BEFORE the call, never spent on a 401 first");

  // Nothing held: this is what a redirect is for — exactly once per host per tab.
  assistantSession.signOut(SIGNIN_HOST);
  sessionStorage.removeItem("krystal:assistant:tried:" + SIGNIN_HOST);
  await assistantSession.ensureSession(SIGNIN_HOST);
  assert(signInCalls.length === 1
      && signInCalls[0].startsWith(LEAF + "/auth/discord/start?return_to=")
      && !signInCalls[0].includes("prompt=")
      && decodeURIComponent(signInCalls[0]).includes("assistant_login=" + SIGNIN_HOST),
    "ensureSession: no credential at all → ONE silent sign-in, no prompt param (⇒ the leaf's prompt=none) + the issuer marker");
  await assistantSession.ensureSession(SIGNIN_HOST);
  assert(signInCalls.length === 1,
    "ensureSession: the attempt marker stops a second bounce — a leaf that always refuses can't loop the browser");

  // A host with no public origin has nowhere to send the browser.
  st.hostsStore.add({
    id: "no-route-host", name: "NoRoute",
    capabilities: { assistant: { provisioned: true, status: "operational" } },
  });
  await assistantSession.ensureSession("no-route-host");
  assert(signInCalls.length === 1,
    "ensureSession: a leaf with no public origin is never redirected to (nowhere to go)");

  // Denied is terminal — retrying a role decision loops forever without changing the answer.
  signInCalls = [];
  assistantSession.deny(SIGNIN_HOST);
  sessionStorage.removeItem("krystal:assistant:tried:" + SIGNIN_HOST);
  await assistantSession.ensureSession(SIGNIN_HOST);
  assert(signInCalls.length === 0, "ensureSession: `denied` is terminal — never redirected again");

  // The visible fallback is the only thing that ever asks Discord for a consent screen.
  signInCalls = [];
  assistantSession.signIn(hmId, { prompt: "consent" });
  assert(signInCalls.length === 1 && signInCalls[0].includes("prompt=consent"),
    "signIn: the fallback button is the ONLY caller that asks for a consent screen");

  assistantSession.__setNavigator(null);
  st.hostsStore.remove(SIGNIN_HOST);
  st.hostsStore.remove("no-route-host");
  const enc = new TextEncoder();
  const CANNED = [
    'event: text.delta\ndata: {"type":"text.delta","text":"Let me check "}\n\n',
    'event: text.delta\ndata: {"type":"text.delta","text":"factorio-test."}\n\n',
    'event: tool.start\ndata: {"type":"tool.start","id":"tc_0_0","tool":"run_health_check","arguments":{"server_id":"factorio-test"}}\n\n',
    'event: tool.result\ndata: {"type":"tool.result","id":"tc_0_0","tool":"run_health_check","summary":"All checks passed (5/5)."}\n\n',
    'event: done\ndata: {"type":"done","text":"It looks healthy."}\n\n',
  ].join("");
  // Split the canned bytes at a boundary that falls MID-FRAME, to prove the parser
  // buffers across reads (a §5·a frame can arrive split over two chunks).
  const half = Math.floor(CANNED.length / 2) + 13;
  let leafTurnAuth = null;
  globalThis.fetch = async (url, opts) => {
    const u = typeof url === "string" ? url : (url && url.url) || "";
    if (opts && opts.method === "POST" && u === LEAF + "/turn") {
      leafTurnAuth = (opts.headers || {}).Authorization || null;
      const parts = [CANNED.slice(0, half), CANNED.slice(half)];
      const stream = new ReadableStream({ start(c) { for (const p of parts) c.enqueue(enc.encode(p)); c.close(); } });
      return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
    }
    return realFetch(url, opts);
  };
  const frames = [];
  await assistant.host(hmId).turn({ prompt: "is factorio-test healthy?" }, { onEvent: (e) => frames.push(e) })
    .catch((e) => frames.push({ type: "__throw__", message: e.message }));
  globalThis.fetch = realFetch;
  assert(leafTurnAuth === "Bearer smoke-leaf-token",
    "assistant turn: POSTed to the LEAF origin with the leaf's own bearer (no kgsm-api in the path)");
  const types = frames.map((f) => f.type).join(",");
  assert(types === "text.delta,text.delta,tool.start,tool.result,done",
    `assistant turn: SSE parsed into the ordered §5·a frames (${types})`);
  const streamed = frames.filter((f) => f.type === "text.delta").map((f) => f.text).join("");
  assert(streamed === "Let me check factorio-test.",
    "assistant turn: text.delta slices reassemble across a mid-frame chunk boundary");
  const ts = frames.find((f) => f.type === "tool.start");
  const tr = frames.find((f) => f.type === "tool.result");
  assert(ts && ts.id === "tc_0_0" && ts.tool === "run_health_check", "assistant turn: tool.start carries id + tool name");
  assert(tr && tr.id === "tc_0_0" && tr.summary === "All checks passed (5/5).",
    "assistant turn: tool.result pairs to its start by id + carries the summary");

  // Pre-stream degrade surfaces as a thrown apiError (NOT a silent empty turn): a
  // provisioned-but-down assistant answers 503 BEFORE the stream commits, so the
  // SPA can render the honest reason instead of an empty bubble.
  globalThis.fetch = async (url, opts) => {
    const u = typeof url === "string" ? url : (url && url.url) || "";
    if (opts && opts.method === "POST" && u === LEAF + "/turn")
      return new Response(JSON.stringify({ error: { code: "unavailable", message: "the assistant is currently unavailable" } }),
        { status: 503, headers: { "content-type": "application/json" } });
    return realFetch(url, opts);
  };
  let turnErr = null;
  await assistant.host(hmId).turn({ prompt: "x" }, { onEvent: () => {} }).catch((e) => { turnErr = e; });
  globalThis.fetch = realFetch;
  assert(turnErr && turnErr.code === 503,
    `assistant turn: pre-stream degrade (503) throws an apiError the SPA renders (code=${turnErr && turnErr.code})`);

  // The frame→message translation is a pure reducer (sendLive wraps it in setConvos). Tool calls
  // ride ON the assistant bubble (tools[]) — grouped under its turn, NOT spliced as a separate row
  // before it. Exercise a TWO-turn sequence: tool-call ids reset per turn (tc_0_0), so turn-2's
  // tool.result must resolve ITS tool, which each bubble owning only its own tools gives for free.
  // The running label rides ON the frame — the assistant owns its tools, so it owns what they are
  // called; the SPA keeps no list of tool names to go stale.
  const { reduceTurnFrame: R } = await vite.ssrLoadModule("/src/pages/ChatPage.jsx");
  let m = [{ role: "user", content: "q1" }, { role: "assistant", content: "" }];
  m = R(m, { type: "text.delta", text: "Checking " });
  m = R(m, { type: "text.delta", text: "factorio-test…" });
  m = R(m, { type: "tool.start", id: "tc_0_0", tool: "run_health_check", label: "Running health check" });
  m = R(m, { type: "tool.result", id: "tc_0_0", summary: "5/5 passed" });
  m = R(m, { type: "done", text: "All healthy." });
  const bubble1 = m.find((x) => x.role === "assistant");
  const tool1 = bubble1.tools && bubble1.tools.find((t) => t.id === "tc_0_0");
  assert(tool1 && tool1.state === "done" && tool1.label === "Running health check" && tool1.summary === "5/5 passed",
    "reduceTurnFrame: tool.start→tool on the bubble; tool.result resolves it by id (the leaf's label + summary, turn 1)");
  assert(m[m.length - 1].role === "assistant" && m[m.length - 1].content === "All healthy.",
    "reduceTurnFrame: text.delta streams into the bubble; done reconciles it to the full reply");
  // Turn 2 — same turn-local tool id reused on a fresh bubble.
  m = [...m, { role: "user", content: "q2" }, { role: "assistant", content: "" }];
  m = R(m, { type: "tool.start", id: "tc_0_0", tool: "get_status" });
  m = R(m, { type: "tool.result", id: "tc_0_0", summary: "online" });
  const bubbles = m.filter((x) => x.role === "assistant");
  const t1 = bubbles[0].tools.find((t) => t.id === "tc_0_0");
  const t2 = bubbles[1].tools.find((t) => t.id === "tc_0_0");
  assert(bubbles.length === 2 && t1.summary === "5/5 passed" && t2.summary === "online" && t1.state === "done" && t2.state === "done",
    "reduceTurnFrame: turn-2 tool.result (reused id) resolves turn-2's tool, NOT turn-1's resolved one");
  assert(t2.label === "Get status",
    `reduceTurnFrame: a label-less tool.start falls back to the prettified tool name, never a blank pill (${t2.label})`);

  // ---- Phase 5c: structured tool.result → rich Evidence card --------------
  // A `tool.result` carrying the §5·a `result` envelope (run_health_check →
  // HealthData) is projected onto the bubble as a `health` Evidence card, ALONGSIDE
  // the resolved text pill (additive). A result-less tool.result adds no card —
  // honest, no fabrication. The pure adapter is exercised directly too.
  const { adaptResultCard: A } = await vite.ssrLoadModule("/src/pages/ChatPage.jsx");
  let hm = [{ role: "user", content: "health?" }, { role: "assistant", content: "" }];
  hm = R(hm, { type: "tool.start", id: "tc_0_0", tool: "run_health_check" });
  hm = R(hm, { type: "tool.result", id: "tc_0_0", summary: "passed with warnings (1/2)",
    result: { tool: "run_health_check", confidence: "confirmed",
      subject: { resource: "server", id: "factorio-test" },
      data: { overall: "warn", passed: 1, total: 2, skipped: 0, checks: [
        { name: "liveness", state: "pass", severity: "success", detail: "Running." },
        { name: "updates", state: "warn", severity: "update", detail: "Update available." },
      ] } } });
  hm = R(hm, { type: "done", text: "One thing to watch." });
  const hbub = hm.find((x) => x.role === "assistant");
  const hcard = hbub.cards && hbub.cards[0];
  assert(hcard && hcard.kind === "health" && hcard.serverId === "factorio-test"
    && hcard.confidence === "confirmed" && hcard.passes === 1 && hcard.warns === 1 && hcard.fails === 0
    && hcard.checks.length === 2 && hcard.checks[0].label === "Server" && hcard.checks[1].status === "warn",
    "reduceTurnFrame: structured tool.result → a `health` Evidence card on the bubble (counts + labels from HealthData)");
  const hpill = hbub.tools && hbub.tools[0];
  assert(hpill && hpill.state === "done" && hpill.summary === "passed with warnings (1/2)",
    "reduceTurnFrame: structured result is additive — the resolved tool pill keeps its summary");
  let nm = [{ role: "user", content: "status?" }, { role: "assistant", content: "" }];
  nm = R(nm, { type: "tool.start", id: "tc_0_0", tool: "get_status" });
  nm = R(nm, { type: "tool.result", id: "tc_0_0", summary: "online" });
  nm = R(nm, { type: "done", text: "It's online." });   // complete the turn — cards only promote on the terminal frame
  const nbub = nm.find((x) => x.role === "assistant");
  assert(!nbub.cards && !nbub.pendingCards,
    "reduceTurnFrame: a result-less tool.result adds no card (honest — text pill only)");
  assert(A({ tool: "get_status", subject: { id: "x" }, data: { servers: [] } }).kind === "fleet"
    && A({ tool: "run_health_check", confidence: "likely", subject: { id: "y" },
         data: { passed: 0, total: 1, skipped: 0, checks: [{ name: "disk", state: "fail", detail: "94% full" }] } }).fails === 1,
    "adaptResultCard: get_status fleet → fleet card; run_health_check → card with computed fail count");
  // get_status fleet (FleetStatusData) → a `fleet` Evidence card; stopped is neutral
  // (idle, not red), an unreadable server stays unknown/warn with its reason (never stopped).
  let fm = [{ role: "user", content: "status?" }, { role: "assistant", content: "" }];
  fm = R(fm, { type: "tool.start", id: "tc_0_0", tool: "get_status" });
  fm = R(fm, { type: "tool.result", id: "tc_0_0", summary: "2 running, 1 stopped, 1 unavailable",
    result: { tool: "get_status", confidence: "confirmed", subject: { resource: "host", id: "primary" },
      data: { running: 2, stopped: 1, unavailable: 1, total: 4, servers: [
        { instance: "factorio-test", state: "running", severity: "success", reason: null },
        { instance: "terraria-hardmode", state: "stopped", severity: "info", reason: null },
        { instance: "valheim", state: "unknown", severity: "warn", reason: "Could not read run-state." },
      ] } } });
  // Cards are STAGED on the bubble while the turn streams and promoted to `cards` by the
  // terminal frame, so a card assertion has to complete the turn — reading `cards` off a
  // still-open bubble sees nothing (the health case above does the same via its own done).
  fm = R(fm, { type: "done", text: "Here's the fleet." });
  const fcard = (fm.find((x) => x.role === "assistant").cards || [])[0];
  assert(fcard && fcard.kind === "fleet" && fcard.confidence === "confirmed"
    && fcard.summary === "2 running · 1 stopped · 1 unavailable" && fcard.servers.length === 3
    && fcard.servers[0].tone === "success" && fcard.servers[1].tone === "idle"
    && fcard.servers[2].tone === "warn" && fcard.servers[2].state === "unknown"
    && fcard.servers[2].reason === "Could not read run-state.",
    "reduceTurnFrame: get_status fleet result → a `fleet` card (running=success, stopped=idle, unreadable=warn+reason)");

  // search (SearchData) → a `search` Evidence card with cited passages + provenance (local vs web).
  let sm = [{ role: "user", content: "how do I port-forward?" }, { role: "assistant", content: "" }];
  sm = R(sm, { type: "tool.start", id: "tc_0_0", tool: "search" });
  sm = R(sm, { type: "tool.result", id: "tc_0_0", summary: "From the operator's indexed docs …",
    result: { tool: "search", confidence: "confirmed", subject: { resource: "search", id: "port forward" },
      data: { query: "port forward", state: "localStrong", passages: [
        { provenance: "local", source: "docs/networking.md", title: "Networking > Ports", text: "Open UDP 2456…", score: 0.82 },
        { provenance: "web", source: "https://example.org/ports", title: "Port forwarding guide", text: "Forward the port…", score: 0.6 },
      ] } } });
  sm = R(sm, { type: "done", text: "Forward the port." });
  const scard = (sm.find((x) => x.role === "assistant").cards || [])[0];
  assert(scard && scard.kind === "search" && scard.confidence === "confirmed" && scard.query === "port forward"
    && scard.provenance === "mixed" && scard.state === "localStrong" && scard.passages.length === 2
    && scard.passages[0].origin === "local" && scard.passages[0].source === "docs/networking.md"
    && scard.passages[1].origin === "web" && scard.passages[1].source === "https://example.org/ports",
    "reduceTurnFrame: search result → a `search` card (cited passages, local+web provenance = mixed)");
  assert(A({ tool: "search", subject: { id: "q" }, data: { query: "q", state: "empty", passages: [] } }) === null,
    "adaptResultCard: an empty search (no passages) surfaces no card — summary-only, honest");

  // ---- Phase 6b: command proposals ---------------------------------------
  // A command.proposed → a confirm-first card; Confirm hands the staged token back to the LEAF,
  // which performs the action and answers a verdict (no double-write, no fabricated audit row);
  // the SPA renders the verified block from that verdict.
  const { LEAF_COMMAND_VERBS: LEAF_VERBS, composeVerified: CV } = await vite.ssrLoadModule("/src/pages/ChatPage.jsx");
  const { capUsable } = await vite.ssrLoadModule("/src/lib/capabilities.js");

  // (1) the reducer splices the card FROM THE PROPOSAL (not a store lookup), and
  //     `done` reorders it BELOW the reply (reply → action).
  let cm = [{ role: "user", content: "start it" }, { role: "assistant", content: "" }];
  cm = R(cm, { type: "text.delta", text: "I can start factorio-test." });
  cm = R(cm, { type: "command.proposed", id: "cmd_0", verb: "start",
    subject: { resource: "server", id: "factorio-test" }, confirm: "Start factorio-test?", token: "tok_inert" });
  const card0 = cm.find((x) => x.role === "command");
  assert(card0 && card0.verb === "start" && card0.subjectId === "factorio-test"
    && card0.confirm === "Start factorio-test?" && card0.state === "proposed",
    "reduceTurnFrame: command.proposed → a confirm-first card from the proposal (verb/subject/confirm)");
  cm = R(cm, { type: "done", text: "Ready when you are." });
  const ci = cm.findIndex((x) => x.role === "command");
  const bi = cm.findIndex((x) => x.role === "assistant");
  assert(bi >= 0 && ci === bi + 1 && cm[bi].content === "Ready when you are.",
    "reduceTurnFrame: done moves the command card BELOW the reply (reply → action)");

  // (2) verb gating — every kind the leaf can perform is runnable from the panel; `blueprint` is
  //     excluded because the review card owns its own Save, and `open_ports` because the leaf can no
  //     longer stage one (ports open with an instance's run and close with it).
  assert(["start", "stop", "restart", "install", "uninstall", "update", "backup", "set_config", "write_file"]
      .every((v) => LEAF_VERBS.has(v)) && !LEAF_VERBS.has("blueprint") && !LEAF_VERBS.has("open_ports"),
    "command verbs: all nine of the leaf's confirmation kinds are runnable; `blueprint` has its own Save");

  // (2b) install proposal — subject is a BLUEPRINT and the custom name rides its own field.
  let im = [{ role: "user", content: "install factorio called mybase" }, { role: "assistant", content: "" }];
  im = R(im, { type: "command.proposed", id: "cmd_i", verb: "install",
    subject: { resource: "blueprint", id: "factorio" }, instanceName: "mybase",
    confirm: "Install factorio?", token: "tok_inert" });
  const icard = im.find((x) => x.role === "command");
  assert(icard && icard.verb === "install" && icard.subjectId === "factorio" && icard.instanceName === "mybase",
    "reduceTurnFrame: install proposal keeps the blueprint as subject and the custom name in instanceName");

  const settledOf = (verdict, extra) => ({ success: verdict === "settled" || verdict === "accepted",
    outcome: { verdict, ...(extra || {}) } });
  const okI = CV("install", "mybase", settledOf("settled"));
  assert(okI.ok === true && /Installed mybase/.test(okI.headline),
    "composeVerified: install settled → 'Installed mybase' (no fabricated id)");
  const okU = CV("uninstall", "factorio-test", settledOf("settled"));
  assert(okU.ok === true && /Uninstalled factorio-test/.test(okU.headline),
    "composeVerified: uninstall settled → 'Uninstalled factorio-test'");

  // (3) the verified block is RENDERED FROM THE VERDICT, never parsed out of `text` — the leaf is
  // free to reword `text`, and two surfaces reading it differently is how they come to disagree
  // about whether a server actually started.
  const okV = CV("start", "factorio-test", settledOf("settled", { observedState: "running" }));
  assert(okV.ok === true && /Started factorio-test/.test(okV.headline),
    "composeVerified: settled → ok + 'Started …' headline");
  const accV = CV("backup", "factorio-test", settledOf("accepted"));
  assert(accV.ok === true && /Backed up factorio-test/.test(accV.headline),
    "composeVerified: accepted (a verb with no run-state postcondition) → ok, and claims nothing about run state");
  const failV = CV("stop", "factorio-test", { success: false, outcome: { verdict: "failed", reason: "engine refused" } });
  assert(failV.ok === false && failV.lines.some((l) => /engine refused/.test(l.detail)),
    "composeVerified: failed → not-ok + the leaf's real reason as a line (no fabrication)");
  const nsV = CV("start", "factorio-test", { success: false, outcome: { verdict: "notSettled", observedState: "stopped" } });
  assert(nsV.ok === false && /hasn’t come up yet/.test(nsV.headline)
      && nsV.lines.some((l) => /stopped/.test(l.detail)),
    "composeVerified: notSettled → not-ok, says it may still be working, and reports what WAS seen");
  const unkV = CV("start", "factorio-test", { success: false, outcome: { verdict: "unknown" } });
  assert(unkV.ok === false && /state couldn’t be read/.test(unkV.headline) && !/stopped/.test(unkV.headline),
    "composeVerified: unknown → honest 'couldn’t be read', NEVER rendered as stopped");
  const refV = CV("stop", "factorio-test", { success: false, text: "That action is no longer valid.", outcome: { verdict: "refused" } });
  assert(refV.ok === false && /no longer valid/.test(refV.headline),
    "composeVerified: refused → the leaf's own non-oracular sentence (nothing ran)");
  // An unrecognised verb still renders — a newer leaf must never produce a blank card here.
  const newV = CV("some_future_verb", "factorio-test", settledOf("settled"));
  assert(newV.ok === true && /some_future_verb/.test(newV.headline) && /factorio-test/.test(newV.headline),
    "composeVerified: an unknown verb falls back to a readable headline (forward-compatible)");

  // (4) THE GLUE — the confirm path end to end. A staged card's token goes back to the LEAF that
  // staged it (captured → a canned confirm stream), its progress steps drive the card's live
  // sub-label, and the terminal `result` renders through composeVerified. There is no second
  // execution path: nothing here touches kgsm-api, and the LIVE confirm does not mutate the audit
  // store (the backend writes that row from the kgsm echo — the no-double-write proof).
  const confirmStream = (result, steps) => new ReadableStream({
    start(c) {
      for (const label of steps || [])
        c.enqueue(enc.encode(`event: progress\ndata: ${JSON.stringify({ type: "progress", label })}\n\n`));
      c.enqueue(enc.encode(": keepalive\n\n"));   // the leaf's 15s heartbeat — must be skipped, not parsed
      c.enqueue(enc.encode(`event: result\ndata: ${JSON.stringify({ type: "result", ...result })}\n\n`));
      c.close();
    },
  });
  let confirmCap = null;
  const interceptConfirm = (result, steps) => {
    globalThis.fetch = async (url, opts) => {
      const u = typeof url === "string" ? url : (url && url.url) || "";
      if (opts && opts.method === "POST" && u === LEAF + "/confirm") {
        confirmCap = { url: u, body: JSON.parse(opts.body || "null"), auth: (opts.headers || {}).Authorization || null };
        return new Response(confirmStream(result, steps), { status: 200, headers: { "content-type": "text/event-stream" } });
      }
      return realFetch(url, opts);
    };
  };

  const auditLenBefore = st.auditStore.getState().list.length;
  const progressSeen = [];
  interceptConfirm(
    { text: "factorio-test is running.", success: true,
      outcome: { verdict: "settled", verb: "start", instance: "factorio-test", observedState: "running" } },
    ["Waiting for factorio-test to come up…"]);
  const settled = await assistant.host(hmId).confirm({ token: "tok_start" },
    { onProgress: (e) => progressSeen.push(e.label) });
  globalThis.fetch = realFetch;
  assert(confirmCap && confirmCap.url === LEAF + "/confirm" && confirmCap.body.token === "tok_start"
    && confirmCap.auth === "Bearer smoke-leaf-token",
    "confirm → POST {leaf}/confirm { token } with the leaf's bearer (the staged token IS the authority)");
  assert(progressSeen.length === 1 && /come up/.test(progressSeen[0]),
    "confirm: the leaf's progress steps reach the card's live sub-label");
  assert(settled.outcome && settled.outcome.verdict === "settled" && settled.outcome.observedState === "running",
    "confirm: the terminal `result` frame carries the whole response, verdict included (heartbeat skipped)");
  const rendered = CV("start", "factorio-test", settled);
  assert(rendered.ok === true && /Started factorio-test/.test(rendered.headline),
    "confirm → composeVerified: the observed verdict becomes the verified block");
  assert(st.auditStore.getState().list.length === auditLenBefore,
    "LIVE confirm does NOT fabricate an audit row (backend writes it from the kgsm echo — no double-write)");

  // (4b) `update` and `backup` are runnable verbs. They have no run-state postcondition, so the
  // leaf answers `accepted` — a success that deliberately claims nothing about whether the server
  // is up. A verb missing from the runnable set renders with no Run button at all.
  assert(LEAF_VERBS.has("update") && LEAF_VERBS.has("backup") && LEAF_VERBS.has("set_config"),
    "runnable verbs: update / backup / set_config are executable from the panel (the leaf performs all ten kinds)");
  interceptConfirm({ text: "Backed up factorio-test.", success: true,
    outcome: { verdict: "accepted", verb: "backup", instance: "factorio-test" } });
  const backedUp = await assistant.host(hmId).confirm({ token: "tok_backup" }, {});
  globalThis.fetch = realFetch;
  assert(backedUp.outcome.verdict === "accepted" && backedUp.outcome.observedState === undefined,
    "confirm: an `accepted` verb reports NO observedState (there is no run state to have observed)");

  // (4c) a lifecycle command the leaf could not settle must not read as a success, and must report
  // what it actually saw rather than rounding it to "stopped".
  interceptConfirm({ text: "factorio-test hasn't come up.", success: false,
    outcome: { verdict: "notSettled", verb: "start", instance: "factorio-test", observedState: "stopped" } });
  const notSettled = await assistant.host(hmId).confirm({ token: "tok_slow" }, {});
  globalThis.fetch = realFetch;
  const nsRendered = CV("start", "factorio-test", notSettled);
  assert(nsRendered.ok === false && nsRendered.lines.some((l) => /stopped/.test(l.detail)),
    "confirm: notSettled renders not-ok WITH the observed state (never a fabricated ✓)");

  // (4d) a host whose assistant capability names no public origin has NO browser route. The chat
  // must say so rather than fall back to kgsm-api's relay, which would restore the coupling the
  // direct path removes — and the capability itself must read as unusable, not operational.
  const capsWithUrl = st.hostsStore.find(hmId).capabilities;
  st.hostsStore.patch(hmId, { capabilities: { ...capsWithUrl, assistant: { provisioned: true, status: "operational" } } });
  let noRouteErr = null;
  await assistant.host(hmId).confirm({ token: "t" }, {}).catch((e) => { noRouteErr = e; });
  assert(noRouteErr && noRouteErr.code === "ENOROUTE",
    "no public origin → the leaf call is refused with an honest no-route error, never relayed through kgsm-api");
  assert(capUsable(st.hostsStore.find(hmId), "assistant") === false,
    "no public origin → the assistant capability reads UNUSABLE (down), not operational-then-failing");
  st.hostsStore.patch(hmId, { capabilities: capsWithUrl });

  // (5) awaitJob (the shared job settler the backups surface uses) is race-free — a terminal frame
  // already in the store before we await still resolves (check-current-then-subscribe).
  globalThis.fetch = async (url, opts) => {
    const u = typeof url === "string" ? url : (url && url.url) || "";
    if (opts && opts.method === "POST" && /\/api\/v1\/servers\/[^/]+\/commands$/.test(u))
      return new Response(JSON.stringify({ job: { id: "job_race", serverId: "factorio-test", verb: "stop", state: "queued", error: null } }),
        { status: 202, headers: { "content-type": "application/json" } });
    return realFetch(url, opts);
  };
  api.__dispatch({ topic: "jobs", type: "job.patch", data: { id: "job_race", serverId: "factorio-test", verb: "stop", state: "succeeded", error: null } });
  await st.commandServer({ id: "factorio-test", hostId: hmId }, "stop", "ui");
  const raced = await st.awaitJob("job_race", hmId);
  globalThis.fetch = realFetch;
  assert(raced.status === "succeeded",
    "awaitJob: a terminal frame already in the store resolves (check-then-subscribe, no missed-frame window)");

  // (5b) the give-up is SOCKET-LIVENESS-gated, NOT wall-clock (advisor): a slow job that sits at
  // `running` with NO frames far longer than the dead window, while the socket is UP, must KEEP
  // WAITING and still resolve on the late `done` — surrendering on elapsed time would flip a
  // command that actually succeeds into a stale, permanent "couldn't confirm". A sustained-DOWN
  // socket (the outcome frame can't arrive) is the ONLY give-up trigger. Timing + liveness are
  // injected so both paths are fast+exact.
  st.__setJobTiming({ pollMs: 10, deadMs: 40, liveProbe: () => true });   // socket UP
  const slowP = st.awaitJob("job_slow", hmId);
  await sleep(20);
  api.__dispatch({ topic: "jobs", type: "job.patch", data: { id: "job_slow", serverId: "factorio-test", verb: "start", state: "running" } });
  await sleep(120);                              // >> dead window: a slow `running` with the socket up must NOT give up
  api.__dispatch({ topic: "jobs", type: "job.patch", data: { id: "job_slow", serverId: "factorio-test", verb: "start", state: "succeeded", error: null } });
  const slow = await slowP;
  assert(slow.status === "succeeded",
    "awaitJob: a slow job (long silent `running`) with the socket UP keeps waiting → resolves on the late done (NOT a wall-clock give-up)");
  st.__setJobTiming({ pollMs: 10, deadMs: 40, liveProbe: () => false });  // socket DOWN, never a frame
  const dead = await st.awaitJob("job_dead", hmId);
  assert(dead.status === "unknown",
    "awaitJob: a sustained-DOWN socket (no frame can arrive) resolves to honest 'unknown' after the grace");
  st.__setJobTiming(null);                       // restore production timing

  // (5c) the `done` reorder is TURN-SCOPED — a second turn's card must not drag the
  // first turn's card along (the 9a two-turn precedent: single-turn coverage is blind).
  let tt = [{ role: "user", content: "q1" }, { role: "assistant", content: "" }];
  tt = R(tt, { type: "text.delta", text: "reply 1" });
  tt = R(tt, { type: "command.proposed", id: "cmd_a", verb: "start", subject: { resource: "server", id: "srv-a" }, confirm: "Start srv-a?" });
  tt = R(tt, { type: "done", text: "reply 1" });
  tt = [...tt, { role: "user", content: "q2" }, { role: "assistant", content: "" }];
  tt = R(tt, { type: "text.delta", text: "reply 2" });
  tt = R(tt, { type: "command.proposed", id: "cmd_b", verb: "stop", subject: { resource: "server", id: "srv-b" }, confirm: "Stop srv-b?" });
  tt = R(tt, { type: "done", text: "reply 2" });
  // The card is located by its VERB, not the frame's id: the assistant's `command.proposed`
  // id is a per-turn counter that repeats across turns, so the SPA mints its own unique
  // cmdId locally and the wire id is never what identifies a card in the transcript.
  const ai1 = tt.findIndex((x) => x.role === "assistant" && x.content === "reply 1");
  const ca = tt.findIndex((x) => x.role === "command" && x.verb === "start");
  const ai2 = tt.findIndex((x) => x.role === "assistant" && x.content === "reply 2");
  const cb = tt.findIndex((x) => x.role === "command" && x.verb === "stop");
  assert(ca === ai1 + 1 && cb === ai2 + 1 && ca < ai2,
    "reduceTurnFrame: done-reorder is turn-scoped — turn-1's card stays after reply-1, doesn't migrate past turn-2");
  assert(tt[ca].cmdId && tt[cb].cmdId && tt[ca].cmdId !== tt[cb].cmdId,
    "reduceTurnFrame: each card gets its OWN locally-minted cmdId (the wire id repeats per turn — two cards must not collide)");

  // (6) the COMPONENT renders (not just the pure helpers): a runnable proposal shows the
  // confirm-first action, and a verb outside the runnable set renders disabled with the honest
  // reason — exercising ChatCommand itself, not only the reducer/composer.
  const { ChatCommand } = await vite.ssrLoadModule("/src/pages/ChatPage.jsx");
  const renderCmd = async (msg) => {
    const node = w.document.createElement("div");
    const root = createRoot(node);
    root.render(React.createElement(ChatCommand, { msg, onRun: () => {} }));
    await sleep(30);
    const html = node.innerHTML;
    root.unmount();
    return html;
  };
  const startHtml = await renderCmd({ role: "command", cmdId: "cmd_0", verb: "start", subjectId: "factorio-test", confirm: "Start factorio-test?", state: "proposed" });
  assert(startHtml.includes("Start") && startHtml.includes("factorio-test") && !startHtml.includes("Not available"),
    "ChatCommand: a runnable proposal renders a confirm-first action");
  const updHtml = await renderCmd({ role: "command", cmdId: "cmd_1", verb: "update", subjectId: "factorio-test", confirm: "Update factorio-test?", state: "proposed" });
  assert(updHtml.includes("Update") && updHtml.includes("factorio-test") && !updHtml.includes("Not available"),
    "ChatCommand: `update` is runnable — the leaf performs it, so the panel offers it");
  const unrunHtml = await renderCmd({ role: "command", cmdId: "cmd_2", verb: "diagnose", subjectId: "factorio-test", confirm: "Diagnose?", state: "proposed" });
  assert(unrunHtml.includes("Not available from the panel yet") && /disabled/.test(unrunHtml),
    "ChatCommand: a verb outside the runnable set renders disabled with an honest reason (no dead button)");

  // ---- the card ramp: rescales both ways, never wider than its box ------------------------
  // The chips reserve a fixed box so a live row stops shuffling when a value gains a digit, and that
  // only holds while the formatter keeps its side of the bargain: four characters, always. The two
  // ways it can break are a value that rounds up into a fifth character (1023 B) and one that stops
  // rescaling, so both are pinned here rather than left to a screenshot.
  {
    const { fmtBytesTight } = await vite.ssrLoadModule("/src/lib/formatting.js");
    const cases = [[0, "0B"], [355, "355B"], [1023, "1.0K"], [2048, "2.0K"], [123245, "120K"],
                   [4494725120, "4.2G"], [10572480878, "9.8G"], [14230456357, "13G"],
                   [1024 ** 4, "1.0T"]];
    for (const [bytes, want] of cases)
      assert(fmtBytesTight(bytes) === want,
        `card ramp: ${bytes} reads "${want}" (got "${fmtBytesTight(bytes)}")`);

    // Sweep to the largest byte count a double holds exactly: no reading may ever be wider than the
    // box that reserves room for it. This is not belt-and-braces — it is what caught 9.9949 printing
    // as "10.0" (toFixed rounds to the nearest tenth) and the top unit having nothing to promote into.
    let widest = "";
    for (let n = 0; n < Number.MAX_SAFE_INTEGER; n = Math.max(n + 1, Math.floor(n * 1.0007))) {
      const s = fmtBytesTight(n);
      if (s.length > widest.length) widest = s;
    }
    assert(widest.length <= 4,
      `card ramp: no value renders wider than 4 characters across the whole range (widest "${widest}")`);
    assert(fmtBytesTight(null) === "—" && fmtBytesTight(undefined) === "—",
      "card ramp: not-measured stays an em-dash — the ramp can never turn a null into 0B");
  }

  // ---- card metrics: cpu/mem/net are a running server's, disk is every server's ----------
  // The split this proves is the whole reason `diskBytes` sits outside the metrics block: the
  // monitor walks its watch-list, so a STOPPED instance reports what it occupies while having no
  // sample to report. A card that showed "—" for disk on an offline server would be hiding a
  // measurement, and one that showed 0% cpu would be inventing one.
  {
    const rows = st.serversStore.getState().list.filter((s) => !s._phantom);
    const measured = rows.filter((s) => s.diskBytes != null);
    assert(measured.length > 0,
      `card metrics: the /servers list carries a measured disk footprint (${measured.length}/${rows.length} rows)`);

    const offline = measured.find((s) => s.status === "offline");
    if (offline) {
      assert(offline.metrics == null && offline.cpu == null && offline.rxBps == null,
        `card metrics: a stopped server (${offline.id}) reports NO sample — cpu/mem/net are honest-null, never 0`);
      assert(offline.diskBytes > 0,
        `card metrics: that same stopped server still reports its footprint (${offline.diskBytes} bytes)`);

      // The tile itself, not just the store: disk renders, the run-dependent chips render "—".
      const { ServerTile } = await vite.ssrLoadModule("/src/components/ServerCard.jsx");
      const node = w.document.createElement("div");
      const root = createRoot(node);
      root.render(React.createElement(ServerTile,
        { server: offline, onOpen: () => {}, onAction: () => {}, showHost: false }));
      await sleep(40);
      const html = node.innerHTML;
      root.unmount();
      const { fmtBytesTight } = await vite.ssrLoadModule("/src/lib/formatting.js");
      const tight = fmtBytesTight(offline.diskBytes);
      assert(html.includes(">" + tight + "<"),
        `ServerTile: an offline server's card shows the disk it occupies (${tight})`);
      assert((html.match(/—/g) || []).length >= 3,
        "ServerTile: cpu, memory and network render em-dashes on an offline card — nothing measured, nothing shown");
    } else {
      console.log("• card metrics: every server on this host is running — skipped the stopped-server "
        + "proofs (stop one to cover them; this smoke will not).");
    }

    // Presence on the card and in the fleet line — the two figures that must never contradict each
    // other, and the null that must never become a 0 in either.
    const { ServerTile: Tile } = await vite.ssrLoadModule("/src/components/ServerCard.jsx");
    const { fleetSummary, playerTally } = await vite.ssrLoadModule("/src/lib/servers.js");

    const renderTile = async (server) => {
      const node = w.document.createElement("div");
      const root = createRoot(node);
      root.render(React.createElement(Tile, { server, onOpen: () => {}, onAction: () => {}, showHost: false }));
      await sleep(40);
      const html = node.innerHTML;
      root.unmount();
      return html;
    };

    const seen = rows.find((s) => s.players);
    if (seen) {
      const html = await renderTile(seen);
      assert(html.includes(">" + seen.players.current + "<"),
        `ServerTile: a server whose presence is visible shows its count (${seen.id} → ${seen.players.current})`);
    } else {
      console.log("• presence: no server on this host reports a count — skipped the count-on-the-card proof.");
    }

    const unseen = rows.find((s) => !s.players);
    if (unseen) {
      const html = await renderTile(unseen);
      assert(html.includes("can't see who is connected"),
        `ServerTile: a server whose presence is unobservable says so (${unseen.id}) — never a 0`);
    } else {
      console.log("• presence: every server on this host reports presence — skipped the unobservable-card proof.");
    }

    // The fleet line, off the LIVE roster: its total is the sum of the counts that exist, and nothing
    // else. This is the check that pins the dashboard's greeting to real data.
    const tally = playerTally(rows);
    const expected = rows.reduce((n, s) => n + (s.players ? s.players.current : 0), 0);
    assert(tally.total === expected,
      `fleet tally: the total is the sum of the measured counts (${tally.total})`);
    assert(fleetSummary(rows).includes(`${tally.total} player`),
      `fleet line: the live roster renders its real total (${fleetSummary(rows)})`);

    // The failure this replaced: an unobservable server summed as 0 and never mentioned.
    const synthetic = [
      { id: "a", status: "online", players: { current: 2, max: null } },
      { id: "b", status: "online", players: null },
      { id: "c", status: "offline", players: null },
    ];
    const line = fleetSummary(synthetic);
    assert(line.includes("2 players connected"),
      "fleet line: an unobservable server is left OUT of the total, never added as 0");
    assert(line.includes("1 server can't report who's on"),
      "fleet line: it says how many servers it can't see — and counts only the ones not measurably stopped");

    // The roster frame the cards stay live from: rows merge onto the store's metric fields and
    // touch nothing else. Applied directly (no engine, no writes) — the transport is kgsm-api's.
    const target = rows[0];
    if (target) {
      const before = { status: target.status, job: target.job, notice: target.notice };
      st.serversStore.mergeRosterMetrics(
        [{ id: target.id, metrics: { cpu: 12.5, memBytes: 1073741824, ioReadBps: null, ioWriteBps: null,
                                     pids: 7, diskBytes: null, rxBps: 2048, txBps: 512 }, diskBytes: 4096 }],
        target.hostId);
      const after = st.serversStore.find(target.id);
      assert(after.cpu === 13 && after.rxBps === 2048 && after.diskBytes === 4096,
        "roster metrics: a metrics.roster row merges cpu/net/disk onto the card's row");
      assert(after.status === before.status && after.job === before.job && after.notice === before.notice,
        "roster metrics: the merge touches metrics ONLY — a metric feed never says what a server IS");

      st.serversStore.mergeRosterMetrics([{ id: target.id, metrics: null, diskBytes: 4096 }], target.hostId);
      const stopped = st.serversStore.find(target.id);
      assert(stopped.cpu === null && stopped.rxBps === null && stopped.diskBytes === 4096,
        "roster metrics: a row with no sample blanks cpu/net to null (never 0) and keeps the footprint");

      await st.serversStore.refresh();  // put the real readings back
    }
  }

  // ---- server note (MOTD) -------------------------------------------------
  // The note is ENGINE-owned (it lives in the kgsm instance's own config), so writing one
  // is a journal event on the operator's real host — see THE ONE RULE. Split accordingly:
  // the READ path is proven against a server that genuinely has a note (found on the live
  // roster, never written here), and the WRITE path is proven by intercepting what the SPA
  // sends. That the body survives the SOURCED config verbatim is the engine+api contract,
  // covered by kgsm-api's ServerNoteWriteTests.
  const noteRow = st.serversStore.getState().list.find((s) => s.notice);
  if (noteRow) {
    // The note must ride the LIST DTO, not just the dedicated endpoint — the dashboard tile
    // renders one without ever fetching a detail. This row came from GET /servers, so its
    // populated .notice IS that proof.
    assert(typeof noteRow.notice === "string" && noteRow.notice.length > 0,
      `server note: rides the /servers list DTO (adaptServer → .notice on ${noteRow.id}), so a tile needs no detail fetch`);

    // The dedicated endpoint agrees with the list, and carries the backend's attribution.
    const detail = (await api.host(noteRow.hostId || hmId).get("/servers/" + noteRow.id + "/note")).note;
    assert(detail && detail.body === noteRow.notice,
      "server note: GET /servers/{id}/note agrees with the list DTO (one decoded body, not two)");
    assert(detail.updatedBy && detail.updatedAt,
      `server note: the backend stamps who wrote it and when (${detail.updatedBy})`);

    // The card itself renders the text and the byline — the component, not just the store.
    const { ServerNotice } = await vite.ssrLoadModule("/src/components/ServerNotice.jsx");
    const renderNote = async (server, canEdit) => {
      const node = w.document.createElement("div");
      const root = createRoot(node);
      root.render(React.createElement(ServerNotice, { server, canEdit }));
      await sleep(30);
      const html = node.innerHTML;
      root.unmount();
      return html;
    };
    const noteHtml = await renderNote(noteRow, true);
    assert(noteHtml.includes(noteRow.notice.split("\n")[0].slice(0, 24)) && noteHtml.includes("Server note"),
      "ServerNotice: renders the live note body inside the card");
    assert(noteHtml.includes("edited by"),
      "ServerNotice: renders the backend's attribution byline (never a guessed author)");
    const noteEmptyHtml = await renderNote({ ...noteRow, notice: "", note: null }, false);
    assert(noteEmptyHtml === "",
      "ServerNotice: a player viewing a server with no note gets nothing at all (no dead box)");
  } else {
    console.log("• server note: no server on this host has a note set — skipped the read-path proofs "
      + "(set one from the panel to cover them; this smoke will not write one)");
  }

  // The write path, intercepted: a body PUTs with origin:'ui', and an EMPTY body routes to
  // DELETE rather than an empty PUT — that routing decision is the SPA's own (the backend
  // refuses an empty write), so an accidentally-emptied editor can never silently wipe a
  // note. Both are asserted on the request the FE builds; neither reaches the engine.
  {
    const realFetch = globalThis.fetch;
    // saveServerNote patches the local roster row on resolve, so snapshot the probe's real
    // note and put it back afterwards — the store must keep matching the backend for every
    // later render (nothing on the host is touched either way).
    const probeNoteBefore = st.serversStore.find(PROBE.id);
    const restoreProbeNote = () => st.serversStore.find(PROBE.id) && st.serversStore.patch(PROBE.id,
      { note: probeNoteBefore.note ?? null, notice: probeNoteBefore.notice ?? "" });
    let noteReq = null;
    globalThis.fetch = async (url, opts) => {
      const u = typeof url === "string" ? url : (url && url.url) || "";
      if (/\/api\/v1\/servers\/[^/]+\/note(\?|$)/.test(u) && opts && /^(PUT|DELETE)$/.test(opts.method || "")) {
        noteReq = { url: u, method: opts.method, body: opts.body ? JSON.parse(opts.body) : null };
        const isPut = opts.method === "PUT";
        return new Response(JSON.stringify({ note: isPut
          ? { body: (noteReq.body || {}).body, updatedBy: "discord:smoke", updatedAt: "2026-06-20T00:00:00Z" }
          : null }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return realFetch(url, opts);
    };
    try {
      const NOTE_TEXT = "smoke: mods v1 — quotes \" $dollars `ticks`\nand a second line";
      const written = await st.saveServerNote(hmId, PROBE.id, NOTE_TEXT);
      assert(noteReq && noteReq.method === "PUT" && noteReq.url.endsWith("/servers/" + PROBE.id + "/note")
        && noteReq.body.body === NOTE_TEXT && noteReq.body.origin === "ui",
        "saveServerNote → PUT /servers/{id}/note { body, origin:'ui' } (the body is sent verbatim, unescaped)");
      assert(written && written.body === NOTE_TEXT,
        "saveServerNote: resolves with the backend's authoritative note (not the string it was handed)");
      noteReq = null;
      const cleared = await st.saveServerNote(hmId, PROBE.id, "");
      assert(noteReq && noteReq.method === "DELETE" && noteReq.url.includes("origin=ui"),
        "saveServerNote: an empty body routes to DELETE /servers/{id}/note?origin=ui (never an empty PUT)");
      assert(cleared === null, "saveServerNote: a clear resolves null (the store drops the notice)");
    } finally {
      globalThis.fetch = realFetch;
      restoreProbeNote();
    }
  }

  // ---- display name (the label a server is read by) -----------------------
  // The label lives in the kgsm instance's own config, so writing one is a journal event on the
  // operator's real host — the note's split applies verbatim. READ against the live roster; the
  // WRITE proven on the request the SPA builds.
  {
    // Every row carries a label, and it is never blank: an instance nobody has named reads as its
    // id. That is what lets every surface render `server.name` with no fallback of its own, and it
    // is the adapter's guarantee (`be.name ?? be.id`), asserted here against real rows.
    const roster = st.serversStore.getState().list.filter((x) => !x._phantom);
    assert(roster.length > 0 && roster.every((x) => typeof x.name === "string" && x.name.length > 0),
      `every server on the live roster carries a non-blank label (${roster.length} rows) — an unnamed instance reads as its id`);

    const { IdentitySection } = await vite.ssrLoadModule("/src/pages/serverSettings/IdentitySection.jsx");
    const renderIdentity = async (server) => {
      const node = w.document.createElement("div");
      const root = createRoot(node);
      root.render(React.createElement(IdentitySection, { server }));
      await sleep(30);
      const html = node.innerHTML;
      root.unmount();
      return html;
    };
    const idHtml = await renderIdentity(PROBE);
    assert(idHtml.includes(PROBE.id) && idHtml.includes("Instance id"),
      "IdentitySection: states the immutable instance id beside the label it can change");
    assert(idHtml.includes("Display name") && idHtml.includes("srv-rename"),
      "IdentitySection: an operator gets the rename field on the server it is rendered for");
    // The no-prose rule (root CLAUDE.md): this card shows two names and offers to change one. It
    // does not explain what a rename does to the id, however tempting that sentence is.
    assert(!/\b(is renamed|never changes|keeps its history|decorat|identif)/i.test(idHtml),
      "IdentitySection: carries no explanatory prose — a component shows its data, it does not teach the system");

    const realFetch = globalThis.fetch;
    const nameBefore = st.serversStore.find(PROBE.id).name;
    let nameReq = null;
    globalThis.fetch = async (url, opts) => {
      const u = typeof url === "string" ? url : (url && url.url) || "";
      if (/\/api\/v1\/servers\/[^/]+\/display-name(\?|$)/.test(u) && opts && /^(PUT|DELETE)$/.test(opts.method || "")) {
        nameReq = { url: u, method: opts.method, body: opts.body ? JSON.parse(opts.body) : null };
        // The backend re-reads the engine and answers what it STORED. A clear answers the id, which
        // is what makes an unlabelled instance read as its id with nothing client-side deciding so.
        const stored = opts.method === "PUT" ? (nameReq.body || {}).displayName : PROBE.id;
        return new Response(JSON.stringify({ serverId: PROBE.id, displayName: stored }),
          { status: 200, headers: { "content-type": "application/json" } });
      }
      return realFetch(url, opts);
    };
    try {
      const LABEL = "Smoke Sunday Server";
      const written = await st.setServerDisplayName(hmId, PROBE.id, LABEL);
      assert(nameReq && nameReq.method === "PUT"
        && nameReq.url.endsWith("/servers/" + PROBE.id + "/display-name")
        && nameReq.body.displayName === LABEL && nameReq.body.origin === "ui",
        "setServerDisplayName → PUT /servers/{id}/display-name { displayName, origin:'ui' } — the route takes the ID, never the label");
      assert(written === LABEL && st.serversStore.find(PROBE.id).name === LABEL
        && st.serversStore.find(PROBE.id).id === PROBE.id,
        "setServerDisplayName: the store takes the backend's authoritative label; the id is untouched");
      nameReq = null;
      const clearedName = await st.setServerDisplayName(hmId, PROBE.id, "   ");
      assert(nameReq && nameReq.method === "DELETE" && nameReq.url.includes("origin=ui"),
        "setServerDisplayName: an empty label routes to DELETE (never an empty PUT, which the backend refuses)");
      assert(clearedName === PROBE.id && st.serversStore.find(PROBE.id).name === PROBE.id,
        "setServerDisplayName: a cleared server reads as its id again");
    } finally {
      globalThis.fetch = realFetch;
      if (st.serversStore.find(PROBE.id)) st.serversStore.patch(PROBE.id, { name: nameBefore });
    }
  }

  // ---- Phase 7: integrations wiring ---------------------------------------
  // A real persistent round-trip through the host-scoped client (admin under
  // auth-disabled), against the notification provider this API actually registers.
  // NON-DESTRUCTIVE: every mutation is reverted; baseline here is an unconfigured
  // webhook, so the set→clear leaves it as found.
  //
  // Discord is deliberately NOT one of these providers — kgsm-bot owns that channel
  // and its announcement switches live in its own leaf config — so asking for it here
  // is a 404, asserted below as the contract it now is.
  const ig = () => api.host(hmId).get("/integrations/slack");
  const base = await ig();
  assert(base && base.provider === "slack" && Array.isArray(base.events) && base.events.length > 0,
    `integrations GET: live provider view (${base.events.length} server-defined events)`);
  // honest catalog — the FE's fabricated mock-only events are NOT in the live set
  assert(!base.events.some((e) => e.id === "join" || e.id === "lowdisk"),
    "integrations GET: server catalog omits player-join / resource events (no honest source) — not faked");

  let discordErr = null;
  await api.host(hmId).get("/integrations/discord").catch((e) => { discordErr = e; });
  assert(discordErr && discordErr.code === 404,
    `integrations GET: discord is not a provider here — kgsm-bot owns that channel (code=${discordErr && discordErr.code})`);

  // toggle round-trip: flip 'online', confirm it persisted, restore it
  const before = base.events.find((e) => e.id === "online");
  await api.host(hmId).patch("/integrations/slack", { events: [{ id: "online", enabled: !before.enabled }] });
  const flipped = await ig();
  assert(flipped.events.find((e) => e.id === "online").enabled === !before.enabled,
    "integrations PATCH: an event toggle persists (GET-back confirms)");
  await api.host(hmId).patch("/integrations/slack", { events: [{ id: "online", enabled: before.enabled }] });
  assert((await ig()).events.find((e) => e.id === "online").enabled === before.enabled,
    "integrations PATCH: toggle restored to baseline");

  // webhook round-trip (baseline unconfigured → set a VALID-FORMAT but fake URL,
  // never delivered; then clear). Assert the secret never echoes back.
  if (!base.webhook.configured) {
    const FAKE = "https://hooks.slack.com/services/T00000000/B00000000/SMOKEtok_DO_NOT_DELIVER_AAAAAAAAAAAAAAAA";
    try {
      await api.host(hmId).patch("/integrations/slack", { webhook: FAKE });
      const set = await ig();
      assert(set.webhook.configured === true && !!set.webhook.hint,
        "integrations PATCH: webhook set → configured:true + a masked hint");
      assert(!JSON.stringify(set).includes("SMOKEtok_DO_NOT_DELIVER"),
        "integrations GET: the raw webhook secret NEVER echoes back (masked hint only)");
    } finally {
      // ALWAYS clear — a throw between set and clear must not leave the fake webhook
      // on the (persistent) dev host, especially as the stack is left up between runs.
      await api.host(hmId).patch("/integrations/slack", { webhook: "" }).catch(() => {});
    }
    assert((await ig()).webhook.configured === false, "integrations PATCH: explicit clear removes the webhook (baseline restored)");
  } else {
    console.log("• integrations: webhook already configured on this host — skipped the set/clear round-trip (non-destructive)");
  }

  // /test on an unconfigured webhook is the honest 409 (no send, no channel spam)
  let testErr = null;
  await api.host(hmId).post("/integrations/slack/test").catch((e) => { testErr = e; });
  assert(testErr && testErr.code === 409,
    `integrations /test: unconfigured webhook → honest 409, never a faked ok (code=${testErr && testErr.code})`);

  // ---- Phase 7b: Files (file browser & editor — Tier 3 #12) --------------
  // The operator-gated GET/PUT /servers/{id}/files surface behind the FileBrowser
  // page. Proofs: (1) the page RENDERS the real working-dir tree in the app (view,
  // full stack); (2) a live round-trip through the host-scoped client's new
  // get/put seam — list (dirs-first) → read (etag) → save-back IDENTICAL bytes
  // (200, unchanged etag) → stale-etag (412) → traversal escape (404). The save is
  // NON-DESTRUCTIVE (re-writes identical content; same sha256).
  const fSv = (st.serversStore.getState().list.find((s) => s.id === "factorio-test")
            || st.serversStore.getState().list[0] || {}).id;
  if (fSv) {
    let filesHtml = await nav("#/servers/" + fSv + "/files");
    for (let i = 0; i < 12 && !/\.config\.ini|\bsaves\b|\binstall\b/.test(filesHtml); i++) {
      await sleep(150); filesHtml = w.document.getElementById("root").innerHTML;
    }
    assert(/\.config\.ini|\bsaves\b|\binstall\b/.test(filesHtml) && !/Something went wrong/i.test(filesHtml),
      "Files page: renders the real working-dir tree (view path, full stack)");

    const listing = await api.host(hmId).get("/servers/" + fSv + "/files");
    assert(listing && Array.isArray(listing.entries)
      && listing.entries.some((e) => e.kind === "dir") && listing.entries.some((e) => e.kind === "file"),
      `Files list: dirs + files returned (${listing && listing.entries ? listing.entries.length : 0} entries)`);
    const firstFileIdx = listing.entries.findIndex((e) => e.kind === "file");
    const lastDirIdx = listing.entries.map((e) => e.kind).lastIndexOf("dir");
    assert(firstFileIdx === -1 || lastDirIdx === -1 || lastDirIdx < firstFileIdx,
      "Files list: dirs sort before files (deterministic truncation order)");

    const cfg = listing.entries.find((e) => e.kind === "file" && e.editable !== false
                  && /\.(ini|cfg|conf|txt|properties|json)$/.test(e.name))
             || listing.entries.find((e) => e.kind === "file" && e.editable !== false);
    if (cfg) {
      const p = "/servers/" + fSv + "/files/content?path=" + encodeURIComponent(cfg.name);
      const read = await api.host(hmId).get(p);
      assert(read && typeof read.content === "string" && /^sha256:/.test(read.etag || ""),
        "Files read: raw text + sha256 etag");
      // The SUCCESS path is not exercised live: a 200 save writes a file.write audit row
      // (ServerFilesController writes audit only on FileOp.Ok), so it is a mutation — see
      // THE ONE RULE. What belongs to the SPA is the request it builds, asserted at the
      // fetch seam; that a real 200 leaves the bytes and etag intact is kgsm-api's contract,
      // covered by its ServerFilesWriteTests against a disposable instance.
      {
        const realFetch = globalThis.fetch;
        let putReq = null;
        globalThis.fetch = async (url, opts) => {
          const u = typeof url === "string" ? url : (url && url.url) || "";
          if (opts && opts.method === "PUT" && /\/api\/v1\/servers\/[^/]+\/files\/content\?/.test(u)) {
            putReq = { url: u, body: JSON.parse(opts.body || "null") };
            return new Response(JSON.stringify({ path: cfg.name, sizeBytes: read.content.length,
              mtime: "2026-06-20T00:00:00Z", etag: read.etag }),
              { status: 200, headers: { "content-type": "application/json" } });
          }
          return realFetch(url, opts);
        };
        try {
          await st.filesStore.saveFile(hmId, fSv, cfg.name, read.content, read.etag).catch(() => {});
          assert(putReq && putReq.url.includes("path=" + encodeURIComponent(cfg.name))
            && putReq.body.content === read.content && putReq.body.etag === read.etag
            && putReq.body.origin === "ui",
            "saveFile → PUT /servers/{id}/files/content?path= { content, etag, origin:'ui' } (etag-conditional, never blind)");
        } finally { globalThis.fetch = realFetch; }
      }

      // The REJECTION paths run for real — both are refused before any byte is written
      // (kgsm-lib's expected-etag write returns EtagMismatch without touching the file, and
      // the controller audits only on Ok), so they mutate nothing.
      let staleErr = null;
      await api.host(hmId).put(p, { content: read.content + "\n", etag: "sha256:deadbeef", origin: "ui" })
        .catch((e) => { staleErr = e; });
      assert(staleErr && (staleErr.code === 412 || staleErr.envCode === "precondition_failed"),
        `Files save: stale etag → 412 (code=${staleErr && staleErr.code})`);
    }

    let escErr = null;
    await api.host(hmId).get("/servers/" + fSv + "/files/content?path="
      + encodeURIComponent("../../../../etc/passwd")).catch((e) => { escErr = e; });
    assert(escErr && escErr.code === 404, `Files jail: traversal escape → 404 (code=${escErr && escErr.code})`);
  } else {
    console.log("• Files: no servers in the live roster — skipped the file-browser round-trip");
  }

  // ---- Phase 8: audit paging + filters (keyset cursor walk + pushdown) ----
  // Two fixes: (1) the log fetched ONE page, leaving older events unreachable —
  // refresh() now WALKS the keyset cursor + loadMore() pulls older pages, with a
  // non-null cursor disclosing incompleteness so client free-text search never
  // looks exhaustive when it isn't; (2) the structured filters (severity incl.
  // attention=warn,danger / serverId / actor / since / category) PUSH DOWN to the
  // backend so the cursor walks the FILTERED log (old matching events stay
  // reachable behind newer noise).
  //
  // Paged against the host's REAL log — a live host accumulates one continuously and this
  // suite writes nothing into it (THE ONE RULE). That also makes the pushdown proof
  // stronger than a synthetic seed could: the filter runs over a log holding OTHER servers'
  // rows, so a serverId that comes back clean actually demonstrates filtering.
  const auditPool = (await api.get("/audit?limit=200")).rows;
  const enoughRows = auditPool.length >= 6;
  if (!enoughRows)
    console.log(`• audit paging: the live log holds ${auditPool.length} rows (<6) — skipping the paging/pushdown `
      + "proofs. A host that has run anything at all has enough; a brand-new one will after its first action.");

  // (a) adaptAudit preserves the page envelope (both wire shapes + the empty case)
  const env = adapt.adaptAudit({ data: [{ id: "evt_x" }], nextCursor: "42" });
  assert(Array.isArray(env.rows) && env.rows.length === 1 && env.rows[0].id === "evt_x" && env.nextCursor === "42",
    "adaptAudit: { data, nextCursor } → { rows, nextCursor } (envelope preserved, not flattened)");
  const envBare = adapt.adaptAudit([{ id: "evt_y" }]);
  assert(envBare.rows.length === 1 && envBare.nextCursor === null,
    "adaptAudit: a bare array (mock shape) → { rows, nextCursor:null }");
  assert(adapt.adaptAudit(null).rows.length === 0 && adapt.adaptAudit(null).nextCursor === null,
    "adaptAudit: null/garbage → empty page, never throws");

  // (a2) auditServerParams — the pure FE-filter → backend-query mapping
  const auditPage = await vite.ssrLoadModule("/src/pages/AuditLogPage.jsx");
  const ASP = auditPage.auditServerParams;
  const NOW = Date.UTC(2026, 5, 21, 12, 0, 0);
  assert(ASP({ severity: "attention" }).severity === "warn,danger",
    "auditServerParams: 'attention' (Alerts view) → severity=warn,danger (multi-value)");
  assert(ASP({ severity: "danger" }).severity === "danger" && !("serverId" in ASP({ severity: "danger" })),
    "auditServerParams: a single severity passes through; unset dims omitted");
  assert(!("severity" in ASP({ severity: "all" })) && !("since" in ASP({ range: "all" }, NOW)),
    "auditServerParams: 'all' / range 'all' → omitted (no filter, unbounded)");
  assert(ASP({ server: "factorio-test" }).serverId === "factorio-test" && ASP({ actor: "haru" }).actor === "haru"
    && ASP({ category: "server" }).category === "server",
    "auditServerParams: server→serverId, actor→actor, category→category");
  assert(ASP({ range: "24h" }, NOW).since === new Date(NOW - 86400e3).toISOString(),
    "auditServerParams: range 24h → since = now-24h ISO lower bound");
  assert(Object.keys(ASP({ severity: "all", server: "all", actor: "all", range: "all", category: "all" }, NOW)).length === 0,
    "auditServerParams: all-default filter → empty params (no query string)");

  if (enoughRows) {
  // (b) the server genuinely pages — a tiny limit yields a cursor (older exist)
  const tiny = await api.get("/audit?limit=1");
  assert(tiny.rows.length === 1 && tiny.nextCursor != null,
    `audit keyset: limit=1 returns one row + a non-null cursor (older reachable; cursor=${tiny.nextCursor})`);

  // (b2) PUSHDOWN through the store: a serverId filter walks only that server's
  // rows; an unknown server → 0 (filtered server-side, not client-trimmed); a
  // future `since` → 0 while a bound just under the newest row returns rows (a real
  // bound, not all-or-nothing). Proves the params reach the backend + filter there.
  // Both the scoped id and the `since` bound are DERIVED from the live log — the most
  // active server in it, and its own newest timestamp — so the assertions hold on any
  // host without this suite writing a row to make them true.
  const busiest = Object.entries(auditPool.reduce((acc, r) => {
    if (r.serverId) acc[r.serverId] = (acc[r.serverId] || 0) + 1;
    return acc;
  }, {})).sort((a, b) => b[1] - a[1])[0];
  if (busiest) {
    const fScoped = await st.auditStore.refresh({ serverId: busiest[0] });
    assert(fScoped.length > 0 && fScoped.every(r => r.serverId === busiest[0]),
      `audit pushdown: refresh({serverId}) → ${fScoped.length} rows, all scoped to ${busiest[0]} `
      + `(filtered out of a log holding ${new Set(auditPool.map(r => r.serverId).filter(Boolean)).size} servers' rows)`);
  }
  const fNone = await st.auditStore.refresh({ serverId: "no-such-server-xyz" });
  assert(fNone.length === 0 && st.auditStore.getState().nextCursor === null,
    "audit pushdown: refresh({serverId:unknown}) → 0 rows (filtered server-side, cursor null)");
  const fFuture = await st.auditStore.refresh({ since: new Date(Date.now() + 3600e3).toISOString() });
  assert(fFuture.length === 0,
    "audit pushdown: refresh({since:future}) → 0 rows (?since= is a real server-side lower bound)");
  const newestTs = new Date(auditPool[0].ts).getTime();
  const fRecent = await st.auditStore.refresh({ since: new Date(newestTs - 1000).toISOString() });
  assert(fRecent.length > 0,
    "audit pushdown: refresh({since:just-before-the-newest-row}) → that row (since bounds, not all-or-nothing)");
  }

  // (b3) END-TO-END through the PAGE — the glue between the pure mapper and
  // refresh(params). The Alerts→audit deep-link (?severity=attention) must drive
  // filter state → auditServerParams → the mount effect → refresh(), landing the
  // pushed query in the store's active filterParams. If this glue is miswired,
  // filters silently degrade to client-only-over-window (the exact bug this slice
  // kills) with NO other symptom — so assert it through the real route, not a
  // hand-built refresh() call. Also covers the attention→warn,danger round-trip.
  await nav("#/audit?severity=attention");
  let fp = {};
  for (let i = 0; i < 30; i++) {
    fp = st.auditStore.getState().filterParams || {};
    if (fp.severity === "warn,danger") break;
    await sleep(100);
  }
  assert(fp.severity === "warn,danger",
    "audit page→backend glue: deep-link ?severity=attention → effect → refresh({severity:'warn,danger'}) (filters truly push down, not client-only)");
  await nav("#/dashboard");

  // (c) refresh() walks the keyset until the log ends or the cap stops it. WHICH of those
  // happens is a property of the host, not of the code: a log grows without bound and this
  // one crosses the cap eventually, so the assertion is that the walk ends for one of exactly
  // two reasons — never that this host's log is small enough to fit.
  const fullRows = await st.auditStore.refresh();
  const auditComplete = st.auditStore.getState().nextCursor === null;
  assert(fullRows.length > 1 && (auditComplete || fullRows.length >= st.AUDIT_CAP),
    `audit refresh: walked the keyset to ${auditComplete ? "the end of the log" : "the cap"} `
    + `(${fullRows.length} rows${auditComplete ? ", complete" : `, cap ${st.AUDIT_CAP} — older rows still behind a cursor`})`);

  // (d) the cursor never lies about what is left. Complete ⇒ loadMore has nothing to pull and
  // must not double-fetch; capped ⇒ the cursor names real older rows and must yield them.
  const lenBefore = st.auditStore.getState().list.length;
  await st.auditStore.loadMore();
  const lenAfter = st.auditStore.getState().list.length;
  assert(auditComplete ? lenAfter === lenBefore : lenAfter > lenBefore,
    auditComplete
      ? "audit loadMore: no-op when the log is complete (no cursor → nothing to pull)"
      : `audit loadMore: a capped walk's cursor yields the older page it promised (${lenBefore} → ${lenAfter} rows)`);

  // (e) the cursor WALK + incomplete UI. The page's mount effect re-queries to a
  // complete load, so to exercise the partial-window UI we nav FIRST (effect loads
  // full), THEN seed a partial window via setState (no filter change → the effect
  // won't re-fire and clobber it).
  await nav("#/audit");
  await sleep(140);
  const p1 = await api.get("/audit?limit=2");
  st.auditStore.setState(s => ({ ...s, list: p1.rows.slice(), nextCursor: p1.nextCursor, loadingMore: false, status: "ready", everLoaded: true }));
  assert(st.auditStore.getState().nextCursor != null,
    "audit walk: seeded a partial window (cursor present = incomplete)");
  await sleep(140);
  const auditHtml = w.document.getElementById("root").innerHTML;
  assert(auditHtml.includes("Load older events") && auditHtml.includes("most recent events are loaded"),
    "audit page (incomplete): renders the disclosure note + a 'Load older events' affordance");

  await st.auditStore.loadMore();
  const walked = st.auditStore.getState().list;
  assert(walked.length > p1.rows.length,
    `audit loadMore: appended the older page (${p1.rows.length} → ${walked.length} rows reached)`);
  assert(new Set(walked.map(r => r.id)).size === walked.length,
    "audit loadMore: no duplicate rows across the page boundary (dedup by id)");
  assert(walked.every((r, i) => i === 0 || new Date(r.ts) <= new Date(walked[i - 1].ts)),
    "audit loadMore: newest-first order preserved across the appended page");
  // Keep walking to the tail. One page only ends the log on a nearly-empty audit trail;
  // on a host that has been running a while it takes many, so the walk is bounded by a
  // page budget rather than assuming the second page is the last.
  let walkPages = 1;
  while (st.auditStore.getState().nextCursor != null && walkPages < 60) { await st.auditStore.loadMore(); walkPages++; }
  assert(st.auditStore.getState().nextCursor === null,
    `audit loadMore: reaching the tail clears the cursor (complete after ${walkPages} page(s))`);
  await sleep(140);
  assert(!w.document.getElementById("root").innerHTML.includes("Load older events"),
    "audit page (complete after load): the disclosure + load-older affordance disappear");

  await nav("#/dashboard");
  await st.auditStore.refresh();   // restore the store to a clean, complete state

  // ---- Host logs (the aggregated leaf journal — GET /hosts/{id}/logs + logsStore) ----------------
  // The Logs tab funnels the host's leaf-service journals (assistant/monitor/watchdog/firewall/api/bot)
  // through kgsm-api. Prove the adapter envelope, the real OPERATOR-gated endpoint (merged + per-source),
  // the store hydrate, and the live-prepend dedup — the WS log.line path.
  const lp = adapt.adaptLogPage({ data: [{ id: "s=1", at: "2026-06-29T00:00:00Z", source: "watchdog", level: "warn", text: "x" }], nextCursor: "s=1" });
  assert(lp.rows.length === 1 && lp.rows[0].id === "s=1" && lp.rows[0].source === "watchdog" && lp.nextCursor === "s=1",
    "adaptLogPage: { data, nextCursor } → { rows, nextCursor } (LogLine passthrough, envelope preserved)");
  assert(adapt.adaptLogPage(null).rows.length === 0 && adapt.adaptLogLine({}).level === "info" && adapt.adaptLogLine({}).text === "",
    "adaptLogPage/adaptLogLine: null → empty page; a level-less line defaults info + text '' (honest, never fabricated)");

  // The real OPERATOR-gated endpoint on the backend under test (KGSM_API), run through the REAL
  // adapter — proving the backend shape + adaptLogPage together. We fetch it directly rather than
  // through the SPA's api.get, because that routes through the localStorage host registry (the
  // N≥2 synthetic connections this smoke registers) rather than the backend under test.
  //
  // The valid source set is READ FROM THE HOST (`/logs/sources`, which is what populates the SPA's
  // own dropdown), never named here: the leaves a host serves journals for grow, and a list written
  // down in this file fails the day one joins, in a way that reads like an SPA regression.
  const srcInfo = await fetch(API + "/api/v1/hosts/" + hmId + "/logs/sources").then(r => r.json());
  assert(Array.isArray(srcInfo) && srcInfo.length > 0 && srcInfo.every(s => s.id && s.label && s.unit),
    `host logs (live): GET /hosts/${hmId}/logs/sources → ${(srcInfo || []).length} selectable source(s), each id/label/unit`);
  const KNOWN_SOURCES = new Set((srcInfo || []).map(s => s.id));

  const mergedLogs = adapt.adaptLogPage(await fetch(API + "/api/v1/hosts/" + hmId + "/logs?limit=5").then(r => r.json()));
  const strayLogSrc = mergedLogs.rows.map(r => r.source).find(s => !KNOWN_SOURCES.has(s));
  assert(mergedLogs.rows.length > 0 && mergedLogs.rows.every(r => r.id && r.at && r.text != null && r.level) && !strayLogSrc,
    `host logs (live): GET /hosts/${hmId}/logs → ${mergedLogs.rows.length} merged line(s), each id/at/level/text + a source the host declares (adaptLogPage applied)${strayLogSrc ? ` — '${strayLogSrc}' is not one of them` : ""}`);

  // Filter on a source the merged page actually carried, so an empty answer can't pass vacuously.
  const probeSrc = (mergedLogs.rows[0] && mergedLogs.rows[0].source) || (srcInfo[0] && srcInfo[0].id);
  const oneSrc = adapt.adaptLogPage(await fetch(API + "/api/v1/hosts/" + hmId + "/logs?source=" + probeSrc + "&limit=3").then(r => r.json()));
  assert(oneSrc.rows.length > 0 && oneSrc.rows.every(r => r.source === probeSrc),
    `host logs (live): ?source=${probeSrc} filters to that one leaf (${oneSrc.rows.length} line(s))`);

  const badStatus = (await fetch(API + "/api/v1/hosts/" + hmId + "/logs?source=bogus")).status;
  assert(badStatus === 400, `host logs (live): an unknown ?source= is a 400, never a silent merge (got ${badStatus})`);

  // The store's live-tail logic (the WS log.line path), tested purely — refresh() is a thin
  // api.host→adaptLogPage wrapper (both halves proven above), so we exercise the part with real logic:
  // host-scoped prepend with id-dedup (no double-count) + the newest-first head.
  // The store is KEYED BY HOST — two nodes' journals can be held at once (two pinned to the
  // dashboard, or one pinned while a node's Logs tab is open), where one slot had each refresh blank
  // the other. A line only lands on a key somebody is holding.
  st.logsStore.setState(s => ({ ...s, byHost: { ...s.byHost, [hmId]: { list: [], status: "ready", error: null, everLoaded: true } } }));
  st.logsStore.prepend(hmId, { id: "s=live-1", at: "2030-01-01T00:00:00Z", source: "watchdog", level: "info", text: "live" });
  st.logsStore.prepend(hmId, { id: "s=live-1", at: "2030-01-01T00:00:00Z", source: "watchdog", level: "info", text: "dup" });
  st.logsStore.prepend("some-other-host", { id: "s=live-2", at: "2030-01-01T00:00:01Z", source: "api", level: "info", text: "wrong host" });
  const afterPrepend = st.logsStore.getState().byHost[hmId];
  assert(afterPrepend.list.length === 1 && afterPrepend.list[0].id === "s=live-1" && afterPrepend.list[0].text === "live",
    "logsStore.prepend: live line prepends newest-first; a dup-by-id and a wrong-host frame are both ignored (the audit-append precedent)");
  assert(!st.logsStore.getState().byHost["some-other-host"],
    "logsStore.prepend: a frame for a node nobody is holding creates no window — a stream cannot conjure a journal");

  // Two nodes' journals at once, which is what the keying is FOR: the second must not blank the first.
  st.logsStore.setState(s => ({ ...s, byHost: { ...s.byHost, "node-b": { list: [], status: "ready", error: null, everLoaded: true } } }));
  st.logsStore.prepend("node-b", { id: "s=b-1", at: "2030-01-01T00:00:02Z", source: "api", level: "info", text: "b" });
  assert(st.logsStore.getState().byHost[hmId].list.length === 1
    && st.logsStore.getState().byHost["node-b"].list.length === 1,
    "logsStore: two nodes' journals held at once each keep their own lines");
  st.logsStore.drop("node-b");
  assert(!st.logsStore.getState().byHost["node-b"] && !!st.logsStore.getState().byHost[hmId],
    "logsStore.drop: releasing one node's journal frees only that one");
  st.logsStore.drop(hmId);

  // ---- Host services (the leaf control center — GET /hosts/{id}/services + servicesStore) -------
  // The Services tab (which replaced the htop-style Processes tab) shows one card per KGSM leaf, joining
  // its systemd liveness with the api's deep-health probe. Prove the adapter envelope + honest nulls, the
  // real OPERATOR-gated endpoint, and the store hydrate.
  const KNOWN_STATES = new Set(["active", "inactive", "failed", "activating", "deactivating", "reloading", "maintenance", "masked", "not-installed", "unknown"]);
  const sv = adapt.adaptServices({ data: [
    { id: "api", displayName: "Control Panel API", role: "x", unit: "kgsm-api.service", state: "active", onDemand: false, enabled: true, mainPid: 5, memoryBytes: 123, health: { status: "operational" } },
    { id: "bot", displayName: "Discord bot", role: "y", unit: "kgsm-bot.service", state: "inactive", onDemand: false },
  ] });
  assert(sv.length === 2 && sv[0].health.status === "operational" && sv[0].memoryBytes === 123
    && sv[1].health === null && sv[1].memoryBytes === null && sv[1].enabled === null,
    "adaptServices: { data:[LeafService] } → array; a probe-less leaf keeps health/memory/enabled null (honest, never fabricated)");
  assert(adapt.adaptServices(null).length === 0,
    "adaptServices: null → [] (degrades, never throws)");

  // `provisioned` is the runtime API↔leaf connection (distinct from systemd liveness): a bool for the four
  // provisionable leaves (monitor/watchdog/assistant/firewall), honest NULL for api/bot — never a false.
  const provSv = adapt.adaptServices({ data: [
    { id: "monitor", displayName: "Monitor", unit: "kgsm-monitor.service", state: "active", provisioned: true },
    { id: "firewall", displayName: "Firewall", unit: "kgsm-firewall.service", state: "inactive", onDemand: true, provisioned: false },
    { id: "api", displayName: "API", unit: "kgsm-api.service", state: "active" },          // no provisioned field → null
    { id: "bot", displayName: "Bot", unit: "kgsm-bot.service", state: "inactive", provisioned: null },
  ] });
  const pById = Object.fromEntries(provSv.map(s => [s.id, s]));
  assert(pById.monitor.provisioned === true && pById.firewall.provisioned === false && pById.api.provisioned === null && pById.bot.provisioned === null,
    "adaptService: provisioned bool for the four provisionable leaves; honest NULL for api/bot (never a fabricated false)");

  // Leaf config manifest — the typed runtime-override form. A SECRET field's value is NEVER on the wire
  // (write-only): the adapter forces value:null and surfaces `set` + last-4 `fingerprint` instead.
  const lc = adapt.adaptLeafConfig({ leaf: "assistant", displayName: "Assistant", unit: "kgsm-assistant.service", fields: [
    { key: "model", envName: "Assistant__Model", label: "Model", type: "string", value: "gemma4:12b", default: "gemma4:12b", overridden: false },
    { key: "tavily", envName: "WebSearch__ApiKey", label: "Tavily key", type: "secret", value: "SHOULD_NOT_LEAK", set: true, fingerprint: "ab12", overridden: true },
  ] });
  const lcf = Object.fromEntries(lc.fields.map(x => [x.key, x]));
  assert(lc.leaf === "assistant" && lc.fields.length === 2 && lcf.model.value === "gemma4:12b" && lcf.model.overridden === false,
    "adaptLeafConfig: { leaf, fields } envelope; a non-secret field carries value/default/overridden honestly");
  assert(lcf.tavily.isSecret === true && lcf.tavily.value === null && lcf.tavily.set === true && lcf.tavily.fingerprint === "ab12",
    "adaptLeafConfigField: a secret is WRITE-ONLY — value forced null on the wire; set + fingerprint surfaced instead");
  const lap = adapt.adaptLeafConfigApply({ outcome: "rolled_back", health: { status: "down", message: "unhealthy" }, message: "reverted", config: { leaf: "assistant", fields: [] } });
  assert(lap.outcome === "rolled_back" && lap.config && lap.config.leaf === "assistant",
    "adaptLeafConfigApply: outcome + nested fresh config (a rolled_back is surfaced honestly, not as a success)");

  // The real OPERATOR-gated endpoint, through the REAL adapter (same direct-fetch reasoning as logs — the
  // SPA host registry may still point at a not-yet-redeployed host; this endpoint is new).
  const svc = adapt.adaptServices(await fetch(API + "/api/v1/hosts/" + hmId + "/services").then(r => r.json()));
  const apiLeaf = svc.find(s => s.id === "api");
  const fwLeaf = svc.find(s => s.id === "firewall");
  // The engine's pseudo-leaf row speaks its own measured vocabulary and carries no unit — it is a
  // stateless CLI, not a systemd service. Every OTHER row is unit-backed and systemd-worded.
  const engineRow = svc.find(s => s.id === "kgsm");
  const unitRows = svc.filter(s => s.id !== "kgsm");
  assert(unitRows.length >= 6 && unitRows.every(s => s.id && s.displayName && s.unit && KNOWN_STATES.has(s.state)),
    `host services (live): GET /hosts/${hmId}/services → ${unitRows.length} leaf row(s), each id/displayName/unit + a known systemd state`);
  assert(engineRow && engineRow.unit === "" && ["available", "unavailable", "not-installed"].includes(engineRow.state),
    "host services (live): the engine pseudo-leaf row is unit-less and speaks its own vocabulary (available/unavailable/not-installed)");
  assert(apiLeaf && apiLeaf.state === "active" && apiLeaf.health && apiLeaf.health.status === "operational" && apiLeaf.mainPid != null,
    "host services (live): the api leaf is active + self-reports operational health + a real pid (it IS the service answering this request)");
  assert(fwLeaf && fwLeaf.onDemand === true,
    "host services (live): the firewall leaf carries onDemand:true (socket-activated → an inactive state renders as idle, not a fault)");

  // The store hydrate is host-scoped (mirror of logsStore): the tab reads `hostId === host.id` as its
  // ready-guard. Exercise it purely (refresh() is a thin api.host→adaptServices wrapper, proven above).
  // Use the live rows when present; fall back to synthetic rows so these PURE store/reconcile checks stay
  // deterministic (and never deref undefined) when the live fetch is empty — e.g. the backend under test
  // has auth ON, so the operator-gated /services 401s (this harness sends no bearer). The live endpoint
  // itself is validated separately with a real token; here we exercise the client store/WS logic.
  const svcRows = svc.length ? svc : [
    { id: "monitor", displayName: "Monitor", role: "", unit: "kgsm-monitor.service", state: "active", onDemand: false, provisioned: true, subState: "running", enabled: true, since: null, mainPid: 1, memoryBytes: null, health: { status: "operational", message: null } },
    { id: "firewall", displayName: "Firewall", role: "", unit: "kgsm-firewall.service", state: "inactive", onDemand: true, provisioned: false, subState: null, enabled: null, since: null, mainPid: null, memoryBytes: null, health: null },
  ];
  // Keyed by host, like the journals: the Services board of two nodes can be open at once.
  st.servicesStore.setState(s => ({ ...s, byHost: { ...s.byHost, [hmId]: { list: svcRows, status: "ready", error: null, everLoaded: true } } }));
  const svcState = st.servicesStore.getState().byHost[hmId];
  assert(!!svcState && svcState.list.length === svcRows.length,
    "servicesStore: the board is held per host (the ready-guard the Services tab reads)");

  // servicesStore.applyRow — the connect/disconnect reconcile path: fold ONE updated leaf row into the
  // host's board (so a provisioning flip updates it without a refetch); a row for a node nobody holds drops.
  const someLeaf = svcRows[0];
  const svcFlipped = someLeaf.provisioned === true ? false : true;
  st.servicesStore.applyRow(hmId, { ...someLeaf, provisioned: svcFlipped });
  assert(st.servicesStore.getState().byHost[hmId].list.find(x => x.id === someLeaf.id).provisioned === svcFlipped,
    "servicesStore.applyRow: folds an updated leaf row into the host-scoped board (provisioning reconcile)");
  st.servicesStore.applyRow("some-other-host", { id: someLeaf.id, provisioned: someLeaf.provisioned });
  assert(st.servicesStore.getState().byHost[hmId].list.find(x => x.id === someLeaf.id).provisioned === svcFlipped
    && !st.servicesStore.getState().byHost["some-other-host"],
    "servicesStore.applyRow: a row for another node lands on neither this board nor a window nobody holds");
  st.servicesStore.drop(hmId);

  // ---- One leaf's page: the nested route + its own journal ----------------------------------------
  // A leaf page hangs off the node's Services tab, which is the only place it is opened from, so the
  // URL keeps descending: #/cluster/<host>/services/<leaf>[/<tab>]. Assert the round trip and that the
  // flat word a link may still carry resolves to the same place.
  const rt = await vite.ssrLoadModule("/src/lib/router.js");
  const leafHash = rt.KrystalRouter.routeToHash({ kind: "leaf", hostId: hmId, leaf: "monitor", tab: "logs" });
  const leafRoute = rt.KrystalRouter.parseHash(leafHash);
  assert(leafHash === `#/cluster/${hmId}/services/monitor/logs`
    && leafRoute.kind === "leaf" && leafRoute.leaf === "monitor" && leafRoute.tab === "logs",
    `leaf route: nests under the node's Services tab (${leafHash}) and parses back to the same leaf + tab`);
  const bareServices = rt.KrystalRouter.parseHash(`#/cluster/${hmId}/services`);
  assert(bareServices.kind === "cluster" && bareServices.tab === "services",
    "leaf route: /services with no leaf named stays the NODE's Services tab (the drill-in needs a leaf)");
  const legacyLeaf = rt.KrystalRouter.parseHash(`#/leaf/${hmId}/monitor`);
  assert(legacyLeaf.kind === "leaf" && legacyLeaf.hostId === hmId && legacyLeaf.leaf === "monitor",
    "leaf route: the flat #/leaf/<host>/<leaf> word still resolves, so an older link still lands");

  // ONE breadcrumb, and it mirrors the URL — sub-tab included. The shell renders the trail for every
  // route, so a page drawing its own would stack a second one under it: assert the count, and that the
  // trail names every segment the hash carries down to the tab.
  const crumbsOf = (html) => {
    const rows = (html.match(/content__breadcrumb/g) || []).length;
    const text = (html.match(/class="content__breadcrumb">([\s\S]*?)<\/div>/) || ["", ""])[1]
      .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return { rows, text };
  };
  const leafCrumb = crumbsOf(await nav(`#/cluster/${hmId}/services/monitor/logs`));
  assert(leafCrumb.rows === 1 && /Cluster \/ .+ \/ Services \/ Monitor \/ Logs$/.test(leafCrumb.text),
    `leaf breadcrumb: exactly one trail, and it walks the URL down to the tab ("${leafCrumb.text}")`);

  // The node's own tabs are segments too, which is the case the trail used to stop short of.
  const nodeTabCrumb = crumbsOf(await nav(`#/cluster/${hmId}/services`));
  assert(nodeTabCrumb.rows === 1 && /Cluster \/ .+ \/ Services$/.test(nodeTabCrumb.text),
    `node breadcrumb: a node's sub-tab is a crumb ("${nodeTabCrumb.text}")`);

  // The default tab is left OUT of the hash, so it gets no crumb — the trail says exactly what the
  // URL says and no more.
  const nodeCrumb = crumbsOf(await nav(`#/cluster/${hmId}`));
  assert(nodeCrumb.rows === 1 && /Cluster \/ [^/]+$/.test(nodeCrumb.text),
    `node breadcrumb: the default tab is unnamed in the URL and uncrumbed in the trail ("${nodeCrumb.text}")`);

  // A segment no tab answers to resolves back to the default tab, so naming it would announce a place
  // that is not on screen.
  const bogusCrumb = crumbsOf(await nav(`#/cluster/${hmId}/not-a-tab`));
  assert(bogusCrumb.rows === 1 && !/not-a-tab/i.test(bogusCrumb.text),
    `node breadcrumb: an unknown tab segment is left off rather than announced ("${bogusCrumb.text}")`);

  // The node header carries no back control of its own — walking back up the cluster is the trail's job,
  // and a second affordance for it was one the page had to keep in step with the URL.
  const nodeHtml = await nav(`#/cluster/${hmId}`);
  assert(!nodeHtml.includes("diag-back-btn") && !nodeHtml.includes("Back to all hosts"),
    "node header: no back arrow beside the title (the breadcrumb is the way back up)");

  // The unit's facts live on the System tab and ONLY there. They used to be rendered three times over
  // — a strip above every tab, a card on the generic Overview, the config page's identity block — so
  // assert both halves: System carries them, and the tab you were on a moment ago no longer repeats.
  const sysHtml = await nav(`#/cluster/${hmId}/services/monitor/system`);
  assert(sysHtml.includes("leaf-facts") && sysHtml.includes("Enabled at boot") && sysHtml.includes("kgsm-monitor.service"),
    "leaf System tab: carries the unit's systemd facts (unit, activation, enabled-at-boot, runtime)");
  const ovHtml = await nav(`#/cluster/${hmId}/services/monitor`);
  assert(!ovHtml.includes("svc-summary") && !ovHtml.includes("Enabled at boot"),
    "leaf Overview: no longer repeats the unit strip — the header's status chip is what stays visible");

  // The Commands tab follows the manifest a leaf ships, not a list of leaves in the SPA: the bot ships
  // one and gets the tab, the monitor ships none and must not. Both halves matter — a tab that appears
  // for every leaf would be a promise the leaf never made. The command text is the LEAF's, read from
  // the live endpoint, so this asserts the page prints what the file says rather than a fixture.
  const botCmds = await fetch(API + "/api/v1/hosts/" + hmId + "/services/bot/commands")
    .then(r => (r.ok ? r.json() : null));
  if (botCmds) {
    // The manifest is keyed by the gate that admits each command, so the whole catalog is every
    // bucket's contents — a reader that knew only one bucket would print a partial list.
    const all = Object.values(botCmds.gates || {}).flat();
    const acts = all.filter(c => c.mutates);
    const cmdHtml = await nav(`#/cluster/${hmId}/services/bot/commands`);
    assert(cmdHtml.includes("leaf-cmd__usage") && all.every(c => cmdHtml.includes("/" + c.name)),
      `leaf Commands tab: every command the bot's manifest declares is rendered (${all.length}, ${acts.length} of them acting)`);
    assert(acts.length > 0 && cmdHtml.includes("acts") && Object.keys(botCmds.gates).every(g => cmdHtml.toLowerCase().includes(g)),
      "leaf Commands tab: grouped by the gate that admits each command, every bucket the manifest carries");
  }

  // The bot's Overview reads a leaf payload that is a LIST of Discord servers — a KGSM host announces
  // into as many as an admin has run /setup in, and none until one has. Every field on that page moved
  // when the leaf went guild-agnostic, and a stale field name renders as an empty cell rather than a
  // crash, so assert the page prints what the socket actually said: the guild's own name, and one row
  // per instance→channel binding the leaf reports.
  const botStatus = await fetch(API + "/api/v1/hosts/" + hmId + "/services/bot/status")
    .then(r => (r.ok ? r.json() : null));
  if (botStatus) {
    const botHtml = await nav(`#/cluster/${hmId}/services/bot`);
    const guilds = botStatus.guilds || [];
    const bindings = guilds.flatMap(g => g.channels || []);
    assert(guilds.every(g => botHtml.includes(g.guildId) && (!g.name || botHtml.includes(g.name))),
      `leaf Overview (bot): every Discord server the leaf reports is named (${guilds.length})`);
    assert(bindings.every(c => botHtml.includes(c.instance) && botHtml.includes(c.channelId)),
      `leaf Overview (bot): every instance→channel binding renders (${bindings.length} across ${guilds.length} server(s))`);
    // "Set up nowhere" is a real, deliberate state — the page must say so rather than read as a fault.
    assert(guilds.length > 0 || botHtml.includes("No Discord server is set up"),
      "leaf Overview (bot): a bot set up in no Discord server says so, rather than looking broken");
  }

  // The engine's pseudo-leaf page. Its Overview renders what GET /hosts/{id}/engine measured (the
  // api invoking kgsm itself), and its Library tab holds the placement roots the host aggregate
  // carries — both live reads, asserted against what the backend actually said.
  const engineInfo = await fetch(API + "/api/v1/hosts/" + hmId + "/engine").then(r => (r.ok ? r.json() : null));
  if (engineInfo) {
    const engHtml = await nav(`#/cluster/${hmId}/services/kgsm`);
    assert(engHtml.includes(engineInfo.version) && engHtml.includes(engineInfo.path),
      `leaf Overview (kgsm): the engine's own version (${engineInfo.version}) and entrypoint render`);
    const engLibs = (st.hostsStore.find(hmId) || {}).libraries || [];
    const libHtml = await nav(`#/cluster/${hmId}/services/kgsm/library`);
    assert(engLibs.every(l => libHtml.includes(l.name) && libHtml.includes(l.path)),
      `leaf Library (kgsm): every placement root the host reports renders with its path (${engLibs.length})`);
    assert(!engHtml.includes(">System<") && !engHtml.includes(">Logs<"),
      "leaf page (kgsm): the engine page offers no unit-vocabulary tabs — it has no unit and no journal");
  } else {
    console.log("· leaf Overview (kgsm): this host reports no engine, so the pseudo-leaf page wasn't exercised");
  }

  let cmds404 = 0;
  await fetch(API + "/api/v1/hosts/" + hmId + "/services/monitor/commands").then(r => { cmds404 = r.status; });
  const monitorCmdHtml = await nav(`#/cluster/${hmId}/services/monitor`);
  assert(cmds404 === 404 && !monitorCmdHtml.includes(">Commands<"),
    "leaf Commands tab: a leaf that ships no manifest is a 404 and gets no tab (most leaves take no commands)");

  // A stopped unit still carries `since` (ActiveEnterTimestamp, from its last run), so reading elapsed
  // time off it would claim a dead service had been up for hours. Exercise it against whichever leaf is
  // actually down rather than naming one, since which leaves run is the host's business, not ours.
  const downLeaf = svc.find(s => s.unit && s.state !== "active");
  if (downLeaf) {
    const downHtml = await nav(`#/cluster/${hmId}/services/${downLeaf.id}/system`);
    assert(downHtml.includes("Last started") && !downHtml.includes(">Uptime<") && downHtml.includes("not running"),
      `leaf System tab: a stopped unit (${downLeaf.id}) reports when it LAST started and no uptime, and its absent pid/memory read "not running" — never 0`);
  } else {
    console.log("· leaf System tab: every leaf is active, so the stopped-unit rendering wasn't exercised");
  }

  // The System tab's charts read the monitor's per-leaf history through the api's proxy. Assert the
  // request the SPA actually builds — the `leaf` entity kind is what makes these rows a leaf's rather
  // than a server's, and the route is the same one the leaf page is addressed by.
  const leafHist = await fetch(API + "/api/v1/hosts/" + hmId + "/services/monitor/metrics/history?range=1h")
    .then(r => r.json());
  assert(leafHist.kind === "leaf" && leafHist.entityId === "monitor",
    `leaf resource history: the api answers the leaf entity kind (kind=${leafHist.kind}, tier=${leafHist.tier})`);
  // The metric names are deliberately the server vocabulary — same quantities, same units — which is
  // what lets one chart component render either. If they ever diverge, the shared grid draws nothing.
  const leafSeries = Object.keys(leafHist.series || {});
  assert(leafSeries.includes("cpuPctCore") && leafSeries.includes("memBytes"),
    `leaf resource history: shares the server metric vocabulary (${leafSeries.join(", ") || "no series yet"})`);
  // A leaf has no per-instance network meter by design, so the grid must not render the empty Network
  // card it shows a server — "never measured here" is a different claim from "nothing recorded yet".
  assert(!leafSeries.includes("rxBps") && !leafSeries.includes("txBps"),
    "leaf resource history: carries no network series — the eBPF meter is scoped to kgsm.slice");
  assert(sysHtml.includes("leaf-res") && sysHtml.includes("Resource history"),
    "leaf System tab: renders the recorded-history section beside the unit facts");
  // There is no per-leaf metrics tick to subscribe to, so the range selector must not offer Live — a
  // button that could only re-read the history store would be advertising a feed that doesn't exist.
  assert(!/>Live</.test(sysHtml),
    "leaf System tab: the range selector offers recorded windows only, no Live");

  // A socket-activated leaf that is currently down is RESTING, not stopped — which is what the
  // Activation hint one card up says, and the history card must not contradict it. Which of the two
  // readings applies depends on the host, not on the SPA: an on-demand leaf that was woken inside the
  // window has real samples from the seconds it ran and draws its charts, while one nobody has poked
  // has none and falls to the empty state. So read the window first and assert the branch it selects.
  // The half that holds either way — and the half this is really here for — is that the stopped copy
  // never appears for a leaf whose page says it is resting.
  const onDemandLeaf = svc.find(s => s.onDemand && s.state !== "active");
  if (onDemandLeaf) {
    const idleHist = await fetch(API + "/api/v1/hosts/" + hmId + "/services/" + onDemandLeaf.id + "/metrics/history?range=1h")
      .then(r => (r.ok ? r.json() : { series: {} }));
    const idlePoints = Object.values(idleHist.series || {}).reduce((n, s) => Math.max(n, (s || []).length), 0);
    const idleHtml = await nav(`#/cluster/${hmId}/services/${onDemandLeaf.id}/system`);
    assert(!idleHtml.includes("A stopped leaf has no"),
      `leaf resource history: an idle socket-activated leaf (${onDemandLeaf.id}) never reads as stopped`);
    assert(idlePoints > 0 ? idleHtml.includes("leaf-res") : idleHtml.includes("Idle — nothing to record"),
      idlePoints > 0
        ? `leaf resource history: ${onDemandLeaf.id} was woken inside the window, so its ${idlePoints} real samples are charted`
        : `leaf resource history: ${onDemandLeaf.id} slept through the window, so it reads as resting`);
  } else {
    console.log("· leaf resource history: no idle socket-activated leaf, so the resting copy wasn't exercised");
  }

  // An unknown leaf is a 404 (no such entity), while a known one with no rows is an empty 200 — the SPA
  // renders an honest "no history yet" for the second, so conflating them would hide a real backend fault.
  const unknownLeaf = await fetch(API + "/api/v1/hosts/" + hmId + "/services/not-a-leaf/metrics/history");
  assert(unknownLeaf.status === 404,
    `leaf resource history: an unknown leaf is a 404, not an empty series (${unknownLeaf.status})`);

  // The Logs tab reads ONE leaf's journal (?source=<leaf>) instead of filtering the merged host feed:
  // that feed is capped across every leaf at once, so a quiet leaf can hold none of it. Measure both
  // and assert the scoped read is not the poorer view.
  const WINDOW = 300;
  const mergedWindow = adapt.adaptLogPage(await fetch(API + "/api/v1/hosts/" + hmId + "/logs?limit=" + WINDOW).then(r => r.json()));
  const leafLogs = adapt.adaptLogPage(await fetch(API + "/api/v1/hosts/" + hmId + "/logs?source=monitor&limit=" + WINDOW).then(r => r.json()));
  const inMerged = mergedWindow.rows.filter(r => r.source === "monitor").length;
  assert(leafLogs.rows.length >= inMerged && leafLogs.rows.every(r => r.source === "monitor"),
    `leaf logs (live): ?source=monitor spends the whole window on that leaf (${leafLogs.rows.length} line(s); the same-size merged window carried ${new Set(mergedWindow.rows.map(r => r.source)).size} source(s) and only ${inMerged} of monitor's)`);

  // leafLogsStore is KEYED by (host, leaf), which is what lets two journals be open at once — two
  // pinned to the dashboard, or one pinned while its own page is open. The store held one slot when
  // only one surface could read it; that shape made a second reader silently blank the first.
  //
  // prepend stays doubly guarded, because the live topic carries EVERY source: a frame for another
  // leaf must not land in this journal, and neither must one for another host. Keying makes that
  // testable properly — hold TWO journals at once and prove each got only its own lines, which is
  // the invariant a single slot could not even express.
  const nowIso = () => new Date().toISOString();
  const kMon = st.leafLogsKey(hmId, "monitor");
  const kWd = st.leafLogsKey(hmId, "watchdog");
  st.leafLogsStore.setState(s => ({
    ...s,
    byKey: {
      ...s.byKey,
      [kMon]: { list: [], status: "ready", error: null },
      [kWd]: { list: [], status: "ready", error: null },
    },
  }));
  st.leafLogsStore.prepend(hmId, "monitor", { id: "l-own", at: nowIso(), source: "monitor", level: "info", text: "mine" });
  st.leafLogsStore.prepend(hmId, "monitor", { id: "l-other", at: nowIso(), source: "watchdog", level: "info", text: "not mine" });
  st.leafLogsStore.prepend("some-other-host", "monitor", { id: "l-host", at: nowIso(), source: "monitor", level: "info", text: "other host" });
  st.leafLogsStore.prepend(hmId, "watchdog", { id: "w-own", at: nowIso(), source: "watchdog", level: "info", text: "watchdog's" });

  const monLog = st.leafLogsStore.getState().byKey[kMon].list;
  const wdLog = st.leafLogsStore.getState().byKey[kWd].list;
  assert(monLog.length === 1 && monLog[0].id === "l-own",
    "leafLogsStore.prepend: a line from another leaf (or another host) is dropped — the shared topic never bleeds into the open leaf's journal");
  assert(wdLog.length === 1 && wdLog[0].id === "w-own",
    "leafLogsStore: two journals held at once each keep their OWN lines — the second reader does not blank the first");

  // A journal nobody is holding takes nothing: the last release drops the key, and a still-open
  // subscription must not resurrect a window for a console that is gone.
  st.leafLogsStore.drop(hmId, "watchdog");
  st.leafLogsStore.prepend(hmId, "watchdog", { id: "w-ghost", at: nowIso(), source: "watchdog", level: "info", text: "after release" });
  assert(!st.leafLogsStore.getState().byKey[kWd],
    "leafLogsStore.drop: releasing a journal frees its window, and a late frame does not recreate it");
  st.leafLogsStore.drop(hmId, "monitor");

  // capabilities.patch over the FULL WS chain: a raw frame → adaptStreamMessage → dispatch → the always-on
  // per-host capabilities subscription (wired when the host hydrated) → mergeCapabilities. Proves the
  // capability SET flips live (the runtime leaf-provisioning gate — Performance/assistant/watchdog UI grows
  // & shrinks with NO reload), folded PER-KEY so the metrics live-tick freshness stamp survives a patch.
  st.hostsStore.mergeCapabilities(hmId, { metrics: { provisioned: false, status: "down" } });
  const capCur = st.hostsStore.find(hmId).capabilities || {};
  st.hostsStore.patch(hmId, { capabilities: { ...capCur, metrics: { ...(capCur.metrics || {}), last_sample_at: "2030-01-01T00:00:00Z" } } });
  api.__dispatch({ topic: "hosts/" + hmId + "/capabilities", type: "capabilities.patch",
    data: { metrics: { provisioned: true, status: "operational" }, assistant: { provisioned: true, status: "operational" } } });
  const capHost = st.hostsStore.find(hmId);
  assert(capHost.capabilities.metrics.provisioned === true && capHost.capabilities.metrics.status === "operational" && capHost.capabilities.assistant && capHost.capabilities.assistant.provisioned === true,
    "capabilities.patch: WS frame → per-host subscription → mergeCapabilities (capability set lit live, no reload)");
  assert(capHost.capabilities.metrics.last_sample_at === "2030-01-01T00:00:00Z",
    "capabilities.patch: PER-KEY merge preserves the metrics freshness stamp (a capability patch never wipes the live-tick stamp)");

  // ---- Blueprint files: read, edit, create -------------------------------
  // The library's blueprint editor and the create page both go through
  // blueprintFileStore → kgsm-api → kgsm-lib → the engine. READS run against the live
  // backend (they mutate nothing); every WRITE is intercepted, because a real one would
  // leave a blueprint file behind on the host — and a smoke must not author blueprints.
  const bpName = PROBE.blueprint;

  // (a) the scaffold is the ENGINE's blueprint.tp, fetched per host — the SPA carries no
  // skeleton of its own, so the manual page and the assistant's authoring lane start from
  // one template. Assert its shape rather than its wording: a long, comment-headed YAML
  // template that names the runtime field.
  const scaffold = await st.blueprintFileStore.scaffold(hmId);
  assert(typeof scaffold === "string" && scaffold.length > 500 && scaffold.trimStart().startsWith("#") && /runtime/.test(scaffold),
    `blueprint scaffold: GET /library/scaffold serves the engine's template (${scaffold.length} B, comment header intact)`);

  // (b) reading a real blueprint file: content + a content-addressed etag, the tier the
  // engine resolved it at, and canRevert answered BY THE API — §0.7 is a server-side fact
  // (reverting a user-only blueprint would destroy the only copy), never an SPA inference.
  const bpEntry = await st.blueprintFileStore.load(hmId, bpName);
  assert(bpEntry && typeof bpEntry.content === "string" && bpEntry.content.length > 0
    && typeof bpEntry.etag === "string" && bpEntry.etag.startsWith("sha256:"),
    `blueprint file: GET /library/{id}/file returns the raw bytes + a sha256 etag (${bpName}, ${bpEntry.sizeBytes} B)`);
  assert(["user", "system"].includes(bpEntry.tier),
    `blueprint file: tier comes from the engine's own resolution (${bpEntry.tier})`);
  assert(bpEntry.canRevert === bpEntry.overridesSystem,
    `blueprint file: canRevert mirrors overridesSystem from the API (${bpEntry.overridesSystem}) — the SPA never derives it`);

  // (c) the editor card renders on the game page, and the Overridden badge tracks the
  // loaded DTO rather than being decoration: it is present exactly when a user file is
  // shadowing a shipped one.
  const bpCardHtml = await nav("#/library/" + bpName + "/file");
  assert(bpCardHtml.includes("Blueprint file"),
    "blueprint editor: the game page's File tab mounts the blueprint file card");
  assert(bpCardHtml.includes("Overridden") === bpEntry.overridesSystem,
    `blueprint editor: the Overridden badge matches the file's real tier (overridesSystem=${bpEntry.overridesSystem})`);

  // (d) routing — "new" is claimed by the create page and is parsed BEFORE the game
  // branch, so a blueprint literally named "new" is shadowed (an accepted trade). Assert
  // both directions so the encode and the parse can't drift apart.
  const { KrystalRouter: RT } = await vite.ssrLoadModule("/src/lib/router.js");
  const parseAt = (hash) => { w.location.hash = hash; return RT.parseHash(); };
  assert(parseAt("#/library/new").kind === "library-create",
    "router: #/library/new parses to the create page, not a game called 'new'");
  assert(parseAt("#/library/" + bpName).kind === "game",
    "router: #/library/<name> still parses to the game page");
  assert(RT.routeToHash({ kind: "library-create" }) === "#/library/new",
    "router: the create route encodes back to #/library/new (encode/parse round-trip)");
  // The game page's tab rides the URL like the server page's does. Overview is the
  // default and is OMITTED, so the two sides must agree on that in both directions
  // or a tab click would produce a hash that parses back to a different tab.
  assert(parseAt("#/library/" + bpName + "/file").tab === "file",
    "router: #/library/<name>/<tab> parses the game tab");
  assert(parseAt("#/library/" + bpName).tab === undefined,
    "router: a bare game URL carries no tab (overview is the default, not a segment)");
  assert(RT.routeToHash({ kind: "game", id: bpName, tab: "blueprint" }) === "#/library/" + bpName + "/blueprint",
    "router: a game tab encodes into the path");
  assert(RT.routeToHash({ kind: "game", id: bpName, tab: "overview" }) === "#/library/" + bpName,
    "router: overview encodes back to the bare game URL (never #/library/<name>/overview)");

  // (e) the catalog's entry point, and the create page it leads to.
  const libHtml3 = await nav("#/library");
  assert(libHtml3.includes("Create blueprint"),
    "library: the catalog header offers Create blueprint");
  const newHtml = await nav("#/library/new");
  assert(newHtml.includes("New blueprint") && newHtml.includes("Blueprint name"),
    "create page: #/library/new renders the authoring surface (name field + editor card)");
  assert(!/Something went wrong|crash-screen/i.test(newHtml),
    "create page: mounts without hitting the error boundary (the lazily-imported editor resolves)");

  // (f) the write paths. Intercepted end to end — a live POST would write a blueprint to
  // the host's user dir, which this smoke has no business doing.
  const bpFetch = (status, body, capture) => {
    globalThis.fetch = async (url, opts) => {
      const u = typeof url === "string" ? url : (url && url.url) || "";
      if (/\/api\/v1\/library(\/[^/]+\/file)?(\?.*)?$/.test(u) && opts && opts.method && opts.method !== "GET") {
        if (capture) capture({ url: u, method: opts.method, body: opts.body ? JSON.parse(opts.body) : null });
        return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
      }
      return realFetch(url, opts);
    };
  };
  const OK_WRITE = { etag: "sha256:smoke", sizeBytes: 42, mtime: "2026-07-01T00:00:00Z",
    tier: "user", overridesSystem: false, createdOverride: false };

  let bpCap = null;
  bpFetch(200, OK_WRITE, (c) => { bpCap = c; });
  await st.blueprintFileStore.create(hmId, "smoke_blueprint", "name: smoke_blueprint\n");
  assert(bpCap && bpCap.method === "POST" && bpCap.url.endsWith("/api/v1/library")
    && bpCap.body.name === "smoke_blueprint" && bpCap.body.content === "name: smoke_blueprint\n"
    && bpCap.body.origin === "ui",
    "create blueprint → POST /library { name, content, origin:'ui' }");
  const bpSeeded = st.blueprintFileStore.entry(hmId, "smoke_blueprint");
  assert(bpSeeded && bpSeeded.overridesSystem === false && bpSeeded.canRevert === false && bpSeeded.readOnly === false,
    "create blueprint: a NEW name shadows nothing — both override flags stay false, and the buffer is writable");

  // A name that already exists at either tier is refused by the API, and the SPA gets a
  // typed code it can render under the name input rather than a generic failure.
  bpFetch(409, { error: { code: "name_taken", message: "A blueprint named 'palworld' already exists." } });
  const bp409 = await st.blueprintFileStore.create(hmId, bpName, "name: x\n").then(() => null, (e) => e);
  assert(bp409 && bp409.envCode === "name_taken",
    "create blueprint: an existing name comes back as 409 name_taken (rendered under the name field, not as a crash)");

  // The engine's validator messages ride the envelope's `details`. This is the plumbing
  // that used to be dropped by apiError, leaving the editor able to say only "the engine
  // rejected this" with nothing about what to fix — keep it wired.
  bpFetch(400, { error: { code: "blueprint_invalid", message: "The engine rejected this blueprint.",
    details: { errors: ["missing required field: native.executable_file", "runtime must be one of: native, container"] } } });
  const bp400 = await st.blueprintFileStore.create(hmId, "smoke_bad", "nope\n").then(() => null, (e) => e);
  assert(bp400 && bp400.envCode === "blueprint_invalid" && bp400.details && bp400.details.errors
    && bp400.details.errors.length === 2 && /executable_file/.test(bp400.details.errors[0]),
    "create blueprint: the engine's own errors[] survive the envelope (apiError carries `details` through)");

  // Edit-path wire shapes: a save is etag-conditional, a revert names its origin.
  bpCap = null;
  bpFetch(200, { ...OK_WRITE, overridesSystem: true }, (c) => { bpCap = c; });
  await st.blueprintFileStore.save(hmId, bpName, "name: " + bpName + "\n", bpEntry.etag);
  assert(bpCap && bpCap.method === "PUT" && bpCap.url.endsWith("/api/v1/library/" + bpName + "/file")
    && bpCap.body.etag === bpEntry.etag && bpCap.body.origin === "ui",
    "save blueprint → PUT /library/{id}/file { content, etag, origin:'ui' } (etag-conditional, never blind)");
  assert((st.blueprintFileStore.entry(hmId, bpName) || {}).canRevert === true,
    "save blueprint: a save that created an override flips canRevert on (Revert appears only once there is an original)");

  bpCap = null;
  bpFetch(200, { revertedTo: "system", etag: "sha256:orig", sizeBytes: 10, mtime: "2026-07-01T00:00:00Z" }, (c) => { bpCap = c; });
  await st.blueprintFileStore.revert(hmId, bpName).catch(() => {});   // the reload after it is a live GET
  assert(bpCap && bpCap.method === "DELETE" && bpCap.url.includes("/api/v1/library/" + bpName + "/file?origin=ui"),
    "revert blueprint → DELETE /library/{id}/file?origin=ui (removes the override, keeps the shipped file)");
  globalThis.fetch = realFetch;

  // The store's live entry is restored by revert's own reload, so the roster/editor the
  // rest of this run sees is the file that is actually on disk.
  await st.blueprintFileStore.load(hmId, bpName);
  await nav("#/cluster");

  // ---- Player presence roster ---------------------------------------------
  // GET /servers/{id}/players + the "players" WS topic (players.join / players.leave /
  // players.ban / players.reset, each frame carrying the owning serverId). The roster is
  // a PERMANENT per-identity record, not a live headcount: a row is keyed by
  // `playerIdentity` and carries a `status`, so leaving flips the status rather than
  // removing the row, and "who has ever played" survives a restart. The REST shapes below
  // are intercepted with canned responses (the same non-destructive technique as the
  // command/install paths) so every branch of the contract — including detection:"unknown",
  // which a host with a detecting game can't produce — is exercised deterministically.
  const pt = await vite.ssrLoadModule("/src/pages/PlayersTab.jsx");
  // A roster row, in the shipped DTO's own field names.
  const P = (identity, over = {}) => ({
    playerIdentity: identity, playerId: null, playerName: null, playerAddr: null,
    status: "online", firstSeen: "2026-07-01T00:00:00Z", lastSeen: "2026-07-01T00:00:00Z",
    banReason: null, ...over,
  });

  // Pure helpers — the honesty-critical label fallback, asserted with no network.
  assert(pt.playerLabel(P("76561198000000001", { playerName: "Alice", playerId: "76561198000000001" })) === "Alice",
    "playerLabel: prefers the player's name");
  assert(pt.playerLabel(P("sk-2", { playerAddr: "203.0.113.10:2456" })) === "203.0.113.10:2456",
    "playerLabel: falls back to the address when there is no name");
  assert(pt.playerLabel(P("sk-3")) === "sk-3",
    "playerLabel: falls back to the identity when name+addr are both null (never blank)");
  assert(pt.playerSecondary(P("76561198000000001", { playerName: "Alice", playerId: "76561198000000001", playerAddr: "203.0.113.10:2456" }))
      === "203.0.113.10:2456 · 76561198000000001",
    "playerSecondary: surfaces addr + id alongside a real name (never duplicates the label)");
  assert(pt.playerSecondary(P("sk-2", { playerAddr: "203.0.113.10:2456" })) === "",
    "playerSecondary: empty once addr already IS the label (no redundant repeat)");

  // Pure frame reducer, keyed by playerIdentity — the roster's core semantics.
  let roster = new Map();
  roster = pt.applyPlayerFrame(roster, "players.join", P("id-1", { playerName: "Alice" }), "srv");
  assert(roster.size === 1 && roster.get("id-1").playerName === "Alice",
    "applyPlayerFrame: join upserts by playerIdentity");
  roster = pt.applyPlayerFrame(roster, "players.join", P("id-1", { playerName: "Alice" }), "srv");
  assert(roster.size === 1, "applyPlayerFrame: a repeated join for the same identity doesn't duplicate the row");
  roster = pt.applyPlayerFrame(roster, "players.leave", P("id-1", { playerName: "Alice", status: "offline" }), "srv");
  assert(roster.size === 1 && roster.get("id-1").status === "offline",
    "applyPlayerFrame: leave flips the row to offline and KEEPS it (the roster is a permanent record)");
  roster = pt.applyPlayerFrame(roster, "players.leave", null, "srv");
  assert(roster.size === 1, "applyPlayerFrame: a frame with no player is a no-op (never throws)");

  // players.reset — the api clearing live presence on instance stop/start/restart (a
  // killed process emits no "left" lines). Every row of THAT server goes offline; rows
  // belonging to another server are untouched, and no row is destroyed.
  roster = pt.applyPlayerFrame(roster, "players.join", P("id-2", { playerName: "Bob" }), "srv");
  roster = pt.applyPlayerFrame(roster, "players.join", P("id-3", { playerName: "Carol" }), "other-srv");
  assert(roster.size === 3, "applyPlayerFrame: (setup) three identities across two servers");
  roster = pt.applyPlayerFrame(roster, "players.reset", null, "srv");
  assert(roster.size === 3 && roster.get("id-1").status === "offline" && roster.get("id-2").status === "offline",
    "applyPlayerFrame: players.reset takes that server's rows offline without destroying them");
  assert(roster.get("id-3").status === "online",
    "applyPlayerFrame: players.reset leaves another server's rows alone (no cross-server wipe)");
  roster = pt.applyPlayerFrame(roster, "players.join", P("id-1", { playerName: "Alice" }), "srv");
  assert(roster.get("id-1").status === "online",
    "applyPlayerFrame: a rejoin after reset flows back in as an ordinary join (no special-casing needed)");

  // The rendered panel, against the contract's real matrix — each REST shape intercepted
  // non-destructively, so detection:"unknown" and an empty roster are provable on a host
  // whose live games all detect presence.
  const pSv = st.serversStore.find(PROBE.id) || st.serversStore.getState().list[0];
  if (pSv) {
    const mockPlayers = (body) => {
      globalThis.fetch = async (url, opts) => {
        const u = typeof url === "string" ? url : (url && url.url) || "";
        if (/\/api\/v1\/servers\/[^/]+\/players$/.test(u) && (!opts || !opts.method || opts.method === "GET")) {
          return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
        }
        return realFetch(url, opts);
      };
    };

    mockPlayers({ detection: "unknown", players: [] });
    const unknownHtml = await nav("#/servers/" + pSv.id);
    assert(unknownHtml.includes("Presence not available for this game"),
      "players: detection:'unknown' renders the honest not-measurable state, never '0 players'");
    assert(!unknownHtml.includes("No players yet"),
      "players: 'unknown' is never conflated with a real configured-and-empty roster");

    await nav("#/cluster");   // force a remount so the next canned response actually re-fetches
    mockPlayers({ detection: "configured", players: [] });
    const emptyHtml = await nav("#/servers/" + pSv.id);
    assert(emptyHtml.includes("No players yet") && !emptyHtml.includes("Presence not available"),
      "players: configured-and-empty is its OWN state (nobody has connected yet ≠ can't be measured)");

    await nav("#/cluster");
    mockPlayers({ detection: "configured", players: [
      P("76561198000000001", { playerName: "Alice", playerId: "76561198000000001" }),
      P("sk-2", { playerName: "Builder42", playerAddr: "203.0.113.10:2456", status: "offline" }),
      P("sk-3", { playerName: "Ranger" }),
    ] });
    const configuredHtml = await nav("#/servers/" + pSv.id);
    globalThis.fetch = realFetch;   // done intercepting — the WS proof below needs no fetch at all
    assert(["Alice", "76561198000000001", "Builder42", "203.0.113.10:2456", "Ranger"].every((s) => configuredHtml.includes(s)),
      "players: a configured roster renders every row's real name/id/addr (id+name, name+addr, name-only mixes)");
    assert(/\d+[smhd] ago/.test(configuredHtml),
      "players: first/last seen render as relative times");
    assert(!configuredHtml.includes("Presence not available") && !configuredHtml.includes("No players yet"),
      "players: a populated, configured roster shows neither the unknown nor the empty state");

    // Live follow: a WS players.join frame for THIS server appends a row on the mounted
    // panel — the same subscribe → append → render proof as the console tail.
    api.__dispatch({ topic: "players", type: "players.join",
      data: { serverId: pSv.id, player: P("sk-4", { playerName: "SMOKE_JOIN_PLAYER" }) } });
    await sleep(140);
    assert(w.document.getElementById("root").innerHTML.includes("SMOKE_JOIN_PLAYER"),
      "players: a live players.join frame for this server appends a row (subscribe → append → render)");

    api.__dispatch({ topic: "players", type: "players.leave",
      data: { serverId: pSv.id, player: P("76561198000000001", { playerName: "Alice", playerId: "76561198000000001", status: "offline" }) } });
    await sleep(140);
    const leftHtml = w.document.getElementById("root").innerHTML;
    assert(leftHtml.includes("Alice"),
      "players: a live players.leave KEEPS the row (permanent record — status changes, history doesn't vanish)");
    assert(leftHtml.includes("SMOKE_JOIN_PLAYER"), "players: the earlier live join survives an unrelated leave");

    // A frame for a DIFFERENT server must never leak into this one's roster.
    api.__dispatch({ topic: "players", type: "players.join",
      data: { serverId: "some-other-server", player: P("sk-9", { playerName: "WRONG_SERVER_PLAYER" }) } });
    await sleep(140);
    assert(!w.document.getElementById("root").innerHTML.includes("WRONG_SERVER_PLAYER"),
      "players: a WS frame for a different serverId is ignored (no cross-server leak)");

    // players.reset (instance stop/start/restart): live presence drops with no REST
    // refetch — the rows stay (they are the record of who has played), and a fresh join
    // flows back in normally.
    api.__dispatch({ topic: "players", type: "players.reset", data: { serverId: pSv.id } });
    await sleep(140);
    assert(w.document.getElementById("root").innerHTML.includes("SMOKE_JOIN_PLAYER"),
      "players: a live players.reset keeps the roster rows (restart clears presence, not history)");
    api.__dispatch({ topic: "players", type: "players.join",
      data: { serverId: pSv.id, player: P("sk-10", { playerName: "SMOKE_POST_RESET_PLAYER" }) } });
    await sleep(140);
    assert(w.document.getElementById("root").innerHTML.includes("SMOKE_POST_RESET_PLAYER"),
      "players: a rejoin after reset renders normally (reset doesn't wedge the roster)");

    await nav("#/cluster");
  } else {
    console.log("  skip players roster (no server on this backend)");
  }

  // ---- the cluster invariant: N nodes, nothing selected --------------------
  // The regression test for the whole cluster-transparency doctrine. Everything
  // above runs against ONE node, which is exactly the shape that hides a
  // positional default — a fallback to "the first connection" is invisible when
  // there is only one. So grow the set to two and assert the two halves of the
  // rule: routing is EXACT (a named node resolves to its own base, an unknown one
  // fails loudly, a node-less call fails loudly), and the app still boots and
  // renders with no selection state anywhere.
  //
  // It also exercises P1's append path — a peer discovered after boot joins the
  // live connection set in place, with no reload.
  {
    const realId = cfg.CONNECTIONS[0].id;
    assert(typeof realId === "string" && realId.length > 0,
      `cold-boot seed reconciled its backend id from GET /hosts (${realId || "still null"})`);

    // A second ORIGIN for the same backend: reachable (so the fan-out is real),
    // textually distinct (so the origin dedupe admits it), and carrying its own
    // id — from the SPA's point of view a second node.
    const peerUrl = API.includes("127.0.0.1") ? API.replace("127.0.0.1", "localhost") : API.replace("localhost", "127.0.0.1");
    const added = cfg.addConnections([{ id: "smoke-peer", url: peerUrl, name: "Smoke peer" }]);
    assert(added.length === 1 && cfg.CONNECTIONS.length === 2,
      `append: a discovered peer joins the live connection set in place (n=${cfg.CONNECTIONS.length})`);
    assert(cfg.addConnections([{ id: "smoke-peer", url: peerUrl }]).length === 0,
      "append: re-registering a peer we already drive is a no-op (repeated discovery is idempotent)");

    // Synchronous, before the append's own rehydrate can reconcile ids underneath us.
    assert(cfg.apiV1Of(realId) === API + "/api/v1", "routing: a named node resolves to its own base");
    assert(cfg.apiV1Of("smoke-peer") === peerUrl + "/api/v1",
      "routing: the appended peer resolves to ITS base, not to the first connection's");
    let threw = false;
    try { cfg.apiV1Of("no-such-node"); } catch { threw = true; }
    assert(threw, "routing guard: an unresolvable node id throws in dev (never falls through to node 0)");
    threw = false;
    try { cfg.apiV1Of(null); } catch { threw = true; }
    assert(threw, "routing guard: a node-less routed call throws in dev once the cluster has two nodes");

    // Nothing can express "the current node" any more: the store, the hook and
    // the persisted key are gone, so no surface can be silently reframed to one
    // node and no code can bind to a selection that isn't there.
    const st = await vite.ssrLoadModule("/src/lib/stores.js");
    assert(st.selectedHostStore === undefined && st.useSelectedHostId === undefined && st.scopeServers === undefined,
      "the selected-node store, hook and scope helper no longer exist");
    assert(!w.localStorage.getItem("krystal:selectedHost"), "no selected-node state is persisted");
    // A run that spans nodes, with the set finally two wide. ONE run id to both, one POST each, and
    // no relay between them — correlation, not coordination, so losing the node you fired FROM
    // cannot orphan work on the nodes it runs ON.
    //
    // Both POSTs are intercepted: this peer is a second ORIGIN for the SAME backend, so a real one
    // would issue commands against live game servers twice over. The peer's is answered with a
    // network failure, which is the case worth proving — its share never started.
    {
      const seen = [];
      const realFetch2 = globalThis.fetch;
      globalThis.fetch = async (url, opts) => {
        const u = typeof url === "string" ? url : (url && url.url) || "";
        if (opts && opts.method === "POST" && /\/api\/v1\/servers\/commands$/.test(u)) {
          const body = JSON.parse(opts.body || "null");
          seen.push({ u, body });
          if (u.startsWith(peerUrl)) throw new Error("peer unreachable");
          return new Response(JSON.stringify({
            batchId: "batch_multi", runId: body.runId, verb: body.verb, admitted: body.serverIds, refused: [],
          }), { status: 202, headers: { "content-type": "application/json" } });
        }
        return realFetch2(url, opts);
      };
      const runMulti = await batch.dispatchRun({
        verb: "stop",
        servers: [{ id: PROBE.id, hostId: realId }, { id: "peer-srv", hostId: "smoke-peer" }],
      });
      globalThis.fetch = realFetch2;
      st.serversStore.patch(PROBE.id, { job: null });   // local only — nothing reached a node
      assert(seen.length === 2 && new Set(seen.map(x => x.body.runId)).size === 1,
        "a run spanning two nodes is TWO posts carrying ONE run id (no coordinator, no peer relay)");
      assert(seen.every(x => x.body.serverIds.length === 1),
        "each node is handed only its own servers — an id a node does not own is never forwarded to it");
      assert(runMulti.nodesReached === 1 && runMulti.nodesAsked === 2
        && runMulti.admitted.length === 1 && runMulti.undispatched.length === 1
        && runMulti.undispatched[0].hostId === "smoke-peer",
        "dispatch can partially fail: 1 of 2 nodes reached, the other's share reported as never started");
    }

    // The hydrate, fanned across two nodes with one of them down. This is the shape the tray has to
    // get right: a run reassembled while a node is unreachable is a run whose share THERE is unknown,
    // not a run with fewer members — so the reachable node's share is shown and the silence is named.
    {
      const realFetch2 = globalThis.fetch;
      globalThis.fetch = async (url, opts) => {
        const u = typeof url === "string" ? url : (url && url.url) || "";
        if (/\/api\/v1\/batches\?/.test(u)) {
          if (u.startsWith(peerUrl)) throw new Error("peer unreachable");
          return new Response(JSON.stringify({ data: [{
            id: "b_fan", runId: "run_fan", verb: "restart", state: "active", actor: "smoke", origin: "ui",
            createdAt: "2026-08-22T11:00:00Z", settledAt: null,
            counts: { total: 2, pending: 1, running: 1, succeeded: 0, failed: 0, refused: 0, cancelled: 0, unknown: 0 },
            members: [{ serverId: "fan-a", state: "running", jobId: "j1", queuedPosition: null, error: null, settledAt: null },
                      { serverId: "fan-b", state: "pending", jobId: "j2", queuedPosition: 2, error: null, settledAt: null }],
          }] }), { status: 200, headers: { "content-type": "application/json" } });
        }
        return realFetch2(url, opts);
      };
      await st.batchesStore.refresh();
      globalThis.fetch = realFetch2;
      const fanRun = st.runsFrom(st.batchesStore.getState().byId).find(r => r.runId === "run_fan");
      assert(fanRun && fanRun.nodes.length === 1 && fanRun.nodes[0] === realId && fanRun.counts.total === 2,
        "the hydrate fans across every connection and keeps each node's batches under the node that answered");
      const silent = st.batchesStore.unreachableNodes();
      assert(silent.length === 1 && silent[0].hostId === "smoke-peer",
        "the node that refused the hydrate is named — its share of any run is unknown, which is not the same as none");
      st.batchesStore.drop("b_fan");
    }

    const twoNodeHtml = await nav("#/servers");
    assert(twoNodeHtml.includes(PROBE.id), "servers roster renders with two connections and no selection");
    const dashHtml = await nav("#/cluster");
    assert(dashHtml.length > 400 && !/Something went wrong/i.test(dashHtml),
      "cluster page renders with two connections and no selection");
  }

  root.unmount();
} finally {
  console.error = origErr;
  await vite.close();
  // The only teardown there is: put back this repo's own env file. Nothing on the host was
  // written, so there is nothing on the host to clean up (THE ONE RULE) — and no cleanup
  // step that can silently fail and leave residue in the operator's audit log.
  restoreEnv();
}
console.log(fail ? `\n✗ ${fail} live check(s) failed` : `\n✓ live wiring verified against ${API}`);
process.exit(fail ? 1 : 0);
