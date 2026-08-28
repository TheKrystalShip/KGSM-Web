// Service worker for the standalone Krystal Assistant PWA.
//
// Same job as the Control Panel's (public/sw.js): satisfy the browser's installability criteria
// with a functional `fetch` handler, and give an offline-launchable app shell — without ever
// touching the live data path.
//
// IT DIFFERS FROM THE PANEL'S IN THE ONE WAY THAT MATTERS, and the difference is not stylistic.
// The panel is served by kgsm-api, whose API lives under /api/ and /auth/, so a DENYLIST of those
// two prefixes is exhaustive. This surface is served BY THE LEAF IT TALKS TO, and the leaf's routes
// are UNPREFIXED AT THE ROOT — /turn, /confirm, /conversations, /tools, /health, /auth/*, /admin/*.
// A denylist there is wrong by default: every route the leaf grows is cached until someone
// remembers to add it, and a stale authenticated 200 both masks token expiry from the session layer
// and serves one person's conversation out of another's cache.
//
// So this ALLOWLISTS instead. Only the app shell and the static asset directories are ever
// intercepted; anything not named below reaches the network untouched, which is the safe default
// for a route this file has never heard of.
//
// Not a Workbox precache — Vite's content-hashed assets are cached on demand (cache-first is safe
// because their URL changes when their content does); the shell is network-first so a deploy lands
// on the next online load.

const VERSION = "v3";
const CACHE = `krystal-assistant-shell-${VERSION}`;

// The bare shell, available offline immediately after install. Hashed build assets are NOT listed
// (their names aren't known at author time) — they populate the cache on first visit.
const CORE = [
  "/",
  "/index.html",
  "/assistant.webmanifest",
  "/icons/assistant-icon.svg",
  "/icons/assistant-icon-192.png",
  "/icons/assistant-icon-512.png",
  "/icons/assistant-icon-maskable-512.png",
];

// The only paths this worker may serve from cache. Directories of build output and artwork —
// every one of them static files the deploy wrote, none of them anything the leaf computes.
const CACHEABLE = ["/assets/", "/fonts/", "/icons/", "/splash/"];
const CACHEABLE_EXACT = ["/assistant.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // addAll is atomic; tolerate a missing optional file so install never wedges the whole
      // worker over one 404.
      .then((cache) => Promise.allSettled(CORE.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("krystal-assistant-shell-") && k !== CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only same-origin GETs. A turn, a confirmation and a sign-out are POSTs and a conversation
  // delete is a DELETE, so they never reach the branches below — but the allowlist is what
  // actually keeps the leaf's GET routes (/conversations, /tools, /auth/me) out of the cache.
  if (req.method !== "GET" || url.origin !== self.location.origin) return;

  // App-shell navigations: network-first so deploys land on the next load; fall back to the
  // cached shell when offline so the installed app still opens. A sign-in returns here as a
  // navigation carrying its session in the fragment, which is never part of a cache key.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("/", copy));
          return res;
        })
        .catch(() => caches.match("/").then((m) => m || caches.match("/index.html")))
    );
    return;
  }

  const cacheable = CACHEABLE.some((p) => url.pathname.startsWith(p))
    || CACHEABLE_EXACT.includes(url.pathname);
  if (!cacheable) return;

  // Static assets: cache-first with a background refresh (stale-while-revalidate).
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

// --- Web Push -----------------------------------------------------------------------------------
//
// The leaf pushes one kind of thing: an action it staged and is waiting on you to approve. It only
// does so once you have stopped looking at the chat, so a notification arriving means nobody is
// watching this decision anywhere.
//
// Every payload here is a CAPABILITY. `confirm` and `cancel` are single-use handles that act
// without a session — which is the only way a worker can act at all — so they are never logged,
// never put in a URL, and never survive the notification they arrived on.
//
// The clock is the whole design constraint. A staged action lives five minutes, so these buttons
// go stale on their own and tapping a stale one is an ORDINARY outcome, not an error: it gets a
// plain sentence, the same as a successful one would.

const ACTION_ROUTE = "/push/actions/";

