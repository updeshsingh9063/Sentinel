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


// ---- 5. consent decides what happens ON ITS OWN -----------------------------
// Every senior keeps a number so a coordinator can ring or remind any of
// them. What must NOT follow from that is a machine contacting all of them at
// eight in the morning. The two are separated by consent, and this checks
// that they stayed separated.
console.log("\nconsent, not the number, decides what is automatic");

const withNumbers = (await db.query(
  "select count(*)::int as n from seniors where is_active and phone is not null"
)).rows[0].n;
const consented = (await db.query(
  `select count(*)::int as n from consents c join seniors s on s.id = c.senior_id
    where c.scope = 'auto_call' and c.granted and s.is_active and s.phone is not null`
)).rows[0].n;

check("several seniors are reachable by a coordinator", withNumbers > 1, String(withNumbers));
check("but only one is enrolled in automatic calls", consented === 1, consented + " of " + withNumbers);

const targets = (await db.query(
  "select senior_id from autocall_targets($1, current_date)", [ENV.TELEPHONY_SECRET]
)).rows;
check("the morning round would dial at most that one", targets.length <= 1, targets.length + " targets");

const guessed = (await db.query(
  "select count(*)::int as n from autocall_targets($1, current_date)", ["not-the-secret"]
)).rows[0].n;
check("and a wrong secret gets no targets at all", guessed === 0, String(guessed));

await db.query("delete from medicine_reminder_log where sent_on = current_date and slot = '08:00'");
await db.query("delete from family_notifications where kind = 'reminder' and created_at >= current_date");
const eight = await rpc("queue_medicine_reminders", { p_secret: ENV.TELEPHONY_SECRET, p_slot: "08:00" });
check("the 08:00 round queues exactly one reminder", eight.body?.queued === 1, JSON.stringify(eight.body));

// ---- 6. the coordinator's button is NOT bound by it -------------------------
console.log("\nthe coordinator's own button");

const notConsented = (await db.query(
  `select s.id, s.display_name from seniors s
     join care_assignments ca on ca.senior_id = s.id
    where s.is_active and s.phone is not null
      and not exists (select 1 from consents c
                       where c.senior_id = s.id and c.scope = 'auto_reminder' and c.granted)
    limit 1`
)).rows[0];
check("there is a senior the scheduler will never text", !!notConsented, "none found");

if (notConsented) {
  const tok = await fetch(URL_ + "/auth/v1/token?grant_type=password", {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: ENV.OWNER_EMAIL, password: ENV.OWNER_PASSWORD }),
  }).then((r) => r.json()).then((j) => j.access_token);

  const byHand = await rpc("send_reminder_now", { p_senior_id: notConsented.id }, ANON, tok);
  check("a coordinator can still remind them by hand", byHand.body?.ok === true, JSON.stringify(byHand.body));

  const anonHand = await rpc("send_reminder_now", { p_senior_id: notConsented.id });
  check("anon cannot", anonHand.status >= 400 || anonHand.body?.ok === false,
    anonHand.status + " " + JSON.stringify(anonHand.body));

  // Four a day: a human can mistake a button for an unresponsive one and
  // press it six times, and six texts in a minute is not a reminder.
  for (let i = 0; i < 4; i++) await rpc("send_reminder_now", { p_senior_id: notConsented.id }, ANON, tok);
  const capped = await rpc("send_reminder_now", { p_senior_id: notConsented.id }, ANON, tok);
  check("but not six times in a minute",
    capped.body?.ok === false && capped.body?.reason === "too_many_today", JSON.stringify(capped.body));

  await db.query("delete from family_notifications where senior_id = $1 and kind = 'reminder'", [notConsented.id]);
}

await db.query("delete from medicine_reminder_log where sent_on = current_date and slot = '08:00'");
await db.query("delete from family_notifications where kind = 'reminder' and created_at >= current_date");

await db.end();

console.log(failures === 0 ? "\nreminders and the emergency button hold\n" : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
