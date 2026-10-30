/**
 * Put a real person back on the coordinator list after a cohort reload.
 *
 * WHY THIS IS NEEDED. `db:load-cohort` truncates `app_users`, and the signup
 * trigger that creates those rows fires on `auth.users` INSERT — at
 * registration, once. So an account that registered last week still exists in
 * auth, can still sign in, and lands on a product that believes it has never
 * seen them: no role, no caseload, every page empty. Nothing errors. That is
 * the worst version of this bug, and it would be found on stage.
 *
 * Re-inserting the `app_users` row fires `seed_demo_access()` (migration
 * 0009), which deals a deterministic twelve-senior caseload. That caseload is
 * drawn by a hash and will NOT reliably contain the demo line, so the senior
 * who answers on a real handset is assigned explicitly afterwards — otherwise
 * the call lands on a senior the demo account cannot see, and the worklist
 * stays empty while the database fills up.
 *
 * Usage, from frontend/:
 *   node scripts/restore-coordinator.mjs you@example.com
 *   node scripts/restore-coordinator.mjs you@example.com --role ops
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

// Defaults to the account in .env.local, so the owner's address never has to
// be typed on a command line to restore their own access.
const email = process.argv[2] && !process.argv[2].startsWith("--")
  ? process.argv[2]
  : process.env.OWNER_EMAIL;
const roleFlag = process.argv.indexOf("--role");
const role = roleFlag > -1 ? process.argv[roleFlag + 1] : "coordinator";

if (!email || email.startsWith("--")) {
  console.error("usage: node scripts/restore-coordinator.mjs <email> [--role coordinator|family|ops|admin]");
  process.exit(1);
}
if (!["coordinator", "family", "ops", "admin"].includes(role)) {
  console.error(`unknown role: ${role}`);
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
  const auth = await client.query(
    "select id, raw_user_meta_data->>'full_name' as name from auth.users where lower(email) = lower($1)",
    [email],
  );
  if (auth.rowCount === 0) {
    console.error(`no auth account for ${email} — sign up on the site first.`);
    process.exit(1);
  }
  const { id, name } = auth.rows[0];

  // The trigger does the caseload; this row is all that has to be written.
  await client.query(
    `insert into app_users (id, role, full_name)
     values ($1, $2, coalesce($3, $4))
     on conflict (id) do update set role = excluded.role`,
    [id, role, name, email.split("@")[0]],
  );

  if (role === "coordinator") {
    // The demo line specifically. seed_demo_access deals twelve seniors by a
    // hash of both ids, which is deliberately different per account — so the
    // one senior that matters here has to be named rather than hoped for.
    const demo = await client.query(
      `insert into care_assignments (coordinator_id, senior_id)
       select $1, s.id from seniors s where s.demo_line is true
       on conflict do nothing
       returning senior_id`,
      [id],
    );
    const caseload = await client.query(
      "select count(*)::int as n from care_assignments where coordinator_id = $1",
      [id],
    );
    const line = await client.query(
      `select s.display_name, s.phone from seniors s
        join care_assignments a on a.senior_id = s.id
       where a.coordinator_id = $1 and s.demo_line is true`,
      [id],
    );
    console.log(`${email} is a coordinator again, caseload of ${caseload.rows[0].n}`);
    if (line.rowCount > 0) {
      console.log(`demo line on the caseload: ${line.rows[0].display_name} (${line.rows[0].phone})`);
    } else {
      console.log("no senior is flagged demo_line — run scripts/set-demo-line.mjs after seeding.");
    }
    if (demo.rowCount === 0 && line.rowCount > 0) console.log("(demo line was already assigned)");
  } else {
    console.log(`${email} restored as ${role}`);
  }
} finally {
  await client.end();
}
