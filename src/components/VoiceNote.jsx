import React from "react";
import { Icon } from "./Icon.jsx";
import { toPcm16k, MAX_SECONDS } from "../lib/voicePcm.js";

// VoiceNote — voice-message capture + playback for the assistant composer.
//
// The Krystal assistant understands speech, so the composer lets you hold a
// quick voice note instead of typing. Three pieces live here:
//
//   useVoiceRecorder()  — getUserMedia → MediaRecorder for the audio blob, an
//                         AnalyserNode sampled on a timer for a *real*
//                         waveform, and whatever can turn the recording into
//                         words. Degrades gracefully when any piece is missing
//                         (no mic permission, no recogniser at all).
//   VoiceComposerBar    — the in-composer recording UI: pulsing dot, timer,
//                         live waveform, rolling transcript, cancel / send.
//   VoiceNoteBubble     — playback in the thread: play/scrub waveform + the
//                         transcript the assistant replied to.
//
// WHO TRANSCRIBES: the host, whenever it can. A `transcribe` function passed
// to the hook means this host runs kgsm-speech, and the recording is sent there
// — the same whisper, primed with the same server names, that hears a request
// spoken into a Discord channel. That is what makes "restart factorio" land the
// same way in a browser as it does in a voice channel, and it is why the
// browser's own SpeechRecognition is used ONLY as the fallback for a host with
// no speech leaf: two recognisers is two spellings of every server name, and
// Chrome's sends the audio to Google, which is a surprising thing for a
// self-hosted panel to do with somebody's voice.
//
// The host's transcript comes BACK to the composer rather than going straight
// to the assistant. Recognition is wrong often enough that sending it onward
// unseen would ask the assistant things nobody said.
//
// Audio blobs are session-only (object URLs in VOICE_AUDIO, keyed by id) — we
// deliberately don't base64 them into localStorage, which would blow the quota.
// On reload a note still renders from its persisted peaks + transcript; only
// the play button goes quiet, with a tooltip saying so.

const VOICE_AUDIO = new Map(); // voiceId -> { url, mime }

// Downsample a stream of RMS levels to a fixed bar count for the saved peaks.
function resamplePeaks(levels, count) {
  if (!levels.length) return new Array(count).fill(0.06);
  const out = [];
  for (let i = 0; i < count; i++) {
    const a = Math.floor((i / count) * levels.length);
    const b = Math.max(a + 1, Math.floor(((i + 1) / count) * levels.length));
    let m = 0;
    for (let j = a; j < b && j < levels.length; j++) m = Math.max(m, levels[j]);
    out.push(Math.max(0.06, Math.min(1, m)));
  }
  return out;
}

function fmtClock(sec) {
  const s = Math.max(0, Math.floor(sec));
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}

