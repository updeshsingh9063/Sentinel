/**
 * Write the weekly family summary with an LLM, in warm plain language.
 *
 * The brief lists this as a stretch goal. It used to be one hard-coded
 * paragraph in seed-demo.mjs, which is a fixture wearing the feature's name.
 *
 * WHAT THE MODEL IS AND IS NOT GIVEN. The digest handed to the LLM carries no
 * blood pressure, no sugar, no oxygen, no weight, no risk score and no call
 * transcripts. It gets a handful of plain facts — how many days the phone was
 * answered, whether the week felt better or worse than the one before,
 * whether medicines were taken, which topics came up — because a model cannot
 * leak a reading it was never shown. That is a stronger guarantee than asking
 * it nicely not to mention one.
 *
 * THE SAFETY GATE RUNS AFTER GENERATION, NOT INSTEAD OF IT. Every summary is
 * checked against the same banned stems, words and phrases as
 * model/samarth_model/explain/reasons.py, ported here verbatim. A summary
 * that names or implies a condition is DISCARDED, not edited and not stored:
 * silently repairing unsafe output teaches you nothing about how often the
 * model produces it. The count of rejects is printed at the end and belongs
 * in the write-up.
 *
 * Rows are written with safety_checked = true, which the RLS policy on
 * family_summaries requires before a family member may read one. Nothing here
 * can bypass that; it can only fail to satisfy it.
 *
 * Usage, from frontend/:
 *   node scripts/generate-family-summaries.mjs [--limit 30] [--dry]
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and GROQ_API_KEY.
 * Service role because this is a batch job writing on behalf of the system,
 * not a request made by a signed-in person.
 */

import fs from "node:fs";
import path from "node:path";

/* ---- env ---------------------------------------------------------------- */

function loadEnv() {
  const file = path.join(process.cwd(), ".env.local");
  const out = { ...process.env };
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#") || !t.includes("=")) continue;
      const i = t.indexOf("=");
      const k = t.slice(0, i).trim();
      if (!(k in process.env)) out[k] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    }
  }
  return out;
}

const ENV = loadEnv();
const SUPABASE_URL = ENV.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = ENV.SUPABASE_SERVICE_ROLE_KEY;
const GROQ_KEY = ENV.GROQ_API_KEY;
const GROQ_MODEL = ENV.GROQ_MODEL || "openai/gpt-oss-120b";

for (const [name, value] of Object.entries({
  NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
  GROQ_API_KEY: GROQ_KEY,
})) {
  if (!value) {
    console.error(`missing ${name}`);
    process.exit(1);
  }
}

const args = process.argv.slice(2);
const LIMIT = Number(args[args.indexOf("--limit") + 1]) || 30;
const DRY = args.includes("--dry");

/* ---- the never-diagnose gate -------------------------------------------
   Ported verbatim from model/samarth_model/explain/reasons.py, including the
   split between stems and whole words. A plain substring check fires on
   "routine" because it contains "uti", and on "indicates" because of "cat",
   so the short abbreviations have to match whole words or the gate rejects
   safe text while feeling thorough. */

const BANNED_STEMS = [
  "diagnos", "dementia", "alzheimer", "parkinson", "hypertens",
  "diabet", "pneumon", "arrhythm", "sepsis", "angina", "cancer",
];
const BANNED_WORDS = [
  "stroke", "cardiac", "copd", "uti", "infection", "infections",
  "disease", "diseases", "syndrome", "depression", "psychosis",
];
const BANNED_PHRASES = [
  "heart failure", "anxiety disorder", "suffering from", "condition is",
  "likely has", "caused by", "symptom of", "sign of",
];

function unsafeReason(text) {
  const low = text.toLowerCase();
  for (const phrase of BANNED_PHRASES) {
    if (low.includes(phrase)) return `phrase "${phrase}"`;
  }
  const words = low.match(/[a-z]+/g) ?? [];
  const wordset = new Set(words);
  for (const term of BANNED_WORDS) {
    if (wordset.has(term)) return `word "${term}"`;
  }
  for (const stem of BANNED_STEMS) {
    if (words.some((w) => w.startsWith(stem))) return `stem "${stem}"`;
  }
  return null;
}

/**
 * Numerals, Latin or Devanagari.
 *
 * The prompt forbids them, and this is what makes that a guarantee rather
 * than a hope. A model asked to restate "answered on 5 of 7 days" will
 * sometimes write "five of five" — which it did, in Hindi, on the first run.
 * A wrong number in a health note is worse than a vague one, and the exact
 * counts are rendered beside this text by the report itself.
 */
function digitsIn(text) {
  const m = text.match(/[0-9०-९]/);
  return m ? `numeral "${m[0]}"` : null;
}

/* ---- data --------------------------------------------------------------- */

