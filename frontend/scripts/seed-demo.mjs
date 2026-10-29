/**
 * Seed the hosted Supabase project with a demo cohort.
 *
 * Two parts, because app_users.id references auth.users(id):
 *   1. Demo accounts are created through the Auth Admin API (the supported
 *      route; inserting into auth.users directly is version-fragile).
 *   2. Everything else is one SQL transaction keyed to those UUIDs.
 *
 * Deterministic: a fixed-seed PRNG, so re-running gives the same cohort.
 * Idempotent: truncates the app tables first, and reuses auth users by email.
 *
 * NEVER-DIAGNOSE: every reason_text, next_step and summary line here describes
 * what changed and what a human should do. None names a condition. The seeded
 * strings are drawn from frontend/lib/demo.ts, which already keeps that rule.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * Configuration comes from the environment so no credential lives in the repo:
 *
 *   SUPABASE_DB_HOST      db.<ref>.supabase.co
 *   SUPABASE_DB_PASSWORD  the project's Postgres password
 *   SUPABASE_URL          https://<ref>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * It lives under frontend/ because that is the repo's only Node package and
 * `pg` is a devDependency there. ESM resolves imports from the script's own
 * directory, not the working directory, so a copy under backend/supabase
 * cannot find `pg` however it is invoked.
 *
 *   cd frontend && npm run db:seed
 */
const need = (name) => {
  const v = process.env[name];
  if (!v) {
    console.error(`missing env var: ${name}`);
    process.exit(1);
  }
  return v;
};

const cfg = {
  host: need("SUPABASE_DB_HOST"),
  port: Number(process.env.SUPABASE_DB_PORT || 5432),
  database: process.env.SUPABASE_DB_NAME || "postgres",
  user: process.env.SUPABASE_DB_USER || "postgres",
  password: need("SUPABASE_DB_PASSWORD"),
  // Full verification against Supabase's published CA, which signs the direct
  // database endpoint. Do not swap this for rejectUnauthorized: false.
  ssl: {
    rejectUnauthorized: true,
    ca: fs.readFileSync(path.join(HERE, "prod-ca-2021.crt"), "utf8"),
  },
  connectionTimeoutMillis: 60000,
  query_timeout: 120000,
};

const keys = {
  url: need("SUPABASE_URL"),
  service_role: need("SUPABASE_SERVICE_ROLE_KEY"),
};

const DAYS = 21;
const TODAY = new Date("2026-10-29T00:00:00Z");
const DEMO_PASSWORD = "SamarthDemo!2026";

