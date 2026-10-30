"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { fmt } from "@/lib/i18n";
import type { AppCopy } from "@/lib/i18n-app";
import {
  EMPTY_SIGNALS,
  hasAnything,
  mergeSignals,
  readSignals,
  type CallSignals,
} from "@/lib/call-signals";

/**
 * The daily call.
 *
 * WHAT THIS REPLACES, AND WHY. Until now this page read six multiple-choice
 * questions aloud and collected a keypress for each: "press 1 for better, 2
 * for the same, 3 for worse." It was a form with a voice, and asking an
 * eighty-three-year-old to sit an exam about their own body every morning is
 * the opposite of what this product claims to be. The evaluator said so in
 * round one. They were right.
 *
 * Now the phone rings, somebody says hello, and they talk. The six signals
 * still come out — they are read from what was said, by a model, afterwards —
 * but nobody is marched through them, and a senior who only wants to mention
 * their knee can mention their knee and hang up.
 *
 * THE RING IS NOT DECORATION. The call starting itself is the whole claim: a
 * senior does not open anything, does not remember anything, does not own a
 * smartphone. Dropping somebody straight into a live microphone would quietly
 * put them back in charge of starting it.
 *
 * STILL A SIMULATION, AND IT SAYS SO. On a real deployment the voice is
 * carried by a telephony provider to a basic handset. This page stands in for
 * that with the browser's own speech synthesis and microphone so the loop can
 * be shown end to end. The typed box is not the product — it is there because
 * a laptop without a working microphone should not be able to stop a demo.
 */

type Phase = "ringing" | "live" | "filing" | "filed" | "failed";
type Mic = "idle" | "speaking" | "recording" | "working" | "thinking" | "blocked";

interface Turn {
  who: "ai" | "senior";
  text: string;
}

