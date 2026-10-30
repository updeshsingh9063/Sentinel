/**
 * Point the demo line at a real handset.
 *
 * WHY THIS EXISTS. The seeded cohort carries invented numbers (+9190000001xx)
 * so that nothing in the repo can ring a real person. That is right for a
 * seeded database and wrong for a demo: the call arrives, the webhook resolves
 * the senior FROM THE NUMBER DIALLED, finds nobody, and says "sorry, I think I
 * have the wrong number" — which is the containment working correctly and
 * looks exactly like a broken system.
 *
 * NOT A MIGRATION, DELIBERATELY. A migration is committed, and the number of
 * the person doing the demo is personal data that must not go into a public
 * repository. It is an argument here and it stays an argument.
 *
 * NEEDS THE DATABASE PASSWORD, not a session: `seniors` is admin-only to
 * write (policy seniors_write, migration 0002), and the coordinator running a
 * demo is not an admin. That is the correct policy — this is a deployment
 * action, not something the product should be able to do to itself.
 *
 * Usage, from frontend/:
 *   node scripts/set-demo-line.mjs "+919876543210"
 *   node scripts/set-demo-line.mjs --reset      (back to the seeded number)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));

// Same loader the migration runner uses: a real environment variable wins, so
// the password never has to be typed on a command line, where it would land in
// shell history and in the process list.
const envFile = path.join(here, "..", ".env.local");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    const k = t.slice(0, i).trim();
    if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
}

const arg = process.argv[2];
if (!arg) {
  console.error('usage: node scripts/set-demo-line.mjs "+91XXXXXXXXXX" | --reset');
  process.exit(1);
}

/** The seeded placeholder, restored by --reset so a demo number is not left behind. */
const SEEDED = "+919000000115";

const phone = arg === "--reset" ? SEEDED : arg;

// E.164 or nothing. Twilio sends To in E.164 and the lookup is an exact match,
// so "9076540430" would be accepted here and then never match anything —
// failing at call time instead of now.
if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
  console.error(`not E.164: ${phone}`);
  console.error('it must start with + and the country code, e.g. "+919876543210"');
  process.exit(1);
}

const need = (name) => {
  const v = process.env[name];
  if (!v) {
    console.error(`missing env var: ${name} (expected in frontend/.env.local)`);
    process.exit(1);
  }
  return v;
};

const client = new pg.Client({
  host: need("SUPABASE_DB_HOST"),
  port: Number(process.env.SUPABASE_DB_PORT || 5432),
  database: process.env.SUPABASE_DB_NAME || "postgres",
  user: process.env.SUPABASE_DB_USER || "postgres",
  password: need("SUPABASE_DB_PASSWORD"),
  ssl: { rejectUnauthorized: false },
});

await client.connect();
try {
  // Refuse to point two seniors at one handset: the webhook resolves a caller
  // by number, so a duplicate makes which senior gets the check-in a matter of
  // row order.
  const clash = await client.query(
    "select display_name from seniors where phone = $1 and demo_line is not true",
    [phone],
  );
  // A SHARED HANDSET IS LEGITIMATE since migration 0022 — a household has one
  // telephone — so this warns rather than refuses. It still warns, because an
  // INBOUND call is resolved by number alone and with several seniors behind
  // one handset that resolution is a guess at the oldest record.
  if (clash.rowCount > 0) {
    console.log(
      `note: ${phone} is also on ${clash.rowCount} other record(s), e.g. ${clash.rows[0].display_name}.`,
    );
    console.log("      outbound calls carry the senior id, so they still land correctly.");
    console.log("      an INBOUND call on this number resolves to the oldest record.");
  }

  // A cohort reload truncates `seniors`, which takes the demo_line flag with
  // it. Migration 0013 only sets the flag on an empty database, so after a
  // reload nobody carries it and every call answers "wrong number". Pick one
  // here instead of asking for the migration to be re-run.
  //
  // It must be a senior the person demonstrating actually CARRIES, or the call
  // lands on somebody their worklist cannot show, and a Hindi speaker, because
  // that is the conversation that has been tested.
  const flagged = await client.query("select 1 from seniors where demo_line is true");
  if (flagged.rowCount === 0) {
    const owner = process.env.OWNER_EMAIL;
    const pick = await client.query(
      `update seniors set demo_line = true
        where id = (
          select s.id from seniors s
            join care_assignments ca on ca.senior_id = s.id
            join auth.users au       on au.id = ca.coordinator_id
           where s.is_active and lower(au.email) = lower($1)
           order by (s.language = 'hi') desc, s.display_name
           limit 1
        )
        returning display_name`,
      [owner ?? ""],
    );
    if (pick.rowCount === 0) {
      console.error("no active senior on that coordinator's caseload — run restore-coordinator.mjs first.");
      process.exit(1);
    }
    console.log(`demo line assigned to ${pick.rows[0].display_name}`);
  }

  // A FAMILY MEMBER, AND THEIR CONSENT. notify_family walks family_links and
  // checks the consent scope, so a senior with neither gets no message and
  // the system is right to send none. On the demo line that reads as a
  // broken escalation rather than an empty address book — the emergency
  // reaches the coordinator and silently reaches nobody at home.
  const fam = await client.query(
    `insert into family_links (family_user_id, senior_id, relationship, is_primary)
     select u.id, s.id, 'family member', true
       from app_users u, seniors s
      where u.role = 'family' and s.demo_line is true
      limit 1
     on conflict do nothing
     returning family_user_id`,
  );
  await client.query(
    `insert into consents (senior_id, scope, granted, granted_at, granted_by)
     select s.id, v.scope, true, now(), 'demo_line'
       from seniors s, (values ('urgent_call'), ('visit_notice'), ('family_summary')) as v(scope)
      where s.demo_line is true
     on conflict (senior_id, scope) do update set granted = true, granted_at = now()`,
  );
  if (fam.rowCount > 0) console.log("linked a family member and granted the alert consents");

  const res = await client.query(
    "update seniors set phone = $1 where demo_line is true returning display_name, phone, language",
    [phone],
  );
  if (res.rowCount === 0) {
    console.error("no senior is flagged demo_line — run npm run db:seed first.");
    process.exit(1);
  }
  for (const r of res.rows) {
    console.log(`${r.display_name} now answers on ${r.phone} (speaks ${r.language})`);
  }
  if (arg === "--reset") console.log("demo line returned to the seeded placeholder.");
} finally {
  await client.end();
}
