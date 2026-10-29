/**
 * Register brand-new accounts through the real public sign-up path and check
 * each one ends up usable: correct role, its own name, and data to look at.
 *
 * WHY THIS IS A SCRIPT. Demo logins prove nothing about registration — they
 * were created by an admin API that skips the parts most likely to be broken.
 * The first thing a reviewer does is make their own account, and for a while
 * that produced an account that could see absolutely nothing: the profile row
 * was created, no seniors were ever assigned, and both the worklist and the
 * summary correctly reported that the database had returned no rows.
 *
 * It creates real rows. The addresses are stamped with the run time and
 * @example.com so they are obvious in the dashboard, and the cohort is
 * synthetic, so the cost of leaving them behind is zero.
 *
 * Usage, from frontend/:  node scripts/verify-signup.mjs
 */
import fs from "node:fs";

const env = fs.readFileSync("D:/deviathon/samarth-sentinel/frontend/.env.local", "utf8");
const V = {};
for (const l of env.split(/\r?\n/)) {
  const t = l.trim();
  if (!t || t.startsWith("#") || !t.includes("=")) continue;
  const i = t.indexOf("=");
  V[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}
const URL_ = V.NEXT_PUBLIC_SUPABASE_URL;
const ANON = V.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const stamp = Date.now();
let failures = 0;

function check(label, ok, detail) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  -> ${detail}`}`);
  if (!ok) failures += 1;
}

async function run(role, fullName) {
  const email = `test.${role}.${stamp}@example.com`;
  console.log(`\n${role} — signing up as ${email}`);

  const signup = await fetch(`${URL_}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password: "TestPass!2026",
      data: { demo_role: role, full_name: fullName },
    }),
  });
  const su = await signup.json();
  if (!su.access_token && !su.user) {
    check("account created", false, JSON.stringify(su).slice(0, 160));
    return;
  }
  check("account created", true);

  // Sign in the way the app does.
  const tok = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "TestPass!2026" }),
  }).then((r) => r.json());
  if (!tok.access_token) {
    check("can sign in", false, JSON.stringify(tok).slice(0, 160));
    return;
  }
  check("can sign in", true);

  const H = { apikey: ANON, Authorization: `Bearer ${tok.access_token}` };
  const get = (q) => fetch(`${URL_}/rest/v1/${q}`, { headers: H }).then((r) => r.json());
  const count = async (q) => {
    const r = await fetch(`${URL_}/rest/v1/${q}`, {
      headers: { ...H, Prefer: "count=exact", Range: "0-0" },
    });
    return Number((r.headers.get("content-range") || "").split("/")[1]);
  };

  const me = await get("app_users?select=role,full_name");
  check("profile row exists", me.length === 1, JSON.stringify(me).slice(0, 120));
  check(`role is ${role}`, me[0]?.role === role, `got ${me[0]?.role}`);
  check("name is their own", me[0]?.full_name === fullName, `got ${me[0]?.full_name}`);

  if (role === "coordinator") {
    const assigned = await count("care_assignments?select=*");
    check("has a caseload", assigned > 0, `assignments=${assigned}`);
    const seniors = await count("seniors?select=*");
    check("can see those seniors", seniors === assigned, `seniors=${seniors}`);
    const scores = await count("risk_scores?select=*");
    check("can see their scores", scores > 0, `scores=${scores}`);
    // A coordinator IS allowed to read the summaries for their own seniors —
    // 0002_rls.sql grants it explicitly, and it is right: they are
    // accountable for what goes to the family and already see strictly more.
    // What matters is that the number tracks their caseload rather than the
    // whole cohort.
    const fam = await count("family_summaries?select=*");
    const allSummaries = 40;
    check("summaries are limited to their own caseload",
          fam < allSummaries, `saw ${fam}, cohort has ~${allSummaries}`);
  }

  if (role === "family") {
    const links = await count("family_links?select=*");
    check("linked to one senior", links === 1, `links=${links}`);
    const sums = await count("family_summaries?select=*");
    check("has a summary to read", sums > 0, `summaries=${sums}`);
    const vitals = await count("vitals?select=*");
    check("cannot read vitals", vitals === 0, `vitals=${vitals}`);
    const scores = await count("risk_scores?select=*");
    check("cannot read scores", scores === 0, `scores=${scores}`);
  }

  if (role === "ops") {
    const agg = await count("ops_daily_metrics?select=*");
    check("can read aggregates", agg > 0, `rows=${agg}`);
    const seniors = await count("seniors?select=*");
    check("cannot read seniors", seniors === 0, `seniors=${seniors}`);
  }
}

await run("coordinator", "Anjali Verma");
await run("family", "Rohit Nair");
await run("ops", "Meera Pillai");

// Role escalation must still be impossible.
console.log("\nescalation attempt — requesting admin");
{
  const email = `test.admin.${stamp}@example.com`;
  await fetch(`${URL_}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password: "TestPass!2026",
      data: { demo_role: "admin", full_name: "Should Not Be Admin" },
    }),
  });
  const tok = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "TestPass!2026" }),
  }).then((r) => r.json());
  const me = await fetch(`${URL_}/rest/v1/app_users?select=role`, {
    headers: { apikey: ANON, Authorization: `Bearer ${tok.access_token}` },
  }).then((r) => r.json());
  check("admin request is clamped to family", me[0]?.role === "family", `got ${me[0]?.role}`);
}

console.log(failures ? `\n${failures} FAILURE(S)\n` : "\nnew-account flow works for every role\n");
process.exit(failures ? 1 : 0);
