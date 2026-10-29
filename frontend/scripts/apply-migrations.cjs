// Apply SQL files to the hosted Supabase project, each in its own transaction.
// Usage: node apply.js <dbcfg.json> <file.sql> [file2.sql ...]
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

// Credentials come from the environment, or from .env.local, which is
// gitignored. Nothing is stored in the repo.
//   SUPABASE_DB_HOST, SUPABASE_DB_PASSWORD
//
// Reading .env.local matters for more than convenience: the alternative is
// typing a database password on a command line, where it lands in shell
// history and in the process list for every other user on the machine.
//
// Lives under frontend/ because that is the repo's only Node package and `pg`
// is a devDependency there.
//
// Usage:
//   cd frontend && npm run db:migrate
//   cd frontend && node scripts/apply-migrations.cjs ../backend/supabase/migrations/0003_*.sql
// Same loader the verify scripts use. A real environment variable always
// wins, so CI can override the file without editing it.
for (const line of (fs.existsSync(path.join(__dirname, "..", ".env.local"))
  ? fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split(/\r?\n/)
  : [])) {
  const t = line.trim();
  if (!t || t.startsWith("#") || !t.includes("=")) continue;
  const i = t.indexOf("=");
  const k = t.slice(0, i).trim();
  if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}

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
  // Full TLS verification against Supabase's published CA (prod-ca-2021),
  // which signs the direct database endpoint. Hostname is checked too.
  // Do not swap this for rejectUnauthorized: false.
  ssl: {
    rejectUnauthorized: true,
    ca: fs.readFileSync(path.join(__dirname, "prod-ca-2021.crt"), "utf8"),
  },
  connectionTimeoutMillis: 60000,
  statement_timeout: 120000,
};

const files = process.argv.slice(2);

(async () => {
  const c = new Client(cfg);
  await c.connect();
  let failed = false;

  for (const f of files) {
    const sql = fs.readFileSync(f, "utf8");
    const name = path.basename(f);
    try {
      await c.query("begin");
      await c.query(sql);
      await c.query("commit");
      console.log(`  OK      ${name}`);
    } catch (e) {
      await c.query("rollback").catch(() => {});
      console.error(`  FAILED  ${name}`);
      console.error(`          ${e.message}`);
      if (e.position) {
        const upto = sql.slice(0, Number(e.position));
        console.error(`          at line ${upto.split("\n").length}`);
      }
      failed = true;
      break;
    }
  }

  await c.end().catch(() => {});
  process.exitCode = failed ? 1 : 0;
})().catch((e) => {
  console.error("FATAL:", e.message);
  process.exitCode = 1;
});
