/**
 * Prove the medicine reminders and the emergency button.
 *
 * Both of these send a message to a real telephone, so both are places where
 * a system can lie cheaply: mark something "sent" that was never attempted,
 * or tell somebody in trouble that help is coming when no record of the
 * alarm exists anywhere.
 *
 * What this checks:
 *   · a reminder is queued once per slot per day, however often the job runs
 *   · the text carries no drug names — an SMS is readable by the household
 *   · an emergency reaches the COORDINATOR'S telephone, not just a screen
 *   · it puts the senior at the top of today's list, above the model
 *   · a second press escalates to staff without re-alarming the family
 *   · anon can do none of it
 *
 * NOTHING HERE SENDS. Messages are queued and inspected, then cleaned up;
 * dispatch is a separate route and is not called.
 *
 * Usage, from frontend/:
 *   node scripts/verify-reminders-sos.mjs
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

const rpc = (fn, args, key = ANON, bearer = null) =>
  fetch(`${URL_}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: key,
      "Content-Type": "application/json",
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify(args),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

const db = new pg.Client({
  host: ENV.SUPABASE_DB_HOST,
  port: Number(ENV.SUPABASE_DB_PORT || 5432),
  database: ENV.SUPABASE_DB_NAME || "postgres",
  user: ENV.SUPABASE_DB_USER || "postgres",
  password: ENV.SUPABASE_DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
});
await db.connect();

console.log("\nverifying medicine reminders and the emergency button\n");

// A slot nothing uses, so a real schedule is never disturbed.
const SLOT = "04:17";
const line = (await db.query("select id, display_name, phone from seniors where demo_line limit 1")).rows[0];
check("there is a demo line to test against", !!line?.phone, JSON.stringify(line));

// Clean slate for this slot only.
await db.query("delete from medicine_reminder_log where slot = $1", [SLOT]);
await db.query(
  "delete from family_notifications where kind = 'reminder' and senior_id = $1",
  [line.id],
);
await db.query(
  "update senior_routine set med_times = med_times || $2::time where senior_id = $1 and not ($2::time = any(med_times))",
  [line.id, SLOT],
);

// ---- 1. reminders ----------------------------------------------------------
console.log("medicine reminders");

const noSecret = await rpc("queue_medicine_reminders", { p_secret: "guess", p_slot: SLOT });
check(
  "a wrong secret queues nothing",
  noSecret.body?.ok === false && noSecret.body?.reason === "unauthorized",
  JSON.stringify(noSecret.body),
);

const first = await rpc("queue_medicine_reminders", { p_secret: ENV.TELEPHONY_SECRET, p_slot: SLOT });
check("the slot queues at least one reminder", (first.body?.queued ?? 0) >= 1, JSON.stringify(first.body));

const again = await rpc("queue_medicine_reminders", { p_secret: ENV.TELEPHONY_SECRET, p_slot: SLOT });
check(
  "running it twice does not send twice",
  again.body?.ok === true && again.body?.queued === 0,
  JSON.stringify(again.body),
);

const msg = (
  await db.query(
    `select body, to_phone, recipient, channel, state from family_notifications
      where senior_id = $1 and kind = 'reminder' order by id desc limit 1`,
    [line.id],
  )
).rows[0];
check("it is addressed to the senior's own number", msg?.to_phone === line.phone, JSON.stringify(msg));
check("marked as going to the senior", msg?.recipient === "senior", `recipient=${msg?.recipient}`);
check("queued, not pretend-sent", msg?.state === "queued", `state=${msg?.state}`);

// A text sits in a handset the whole household can pick up.
const drugs = (await db.query("select distinct drug_name from medication_logs where senior_id = $1", [line.id])).rows;
check(
  "the message names no medicines",
  drugs.every((d) => !(msg?.body ?? "").toLowerCase().includes(String(d.drug_name).toLowerCase())),
  msg?.body,
);
check("but it does name the person", (msg?.body ?? "").includes(line.display_name.split(" ")[0]), msg?.body);
console.log(`  ..    "${msg?.body}"`);

// ---- 2. the emergency button -----------------------------------------------
console.log("\nthe emergency button");

// Start from nothing outstanding, so "first press" means first press.
await db.query(
  "update assistance_requests set state = 'cancelled' where senior_id = $1 and kind = 'emergency' and state in ('open','arranged')",
  [line.id],
);
await db.query("delete from family_notifications where senior_id = $1 and kind = 'emergency'", [line.id]);
await db.query("delete from alerts where senior_id = $1 and raised_on = current_date", [line.id]);

// Coordinators need a number for the message to have anywhere to go.
await db.query(
  `update app_users set phone = coalesce(phone, $2)
    where id in (select coordinator_id from care_assignments where senior_id = $1)`,
  [line.id, "+919000000001"],
);

const anonSos = await rpc("raise_sos_demo", { p_secret: "guess" });
check(
  "a guessed secret raises nothing",
  anonSos.body?.ok === false && anonSos.body?.reason === "unauthorized",
  JSON.stringify(anonSos.body),
);

const press1 = await rpc("raise_sos_demo", { p_secret: ENV.SOS_SECRET });
check("the first press is accepted", press1.body?.ok === true && press1.body?.first === true, JSON.stringify(press1.body));

const errand = (
  await db.query(
    "select kind, urgent, state from assistance_requests where senior_id = $1 and kind = 'emergency' and state = 'open'",
    [line.id],
  )
).rows[0];
check("an urgent errand is on the coordinator's queue", errand?.urgent === true, JSON.stringify(errand));

const toCoord = (
  await db.query(
    `select body, to_phone, recipient from family_notifications
      where senior_id = $1 and kind = 'emergency' and recipient = 'coordinator'`,
    [line.id],
  )
).rows;
check("the coordinator is messaged on their own telephone", toCoord.length >= 1, JSON.stringify(toCoord));
check("and the message says it is an emergency", /EMERGENCY/.test(toCoord[0]?.body ?? ""), toCoord[0]?.body);
check("addressed to a real number", !!toCoord[0]?.to_phone, JSON.stringify(toCoord[0]));

const toFamily = (
  await db.query(
    `select body, recipient from family_notifications
      where senior_id = $1 and kind = 'emergency' and recipient = 'family'`,
    [line.id],
  )
).rows;
check("the family is warned too", toFamily.length >= 1, JSON.stringify(toFamily));
check(
  "and the family message does not promise an ambulance",
  !/ambulance|108|एम्बुलेंस/i.test(toFamily[0]?.body ?? ""),
  toFamily[0]?.body,
);

const alert = (
  await db.query(
    "select rank_in_day, score, reason_text, status from alerts where senior_id = $1 and raised_on = current_date",
    [line.id],
  )
).rows[0];
check("they are at the top of today's list", alert?.rank_in_day === 0, JSON.stringify(alert));
check("above anything the model produced", Number(alert?.score) === 1, `score=${alert?.score}`);
check("with a reason a human can read", /[Ee]mergency/.test(alert?.reason_text ?? ""), alert?.reason_text);

// ---- 3. a second press ------------------------------------------------------
const press2 = await rpc("raise_sos_demo", { p_secret: ENV.SOS_SECRET });
check("a second press is accepted", press2.body?.ok === true, JSON.stringify(press2.body));
check("and is NOT treated as a new alarm", press2.body?.first === false, JSON.stringify(press2.body));

const famAfter = (
  await db.query(
    "select count(*)::int as n from family_notifications where senior_id = $1 and kind = 'emergency' and recipient = 'family'",
    [line.id],
  )
).rows[0].n;
check("the family is not alarmed a second time", famAfter === toFamily.length, `${toFamily.length} then ${famAfter}`);

const coordAfter = (
  await db.query(
    "select count(*)::int as n from family_notifications where senior_id = $1 and kind = 'emergency' and recipient = 'coordinator'",
    [line.id],
  )
).rows[0].n;
check("but staff ARE told again", coordAfter > toCoord.length, `${toCoord.length} then ${coordAfter}`);

const second = (
  await db.query(
    `select body from family_notifications where senior_id = $1 and kind = 'emergency'
       and recipient = 'coordinator' order by id desc limit 1`,
    [line.id],
  )
).rows[0];
check("and told that nobody has reached them", /again/i.test(second?.body ?? ""), second?.body);

// ---- 4. tidy up -------------------------------------------------------------
await db.query("delete from medicine_reminder_log where slot = $1", [SLOT]);
await db.query("delete from family_notifications where senior_id = $1 and kind in ('reminder','emergency')", [line.id]);
await db.query(
  "update senior_routine set med_times = array_remove(med_times, $2::time) where senior_id = $1",
  [line.id, SLOT],
);
await db.query(
  "update assistance_requests set state = 'cancelled' where senior_id = $1 and kind = 'emergency' and state = 'open'",
  [line.id],
);
await db.query("delete from alerts where senior_id = $1 and raised_on = current_date and score = 1", [line.id]);
await db.end();

console.log(failures === 0 ? "\nreminders and the emergency button hold\n" : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