const H = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
const rest = async (q) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${q}`, { headers: H });
  if (!r.ok) throw new Error(`${q} -> ${r.status} ${await r.text()}`);
  return r.json();
};

const DAY = 86_400_000;
const isoDay = (d) => d.toISOString().slice(0, 10);

/**
 * Plain facts only. Read what is NOT here: no systolic, no glucose, no spo2,
 * no weight, no risk score, no note text. The model cannot reveal a number it
 * never received.
 */
async function digestFor(seniorId, weekStart, weekEnd) {
  const [checkins, meds, cues, alerts, scoresThis, scoresPrev] = await Promise.all([
    rest(`checkins?senior_id=eq.${seniorId}&checked_on=gte.${weekStart}&checked_on=lte.${weekEnd}&select=answered,feeling_code`),
    rest(`medication_logs?senior_id=eq.${seniorId}&due_on=gte.${weekStart}&due_on=lte.${weekEnd}&select=drug_name,taken`),
    rest(`note_cues?senior_id=eq.${seniorId}&observed_on=gte.${weekStart}&observed_on=lte.${weekEnd}&select=cue,negated`),
    rest(`alerts?senior_id=eq.${seniorId}&raised_on=gte.${weekStart}&raised_on=lte.${weekEnd}&select=status`),
    rest(`risk_scores?senior_id=eq.${seniorId}&scored_on=gte.${weekStart}&scored_on=lte.${weekEnd}&select=score`),
    rest(`risk_scores?senior_id=eq.${seniorId}&scored_on=gte.${isoDay(new Date(new Date(weekStart).getTime() - 7 * DAY))}&scored_on=lt.${weekStart}&select=score`),
  ]);

  const answered = checkins.filter((c) => c.answered).length;
  const feelings = checkins.filter((c) => c.answered && c.feeling_code).map((c) => c.feeling_code);
  const worseDays = feelings.filter((f) => f === 3).length;
  const betterDays = feelings.filter((f) => f === 1).length;

  const byDrug = new Map();
  for (const m of meds) {
    const row = byDrug.get(m.drug_name) ?? { taken: 0, due: 0 };
    row.due += 1;
    if (m.taken) row.taken += 1;
    byDrug.set(m.drug_name, row);
  }
  const missedEntirely = [...byDrug.entries()].filter(([, v]) => v.due && !v.taken).map(([d]) => d);

  const mean = (a) => (a.length ? a.reduce((x, y) => x + Number(y.score), 0) / a.length : null);
  const now = mean(scoresThis);
  const before = mean(scoresPrev);

  return {
    answered,
    ofDays: checkins.length || 7,
    betterDays,
    worseDays,
    // A category, never a reading. "topics that came up", not "findings".
    topics: [...new Set(cues.filter((c) => !c.negated).map((c) => c.cue))],
    dosesTaken: meds.filter((m) => m.taken).length,
    dosesDue: meds.length,
    missedEntirely,
    coordinatorCalled: alerts.length > 0,
    // A direction, deliberately not a number. The family never sees the score.
    direction:
      now === null || before === null
        ? "unknown"
        : now < before - 0.05
          ? "steadier than last week"
          : now > before + 0.05
            ? "a little more up and down than last week"
            : "much the same as last week",
  };
}

/* ---- generation --------------------------------------------------------- */

const TOPIC_WORDS = {
  pain: "some aches",
  low_appetite: "eating less than usual",
  poor_sleep: "not sleeping well",
  breathlessness: "getting out of breath",
  loneliness: "feeling a bit alone",
  confusion: "seeming muddled at times",
  dizziness: "feeling lightheaded",
  fall: "a slip or stumble",
  fatigue: "feeling tired",
  low_mood: "feeling low",
};

function promptFor(senior, relationship, digest, lang) {
  const topics = digest.topics.map((t) => TOPIC_WORDS[t] ?? t).join(", ") || "nothing in particular";

  const facts = [
    `Name: ${senior.display_name}`,
    `This note is addressed TO their ${relationship || "family member"}, who is reading it. The ${relationship || "family member"} is NOT the person being described and did not answer any call.`,
    `Answered the daily check-in call on ${digest.answered} of ${digest.ofDays} days`,
    `Said they felt better on ${digest.betterDays} days and worse on ${digest.worseDays} days`,
    `Took ${digest.dosesTaken} of ${digest.dosesDue} expected medicine doses`,
    digest.missedEntirely.length
      ? `Did not take ${digest.missedEntirely.join(" or ")} at all this week`
      : `No medicine was skipped entirely`,
    `Topics that came up on calls: ${topics}`,
    `Overall the week was ${digest.direction}`,
    digest.coordinatorCalled
      ? `A Care Coordinator has already been in touch about this week`
      : `Nothing this week needed the Care Coordinator to step in`,
  ].join("\n");

  const language =
    lang === "hi"
      ? "Write in Hindi (Devanagari script), in everyday spoken Hindi, not formal or literary Hindi."
      : "Write in English, in plain everyday words.";

  return `You write short weekly notes to the family of an older adult who lives at home, on behalf of a care service.

${language}

Write exactly three short paragraphs, separated by a blank line:
1. One warm opening sentence saying how the week went overall.
2. Two or three sentences on what actually happened, using the facts below.
3. One closing sentence saying whether the family needs to do anything, and that a coordinator telephones directly if anything is urgent.

