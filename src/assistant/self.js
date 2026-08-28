// The id this surface addresses its leaf by.
//
// The leaf is addressed by a host id like any other, because the session layer and the client are
// both keyed by one. There is only ever this one, and it is not a node — it is "the assistant that
// served this page". `assistantSession.setOriginResolver` turns it into `location.origin`, so the id
// is a key into the session store rather than an address.
//
// It lives in a module of its own rather than in `App.jsx` because everything that talks to the
// leaf needs it, including modules `App.jsx` itself pulls in — `SettingsPage` → `push.js` would
// close a cycle back onto the shell. Passing anything else (the origin, say) resolves to the right
// URL and the WRONG session, which is a 401 that reads as the host being unreachable.
const SELF = "self";

export { SELF };
