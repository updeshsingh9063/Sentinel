/**
 * Report the hosted project's auth configuration.
 *
 * Two of these settings cannot be changed from code — they live in the
 * Supabase dashboard — and both silently break sign-up when wrong, so this
 * exists to tell you which one is at fault rather than leaving you reading
 * "email rate limit exceeded" and guessing.
 *
 *   cd frontend && npm run check:auth
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Read straight from .env.local so this works without exporting anything.
function env(name) {
  if (process.env[name]) return process.env[name];
  const file = path.join(HERE, "..", ".env.local");
  if (!fs.existsSync(file)) return undefined;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const [k, ...rest] = line.split("=");
    if (k?.trim() === name) return rest.join("=").trim();
  }
  return undefined;
}

const url = env("NEXT_PUBLIC_SUPABASE_URL");
const anon = env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
if (!url || !anon) {
  console.error("missing NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY");
  process.exit(1);
}

const ref = new URL(url).hostname.split(".")[0];
const settings = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: anon } })
  .then((r) => r.json());

const ext = settings.external || {};
const line = (ok, label, detail) =>
  console.log(`  ${ok ? "ok  " : "TODO"} ${label.padEnd(28)} ${detail}`);

console.log(`project ${ref}\n`);

line(
  settings.mailer_autoconfirm === true,
  "email confirmation off",
  settings.mailer_autoconfirm
    ? "sign-up signs in immediately"
    : "ON — new sign-ups must confirm by email, and the free tier sends only a few an hour",
);

line(
  settings.disable_signup === false,
  "public sign-up allowed",
  settings.disable_signup ? "DISABLED" : "enabled",
);

line(Boolean(ext.google), "google provider", ext.google ? "enabled" : "not enabled");

console.log(
  `\n  providers enabled: ${Object.entries(ext).filter(([, v]) => v).map(([k]) => k).join(", ") || "(none)"}`,
);

/**
 * Which redirect URLs the project will actually honour.
 *
 * This is the setting that fails most quietly. If a URL is not on the
 * allowlist Supabase does not refuse it — it silently substitutes the Site
 * URL, so a password-reset email sent from the deployed site lands on
 * whatever Site URL happens to say, and a judge clicking the link in their
 * inbox ends up at a machine that is not theirs. Nothing logs an error.
 *
 * `generate_link` runs that same substitution and hands back the result
 * WITHOUT sending any mail, so the allowlist can be read off it exactly. The
 * alternative is sending real emails on a tier that allows a few an hour.
 */
const service = env("SUPABASE_SERVICE_ROLE_KEY");
const siteUrl = settings.site_url ?? "(not reported)";
const WANT = [
  "http://localhost:3000/auth/callback",
  "https://samarth-sentinel.vercel.app/auth/callback",
];
let redirectsOk = true;

if (!service) {
  console.log("\n  redirect URLs: skipped (needs SUPABASE_SERVICE_ROLE_KEY in .env.local)");
} else {
  const admin = (p, init = {}) =>
    fetch(`${url}/auth/v1${p}`, {
      ...init,
      headers: {
        apikey: service,
        Authorization: `Bearer ${service}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });

  const tag = Math.random().toString(36).slice(2, 8);
  const probeEmail = `redirect-probe-${tag}@samarth.demo`;
  const made = await admin("/admin/users", {
    method: "POST",
    body: JSON.stringify({ email: probeEmail, password: `Probe!${tag}2026`, email_confirm: true }),
  }).then((r) => r.json()).catch(() => ({}));

  console.log(`\n  site URL: ${siteUrl}`);
  console.log("  redirect URLs the project will honour:");
  for (const want of WANT) {
    // `redirect_to` goes at the TOP LEVEL. The `options: { redirectTo }`
    // nesting belongs to supabase-js, which flattens it before it ever
    // reaches GoTrue -- send it nested here and the field is silently
    // dropped, every answer comes back as the Site URL, and a correctly
    // configured project looks broken.
    const r = await admin("/admin/generate_link", {
      method: "POST",
      body: JSON.stringify({ type: "recovery", email: probeEmail, redirect_to: want }),
    }).then((x) => x.json()).catch(() => ({}));
    const link = r.action_link ?? r.properties?.action_link ?? "";
    let got = "";
    try { got = new URL(link).searchParams.get("redirect_to") ?? ""; } catch { /* no link */ }
    const ok = got === want;
    if (!ok) redirectsOk = false;
    line(ok, ok ? "allowed" : "NOT allowed", `${want}${ok ? "" : `  ->  rewritten to ${got || "(nothing)"}`}`);
  }

  if (made.id) await admin(`/admin/users/${made.id}`, { method: "DELETE" }).catch(() => {});
}

const todo = [];
if (settings.mailer_autoconfirm !== true) {
  todo.push(
    `Turn OFF "Confirm email":\n` +
    `    https://supabase.com/dashboard/project/${ref}/auth/providers\n` +
    `    -> Email -> uncheck "Confirm email" -> Save`,
  );
}
if (!ext.google) {
  todo.push(
    `Enable Google:\n` +
    `    1. https://console.cloud.google.com -> APIs & Services -> Credentials\n` +
    `       -> Create OAuth client ID -> Web application\n` +
    `       Authorised redirect URI: ${url}/auth/v1/callback\n` +
    `    2. https://supabase.com/dashboard/project/${ref}/auth/providers\n` +
    `       -> Google -> enable -> paste Client ID and Secret -> Save`,
  );
}
if (redirectsOk) {
  console.log("\n  redirect URLs look right.");
} else {
  todo.push(
    `Allow the redirect URLs. Google sign-in AND the password-reset email both\n` +
    `    depend on this, and when it is wrong neither reports an error — the\n` +
    `    link just lands on the Site URL instead:\n` +
    `    https://supabase.com/dashboard/project/${ref}/auth/url-configuration\n` +
    `    Site URL:       https://samarth-sentinel.vercel.app\n` +
    `    Redirect URLs:  https://samarth-sentinel.vercel.app/auth/callback\n` +
    `                    https://samarth-sentinel.vercel.app/**\n` +
    `                    http://localhost:3000/auth/callback\n` +
    `                    http://localhost:3000/**`,
  );
}

console.log(`\nto do in the dashboard:\n`);
todo.forEach((t, i) => console.log(`  ${i + 1}. ${t}\n`));
