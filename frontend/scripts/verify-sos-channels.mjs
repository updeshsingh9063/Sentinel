/**
 * Prove the two no-app emergency channels: a missed call, and a text.
 *
 * These are the only controls in the product a senior can reach without
 * opening anything, which makes them the ones most likely to be used and the
 * ones where a silent failure is worst. The checks that matter are the
 * refusals: an unknown number must raise nothing, a wrong secret must raise
 * nothing, and neither must be told why.
 *
 * NOTHING HERE DIALS, and that is enforced rather than hoped for: every
 * missed-call probe carries `nocall=1`. An earlier version of this file said
 * the same thing and was wrong -- the route rings the senior back, so each
 * probe placed a real call and the person running it was telephoned four
 * times. Claiming a test is harmless is not the same as making it harmless.
 *
 * Usage, from frontend/:
 *   node scripts/verify-sos-channels.mjs
 *   VERIFY_SITE=https://samarth-sentinel.vercel.app node scripts/verify-sos-channels.mjs
 */

import fs from "node:fs";
import path from "node:path";

import pg from "pg";

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
const SITE = ENV.VERIFY_SITE || "http://localhost:3000";

let failures = 0;
function check(label, ok, detail) {
  if (ok) console.log(`  PASS  ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${label}  -> ${detail}`);
  }
}

const db = new pg.Client({
  host: ENV.SUPABASE_DB_HOST,
  port: Number(ENV.SUPABASE_DB_PORT || 5432),
  database: ENV.SUPABASE_DB_NAME || "postgres",
  user: ENV.SUPABASE_DB_USER || "postgres",
  password: ENV.SUPABASE_DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
});
await db.connect();

// WHICH SENIOR AN INBOUND CALL RESOLVES TO IS NOT THE DEMO LINE. A missed
// call carries only a number, and a number may belong to a household: the
// system resolves it to the OLDEST record on that handset. Asserting against
// the demo line made this suite report four product failures that were
// failures in the test -- the alarm was raised correctly, for somebody else.
const handset = (await db.query("select phone from seniors where demo_line limit 1")).rows[0];
const line = (
  await db.query(
    `select id, display_name, phone from seniors
      where is_active
        and regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')
            like '%' || right(regexp_replace($1, '[^0-9]', '', 'g'), 10)
      order by created_at limit 1`,
    [handset.phone],
  )
).rows[0];

/** Back to nothing outstanding, so a first press means a first press. */
async function reset() {
  await db.query(
    "update assistance_requests set state = 'cancelled' where senior_id = $1 and kind = 'emergency' and state in ('open','arranged')",
    [line.id],
  );
  await db.query("delete from family_notifications where senior_id = $1 and kind = 'emergency'", [line.id]);
  await db.query("delete from alerts where senior_id = $1 and raised_on = current_date and score = 1", [line.id]);
}

/**
 * Every missed-call probe carries `nocall=1`.
 *
 * WITHOUT IT THIS SUITE RINGS A REAL TELEPHONE, once per probe. The header
 * above claimed it did not dial; that was true of the assertions and false of
 * the route, and it rang somebody four times before anyone noticed. The
 * callback is covered by reading what the route reports, not by placing one.
 */
