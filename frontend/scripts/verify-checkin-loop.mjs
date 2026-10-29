/**
 * Prove the check-in loop: the senior answers, the coordinator sees it.
 *
 * Until now the simulator told the caller "your answers have reached the
 * coordinator" and wrote nothing. The sentence is what a senior hears on a
 * real call, but on a screen it was a claim the product had not earned. This
 * asserts the claim is now true, by writing through exactly the path the
 * public page uses -- the anon key, no session -- and reading the result back
 * as the coordinator.
 *
 * It also asserts the containment that makes a public write safe at all: the
 * function takes no senior id, so there is no payload that reaches anybody
 * other than the one senior flagged as the demo line.
 *
 * Usage, from frontend/:
 *   node scripts/verify-checkin-loop.mjs
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
const PASSWORD = ENV.DEMO_PASSWORD || "SamarthDemo!2026";

if (!URL_ || !ANON) {
  console.error("need NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY");
  process.exit(1);
}

let failures = 0;
function check(label, ok, detail) {
  if (ok) console.log(`  PASS  ${label}`);
  else { failures += 1; console.log(`  FAIL  ${label}  -> ${detail}`); }
}

/** Exactly what the browser does on the public page: anon key, no session. */
const asPublic = (args) =>
  fetch(`${URL_}/rest/v1/rpc/record_demo_checkin`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

const signIn = (role) =>
  fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: `${role}@samarth.demo`, password: PASSWORD }),
  }).then((r) => r.json()).then((j) => j.access_token ?? null);

console.log(`\nverifying the check-in loop against ${URL_}\n`);

// ---- 1. the public page can file a call ----------------------------------
console.log("the senior answers (anon, no session)");
const filed = await asPublic({
  p_feeling: 3, p_pain: 3, p_meds: 3, p_sleep: 3, p_appetite: 3, p_fall: 2,
});
check("the call is accepted", filed.body?.ok === true, JSON.stringify(filed.body));
check("it names whose record it went to", !!filed.body?.senior_name, JSON.stringify(filed.body));
const seniorId = filed.body?.senior_id;
const seniorName = filed.body?.senior_name;
if (seniorName) console.log(`  ..    filed to ${seniorName}`);

// ---- 2. it cannot be pointed at anyone else ------------------------------
console.log("\ncontainment");
{
  // There is no senior id in the signature, so the obvious attack has no
  // parameter to use. PostgREST refuses an unknown argument outright.
  const r = await fetch(`${URL_}/rest/v1/rpc/record_demo_checkin`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ p_senior_id: "00000000-0000-0000-0000-000000000000", p_feeling: 1 }),
  });
  check("there is no senior id to pass", r.status >= 400, `status=${r.status}`);

  // And the flag it does use is on exactly one row.
  const token = await signIn("coordinator");
  const flagged = await fetch(
    `${URL_}/rest/v1/seniors?demo_line=is.true&select=id,display_name`,
    { headers: { apikey: ANON, Authorization: `Bearer ${token}` } },
  ).then((r) => r.json());
  check("exactly one senior is the demo line", flagged.length === 1, `count=${flagged.length}`);
  check("it is the one that was written to", flagged[0]?.id === seniorId,
        `${flagged[0]?.id} vs ${seniorId}`);

  // Writing it must not have made the whole table writable.
  const direct = await fetch(`${URL_}/rest/v1/checkins`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ senior_id: seniorId, checked_on: "2020-01-01", answered: true }),
  });
  check("anon still cannot insert into checkins directly", direct.status >= 400,
        `status=${direct.status}`);
}

// ---- 3. the coordinator sees it ------------------------------------------
console.log("\nthe coordinator sees it");
{
  const token = await signIn("coordinator");
  const today = new Date().toISOString().slice(0, 10);
  const rows = await fetch(
    `${URL_}/rest/v1/checkins?senior_id=eq.${seniorId}&checked_on=eq.${today}` +
      "&select=answered,source,feeling_code,pain_code,meds_taken,sleep_code,appetite_code,fall_code",
    { headers: { apikey: ANON, Authorization: `Bearer ${token}` } },
  ).then((r) => r.json());

  check("today's check-in is there", rows.length === 1, `rows=${rows.length}`);
  const row = rows[0] ?? {};
  check("marked answered", row.answered === true, JSON.stringify(row));
  // All six, not the three the table used to have room for. Sleep, appetite
  // and falls were being collected and dropped before migration 0013.
  check("all six answers survived",
        row.feeling_code === 3 && row.pain_code === 3 && row.meds_taken === false &&
        row.sleep_code === 3 && row.appetite_code === 3 && row.fall_code === 2,
        JSON.stringify(row));

  // Re-filing the same day corrects the record rather than duplicating it,
  // which is what happens when a senior calls back having pressed wrong.
  await asPublic({ p_feeling: 1, p_pain: 1, p_meds: 1, p_sleep: 1, p_appetite: 1, p_fall: 1 });
  const after = await fetch(
    `${URL_}/rest/v1/checkins?senior_id=eq.${seniorId}&checked_on=eq.${today}&select=feeling_code`,
    { headers: { apikey: ANON, Authorization: `Bearer ${token}` } },
  ).then((r) => r.json());
  check("calling back corrects rather than duplicates",
        after.length === 1 && after[0]?.feeling_code === 1, JSON.stringify(after));
}

// ---- 4. the family still cannot read it ----------------------------------
console.log("\nand the family still cannot");
{
  const token = await signIn("family");
  const rows = await fetch(`${URL_}/rest/v1/checkins?select=*`, {
    headers: { apikey: ANON, Authorization: `Bearer ${token}` },
  }).then((r) => r.json());
  check("family reads no check-in rows", Array.isArray(rows) && rows.length === 0,
        JSON.stringify(rows).slice(0, 120));
}

console.log(failures ? `\n${failures} FAILURE(S)\n` : "\nthe check-in loop holds\n");
process.exit(failures ? 1 : 0);
