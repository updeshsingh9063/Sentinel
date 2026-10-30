import { NextResponse } from "next/server";

/**
 * The daily call, as a conversation.
 *
 * WHAT THIS REPLACES. The check-in used to read out six multiple-choice
 * questions and collect a keypress for each. That is a form with a voice, and
 * it is the thing a senior should never have been asked to do. Here the
 * companion greets them by name, asks how they are, and listens. The same six
 * signals come out the other end — but as a reading of what somebody said,
 * not as what they were marched through.
 *
 * ONE MODEL CALL PER TURN, doing two jobs at once: the next thing to say, and
 * everything understood so far. They are the same call on purpose. Asking a
 * second model to re-read the transcript would let the two disagree — the
 * companion saying "I'm glad you slept well" while the extraction records
 * nothing about sleep — and on a clinical record that disagreement is the
 * worse failure.
 *
 * SIGNALS COME BACK EVERY TURN, not just at the end. A call that drops after
 * two sentences still carries what those sentences said. Nothing is held
 * until a tidy ending that real calls often do not have.
 *
 * THE KEY STAYS HERE. Same reason as every other route that touches Groq: a
 * key in the bundle is a key anyone can spend.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = "openai/gpt-oss-120b";

/**
 * Groq's free tier caps tokens per MINUTE, and a six-turn call spends that
 * budget in well under a minute, so both numbers here are deliberate.
 *
 * reasoning_effort matters more than max_tokens. gpt-oss-120b thinks before it
 * answers, and that thinking comes out of the same allowance as the reply: at
 * 420 tokens with the default effort it reasoned until it ran out and returned
 * a truncated object, which Groq rejects as json_validate_failed with an empty
 * failed_generation — an error that looks like a prompt fault and is not one.
 * Low effort is also the right setting on its merits. This is a short spoken
 * line and a reading of what somebody just said, not a problem to solve.
 */
const MAX_TOKENS = 900;
/** How many past exchanges the model re-reads. The rest it is told, not shown. */
const WINDOW_TURNS = 6;
const MAX_TURN_CHARS = 500;

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 500) {
    for (const [k, v] of hits) if (!v.some((t) => now - t < WINDOW_MS)) hits.delete(k);
  }
  return recent.length > MAX_PER_WINDOW;
}

interface Turn {
  who: "ai" | "senior";
  text: string;
}

/**
 * The senior's name and language, read from the database rather than taken
 * from the request. The browser is standing in for a phone line it does not
 * own, and letting it name the person the call is about would let anyone
 * decide whose record a conversation lands on.
 */
async function demoProfile(): Promise<{ name: string; language: string }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return { name: "", language: "hi" };
  try {
    const res = await fetch(`${url}/rest/v1/rpc/demo_line_profile`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: "{}",
      cache: "no-store",
    });
    if (!res.ok) return { name: "", language: "hi" };
    const data = (await res.json()) as { name?: string; language?: string } | null;
    return { name: data?.name ?? "", language: data?.language ?? "hi" };
  } catch {
    return { name: "", language: "hi" };
  }
}

/**
 * Short on purpose. This prompt is re-sent on EVERY turn of the call, so its
 * length is multiplied by the number of turns, and Groq's free tier allows
 * 8,000 tokens a MINUTE. The first draft ran to about 950 tokens and a
 * four-turn call spent 7,538 of the 8,000 — the fifth turn was refused and
 * the call simply stopped, mid-sentence, in front of whoever was watching.
 *
 * Everything cut was elaboration. Every safety rule is still here.
 */