const post = (p, fields, headers = {}) =>
  fetch(`${SITE}${p}${p.includes("missed-call") ? (p.includes("?") ? "&" : "?") + "nocall=1" : ""}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(fields).toString(),
  });

const openCount = async () =>
  (
    await db.query(
      "select count(*)::int as n from assistance_requests where senior_id = $1 and kind = 'emergency' and state = 'open'",
      [line.id],
    )
  ).rows[0].n;

// notify_family walks family_links and checks the consent scope, so a senior
// with neither gets no message and the system is right to send none. That is
// an empty address book, not a broken escalation, so the path is set up here
// rather than asserted around.
await db.query(
  `insert into family_links (family_user_id, senior_id, relationship, is_primary)
   select u.id, $1, 'family member', true from app_users u where u.role = 'family' limit 1
   on conflict do nothing`,
  [line.id],
);
await db.query(
  `insert into consents (senior_id, scope, granted, granted_at, granted_by)
   values ($1, 'urgent_call', true, now(), 'verify')
   on conflict (senior_id, scope) do update set granted = true`,
  [line.id],
);
await db.query(
  `update app_users set phone = coalesce(phone, '+919000000001')
    where id in (select coordinator_id from care_assignments where senior_id = $1)`,
  [line.id],
);

console.log(`\nverifying the no-app emergency channels against ${SITE}\n`);
check("there is a demo line", !!line?.phone, JSON.stringify(line));

// ---- 1. a missed call ------------------------------------------------------
console.log("a missed call to the help line");
await reset();

const missed = await post("/api/sos/missed-call", { From: line.phone, CallSid: "CAsosprobe" });
check("the webhook answers 200, whatever happened", missed.status === 200, `status=${missed.status}`);

// A telephony provider must be told to reject, so the caller is never charged.
const asTwilio = await post(
  "/api/sos/missed-call",
  { From: line.phone, CallSid: "CAsosprobe2" },
  { "User-Agent": "TwilioProxy/1.1" },
);
const twiml = await asTwilio.text();
check("a telephony provider is told to reject the call", /<Reject/.test(twiml), twiml.slice(0, 120));
check("so the senior is never charged for it", !/<Say|<Gather/.test(twiml), twiml.slice(0, 120));

check("the emergency is on the coordinator's queue", (await openCount()) >= 1, "no open emergency");

const alert = (
  await db.query("select rank_in_day, score from alerts where senior_id = $1 and raised_on = current_date", [line.id])
).rows[0];
check("and at the top of today's list", alert?.rank_in_day === 0 && Number(alert?.score) === 1, JSON.stringify(alert));

const toCoord = (
  await db.query(
    "select count(*)::int as n from family_notifications where senior_id = $1 and kind = 'emergency' and recipient = 'coordinator'",
    [line.id],
  )
).rows[0].n;
check("the coordinator is messaged", toCoord >= 1, String(toCoord));

const toFamily = (
  await db.query(
    "select count(*)::int as n from family_notifications where senior_id = $1 and kind = 'emergency' and recipient = 'family'",
    [line.id],
  )
).rows[0].n;
check("the family is warned", toFamily >= 1, String(toFamily));

const shared = (
  await db.query(
    `select count(*)::int as n from seniors
      where is_active
        and regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')
            like '%' || right(regexp_replace($1, '[^0-9]', '', 'g'), 10)`,
    [handset.phone],
  )
).rows[0].n;
if (shared > 1) {
  // A coordinator ringing back must not be told a name the system guessed at
  // without being told it guessed.
  const summary = (
    await db.query(
      "select summary from assistance_requests where senior_id = $1 and kind = 'emergency' and state = 'open' limit 1",
      [line.id],
    )
  ).rows[0]?.summary;
  check(
    "a shared handset says so on the errand, rather than naming one person silently",
    /shared by \d+ people/.test(summary ?? ""),
    summary,
  );
}

// ---- 2. a number nobody knows ----------------------------------------------
console.log("\na number nobody knows");
const before = await openCount();
const stranger = await post("/api/sos/missed-call", { From: "+15550001111" });
const strangerBody = await stranger.text();
check("is answered politely", stranger.status === 200, `status=${stranger.status}`);
check("raises nothing", (await openCount()) === before, "an emergency was raised for a stranger");
check(
  "and is told nothing about the service",
  !/senior|coordinator|samarth|alert/i.test(strangerBody),
  strangerBody.slice(0, 120),
);

// ---- 3. a wrong secret -----------------------------------------------------
await reset();
const badKey = await post("/api/sos/missed-call?key=definitely-wrong", { From: line.phone });
check("a wrong secret is answered 200, not an error page", badKey.status === 200, `status=${badKey.status}`);
check("and raises nothing", (await openCount()) === 0, "an emergency was raised without the secret");

// ---- 4. a text -------------------------------------------------------------
console.log("\na text to the help line");
await reset();

const sms = await post("/api/sos/sms", { From: line.phone, Body: "madad" });
const smsBody = await sms.text();
check("the text raises the emergency", (await openCount()) >= 1, "nothing raised");
check("and the sender gets an answer", /<Message>/.test(smsBody), smsBody.slice(0, 160));
check(
  "which promises a person, not an ambulance",
  !/ambulance|108/i.test(smsBody),
  smsBody.slice(0, 200),
);

// Anything at all counts, not only the documented keyword: somebody in
// trouble types whatever comes out, not the word in the manual.
await reset();
await post("/api/sos/sms", { From: line.phone, Body: "beta mujhe bahut ghabrahat ho rahi hai" });
check("any message counts, not just the keyword", (await openCount()) >= 1, "free text did not raise it");

// ---- 5. a reply to our own reminder ----------------------------------------
await reset();
await post("/api/sos/sms", { From: line.phone, Body: "ok" });
check("a bare ok does not raise an emergency", (await openCount()) === 0, "ok raised an alarm");
await post("/api/sos/sms", { From: line.phone, Body: "ठीक है" });
check("nor does theek hai in Devanagari", (await openCount()) === 0, "an acknowledgement raised an alarm");

// ---- 6. WhatsApp prefixes --------------------------------------------------
await reset();
await post("/api/sos/sms", { From: `whatsapp:${line.phone}`, Body: "help" });
check("a WhatsApp sender is recognised despite the prefix", (await openCount()) >= 1, "prefix not stripped");

// ---- tidy ------------------------------------------------------------------
await reset();
await db.end();

console.log(failures === 0 ? "\nthe emergency channels hold\n" : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
