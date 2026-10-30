import { NextResponse } from "next/server";

/**
 * The daily round: plan the day, then actually dial.
 *
 * THIS IS THE PIECE THAT MAKES THE PRODUCT TRUE. Everything else decides who
 * should be rung and what to say to them; without something that runs on its
 * own, every one of those decisions still waits for a person to press a
 * button, and "the senior does not open anything" quietly becomes "somebody
 * else opens something instead".
 *
 * Meant for a scheduler — Vercel Cron, cron-job.org, anything that can POST a
 * URL once a morning. It plans the day first so a senior enrolled yesterday
 * is not missed, then places the calls that are due.
 *
 * RUNS AS NOBODY, AND IS GATED ON ITS OWN SECRET. A scheduler has no session,
 * so this cannot read through RLS as a coordinator; it uses the telephony
 * functions, which take the same secret the voice webhook does and can do
 * nothing beyond holding a conversation. The planning step needs a signed-in
 * role, so it is reached through its own service account rather than by
 * widening what anon may do.
 *
 * IT WILL NOT RING SOMEBODY TWICE. A call already marked reached or attempted
 * today is skipped, so a scheduler that fires twice, or a retry after a
 * timeout, costs nothing and bothers nobody.
 *
 * WITH NO TWILIO CONFIGURED IT PLANS AND DIALS NOTHING, and says so. It does
 * not record attempts that did not happen.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SITE = () => process.env.PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || "";

/** How many to dial in one run. A scheduler can call again; a stampede cannot be undone. */
const PER_RUN = 20;

function cfg() {
  return {
    sid: process.env.TWILIO_ACCOUNT_SID,
    token: process.env.TWILIO_TOKEN,
    from: process.env.TWILIO_FROM,
    telephony: process.env.TELEPHONY_SECRET,
    cron: process.env.CRON_SECRET,
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anon: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    runner: process.env.RUNNER_EMAIL,
    runnerPw: process.env.RUNNER_PASSWORD,
  };
}

async function asRunner(c: ReturnType<typeof cfg>): Promise<string | null> {
  if (!c.runner || !c.runnerPw) return null;
  try {
    const res = await fetch(`${c.url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: c.anon!, "Content-Type": "application/json" },
      body: JSON.stringify({ email: c.runner, password: c.runnerPw }),
    });
    const j = (await res.json()) as { access_token?: string };
    return j.access_token ?? null;
  } catch {
    return null;
  }
}

/**
 * Vercel Cron invokes a path with GET and an `Authorization: Bearer` header
 * carrying CRON_SECRET — not a POST with a query string, which is what this
 * route accepted at first and why it would have run precisely never. Both
 * shapes work now, so another scheduler can POST it instead.
 */
function authorised(req: Request, c: ReturnType<typeof cfg>): boolean {
  if (!c.cron) return false;
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const key =
    new URL(req.url).searchParams.get("key") ?? req.headers.get("x-cron-key") ?? bearer;
  return key === c.cron;
}

async function run(req: Request) {
  const c = cfg();
  if (!authorised(req, c)) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  const ready = !!(c.sid && c.token && c.from && c.telephony);
  const token = await asRunner(c);

  // ---- 1. decide the day --------------------------------------------------
  let planned: unknown = null;
  if (token) {
    const res = await fetch(`${c.url}/rest/v1/rpc/plan_calls`, {
      method: "POST",
      headers: { apikey: c.anon!, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: "{}",
    });
    planned = await res.json().catch(() => null);
  }

  if (!ready) {
    return NextResponse.json({
      ok: true,
      planned,
      dialled: 0,
      note: "Planned only. No Twilio credentials, so nothing was dialled.",
    });
  }

  if (!token) {
    return NextResponse.json(
      { ok: false, reason: "no_runner_account", note: "Set RUNNER_EMAIL / RUNNER_PASSWORD." },
      { status: 503 },
    );
  }

  // ---- 2. who is due, and not already rung today --------------------------
  const today = new Date().toISOString().slice(0, 10);
  const due = await fetch(
    `${c.url}/rest/v1/call_plan?planned_on=eq.${today}&outcome=eq.planned&select=id,senior_id&order=due_at.asc&limit=${PER_RUN}`,
    { headers: { apikey: c.anon!, Authorization: `Bearer ${token}` } },
  )
    .then((r) => r.json())
    .catch(() => []);

  const rows = (Array.isArray(due) ? due : []) as { id: number; senior_id: string }[];
  // One call per senior per run, however many reasons they have today. Three
  // reasons to ring somebody is still one telephone call.
  const seen = new Set<string>();
  const targets = rows.filter((r) => !seen.has(r.senior_id) && seen.add(r.senior_id));

  const numbers = await fetch(
    `${c.url}/rest/v1/seniors?id=in.(${targets.map((t) => t.senior_id).join(",")})&select=id,phone`,
    { headers: { apikey: c.anon!, Authorization: `Bearer ${token}` } },
  )
    .then((r) => r.json())
    .catch(() => []);
  const phoneById = new Map(
    (Array.isArray(numbers) ? numbers : []).map((n: { id: string; phone: string }) => [n.id, n.phone]),
  );

  // ---- 3. dial ------------------------------------------------------------
  const hook = `${SITE()}/api/call/voice?key=${encodeURIComponent(c.telephony!)}`;
  let dialled = 0;
  const failures: string[] = [];

  for (const t of targets) {
    const to = phoneById.get(t.senior_id);
    if (!to) continue;

    const form = new URLSearchParams({
      To: to,
      From: c.from!,
      Url: hook,
      StatusCallback: `${hook}&status=1`,
      StatusCallbackEvent: "completed",
      // RING TIMEOUT IS OMITTED BY DEFAULT, DELIBERATELY. A Twilio trial
      // account rejects the whole call with "disallowed parameters" if
      // Timeout is present — and the message names no parameter, so it reads
      // as a credentials fault rather than a plan one. Set TWILIO_RING_TIMEOUT
      // once the account is upgraded; without it Twilio rings for 60s.
      ...(process.env.TWILIO_RING_TIMEOUT
        ? { Timeout: process.env.TWILIO_RING_TIMEOUT }
        : {}),
    });

    try {
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${c.sid}/Calls.json`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${c.sid}:${c.token}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      });
      const data = (await res.json()) as { sid?: string; message?: string };
      if (res.ok && data.sid) {
        dialled += 1;
      } else {
        failures.push(data.message ?? `provider ${res.status}`);
      }
    } catch {
      failures.push("provider unreachable");
    }
  }

  return NextResponse.json({ ok: true, planned, due: targets.length, dialled, failures });
}

export async function POST(req: Request) {
  return run(req);
}

/** The scheduler's GET does the round; an unauthenticated GET reports readiness. */
export async function GET(req: Request) {
  const c = cfg();
  if (authorised(req, c)) return run(req);
  return NextResponse.json({
    ok: true,
    ready: !!(c.sid && c.token && c.from && c.telephony && c.cron),
    missing: Object.entries(c)
      .filter(([, v]) => !v)
      .map(([k]) => k),
  });
}
