// device.js — this browser's identity, for preferences that are per DEVICE rather than per account.
//
// Client-minted and kept. A session id was the obvious candidate and is wrong: sessions are per host
// and they expire, so the same laptop signing in again would read as a new device and lose whatever
// was stored against it.
//
// The id is meaningless to anybody but the preference store — it names a browser profile, not a
// person and not a machine. Clearing site data mints a new one, which is the correct behaviour:
// that browser genuinely has no preferences any more.
//
// Imports NOTHING, deliberately. The standalone assistant does not reach the panel's data layer, and
// a module both surfaces might one day want must not be what drags `apiClient` into that bundle
// (`npm run check:assistant`).

const DEVICE_KEY = "krystal:device";

// The header the API reads it from. One constant, because a mismatch between what the client sends
// and what the server reads is a 400 on every preference call with nothing to point at.
const DEVICE_HEADER = "X-Krystal-Device";

let _cached = null;

function mint() {
  // `crypto.randomUUID` is unavailable on a plain-http origin, which the panel can be served from on
  // a LAN — so this falls back rather than throwing on exactly the deployments the project targets.
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return "dev_" + crypto.randomUUID();
  } catch { /* fall through */ }
  const rand = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  return "dev_" + Date.now().toString(36) + "_" + rand;
}

/// This browser's device id, minted on first ask and kept.
///
/// With storage blocked or full the id is held in memory for the life of the tab. Preferences then
/// last as long as the tab does rather than failing outright — a private window that cannot persist
/// anything should still be able to arrange its dashboard.
function deviceId() {
  if (_cached) return _cached;
  try {
    const held = localStorage.getItem(DEVICE_KEY);
    if (held) { _cached = held; return _cached; }
  } catch { /* unreadable storage — mint a per-tab one below */ }
  _cached = mint();
  try { localStorage.setItem(DEVICE_KEY, _cached); } catch { /* per-tab only */ }
  return _cached;
}

export { DEVICE_HEADER, DEVICE_KEY, deviceId };
