/**
 * Prove the missed-call check-in channel, end to end.
 *
 * The claim is that a senior can check in by dialling and hanging up, that
 * the resulting record is marked as the thin signal it is, and that nobody
 * without the shared secret can write one. All three are testable, so none of
 * them is left as prose.
 *
 * Uses the publishable anon key only — no service role — because that is the
 * credential the deployment actually has. If this passes, the deployed route
 * can do no more and no less.
 *
 * Usage, from frontend/:
 *   node scripts/verify-missed-call.mjs [--url https://your-deployment]
 *
 * With --url it also posts to the live webhook the way a telephony provider
 * would, form-encoded, to catch a route that works locally and 500s in
 * production.
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
const SECRET = ENV.CHECKIN_WEBHOOK_SECRET;
const PASSWORD = ENV.DEMO_PASSWORD || "SamarthDemo!2026";
const argUrl = process.argv.indexOf("--url");
const DEPLOY = argUrl > -1 ? process.argv[argUrl + 1].replace(/\/$/, "") : null;

if (!URL_ || !ANON || !SECRET) {
  console.error("need NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, CHECKIN_WEBHOOK_SECRET");
  process.exit(1);
}

let failures = 0;
function check(label, ok, detail) {
  if (ok) console.log(`  PASS  ${label}`);
  else { failures += 1; console.log(`  FAIL  ${label}  -> ${detail}`); }
}

async function rpc(secret, phone) {
  const r = await fetch(`${URL_}/rest/v1/rpc/record_missed_call`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ p_secret: secret, p_phone: phone }),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

async function signIn(role) {
  const r = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: `${role}@samarth.demo`, password: PASSWORD }),
  });
  return (await r.json()).access_token ?? null;
}

console.log(`\nverifying the missed-call channel against ${URL_}\n`);

// ---- 1. the secret store is unreachable ----------------------------------
console.log("the shared secret");
{
  const r = await fetch(`${URL_}/rest/v1/checkin_webhook_keys?select=*`, { headers: { apikey: ANON } });
  check("anon cannot read checkin_webhook_keys", r.status >= 400, `status=${r.status}`);
  const token = await signIn("coordinator");
  const r2 = await fetch(`${URL_}/rest/v1/checkin_webhook_keys?select=*`, {
    headers: { apikey: ANON, Authorization: `Bearer ${token}` },
  });
  check("a signed-in coordinator cannot read it either", r2.status >= 400, `status=${r2.status}`);
}

// ---- 2. nobody writes without the secret ---------------------------------
console.log("\nwithout the secret");
{
  const a = await rpc("", "+919000000001");
  check("empty secret is refused", a.body?.reason === "unauthorized", JSON.stringify(a.body));
  const b = await rpc("mc_not_the_real_secret_at_all", "+919000000001");
  check("wrong secret is refused", b.body?.reason === "unauthorized", JSON.stringify(b.body));
  // An attacker without the secret must not be able to tell an enrolled
  // number from an unenrolled one, or the endpoint becomes a membership
  // oracle for a list of vulnerable people.
  const c = await rpc("mc_not_the_real_secret_at_all", "+910000000000");
  check("refusal does not reveal whether a number is enrolled",
        c.body?.reason === b.body?.reason, `${c.body?.reason} vs ${b.body?.reason}`);
}

// ---- 3. a real missed call is recorded, and marked as thin ---------------
console.log("\nwith the secret");
{
  const token = await signIn("coordinator");
  // Not the demo line. That senior is the one the public check-in simulator
  // writes to, so they may already carry a full set of answers for today --
  // and a missed call is REQUIRED not to overwrite those. Testing the thin
  // case on them would be testing two rules at once and failing on the wrong
  // one. The no-downgrade rule gets its own check below.
  const list = await fetch(
    `${URL_}/rest/v1/seniors?select=id,display_name,phone&phone=not.is.null&demo_line=is.false&limit=1`,
    { headers: { apikey: ANON, Authorization: `Bearer ${token}` } },
  );
  const [senior] = await list.json();
  if (!senior) {
    check("a senior with a phone number exists", false, "none found — migration 0012 did not run");
  } else {
    // Named here and nowhere else. The webhook's own reply must not carry a
    // name; this script is run by someone already signed in as the
    // coordinator who carries this senior, and they need to know which record
    // to go and look at.
    console.log(`  ..    dialling in as ${senior.display_name} (${senior.phone})`);
    const ok = await rpc(SECRET, senior.phone);
    check("the call is accepted", ok.body?.ok === true, JSON.stringify(ok.body));
    check("the channel is named in the reply", ok.body?.channel === "missed_call", JSON.stringify(ok.body));
    check("the reply carries no name or id",
          !JSON.stringify(ok.body ?? {}).includes(senior.id) &&
          !JSON.stringify(ok.body ?? {}).includes(senior.display_name),
          JSON.stringify(ok.body));

    // Idempotent: a provider retrying is not three check-ins.
    await rpc(SECRET, senior.phone);
    const today = new Date().toISOString().slice(0, 10);
    const rows = await fetch(
      `${URL_}/rest/v1/checkins?senior_id=eq.${senior.id}&checked_on=eq.${today}&select=answered,source,feeling_code,pain_code,meds_taken`,
      { headers: { apikey: ANON, Authorization: `Bearer ${token}` } },
    ).then((r) => r.json());
    check("exactly one row for today", rows.length === 1, `rows=${rows.length}`);
    check("recorded as answered", rows[0]?.answered === true, JSON.stringify(rows[0]));
    check("recorded as source=missed_call", rows[0]?.source === "missed_call", JSON.stringify(rows[0]));
    // The whole reason `source` exists: a dial-and-hang-up must not be stored
    // as if the senior had answered questions about pain or medication.
    check("carries no answers it never collected",
          rows[0] && rows[0].feeling_code === null && rows[0].pain_code === null && rows[0].meds_taken === null,
          JSON.stringify(rows[0]));
  }

  // A MISSED CALL MUST NEVER REPLACE A FULLER RECORD. If a senior answered
  // six questions this morning and dialled in again this afternoon, the
  // afternoon call is not new information and overwriting the morning with it
  // would delete the only real answers of the day.
  {
    const demo = await fetch(
      `${URL_}/rest/v1/seniors?demo_line=is.true&select=id,phone`,
      { headers: { apikey: ANON, Authorization: `Bearer ${token}` } },
    ).then((r) => r.json());

    if (demo[0]?.phone) {
      // Full answers first, through the public check-in path...
      await fetch(`${URL_}/rest/v1/rpc/record_demo_checkin`, {
        method: "POST",
        headers: { apikey: ANON, "Content-Type": "application/json" },
        body: JSON.stringify({ p_feeling: 2, p_pain: 2, p_meds: 1, p_sleep: 2, p_appetite: 2, p_fall: 1 }),
      });
      // ...then a missed call from the same number.
      await rpc(SECRET, demo[0].phone);

      const today = new Date().toISOString().slice(0, 10);
      const [row] = await fetch(
        `${URL_}/rest/v1/checkins?senior_id=eq.${demo[0].id}&checked_on=eq.${today}&select=source,feeling_code`,
        { headers: { apikey: ANON, Authorization: `Bearer ${token}` } },
      ).then((r) => r.json());
      check("a missed call does not overwrite a fuller record",
            row?.source === "ivr" && row?.feeling_code === 2, JSON.stringify(row));
    }
  }

  const unknown = await rpc(SECRET, "+919999999999");
  check("an unenrolled number is rejected", unknown.body?.reason === "unknown_number", JSON.stringify(unknown.body));
  const junk = await rpc(SECRET, "12");
  check("a malformed number is rejected", junk.body?.reason === "bad_number", JSON.stringify(junk.body));
}

// ---- 4. the deployed webhook, shaped like a real provider ----------------
if (DEPLOY) {
  console.log(`\nthe live webhook at ${DEPLOY}`);
  const token = await signIn("coordinator");
  const [senior] = await fetch(
    `${URL_}/rest/v1/seniors?select=phone&phone=not.is.null&limit=1`,
    { headers: { apikey: ANON, Authorization: `Bearer ${token}` } },
  ).then((r) => r.json());

  const bad = await fetch(`${DEPLOY}/api/checkin/missed-call`, {
    method: "POST",
    headers: { "x-checkin-secret": "nope", "Content-Type": "application/json" },
    body: JSON.stringify({ from: senior?.phone ?? "+919000000001" }),
  });
  check("no secret -> 401", bad.status === 401, `status=${bad.status}`);

  // Form-encoded, which is how Exotel and Twilio actually post.
  const good = await fetch(`${DEPLOY}/api/checkin/missed-call`, {
    method: "POST",
    headers: { "x-checkin-secret": SECRET, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ CallFrom: senior?.phone ?? "" }),
  });
  check("form-encoded provider post -> 200", good.status === 200, `status=${good.status}`);
}

console.log(failures ? `\n${failures} FAILURE(S)\n` : "\nthe missed-call channel holds\n");
process.exit(failures ? 1 : 0);
