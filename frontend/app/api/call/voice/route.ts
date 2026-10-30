import { NextResponse } from "next/server";

/**
 * The voice of the call: what Twilio asks for, turn by turn.
 *
 * Twilio is stateless between posts. It rings the number, and when somebody
 * answers it POSTs here and waits for TwiML telling it what to say. The
 * person speaks, Twilio transcribes, POSTs the words back, and waits again.
 * The whole conversation is therefore a series of unrelated HTTP requests
 * tied together by one call id — which is why the turns live in the database
 * (migration 0019) rather than in memory on a function that may not be the
 * same function next time.
 *
 * THIS ROUTE HOLDS NO CREDENTIAL. It carries the telephony secret through to
 * the security-definer functions and can do nothing else. A compromise of
 * this host buys the ability to hold a conversation with somebody — not to
 * read a senior, a vital or a score.
 *
 * TWILIO'S OWN TRANSCRIPTION, NOT WHISPER. `<Gather input="speech">` is what
 * a phone line gives you without streaming audio out of it, and it is
 * noticeably worse at Hindi than the Whisper path the browser simulator uses.
 * That is a real trade and it is made here deliberately: the alternative is
 * Media Streams over a websocket, which is a day's work and another moving
 * part to fail live. The transcript on the record says which one produced it.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SITE = () => process.env.PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || "";

/** Twilio's Hindi and Indian-English voices. */
const VOICE = { hi: "Polly.Aditi", en: "Polly.Raveena" } as const;

