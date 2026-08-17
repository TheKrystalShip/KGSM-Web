import { assistantSession } from "./assistantSession.js";
import { parseSseEvent, readSseStream } from "./sse.js";

// assistantClient.js — the seam onto an assistant LEAF, spoken directly.
//
// The chat addresses the assistant on its own public origin with a session the leaf issued,
// so kgsm-api is not in the path of a turn, a confirmation, or a conversation read. The leaf's
// wire contract is `kgsm-llm/docs/wire-contract.md`; the routes are the leaf's own, unprefixed
// (`/turn`, `/confirm`, `/conversations`, …), not the aggregator's `/api/v1/assistant/*`.
//
// A host with no browser route for its assistant has no chat: `routeError` is thrown rather
// than falling back to the node's relay. The relay still exists in kgsm-api, but it is peer
// transport for reaching ANOTHER node's assistant — taking it for the local node restores the
// coupling this path removes, and kgsm-api logs a warning when anything does.
//
// Auth is reactive, the same shape the node seam uses: send the token we hold, and let the
// leaf be the judge. A 401 rotates the leaf's refresh token once and replays — EXCEPT for the
// two calls that are not replayable (a turn consumes context and a confirm consumes a
// single-use token), which rotate BEFORE the call instead if the access token has lapsed.

const IDLE_MS = 60000;   // a confirm stream may sit silent through a download; ≫ the leaf's 15s heartbeat

// The id the leaf gave THIS browser's event stream, per host. Sent on every call so the changes this
// surface causes come back stamped with it, which is how the stream tells its own echo from a change
// made in another tab or on a phone. Empty until a stream is open — a call made before then is simply
// not attributable, which costs one redundant re-read and nothing else.
const STREAM_IDS = new Map();
function originHeaders(hostId) {
  const id = STREAM_IDS.get(hostId);
  return id ? { "X-Assistant-Origin": id } : null;
}

function leafError(status, body) {
  const env = (body && body.error) || {};
  const message = typeof env === "string" ? env : (env.message || body?.message);
  const e = new Error(message || "HTTP " + status);
  e.code = status;
  e.status = status;
  e.envCode = (typeof env === "object" && env.code) || body?.error || null;
  e.userMessage = message || "The assistant returned an error.";
  return e;
}
function routeError() {
  const e = new Error("This host reports no public address for its assistant.");
  e.code = "ENOROUTE";
  e.userMessage = "This host's assistant has no address the browser can reach.";
  return e;
}
function netError() {
  const e = new Error("Can't reach the assistant (network).");
  e.code = "ECONNREFUSED";
  e.userMessage = "Can't reach the assistant.";
  return e;
}
function authError() {
  const e = new Error("No assistant session on this host.");
  e.code = 401;
  e.status = 401;
  e.userMessage = "Sign in to this host's assistant to continue.";
  return e;
}

