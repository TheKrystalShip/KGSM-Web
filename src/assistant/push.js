import { assistant } from "../lib/assistantClient.js";
import { acquire, currentEndpoint, release, support } from "../lib/pushBrowser.js";
import { SELF } from "./self.js";

// The standalone assistant's Web Push: registering THIS browser with the leaf it is served by.
//
// The leaf announces one thing — an action it staged and is waiting on you to approve — and it does
// so only once you have stopped looking at the chat. Everything else a KGSM host might tell you
// about is the Control Panel's, on its own origin with its own key.
//
// Same-origin throughout: this SPA is served by the leaf that answers `/push/*`, so there is no CORS
// here and no second host to scope a call to. That is the whole reason this surface is the one that
// carries it — the panel's dock talks to the leaf cross-origin, and its own worker is already
// subscribed to kgsm-api's key, which a subscription cannot be shared with.

// SELF, not the origin. The id is a key into the session store — `setOriginResolver` is what turns
// it into an address — so any other value resolves to the right URL carrying no bearer, and the 401
// that follows is indistinguishable from the leaf being down.
function leaf() {
  return assistant.host(SELF);
}

/**
 * Whether this browser could receive a notification, and whether the host would send one.
 *
 * The two are separate questions with separate answers: a browser that cannot subscribe should be
 * told what to do about it (on iOS, "add to the Home Screen"), and a host whose operator has the
 * whole path switched off should say so rather than offer a toggle that achieves nothing.
 */
async function status() {
  const browser = support();
  if (browser.state === "unsupported" || browser.state === "needs-install") {
    return { ...browser, enabled: false, registered: false };
  }

  let enabled = false;
  let registered = false;
  try {
    const key = await leaf().pushKey();
    enabled = key.enabled !== false;

    // "Is this browser registered" is the only device question this screen can ask: it knows its own
    // endpoint and nothing about anyone's other devices, which is exactly as much as it should.
    const endpoint = await currentEndpoint();
    if (endpoint) {
      const devices = await leaf().pushDevices();
      registered = (devices.endpoints || []).includes(endpoint);
    }
  } catch (e) {
    // A leaf that will not answer is not a browser that cannot subscribe, so what the browser can do
    // is still reported. The REASON travels with it rather than collapsing to "couldn't reach":
    // a lapsed session and a host that is actually down produce the same silence here, and telling
    // somebody to check the network when they need to sign in again is a wrong answer, not a vague
    // one. The leaf answers 401 on an expired bearer, which is a fact worth passing on.
    const status = e && e.status;
    return {
      ...browser,
      enabled: false,
      registered: false,
      unreachable: true,
      // The client already writes a sentence for a person on every error it raises; preferring it
      // keeps one voice across the surface rather than a second phrasing of the same failure here.
      reason: status === 401 || status === 403
        ? "Your session with the assistant has expired — reload the app to sign back in."
        : (e && (e.userMessage || e.message)) || "The assistant didn't answer.",
    };
  }

  return { ...browser, enabled, registered };
}

/**
 * Subscribe this browser and register it with the leaf.
 *
 * Must be called from a real user gesture: a permission prompt that was not asked for is denied,
 * and a denied permission is close to unrecoverable.
 */
async function subscribe() {
  const { publicKey } = await leaf().pushKey();
  const sub = await acquire(publicKey);

  // toJSON() is the shape the browser minted; the two keys are what the payload is encrypted to.
  const json = sub.toJSON();
  await leaf().pushSubscribe({
    endpoint: json.endpoint,
    p256dh: json.keys && json.keys.p256dh,
    auth: json.keys && json.keys.auth,
  });
  return sub.endpoint;
}

/** Give this browser up, telling the leaf before the browser forgets its own endpoint. */
async function unsubscribe() {
  await release((endpoint) => leaf().pushUnsubscribe({ endpoint }));
}

export { status, subscribe, unsubscribe };
