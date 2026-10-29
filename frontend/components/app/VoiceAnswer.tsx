"use client";

import { useEffect, useRef, useState } from "react";

import type { AppCopy } from "@/lib/i18n-app";

/**
 * The voice half of the check-in: speak the question, record the answer.
 *
 * WHAT THIS IS SIMULATING. On a real deployment the question is spoken down a
 * phone line by a telephony provider and the senior simply talks back — no
 * app, no screen, no microphone permission. This page stands in for that so
 * the loop can be demonstrated, and it uses the browser's own speech synthesis
 * and microphone to do it. The keypad underneath is not a fallback for a
 * broken feature: it is the primary interface on a basic handset, and it keeps
 * working with no microphone, no network and no model.
 *
 * THE SILENCE GUARD IS THE IMPORTANT PART. Whisper invents plausible speech
 * from noise — probed with a pure tone it returned confident Devanagari. If
 * that reached the check-in, a senior who said nothing would have an answer
 * recorded for them, when the whole design treats silence as evidence. So the
 * recorded audio is measured first and never sent unless it actually contains
 * something louder than the room.
 */

interface Props {
  t: AppCopy["checkin"];
  /**
   * The lines to read out, in order, each with its own BCP-47 tag. A list
   * rather than one string because a bilingual prompt has to switch voice
   * mid-prompt: a Hindi sentence read by an English voice is close to
   * unintelligible, which defeats the point of reading it at all.
   */
  speech: { text: string; lang: string }[];
  /**
   * The language to transcribe the ANSWER in — the site language, not the
   * prompt's. The prompt always opens in Hindi because that is the call, but
   * someone using the site in English will answer in English, and hinting
   * Whisper with the wrong language is how "two" came back as "तू".
   */
  listenLang: string;
  /** Raw transcript plus whatever it was understood to mean. */
  onAnswer: (transcript: string) => void;
  disabled?: boolean;
}

type Status = "idle" | "speaking" | "recording" | "working" | "unclear" | "silent" | "blocked";

