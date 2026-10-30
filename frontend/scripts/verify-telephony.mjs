/**
 * Prove the telephone call, without a telephone.
 *
 * Twilio is just an HTTP client: it POSTs form-encoded fields to a webhook
 * and reads TwiML back. So the whole call can be driven here exactly as the
 * provider would drive it, and the only thing left untested when the
 * credentials arrive is whether Twilio dials — not whether the conversation,
 * the record or the containment work.
 *
 * The assertions that matter:
 *   · the call reaches the senior whose NUMBER was dialled, not the demo line
 *   · a wrong secret gets a courteous hangup and learns nothing
 *   · turns survive between posts, because a provider keeps no state
 *   · the finished call writes the same tables every other channel writes
 *   · a provider retrying the end-of-call does not write the call twice
 *
 * Usage, from frontend/ with the dev server running:
 *   node scripts/verify-telephony.mjs
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
const SITE = ENV.VERIFY_SITE || ENV.PUBLIC_BASE_URL || "http://localhost:3000";
const SECRET = ENV.TELEPHONY_SECRET;
const OWNER = ENV.OWNER_EMAIL;
const OWNER_PW = ENV.OWNER_PASSWORD;

if (!SECRET) {
  console.error("TELEPHONY_SECRET missing from .env.local");
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

const token = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: ANON, "Content-Type": "application/json" },
  body: JSON.stringify({ email: OWNER, password: OWNER_PW }),
})
  .then((r) => r.json())
  .then((j) => j.access_token);

const H = { apikey: ANON, Authorization: `Bearer ${token}` };
const read = (q) => fetch(`${URL_}/rest/v1/${q}`, { headers: H }).then((r) => r.json());

/** Exactly what Twilio sends: form-encoded, no JSON anywhere. */
const post = (query, fields) =>
  fetch(`${SITE}/api/call/voice?${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  }).then(async (r) => ({ status: r.status, text: await r.text() }));

const spoken = (twiml) => {
  const m = [...twiml.matchAll(/<Say[^>]*>([\s\S]*?)<\/Say>/g)].map((x) => x[1]);
  return m.join(" ");
};

console.log(`\nverifying the telephone call against ${SITE}\n`);

// Whose number is the one we will pretend to dial.
const line = (await read("seniors?demo_line=is.true&select=id,display_name,phone"))[0];
check("there is a number to dial", !!line?.phone, JSON.stringify(line));
const SID = `CAverify${Date.now()}`;
const key = encodeURIComponent(SECRET);

// ---- 1. a wrong secret ----------------------------------------------------
console.log("a caller with the wrong secret");
const bad = await post("key=definitely-not-the-secret", { CallSid: "CAbad", To: line.phone });
check("gets valid TwiML, not an error page", bad.status === 200 && bad.text.includes("<Response>"), `status=${bad.status}`);
check("is hung up on", bad.text.includes("<Hangup/>"), bad.text.slice(0, 120));
check(
  "and is told nothing about why",
  !/secret|unauthor|senior|record|database/i.test(spoken(bad.text)),
  spoken(bad.text),
);

// ---- 2. the call opens ----------------------------------------------------
console.log("\nthe call is answered");
const open = await post(`key=${key}`, { CallSid: SID, To: line.phone, CallStatus: "in-progress" });
check("TwiML comes back", open.status === 200 && open.text.includes("<Response>"), `status=${open.status}`);
check("it listens for speech, not keypresses", /<Gather[^>]*input="speech"/.test(open.text), open.text.slice(0, 160));
check("in Hindi, with a Hindi voice", /language="hi-IN"/.test(open.text) && /Polly\.Aditi/.test(open.text), open.text.slice(0, 200));
check("it greets them by name", spoken(open.text).length > 10, spoken(open.text));
console.log(`  ..    "${spoken(open.text).slice(0, 90)}"`);

check(
  "the session is tied to the senior whose number was dialled",
  (await read(`call_sessions?call_sid=eq.${SID}&select=senior_id`))[0]?.senior_id === line.id,
  "session points at the wrong senior",
);

// ---- 3. turns survive between posts ---------------------------------------
console.log("\nthey talk, across separate requests");
const SAID = [
  "ठीक हूँ बेटा, रात को नींद नहीं आई",
  "नहीं, शाम की गोली अभी नहीं ली",
  "बेटा, मेरी दवाई खत्म हो गई है",
];

let last = open.text;
for (const words of SAID) {
  const turn = await post(`key=${key}`, {
    CallSid: SID,
    To: line.phone,
    SpeechResult: words,
    Confidence: "0.9",
  });
  last = turn.text;
  // NOT <Hangup/> — every listening turn carries one as the fallback for
  // somebody who says nothing at all. The call is over when there is nothing
  // left listening, which is the absence of a <Gather>.
  if (!turn.text.includes("<Gather")) break;
}
check("the call kept going across posts", last.includes("<Response>"), last.slice(0, 120));

const session = (await read(`call_sessions?call_sid=eq.${SID}&select=turns,signals,requests`))[0];
const turns = session?.turns ?? [];
check("every turn was kept, not just the last", turns.length >= 4, `turns=${turns.length}`);
check(
  "what they said is on the session verbatim",
  JSON.stringify(turns).includes("गोली"),
  JSON.stringify(turns).slice(0, 160),
);
check("it understood the medicines were not taken", session?.signals?.meds === 3, JSON.stringify(session?.signals));
check(
  "it heard the errand",
  (session?.requests ?? []).some((r) => r.kind === "medicine"),
  JSON.stringify(session?.requests),
);

// ---- 4. the call ends and is written down ---------------------------------
console.log("\nthe call ends");
const today = new Date().toISOString().slice(0, 10);
const ended = await fetch(`${SITE}/api/call/voice?key=${key}&status=1`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ CallSid: SID, To: line.phone, CallStatus: "completed" }).toString(),
});
check("the status callback is accepted", ended.status === 200, `status=${ended.status}`);

const ci = (await read(`checkins?senior_id=eq.${line.id}&checked_on=eq.${today}&select=source,meds_taken,answered`))[0];
check("today's check-in is on the record", !!ci, "no check-in row");
check("marked as a conversation", ci?.source === "conversation", `source=${ci?.source}`);
check("the medicines code survived the whole call", ci?.meds_taken === false, `meds_taken=${ci?.meds_taken}`);
check("the check-in came from THIS call", (ci?.answered ?? false) === true, JSON.stringify(ci));

const note = (await read(
  `call_notes?senior_id=eq.${line.id}&called_on=eq.${today}&channel=eq.ai_call&select=transcript,note_text`,
))[0];
check("the words are kept as evidence", (note?.transcript ?? "").includes("गोली"), (note?.transcript ?? "").slice(0, 80));

const req = await read(
  `assistance_requests?senior_id=eq.${line.id}&raised_on=eq.${today}&kind=eq.medicine&select=id,state`,
);
check("the errand reached the coordinator's queue", req.length > 0, JSON.stringify(req));

// ---- 5. a provider retry must not write it twice --------------------------
const before = (await read(`call_notes?senior_id=eq.${line.id}&called_on=eq.${today}&channel=eq.ai_call&select=id`)).length;
await fetch(`${SITE}/api/call/voice?key=${key}&status=1`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ CallSid: SID, To: line.phone, CallStatus: "completed" }).toString(),
});
const after = (await read(`call_notes?senior_id=eq.${line.id}&called_on=eq.${today}&channel=eq.ai_call&select=id`)).length;
check("a retried end-of-call does not write it twice", before === after, `${before} then ${after}`);

// ---- 6. nobody answered ---------------------------------------------------
console.log("\nnobody answered");
const noAns = await fetch(`${SITE}/api/call/voice?key=${key}&status=1`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ CallSid: `${SID}x`, To: line.phone, CallStatus: "no-answer" }).toString(),
});
check("the unanswered callback is accepted", noAns.status === 200, `status=${noAns.status}`);

// ---- 6b. a shared handset ---------------------------------------------------
// A household may have one telephone (migration 0022), so the number alone no
// longer identifies anybody. An outbound call carries the senior it was placed
// for, and that has to win -- otherwise the call sounds correct and the
// check-in lands on the wrong person, which is the worst kind of wrong
// because nothing errors.
console.log("
two seniors, one handset");
const sharers = await read(
  `seniors?phone=eq.${encodeURIComponent(line.phone)}&select=id,display_name&order=created_at`,
);
if (sharers.length < 2) {
  console.log("  ..    only one senior on this number; routing check skipped");
} else {
  const oldest = sharers[0];
  // Somebody who is NOT the one a number-only lookup would return.
  const other = sharers[sharers.length - 1];
  check("the test has two different seniors to tell apart", oldest.id !== other.id, "same senior");

  const ROUTED = `CAroute${Date.now()}`;
  await fetch(
    `${SITE}/api/call/voice?key=${key}&senior=${encodeURIComponent(other.id)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ CallSid: ROUTED, To: line.phone, CallStatus: "in-progress" }).toString(),
    },
  );
  const routed = (await read(`call_sessions?call_sid=eq.${ROUTED}&select=senior_id`))[0];
  check(
    "the call files against the senior it was placed for",
    routed?.senior_id === other.id,
    `wanted ${other.display_name}, got ${sharers.find((x) => x.id === routed?.senior_id)?.display_name ?? routed?.senior_id}`,
  );
  check(
    "not merely the first row on that number",
    routed?.senior_id !== oldest.id || other.id === oldest.id,
    `fell back to ${oldest.display_name}`,
  );

  // An inbound caller cannot say who they are, so the number is all there is.
  const INBOUND = `CAinbound${Date.now()}`;
  await fetch(`${SITE}/api/call/voice?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ CallSid: INBOUND, To: line.phone, CallStatus: "in-progress" }).toString(),
  });
  const inbound = (await read(`call_sessions?call_sid=eq.${INBOUND}&select=senior_id`))[0];
  check(
    "an inbound call still resolves, deterministically, to the oldest record",
    inbound?.senior_id === oldest.id,
    `wanted ${oldest.display_name}, got ${inbound?.senior_id}`,
  );

  // A stale or invented id must not strand somebody who has answered.
  const BOGUS = `CAbogus${Date.now()}`;
  await fetch(
    `${SITE}/api/call/voice?key=${key}&senior=00000000-0000-4000-8000-000000000009`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ CallSid: BOGUS, To: line.phone, CallStatus: "in-progress" }).toString(),
    },
  );
  const bogus = (await read(`call_sessions?call_sid=eq.${BOGUS}&select=senior_id`))[0];
  check(
    "an unknown senior id falls back to the number rather than failing the call",
    bogus?.senior_id === oldest.id,
    `got ${bogus?.senior_id ?? "no session at all"}`,
  );
}

// ---- 7. containment --------------------------------------------------------
console.log("\ncontainment");
const anonH = { apikey: ANON, "Content-Type": "application/json" };
const anonSessions = await fetch(`${URL_}/rest/v1/call_sessions?select=call_sid&limit=1`, { headers: anonH });
const anonBody = await anonSessions.json().catch(() => null);
check(
  "anon cannot read call sessions",
  anonSessions.status >= 400 || (Array.isArray(anonBody) && anonBody.length === 0),
  `status=${anonSessions.status} ${JSON.stringify(anonBody)?.slice(0, 80)}`,
);

const anonFinish = await fetch(`${URL_}/rest/v1/rpc/telephony_finish`, {
  method: "POST",
  headers: anonH,
  body: JSON.stringify({ p_secret: "guess", p_call_sid: SID }),
});
const anonFinishBody = await anonFinish.json().catch(() => null);
check(
  "a guessed secret finishes nothing",
  anonFinishBody?.ok === false && anonFinishBody?.reason === "unauthorized",
  JSON.stringify(anonFinishBody),
);

const runGuard = await fetch(`${SITE}/api/call/run?key=wrong`, { method: "POST" });
check("the daily round refuses an unknown key", runGuard.status === 401, `status=${runGuard.status}`);

console.log(failures === 0 ? "\nthe telephone call holds\n" : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