function xml(body: string) {
  return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, {
    status: 200,
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}

/** XML has five characters that cannot appear raw, and a senior's name may contain one. */
function esc(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function say(text: string, lang: "hi" | "en") {
  const locale = lang === "hi" ? "hi-IN" : "en-IN";
  return `<Say voice="${VOICE[lang]}" language="${locale}">${esc(text)}</Say>`;
}

function listen(text: string, lang: "hi" | "en", action: string) {
  const locale = lang === "hi" ? "hi-IN" : "en-IN";
  // speechTimeout="auto" lets an older person pause mid-sentence without the
  // line cutting them off, which a fixed timeout does constantly.
  //
  // timeout is a DIFFERENT clock: how long to wait for speech to BEGIN once
  // the prompt has finished. Twilio's default is 5 seconds, which is brisk for
  // anyone and far too short for somebody who has just picked up a telephone,
  // registered that it is not a person, and is deciding whether to answer it.
  // Every call that fell straight through to the goodbye failed on this.
  return (
    `<Gather input="speech" language="${locale}" speechTimeout="auto" timeout="10" ` +
    `action="${esc(action)}" method="POST">${say(text, lang)}</Gather>` +
    // Reached only when they said nothing at all.
    `${say(lang === "hi" ? "कोई बात नहीं। मैं बाद में फिर कोशिश करूँगा। अपना ध्यान रखिए।" : "No matter. I will try again later. Take care.", lang)}<Hangup/>`
  );
}

const rpc = async (fn: string, args: Record<string, unknown>) => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  try {
    const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: key, "Content-Type": "application/json" },
      body: JSON.stringify(args),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
};

export async function POST(req: Request) {
  const url = new URL(req.url);
  const secret = url.searchParams.get("key") ?? "";
  const isStatus = url.searchParams.get("status") === "1";
  // WHO THIS CALL WAS PLACED FOR. An outbound dialler knows; an inbound
  // caller cannot say. Absent, the senior is resolved from the number, which
  // is right for somebody ringing the line and wrong the moment two seniors
  // share a handset — see migration 0021.
  const forSenior = url.searchParams.get("senior");
  // THIS CALL IS AN ANSWER TO AN ALARM, not the morning round. Somebody rang
  // a help line and hung up; opening with "how is your day going" would be
  // the wrong voice entirely, and would also waste the first seconds of a
  // call that may be the only chance to find out what is wrong.
  const isSos = url.searchParams.get("sos") === "1";

  const form = Object.fromEntries((await req.formData()).entries()) as Record<string, string>;
  const callSid = form.CallSid ?? "";
  const to = form.To ?? form.Called ?? "";
  const heard = (form.SpeechResult ?? "").trim();

  // ---- the call ended, however it ended ----------------------------------
  if (isStatus) {
    const status = form.CallStatus ?? "";
    if (status === "completed") {
      await rpc("telephony_finish", { p_secret: secret, p_call_sid: callSid });
    } else {
      // busy, no-answer, failed, canceled. Silence is evidence: it is written
      // down as an attempt rather than left as an absent row.
      await rpc("telephony_no_answer", { p_secret: secret, p_phone: to });
    }
    return NextResponse.json({ ok: true });
  }

  // ---- they picked up -----------------------------------------------------
  const action =
    `${SITE()}/api/call/voice?key=${encodeURIComponent(secret)}` +
    // Carried on every turn, not just the first: Twilio keeps no state, so a
    // URL that loses the id sends the rest of the conversation back to
    // resolving by number.
    (forSenior ? `&senior=${encodeURIComponent(forSenior)}` : "") +
    (isSos ? "&sos=1" : "");

  if (!heard) {
    const begun = await rpc("telephony_begin", {
      p_secret: secret,
      p_call_sid: callSid,
      p_phone: to,
      p_senior_id: forSenior,
    });

    if (!begun || begun.ok !== true) {
      // An unknown number or a bad secret gets a courteous ending and no
      // information about why. Somebody has answered a telephone; they are
      // not owed a debugging message and must not be given one.
      return xml(
        `${say("Sorry, I think I have the wrong number. Goodbye.", "en")}<Hangup/>`,
      );
    }

    const lang = begun.language === "en" ? "en" : "hi";

    // AN EMPTY SpeechResult IS NOT ALWAYS THE START OF A CALL. When a Gather
    // hears nothing, Twilio posts back here with no SpeechResult at all —
    // identical in shape to the opening request. Treating the two the same
    // meant somebody who paused got greeted a second time, from the top, and
    // the transcript recorded the greeting twice. The session knows which it
    // is: a call that has already said something is not a call that has just
    // begun.
    const prior = await rpc("telephony_turn", {
      p_secret: secret,
      p_call_sid: callSid,
      p_said: null,
      p_say: null,
    });
    const said = (prior?.turns as { who: string; text: string }[]) ?? [];

    if (said.length > 0) {
      // Silence, not a beginning. Ask once more, in fewer words, then let
      // them go — a machine that keeps talking at somebody who is not
      // answering is worse than one that rings off politely. Two unanswered
      // prompts is a no-answer, and telephony_finish records it as one.
      const nudges = said.filter((t) => t.who === "ai" && t.text.length < 90).length;
      if (nudges >= 2) {
        await rpc("telephony_finish", { p_secret: secret, p_call_sid: callSid });
        return xml(
          `${say(
            lang === "hi"
              ? "कोई बात नहीं। मैं बाद में फिर फ़ोन करूँगा। अपना ध्यान रखिए।"
              : "No matter. I will ring again later. Take care.",
            lang,
          )}<Hangup/>`,
        );
      }
      const nudge =
        lang === "hi"
          ? "माफ़ कीजिए, मैं सुन नहीं पाया। आप कैसे हैं?"
          : "Sorry, I did not catch that. How are you?";
      await rpc("telephony_turn", {
        p_secret: secret,
        p_call_sid: callSid,
        p_said: null,
        p_say: nudge,
      });
      return xml(listen(nudge, lang, action));
    }

    if (isSos) {
      // Fixed words, not a model's. Reassurance is the one thing that must
      // not vary, must not be slow, and must not depend on a provider that
      // may be rate-limiting us at exactly the wrong moment. It says what is
      // already true — the coordinator HAS been told — and promises nothing
      // more, because nothing here calls an ambulance.
      const opening =
        lang === "hi"
          ? "नमस्ते, मैं समर्थ से बोल रहा हूँ। आपका फ़ोन आया था। आपके केयर कोऑर्डिनेटर को बता दिया गया है। बताइए, क्या हुआ है?"
          : "Hello, this is Samarth. We saw your call. Your care coordinator has been told. Please tell me what has happened.";
      await rpc("telephony_turn", {
        p_secret: secret,
        p_call_sid: callSid,
        p_said: null,
        p_say: opening,
      });
      return xml(listen(opening, lang, action));
    }

    const opening = await compose(secret, callSid, "", begun, lang);
    return xml(listen(opening.say, lang, action));
  }

  // ---- they said something ------------------------------------------------
  const session = await rpc("telephony_begin", {
    p_secret: secret,
    p_call_sid: callSid,
    p_phone: to,
    p_senior_id: forSenior,
  });
  const lang = session?.language === "en" ? "en" : "hi";
  const next = await compose(secret, callSid, heard, session ?? {}, lang);

  if (next.done) {
    await rpc("telephony_finish", { p_secret: secret, p_call_sid: callSid });
    return xml(`${say(next.say, lang)}<Hangup/>`);
  }
  return xml(listen(next.say, lang, action));
}

/**
 * Ask the same conversation engine the browser uses, then record the turn.
 *
 * ONE ENGINE, TWO TRANSPORTS. The prompt, the signal scales, the refusal to
 * diagnose and the refusal to promise are all in /api/checkin/converse, and
 * a telephone call must not get a second, drifting copy of them.
 */
async function compose(
  secret: string,
  callSid: string,
  heard: string,
  profile: Record<string, unknown>,
  lang: "hi" | "en",
): Promise<{ say: string; done: boolean }> {
  // Everything said so far, read back from the session rather than held here.
  const state = await rpc("telephony_turn", {
    p_secret: secret,
    p_call_sid: callSid,
    p_said: heard,
    p_say: null,
  });
  const turns = (state?.turns as { who: string; text: string }[]) ?? [];
  const known = (state?.signals as Record<string, unknown>) ?? null;

  let out: { say?: string; done?: boolean; signals?: unknown; request?: unknown } | null = null;
  try {
    const res = await fetch(`${SITE()}/api/checkin/converse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ turns, lang, known, profile, secret }),
    });
    out = await res.json();
  } catch {
    out = null;
  }

  const line =
    out?.say ??
    (lang === "hi"
      ? "माफ़ कीजिए, लाइन ठीक नहीं है। मैं थोड़ी देर में फिर फ़ोन करूँगा।"
      : "Sorry, the line is poor. I will ring again shortly.");

  await rpc("telephony_turn", {
    p_secret: secret,
    p_call_sid: callSid,
    p_said: null,
    p_say: line,
    p_signals: out?.signals ?? null,
    p_request: out?.request ?? null,
  });

  // A model that failed is not a reason to keep somebody on the phone.
  return { say: line, done: out?.done === true || !out?.say };
}

/** Twilio validates a webhook URL before saving it; it must not 405. */
export async function GET() {
  return NextResponse.json({ ok: true, channel: "voice", method: "POST" });
}
