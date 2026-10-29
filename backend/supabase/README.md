# Supabase setup

The hosted project is live and seeded. This describes how it got there and how
to rebuild it.

## Migrations, in order

| File | What it does |
|---|---|
| `0001_init.sql` | 15 tables, 5 enums, indexes. No policies yet. |
| `0002_rls.sql` | Enables RLS on every table, adds the policies and helper functions, creates `ops_daily_metrics`. |
| `0003_ops_view_grants.sql` | Closes an anon read of the ops view. See below — this one is not cosmetic. |
| `0004_ops_view_metrics.sql` | Extends the ops view with median time to action, open counts and programme size, so the dashboard reads real numbers. |

Apply them to a fresh project:

```bash
cd frontend
npm run db:migrate
```

`0001` is not idempotent (`create type` has no `if not exists`), so that
command is for a **new** project. To apply one migration to a live project:

```bash
cd frontend
node scripts/apply-migrations.cjs ../backend/supabase/migrations/0004_ops_view_metrics.sql
```

## Seeding

```bash
cd frontend
npm run db:seed
```

This creates the demo accounts through the Auth Admin API, then truncates and
rebuilds the app tables in one transaction. It is deterministic (fixed-seed
PRNG) and safe to re-run. `auth.users` is reused, never dropped.

What it loads: **60 seniors across 6 coordinators over 21 days** — 1,176
vitals, 1,260 check-ins, 2,520 medication logs, 1,260 risk scores, 303 alerts
and 285 coordinator verdicts. The six named seniors from
`frontend/lib/demo.ts` keep their exact fixture data, including Savitri Devi's
real systolic series with its one missing day, and her two verbatim Hinglish
call notes (one of which is negated and deliberately raises no cue).

The outcome mix is tuned to the numbers `lib/demo.ts` commits to: precision@K
lands at 0.72 against its stated 0.71, false alarms at ~16–18%, median time to
first action at ~48 minutes. A near-perfect precision would read as
implausible and undercut the premise that ranking under a budget is the hard
part.

**This is not the real cohort.** `scripts/generate_cohort.py` is still a stub
and `datasets/synthetic/` is still empty. This seed exists so the surfaces have
something true-shaped to render; it is not training data and no model has been
fitted to it.

## Environment

Both scripts read credentials from the environment, so nothing is committed:

```
SUPABASE_DB_HOST=db.<ref>.supabase.co
SUPABASE_DB_PASSWORD=...
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
```

TLS is fully verified against `frontend/scripts/prod-ca-2021.crt`, Supabase's
published CA for the direct database endpoint. Do not replace that with
`rejectUnauthorized: false`.

Note the direct endpoint (`db.<ref>.supabase.co:5432`) resolves to **IPv6
only**. On a host without IPv6, use the pooler instead.

## Demo accounts

Real Supabase Auth. Password for all three: `SamarthDemo!2026`.

| Email | Role | Lands on |
|---|---|---|
| `coordinator@samarth.demo` | coordinator | `/worklist` |
| `family@samarth.demo` | family | `/summary` |
| `ops@samarth.demo` | ops | `/dashboard` |

Five more coordinator accounts (`coord2…coord6@samarth.demo`) exist only to own
the other 54 seniors, so the ops aggregates have realistic volume.

**A senior has no account.** `app_users` references `auth.users`, and the brief
forbids a senior-facing app, so `/checkin` is public by design — it simulates
what she hears on a basic phone.

## The 0003 finding

`0002` ends with `revoke all on ops_daily_metrics from public`, which states
the intent clearly: signed-in roles only. **It does not hold on Supabase.** The
platform ships `alter default privileges` granting `anon`, `authenticated` and
`service_role` ALL privileges on new objects in `public`, and those are grants
to named roles — a revoke from `PUBLIC` does not touch them.

For the 15 base tables that is survivable, because RLS is on and a role with no
permissive policy reads nothing. `ops_daily_metrics` is the exception: it is
deliberately `security_invoker = false` so it can aggregate across seniors,
which means **no RLS stands behind it and the grant is the only gate**.

Verified against the live project before the fix: an unauthenticated caller
holding only the public anon key — which ships in the browser bundle — read all
21 rows. No individual data leaks (the view emits counts and rates, no
`senior_id`, no names), but alert volumes and false-alarm rates are operational
data that was never meant to be public.

If you add another security-definer view, revoke from `anon` explicitly. The
default privileges will otherwise hand it over.

## Verifying RLS

The privacy claim is testable, and worth testing rather than asserting. Signed
in through the REST API with the public anon key:

| table | coordinator | family | ops | anon |
|---|---|---|---|---|
| `seniors` | 6 | 1 | 0 | 0 |
| `vitals` | 117 | **0** | **0** | 0 |
| `risk_scores` | 126 | **0** | **0** | 0 |
| `call_notes` | 2 | **0** | **0** | 0 |
| `medication_logs` | 252 | **0** | **0** | 0 |
| `family_summaries` | 1 | 1 | 0 | 0 |
| `ops_daily_metrics` | 21 | 21 | 21 | **denied** |

Family and operations read zero individual health rows, and that is an absence
of policy in the schema rather than a check in application code that could be
written wrong.