export function VoiceAnswer({ t, speech, listenLang, onAnswer, disabled }: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [heard, setHeard] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const peak = useRef(0);
  const audioCtx = useRef<AudioContext | null>(null);

  // Detected AFTER mount, not during render. Checking navigator while
  // rendering gives false on the server and true in the browser, so the two
  // renders disagree and React reports a hydration mismatch. Starting false
  // means the first client render matches the server's, and the microphone
  // button appears once hydration has settled.
  const [canRecord, setCanRecord] = useState(false);

  useEffect(() => {
    setCanRecord(
      !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined",
    );
  }, []);

  // Stop speaking if the component goes away mid-sentence.
  useEffect(() => () => {
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* not available */
    }
    stream.current?.getTracks().forEach((tr) => tr.stop());
    audioCtx.current?.close().catch(() => {});
  }, []);

  function speak() {
    try {
      const synth = window.speechSynthesis;
      if (!synth || !speech.length) return;
      synth.cancel();

      const voices = synth.getVoices();
      speech.forEach((line, i) => {
        const u = new SpeechSynthesisUtterance(line.text);
        u.lang = line.lang;
        // Pick a voice that actually speaks this language where one exists.
        // Without this some systems read Devanagari with an English voice,
        // which sounds like nonsense to the person it is meant for.
        const match =
          voices.find((v) => v.lang === line.lang) ||
          voices.find((v) => v.lang?.startsWith(line.lang.split("-")[0]));
        if (match) u.voice = match;
        // Slower than default. The listener may be hard of hearing, and this
        // is the single setting that most affects whether the prompt lands.
        u.rate = 0.82;
        if (i === 0) u.onstart = () => setStatus("speaking");
        if (i === speech.length - 1) {
          u.onend = () => setStatus((s) => (s === "speaking" ? "idle" : s));
        }
        u.onerror = () => setStatus("idle");
        synth.speak(u);
      });
    } catch {
      setStatus("idle");
    }
  }

  // getVoices() is empty until the list loads in some browsers, so nudge a
  // re-read once it arrives. Without this the first prompt of a session can
  // fall back to the default voice.
  useEffect(() => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const onVoices = () => synth.getVoices();
    synth.addEventListener?.("voiceschanged", onVoices);
    return () => synth.removeEventListener?.("voiceschanged", onVoices);
  }, []);

  async function startRecording() {
    if (disabled || !canRecord) return;
    setHeard(null);
    setNote(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = s;
      chunks.current = [];
      peak.current = 0;

      // Measure loudness while recording so silence can be recognised as
      // silence rather than handed to a model that will invent words.
      try {
        const ctx = new AudioContext();
        audioCtx.current = ctx;
        const src = ctx.createMediaStreamSource(s);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        src.connect(analyser);
        const buf = new Float32Array(analyser.fftSize);
        const sample = () => {
          if (!audioCtx.current) return;
          analyser.getFloatTimeDomainData(buf);
          let sum = 0;
          for (const v of buf) sum += v * v;
          peak.current = Math.max(peak.current, Math.sqrt(sum / buf.length));
          if (recorder.current?.state === "recording") requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      } catch {
        // No analyser: fall back to the server's hallucination filter alone.
        peak.current = 1;
      }

      const rec = new MediaRecorder(s);
      recorder.current = rec;
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.current.push(e.data);
      };
      rec.onstop = () => void send();
      rec.start();
      setStatus("recording");
    } catch {
      setStatus("blocked");
      setNote(t.micDenied);
    }
  }

  function stopRecording() {
    if (recorder.current?.state === "recording") recorder.current.stop();
    stream.current?.getTracks().forEach((tr) => tr.stop());
  }

  async function send() {
    audioCtx.current?.close().catch(() => {});
    audioCtx.current = null;

    const blob = new Blob(chunks.current, { type: "audio/webm" });
    // ~0.01 RMS is a quiet room; speech sits well above it. Below that, do not
    // send the clip at all.
    if (blob.size < 1200 || peak.current < 0.012) {
      setStatus("silent");
      setNote(t.silence);
      return;
    }

    setStatus("working");
    try {
      const body = new FormData();
      body.append("audio", blob, "answer.webm");
      body.append("language", listenLang === "hi" ? "hi" : "en");
      const res = await fetch("/api/transcribe", { method: "POST", body });
      const data = await res.json();

      if (!res.ok || data.speech === false || !data.text) {
        setStatus("silent");
        setNote(t.silence);
        return;
      }

      setHeard(data.text);
      setStatus("idle");
      onAnswer(data.text);
    } catch {
      setStatus("unclear");
      setNote(t.unclear);
    }
  }

  const busy = status === "working";

  return (
    <div className="va">
      <div className="va__row">
        <button
          type="button"
          className="va__btn va__btn--hear"
          onClick={speak}
          disabled={disabled || status === "recording"}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M11 5 6 9H3v6h3l5 4V5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
            <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          {status === "speaking" ? t.speaking : t.hear}
        </button>

        {canRecord ? (
          <button
            type="button"
            className={status === "recording" ? "va__btn va__btn--rec va__btn--on" : "va__btn va__btn--rec"}
            onMouseDown={startRecording}
            onMouseUp={stopRecording}
            onMouseLeave={() => status === "recording" && stopRecording()}
            onTouchStart={(e) => { e.preventDefault(); startRecording(); }}
            onTouchEnd={(e) => { e.preventDefault(); stopRecording(); }}
            disabled={disabled || busy}
            aria-pressed={status === "recording"}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.8" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            {status === "recording" ? t.listening : busy ? t.transcribing : t.speak}
          </button>
        ) : (
          <p className="va__note">{t.micUnsupported}</p>
        )}
      </div>

      <div className="va__out" aria-live="polite">
        {heard && (
          <p className="va__heard">
            <span>{t.heard}:</span> <q>{heard}</q>
          </p>
        )}
        {note && <p className="va__note va__note--warn">{note}</p>}
      </div>

      <p className="va__note">{t.voiceNote}</p>

      <style>{`
        .va { margin-bottom: var(--s-6); }
        .va__row { display: flex; flex-wrap: wrap; gap: var(--s-3); }
        .va__btn {
          display: inline-flex; align-items: center; gap: var(--s-3);
          flex: 1 1 14rem; min-height: 72px;
          padding: var(--s-4) var(--s-5);
          font: inherit; font-size: 1.125rem; font-weight: 600;
          border-radius: var(--radius); cursor: pointer;
          border: 2px solid var(--forest);
          background: var(--white); color: var(--forest);
          transition: background var(--dur) var(--ease), color var(--dur) var(--ease);
        }
        .va__btn--rec { background: var(--forest); color: var(--cream); }
        .va__btn--on { background: var(--risk-high, #b3261e); border-color: var(--risk-high, #b3261e); color: #fff; }
        .va__btn:disabled { opacity: 0.5; cursor: default; }
        .va__btn:focus-visible { outline: 3px solid var(--forest); outline-offset: 3px; }
        .va__out:empty { display: none; }
        .va__heard {
          margin-top: var(--s-4); padding: var(--s-3) var(--s-4);
          background: var(--cream-2); border-radius: var(--radius);
          font-size: 1.0625rem; line-height: 1.6;
        }
        .va__heard span { font-weight: 600; color: var(--ink-3); }
        .va__note {
          margin-top: var(--s-3); font-size: 0.9375rem;
          line-height: 1.6; color: var(--ink-3);
        }
        .va__note--warn { color: var(--risk-med, #8d620f); font-weight: 600; }
      `}</style>
    </div>
  );
}
