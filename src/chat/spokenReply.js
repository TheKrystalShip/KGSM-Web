// spokenReply.js — plays an answer the assistant is reading aloud, one sentence at a time.
//
// The leaf emits `audio.delta` frames INTERLEAVED with the text: each sentence is synthesised the
// moment it is written, so the first arrives while the model is still writing the third. This queues
// them and plays them back to back, which is the whole job — a sentence that waited for the previous
// one to finish is a sentence that arrives on time, and one played the instant it lands talks over
// the answer.
//
// AUTOPLAY: a browser refuses audio until the page has been interacted with, and an AudioContext
// created before that starts `suspended`. Sending a message IS an interaction, so the context is
// created and resumed on the send that asked to be spoken — not at import, and not on the frame,
// which arrives seconds later with no gesture behind it.
//
// It decodes rather than streams. Each frame is a self-contained file, so there is no decoder state
// between sentences and a dropped one costs exactly itself.

// The one context per surface. Created lazily because constructing one before a gesture is what
// leaves it suspended, and a suspended context that nothing resumes plays silence forever.
let ctx = null;

function context() {
  if (ctx) return ctx;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  return ctx;
}

// One turn's spoken answer: the sentences still to play, and what is playing now.
function createSpokenReply() {
  let queue = [];
  let playing = false;
  let source = null;
  let stopped = false;

  const play = async () => {
    if (playing || stopped) return;
    const next = queue.shift();
    if (!next) return;

    playing = true;
    try {
      const audio = context();
      if (!audio) return;

      // decodeAudioData detaches the buffer it is given, so each frame is decoded from its own copy —
      // a retry or a second listener would otherwise get an empty one.
      const buffer = await audio.decodeAudioData(next.slice(0));
      if (stopped) return;

      await new Promise((done) => {
        source = audio.createBufferSource();
        source.buffer = buffer;
        source.connect(audio.destination);
        source.onended = () => { source = null; done(); };
        source.start();
      });
    } catch {
      // A sentence that will not decode is a sentence not heard. The words are already on the screen,
      // and the rest of the answer still plays — which is why this drops rather than stops.
    } finally {
      playing = false;
      if (!stopped) play();
    }
  };

  return {
    // Takes one `audio.delta` frame. Sentences arrive in order and are played in the order they arrive.
    push(frame) {
      if (stopped || !frame || !frame.data) return;
      try {
        const binary = atob(frame.data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        queue.push(bytes.buffer);
      } catch {
        return;
      }
      play();
    },

    // Everything still queued is abandoned and whatever is playing stops. What a new turn, a stop
    // button or leaving the conversation does: an answer nobody is listening to any more should not
    // go on being read out.
    stop() {
      stopped = true;
      queue = [];
      if (source) {
        try { source.stop(); } catch { /* already ended */ }
        source = null;
      }
    },
  };
}

// Called on the gesture that asks for audio — the send — so the context exists and is running before
// the first frame lands. Returns whether audio is usable at all, which is what the toggle reports.
async function armAudio() {
  const audio = context();
  if (!audio) return false;
  if (audio.state === "suspended") {
    try { await audio.resume(); } catch { return false; }
  }
  return audio.state === "running";
}

export { createSpokenReply, armAudio };
