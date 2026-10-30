/**
 * Prove that putting a number on a senior's record cannot be abused.
 *
 * The call button now offers to add a missing number. That opens the ONE
 * column a coordinator may write on `seniors`, so it has to be exactly one
 * column, exactly their caseload, and exactly E.164 — otherwise it is a way
 * to edit records you do not carry, or to point a senior's record at a number
 * that will reach a stranger.
 *
 * The checks that matter:
 *   · anon cannot run it at all (the Supabase default-privilege trap)
 *   · a senior off the caseload is refused, by id, with nothing leaked
 *   · a number that is not E.164 is refused BEFORE it is stored, not at
 *     call time, where the failure would be unattributable
 *   · two seniors cannot share a number, because the voice webhook resolves
 *     a caller BY number and a duplicate makes that row order
 *   · nothing but `phone` moves
 *   · the change is written to the audit log
 *
 * Usage, from frontend/:
 *   node scripts/verify-phone-entry.mjs
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
const URL_ = ENV.NEXT_PUBLIC_SUPABASE_URL;
const ANON = ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY;

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

const H = { apikey: ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
const read = (q) => fetch(`${URL_}/rest/v1/${q}`, { headers: H }).then((r) => r.json());
const rpc = (fn, args, headers = H) =>
  fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: "POST", headers, body: JSON.stringify(args) })
    .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

console.log("\nverifying the phone-entry control\n");

const mine = await read("seniors?select=id,display_name,phone,age,city,language&order=display_name");
check("the coordinator carries seniors", mine.length > 0, `${mine.length}`);

// Somebody on the caseload WITHOUT the demo line, so the demo number is not
// disturbed by a test.
const subject = mine.find((s) => !s.phone) ?? mine[0];
const before = { ...subject };

// ---- 1. anon ---------------------------------------------------------------
const anonTry = await rpc(
  "set_senior_phone",
  { p_senior_id: subject.id, p_phone: "+14155550123" },
  { apikey: ANON, "Content-Type": "application/json" },
);
check(
  "anon cannot run it (the default-privilege trap)",
  anonTry.status >= 400 || anonTry.body?.ok === false,
  `status=${anonTry.status} ${JSON.stringify(anonTry.body)?.slice(0, 100)}`,
);

// ---- 2. a stranger ---------------------------------------------------------
// A uuid that is certainly not on the caseload. If it happened to exist it
// would still not be theirs; if it does not exist, the caseload check fires
// first, which is the ordering we want.
const stranger = "00000000-0000-4000-8000-000000000001";
const strangerTry = await rpc("set_senior_phone", { p_senior_id: stranger, p_phone: "+14155550124" });
check(
  "a senior off the caseload is refused",
  strangerTry.body?.ok === false && strangerTry.body?.reason === "not_yours",
  JSON.stringify(strangerTry.body),
);
check(
  "and the refusal says nothing about whether they exist",
  !/name|display|phone|city/i.test(JSON.stringify(strangerTry.body ?? {})),
  JSON.stringify(strangerTry.body),
);

// ---- 3. format -------------------------------------------------------------
for (const bad of ["9076540430", "919076540430", "+91 907", "+0123456789", "hello", "+9107654304301234"]) {
  const r = await rpc("set_senior_phone", { p_senior_id: subject.id, p_phone: bad });
  check(`"${bad}" is refused as not E.164`, r.body?.ok === false && r.body?.reason === "not_e164", JSON.stringify(r.body));
}

// Spacing and punctuation a person actually types should be accepted, not
// rejected on a technicality.
const spaced = await rpc("set_senior_phone", { p_senior_id: subject.id, p_phone: "+91 (907) 654-0431" });
check("a number typed with spaces and brackets is normalised", spaced.body?.ok === true, JSON.stringify(spaced.body));
const afterSpaced = (await read(`seniors?id=eq.${subject.id}&select=phone`))[0];
check("and stored in E.164", afterSpaced?.phone === "+919076540431", `stored=${afterSpaced?.phone}`);

// ---- 4. no two seniors on one number ---------------------------------------
const other = mine.find((s) => s.id !== subject.id);
const dup = await rpc("set_senior_phone", { p_senior_id: other.id, p_phone: "+919076540431" });
check(
  "two seniors cannot share a number",
  dup.body?.ok === false && dup.body?.reason === "number_in_use",
  JSON.stringify(dup.body),
);

// ---- 5. nothing else moves -------------------------------------------------
const after = (await read(`seniors?id=eq.${subject.id}&select=id,display_name,age,city,language`))[0];
check(
  "no other column changed",
  after.display_name === before.display_name &&
    after.age === before.age &&
    after.city === before.city &&
    after.language === before.language,
  `${JSON.stringify(before)} -> ${JSON.stringify(after)}`,
);

// ---- 6. it is written down --------------------------------------------------
// A COORDINATOR MUST NOT BE ABLE TO READ THE AUDIT LOG. Only admins may
// (policy audit_admin_read), so an empty result here is the control working,
// not the write failing -- which is exactly how this check was wrong first.
const logAsCoordinator = await read(
  `audit_log?entity=eq.seniors&entity_id=eq.${subject.id}&select=action&limit=1`,
);
check(
  "a coordinator cannot read the audit log",
  Array.isArray(logAsCoordinator) && logAsCoordinator.length === 0,
  JSON.stringify(logAsCoordinator),
);

// So the row itself is checked underneath RLS, on the database connection.
const db = new pg.Client({
  host: ENV.SUPABASE_DB_HOST,
  port: Number(ENV.SUPABASE_DB_PORT || 5432),
  database: ENV.SUPABASE_DB_NAME || "postgres",
  user: ENV.SUPABASE_DB_USER || "postgres",
  password: ENV.SUPABASE_DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
});
await db.connect();
const logged = await db.query(
  `select action, actor_id from audit_log
    where entity = 'seniors' and entity_id = $1 and action like 'senior.phone.%'
    order by at desc limit 1`,
  [subject.id],
);
await db.end();
check(
  "the change IS on the audit log",
  logged.rowCount > 0,
  "no audit row for that senior",
);
check(
  "and it names who did it",
  logged.rows[0]?.actor_id != null,
  JSON.stringify(logged.rows[0]),
);

// ---- 7. clearing is allowed, and is not an error ---------------------------
// A wrong number is worse than none: it reaches a stranger.
const cleared = await rpc("set_senior_phone", { p_senior_id: subject.id, p_phone: "" });
check("a number can be cleared", cleared.body?.ok === true && cleared.body?.phone === null, JSON.stringify(cleared.body));

// Leave the record as it was found.
await rpc("set_senior_phone", { p_senior_id: subject.id, p_phone: before.phone ?? "" });
const restored = (await read(`seniors?id=eq.${subject.id}&select=phone`))[0];
check("the test left the record as it found it", (restored?.phone ?? null) === (before.phone ?? null), `${restored?.phone}`);

console.log(failures === 0 ? "\nthe phone-entry control holds\n" : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