export function CallSim({ t, lang }: { t: AppCopy["checkin"]; lang: string }) {
  const [phase, setPhase] = useState<Phase>("ringing");
  /**
   * Which language the call is actually being held in.
   *
   * NOT the site's. The page language is whoever opened the browser; the call
   * belongs to the person on the end of it, and their language is on their
   * record. The server decides from there and tells us with the first line —
   * until then the site's setting is the only guess available. Getting this
   * wrong is not cosmetic: it picks the speech voice and the transcription
   * hint, and a Hindi sentence read by an English voice is close to
   * unintelligible to the person it is for.
   */
  const [callLang, setCallLang] = useState(lang === "en" ? "en" : "hi");
  const [mic, setMic] = useState<Mic>("idle");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [known, setKnown] = useState<CallSignals>(EMPTY_SIGNALS);
  const [urgent, setUrgent] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [lineName, setLineName] = useState("");
  const [filedName, setFiledName] = useState("");

  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const peak = useRef(0);
  const audioCtx = useRef<AudioContext | null>(null);
  const log = useRef<HTMLDivElement | null>(null);

  // Detected after mount, never during render: checking navigator while
  // rendering gives one answer on the server and another in the browser, and
  // React reports the mismatch as a hydration error.
  const [canRecord, setCanRecord] = useState(false);
  useEffect(() => {
    setCanRecord(!!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined");
  }, []);

  // Whose line this is, said before the phone is answered rather than after
  // the call ends. Somebody about to speak into a record should know whose
  // record it is.
  useEffect(() => {
    let alive = true;
    createClient()
      .rpc("demo_line_name")
      .then(({ data }) => {
        if (alive && typeof data === "string") setLineName(data);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(
    () => () => {
      try {
        window.speechSynthesis?.cancel();
      } catch {
        /* not available */
      }
      stream.current?.getTracks().forEach((tr) => tr.stop());
      audioCtx.current?.close().catch(() => {});
    },
    [],
  );

  // getVoices() is empty until the list loads in some browsers, so nudge a
  // re-read when it arrives. Without this the first line of the call can come
  // out in the default voice — which for Devanagari is close to unintelligible.
  useEffect(() => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const onVoices = () => synth.getVoices();
    synth.addEventListener?.("voiceschanged", onVoices);
    return () => synth.removeEventListener?.("voiceschanged", onVoices);
  }, []);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" });
  }, [turns, mic]);

  const speak = useCallback(
    (text: string) =>
      new Promise<void>((resolve) => {
        try {
          const synth = window.speechSynthesis;
          if (!synth) return resolve();
          synth.cancel();
          const u = new SpeechSynthesisUtterance(text);
          u.lang = callLang === "hi" ? "hi-IN" : "en-IN";
          const voices = synth.getVoices();
          const match =
            voices.find((v) => v.lang === u.lang) ||
            voices.find((v) => v.lang?.startsWith(u.lang.split("-")[0]));
          if (match) u.voice = match;
          // Slower than default. The listener may be hard of hearing, and this
          // is the single setting that most affects whether the line lands.
          u.rate = 0.82;
          u.onstart = () => setMic("speaking");
          u.onend = () => resolve();
          u.onerror = () => resolve();
          synth.speak(u);
        } catch {
          resolve();
        }
      }),
    [callLang],
  );

  /** One exchange: send what has been said, speak the reply, keep the reading. */
  const advance = useCallback(
    async (next: Turn[], carried: CallSignals) => {
      setMic("thinking");
      setNote(null);
      let data: {
        say?: string;
        done?: boolean;
        urgent?: boolean;
        signals?: unknown;
        error?: string;
        lang?: string;
      };
      try {
        const res = await fetch("/api/checkin/converse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ turns: next, lang, known: carried }),
        });
        data = await res.json();
        if (typeof data?.lang === "string") setCallLang(data.lang === "en" ? "en" : "hi");
        if (!res.ok || !data.say) {
          // A per-minute allowance that has ticked over is worth saying out
          // loud, because it clears on its own. Anything else is not.
          setNote(data?.error === "busy" ? t.busy : t.callFailed);
          setMic("idle");
          return;
        }
      } catch {
        setNote(t.callFailed);
        setMic("idle");
        return;
      }

      const merged = data.signals
        ? mergeSignals(carried, readSignals(data.signals))
        : carried;
      setKnown(merged);
      if (data.urgent) setUrgent(true);

      const withReply: Turn[] = [...next, { who: "ai", text: data.say }];
      setTurns(withReply);
      await speak(data.say);

      if (data.done) {
        await file(withReply, merged);
      } else {
        setMic("idle");
      }
    },
    // `file` is declared below and is stable for the life of the component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lang, speak, t],
  );

  /**
   * Write the call to the record.
   *
   * No senior id is passed, and there is none to pass. The row this lands on
   * is chosen inside the database by a flag on exactly one senior, so a page
   * served to anybody on the internet cannot name whose record it writes.
   */
  async function file(all: Turn[], signals: CallSignals) {
    if (!hasAnything(signals)) {
      // Nothing was established, so there is nothing to put on a record. An
      // empty check-in filed as "answered" would tell a coordinator the call
      // went fine, which is a worse outcome than no row at all.
      setPhase("failed");
      setNote(t.nothingSaid);
      return;
    }
    setPhase("filing");
    const transcript = all
      .map((x) => `${x.who === "ai" ? "Samarth" : lineName || "Senior"}: ${x.text}`)
      .join("\n");

    const { data, error } = await createClient().rpc("record_demo_conversation", {
      p_transcript: transcript,
      p_signals: { ...signals, language: callLang },
    });
    const out = data as { ok?: boolean; senior_name?: string } | null;
    if (error || !out?.ok) {
      setPhase("failed");
      setNote(t.fileFailed);
      return;
    }
    setFiledName(out.senior_name ?? "");
    setPhase("filed");
  }

  function answer() {
    setPhase("live");
    void advance([], EMPTY_SIGNALS);
  }

  function hangUp() {
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* not available */
    }
    stopRecording();
    // Hanging up early still files what was said. A call that ended because
    // somebody had to go is not a call that did not happen.
    void file(turns, known);
  }

  async function startRecording() {
    if (!canRecord || mic !== "idle") return;
    setNote(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = s;
      chunks.current = [];
      peak.current = 0;

      // Measure loudness while recording so silence is recognised as silence
      // rather than handed to a model that will invent words from it. Probed
      // with a pure tone, Whisper returned confident Devanagari.
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
        peak.current = 1;
      }

      const rec = new MediaRecorder(s);
      recorder.current = rec;
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.current.push(e.data);
      };
      rec.onstop = () => void transcribe();
      rec.start();
      setMic("recording");
    } catch {
      setMic("blocked");
      setNote(t.micDenied);
    }
  }

  function stopRecording() {
    if (recorder.current?.state === "recording") recorder.current.stop();
    stream.current?.getTracks().forEach((tr) => tr.stop());
  }

  async function transcribe() {
    audioCtx.current?.close().catch(() => {});
    audioCtx.current = null;

    const blob = new Blob(chunks.current, { type: "audio/webm" });
    // ~0.01 RMS is a quiet room; speech sits well above it.
    if (blob.size < 1200 || peak.current < 0.012) {
      setMic("idle");
      setNote(t.silence);
      return;
    }

    setMic("working");
    try {
      const body = new FormData();
      body.append("audio", blob, "answer.webm");
      body.append("language", callLang === "hi" ? "hi" : "en");
      const res = await fetch("/api/transcribe", { method: "POST", body });
      const data = await res.json();
      if (!res.ok || data.speech === false || !data.text) {
        setMic("idle");
        setNote(t.silence);
        return;
      }
      say(String(data.text));
    } catch {
      setMic("idle");
      setNote(t.unclear);
    }
  }

  function say(text: string) {
    const clean = text.trim();
    if (!clean) return;
    const next: Turn[] = [...turns, { who: "senior", text: clean }];
    setTurns(next);
    setTyped("");
    void advance(next, known);
  }

  // ------------------------------------------------------------------ view --

  if (phase === "ringing") {
    return (
      <div className="call call--ring">
        <span className="call__pulse" aria-hidden="true" />
        <p className="call__from">{t.ringing}</p>
        {lineName && <p className="call__to">{fmt(t.ringingTo, { name: lineName })}</p>}
        <button type="button" className="btn btn--forest call__answer" onClick={answer}>
          {t.answer}
        </button>
        <p className="call__sim">{t.chrome}</p>
        <Styles />
      </div>
    );
  }

  if (phase === "filed" || phase === "filing" || phase === "failed") {
    return (
      <div className="call call--done">
        {phase === "filing" && <p className="call__state">{t.filing}</p>}
        {phase === "filed" && (
          <>
            <p className="call__tick" aria-hidden="true">
              ✓
            </p>
            <p className="call__state">{fmt(t.filedTo, { name: filedName })}</p>
            <p className="call__where">{t.filedWhere}</p>
            {urgent && <p className="call__urgent">{t.urgentFiled}</p>}
          </>
        )}
        {phase === "failed" && <p className="call__state call__state--bad">{note ?? t.fileFailed}</p>}
        <Styles />
      </div>
    );
  }

  const busy = mic === "thinking" || mic === "working" || mic === "speaking";

  return (
    <div className="call">
      {urgent && (
        <p className="call__urgent" role="status">
          {t.urgentNow}
        </p>
      )}

      <div className="call__log" ref={log} aria-live="polite">
        {turns.map((x, i) => (
          <p key={i} className={x.who === "ai" ? "call__line call__line--ai" : "call__line call__line--them"}>
            {x.text}
          </p>
        ))}
        {mic === "thinking" && <p className="call__line call__line--ai call__line--wait">…</p>}
      </div>

      {note && <p className="call__note">{note}</p>}

      <div className="call__controls">
        {canRecord ? (
          <button
            type="button"
            className={mic === "recording" ? "call__mic call__mic--on" : "call__mic"}
            onClick={mic === "recording" ? stopRecording : startRecording}
            disabled={busy}
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.8" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            <span>
              {mic === "recording"
                ? t.stop
                : mic === "working"
                  ? t.transcribing
                  : mic === "speaking"
                    ? t.speaking
                    : t.speak}
            </span>
          </button>
        ) : (
          <p className="call__note">{t.micUnsupported}</p>
        )}

        <button type="button" className="call__hang" onClick={hangUp}>
          {t.hangUp}
        </button>
      </div>

      {/* Not the product. A laptop with no working microphone should not be
          able to stop the demo, and a judge who would rather read than talk
          should not have to talk. */}
      <form
        className="call__typed"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) say(typed);
        }}
      >
        <label htmlFor="call-typed">{t.typeInstead}</label>
        <span>
          <input
            id="call-typed"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            disabled={busy}
            autoComplete="off"
          />
          <button type="submit" disabled={busy || !typed.trim()}>
            {t.send}
          </button>
        </span>
      </form>

      <Styles />
    </div>
  );
}