// ---------- recorder hook ----------
// `transcribe` is the host's recogniser: `(ArrayBuffer of 16kHz mono s16) → text`. Given one, it is
// the only transcriber used. Given none, the browser's own is tried and the note may still be sent
// with no words at all.
function useVoiceRecorder({ transcribe } = {}) {
  const [phase, setPhase]       = React.useState("idle"); // idle | requesting | recording | transcribing | error
  const [seconds, setSeconds]   = React.useState(0);
  const [levels, setLevels]     = React.useState([]);     // rolling RMS history
  const [transcript, setTranscript] = React.useState(""); // finalized words
  const [interim, setInterim]   = React.useState("");     // in-flight words
  const [error, setError]       = React.useState("");
  const [supported] = React.useState(() =>
    !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder));

  // The recording that has stopped but not yet been transcribed. Held so a failed transcription can be
  // retried from the same button — the audio is still good, and asking somebody to say it again
  // because the network blinked is throwing away the part that was hard to produce.
  const heldRef = React.useRef(null);
  // Read inside callbacks that must not be rebuilt when the prop identity changes.
  const transcribeRef = React.useRef(transcribe);
  React.useEffect(() => { transcribeRef.current = transcribe; }, [transcribe]);

  const streamRef   = React.useRef(null);
  const recRef      = React.useRef(null);
  const chunksRef   = React.useRef([]);
  const audioCtxRef = React.useRef(null);
  const analyserRef = React.useRef(null);
  const rafRef      = React.useRef(null);
  const tickRef     = React.useRef(null);
  const startedRef  = React.useRef(0);
  const levelsRef   = React.useRef([]);   // full history for final peaks
  const recogRef    = React.useRef(null);
  const finalRef    = React.useRef("");

  const cleanup = React.useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (tickRef.current) clearInterval(tickRef.current);
    rafRef.current = null; tickRef.current = null;
    try { recogRef.current && recogRef.current.stop(); } catch {}
    recogRef.current = null;
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    if (audioCtxRef.current) { try { audioCtxRef.current.close(); } catch {} audioCtxRef.current = null; }
    analyserRef.current = null;
  }, []);

  React.useEffect(() => cleanup, [cleanup]); // unmount safety

  const start = React.useCallback(async () => {
    if (!supported) { setError("Recording isn't supported in this browser."); setPhase("error"); return; }
    setError(""); setTranscript(""); setInterim(""); setSeconds(0);
    setLevels([]); levelsRef.current = []; chunksRef.current = []; finalRef.current = "";
    setPhase("requesting");
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      setError(e && e.name === "NotAllowedError"
        ? "Microphone access was blocked. Allow it to record a voice note."
        : "Couldn't access a microphone.");
      setPhase("error");
      return;
    }
    streamRef.current = stream;

    // MediaRecorder → audio blob
    let mime = "";
    const tryTypes = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
    for (const t of tryTypes) { if (window.MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) { mime = t; break; } }
    const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    recRef.current = rec;
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunksRef.current.push(e.data); };
    rec.start();

    // AnalyserNode → live RMS levels
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = new AC();
      audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      src.connect(analyser);
      analyserRef.current = analyser;
      const buf = new Uint8Array(analyser.fftSize);
      let lastPush = 0;
      const loop = (ts) => {
        if (!analyserRef.current) return;
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
        const rms = Math.sqrt(sum / buf.length);
        const level = Math.max(0.06, Math.min(1, rms * 2.6));
        if (ts - lastPush > 55) {
          lastPush = ts;
          levelsRef.current.push(level);
          setLevels(prev => { const next = [...prev, level]; return next.length > 56 ? next.slice(-56) : next; });
        }
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    } catch { /* waveform is non-essential */ }

    // The browser's own recogniser, and ONLY when the host has none. On a host running kgsm-speech
    // this stays off: the recording is going to that engine, and a second transcriber running beside
    // it spells this host's server names its own way and ships the audio to a third party to do it.
    const SR = transcribeRef.current
      ? null
      : (window.SpeechRecognition || window.webkitSpeechRecognition);
    if (SR) {
      try {
        const recog = new SR();
        recog.continuous = true;
        recog.interimResults = true;
        recog.lang = "en-US";
        recog.onresult = (ev) => {
          let interimStr = "";
          for (let i = ev.resultIndex; i < ev.results.length; i++) {
            const r = ev.results[i];
            if (r.isFinal) finalRef.current += (finalRef.current ? " " : "") + r[0].transcript.trim();
            else interimStr += r[0].transcript;
          }
          setTranscript(finalRef.current);
          setInterim(interimStr.trim());
        };
        recog.onerror = () => {};
        recog.onend = () => { /* may auto-stop; we restart only while recording */
          if (recRef.current && recRef.current.state === "recording") {
            try { recog.start(); } catch {}
          }
        };
        recog.start();
        recogRef.current = recog;
      } catch { /* transcription is best-effort */ }
    }

    startedRef.current = Date.now();
    setPhase("recording");
    tickRef.current = setInterval(() => {
      const elapsed = (Date.now() - startedRef.current) / 1000;
      setSeconds(elapsed);
      // Stopped at the ceiling rather than refused after the fact. The leaf will not read more than
      // this, and a note that runs past it is one somebody spoke in full and is then told to redo.
      if (elapsed >= MAX_SECONDS && recRef.current && recRef.current.state === "recording") {
        try { recRef.current.stop(); } catch { /* already stopping */ }
      }
    }, 200);
  }, [supported]);

  // Turn a held recording into words, and clear the composer once it has them.
  //
  // A failure leaves the recording HELD and the bar showing why: the audio is still good, and the
  // send button becomes a retry. Losing somebody's sentence because a request failed is the one
  // outcome worth going to trouble to avoid.
  const settle = React.useCallback(async (held, resolve) => {
    const send = transcribeRef.current;
    if (!send) {
      heldRef.current = null;
      setPhase("idle"); setLevels([]); setInterim(""); setTranscript("");
      resolve(held);
      return;
    }

    setPhase("transcribing");
    setError("");
    try {
      const pcm = await toPcm16k(held.blob);
      const text = await send(pcm);
      heldRef.current = null;
      setPhase("idle"); setLevels([]); setInterim(""); setTranscript("");
      resolve({ ...held, transcript: (text || "").trim() });
    } catch (e) {
      heldRef.current = held;
      setError((e && (e.userMessage || e.message)) || "That recording could not be transcribed.");
      setPhase("error");
      resolve(null);
    }
  }, []);

  // Finalize → resolves to a voice payload, or null if cancelled, empty, or not transcribed.
  // Called again after a failure, it retries the recording it is still holding.
  const finish = React.useCallback(() => new Promise((resolve) => {
    if (heldRef.current) { settle(heldRef.current, resolve); return; }

    const rec = recRef.current;
    const dur = (Date.now() - startedRef.current) / 1000;
    const peaks = resamplePeaks(levelsRef.current, 40);
    const txt = (finalRef.current || "").trim();
    if (!rec || rec.state === "inactive") { cleanup(); setPhase("idle"); resolve(null); return; }
    rec.onstop = () => {
      const mime = rec.mimeType || "audio/webm";
      const blob = new Blob(chunksRef.current, { type: mime });
      const id = "v" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      let url = "";
      try { url = URL.createObjectURL(blob); VOICE_AUDIO.set(id, { url, mime }); } catch {}
      // The stream and the analyser go now; the blob is already captured and the transcription that
      // may follow needs neither. Holding a microphone open across a network call is what makes a
      // browser keep showing the recording indicator after somebody has stopped talking.
      cleanup();
      settle({ id, duration: Math.max(0.4, dur), peaks, transcript: txt, blob }, resolve);
    };
    try { rec.stop(); } catch { cleanup(); setPhase("idle"); resolve(null); }
  }), [cleanup, settle]);

  const cancel = React.useCallback(() => {
    const rec = recRef.current;
    if (rec && rec.state !== "inactive") { rec.onstop = null; try { rec.stop(); } catch {} }
    heldRef.current = null;
    cleanup();
    setPhase("idle"); setLevels([]); setInterim(""); setTranscript(""); setSeconds(0); setError("");
  }, [cleanup]);

  return {
    phase, seconds, levels, transcript, interim, error, supported, start, finish, cancel,
    // A recording that failed to transcribe is still here, so the send button says "Try again"
    // rather than pretending there is nothing to send.
    held: !!heldRef.current,
  };
}