function systemPrompt(name: string, lang: "hi" | "en", turnCount: number): string {
  const speak =
    lang === "hi"
      ? "Speak ordinary spoken Hindi in Devanagari, the way a younger relative speaks to an elder."
      : "Speak ordinary English, the way a younger relative speaks to an elder.";
  const who = name ? `You are calling ${name}; use their name in the greeting and sparingly after.` : "You do not know their name; do not invent one.";

  return `You are Samarth Sentinel's daily companion call: a friendly voice phoning an older person at home. Not a doctor, not an app.
${speak} If they answer in a different language, follow them into it.
${who}

TALK: one or two short sentences a turn. Ask ONE thing, and let it arise from what they just said. Never read a list. Never say "press", "option", or "on a scale" — there is no keypad.

LEARN over the call, without interrogating: how they feel vs usual, pain, whether they took their medicines, sleep, whether they have eaten, any fall or near-fall, anything they need help with. Skip what they already volunteered.

NEVER: name a condition, diagnose, interpret a symptom, advise a drug or dose, or promise an ambulance or a visit. You may truthfully promise to tell their care coordinator. Never ask for an address, bank detail or ID.

URGENT — a fall just now, chest pain, breathlessness, bleeding, confusion, or they ask for help immediately: drop the small talk, say calmly that you are telling their coordinator now, ask if someone is with them, set "urgent" true.

ENDING: this is turn ${turnCount}. Close warmly and set "done" true around turn 6 or 7, or as soon as they sound ready to go, or if they say goodbye. But never close on the turn where they have just told you something new about their health — acknowledge it and ask one short thing first.

REPLY JSON ONLY:
{"say":"what you say out loud","done":false,"urgent":false,"signals":{"feeling":null,"pain":null,"meds":null,"sleep":null,"appetite":null,"fall":null,"cues":[{"cue":"","negated":false,"confidence":0.8,"span":"their words"}],"summary":"one plain line for a coordinator"}}

SCALES, 1 good to 3 concerning, null if it did not come up. Never guess — a number nobody said becomes a number on a clinical record.
feeling 1 better 2 same 3 worse | pain 1 none 2 a little 3 a lot | meds 1 taken 2 late/partial 3 not taken | sleep 1 well 2 patchy 3 barely | appetite 1 normal 2 less 3 not eating | fall 1 none 2 stumble/near-fall 3 a fall

CUES, only these: pain, fall, confusion, low_appetite, loneliness, dizziness, poor_sleep, breathlessness. negated true when they said it did NOT happen ("no pain today" is evidence). span is their own words, quoted.

SIGNALS ARE CUMULATIVE for the whole call so far, not just this turn. You are given what is already known; repeat it and add to it. Do not blank a value that is already known.

A cue and its code go together: if you record a pain cue, pain must have a code; fall cue, fall code; poor_sleep, sleep; low_appetite, appetite.

SUMMARY: plain, specific, non-diagnostic, English, and ONLY what was actually said. Never write that something is fine or normal because it did not come up — "no appetite problems" when nobody mentioned eating is an invention, and it is the kind that gets believed.

Do not recite back what is already settled. Acknowledge in a few words and move on; asking the same thing twice makes this sound like the form it replaced.`;
}

