/**
 * Prove the access rules, by querying as each role exactly as a browser does.
 *
 * WHY THIS EXISTS AS A SCRIPT. The privacy claims are the ones a reviewer is
 * most entitled to disbelieve, and "we wrote a policy" is not evidence. These
 * checks sign in with the real demo credentials, go through PostgREST with the
 * publishable anon key, and assert what each role can actually read. A failure
 * here means the product is lying about something, so the script exits
 * non-zero and names the row it got back.
 *
 * It reads nothing but the anon key and the demo password — no service role —
 * because that is the whole point: if these tables were readable, they would
 * be readable exactly this way.
 *
 * Usage, from frontend/:
 *   node scripts/verify-access.mjs [--url https://your-deployment]
 *
 * With no --url it tests the Supabase project directly, which is where the
 * rules live. The deployed app cannot be more permissive than this.
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
const tokens = new Map();

async function signIn(role) {
  if (tokens.has(role)) return tokens.get(role);
  const r = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: `${role}@samarth.demo`, password: PASSWORD }),
  });
  const j = await r.json();
  if (!j.access_token) {
    console.error(`  cannot sign in as ${role}: ${JSON.stringify(j).slice(0, 140)}`);
    failures += 1;
    return null;
  }
  tokens.set(role, j.access_token);
  return j.access_token;
}

/** Row count for a table/view as a given role. `null` means the role is anon. */
async function countAs(role, query) {
  const headers = { apikey: ANON, Prefer: "count=exact", Range: "0-0" };
  if (role) {
    const token = await signIn(role);
    if (!token) return { status: 0, count: null };
    headers.Authorization = `Bearer ${token}`;
  }
  const r = await fetch(`${URL_}/rest/v1/${query}`, { headers });
  const range = r.headers.get("content-range") || "";
  const count = Number(range.split("/")[1]);
  return { status: r.status, count: Number.isFinite(count) ? count : null };
}

function check(label, ok, detail) {
  if (ok) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}  -> ${detail}`);
  }
}

console.log(`\nverifying access rules against ${URL_}\n`);

// ---- 1. anon sees nothing ------------------------------------------------
console.log("anon (publishable key, no session)");
for (const table of [
  "seniors", "vitals", "call_notes", "note_cues", "risk_scores",
  "alerts", "checkins", "medication_logs", "family_summaries",
]) {
  const { count } = await countAs(null, `${table}?select=*`);
  check(`${table} returns no rows`, count === 0 || count === null, `count=${count}`);
}
for (const view of ["ops_daily_metrics", "family_checkin_days"]) {
  const { status, count } = await countAs(null, `${view}?select=*`);
  check(
    `${view} is refused or empty`,
    status === 401 || status === 403 || count === 0,
    `status=${status} count=${count}`,
  );
}

// ---- 2. family sees prose, never readings --------------------------------
console.log("\nfamily@samarth.demo");
for (const table of ["vitals", "call_notes", "note_cues", "risk_scores", "checkins", "alerts"]) {
  const { count } = await countAs("family", `${table}?select=*`);
  check(`${table} returns no rows`, count === 0, `count=${count}`);
}
{
  const { count } = await countAs("family", "family_summaries?select=*");
  check("family_summaries is readable", count > 0, `count=${count}`);
  const days = await countAs("family", "family_checkin_days?select=*");
  check("family_checkin_days is readable", days.count > 0, `count=${days.count}`);
  const seniors = await countAs("family", "seniors?select=*");
  check("sees exactly their linked senior", seniors.count === 1, `count=${seniors.count}`);
}

// ---- 3. ops sees aggregates only -----------------------------------------
console.log("\nops@samarth.demo");
for (const table of ["seniors", "vitals", "risk_scores", "alerts", "call_notes"]) {
  const { count } = await countAs("ops", `${table}?select=*`);
  check(`${table} returns no rows`, count === 0, `count=${count}`);
}
{
  const { count } = await countAs("ops", "ops_daily_metrics?select=*");
  check("ops_daily_metrics is readable", count > 0, `count=${count}`);
}

// ---- 4. coordinator sees their caseload and no more -----------------------
console.log("\ncoordinator@samarth.demo");
{
  const mine = await countAs("coordinator", "seniors?select=*");
  const all = await countAs("coordinator", "care_assignments?select=*");
  check("sees only assigned seniors", mine.count > 0 && mine.count === all.count,
        `seniors=${mine.count} assignments=${all.count}`);
  const scores = await countAs("coordinator", "risk_scores?select=*");
  check("can read risk scores", scores.count > 0, `count=${scores.count}`);
  const withReasons = await countAs("coordinator", "risk_scores?select=*&reasons=neq.[]");
  check("every score carries reasons",
        withReasons.count === scores.count,
        `${withReasons.count} of ${scores.count}`);
  const fam = await countAs("coordinator", "family_checkin_days?select=*");
  check("cannot read the family view", fam.count === 0, `count=${fam.count}`);
}

// ---- 5. family notes travel one way only ---------------------------------
console.log("\nfamily_notes (family -> coordinator)");
{
  const anon = await countAs(null, "family_notes?select=*");
  check("anon cannot reach it", anon.status === 401 || anon.status === 403 || anon.count === 0,
        `status=${anon.status} count=${anon.count}`);
  const opsSees = await countAs("ops", "family_notes?select=*");
  check("ops sees none", opsSees.count === 0, `count=${opsSees.count}`);
  // A coordinator reading their own seniors' notes is the point of the table,
  // so this asserts reachability rather than a count: there may be none yet.
  const coord = await countAs("coordinator", "family_notes?select=*");
  check("coordinator can reach it", coord.status === 200 || coord.status === 206,
        `status=${coord.status}`);
}

console.log(
  failures
    ? `\n${failures} FAILURE(S) — the product is claiming something it does not enforce\n`
    : "\nall access rules hold\n",
);
process.exit(failures ? 1 : 0);
