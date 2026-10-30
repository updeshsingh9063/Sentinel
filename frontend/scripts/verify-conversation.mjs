/**
 * Prove the conversational call: someone talks, and a coordinator reads it.
 *
 * The check-in used to be six multiple-choice questions. It is now a
 * conversation, and the claim being tested is that nothing downstream had to
 * be told: the same `checkins` codes, the same `call_notes`, the same
 * `note_cues` the risk model already reads.
 *
 * Everything is written through exactly the path the public page uses -- the
 * anon key, no session -- and read back as the coordinator who carries that
 * senior. The containment assertions matter as much as the happy path: a page
 * served to anybody on the internet must not be able to name whose record it
 * writes, or read anything back.
 *
 * Usage, from frontend/ with the dev server running:
 *   node scripts/verify-conversation.mjs
 */

import fs from "node:fs";
import path from "node:path";

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
const URL_ = ENV.NEXT_PUBLIC_SUPABASE_URL;
const ANON = ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SITE = ENV.VERIFY_SITE || "http://localhost:3000";
const OWNER = ENV.OWNER_EMAIL;
const OWNER_PW = ENV.OWNER_PASSWORD;

if (!URL_ || !ANON) {
  console.error("need NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY");
  process.exit(1);
}

let failures = 0;
function check(label, ok, detail) {
  if (ok) console.log(`  PASS  ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${label}  -> ${detail}`);
  }
}

