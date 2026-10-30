/**
 * Point every senior on a coordinator's caseload at one handset, for a demo.
 *
 * WHY THIS IS A SCRIPT AND NOT A BUTTON. The UI refuses to give two seniors
 * the same number, and that refusal is right: a coordinator typing a number
 * that already belongs to somebody else has almost certainly made a mistake,
 * and the cost of the mistake is a call about one person's medicines reaching
 * another person's telephone. This bypasses that rule, so it lives where it
 * has to be run on purpose, with the number typed out, by somebody who knows
 * why.
 *
 * WHY IT IS SAFE TO BYPASS IT HERE. Migration 0021 made an outbound call
 * carry the senior it was placed for, so a shared number no longer decides
 * who the call is about. What a shared number still breaks is INBOUND: a
 * senior ringing the line is resolved by their number alone, and with twelve
 * seniors behind one handset that resolution is arbitrary. For a demo, where
 * nobody rings in, that is an acceptable trade. For anything else it is not.
 *
 * A trial telephony account can only dial one verified handset, so without
 * this the call button works on exactly one row and looks broken on the rest.
 *
 *   node scripts/set-demo-numbers.mjs "+919076540430"
 *   node scripts/set-demo-numbers.mjs "+919076540430" --limit 3
 *   node scripts/set-demo-numbers.mjs --clear
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));

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

const argv = process.argv.slice(2);
const clear = argv.includes("--clear");
const limitAt = argv.indexOf("--limit");
const limit = limitAt > -1 ? Number(argv[limitAt + 1]) : null;
const phone = argv.find((a) => !a.startsWith("--") && a !== String(limit));

if (!clear && !phone) {
  console.error('usage: node scripts/set-demo-numbers.mjs "+91XXXXXXXXXX" [--limit N] | --clear');
  process.exit(1);
}
if (!clear && !/^\+[1-9]\d{7,14}$/.test(phone)) {
  console.error(`not E.164: ${phone} — it must start with + and the country code.`);
  process.exit(1);
}
if (limit !== null && (!Number.isInteger(limit) || limit < 1)) {
  console.error(`--limit needs a whole number, got: ${argv[limitAt + 1]}`);
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

const owner = need("OWNER_EMAIL");

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
  // Only this coordinator's caseload. Setting it across the whole cohort
  // would put a real handset on two hundred records, and the daily round
  // would then ring it two hundred times.
  const res = await client.query(
    `update seniors set phone = $2
      where id in (
        select s.id from seniors s
          join care_assignments ca on ca.senior_id = s.id
          join auth.users au       on au.id = ca.coordinator_id
         where s.is_active and lower(au.email) = lower($1)
         order by s.display_name
         ${limit ? "limit " + limit : ""}
      )
      returning display_name, phone`,
    [owner, clear ? null : phone],
  );

  if (res.rowCount === 0) {
    console.error("no seniors on that caseload — run restore-coordinator.mjs first.");
    process.exit(1);
  }

  for (const r of res.rows) {
    console.log(`  ${r.display_name.padEnd(20)} ${r.phone ?? "(cleared)"}`);
  }
  console.log(`\n${res.rowCount} senior(s) updated.`);

  if (!clear) {
    console.log("\nThe daily round would now ring this handset once per senior.");
    console.log("Run with --clear when the demo is over.");
  }
} finally {
  await client.end();
}
