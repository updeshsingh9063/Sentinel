import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * Place a real call.
 *
 * WHAT MAKES THIS DIFFERENT FROM EVERY OTHER ROUTE HERE: it costs money and
 * it rings somebody's telephone. So it is the only route in the product that
 * requires a signed-in coordinator AND checks the number belongs to somebody
 * on their caseload. A public endpoint that dials arbitrary numbers is a
 * machine for making nuisance calls out of somebody else's Twilio balance.
 *
 * INDIA, SPECIFICALLY. Calls into India must originate from a NON-Indian
 * number — Twilio stopped supporting local outbound within India in August
 * 2024 — so TWILIO_FROM has to be a US or UK number. On a trial account every
 * destination must be verified in the console first, and India's DND registry
 * can refuse a commercial call outright. All three are worth testing on the
 * first day rather than in front of a room.
 *
 * WITH NO CREDENTIALS IT SAYS SO AND DIALS NOTHING. It does not pretend, and
 * it does not record an attempt that never happened.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function configured() {
  return {
    sid: process.env.TWILIO_ACCOUNT_SID,
    token: process.env.TWILIO_TOKEN,
    from: process.env.TWILIO_FROM,
    secret: process.env.TELEPHONY_SECRET,
    base: process.env.PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL,
  };
}

export async function POST(req: Request) {
  const cfg = configured();
  const missing = Object.entries(cfg)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) {
    return NextResponse.json(
      {
        ok: false,
        reason: "not_configured",
        missing,
        note: "Nothing was dialled. Set these and the call will go out.",
      },
      { status: 503 },
    );
  }

  let body: { seniorId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "bad_request" }, { status: 400 });
  }
  if (!body.seniorId) {
    return NextResponse.json({ ok: false, reason: "no_senior" }, { status: 400 });
  }

  // READ AS THE SIGNED-IN COORDINATOR. If this senior is not on their
  // caseload, RLS returns nothing and there is no number to dial — the check
  // and the lookup are the same operation, so they cannot drift apart.
  const supabase = await createClient();
  const { data: senior } = await supabase
    .from("seniors")
    .select("id, display_name, phone")
    .eq("id", body.seniorId)
    .maybeSingle();

  if (!senior?.phone) {
    return NextResponse.json({ ok: false, reason: "not_yours_or_no_number" }, { status: 404 });
  }

  const hook = `${cfg.base}/api/call/voice?key=${encodeURIComponent(cfg.secret!)}`;
  const form = new URLSearchParams({
    To: senior.phone as string,
    From: cfg.from!,
    Url: hook,
    // Twilio posts here when the call ends however it ended, which is how an
    // unanswered call becomes a recorded attempt rather than silence.
    StatusCallback: `${cfg.base}/api/call/voice?key=${encodeURIComponent(cfg.secret!)}&status=1`,
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
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${cfg.sid}/Calls.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${cfg.sid}:${cfg.token}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      },
    );
    const data = (await res.json()) as { sid?: string; message?: string; code?: number };
    if (!res.ok || !data.sid) {
      return NextResponse.json(
        { ok: false, reason: data.message ?? `provider ${res.status}`, code: data.code },
        { status: 502 },
      );
    }
    return NextResponse.json({ ok: true, callSid: data.sid, to: senior.display_name });
  } catch {
    return NextResponse.json({ ok: false, reason: "provider_unreachable" }, { status: 502 });
  }
}

export async function GET() {
  const cfg = configured();
  return NextResponse.json({
    ok: true,
    configured: Object.values(cfg).every(Boolean),
    missing: Object.entries(cfg)
      .filter(([, v]) => !v)
      .map(([k]) => k),
  });
}