export async function POST(req: Request) {
  const key = process.env.GROQ_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "local";
  if (rateLimited(ip)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let body: { turns?: Turn[]; lang?: string; known?: Record<string, unknown> | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const asked: "hi" | "en" = body.lang === "en" ? "en" : "hi";
  const all = (Array.isArray(body.turns) ? body.turns : [])
    .filter((x) => x && (x.who === "ai" || x.who === "senior") && typeof x.text === "string")
    .map((x) => ({ who: x.who, text: x.text.slice(0, MAX_TURN_CHARS) }));

  const profile = await demoProfile();
  const spoken = all.filter((x) => x.who === "senior").length;

  /**
   * THE SENIOR'S LANGUAGE, NOT THE BROWSER'S.
   *
   * This used to follow the site's language cookie, which is how a call to a
   * Hindi speaker came back in English: the page had been opened in English
   * by somebody else entirely. On a real phone line there is no site and no
   * cookie — there is a person whose language is on their record, which is
   * exactly what seniors.language is for. The request's language is only a
   * fallback for a record that does not say.
   */
  const lang: "hi" | "en" = profile.language === "en" ? "en" : profile.language === "hi" ? "hi" : asked;

  /**
   * A WINDOW, not the transcript. Re-sending the whole call each turn makes
   * the input grow every time, and on an 8,000-token-a-minute allowance a
   * six-turn call cannot afford that twice over. The model gets the last few
   * exchanges plus everything already established, which is what it needs to
   * say the next sensible thing. The FULL transcript is kept by the caller
   * and written to the record at the end — it is just not what the model is
   * asked to re-read on every turn.
   */
  const window = all.slice(-WINDOW_TURNS);
  const known = body.known && typeof body.known === "object" ? body.known : null;

  const messages: { role: string; content: string }[] = [
    { role: "system", content: systemPrompt(profile.name, lang, spoken + 1) },
  ];

  if (known) {
    messages.push({
      role: "system",
      content: `Already established earlier in this call (carry forward, add to it, never blank it):\n${JSON.stringify(known).slice(0, 1200)}`,
    });
  }

  for (const x of window) {
    messages.push({
      role: x.who === "ai" ? "assistant" : "user",
      content: x.who === "ai" ? JSON.stringify({ say: x.text }) : x.text,
    });
  }

  // No turns yet means this is the moment the call is answered, and the
  // companion has to speak first — it placed the call.
  if (!all.length) {
    messages.push({
      role: "user",
      content: "[The call has just been answered. Greet them and open the call.]",
    });
  }

  const ask = () =>
    fetch(GROQ_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.GROQ_CALL_MODEL || DEFAULT_MODEL,
        messages,
        temperature: 0.6,
        max_tokens: MAX_TOKENS,
        reasoning_effort: "low",
        response_format: { type: "json_object" },
      }),
    });

  let res: Response;
  try {
    res = await ask();
    /**
     * One retry on a rate limit, waiting exactly as long as Groq says to.
     * The alternative is a call that stops dead in the middle of a sentence
     * because a per-minute allowance ticked over — which is survivable in a
     * test and not survivable in front of a room.
     */
    if (res.status === 429) {
      const wait = Math.min(Math.ceil(Number(res.headers.get("retry-after") ?? 3) * 1000) || 3000, 9000);
      await new Promise((r) => setTimeout(r, wait));
      res = await ask();
    }
  } catch {
    return NextResponse.json({ error: "upstream_unreachable" }, { status: 502 });
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("groq converse", res.status, detail.slice(0, 300));
    // The caller needs to tell these apart: a rate limit is worth waiting
    // out, anything else is not.
    return NextResponse.json(
      { error: res.status === 429 ? "busy" : "upstream" },
      { status: res.status === 429 ? 429 : 502 },
    );
  }

  const payload = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };
  // Logged because the per-minute allowance is the binding constraint on this
  // route, and the only way to know a change helped is to watch the number.
  if (payload.usage) {
    console.log(
      `converse turn ${spoken + 1}: in ${payload.usage.prompt_tokens} out ${payload.usage.completion_tokens} total ${payload.usage.total_tokens}`,
    );
  }
  const raw = payload.choices?.[0]?.message?.content ?? "";

  let out: {
    say?: string;
    done?: boolean;
    urgent?: boolean;
    signals?: Record<string, unknown>;
  };
  try {
    out = JSON.parse(raw);
  } catch {
    // A model that did not return JSON has not given us anything we can put on
    // a record, so nothing goes on one. The call carries on with a neutral
    // line rather than ending on an error the person on the phone would hear.
    console.error("groq converse: non-JSON reply", raw.slice(0, 200));
    return NextResponse.json({
      say: lang === "hi" ? "माफ़ कीजिए, मैं सुन नहीं पाया। फिर से कहिए?" : "Sorry, I didn't catch that. Could you say it again?",
      done: false,
      urgent: false,
      signals: null,
      lang,
    });
  }

  const say = typeof out.say === "string" ? out.say.slice(0, 600) : "";
  if (!say) {
    return NextResponse.json({ error: "empty" }, { status: 502 });
  }

  return NextResponse.json({
    say,
    done: out.done === true,
    urgent: out.urgent === true,
    signals: out.signals ?? null,
    name: profile.name,
    // So the caller speaks and listens in the same language the companion
    // chose, rather than in whichever one the page happens to be set to.
    lang,
  });
}
