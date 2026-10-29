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
todo.push(
  `Allow the local redirect (needed for Google):\n` +
  `    https://supabase.com/dashboard/project/${ref}/auth/url-configuration\n` +
  `    Site URL: http://localhost:3000\n` +
  `    Redirect URLs: http://localhost:3000/auth/callback`,
);

console.log(`\nto do in the dashboard:\n`);
todo.forEach((t, i) => console.log(`  ${i + 1}. ${t}\n`));
