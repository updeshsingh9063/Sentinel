/**
 * Prove the invisible guardian: the system decides who to ring, and why.
 *
 * The claim under test is not "a schedule exists". It is that every call it
 * adds is justified against that senior's OWN recent normal, that running the
 * planner twice does not stack duplicate calls on somebody, and that a
 * welfare call nobody answers turns into a human being going round rather
 * than into a row that sits there.
 *
 * Usage, from frontend/:
 *   node scripts/verify-plan.mjs
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
const OWNER = ENV.OWNER_EMAIL;
const OWNER_PW = ENV.OWNER_PASSWORD;

if (!URL_ || !ANON || !OWNER || !OWNER_PW) {
  console.error("need NEXT_PUBLIC_SUPABASE_* and OWNER_EMAIL/OWNER_PASSWORD in .env.local");
  process.exit(1);
}

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
  body: JSON.stringify({ email: OWNER, password: OWNER_PW }),
})
  .then((r) => r.json())
  .then((j) => j.access_token);

const H = { apikey: ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
const read = (q, h = H) => fetch(`${URL_}/rest/v1/${q}`, { headers: h }).then((r) => r.json());
const rpc = (fn, args = {}, h = H) =>
  fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: "POST", headers: h, body: JSON.stringify(args) }).then(
    async (r) => ({ status: r.status, body: await r.json().catch(() => null) }),
  );

const day = new Date().toISOString().slice(0, 10);
console.log(`\nverifying the call planner against ${URL_}\n`);

// ---- 1. the baseline is the person ---------------------------------------
console.log("the baseline is the person, not the population");
const dev = await read(
  "routine_deviation?select=display_name,usual_steps,steps_today,steps_pct_of_usual&usual_steps=not.is.null&limit=50",
);
check("it reports a per-senior usual", Array.isArray(dev) && dev.length > 0, JSON.stringify(dev)?.slice(0, 100));

const usuals = new Set((dev ?? []).map((d) => d.usual_steps));
check(
  "those usuals differ between seniors",
  usuals.size > 3,
  `only ${usuals.size} distinct baselines across ${dev?.length} seniors — that would be a global threshold`,
);

const wrong = (dev ?? []).filter(
  (d) => d.usual_steps && d.steps_today != null && Math.abs(Math.round((d.steps_today / d.usual_steps) * 100) - d.steps_pct_of_usual) > 1,
);
check("the percentage is today against their own usual", wrong.length === 0, JSON.stringify(wrong.slice(0, 2)));

// ---- 2. the planner --------------------------------------------------------
console.log("\nplanning the day");
const first = await rpc("plan_calls", {});
check("the planner runs", first.body?.ok === true, JSON.stringify(first.body));

const after1 = await read(`call_plan?planned_on=eq.${day}&select=id&limit=2000`);
const again = await rpc("plan_calls", {});
const after2 = await read(`call_plan?planned_on=eq.${day}&select=id&limit=2000`);
check(
  "running it twice plans nothing twice",
  after1.length === after2.length,
  `${after1.length} then ${after2.length}`,
);
void again;

const rows = await read(`call_plan?planned_on=eq.${day}&select=senior_id,reason,why&limit=2000`);
check("every call carries a reason in words", rows.every((r) => (r.why ?? "").length > 10), "a row has no why");

const byKind = {};
for (const r of rows) byKind[r.reason] = (byKind[r.reason] ?? 0) + 1;
console.log(`  ..    ${JSON.stringify(byKind)}`);
check("everybody gets their ordinary call", (byKind.daily ?? 0) > 0, JSON.stringify(byKind));
check("some calls were added for a reason", (byKind.welfare ?? 0) + (byKind.medicine ?? 0) + (byKind.company ?? 0) > 0, JSON.stringify(byKind));

// Nobody should get two of the same kind in a day.
const seen = new Set();
let dupes = 0;
for (const r of rows) {
  const k = `${r.senior_id}|${r.reason}`;
  if (seen.has(k)) dupes += 1;
  seen.add(k);
}
check("nobody is rung twice for the same reason", dupes === 0, `${dupes} duplicate(s)`);

// A welfare call must be justified by one of the conditions that cause it.
const welfare = await read(
  `call_plan?planned_on=eq.${day}&reason=eq.welfare&select=senior_id,why&limit=200`,
);
const justified = welfare.every((w) => /unanswered|Moving about|reached them since/.test(w.why));
check("every welfare call says what triggered it", justified, JSON.stringify(welfare.slice(0, 2)));

// ---- 3. unanswered twice becomes a person going round ---------------------
console.log("\nnobody answered, twice");
if (!welfare.length) {
  console.log("  ..    no welfare calls planned, skipping");
} else {
  const target = welfare[0].senior_id;
  const row = (await read(`call_plan?planned_on=eq.${day}&reason=eq.welfare&senior_id=eq.${target}&select=id`))[0];

  await fetch(`${URL_}/rest/v1/call_plan?id=eq.${row.id}`, {
    method: "PATCH",
    headers: H,
    body: JSON.stringify({ outcome: "no_answer", attempts: 1 }),
  });
  const early = await rpc("escalate_unanswered", {});
  check("one unanswered call raises nothing", early.body?.raised === 0, JSON.stringify(early.body));

  await fetch(`${URL_}/rest/v1/call_plan?id=eq.${row.id}`, {
    method: "PATCH",
    headers: H,
    body: JSON.stringify({ outcome: "no_answer", attempts: 2 }),
  });
  const esc = await rpc("escalate_unanswered", {});
  check("two unanswered calls raise an errand", (esc.body?.raised ?? 0) >= 1, JSON.stringify(esc.body));

  const twice = await rpc("escalate_unanswered", {});
  check("escalating again does not raise a second", twice.body?.raised === 0, JSON.stringify(twice.body));

  const raised = await read(
    `assistance_requests?senior_id=eq.${target}&raised_on=eq.${day}&kind=eq.other&select=summary,urgent,state`,
  );
  check("it lands on the help queue, marked urgent", raised[0]?.urgent === true, JSON.stringify(raised[0]));
  check("and says what happened", /unanswered/.test(raised[0]?.summary ?? ""), JSON.stringify(raised[0]?.summary));
}

// ---- 4. the companion's briefing -----------------------------------------
console.log("\nwhat the companion is told");
const brief = await rpc("demo_line_briefing", {}, { apikey: ANON, "Content-Type": "application/json" });
check("the briefing is readable without a session", brief.status === 200, `status=${brief.status}`);
check("it carries a name and a language", !!brief.body?.name && !!brief.body?.language, JSON.stringify(brief.body));
check(
  "it exposes no id and nothing clinical",
  brief.body &&
    !("id" in brief.body) &&
    !("senior_id" in brief.body) &&
    !("score" in brief.body) &&
    !("vitals" in brief.body),
  JSON.stringify(brief.body),
);

// ---- 5. containment -------------------------------------------------------
console.log("\ncontainment");
const anonH = { apikey: ANON, "Content-Type": "application/json" };
const anonPlan = await fetch(`${URL_}/rest/v1/call_plan?select=id&limit=1`, { headers: anonH });
const anonPlanBody = await anonPlan.json().catch(() => null);
check(
  "anon cannot read the plan",
  anonPlan.status >= 400 || (Array.isArray(anonPlanBody) && anonPlanBody.length === 0),
  `status=${anonPlan.status} ${JSON.stringify(anonPlanBody)?.slice(0, 80)}`,
);

const anonDev = await fetch(`${URL_}/rest/v1/routine_deviation?select=display_name&limit=1`, { headers: anonH });
check("anon cannot read the deviations", anonDev.status >= 400, `status=${anonDev.status}`);

const anonPlanner = await rpc("plan_calls", {}, anonH);
check("anon cannot run the planner", anonPlanner.status >= 400, `status=${anonPlanner.status}`);

console.log(failures === 0 ? "\nthe planner holds\n" : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