// ---------- composer recording bar ----------
function VoiceComposerBar({ rec, onSend, onCancel }) {
  const { phase, seconds, levels, transcript, interim, error, held } = rec;
  const live = (transcript + " " + interim).trim();

  if (phase === "error") {
    return (
      <div className="voice-bar voice-bar--error">
        <Icon name="mic-off" size={16} />
        <span className="voice-bar__msg">{error || "Couldn't start recording."}</span>
        {/* A recording that failed to transcribe is still here, so the way out is to try again —
            not to say the whole thing over because a request failed. */}
        {held && (
          <button className="voice-bar__retry" onClick={onSend} title="Try transcribing again">
            <Icon name="rotate-ccw" size={14} /> Try again
          </button>
        )}
        <button className="voice-bar__x" onClick={onCancel}
          title={held ? "Discard this recording" : "Dismiss"}><Icon name="x" size={15} /></button>
      </div>
    );
  }

  // The recording has stopped and the host is reading it. Nothing here is cancellable by design: the
  // audio is captured and the pass is short, so an escape hatch would only ever discard a transcript
  // that was about to arrive.
  if (phase === "transcribing") {
    return (
      <div className="voice-bar voice-bar--working">
        <Icon name="audio-lines" size={16} />
        <span className="voice-bar__msg">Transcribing your note…</span>
      </div>
    );
  }

  const requesting = phase === "requesting";
  // Pad the waveform so it fills from the right as you speak.
  const bars = levels.length < 56 ? [...new Array(56 - levels.length).fill(0.06), ...levels] : levels;

  return (
    <div className="voice-bar">
      <button className="voice-bar__cancel" onClick={onCancel} title="Discard voice note" aria-label="Discard">
        <Icon name="trash-2" size={16} />
      </button>

      <div className="voice-bar__meter">
        <span className="voice-bar__dot"></span>
        <span className="voice-bar__time">{requesting ? "0:00" : fmtClock(seconds)}</span>
        <div className="voice-bar__wave" aria-hidden="true">
          {requesting
            ? <span className="voice-bar__hint">Listening…</span>
            : bars.map((v, i) => (
                <span key={i} className="voice-bar__bar" style={{ height: (10 + v * 26).toFixed(1) + "px" }}></span>
              ))}
        </div>
        {live
          ? <span className="voice-bar__transcript" title={live}>{live}</span>
          : !requesting && <span className="voice-bar__transcript voice-bar__transcript--idle">Speak now — I'm listening</span>}
      </div>

      <button className="voice-bar__send" onClick={onSend} disabled={requesting} title="Send voice note" aria-label="Send voice note">
        <Icon name="arrow-up" size={16} strokeWidth={2.4} />
      </button>
    </div>
  );
}

// ---------- playback bubble (in-thread) ----------
function VoiceNoteBubble({ voice }) {
  const audioRef = React.useRef(null);
  const [playing, setPlaying] = React.useState(false);
  const [pos, setPos] = React.useState(0); // 0..1
  const entry = VOICE_AUDIO.get(voice.id);
  const available = !!(entry && entry.url);

  React.useEffect(() => {
    if (!available) return;
    const a = new Audio(entry.url);
    audioRef.current = a;
    const onTime = () => { if (a.duration) setPos(a.currentTime / a.duration); };
    const onEnd  = () => { setPlaying(false); setPos(0); };
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("ended", onEnd);
    return () => { a.pause(); a.removeEventListener("timeupdate", onTime); a.removeEventListener("ended", onEnd); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- entry.url is already the dep (as entry && entry.url); rebuild the audio element only when the clip changes
  }, [available, entry && entry.url]);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) { a.pause(); setPlaying(false); }
    else { a.play().then(() => setPlaying(true)).catch(() => {}); }
  };

  const peaks = voice.peaks && voice.peaks.length ? voice.peaks : new Array(40).fill(0.1);
  const filled = Math.round(pos * peaks.length);

  return (
    <div className={"voice-note" + (available ? "" : " voice-note--expired")}>
      <button className="voice-note__play" onClick={toggle} disabled={!available}
        title={available ? (playing ? "Pause" : "Play voice note") : "Audio from a previous session isn't available"}
        aria-label={playing ? "Pause" : "Play"}>
        <Icon name={playing ? "pause" : "play"} size={14} strokeWidth={2.2} />
      </button>
      <div className="voice-note__wave" aria-hidden="true">
        {peaks.map((v, i) => (
          <span key={i}
            className={"voice-note__bar" + (i < filled ? " voice-note__bar--on" : "")}
            style={{ height: (4 + v * 20).toFixed(1) + "px" }}></span>
        ))}
      </div>
      <span className="voice-note__dur">{fmtClock(voice.duration)}</span>
    </div>
  );
}

export { VoiceComposerBar, VoiceNoteBubble, useVoiceRecorder };
