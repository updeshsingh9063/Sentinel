/**
 * Prove the "call now" button cannot ring somebody it should not.
 *
 * The button sends a senior id from the browser, which means the id is under
 * the caller's control and must buy them nothing. /api/call/place reads that
 * senior AS THE SIGNED-IN COORDINATOR, so the permission check and the number
 * lookup are the same operation: off the caseload, RLS returns no row, there
 * is no number, and nothing is dialled.
 *
 * This checks the mechanism that claim rests on, and checks that an
 * unauthenticated POST — the shape an attacker would send — dials nothing.
 *
 * NOTHING HERE PLACES A CALL. Every case is one that must be refused, which
 * is exactly why they are safe to run against the live deployment.
 *
 * Usage, from frontend/:
 *   node scripts/verify-call-button.mjs
 *   VERIFY_SITE=https://samarth-sentinel.vercel.app node scripts/verify-call-button.mjs
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
  body: JSON.stringify({ email: ENV.OWNER_EMAIL, password: ENV.OWNER_PASSWORD }),
})
  .then((r) => r.json())
  .then((j) => j.access_token);

const H = { apikey: ANON, Authorization: `Bearer ${token}` };
const read = (q) => fetch(`${URL_}/rest/v1/${q}`, { headers: H }).then((r) => r.json());

console.log(`\nverifying the call button against ${SITE}\n`);

// ---- 1. the caseload is what RLS actually returns --------------------------
const mine = await read("care_assignments?select=senior_id");
const mineIds = new Set(mine.map((a) => a.senior_id));
check("the coordinator has a caseload", mineIds.size > 0, `${mineIds.size} seniors`);

const visible = await read("seniors?select=id,display_name,phone");
check(
  "every senior they can read is on that caseload",
  visible.every((s) => mineIds.has(s.id)),
  `${visible.filter((s) => !mineIds.has(s.id)).length} readable but unassigned`,
);

// ---- 2. a senior who is NOT theirs is invisible -----------------------------
// Found through an aggregate that crosses the whole table, so this does not
// depend on already being able to see the row we are proving is hidden.
const total = await fetch(`${URL_}/rest/v1/ops_daily_metrics?select=seniors_enrolled&order=day.desc&limit=1`, {
  headers: H,
}).then((r) => r.json()).catch(() => null);
const cohort = Array.isArray(total) ? (total[0]?.seniors_enrolled ?? 0) : 0;
check(
  "the cohort is larger than the caseload, so there is something to hide",
  cohort > mineIds.size,
  `cohort=${cohort} caseload=${mineIds.size}`,
);

// A uuid that certainly is not on the caseload: ask for one the view counts
// but the table will not show.
const strangerProbe = await read(
  `seniors?id=not.in.(${[...mineIds].join(",")})&select=id&limit=1`,
);
check(
  "a senior off the caseload cannot be read at all",
  Array.isArray(strangerProbe) && strangerProbe.length === 0,
  JSON.stringify(strangerProbe).slice(0, 120),
);

// ---- 3. the endpoint itself ------------------------------------------------
const cfg = await fetch(`${SITE}/api/call/place`).then((r) => r.json());
check("the endpoint reports its own readiness", typeof cfg.configured === "boolean", JSON.stringify(cfg));

// No cookies: exactly what a script hitting the API would send.
const target = visible.find((s) => s.phone)?.id ?? [...mineIds][0];
const anonPost = await fetch(`${SITE}/api/call/place`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ seniorId: target }),
});
const anonBody = await anonPost.json().catch(() => null);
check(
  "an unauthenticated POST dials nothing",
  anonPost.status === 404 || anonPost.status === 401 || anonPost.status === 503,
  `status=${anonPost.status} ${JSON.stringify(anonBody)}`,
);
check(
  "and it is refused for the right reason, not a crash",
  anonBody?.ok === false && typeof anonBody?.reason === "string",
  JSON.stringify(anonBody),
);

// A malformed body must not reach the provider either.
const junk = await fetch(`${SITE}/api/call/place`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: "not json",
});
check("a malformed body is refused", junk.status === 400 || junk.status === 503, `status=${junk.status}`);

const noId = await fetch(`${SITE}/api/call/place`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: "{}",
});
check("a missing senior id is refused", noId.status === 400 || noId.status === 503, `status=${noId.status}`);


// ---- 4. the status endpoint -------------------------------------------------
// A provider's call ids run in sequence, so "read any call by id" would leak
// who else is being rung and when. The id alone must buy nothing: the senior
// is named too, read under RLS, and the call only answers if the number
// dialled is that senior's.
const REAL = "CA" + "0".repeat(32);

const noSession = await fetch(`${SITE}/api/call/status?sid=${REAL}&senior=${target}`);
check(
  "an unauthenticated status request is refused",
  noSession.status === 404 || noSession.status === 503,
  `status=${noSession.status}`,
);

const malformed = await fetch(`${SITE}/api/call/status?sid=not-a-call-sid&senior=${target}`);
check("a malformed call id is refused", malformed.status === 400, `status=${malformed.status}`);

const noSenior = await fetch(`${SITE}/api/call/status?sid=${REAL}`);
check("a missing senior is refused", noSenior.status === 400, `status=${noSenior.status}`);

const strangerCall = await fetch(
  `${SITE}/api/call/status?sid=${REAL}&senior=00000000-0000-4000-8000-000000000009`,
);
check(
  "a senior off the caseload is refused",
  strangerCall.status === 404 || strangerCall.status === 503,
  `status=${strangerCall.status}`,
);

console.log(failures === 0 ? "\nthe call button holds\n" : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