const rpc = (fn, args, token) =>
  fetch(`${URL_}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: ANON,
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(args),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

const signIn = (email, password) =>
  fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  })
    .then((r) => r.json())
    .then((j) => j.access_token ?? null);

const read = (q, token) =>
  fetch(`${URL_}/rest/v1/${q}`, {
    headers: { apikey: ANON, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

console.log(`\nverifying the conversational call against ${URL_}\n`);

// ---- 1. the companion speaks first ---------------------------------------
console.log("the call opens");
const profile = await rpc("demo_line_profile", {});
check("the line has a name and a language", !!profile.body?.name && !!profile.body?.language, JSON.stringify(profile.body));
check(
  "it exposes nothing joinable",
  profile.body && !("id" in profile.body) && Object.keys(profile.body).length === 2,
  JSON.stringify(profile.body),
);
const lineName = profile.body?.name ?? "";
if (lineName) console.log(`  ..    the line is ${lineName}'s`);

// ---- 2. a real conversation, through the real route ----------------------
console.log("\nsomebody talks (through /api/checkin/converse)");
const SAID = [
  "ठीक हूँ बेटा, थोड़ी कमजोरी है",
  "रात को नींद नहीं आई, घुटने में दर्द था",
  "नहीं, शाम की गोली अभी नहीं ली",
];

const CODES = ["feeling", "pain", "meds", "sleep", "appetite", "fall"];
const KINDS = new Set(["pain","fall","confusion","low_appetite","loneliness","dizziness","poor_sleep","breathlessness"]);
let known = { feeling: null, pain: null, meds: null, sleep: null, appetite: null, fall: null, cues: [], summary: "" };
const turns = [];
let reachedModel = false;

for (let i = 0; i <= SAID.length; i += 1) {
  let d;
  try {
    const r = await fetch(`${SITE}/api/checkin/converse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ turns, lang: "hi", known }),
    });
    d = await r.json();
    if (!r.ok || !d.say) break;
  } catch {
    break;
  }
  reachedModel = true;
  turns.push({ who: "ai", text: d.say });
  const s = d.signals && typeof d.signals === "object" ? d.signals : {};
  for (const k of CODES) {
    const n = Number(s[k]);
    if (n === 1 || n === 2 || n === 3) known[k] = n;
  }
  for (const c of Array.isArray(s.cues) ? s.cues : []) {
    if (!c || !KINDS.has(c.cue)) continue;
    if (!known.cues.some((x) => x.cue === c.cue && x.negated === (c.negated === true))) {
      known.cues.push({ cue: c.cue, negated: c.negated === true, confidence: Number(c.confidence) || 0.6, span: String(c.span ?? "") });
    }
  }
  if (typeof s.summary === "string" && s.summary.trim()) known.summary = s.summary;
  if (d.done || i === SAID.length) break;
  turns.push({ who: "senior", text: SAID[i] });
}

check("the companion held a conversation", reachedModel && turns.length >= 2, `turns=${turns.length}`);
check(
  "it read the medicines as not taken",
  known.meds === 3,
  `meds=${known.meds} (said "शाम की गोली अभी नहीं ली")`,
);
check("it heard the knee pain", known.cues.some((c) => c.cue === "pain" && !c.negated), JSON.stringify(known.cues));
check("it wrote a summary", known.summary.trim().length > 10, JSON.stringify(known.summary));
check(
  "it invented nothing about what never came up",
  known.appetite === null,
  `appetite=${known.appetite} but nobody mentioned eating`,
);

// ---- 3. filing it, as the public page does -------------------------------
console.log("\nfiling (anon, no session)");
const transcript = turns.map((x) => `${x.who === "ai" ? "Samarth" : lineName}: ${x.text}`).join("\n");
const filed = await rpc("record_demo_conversation", {
  p_transcript: transcript,
  p_signals: { ...known, language: "hi" },
});
check("the call is accepted", filed.body?.ok === true, JSON.stringify(filed.body));
check("it names whose record it went to", !!filed.body?.senior_name, JSON.stringify(filed.body));
const seniorId = filed.body?.senior_id;

// ---- 4. containment ------------------------------------------------------
console.log("\ncontainment");
{
  const r = await fetch(`${URL_}/rest/v1/rpc/record_demo_conversation`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ p_senior_id: "00000000-0000-0000-0000-000000000000", p_transcript: "x", p_signals: {} }),
  });
  check("there is no senior id to pass", r.status >= 400, `status=${r.status}`);

  const anonRead = await read("call_notes?select=id&limit=1");
  check(
    "anon still cannot read call notes",
    anonRead.status >= 400 || (Array.isArray(anonRead.body) && anonRead.body.length === 0),
    `status=${anonRead.status} body=${JSON.stringify(anonRead.body)?.slice(0, 80)}`,
  );

  const anonInsert = await fetch(`${URL_}/rest/v1/checkins`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ senior_id: seniorId, checked_on: "2026-01-01", answered: true }),
  });
  check("anon still cannot insert a check-in directly", anonInsert.status >= 400, `status=${anonInsert.status}`);

  // A cue label the schema does not define must be dropped, not stored and
  // not fatal -- one bad word from a model must not lose the whole call.
  const junk = await rpc("record_demo_conversation", {
    p_transcript: "junk cue test",
    p_signals: { ...known, cues: [{ cue: "definitely_not_a_cue", confidence: 0.9, span: "x" }] },
  });
  check("an unknown cue label is dropped, not fatal", junk.body?.ok === true && junk.body?.cues === 0, JSON.stringify(junk.body));
}

// ---- 5. the coordinator reads it back ------------------------------------
console.log("\nthe coordinator's record");
if (!OWNER || !OWNER_PW) {
  console.log("  ..    OWNER_EMAIL / OWNER_PASSWORD not in .env.local, skipping read-back");
} else {
  // Re-file the real conversation so the junk-cue run above is not the last word.
  await rpc("record_demo_conversation", { p_transcript: transcript, p_signals: { ...known, language: "hi" } });

  const token = await signIn(OWNER, OWNER_PW);
  check("the coordinator can sign in", !!token, "no access token");

  const today = new Date().toISOString().slice(0, 10);
  const ci = await read(`checkins?senior_id=eq.${seniorId}&checked_on=eq.${today}&select=*`, token);
  const row = ci.body?.[0];
  check("today's check-in is on the record", !!row, JSON.stringify(ci.body)?.slice(0, 120));
  check("it is marked as a conversation", row?.source === "conversation", `source=${row?.source}`);
  check("the medicines code survived the round trip", row?.meds_taken === false, `meds_taken=${row?.meds_taken}`);

  const notes = await read(
    `call_notes?senior_id=eq.${seniorId}&called_on=eq.${today}&channel=eq.ai_call&select=id,note_text,transcript,channel`,
    token,
  );
  check("exactly one AI note for today", notes.body?.length === 1, `count=${notes.body?.length}`);
  check("the summary is readable at a glance", (notes.body?.[0]?.note_text ?? "").length > 10, JSON.stringify(notes.body?.[0]?.note_text));
  check(
    "the words themselves are kept as evidence",
    (notes.body?.[0]?.transcript ?? "").includes("गोली"),
    JSON.stringify(notes.body?.[0]?.transcript)?.slice(0, 120),
  );

  const cues = await read(
    `note_cues?senior_id=eq.${seniorId}&observed_on=eq.${today}&select=cue,negated,span_text`,
    token,
  );
  check("the cues reached the table the model reads", (cues.body?.length ?? 0) > 0, `count=${cues.body?.length}`);
  check(
    "a cue quotes the senior, not a paraphrase",
    (cues.body ?? []).some((c) => (c.span_text ?? "").length > 3),
    JSON.stringify(cues.body)?.slice(0, 160),
  );
}

console.log(
  failures === 0
    ? "\nthe conversational call holds\n"
    : `\n${failures} check(s) failed\n`,
);
process.exit(failures === 0 ? 0 : 1);