// Decode a JWT's `exp` (seconds → ms); null when the token isn't a parseable JWT. Used only to
// decide a PROACTIVE rotation ahead of the two calls a 401 cannot be replayed through.
function jwtExpMs(token) {
  try {
    const part = String(token).split(".")[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    const exp = JSON.parse(json).exp;
    return typeof exp === "number" ? exp * 1000 : null;
  } catch { return null; }
}
function lapsed(token) {
  const exp = jwtExpMs(token);
  return exp !== null && exp <= Date.now();
}

function baseOf(hostId) {
  const origin = assistantSession.originOf(hostId);
  if (!origin) throw routeError();
  return origin;
}

// Ensure we hold a usable token before a non-replayable call. A lapsed one is rotated first,
// because replaying a turn would spend the user's prompt twice and replaying a confirm would
// present a token the leaf has already burned.
async function freshToken(hostId) {
  let token = assistantSession.tokenOf(hostId);
  if (!token || lapsed(token)) token = await assistantSession.rotate(hostId);
  if (!token) throw authError();
  return token;
}

// A JSON call that must NOT be replayed, so a lapsed token is rotated BEFORE it is spent rather
// than healed from a 401 — the same treatment /turn and /confirm get, and for the same reason.
// Running a command can be non-idempotent: a switch given no state TOGGLES, so a replayed
// `/think` would flip twice and land back where it started, reporting a change that did not stick.
async function jsonOnce(hostId, method, path, body) {
  const base = baseOf(hostId);
  const token = await freshToken(hostId);
  const headers = { Accept: "application/json", ...originHeaders(hostId) };
  if (body !== undefined && body !== null) headers["Content-Type"] = "application/json";
  headers.Authorization = "Bearer " + token;

  let res;
  try {
    res = await fetch(base + path, {
      method,
      headers,
      body: body === undefined || body === null ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    if (e && e.name === "AbortError") throw e;
    throw netError();
  }

  if (res.status === 204) return null;
  let payload = null;
  try { payload = await res.json(); } catch { payload = null; }
  if (!res.ok) throw leafError(res.status, payload);
  return payload;
}

// A plain JSON call, healed reactively: on 401 rotate once and replay. Replay is safe here —
// these are reads, a soft delete, a compact and a feedback vote, all idempotent in effect.
async function json(hostId, method, path, body, opts) {
  const base = baseOf(hostId);
  const send = async (token) => {
    const headers = { Accept: "application/json", ...originHeaders(hostId) };
    if (body !== undefined && body !== null) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = "Bearer " + token;
    try {
      return await fetch(base + path, {
        method,
        headers,
        body: body === undefined || body === null ? undefined : JSON.stringify(body),
        signal: opts && opts.signal,
      });
    } catch (e) {
      if (e && e.name === "AbortError") throw e;
      throw netError();
    }
  };

  // A token whose own `exp` has passed is not worth a request: the leaf will refuse it, and the 401
  // below would rotate anyway. Treating it as no token spends the same rotation without the round
  // trip that could not have succeeded — the leaf is still the judge of a token we actually hold,
  // and an unreadable `exp` says nothing, so that one is sent and healed reactively as before.
  let token = assistantSession.tokenOf(hostId);
  if (token && lapsed(token)) token = null;
  if (!token && assistantSession.statusOf(hostId) !== "none") token = await assistantSession.rotate(hostId);
  if (!token) throw authError();

  let res = await send(token);
  if (res.status === 401) {
    const rotated = await assistantSession.rotate(hostId);
    if (!rotated) throw authError();
    res = await send(rotated);
  }
  if (res.status === 204) return null;
  let payload = null;
  try { payload = await res.json(); } catch { payload = null; }
  if (!res.ok) throw leafError(res.status, payload);
  return payload;
}

// POST /transcribe — a recorded voice note, as raw bytes rather than JSON. Healed reactively like
// `json`: transcribing the same audio twice returns the same words and changes nothing, so a 401 may
// rotate and replay. The replay costs the upload again, which is the cheaper of the two failures.
async function bytes(hostId, path, body, opts) {
  const base = baseOf(hostId);
  const send = async (token) => {
    try {
      return await fetch(base + path, {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          Accept: "application/json",
          Authorization: "Bearer " + token,
          ...originHeaders(hostId),
        },
        body,
        signal: opts && opts.signal,
      });
    } catch (e) {
      if (e && e.name === "AbortError") throw e;
      throw netError();
    }
  };

  let token = assistantSession.tokenOf(hostId);
  if (token && lapsed(token)) token = null;
  if (!token && assistantSession.statusOf(hostId) !== "none") token = await assistantSession.rotate(hostId);
  if (!token) throw authError();

  let res = await send(token);
  if (res.status === 401) {
    const rotated = await assistantSession.rotate(hostId);
    if (!rotated) throw authError();
    res = await send(rotated);
  }

  let payload = null;
  try { payload = await res.json(); } catch { payload = null; }
  if (!res.ok) throw leafError(res.status, payload);
  return payload;
}

// POST /turn — the conversation itself. Frames stream until the terminal `done`/`error`; a
// transport drop just ends the pump, because the text already delivered is real and we never
// invent a `done` that did not arrive. An abort rethrows so the caller can render "stopped".
async function turn(hostId, body, opts) {
  const base = baseOf(hostId);
  const { onEvent, signal } = opts || {};
  const token = await freshToken(hostId);
  let res;
  try {
    res = await fetch(base + "/turn", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        Authorization: "Bearer " + token,
        ...originHeaders(hostId),
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (e && e.name === "AbortError") throw e;
    throw netError();
  }
  if (!res.ok) {
    let payload = null; try { payload = await res.json(); } catch { payload = null; }
    throw leafError(res.status, payload);
  }
  await readSseStream(res, (evt) => { if (onEvent) onEvent(evt); }, signal);
}

// GET /events — the caller's own conversation changes, as they happen, so a chat open in two places
// agrees with itself. The stream names itself in its first frame (`hello`), which is recorded against
// this host so every later call carries it and the leaf can stamp the events this surface caused.
//
// The token is taken fresh: a stream is long-lived and there is no 401 to heal once the body is
// flowing, so a lapsed one is rotated before the connection rather than after it fails. Ending is
// normal — a proxy times out, a laptop sleeps — and is the caller's to retry, which is why nothing
// here reconnects: the resync that must follow a gap is the caller's decision, not the transport's.
async function events(hostId, opts) {
  const base = baseOf(hostId);
  const { onEvent, signal } = opts || {};
  const token = await freshToken(hostId);

  let res;
  try {
    res = await fetch(base + "/events", {
      headers: { Accept: "text/event-stream", Authorization: "Bearer " + token },
      signal,
    });
  } catch (e) {
    if (e && e.name === "AbortError") throw e;
    throw netError();
  }
  if (!res.ok) {
    let payload = null; try { payload = await res.json(); } catch { payload = null; }
    throw leafError(res.status, payload);
  }

  try {
    await readSseStream(res, (evt) => {
      if (evt && evt.type === "hello" && evt.streamId) STREAM_IDS.set(hostId, evt.streamId);
      if (onEvent) onEvent(evt);
    }, signal);
  } finally {
    // The id belongs to a connection, not to a host: leaving a dead one behind would stamp later
    // calls with a stream nothing is listening on, and this surface would then skip its own echoes
    // with no stream to have received them.
    STREAM_IDS.delete(hostId);
  }
}

// POST /confirm — executing what a turn staged. Every confirmation kind streams: `progress`
// steps drive the live sub-label, the leaf's 15s heartbeats keep the socket warm through a
// download or a settling wait, and a terminal `result` carries the whole ConfirmResponse.
//
// An idle watchdog resets on every received byte (heartbeats included) and aborts if the stream
// goes quiet — a half-dead socket then surfaces as a failure the user can retry rather than an
// endless spinner. The confirmation token is single-use, so this never replays on 401.
async function confirm(hostId, body, opts) {
  const base = baseOf(hostId);
  const { onProgress, signal } = opts || {};
  const token = await freshToken(hostId);

  const ctrl = new AbortController();
  let idleTimer = null;
  const armIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => ctrl.abort(new DOMException("confirm idle timeout", "TimeoutError")), IDLE_MS);
  };
  const onAbort = () => ctrl.abort(signal.reason);
  if (signal) { if (signal.aborted) ctrl.abort(signal.reason); else signal.addEventListener("abort", onAbort); }

  let res;
  try {
    res = await fetch(base + "/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream", Authorization: "Bearer " + token },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    if (signal) signal.removeEventListener("abort", onAbort);
    if (idleTimer) clearTimeout(idleTimer);
    if (signal && signal.aborted) throw e;
    throw netError();
  }
  if (!res.ok) {
    if (signal) signal.removeEventListener("abort", onAbort);
    if (idleTimer) clearTimeout(idleTimer);
    let payload = null; try { payload = await res.json(); } catch { payload = null; }
    throw leafError(res.status, payload);
  }

  let result = null, streamErr = null;
  try {
    armIdle();
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const chunk = await reader.read();
      armIdle();                              // any byte (data OR heartbeat) → still alive
      if (chunk.done) break;
      buf += decoder.decode(chunk.value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const evt = parseSseEvent(block);     // heartbeats (comment-only) → null, skipped
        if (!evt) continue;
        if (evt.type === "result") result = evt;
        else if (evt.type === "progress" && onProgress) onProgress(evt);
        else if (evt.type === "error") streamErr = evt.message || "The action failed.";
      }
    }
  } catch (e) {
    if (e && e.name === "TimeoutError") {
      throw leafError(0, { error: { message: "The action's stream went quiet — it may still be running on the host. Check the server, or try again." } });
    }
    if (signal && signal.aborted) throw e;
    throw netError();
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    if (signal) signal.removeEventListener("abort", onAbort);
  }

  if (streamErr) throw leafError(0, { error: { message: streamErr } });
  if (!result) throw leafError(0, { error: { message: "The action ended without a result — it may still be running on the host. Check the server, or try again." } });
  return result;
}

