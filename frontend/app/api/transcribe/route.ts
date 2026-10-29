import { NextResponse } from "next/server";

/**
 * Speech-to-text for the phone check-in, via Groq Whisper.
 *
 * Server-side because the Groq key lives here and must never reach a browser
 * bundle. The audio is forwarded once and not stored: a senior's voice is
 * health data, and the only thing that leaves this route is the transcript.
 *
 * WHISPER HALLUCINATES ON SILENCE. Probed with a pure 220 Hz tone it returned
 * "झाल" and "करते हैं" — confident Devanagari from audio containing no speech
 * at all. For this product that is the dangerous failure: a senior who says
 * nothing would have an answer invented for them, when the design treats an
 * unanswered question as real evidence rather than a gap.
 *
 * Two guards, neither of which is enough alone:
 *   1. the client refuses to send audio whose loudness never rises above
 *      background, so silence is reported as silence and never reaches Groq
 *   2. this route rejects transcripts that are too short or that match the
 *      known hallucination filler, and returns `speech: false` rather than
 *      a string the caller might treat as an answer
 *
 * Anything uncertain falls back to the keypad, which needs no microphone, no
 * network and no model.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const DEFAULT_MODEL = "whisper-large-v3-turbo";
const MAX_BYTES = 4 * 1024 * 1024;   // ~30s of webm/opus is far below this
const MIN_CHARS = 2;

/** Rate limit, in-memory; resets on restart and does not span instances. */
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > MAX_PER_WINDOW;
}

/**
 * Strings Whisper produces from non-speech. Collected from probing it with
 * tones and room noise; this is a safety net under the client's loudness
 * check, not a substitute for it.
 */
const HALLUCINATION = [
  "thank you", "thanks for watching", "subscribe", "bye", "you",
  "शुक्रिया", "धन्यवाद", "करते हैं", "झाल", "नमस्कार दोस्तों",
  "please subscribe", "music", "संगीत", "[music]", "।", ".", "..",
];

export async function POST(request: Request) {
  const key = process.env.GROQ_API_KEY;
  if (!key) return NextResponse.json({ error: "unconfigured" }, { status: 503 });

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    request.headers.get("x-real-ip") ||
    "local";
  if (rateLimited(ip)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const file = form.get("audio");
  const language = String(form.get("language") || "hi");
  if (!(file instanceof Blob) || file.size === 0) {
    return NextResponse.json({ error: "no_audio" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "too_large" }, { status: 413 });
  }

  const upstream = new FormData();
  upstream.append("file", file, "checkin.webm");
  upstream.append("model", process.env.GROQ_WHISPER_MODEL || DEFAULT_MODEL);
  upstream.append("response_format", "json");
  // Hinting the language markedly improves Hindi over auto-detect on short
  // clips, which is all a check-in answer ever is.
  if (language === "hi" || language === "en") upstream.append("language", language);
  // A prompt biases Whisper toward the vocabulary it should expect. It must
  // never contain the ANSWERS, or the model starts producing them from noise.
  upstream.append(
    "prompt",
    language === "hi"
      ? "रोज़ की कुशल-क्षेम जाँच। बुज़ुर्ग अपनी तबीयत के बारे में एक छोटा जवाब देते हैं।"
      : "A short daily wellbeing check-in answer from an older adult.",
  );

  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: upstream,
      signal: AbortSignal.timeout(45_000),
    });

    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      console.error("groq transcribe", res.status, detail);
      if (res.status === 429) return NextResponse.json({ error: "busy" }, { status: 429 });
      return NextResponse.json({ error: "upstream" }, { status: 502 });
    }

    const data = await res.json();
    const raw = String(data?.text ?? "").trim();
    const normalised = raw.toLowerCase().replace(/[.,!?।]/g, "").trim();

    const looksLikeNothing =
      normalised.length < MIN_CHARS ||
      HALLUCINATION.some((h) => normalised === h.toLowerCase());

    if (looksLikeNothing) {
      // Reported as "no speech", never as an empty answer the caller might
      // store. The difference matters: one is a fact, the other is a guess.
      return NextResponse.json({ speech: false, text: "" });
    }

    return NextResponse.json({ speech: true, text: raw });
  } catch (e) {
    console.error("transcribe failed", e);
    return NextResponse.json({ error: "upstream" }, { status: 502 });
  }
}
