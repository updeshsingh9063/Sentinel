/**
 * Prove the errand loop: somebody asks, a human arranges it, somebody
 * confirms it happened.
 *
 * The last step is the one being tested. Raising a request is easy and most
 * prototypes stop there; what a family wants to know is whether the thing got
 * done, so `arranged` and `confirmed` are separate states and this asserts
 * that the first does not silently count as the second.
 *
 * Also covers the SOS channel, which must work with no app, no session and no
 * credential on the device — and must refuse to tell that device whose button
 * it was.
 *
 * Usage, from frontend/ with the dev server running:
 *   node scripts/verify-assistance.mjs
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
const SITE = ENV.VERIFY_SITE || "http://localhost:3000";
const SOS = ENV.SOS_SECRET;
const OWNER = ENV.OWNER_EMAIL;
const OWNER_PW = ENV.OWNER_PASSWORD;
const DEMO_PW = ENV.DEMO_PASSWORD || "SamarthDemo!2026";

if (!URL_ || !ANON) {
  console.error("need NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY");
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

const rpc = (fn, args, token) =>
  fetch(`${URL_}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: ANON,
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(args),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

const signIn = (email, password) =>
  fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  })
    .then((r) => r.json())
    .then((j) => j.access_token ?? null);

const rest = (q, init = {}, token) =>
  fetch(`${URL_}/rest/v1/${q}`, {
    ...init,
    headers: {
      apikey: ANON,
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

console.log(`\nverifying the errand loop against ${URL_}\n`);

// ---- 1. a senior asks for something, from the public page ----------------
console.log("somebody asks (anon, no session)");
const asked = await rpc("record_demo_request", {
  p_kind: "medicine",
  p_urgent: false,
  p_said: "बेटा, मेरी दवाई खत्म हो गई है",
  p_summary: "Medicines have run out",
});
check("the request is accepted", asked.body?.ok === true, JSON.stringify(asked.body));
check("it is filed as a medicine errand", asked.body?.kind === "medicine", JSON.stringify(asked.body));
const reqId = asked.body?.id;

// Saying the same thing twice in one call is one errand, not two.
const again = await rpc("record_demo_request", {
  p_kind: "medicine",
  p_urgent: true,
  p_said: "दवाई खत्म हो गई है",
  p_summary: "Medicines have run out, and they sound worried",
});
check("saying it twice does not make two errands", again.body?.id === reqId, `${reqId} vs ${again.body?.id}`);

// ---- 2. an unknown kind must not lose the request ------------------------
const odd = await rpc("record_demo_request", {
  p_kind: "something_the_schema_never_heard_of",
  p_urgent: false,
  p_said: "x",
  p_summary: "Wants the fan fixed",
});
check("an unrecognised kind lands as 'other', not lost", odd.body?.ok === true && odd.body?.kind === "other", JSON.stringify(odd.body));

const empty = await rpc("record_demo_request", {
  p_kind: "medicine", p_urgent: false, p_said: "x", p_summary: "   ",
});
check("a request with nothing in it is refused", empty.body?.ok === false, JSON.stringify(empty.body));

// ---- 3. the SOS button ---------------------------------------------------
console.log("\nthe emergency button");
if (!SOS) {
  console.log("  ..    SOS_SECRET not in .env.local, skipping");
} else {
  const bad = await fetch(`${SITE}/api/sos`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-sos-secret": "not-the-secret-at-all" },
    body: JSON.stringify({ from: "+919000000115" }),
  });
  check("a wrong secret is refused", bad.status === 401, `status=${bad.status}`);

  const unknown = await fetch(`${SITE}/api/sos`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-sos-secret": SOS },
    body: JSON.stringify({ from: "+910000000000" }),
  });
  check("an unenrolled number is refused", unknown.status === 404, `status=${unknown.status}`);

  // The real press, form-encoded the way a telephony provider posts.
  const token0 = OWNER && OWNER_PW ? await signIn(OWNER, OWNER_PW) : null;
  const line = token0
    ? (await rest("seniors?demo_line=is.true&select=id,phone", {}, token0)).body?.[0]
    : null;

  if (!line?.phone) {
    console.log("  ..    could not read the demo line's number, skipping the press");
  } else {
    const press = await fetch(`${SITE}/api/sos?key=${encodeURIComponent(SOS)}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ CallFrom: line.phone }).toString(),
    });
    const pressBody = await press.json().catch(() => null);
    check("a real press is accepted", press.status === 200 && pressBody?.ok === true, `status=${press.status} ${JSON.stringify(pressBody)}`);
    check(
      "the device is not told whose button it was",
      pressBody && !("senior_name" in pressBody) && !("id" in pressBody),
      JSON.stringify(pressBody),
    );

    // Pressing twice is one emergency, not two rows for a human to reconcile.
    await fetch(`${SITE}/api/sos?key=${encodeURIComponent(SOS)}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ CallFrom: line.phone }).toString(),
    });
    const open = token0
      ? await rest(`assistance_requests?senior_id=eq.${line.id}&kind=eq.emergency&state=in.(open,arranged)&select=id`, {}, token0)
      : { body: [] };
    check("pressing twice raises one emergency", open.body?.length === 1, `count=${open.body?.length}`);
  }
}

// ---- 4. containment ------------------------------------------------------
console.log("\ncontainment");
{
  const anonRead = await rest("assistance_requests?select=id&limit=1");
  check(
    "anon cannot read the queue",
    anonRead.status >= 400 || (Array.isArray(anonRead.body) && anonRead.body.length === 0),
    `status=${anonRead.status} body=${JSON.stringify(anonRead.body)?.slice(0, 80)}`,
  );

  const famToken = await signIn("family@samarth.demo", DEMO_PW);
  const fam = await rest("assistance_requests?select=id,said&limit=5", {}, famToken);
  check(
    "a family member reads none of it",
    Array.isArray(fam.body) && fam.body.length === 0,
    `count=${fam.body?.length} status=${fam.status}`,
  );

  const opsToken = await signIn("ops@samarth.demo", DEMO_PW);
  const ops = await rest("assistance_requests?select=id,said&limit=5", {}, opsToken);
  check(
    "operations reads none of it either",
    Array.isArray(ops.body) && ops.body.length === 0,
    `count=${ops.body?.length} status=${ops.status}`,
  );
}

// ---- 5. the loop closes --------------------------------------------------
console.log("\nthe coordinator works the queue");
if (!OWNER || !OWNER_PW) {
  console.log("  ..    OWNER_EMAIL / OWNER_PASSWORD not in .env.local, skipping");
} else {
  const token = await signIn(OWNER, OWNER_PW);
  check("the coordinator can sign in", !!token, "no access token");

  const queue = await rest(
    "assistance_requests?state=in.(open,arranged)&select=id,kind,said,summary,state&order=created_at.asc",
    {},
    token,
  );
  check("the request is on their queue", (queue.body ?? []).some((r) => r.id === reqId), `ids=${JSON.stringify((queue.body ?? []).map((r) => r.id))}`);
  check(
    "their own words are on it, not just a paraphrase",
    (queue.body ?? []).find((r) => r.id === reqId)?.said?.includes("दवाई"),
    JSON.stringify((queue.body ?? []).find((r) => r.id === reqId)?.said),
  );

  // Arrange it.
  const arrange = await rest(`assistance_requests?id=eq.${reqId}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      state: "arranged",
      arranged_at: new Date().toISOString(),
      arranged_note: "Rang the chemist, delivery tomorrow morning",
    }),
  }, token);
  check("a coordinator can arrange it", arrange.body?.[0]?.state === "arranged", JSON.stringify(arrange.body)?.slice(0, 120));

  // THE POINT: arranged is not done.
  const tally = await rest("assistance_requests?state=eq.confirmed&id=eq." + reqId + "&select=id", {}, token);
  check("arranged does NOT count as confirmed", (tally.body ?? []).length === 0, JSON.stringify(tally.body));

  const confirm = await rest(`assistance_requests?id=eq.${reqId}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ state: "confirmed", confirmed_at: new Date().toISOString() }),
  }, token);
  check("confirming closes it", confirm.body?.[0]?.state === "confirmed", JSON.stringify(confirm.body)?.slice(0, 120));
  check("the note survived", confirm.body?.[0]?.arranged_note?.includes("chemist"), JSON.stringify(confirm.body?.[0]?.arranged_note));

  const gone = await rest("assistance_requests?state=in.(open,arranged)&id=eq." + reqId + "&select=id", {}, token);
  check("it leaves the queue once confirmed", (gone.body ?? []).length === 0, JSON.stringify(gone.body));

  // ---- 6. the verdict button now writes ---------------------------------
  console.log("\nthe verdict actually records");
  const alert = await rest("alerts?select=id,senior_id&order=raised_on.desc&limit=1", {}, token);
  const alertId = alert.body?.[0]?.id;
  if (!alertId) {
    console.log("  ..    no alerts on this caseload, skipping");
  } else {
    const wrote = await rest("alert_feedback", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({ alert_id: alertId, result: "true_concern", acted_at: new Date().toISOString() }),
    }, token);
    check(
      "a coordinator's verdict is stored",
      wrote.status < 400 && wrote.body?.[0]?.result === "true_concern",
      `status=${wrote.status} ${JSON.stringify(wrote.body)?.slice(0, 120)}`,
    );

    const back = await rest(`alert_feedback?alert_id=eq.${alertId}&select=result`, {}, token);
    check("and reads back", back.body?.[0]?.result === "true_concern", JSON.stringify(back.body));
  }
}

console.log(failures === 0 ? "\nthe errand loop holds\n" : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
