import { NextResponse } from "next/server";

/**
 * Medicine reminders by SMS: morning, afternoon, evening.
 *
 * WHY SMS AND NOT A CALL. A reminder is one sentence and needs no answer.
 * Ringing somebody three times a day to say one sentence is a worse product
 * and a more expensive one, and it trains people to stop answering the calls
 * that do matter. The daily conversation asks whether the medicines were
 * taken; this only nudges.
 *
 * NO DRUG NAMES IN THE MESSAGE. A text sits in a handset that anybody in the
 * house may pick up, and a list of medicines is a health record. The reminder
 * only has to be a reminder.
 *
 * QUEUES, THEN SENDS. The slot is written into medicine_reminder_log under a
 * unique constraint before anything is dispatched, so a scheduler that fires
 * twice — a retry, an overlapping run, a cron that double-triggers — cannot
 * send an elderly person the same reminder twice. Being reminded twice is how
 * somebody learns to ignore the reminder.
 *
 * RUNS AS NOBODY. A scheduler has no session. The queueing function takes the
 * telephony secret instead of a signed-in role; the alternative was a
 * service-role key in a web deployment, which this project does not have.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The three the product defaults to, and what each is called in a log. */
const SLOTS: Record<string, string> = {
  morning: "08:00",
  afternoon: "15:00",
  evening: "18:00",
};

function cfg() {
  return {
    cron: process.env.CRON_SECRET,
    telephony: process.env.TELEPHONY_SECRET,
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anon: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    runner: process.env.RUNNER_EMAIL,
    runnerPw: process.env.RUNNER_PASSWORD,
  };
}

/** Vercel Cron sends GET with a bearer; another scheduler may POST with ?key=. */
function authorised(req: Request, c: ReturnType<typeof cfg>): boolean {
  if (!c.cron) return false;
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const key = new URL(req.url).searchParams.get("key") ?? req.headers.get("x-cron-key") ?? bearer;
  return key === c.cron;
}

/**
 * Which slot is this run for?
 *
 * Taken from `?slot=` when given, so a slot can be triggered by hand without
 * waiting for the clock. Otherwise from the time in IST — the schedule is
 * 08:00, 15:00 and 18:00 where the seniors are, and the server is in UTC.
 * Choosing the NEAREST slot rather than the current hour means a cron that
 * fires a few minutes late still sends the right one.
 */
function slotFor(req: Request): { name: string; time: string } | null {
  const asked = new URL(req.url).searchParams.get("slot");
  if (asked) {
    if (SLOTS[asked]) return { name: asked, time: SLOTS[asked] };
    // An explicit time is allowed too, for a coordinator's own schedule.
    if (/^\d{2}:\d{2}$/.test(asked)) return { name: asked, time: asked };
    return null;
  }

  const ist = new Date(Date.now() + 5.5 * 3600_000);
  const minutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  let best: { name: string; time: string } | null = null;
  let nearest = Infinity;
  for (const [name, time] of Object.entries(SLOTS)) {
    const [h, m] = time.split(":").map(Number);
    const d = Math.abs(h * 60 + m - minutes);
    if (d < nearest) {
      nearest = d;
      best = { name, time };
    }
  }
  // More than 90 minutes from any slot is not a scheduled run; refusing is
  // better than guessing and texting two hundred people at the wrong hour.
  return nearest <= 90 ? best : null;
}

async function run(req: Request) {
  const c = cfg();
  if (!authorised(req, c)) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }
  if (!c.telephony || !c.url || !c.anon) {
    return NextResponse.json({ ok: false, reason: "not_configured" }, { status: 503 });
  }

  const slot = slotFor(req);
  if (!slot) {
    return NextResponse.json(
      { ok: false, reason: "no_slot", note: "Not near a reminder time. Pass ?slot=morning|afternoon|evening." },
      { status: 400 },
    );
  }

  const queued = await fetch(`${c.url}/rest/v1/rpc/queue_medicine_reminders`, {
    method: "POST",
    headers: { apikey: c.anon, "Content-Type": "application/json" },
    body: JSON.stringify({ p_secret: c.telephony, p_slot: slot.time }),
    cache: "no-store",
  })
    .then((r) => r.json())
    .catch(() => null);

  if (!queued || queued.ok !== true) {
    return NextResponse.json(
      { ok: false, slot: slot.name, reason: queued?.reason ?? "queue_failed" },
      { status: 502 },
    );
  }

  // Dispatch runs as the coordinator service account, because that route
  // reads family_notifications under RLS rather than with an elevated key.
  let sent: unknown = null;
  if (c.runner && c.runnerPw) {
    const site = process.env.PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || "";
    const token = await fetch(`${c.url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: c.anon, "Content-Type": "application/json" },
      body: JSON.stringify({ email: c.runner, password: c.runnerPw }),
    })
      .then((r) => r.json())
      .then((j: { access_token?: string }) => j.access_token)
      .catch(() => null);

    if (token) {
      sent = await fetch(`${site}/api/notify/dispatch`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => r.json())
        .catch(() => null);
    }
  }

  return NextResponse.json({ ok: true, slot: slot.name, at: slot.time, queued: queued.queued, sent });
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
    slots: SLOTS,
    ready: !!(c.cron && c.telephony && c.runner && c.runnerPw),
    missing: Object.entries(c)
      .filter(([, v]) => !v)
      .map(([k]) => k),
  });
}
