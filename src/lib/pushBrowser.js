// pushBrowser.js — the browser half of Web Push, with no opinion about which backend it talks to.
//
// Both surfaces in this tree do the same three awkward things: work out whether this browser can
// receive a push at all, get a subscription bound to the right application server key, and give it
// up again. What differs is only the transport — the panel asks kgsm-api, the standalone assistant
// asks the leaf, and the two answer on different routes with different shapes. So the transport
// arrives as a parameter, exactly the way `assistantSession.setOriginResolver` takes its address
// lookup, and this module imports NOTHING.
//
// That last part is structural, not tidiness. `npm run check:assistant` walks the standalone
// import graph and fails on the panel's roots; a shared module that reached `apiClient` would drag
// the whole cluster model into a surface that has no nodes.
//
// Two platform rules, both load-bearing:
//   - Permission must be requested from a real user gesture. A prompt on load gets denied, and a
//     denied permission is close to unrecoverable — the browser stops asking and the person has to
//     find it in site settings.
//   - Chrome requires `userVisibleOnly: true`, so every push shows a notification. This cannot be a
//     quiet data channel.

/**
 * What this browser can do, without asking it for anything.
 *
 * `state` is one of:
 *   "unsupported"   — no service worker or no Push API at all
 *   "needs-install" — iOS Safari in a tab: supported once added to the Home Screen
 *   "denied"        — permission was refused; we cannot re-prompt
 *   "ready"         — can subscribe (permission granted, or still unasked)
 *
 * "needs-install" is its own state rather than folded into "unsupported" because on iOS the
 * feature is not missing, it is one step away — and telling somebody it is unsupported when the fix
 * is "add to Home Screen" is telling them something false.
 */
function support() {
  if (typeof window === "undefined") return { state: "unsupported", canPrompt: false };

  const hasSW = "serviceWorker" in navigator;
  const hasPush = "PushManager" in window;
  const hasNotif = "Notification" in window;

  if (!hasSW || !hasPush || !hasNotif) {
    // iOS exposes PushManager only to an installed web app. `standalone` is the iOS-specific signal
    // for "launched from the Home Screen"; display-mode covers the installed case everywhere else.
    const installed = window.navigator.standalone === true
      || (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
    const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent || "");
    if (iOS && !installed) return { state: "needs-install", canPrompt: false };
    return { state: "unsupported", canPrompt: false };
  }

  if (Notification.permission === "denied") return { state: "denied", canPrompt: false };
  return { state: "ready", canPrompt: Notification.permission !== "granted" };
}

/**
 * The registered service worker, or null when there is none.
 *
 * `navigator.serviceWorker.ready` NEVER SETTLES when nothing is registered — it does not reject,
 * it hangs forever waiting for a registration that is not coming. Awaiting it directly leaves every
 * caller pending, and a settings screen sits on "Checking…" for the life of the page. Dev builds
 * register no worker at all and a failed registration in production looks identical, so this asks
 * `getRegistration()` — which resolves either way — first.
 */
async function worker() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return null;
    return await navigator.serviceWorker.ready;
  } catch { return null; }
}

/** This browser's existing subscription for this origin, if it already has one. */
async function currentSubscription() {
  const reg = await worker();
  if (!reg) return null;
  try { return await reg.pushManager.getSubscription(); } catch { return null; }
}

/** The endpoint identifying this browser to a backend, or null. */
async function currentEndpoint() {
  const sub = await currentSubscription();
  return sub ? sub.endpoint : null;
}

/**
 * Get a subscription bound to `publicKey`, prompting for permission if needed.
 *
 * Throws with a readable message rather than resolving false, so a caller can surface the reason —
 * "you blocked this" and "this build has no worker" want different sentences and neither is a bug.
 *
 * @param {string} publicKey        the application server key, base64url
 * @returns {Promise<PushSubscription>}
 */
async function acquire(publicKey) {
  const reg = await worker();
  if (!reg) throw new Error("This build has no service worker, so notifications can't be set up here.");
  if (!publicKey) throw new Error("This host isn't offering a notification key.");

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(permission === "denied"
      ? "Notifications are blocked for this site. You'll have to re-allow them in your browser settings."
      : "Notification permission wasn't granted.");
  }

  // A subscription made against a DIFFERENT application server key cannot be reused: the browser
  // bakes the key in at subscribe time and re-subscribing with another throws. Drop it and make a
  // new one, rather than registering something this host could never sign for.
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub, publicKey)) {
    try { await sub.unsubscribe(); } catch { /* it is going away regardless */ }
    sub = null;
  }
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }
  return sub;
}

/**
 * Give up this browser's subscription, telling the backend first.
 *
 * The order matters. If the browser-side unsubscribe succeeded and the backend call then failed,
 * the host would keep pushing to a dead endpoint until it collected enough 410s to retire it.
 *
 * @param {(endpoint: string) => Promise<void>} unregister
 */
async function release(unregister) {
  const sub = await currentSubscription();
  if (!sub) return;
  try {
    await unregister(sub.endpoint);
  } finally {
    try { await sub.unsubscribe(); } catch { /* already gone */ }
  }
}

/** Whether a subscription was created against this exact application server key. */
function sameKey(sub, publicKey) {
  const key = sub.options && sub.options.applicationServerKey;
  if (!key) return false;
  const a = new Uint8Array(key);
  const b = urlBase64ToUint8Array(publicKey);
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// `applicationServerKey` takes bytes, and the key travels as base64url — which atob does not
// accept, hence the re-padding rather than a direct decode.
function urlBase64ToUint8Array(base64Url) {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export {
  acquire, currentEndpoint, currentSubscription, release, sameKey, support, urlBase64ToUint8Array, worker,
};