/* ------------------------------------------------------------- prng ------ */
let _s = 20261029;
const rnd = () => ((_s = (_s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const gauss = (m, sd) =>
  m + sd * Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
const r1 = (x) => Math.round(x * 10) / 10;

const dayISO = (back) => {
  const d = new Date(TODAY);
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
};

/* ------------------------------------------------------- auth accounts --- */
const ACCOUNTS = [
  { key: "coord", email: "coordinator@samarth.demo", role: "coordinator", name: "Priya Sharma" },
  { key: "family", email: "family@samarth.demo", role: "family", name: "Anil Devi" },
  { key: "ops", email: "ops@samarth.demo", role: "ops", name: "Ravi Menon" },
  { key: "c2", email: "coord2@samarth.demo", role: "coordinator", name: "Fatima Khan" },
  { key: "c3", email: "coord3@samarth.demo", role: "coordinator", name: "Sunil Rao" },
  { key: "c4", email: "coord4@samarth.demo", role: "coordinator", name: "Deepa Nair" },
  { key: "c5", email: "coord5@samarth.demo", role: "coordinator", name: "Arjun Mehta" },
  { key: "c6", email: "coord6@samarth.demo", role: "coordinator", name: "Leela Joshi" },
];

async function authAdmin(pathname, init = {}) {
  const res = await fetch(`${keys.url}/auth/v1${pathname}`, {
    ...init,
    headers: {
      apikey: keys.service_role,
      Authorization: `Bearer ${keys.service_role}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) throw new Error(`${res.status} ${pathname}: ${JSON.stringify(body)}`);
  return body;
}

async function ensureAccounts() {
  const existing = new Map();
  let page = 1;
  for (;;) {
    const r = await authAdmin(`/admin/users?page=${page}&per_page=200`);
    const users = r.users || [];
    users.forEach((u) => existing.set((u.email || "").toLowerCase(), u.id));
    if (users.length < 200) break;
    page += 1;
  }

  const out = {};
  for (const a of ACCOUNTS) {
    const have = existing.get(a.email);
    if (have) {
      out[a.key] = have;
      console.log(`  reuse   ${a.email}`);
      continue;
    }
    const created = await authAdmin("/admin/users", {
      method: "POST",
      body: JSON.stringify({
        email: a.email,
        password: DEMO_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: a.name, demo_role: a.role },
      }),
    });
    out[a.key] = created.id;
    console.log(`  create  ${a.email}`);
  }
  return out;
}

/* ------------------------------------------------------------- cohort ---- */
const NAMED = [
  { id: "savitri-devi", name: "Savitri Devi", age: 72, city: "Lucknow", sex: "female", lang: "hi", score: 0.87,
    reasons: [
      { code: "bp_above_baseline", text: "Systolic above her own 14-day median for six days running", contribution: 0.41 },
      { code: "dose_missed", text: "Two evening doses not logged this week", contribution: 0.26 },
      { code: "cue_dizziness", text: "Dizziness mentioned in a call note on Tuesday", contribution: 0.2 },
    ],
    nextStep: "Call this morning. Ask whether she has been standing up quickly, confirm the evening dose, and offer a nurse visit today." },
  { id: "ramesh-chandra", name: "Ramesh Chandra", age: 68, city: "Kanpur", sex: "male", lang: "hi", score: 0.63,
    reasons: [
      { code: "no_contact", text: "Six calls unanswered; eight days since any contact", contribution: 0.38 },
      { code: "activity_down", text: "Activity down from his own weekday pattern", contribution: 0.15 },
      { code: "cue_poor_sleep", text: "Poor sleep mentioned twice this fortnight", contribution: 0.1 },
    ],
    nextStep: "Try the alternate number, then his daughter. If neither answers by noon, schedule a home visit." },
  { id: "kamla-bai", name: "Kamla Bai", age: 76, city: "Varanasi", sex: "female", lang: "hi", score: 0.52,
    reasons: [
      { code: "weight_down", text: "Weight down 1.1 kg over 14 days", contribution: 0.3 },
      { code: "cue_low_appetite", text: "Appetite mentioned twice in call notes", contribution: 0.16 },
    ],
    nextStep: "Call for the daily check-in. Ask what she has eaten today and who is cooking." },
  { id: "abdul-rahman", name: "Abdul Rahman", age: 69, city: "Hyderabad", sex: "male", lang: "hi", score: 0.24,
    reasons: [{ code: "dose_missed", text: "Three evening doses unlogged", contribution: 0.18 }],
    nextStep: "No action today. Pattern is within his usual range for a working week." },
  { id: "joseph-dsouza", name: "Joseph D'Souza", age: 72, city: "Pune", sex: "male", lang: "en", score: 0.14,
    reasons: [{ code: "stable", text: "No change from baseline", contribution: 0.04 }],
    nextStep: "No action today." },
  { id: "meena-pillai", name: "Meena Pillai", age: 68, city: "Kochi", sex: "female", lang: "en", score: 0.1,
    reasons: [{ code: "stable", text: "No change from baseline", contribution: 0.02 }],
    nextStep: "No action today." },
];

const FIRST_F = ["Lakshmi","Sarita","Usha","Nirmala","Pushpa","Shanti","Rukmini","Vimala","Asha","Geeta","Radha","Sulochana","Indira","Kaveri","Parvati","Yashoda","Girija","Mangala"];
const FIRST_M = ["Mohan","Suresh","Vijay","Prakash","Harish","Narayan","Shyam","Dinesh","Ashok","Gopal","Krishna","Madhav","Bhaskar","Raghav","Satish","Kishore","Anand","Jagdish"];
const LAST = ["Sharma","Verma","Iyer","Patil","Reddy","Gupta","Das","Bose","Nair","Kulkarni","Shetty","Bhat","Chauhan","Mishra","Pandey","Rao","Menon","Desai"];
const CITIES = ["Lucknow","Kanpur","Varanasi","Hyderabad","Pune","Kochi","Jaipur","Bhopal","Nagpur","Indore","Patna","Surat"];

// Safe, non-diagnostic reason phrasings for the generated cohort.
const REASON_POOL = [
  { code: "bp_above_baseline", text: "Systolic above their own 14-day median for several days", w: 0.34 },
  { code: "dose_missed", text: "Evening doses not logged this week", w: 0.24 },
  { code: "no_contact", text: "Calls unanswered; several days since any contact", w: 0.3 },
  { code: "weight_down", text: "Weight down about 1 kg over 14 days", w: 0.26 },
  { code: "activity_down", text: "Activity down from their own weekday pattern", w: 0.16 },
  { code: "cue_poor_sleep", text: "Poor sleep mentioned in a recent call note", w: 0.12 },
  { code: "cue_low_appetite", text: "Appetite mentioned twice in call notes", w: 0.15 },
  { code: "spo2_dip", text: "Oxygen saturation below their usual range on two days", w: 0.28 },
  { code: "stable", text: "No change from baseline", w: 0.03 },
];

const NEXT_POOL = [
  "Call this morning and confirm the evening dose.",
  "Try the alternate number, then the family contact.",
  "Call for the daily check-in and ask what they have eaten today.",
  "No action today. Pattern is within their usual range.",
  "Offer a nurse visit today if the call confirms the change.",
];

function buildCohort() {
  const rows = NAMED.map((n) => ({ ...n, named: true }));
  for (let i = 0; i < 54; i += 1) {
    const female = rnd() < 0.55;
    const name = `${female ? pick(FIRST_F) : pick(FIRST_M)} ${pick(LAST)}`;
    const score = Math.min(0.96, Math.max(0.03, rnd() < 0.22 ? gauss(0.68, 0.14) : gauss(0.22, 0.13)));
    const n = score >= 0.4 ? (rnd() < 0.5 ? 2 : 3) : 1;
    const reasons = [];
    const used = new Set();
    for (let k = 0; k < n; k += 1) {
      const r = score < 0.4 && k === 0 ? REASON_POOL[REASON_POOL.length - 1] : pick(REASON_POOL);
      if (used.has(r.code)) continue;
      used.add(r.code);
      reasons.push({ code: r.code, text: r.text, contribution: r1(r.w * (0.7 + rnd() * 0.6)) });
    }
    rows.push({
      id: `gen-${String(i + 1).padStart(3, "0")}`,
      name,
      age: Math.round(gauss(71, 6.5)),
      city: pick(CITIES),
      sex: female ? "female" : "male",
      lang: rnd() < 0.75 ? "hi" : "en",
      score: r1(score * 100) / 100,
      reasons,
      nextStep: score >= 0.4 ? pick(NEXT_POOL.slice(0, 3)) : NEXT_POOL[3],
      named: false,
    });
  }
  return rows.map((s) => ({ ...s, age: Math.min(97, Math.max(58, s.age)) }));
}

/* ----------------------------------------------- Savitri's real series --- */
// From lib/demo.ts DETAIL: 14 days, one null gap, band [122,134], breach at 8.
const SAVITRI_SYS = [128, 126, 131, 124, 129, 127, 125, 130, 136, 139, null, 145, 148, 151];

/* ------------------------------------------------------------ insert ----- */
async function insertMany(c, table, cols, rows, extra = "") {
  if (!rows.length) return 0;
  const perRow = cols.length;
  const chunk = Math.max(1, Math.floor(60000 / perRow));
  let total = 0;
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    const params = [];
    const tuples = slice.map((r) => {
      const ph = r.map((v) => {
        params.push(v);
        return `$${params.length}`;
      });
      return `(${ph.join(",")})`;
    });
    const sql = `insert into ${table} (${cols.join(",")}) values ${tuples.join(",")} ${extra}`;
    const res = await c.query(sql, params);
    total += res.rowCount || 0;
  }
  return total;
}

(async () => {
  console.log("auth accounts:");
  const ids = await ensureAccounts();

  const c = new pg.Client(cfg);
  await c.connect();
  await c.query("begin");

  try {
    // Clear app data. auth.users is left alone and reused.
    await c.query(`truncate alert_feedback, alerts, risk_scores, note_cues,
      call_notes, checkins, medication_logs, vitals, family_summaries,
      consents, family_links, care_assignments, seniors, audit_log,
      app_users restart identity cascade`);

    await insertMany(
      c, "app_users", ["id", "role", "full_name"],
      ACCOUNTS.map((a) => [ids[a.key], a.role, a.name]),
    );

    const cohort = buildCohort();
    const seniorRows = cohort.map((s) => [s.name, s.age, s.sex, s.city, s.lang]);
    const ins = await c.query(
      `insert into seniors (display_name, age, sex, city, language)
       select * from unnest($1::text[], $2::int[], $3::text[], $4::text[], $5::text[])
       returning id, display_name`,
      [
        seniorRows.map((r) => r[0]), seniorRows.map((r) => r[1]),
        seniorRows.map((r) => r[2]), seniorRows.map((r) => r[3]),
        seniorRows.map((r) => r[4]),
      ],
    );
    // seniors come back in insert order, so zip by index
    cohort.forEach((s, i) => { s.uuid = ins.rows[i].id; });
    console.log(`\nseniors: ${ins.rowCount}`);

    // Caseloads: the demo coordinator carries the 6 named seniors.
    const coordKeys = ["coord", "c2", "c3", "c4", "c5", "c6"];
    const assign = [];
    cohort.forEach((s, i) => {
      const key = s.named ? "coord" : coordKeys[1 + (i % 5)];
      s.coordKey = key;
      assign.push([ids[key], s.uuid]);
    });
    await insertMany(c, "care_assignments", ["coordinator_id", "senior_id"], assign);

    const savitri = cohort.find((s) => s.id === "savitri-devi");
    await insertMany(
      c, "family_links",
      ["family_user_id", "senior_id", "relationship", "is_primary"],
      [[ids.family, savitri.uuid, "daughter", true]],
    );

    // Consent. 'family_summary' is the scope the RLS helper checks.
    const consentRows = [];
    for (const s of cohort) {
      const weekly = s.id === "savitri-devi" ? true : rnd() < 0.8;
      consentRows.push([s.uuid, "family_summary", weekly, weekly ? new Date() : null, "demo_seed"]);
      consentRows.push([s.uuid, "urgent_call", true, new Date(), "demo_seed"]);
      consentRows.push([s.uuid, "visit_notice", s.id === "savitri-devi" ? false : rnd() < 0.5, null, "demo_seed"]);
      consentRows.push([s.uuid, "vitals_sharing", false, null, "demo_seed"]);
    }
    await insertMany(c, "consents", ["senior_id", "scope", "granted", "granted_at", "granted_by"], consentRows);

    /* ----------------------------------------------------- daily signals -- */
    const vitals = [], checks = [], meds = [], scores = [], notes = [];

    for (const s of cohort) {
      const baseSys = gauss(126, 9), basePulse = gauss(74, 7), baseWt = gauss(62, 9);
      const rising = s.score >= 0.5;

      for (let d = DAYS - 1; d >= 0; d -= 1) {
        const on = dayISO(d);
        const t = (DAYS - 1 - d) / (DAYS - 1);

        let sys;
        if (s.id === "savitri-devi" && d < 14) {
          sys = SAVITRI_SYS[13 - d];               // her real series, gap included
        } else {
          sys = rnd() < 0.06 ? null : r1(baseSys + (rising ? t * 14 : 0) + gauss(0, 3.2));
        }

        if (sys !== null) {
          vitals.push([
            s.uuid, on, "device", sys, r1(sys * 0.64 + gauss(0, 2)),
            r1(basePulse + gauss(0, 4)), r1(Math.min(99, gauss(96.5, 1.3))),
            r1(baseWt - (s.id === "kamla-bai" ? t * 1.1 : 0) + gauss(0, 0.3)),
            null, r1(gauss(36.7, 0.25)),
          ]);
        }

        const answered = s.id === "ramesh-chandra" ? rnd() < 0.25 : rnd() < 0.88;
        checks.push([
          s.uuid, on, answered,
          answered ? (rising && t > 0.6 ? 3 : rnd() < 0.7 ? 2 : 1) : null,
          answered ? (rising && t > 0.7 ? 2 : 1) : null,
          answered ? rnd() > 0.18 : null,
        ]);

        for (const [drug, dose] of [["Amlodipine", "5 mg"], ["Metformin", "500 mg"]]) {
          const miss = rising && t > 0.5 ? 0.3 : 0.12;
          meds.push([s.uuid, on, drug, dose, rnd() < miss ? false : rnd() < 0.05 ? null : true, "ivr_checkin"]);
        }

        const dayScore = Math.min(0.97, Math.max(0.02, d === 0 ? s.score : s.score * (0.55 + 0.45 * t) + gauss(0, 0.04)));
        const rules = r1(dayScore * 0.4 * 100) / 100;
        scores.push([
          s.uuid, on, r1(dayScore * 1000) / 1000, rules,
          r1(dayScore * 0.3 * 100) / 100, r1(dayScore * 0.2 * 100) / 100,
          r1(dayScore * 0.1 * 100) / 100, "layerA_rules_v0",
          JSON.stringify(d === 0 ? s.reasons : s.reasons.slice(0, 1)),
        ]);
      }
    }

    // Savitri's two call notes carry verbatim quotes; the negated one raises no cue.
    const noteIns = await c.query(
      `insert into call_notes (senior_id, called_on, author_id, reached, note_text, note_lang)
       values ($1,$2,$3,true,$4,'hinglish'), ($1,$5,$3,true,$6,'hinglish')
       returning id`,
      [savitri.uuid, dayISO(5), ids.coord, "chakkar aa raha hai", dayISO(2), "aaj koi dard nahi"],
    );
    // RETURNING follows the VALUES order. Matching on called_on would be wrong:
    // node-pg parses DATE to a local-midnight Date, so toISOString shifts a day.
    const [dizzyNote, painNote] = noteIns.rows;

    await insertMany(
      c, "note_cues",
      ["note_id", "senior_id", "observed_on", "cue", "negated", "confidence", "span_text", "extractor"],
      [
        [dizzyNote.id, savitri.uuid, dayISO(5), "dizziness", false, 0.91, "chakkar aa raha hai", "lexicon_v1"],
        [painNote.id, savitri.uuid, dayISO(2), "pain", true, 0.88, "aaj koi dard nahi", "lexicon_v1"],
      ],
    );

    console.log(`vitals: ${await insertMany(c, "vitals", ["senior_id","measured_on","source","systolic_bp","diastolic_bp","pulse_bpm","spo2_pct","weight_kg","glucose_mgdl","temperature_c"], vitals, "on conflict do nothing")}`);
    console.log(`checkins: ${await insertMany(c, "checkins", ["senior_id","checked_on","answered","feeling_code","pain_code","meds_taken"], checks, "on conflict do nothing")}`);
    console.log(`medication_logs: ${await insertMany(c, "medication_logs", ["senior_id","due_on","drug_name","dose","taken","reported_via"], meds)}`);
    console.log(`risk_scores: ${await insertMany(c, "risk_scores", ["senior_id","scored_on","score","rules_score","baseline_score","ml_score","nlp_score","model_version","reasons"], scores, "on conflict do nothing")}`);

    /* ------------------------------------------------------------ alerts -- */
    // Budget of 3 per coordinator per day, ranked by score. Rows past the
    // budget are scored but never surfaced -- that is the whole point.
    const BUDGET = 3;
    const alertRows = [];
    for (let d = DAYS - 1; d >= 0; d -= 1) {
      const on = dayISO(d);
      for (const key of coordKeys) {
        const mine = cohort
          .filter((s) => s.coordKey === key)
          .map((s) => {
            const row = scores.find((x) => x[0] === s.uuid && x[1] === on);
            return { s, sc: row ? Number(row[2]) : 0 };
          })
          .filter((x) => x.sc >= 0.4)
          .sort((a, b) => b.sc - a.sc)
          .slice(0, BUDGET);

        mine.forEach((m, rank) => {
          const past = d > 0;
          // Tuned so the 21-day mix lands on the numbers lib/demo.ts commits
          // to: precision@K 0.71, false-alarm 18%, unreachable 11% of the
          // alerts that got a verdict. A near-perfect precision would read as
          // implausible and undercut the premise that ranking is the hard part.
          const r = rnd();
          const status = past
            ? r < 0.75 ? "actioned" : r < 0.93 ? "dismissed" : "escalated"
            : "open";
          // Raised at the start of the working day, not at seed time. Any
          // time-to-action metric is meaningless without this.
          const raisedAt = new Date(`${on}T03:30:00Z`); // 09:00 IST
          raisedAt.setUTCMinutes(raisedAt.getUTCMinutes() + Math.floor(rnd() * 90));
          alertRows.push([
            m.s.uuid, ids[key], on, rank + 1, m.sc,
            m.s.reasons[0].text, m.s.nextStep, status, status === "escalated",
            raisedAt,
          ]);
        });
      }
    }
    const alertIns = [];
    for (let i = 0; i < alertRows.length; i += 400) {
      const slice = alertRows.slice(i, i + 400);
      const params = [];
      const tuples = slice.map((r) => `(${r.map((v) => { params.push(v); return `$${params.length}`; }).join(",")})`);
      const res = await c.query(
        `insert into alerts (senior_id, coordinator_id, raised_on, rank_in_day, score,
           reason_text, next_step, status, escalated, created_at)
         values ${tuples.join(",")} on conflict do nothing
         returning id, status, created_at`,
        params,
      );
      alertIns.push(...res.rows);
    }
    console.log(`alerts: ${alertIns.length}`);

    const fb = alertIns
      .filter((a) => a.status !== "open")
      .map((a) => {
        const result =
          a.status === "dismissed"
            ? "false_alarm"
            : rnd() < 0.134 ? "unreachable" : "true_concern";
        // Acted on some minutes after it was raised, right-skewed so the
        // median lands near 45 min rather than the mean being dragged by tails.
        const mins = Math.max(3, Math.round(12 + Math.abs(gauss(0, 1)) * 48));
        const acted = new Date(a.created_at.getTime() + mins * 60000);
        return [a.id, ids.coord, result, acted];
      });
    console.log(`alert_feedback: ${await insertMany(c, "alert_feedback", ["alert_id","reviewer_id","result","acted_at"], fb, "on conflict do nothing")}`);

    /* -------------------------------------------------- family summaries -- */
    const fsRows = [[
      savitri.uuid, dayISO(0),
      "A quieter week than usual, and we have been in touch.\n\n" +
      "Savitri has been keeping her mornings as usual and answered our check-in call on Tuesday.\n\n" +
      "A few evening medicine reminders went unlogged this week, so your coordinator is calling today to help get the evening routine back on track.\n\n" +
      "Nothing here needs you to do anything right now. If that changes, we will call you directly rather than leave it in a summary.",
      true,
    ]];
    for (const s of cohort.filter((x) => !x.named).slice(0, 20)) {
      fsRows.push([s.uuid, dayISO(0),
        "A steady week. We have been in touch as usual and there is nothing you need to do right now.", true]);
    }
    console.log(`family_summaries: ${await insertMany(c, "family_summaries", ["senior_id","covers_on","summary_text","safety_checked"], fsRows, "on conflict do nothing")}`);

    await c.query("commit");
    console.log("\ncommitted.");
    console.log(`\ndemo password for all accounts: ${DEMO_PASSWORD}`);
  } catch (e) {
    await c.query("rollback").catch(() => {});
    console.error("\nROLLED BACK:", e.message);
    if (e.detail) console.error("detail:", e.detail);
    process.exitCode = 1;
  } finally {
    await c.end().catch(() => {});
  }
})();