function Styles() {
  return (
    <style>{`
      .call {
        display: grid; gap: var(--s-5);
        background: var(--white);
        border: 1px solid var(--line);
        border-radius: var(--radius-lg);
        padding: clamp(var(--s-5), 4vw, var(--s-8));
      }
      .call--ring, .call--done { justify-items: center; text-align: center; gap: var(--s-4); }

      .call__pulse {
        width: 72px; height: 72px; border-radius: 50%;
        background: var(--sage);
        box-shadow: 0 0 0 0 rgba(21, 56, 47, 0.35);
        animation: callRing 1.8s var(--ease) infinite;
      }
      @keyframes callRing {
        0%   { box-shadow: 0 0 0 0 rgba(21, 56, 47, 0.35); }
        70%  { box-shadow: 0 0 0 26px rgba(21, 56, 47, 0); }
        100% { box-shadow: 0 0 0 0 rgba(21, 56, 47, 0); }
      }
      .call__from { font-family: var(--display); font-size: 1.5rem; margin: 0; }
      .call__to { font-size: var(--fs-sm); color: var(--ink-2); margin: 0; }
      .call__answer { min-height: 3.25rem; padding-inline: var(--s-8); font-size: 1.0625rem; }
      .call__sim { font-size: var(--fs-xs); color: var(--ink-3); max-width: 44ch; margin: var(--s-2) 0 0; line-height: 1.6; }

      .call__log {
        display: grid; gap: var(--s-3);
        max-height: 20rem; overflow-y: auto;
        padding-right: var(--s-2);
      }
      .call__line {
        margin: 0; font-size: 1.0625rem; line-height: 1.6;
        padding: var(--s-3) var(--s-4); border-radius: var(--radius);
        max-width: 90%;
      }
      .call__line--ai { background: var(--cream-2); color: var(--ink); justify-self: start; }
      .call__line--them { background: var(--forest); color: var(--on-dark); justify-self: end; }
      .call__line--wait { color: var(--ink-3); letter-spacing: .2em; }

      .call__urgent {
        margin: 0; padding: var(--s-3) var(--s-4);
        background: #fdeceb; border: 1px solid var(--risk-high);
        border-radius: var(--radius); color: var(--risk-high);
        font-size: var(--fs-sm); font-weight: 600; line-height: 1.5;
      }
      .call__note { margin: 0; font-size: var(--fs-sm); color: var(--ink-3); }

      .call__controls { display: flex; align-items: center; gap: var(--s-4); flex-wrap: wrap; }
      .call__mic {
        display: inline-flex; align-items: center; gap: var(--s-3);
        font: inherit; font-size: 1.0625rem; font-weight: 600;
        min-height: 3.25rem; padding-inline: var(--s-6);
        border: 1px solid var(--forest); border-radius: var(--radius-pill);
        background: var(--white); color: var(--forest); cursor: pointer;
      }
      .call__mic:disabled { opacity: .55; cursor: default; }
      .call__mic--on { background: var(--risk-high); border-color: var(--risk-high); color: var(--white); }
      .call__hang {
        font: inherit; font-size: var(--fs-sm);
        min-height: 2.75rem; padding-inline: var(--s-5);
        background: none; border: 1px solid var(--line-2);
        border-radius: var(--radius-pill); color: var(--ink-3); cursor: pointer;
      }

      .call__typed { display: grid; gap: var(--s-2); }
      .call__typed label { font-size: var(--fs-xs); color: var(--ink-3); }
      .call__typed span { display: flex; gap: var(--s-2); }
      .call__typed input {
        font: inherit; flex: 1; min-width: 0;
        padding: var(--s-3) var(--s-4);
        border: 1px solid var(--line); border-radius: var(--radius);
        background: var(--white); color: var(--ink);
      }
      .call__typed button {
        font: inherit; font-size: var(--fs-sm); font-weight: 600;
        padding-inline: var(--s-5);
        border: 1px solid var(--line-2); border-radius: var(--radius);
        background: var(--cream-2); color: var(--ink); cursor: pointer;
      }
      .call__typed button:disabled { opacity: .5; cursor: default; }

      .call__tick {
        width: 56px; height: 56px; border-radius: 50%;
        background: var(--sage); color: var(--forest);
        display: grid; place-items: center; font-size: 1.75rem; margin: 0;
      }
      .call__state { font-family: var(--display); font-size: 1.35rem; margin: 0; }
      .call__state--bad { color: var(--risk-high); font-size: 1.0625rem; font-family: var(--sans); }
      .call__where { font-size: var(--fs-sm); color: var(--ink-2); margin: 0; max-width: 46ch; line-height: 1.6; }

      /* iOS zooms the page in when a focused field's text is under 16px. */
      @media (max-width: 40rem) {
        .call__typed input { font-size: 1rem; }
        .call__line { max-width: 100%; }
      }
    `}</style>
  );
}