self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = {}; }

  const title = payload.title || "The assistant is waiting on you";
  const body = payload.body || "An action needs your approval.";

  // Two kinds arrive here: a question, which carries the handles its buttons spend, and the VERDICT
  // on one already answered, which carries none. Buttons are drawn only when there is something they
  // could do — an "Confirm" on a finished backup is an offer to run it twice.
  const decidable = !!(payload.confirm || payload.cancel);

  // `userVisibleOnly` is not advisory: Chrome revokes a subscription that receives pushes without
  // showing anything. There is always a notification here, even for a payload we could not parse.
  event.waitUntil(self.registration.showNotification(title, {
    body,
    // Tagging by the action means a second notification about it REPLACES the first rather than
    // stacking. It is also how the verdict lands ON the question it answers, so the shade never
    // holds a live-looking set of buttons for something already done.
    tag: payload.tag || "kgsm-confirmation",
    renotify: !decidable,
    requireInteraction: false,
    // The same icon the manifest names — a path that 404s renders no icon at all rather than a
    // fallback, so this is the one place a guessed filename is silently wrong.
    icon: "/icons/assistant-icon-192.png",
    // No `badge`: it wants a monochrome glyph this surface does not ship, and pointing it at the
    // colour icon renders a grey square on Android.
    // Some platforms render no buttons at all (iOS today). The tap-through must therefore be a
    // complete answer on its own, and it is: it opens the chat, where the same action is waiting.
    actions: decidable
      ? [{ action: "confirm", title: "Confirm" }, { action: "cancel", title: "Cancel" }]
      : [],
    data: {
      confirm: payload.confirm || null,
      cancel: payload.cancel || null,
      expiresAt: payload.expiresAt || null,
    },
  }));
});

self.addEventListener("notificationclick", (event) => {
  const data = event.notification.data || {};
  const handle = event.action === "confirm" ? data.confirm
    : event.action === "cancel" ? data.cancel
      : null;

  event.notification.close();

  // No button: the body itself was tapped. Open the chat rather than deciding anything — a tap on
  // the text is "show me this", and acting on it would run something nobody chose to run.
  if (!handle) {
    event.waitUntil(openChat());
    return;
  }

  event.waitUntil(redeem(handle, event.action));
});

/**
 * Spend a handle and say what happened.
 *
 * What comes back is "approved and started", NOT the result. A confirmed action runs to completion
 * — a backup is minutes — and this worker has a short, unstated budget before the browser terminates
 * it, so a route that waited for the result would return to nothing at all: the tap would appear to
 * do nothing while the work ran. The leaf sends the real verdict as its own push when it settles.
 *
 * The acknowledgement is still required rather than polite: this worker was woken by a push, so it
 * owes a visible answer — and it is the only place one can appear, because the person is by
 * definition not looking at the chat.
 */
async function redeem(handle, action) {
  let message;
  try {
    const res = await fetch(ACTION_ROUTE + encodeURIComponent(handle), {
      method: "POST",
      // Same origin — this SPA is served by the leaf that answers the route — and deliberately
      // credential-free: the handle is the whole credential, and there is no session to send.
      headers: { Accept: "application/json" },
    });
    const body = await res.json().catch(() => ({}));
    message = body.message
      || (res.ok ? "Done." : "That notification is no longer valid.");
  } catch {
    // Never report an unreachable host as a completed action. A failed fetch means we do not know
    // whether anything ran, and the action is still waiting if it did not.
    message = "Couldn't reach the assistant — the action is still waiting if it hasn't expired.";
  }

  await self.registration.showNotification(
    action === "cancel" ? "Cancelled" : "The assistant", {
      body: message,
      // Its own tag, so this acknowledgement does not overwrite the question and is not overwritten
      // by the verdict that follows it — they are three different statements about one action.
      tag: "kgsm-confirmation-ack",
      icon: "/icons/assistant-icon-192.png",
    });
}

/** Focus an open chat if there is one, otherwise open it. */
async function openChat() {
  const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of all) {
    if (client.url.startsWith(self.registration.scope) && "focus" in client) return client.focus();
  }
  return self.clients.openWindow("/");
}
