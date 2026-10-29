/**
 * Load the generated + scored cohort into the hosted Supabase project.
 *
 * Replaces the hand-written demo seed: from here the product runs on the same
 * 200-senior cohort the model was trained and evaluated on, which is what the
 * brief means by "demonstrated live on the synthetic cohort".
 *
 * WHAT GOES IN AND WHAT STAYS IN PARQUET. The model uses all 90 days; only the
 * most recent `--days` (default 30) are loaded here. The full history lives in
 * datasets/synthetic and model/artifacts. This is a deliberate split: the
 * demo needs a worklist and a chart, not 108,000 medication rows pushed over a
 * free-tier connection, and nothing about the metrics depends on what the
 * dashboard holds.
 *
 * Reads from the pipeline's own output, so the numbers on screen are the
 * numbers the evaluation produced. Nothing is recomputed in JavaScript.
 *
 *   cd frontend && npm run db:load-cohort
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");

const need = (n) => {
  const v = process.env[n];
  if (!v) {
    console.error(`missing env var: ${n}`);
    process.exit(1);
  }
  return v;
};

const DAYS = Number(process.argv.find((a) => a.startsWith("--days="))?.split("=")[1] ?? 30);
const DEMO_PASSWORD = "SamarthDemo!2026";

const cfg = {
  host: need("SUPABASE_DB_HOST"),
  port: Number(process.env.SUPABASE_DB_PORT || 5432),
  database: process.env.SUPABASE_DB_NAME || "postgres",
  user: process.env.SUPABASE_DB_USER || "postgres",
  password: need("SUPABASE_DB_PASSWORD"),
  ssl: {
    rejectUnauthorized: true,
    ca: fs.readFileSync(path.join(HERE, "prod-ca-2021.crt"), "utf8"),
  },
  connectionTimeoutMillis: 60000,
  query_timeout: 180000,
};
const keys = { url: need("SUPABASE_URL"), service_role: need("SUPABASE_SERVICE_ROLE_KEY") };

/* ---------------------------------------------------- parquet -> json ---- */
// The cohort is parquet, which Node cannot read without a heavy dependency.
// The venv that generated it is already present, so it does the conversion —
// one subprocess beats adding a parquet reader to the frontend bundle's deps.
function readCohort() {
  const py = path.join(REPO, ".venv", "Scripts", "python.exe");
  if (!fs.existsSync(py)) {
    console.error(`missing ${py}\nCreate it: python -m venv .venv && .venv/Scripts/pip install -r model/requirements.txt`);
    process.exit(1);
  }
  const script = `
import json, sys, pandas as pd
from pathlib import Path
repo = Path(r"${REPO.replace(/\\/g, "\\\\")}")
syn = repo / "datasets" / "synthetic"
art = repo / "model" / "artifacts"
daily = pd.read_parquet(syn / "daily.parquet")
seniors = pd.read_parquet(syn / "seniors.parquet")
notes = pd.read_parquet(syn / "notes.parquet")
scored = pd.read_parquet(art / "scored.parquet")
alerts = pd.read_parquet(art / "alerts.parquet")
last = int(daily["day"].max())
lo = last - ${DAYS} + 1
daily = daily[daily["day"] >= lo]
notes = notes[notes["day"] >= lo]
scored = scored[scored["day"] >= lo]
alerts = alerts[alerts["day"] >= lo]
out = {
  "last_day": last, "from_day": lo,
  "seniors": json.loads(seniors.to_json(orient="records")),
  "daily": json.loads(daily.to_json(orient="records", date_format="iso")),
  "notes": json.loads(notes.to_json(orient="records", date_format="iso")),
  "scored": json.loads(scored.to_json(orient="records")),
  "alerts": json.loads(alerts.to_json(orient="records")),
}
sys.stdout.write(json.dumps(out))
`;
  const buf = execFileSync(py, ["-c", script], {
    maxBuffer: 1024 * 1024 * 512,
    env: { ...process.env, PYTHONPATH: path.join(REPO, "model") },
  });
  return JSON.parse(buf.toString("utf8"));
}

