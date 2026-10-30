/**
 * Prove the family gate: consent decides, and nothing leaks around it.
 *
 * The important assertion is not "a message was queued". It is that when
 * consent is OFF the message is withheld, the withholding is recorded, and
 * the family member cannot then read the row that was withheld from them.
 * The first version of the read policy failed exactly that last check — it
 * handed them the suppressed row, body and all, which is a gate that gates
 * nothing.
 *
 * Also asserts the thing it would be easiest to fake: a queued message is
 * never reported as sent while no provider is configured.
 *
 * Usage, from frontend/ with the dev server running:
 *   node scripts/verify-notify.mjs
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
const OWNER = ENV.OWNER_EMAIL;
const OWNER_PW = ENV.OWNER_PASSWORD;
const DEMO_PW = ENV.DEMO_PASSWORD || "SamarthDemo!2026";

let failures = 0;
function check(label, ok, detail) {
  if (ok) console.log(`  PASS  ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${label}  -> ${detail}`);
  }
}

const signIn = (email, password) =>
  fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  })
    .then((r) => r.json())
    .then((j) => j.access_token ?? null);

const H = (t) => ({ apikey: ANON, Authorization: `Bearer ${t}`, "Content-Type": "application/json" });
const read = (q, t) => fetch(`${URL_}/rest/v1/${q}`, { headers: H(t) }).then((r) => r.json());
const rpc = (fn, args, t) =>
  fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: "POST", headers: H(t), body: JSON.stringify(args) }).then(
    async (r) => ({ status: r.status, body: await r.json().catch(() => null) }),
  );
const patch = (q, body, t) =>
  fetch(`${URL_}/rest/v1/${q}`, {
    method: "PATCH",
    headers: { ...H(t), Prefer: "return=representation" },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

console.log(`\nverifying the family gate against ${URL_}\n`);

const coord = await signIn(OWNER, OWNER_PW);
const fam = await signIn("family@samarth.demo", DEMO_PW);
check("coordinator and family can both sign in", !!coord && !!fam, `coord=${!!coord} fam=${!!fam}`);

// The senior the demo family member is actually linked to.
const link = (await read("family_links?select=senior_id&limit=1", fam))[0];
check("the family member is linked to a senior", !!link?.senior_id, JSON.stringify(link));
const sid = link?.senior_id;

async function setConsent(scope, granted) {
  await fetch(`${URL_}/rest/v1/consents`, {
    method: "POST",
    headers: { ...H(fam), Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ senior_id: sid, scope, granted, granted_by: "verify" }),
  });
}

// ---- 1. the switch itself writes -----------------------------------------
console.log("\nthe consent switch");
await setConsent("urgent_call", true);
let row = (await read(`consents?senior_id=eq.${sid}&scope=eq.urgent_call&select=granted`, fam))[0];
check("a family member can turn consent on", row?.granted === true, JSON.stringify(row));
await setConsent("urgent_call", false);
row = (await read(`consents?senior_id=eq.${sid}&scope=eq.urgent_call&select=granted`, fam))[0];
check("and off again", row?.granted === false, JSON.stringify(row));

// ---- 2. consent off: withheld, recorded, and unreadable ------------------
console.log("\nconsent off");
const held = await rpc("notify_family", { p_senior: sid, p_kind: "emergency", p_body: "VERIFY-OFF emergency body" }, coord);
check("the gate withholds it", held.body?.queued === 0 && held.body?.withheld > 0, JSON.stringify(held.body));

const audit = await read(
  `family_notifications?senior_id=eq.${sid}&state=eq.suppressed&select=id,reason,body&order=created_at.desc&limit=1`,
  coord,
);
check("the coordinator can see it was withheld", audit[0]?.state !== undefined || !!audit[0]?.reason, JSON.stringify(audit[0]));
check("and why", /No consent recorded/.test(audit[0]?.reason ?? ""), JSON.stringify(audit[0]?.reason));

// THE ONE THAT MATTERS.
const leak = await read(
  `family_notifications?select=id,body,state&order=created_at.desc&limit=20`,
  fam,
);
const leaked = (Array.isArray(leak) ? leak : []).filter(
  (n) => n.state === "suppressed" || /VERIFY-OFF/.test(n.body ?? ""),
);
check(
  "the family member cannot read what was withheld from them",
  leaked.length === 0,
  `they could read ${leaked.length} suppressed row(s): ${JSON.stringify(leaked.slice(0, 1))}`,
);

// ---- 3. consent on: queued, and readable by them -------------------------
console.log("\nconsent on");
await setConsent("urgent_call", true);
const sent = await rpc("notify_family", { p_senior: sid, p_kind: "emergency", p_body: "VERIFY-ON emergency body" }, coord);
check("the gate lets it through", (sent.body?.queued ?? 0) > 0 && sent.body?.withheld === 0, JSON.stringify(sent.body));

const theirs = await read(`family_notifications?select=id,body,state&order=created_at.desc&limit=5`, fam);
check(
  "the family member can read their own queued message",
  (Array.isArray(theirs) ? theirs : []).some((n) => /VERIFY-ON/.test(n.body ?? "")),
  JSON.stringify(theirs)?.slice(0, 160),
);

// ---- 4. nothing is claimed as delivered ----------------------------------
console.log("\ndelivery is not claimed");
const dispatch = await fetch(`${SITE}/api/notify/dispatch`, { method: "GET" }).then((r) => r.json());
check("the route reports which provider it has", "provider" in dispatch, JSON.stringify(dispatch));
check(
  "with no provider configured it says none",
  dispatch.provider === "none" || !!ENV.TWILIO_ACCOUNT_SID,
  JSON.stringify(dispatch),
);

const stillQueued = await read(
  `family_notifications?senior_id=eq.${sid}&body=like.*VERIFY-ON*&select=state`,
  coord,
);
check(
  "a queued message is never recorded as sent",
  (stillQueued ?? []).every((n) => n.state !== "sent") || !!ENV.TWILIO_ACCOUNT_SID,
  JSON.stringify(stillQueued),
);

// ---- 5. containment -------------------------------------------------------
console.log("\ncontainment");
const anonH = { apikey: ANON, "Content-Type": "application/json" };
const anonRead = await fetch(`${URL_}/rest/v1/family_notifications?select=id&limit=1`, { headers: anonH });
const anonBody = await anonRead.json().catch(() => null);
check(
  "anon reads none of it",
  anonRead.status >= 400 || (Array.isArray(anonBody) && anonBody.length === 0),
  `status=${anonRead.status} ${JSON.stringify(anonBody)?.slice(0, 80)}`,
);

const anonNotify = await fetch(`${URL_}/rest/v1/rpc/notify_family`, {
  method: "POST",
  headers: anonH,
  body: JSON.stringify({ p_senior: sid, p_kind: "emergency", p_body: "x" }),
});
check("anon cannot send on somebody's behalf", anonNotify.status >= 400, `status=${anonNotify.status}`);

const famWrite = await patch(
  `family_notifications?body=like.*VERIFY-ON*`,
  { state: "sent" },
  fam,
);
const famChanged = Array.isArray(famWrite.body) && famWrite.body.length > 0;
check("a family member cannot mark their own message sent", !famChanged, JSON.stringify(famWrite.body)?.slice(0, 120));

// Leave the demo in a sensible state.
await setConsent("urgent_call", true);

console.log(failures === 0 ? "\nthe family gate holds\n" : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