Hard rules:
- Never name, guess at or imply any medical condition or illness. Not even a common one.
- Never give medical advice and never suggest what might be causing anything.
- Do not mention blood pressure, sugar, oxygen, weight, scores or rankings. You have not been given any.
- USE NO NUMBERS OR DIGITS AT ALL. Not for days, not for doses, not for anything. Say "most days", "a few days", "nearly every day", "about half the time" instead. The exact counts are shown to the family separately, beside your words, so writing them again can only introduce a mistake.
- Warm and calm, never alarming, never falsely cheerful. Write as a person, not a system.
- Do not use bullet points or headings, and do not repeat the person's full name more than once.
- Use their name EXACTLY as given. Do not add any title, honorific or qualification in front of it. Do not call them Dr, Shri, Smt, Mr or Mrs. You do not know what they do or did for a living.
- Around 90 words in total.

Facts for this week:
${facts}`;
}

async function generate(prompt) {
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${GROQ_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0.25,
      max_tokens: 1200,
      // gpt-oss is a reasoning model: it spends tokens thinking before it
      // writes, and the thinking comes back in `reasoning`, not `content`.
      // At 400 tokens the whole budget went on reasoning and every summary
      // arrived EMPTY, which the length check then reported as "too short".
      // Low effort is right for this job — the task is to phrase given facts
      // warmly, not to work anything out — and it cuts the call from ~400
      // reasoning tokens to about 15.
      reasoning_effort: "low",
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (r.status === 429) return { retry: true };
  if (!r.ok) throw new Error(`groq ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json();
  return { text: (data?.choices?.[0]?.message?.content ?? "").trim() };
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

/* ---- main --------------------------------------------------------------- */

(async () => {
  const lastScore = await rest("risk_scores?select=scored_on&order=scored_on.desc&limit=1");
  const weekEnd = lastScore[0]?.scored_on;
  if (!weekEnd) {
    console.error("no risk scores — load the cohort first");
    process.exit(1);
  }
  const weekStart = isoDay(new Date(new Date(weekEnd).getTime() - 6 * DAY));
  console.log(`week ${weekStart} -> ${weekEnd}`);

  // Consent is the gate on the read side too, so there is no point writing a
  // summary for a senior whose family consent is off.
  const consents = await rest(
    "consents?scope=eq.family_summary&granted=is.true&select=senior_id",
  );
  const consented = new Set(consents.map((c) => c.senior_id));

  const links = await rest("family_links?select=senior_id,relationship");
  const linkRel = new Map(links.map((l) => [l.senior_id, l.relationship]));

  const seniors = await rest("seniors?select=id,display_name,language&order=display_name");
  // Anyone actually linked to a family account first: those are the summaries
  // a person will really open.
  const ordered = [
    ...seniors.filter((s) => linkRel.has(s.id)),
    ...seniors.filter((s) => !linkRel.has(s.id)),
  ].filter((s) => consented.has(s.id)).slice(0, LIMIT);

  console.log(`generating for ${ordered.length} seniors (${links.length} with a family link)\n`);

  let written = 0;
  let rejected = 0;
  const rejects = [];

  for (const senior of ordered) {
    const digest = await digestFor(senior.id, weekStart, weekEnd);
    const prompt = promptFor(senior, linkRel.get(senior.id), digest, senior.language);

    let result = await generate(prompt);
    if (result.retry) {
      // The free tier caps tokens per minute. Waiting is correct; dropping
      // the senior would quietly produce a partial run.
      process.stdout.write("  (rate limited, waiting 25s) ");
      await sleep(25_000);
      result = await generate(prompt);
    }
    const text = result.text ?? "";

    const bad = unsafeReason(text) ?? digitsIn(text);
    if (bad || text.length < 60) {
      rejected += 1;
      rejects.push({ senior: senior.display_name, why: bad ?? "too short" });
      console.log(`  REJECT  ${senior.display_name.padEnd(22)} ${bad ?? "too short"}`);
      continue;
    }

    if (!DRY) {
      // on_conflict names the unique constraint PostgREST should upsert
      // against; without it "merge-duplicates" still inserts and the second
      // run of the week dies on (senior_id, covers_on). Re-running this
      // script has to be safe, or a rate-limit stop halfway through leaves
      // you unable to finish.
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/family_summaries?on_conflict=senior_id,covers_on`,
        {
        method: "POST",
          headers: { ...H, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" },
          body: JSON.stringify({
            senior_id: senior.id,
            covers_on: weekEnd,
            summary_text: text,
            safety_checked: true,
          }),
        },
      );
      if (!res.ok) throw new Error(`insert ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }

    written += 1;
    console.log(`  ok      ${senior.display_name.padEnd(22)} ${senior.language}  ${text.length} chars`);
    // A dry run exists to be read. Printing only the character count
    // tells you it produced something, not whether it is fit to send.
    if (DRY) {
      for (const line of text.split(/\n/)) console.log(`          | ${line}`);
    }
    // ~250 tokens a call against an 8k-per-minute ceiling, so this is
    // courtesy rather than necessity.
    await sleep(2500);
  }

  console.log(`\n${written} written, ${rejected} rejected by the safety gate`);
  if (rejects.length) console.log(JSON.stringify(rejects, null, 1));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