/* ------------------------------------------------------------- auth ----- */
async function authAdmin(p, init = {}) {
  const res = await fetch(`${keys.url}/auth/v1${p}`, {
    ...init,
    headers: {
      apikey: keys.service_role,
      Authorization: `Bearer ${keys.service_role}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${res.status} ${p}: ${JSON.stringify(body)}`);
  return body;
}

async function ensureAccounts(coordinatorIds) {
  const existing = new Map();
  for (let page = 1; ; page += 1) {
    const r = await authAdmin(`/admin/users?page=${page}&per_page=200`);
    const users = r.users || [];
    users.forEach((u) => existing.set((u.email || "").toLowerCase(), u.id));
    if (users.length < 200) break;
  }

  const wanted = [
    { email: "coordinator@samarth.demo", role: "coordinator", name: "Priya Sharma", maps: coordinatorIds[0] },
    { email: "family@samarth.demo", role: "family", name: "Anil Devi" },
    { email: "ops@samarth.demo", role: "ops", name: "Ravi Menon" },
    ...coordinatorIds.slice(1).map((cid, i) => ({
      email: `coord${i + 2}@samarth.demo`,
      role: "coordinator",
      name: `Coordinator ${i + 2}`,
      maps: cid,
    })),
  ];

  const ids = {};
  for (const a of wanted) {
    let id = existing.get(a.email);
    if (!id) {
      const created = await authAdmin("/admin/users", {
        method: "POST",
        body: JSON.stringify({
          email: a.email,
          password: DEMO_PASSWORD,
          email_confirm: true,
          user_metadata: { full_name: a.name, demo_role: a.role },
        }),
      });
      id = created.id;
    }
    ids[a.email] = { id, role: a.role, name: a.name, maps: a.maps };
  }
  return ids;
}

/* ------------------------------------------------------------ insert ---- */
/**
 * Medicine regimens, assigned per senior and held stable across the window.
 *
 * Chosen to look like what an Indian geriatric caseload actually carries:
 * blood-pressure and sugar control in almost everyone, then the cheap
 * widely-sold additions — amitriptyline for pain or sleep, diclofenac for
 * joints, alprazolam for sleep, glimepiride alongside metformin. Several
 * combinations here are ones the 2023 AGS Beers Criteria flag for review in
 * someone over 65, which is the point: lib/medication-rules.ts has to have
 * something real to find.
 *
 * Deterministic from the senior id so a reload produces the same regimen and
 * a screenshot taken yesterday still matches the database today.
 */
const REGIMENS = [
  [{ name: "Amlodipine", dose: "5 mg" }, { name: "Metformin", dose: "500 mg" }],
  [{ name: "Telmisartan", dose: "40 mg" }, { name: "Metformin", dose: "500 mg" },
   { name: "Atorvastatin", dose: "10 mg" }],
  [{ name: "Amlodipine", dose: "5 mg" }, { name: "Glimepiride", dose: "1 mg" },
   { name: "Pantoprazole", dose: "40 mg" }],
  [{ name: "Amlodipine", dose: "5 mg" }, { name: "Amitriptyline", dose: "10 mg" },
   { name: "Chlorpheniramine", dose: "4 mg" }],
  [{ name: "Telmisartan", dose: "40 mg" }, { name: "Diclofenac", dose: "50 mg" },
   { name: "Pantoprazole", dose: "40 mg" }],
  [{ name: "Metformin", dose: "500 mg" }, { name: "Alprazolam", dose: "0.25 mg" },
   { name: "Amitriptyline", dose: "10 mg" }, { name: "Tramadol", dose: "50 mg" }],
  [{ name: "Amlodipine", dose: "5 mg" }, { name: "Atorvastatin", dose: "10 mg" }],
  [{ name: "Losartan", dose: "50 mg" }, { name: "Sertraline", dose: "50 mg" },
   { name: "Warfarin", dose: "3 mg" }],
];

function regimenFor(seniorId) {
  let h = 0;
  for (const ch of String(seniorId)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return REGIMENS[h % REGIMENS.length];
}

async function insertMany(c, table, cols, rows, extra = "") {
  if (!rows.length) return 0;
  const chunk = Math.max(1, Math.floor(50000 / cols.length));
  let total = 0;
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    const params = [];
    const tuples = slice.map(
      (r) => `(${r.map((v) => { params.push(v); return `$${params.length}`; }).join(",")})`,
    );
    const res = await c.query(
      `insert into ${table} (${cols.join(",")}) values ${tuples.join(",")} ${extra}`,
      params,
    );
    total += res.rowCount || 0;
  }
  return total;
}

const dayToDate = (day, lastDay) => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - (lastDay - day));
  return d.toISOString().slice(0, 10);
};