// Everything the chat surfaces need from a leaf, scoped to one host.
function host(hostId) {
  return {
    hostId,
    hasRoute: () => assistantSession.hasRoute(hostId),
    // Who the leaf says this bearer is: { userId, displayName, tier, canPerformActions }. Authority
    // is the LEAF's answer, re-derived from Discord per request — never read off the token here.
    me: (opts) => json(hostId, "GET", "/auth/me", null, opts),
    // What this host's speech engine can do: `{ hear, speak }`. Asked before a microphone is offered,
    // because a recording made on a host that cannot listen is one nobody can read. Both are the same
    // optional leaf, and a host without it answers false to both rather than failing.
    speech: (opts) => json(hostId, "GET", "/speech", null, opts),
    // One voice note — 16kHz mono signed 16-bit PCM — answered with the words in it. The transcript
    // comes BACK; it does not become a turn. Recognition is wrong often enough that sending it
    // straight on would ask the assistant things nobody said, so the person reads it first.
    transcribe: (pcm, opts) => bytes(hostId, "/transcribe", pcm, opts),
    conversations: (opts) => json(hostId, "GET", "/conversations", null, opts),
    conversation: (id, opts) => json(hostId, "GET", "/conversations/" + encodeURIComponent(id), null, opts),
    deleteConversation: (id) => json(hostId, "DELETE", "/conversations/" + encodeURIComponent(id)),
    compact: (id) => json(hostId, "POST", "/conversations/" + encodeURIComponent(id) + "/compact"),
    // What the leaf has written down about this caller — a fact that outlives any one conversation.
    // Principal-scoped by the leaf itself: this can only ever list or forget the caller's OWN memory.
    memories: (opts) => json(hostId, "GET", "/memories", null, opts),
    deleteMemory: (key) => json(hostId, "DELETE", "/memories/" + encodeURIComponent(key)),
    // The commands this caller may type, and running one. The leaf performs every command it lists,
    // so the catalog is authoritative rather than advisory: a name that appears here is a name the
    // POST below will honour. Both are gated by the leaf, and the listing is filtered to the caller's
    // tier — a command above it never arrives, so the composer cannot offer what would be refused.
    commands: (opts) => json(hostId, "GET", "/commands", null, opts),
    // Point this browser's event stream at a conversation, so it receives that conversation's turn
    // frames and no others. What it attached to comes back ON the stream, not here.
    attach: (conversationId) => json(hostId, "POST", "/events/attach", { conversationId: conversationId || null }),
    // End a turn — running or still queued — from any surface watching it. Not replayable: a stop is
    // idempotent at the leaf, but a replayed one could reach the NEXT turn on a busy conversation.
    stopTurn: (turnId) => jsonOnce(hostId, "DELETE", "/turns/" + encodeURIComponent(turnId)),
    runCommand: (name, body) => jsonOnce(hostId, "POST", "/commands/" + encodeURIComponent(name), body || {}),
    feedback: (id, turnId, body) =>
      json(hostId, "POST", "/conversations/" + encodeURIComponent(id) + "/turns/" + turnId + "/feedback", body),
    // The admin review surfaces, on the leaf's own /admin group.
    reviewUsers: (opts) => json(hostId, "GET", "/admin/conversations/users", null, opts),
    reviewStats: (query, opts) => json(hostId, "GET", "/admin/conversations/stats" + (query || ""), null, opts),
    reviewConversations: (user, opts) =>
      json(hostId, "GET", "/admin/conversations?user=" + encodeURIComponent(user), null, opts),
    reviewConversation: (handle, opts) =>
      json(hostId, "GET", "/admin/conversations/" + encodeURIComponent(handle), null, opts),
    // Web Push, which the leaf owns end to end — its own key, its own devices, its own staged
    // buttons. It announces exactly one thing: an action it staged and is waiting on you for. Fleet
    // events are the Control Panel's, on its own origin, and duplicating them here would notify one
    // person twice about one thing from two apps.
    pushKey: (opts) => json(hostId, "GET", "/push/key", null, opts),
    pushDevices: (opts) => json(hostId, "GET", "/push/devices", null, opts),
    pushSubscribe: (body) => json(hostId, "POST", "/push/subscribe", body),
    pushUnsubscribe: (body) => json(hostId, "DELETE", "/push/subscribe", body),
    turn: (body, opts) => turn(hostId, body, opts),
    confirm: (body, opts) => confirm(hostId, body, opts),
    // This caller's own conversation changes, pushed. Resolves when the stream ends.
    events: (opts) => events(hostId, opts),
    // The stream this surface is listening on, when one is open — what the leaf stamps its events
    // with, so a caller can recognise which of them are its own.
    streamId: () => STREAM_IDS.get(hostId) || null,
  };
}

const assistant = { host };

export { assistant };
