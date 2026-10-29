/**
 * Prove the forgot-password flow, without waiting for an email.
 *
 * Email is the slowest and least reliable part of this to test by hand: the
 * project's free tier sends a few messages an hour, so "click the link and
 * see" is a test you can run about twice before it stops working. The admin
 * API can mint exactly the link the email would have contained, which makes
 * the whole path testable in seconds and repeatable in CI.
 *
 * What it asserts, end to end:
 *   - a recovery link turns into a real session
 *   - that session can change the password
 *   - the new password works and the old one stops working
 *   - the link is single-use, so a forwarded or leaked email is spent
 *   - our own /auth/callback accepts the link and sends the browser to the
 *     page that asks for a new password, not to the role's home page
 *
 * It creates a throwaway account and deletes it again, so it leaves nothing
 * behind. This one DOES need the service-role key, because minting a link
 * without sending mail is an administrative act by definition -- which is
 * also why it is a local script and not a route.
 *
 * Usage, from frontend/:
 *   node scripts/verify-reset.mjs [--url https://your-deployment]
 *   node scripts/verify-reset.mjs --send     # also spends one real email
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
const SERVICE = ENV.SUPABASE_SERVICE_ROLE_KEY;
const argUrl = process.argv.indexOf("--url");
const DEPLOY = argUrl > -1 ? process.argv[argUrl + 1].replace(/\/$/, "") : null;
const SEND = process.argv.includes("--send");

if (!URL_ || !ANON || !SERVICE) {
  console.error("need NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

let failures = 0;
function check(label, ok, detail) {
  if (ok) console.log(`  PASS  ${label}`);
  else { failures += 1; console.log(`  FAIL  ${label}  -> ${detail}`); }
}

const admin = (p, init = {}) =>
  fetch(`${URL_}/auth/v1${p}`, {
    ...init,
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

const pub = (p, init = {}) =>
  fetch(`${URL_}/auth/v1${p}`, {
    ...init,
    headers: { apikey: ANON, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });

const signIn = (email, password) =>
  pub("/token?grant_type=password", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });

const tag = Math.random().toString(36).slice(2, 10);
const EMAIL = `reset-probe-${tag}@samarth.demo`;
const OLD = "OldPassword!2026";
const NEW = "BrandNewPassword!2026";

console.log(`\nverifying the password reset flow against ${URL_}\n`);
console.log(`  ..    throwaway account ${EMAIL}`);

let userId = null;
try {
  // ---- 1. an account that exists and can sign in -------------------------
  {
    // email_confirm skips the confirmation mail: creating the probe must not
    // spend any of the project's hourly email budget.
    const r = await admin("/admin/users", {
      method: "POST",
      body: JSON.stringify({ email: EMAIL, password: OLD, email_confirm: true }),
    });
    const body = await r.json();
    userId = body.id ?? null;
    check("throwaway account created", r.ok && !!userId, JSON.stringify(body).slice(0, 160));
    const s = await signIn(EMAIL, OLD);
    check("the old password works to begin with", s.ok, `status=${s.status}`);
  }

  // ---- 2. the link the email would have carried --------------------------
  let tokenHash = null;
  {
    const r = await admin("/admin/generate_link", {
      method: "POST",
      body: JSON.stringify({
        type: "recovery",
        email: EMAIL,
        options: { redirect_to: `${DEPLOY ?? "http://localhost:3000"}/auth/callback?flow=recovery` },
      }),
    });
    const body = await r.json();
    tokenHash = body.hashed_token ?? body.properties?.hashed_token ?? null;
    check("a recovery link can be minted", r.ok && !!tokenHash, JSON.stringify(body).slice(0, 200));
  }

  // ---- 3. the link becomes a session, and the session changes the password
  let recoveryToken = null;
  if (tokenHash) {
    const r = await pub("/verify", {
      method: "POST",
      body: JSON.stringify({ type: "recovery", token_hash: tokenHash }),
    });
    const body = await r.json();
    recoveryToken = body.access_token ?? null;
    check("the link turns into a session", r.ok && !!recoveryToken, JSON.stringify(body).slice(0, 160));

    // SINGLE USE. A reset email that stays valid is a permanent key sitting
    // in a mailbox; a forwarded one is an account takeover.
    const again = await pub("/verify", {
      method: "POST",
      body: JSON.stringify({ type: "recovery", token_hash: tokenHash }),
    });
    check("the same link cannot be used twice", !again.ok, `status=${again.status}`);
  }

  if (recoveryToken) {
    const r = await pub("/user", {
      method: "PUT",
      headers: { Authorization: `Bearer ${recoveryToken}` },
      body: JSON.stringify({ password: NEW }),
    });
    check("the recovery session can set a new password", r.ok, `status=${r.status}`);
  }

  // ---- 4. the change actually took -------------------------------------
  {
    const good = await signIn(EMAIL, NEW);
    check("the new password works", good.ok, `status=${good.status}`);
    const bad = await signIn(EMAIL, OLD);
    check("the old password no longer works", !bad.ok, `status=${bad.status}`);
  }

  // ---- 5. our own callback routes the link to the right place -----------
  if (DEPLOY) {
    console.log(`\nthe callback at ${DEPLOY}`);
    const r2 = await admin("/admin/generate_link", {
      method: "POST",
      body: JSON.stringify({
        type: "recovery",
        email: EMAIL,
        options: { redirect_to: `${DEPLOY}/auth/callback?flow=recovery` },
      }),
    });
    const b2 = await r2.json();
    const th = b2.hashed_token ?? b2.properties?.hashed_token;
    const hit = await fetch(
      `${DEPLOY}/auth/callback?flow=recovery&type=recovery&token_hash=${encodeURIComponent(th)}`,
      { redirect: "manual" },
    );
    const loc = hit.headers.get("location") ?? "";
    check("a recovery link redirects to the new-password form",
          loc.includes("/signin?flow=reset"), `status=${hit.status} location=${loc}`);
    // The session has to travel with that redirect, or the form it lands on
    // has nothing to authenticate the password change with.
    check("the session cookie travels with it",
          (hit.headers.getSetCookie?.() ?? []).some((c) => c.includes("auth-token")),
          JSON.stringify(hit.headers.getSetCookie?.() ?? []).slice(0, 120));

    const stale = await fetch(
      `${DEPLOY}/auth/callback?flow=recovery&type=recovery&token_hash=definitely-not-a-real-token`,
      { redirect: "manual" },
    );
    const loc2 = stale.headers.get("location") ?? "";
    check("a dead link lands on the form with an explanation, not a blank page",
          loc2.includes("flow=reset") && loc2.includes("expired=1"), `location=${loc2}`);
  }

  // ---- 6. the public endpoint does not reveal who is registered ---------
  // Off by default: each call spends one of the project's hourly emails, and
  // leaving it on would make the rest of this script unrunnable.
  if (SEND) {
    console.log("\nenumeration (spends two real emails)");
    const known = await pub("/recover", { method: "POST", body: JSON.stringify({ email: EMAIL }) });
    const unknown = await pub("/recover", {
      method: "POST",
      body: JSON.stringify({ email: `nobody-${tag}@samarth.demo` }),
    });
    check("a registered and an unregistered address answer alike",
          known.status === unknown.status, `${known.status} vs ${unknown.status}`);
  }
} finally {
  if (userId) {
    const r = await admin(`/admin/users/${userId}`, { method: "DELETE" });
    check("throwaway account removed", r.ok, `status=${r.status}`);
  }
}

console.log(failures ? `\n${failures} FAILURE(S)\n` : "\nthe password reset flow holds\n");
process.exit(failures ? 1 : 0);