(async () => {
  console.log(`reading cohort (last ${DAYS} days)...`);
  const data = readCohort();
  const lastDay = data.last_day;
  console.log(`  ${data.seniors.length} seniors, ${data.daily.length} senior-days, ${data.scored.length} scored`);

  const coordinatorIds = [...new Set(data.seniors.map((s) => s.coordinator_id))].sort();
  console.log(`auth accounts for ${coordinatorIds.length} coordinators...`);
  const accounts = await ensureAccounts(coordinatorIds);

  // cohort coordinator_id -> auth user id
  const coordMap = {};
  for (const a of Object.values(accounts)) if (a.maps) coordMap[a.maps] = a.id;

  const c = new pg.Client(cfg);
  await c.connect();
  await c.query("begin");

  try {
    await c.query(`truncate alert_feedback, alerts, risk_scores, note_cues,
      call_notes, checkins, medication_logs, vitals, family_summaries,
      consents, family_links, care_assignments, seniors, audit_log,
      app_users restart identity cascade`);

    await insertMany(c, "app_users", ["id", "role", "full_name"],
      Object.values(accounts).map((a) => [a.id, a.role, a.name]));

    // ---- seniors -------------------------------------------------------
    const ins = await c.query(
      `insert into seniors (display_name, age, sex, city, language)
       select * from unnest($1::text[],$2::int[],$3::text[],$4::text[],$5::text[])
       returning id`,
      [
        data.seniors.map((s) => s.name),
        data.seniors.map((s) => s.age),
        data.seniors.map((s) => s.sex),
        data.seniors.map((s) => s.city),
        data.seniors.map((s) => s.language),
      ],
    );
    const uuid = {};
    data.seniors.forEach((s, i) => { uuid[s.senior_id] = ins.rows[i].id; });
    console.log(`seniors: ${ins.rowCount}`);

    await insertMany(c, "care_assignments", ["coordinator_id", "senior_id"],
      data.seniors
        .filter((s) => coordMap[s.coordinator_id])
        .map((s) => [coordMap[s.coordinator_id], uuid[s.senior_id]]));

    // Family is linked to the highest-scoring senior on the last day, so the
    // family demo lands on someone with something to summarise.
    const top = [...data.scored]
      .filter((r) => r.day === lastDay)
      .sort((a, b) => b.score - a.score)[0];
    const familySenior = top ? top.senior_id : data.seniors[0].senior_id;
    await insertMany(c, "family_links",
      ["family_user_id", "senior_id", "relationship", "is_primary"],
      [[accounts["family@samarth.demo"].id, uuid[familySenior], "daughter", true]]);

    const consentRows = [];
    for (const s of data.seniors) {
      const id = uuid[s.senior_id];
      consentRows.push([id, "family_summary", true, new Date(), "cohort_load"]);
      consentRows.push([id, "urgent_call", true, new Date(), "cohort_load"]);
      consentRows.push([id, "visit_notice", false, null, "cohort_load"]);
      consentRows.push([id, "vitals_sharing", false, null, "cohort_load"]);
    }
    await insertMany(c, "consents",
      ["senior_id", "scope", "granted", "granted_at", "granted_by"], consentRows);

    // ---- signals -------------------------------------------------------
    const vitals = [], checks = [], meds = [];
    for (const d of data.daily) {
      const id = uuid[d.senior_id];
      const on = dayToDate(d.day, lastDay);
      if (d.systolic_bp != null) {
        vitals.push([id, on, "device", d.systolic_bp, d.diastolic_bp, d.pulse_bpm,
                     d.spo2_pct, d.weight_kg, d.glucose_mgdl, d.temperature_c,
                     // Rounded, because a step count with decimals in it
                     // announces that it came from a generator.
                     d.steps == null ? null : Math.round(d.steps)]);
      }
      checks.push([id, on, !!d.checkin_answered,
                   d.feeling_code || null, d.pain_code || null,
                   d.checkin_answered ? d.doses_taken >= d.doses_due / 2 : null]);
      // One row per drug per day rather than per slot: the demo surfaces the
      // daily adherence number, and 6 rows per senior-day is volume without
      // information here.
      //
      // The regimen is per senior and deterministic, not two drugs for all
      // 200. Everybody on the same Amlodipine-and-Metformin pair made the
      // medication-review rules untestable — there is no interaction between
      // those two to find — and it misrepresents the population the brief
      // describes, where polypharmacy is the norm rather than the exception.
      // See REGIMENS above for what is prescribed and why.
      const regimen = regimenFor(d.senior_id);
      regimen.forEach((drug, idx) => {
        // Adherence per drug, worst-first, so the overall daily rate is
        // preserved while individual drugs differ — which is what makes a
        // missed-dose PATTERN visible rather than an average.
        const threshold = 0.4 + (idx * 0.25);
        meds.push([id, on, drug.name, drug.dose,
                   d.doses_taken >= d.doses_due * threshold, "ivr_checkin"]);
      });
    }
    console.log(`vitals: ${await insertMany(c, "vitals",
      ["senior_id","measured_on","source","systolic_bp","diastolic_bp","pulse_bpm","spo2_pct","weight_kg","glucose_mgdl","temperature_c","steps"],
      vitals, "on conflict do nothing")}`);
    console.log(`checkins: ${await insertMany(c, "checkins",
      ["senior_id","checked_on","answered","feeling_code","pain_code","meds_taken"],
      checks, "on conflict do nothing")}`);
    console.log(`medication_logs: ${await insertMany(c, "medication_logs",
      ["senior_id","due_on","drug_name","dose","taken","reported_via"], meds)}`);

    // ---- notes + cues ---------------------------------------------------
    const noteIds = [];
    for (let i = 0; i < data.notes.length; i += 400) {
      const slice = data.notes.slice(i, i + 400);
      const params = [];
      const tuples = slice.map((n) => {
        const vals = [uuid[n.senior_id], dayToDate(n.day, lastDay),
                      coordMap[data.seniors.find((s) => s.senior_id === n.senior_id)?.coordinator_id] || null,
                      true, n.text, "hinglish"];
        return `(${vals.map((v) => { params.push(v); return `$${params.length}`; }).join(",")})`;
      });
      const res = await c.query(
        `insert into call_notes (senior_id, called_on, author_id, reached, note_text, note_lang)
         values ${tuples.join(",")} returning id`, params);
      res.rows.forEach((r, j) => noteIds.push({ id: r.id, note: slice[j] }));
    }
    console.log(`call_notes: ${noteIds.length}`);

    const cueRows = [];
    for (const { id, note } of noteIds) {
      for (const cue of String(note.true_cues || "").split(",").filter(Boolean)) {
        cueRows.push([id, uuid[note.senior_id], dayToDate(note.day, lastDay),
                      cue, false, 0.85, note.text.slice(0, 120), "lexicon_v1"]);
      }
    }
    console.log(`note_cues: ${await insertMany(c, "note_cues",
      ["note_id","senior_id","observed_on","cue","negated","confidence","span_text","extractor"],
      cueRows)}`);

    // ---- risk scores + alerts, straight from the pipeline ---------------
    const scores = data.scored.map((r) => [
      uuid[r.senior_id], dayToDate(r.day, lastDay),
      Math.min(0.9999, Math.max(0, r.score)),
      r.score_rules ?? null, r.score_baseline ?? null,
      r.score_ml ?? null, r.score_anomaly ?? null,
      "layerABC_v1",
      // Written by model/samarth_model/explain for EVERY scored day, not
      // just the surfaced ones, and already through the never-diagnose
      // gate. This used to be a hard-coded empty array, which left all
      // 18,000 rows with no explanation behind their score.
      r.reasons ?? JSON.stringify([]),
    ]);
    console.log(`risk_scores: ${await insertMany(c, "risk_scores",
      ["senior_id","scored_on","score","rules_score","baseline_score","ml_score","nlp_score","model_version","reasons"],
      scores, "on conflict do nothing")}`);

    // ---- alerts, verbatim from the pipeline ------------------------------
    // reason_text and next_step were written by model/samarth_model/explain,
    // which ran every string through the never-diagnose gate. Nothing is
    // regenerated here, so what a coordinator reads is exactly what the model
    // produced and what the metrics were computed on.
    const coordOf = {};
    data.seniors.forEach((s) => { coordOf[s.senior_id] = coordMap[s.coordinator_id] || null; });

    // created_at is set explicitly to the morning the alert was raised. Left
    // to default it would be the load time, every alert would share one
    // timestamp, and "median time to first action" becomes a few seconds —
    // a number the ops dashboard would then display as if it meant something.
    const raisedAt = (day) => {
      const d = new Date(`${dayToDate(day, lastDay)}T03:30:00Z`); // 09:00 IST
      d.setUTCMinutes(d.getUTCMinutes() + Math.floor(Math.random() * 90));
      return d;
    };

    const alertRows = data.alerts.map((a) => [
      uuid[a.senior_id],
      coordOf[a.senior_id],
      dayToDate(a.day, lastDay),
      a.rank_in_day,
      Math.min(0.9999, Math.max(0, a.score)),
      a.reason_text,
      a.next_step,
      a.day === lastDay ? "open" : "actioned",
      !!a.escalated,
      raisedAt(a.day),
    ]);

    const alertIns = [];
    for (let i = 0; i < alertRows.length; i += 400) {
      const slice = alertRows.slice(i, i + 400);
      const params = [];
      const tuples = slice.map(
        (r) => `(${r.map((v) => { params.push(v); return `$${params.length}`; }).join(",")})`,
      );
      const res = await c.query(
        `insert into alerts (senior_id, coordinator_id, raised_on, rank_in_day,
           score, reason_text, next_step, status, escalated, created_at)
         values ${tuples.join(",")} on conflict do nothing
         returning id, status, created_at`,
        params,
      );
      alertIns.push(...res.rows);
    }
    console.log(`alerts: ${alertIns.length}`);

    // Verdicts on past alerts only. Today's stay open: a coordinator has not
    // looked at them yet, and pre-filling them would fabricate the one signal
    // that makes precision measurable at all.
    const fb = alertIns
      .filter((a) => a.status !== "open")
      .map((a, i) => {
        // Right-skewed so the median lands near 45 min rather than the mean
        // being dragged by one senior chased all day.
        const mins = Math.max(3, Math.round(12 + Math.abs(
          Math.sqrt(-2 * Math.log(Math.random() || 1e-9)) * Math.cos(2 * Math.PI * Math.random())
        ) * 48));
        return [
          a.id,
          accounts["coordinator@samarth.demo"].id,
          i % 100 < 71 ? "true_concern" : i % 100 < 89 ? "false_alarm" : "unreachable",
          new Date(new Date(a.created_at).getTime() + mins * 60000),
        ];
      });
    console.log(`alert_feedback: ${await insertMany(c, "alert_feedback",
      ["alert_id", "reviewer_id", "result", "acted_at"], fb, "on conflict do nothing")}`);

    // ---- family summary --------------------------------------------------
    // No family summary is written here any more.
    //
    // It used to insert one hard-coded paragraph, which meant every reload
    // quietly replaced real generated summaries with a fixture — and made the
    // "LLM-generated weekly family summary" stretch goal look done when it
    // was a string literal. The summaries are written by
    //   node scripts/generate-family-summaries.mjs
    // which builds a digest, calls the model, and discards anything the
    // never-diagnose gate rejects. Run it after this script.

    await c.query("commit");
    console.log("\ncommitted.");
    console.log(`family demo senior: ${familySenior}`);
    console.log(`demo password: ${DEMO_PASSWORD}`);
  } catch (e) {
    await c.query("rollback").catch(() => {});
    console.error("\nROLLED BACK:", e.message);
    if (e.detail) console.error("detail:", e.detail);
    process.exitCode = 1;
  } finally {
    await c.end().catch(() => {});
  }
})();
