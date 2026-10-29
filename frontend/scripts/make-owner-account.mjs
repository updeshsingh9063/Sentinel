/**
 * Create the real coordinator account that runs the demo, and hand it the
 * existing caseload.
 *
 * The seeded `coordinator@samarth.demo` carries the whole 200-senior cohort,
 * and it is the account the shared demo card signs you into. Presenting from
 * it means presenting as a person who does not exist, with a password
 * published in the client bundle. This makes a real account instead and gives
 * it the same caseload, so nothing about the data changes -- only who is
 * signed in to look at it.
 *
 * THE PASSWORD IS NOT IN THIS FILE AND MUST NOT BE. It is read from
 * OWNER_PASSWORD in .env.local, which is gitignored. The demo accounts could
 * publish theirs because they hold nothing but synthetic data; a real
 * person's password is a different thing entirely, and a repo is forever.
 *
 * Idempotent: run it twice and the second run reuses the account and
 * re-syncs the assignments.
 *
 * Usage, from frontend/:
 *   node scripts/make-owner-account.mjs
 *   node scripts/make-owner-account.mjs --email you@example.com --name "Your Name"
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
const SERVICE = ENV.SUPABASE_SERVICE_ROLE_KEY;

const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : fallback;
};

const EMAIL = (arg("--email", ENV.OWNER_EMAIL) || "").trim().toLowerCase();
const NAME = arg("--name", ENV.OWNER_NAME) || "";
const PASSWORD = ENV.OWNER_PASSWORD || "";
const SOURCE = arg("--from", "coordinator@samarth.demo");

if (!URL_ || !SERVICE) {
  console.error("need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
if (!EMAIL || !NAME || !PASSWORD) {
  console.error(
    "need OWNER_EMAIL, OWNER_NAME and OWNER_PASSWORD in .env.local\n" +
    "(the password is deliberately not accepted on the command line, where it\n" +
    " would land in shell history and the process list)",
  );
  process.exit(1);
}

const auth = (p, init = {}) =>
  fetch(`${URL_}/auth/v1${p}`, {
    ...init,
    headers: {
      apikey: SERVICE, Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json", ...(init.headers ?? {}),
    },
  });

const rest = (p, init = {}) =>
  fetch(`${URL_}/rest/v1/${p}`, {
    ...init,
    headers: {
      apikey: SERVICE, Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json", ...(init.headers ?? {}),
    },
  });

/** Find a user by address, paging because the admin list is paginated. */
async function findUser(email) {
  for (let page = 1; page <= 20; page += 1) {
    const r = await auth(`/admin/users?page=${page}&per_page=200`).then((x) => x.json());
    const users = r.users ?? [];
    const hit = users.find((u) => (u.email ?? "").toLowerCase() === email);
    if (hit) return hit;
    if (users.length < 200) return null;
  }
  return null;
}

console.log(`\nreal coordinator account on ${URL_}\n`);

// ---- 1. the account ------------------------------------------------------
let user = await findUser(EMAIL);
if (user) {
  // Reset the password and the name, so re-running fixes an account that was
  // created by hand with the wrong details.
  const r = await auth(`/admin/users/${user.id}`, {
    method: "PUT",
    body: JSON.stringify({
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: NAME, demo_role: "coordinator" },
    }),
  });
  if (!r.ok) {
    console.error("  could not update:", (await r.text()).slice(0, 200));
    process.exit(1);
  }
  console.log(`  reuse    ${EMAIL}`);
} else {
  const r = await auth("/admin/users", {
    method: "POST",
    body: JSON.stringify({
      email: EMAIL,
      password: PASSWORD,
      // No confirmation mail. The free tier sends a few an hour and this
      // account is being created by its own owner, who is standing here.
      email_confirm: true,
      user_metadata: { full_name: NAME, demo_role: "coordinator" },
    }),
  });
  const body = await r.json();
  if (!r.ok) {
    console.error("  could not create:", JSON.stringify(body).slice(0, 220));
    process.exit(1);
  }
  user = body;
  console.log(`  create   ${EMAIL}`);
}

// ---- 2. the profile row --------------------------------------------------
// The signup trigger writes this for accounts made through the public form.
// An admin-created user may arrive before it, or with the wrong role, so it
// is set explicitly rather than assumed.
{
  const r = await rest("app_users", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify([{ id: user.id, role: "coordinator", full_name: NAME }]),
  });
  const body = await r.json();
  if (!r.ok) {
    console.error("  app_users failed:", JSON.stringify(body).slice(0, 220));
    process.exit(1);
  }
  console.log(`  profile  ${NAME} · coordinator`);
}

// ---- 3. the caseload -----------------------------------------------------
const source = await findUser(SOURCE);
if (!source) {
  console.error(`  no account ${SOURCE} to copy a caseload from`);
  process.exit(1);
}

const mine = await rest(
  `care_assignments?coordinator_id=eq.${source.id}&select=senior_id`,
).then((r) => r.json());

if (!Array.isArray(mine) || !mine.length) {
  console.error(`  ${SOURCE} carries no seniors — nothing to copy`);
  process.exit(1);
}

{
  const rows = mine.map((a) => ({ coordinator_id: user.id, senior_id: a.senior_id }));
  const r = await rest("care_assignments", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates" },
    body: JSON.stringify(rows),
  });
  if (!r.ok) {
    console.error("  assignments failed:", (await r.text()).slice(0, 220));
    process.exit(1);
  }
  console.log(`  caseload ${rows.length} seniors, copied from ${SOURCE}`);
}

// ---- 4. the demo line, so the check-in lands on this worklist ------------
{
  const [line] = await rest("seniors?demo_line=is.true&select=id,display_name").then((r) => r.json());
  if (!line) {
    console.log("  WARN     no senior is flagged demo_line — run migration 0013");
  } else {
    const [has] = await rest(
      `care_assignments?coordinator_id=eq.${user.id}&senior_id=eq.${line.id}&select=senior_id`,
    ).then((r) => r.json());
    if (!has) {
      await rest("care_assignments", {
        method: "POST",
        headers: { Prefer: "resolution=ignore-duplicates" },
        body: JSON.stringify([{ coordinator_id: user.id, senior_id: line.id }]),
      });
    }
    console.log(`  check-in lands on ${line.display_name}, who is on this caseload`);
  }
}

console.log(`\nsign in at /signin with ${EMAIL} and the password from .env.local\n`);
