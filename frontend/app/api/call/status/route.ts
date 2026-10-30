import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * What happened to a call that was placed from the worklist.
 *
 * WHY THIS EXISTS. The button said "Ringing" and then said it forever. A
 * coordinator who pressed it had no way to learn that nobody picked up —
 * which is the outcome that most needs acting on, because an elderly person
 * not answering their telephone is the signal the whole product is built
 * around. "No answer" shown on screen is worth more than a call that
 * connected.
 *
 * A CALL SID IS NOT A CAPABILITY. The id comes back from the browser, so it
 * cannot be trusted on its own — a provider's call ids are guessable enough
 * in sequence that reading any call by id would leak who else is being rung
 * and when. So the senior is named too, read AS THE SIGNED-IN COORDINATOR
 * through RLS, and the call only answers if the number Twilio dialled is
 * that senior's. Someone else's call id returns nothing.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The ten digits both sides agree on, since formatting differs by provider. */
const last10 = (s: string) => s.replace(/\D/g, "").slice(-10);

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sid = url.searchParams.get("sid") ?? "";
  const seniorId = url.searchParams.get("senior") ?? "";

  if (!/^CA[0-9a-f]{32}$/i.test(sid) || !seniorId) {
    return NextResponse.json({ ok: false, reason: "bad_request" }, { status: 400 });
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_TOKEN;
  if (!accountSid || !token) {
    return NextResponse.json({ ok: false, reason: "not_configured" }, { status: 503 });
  }

  // Their caseload, or nothing. Same read the dialling route uses, so the two
  // cannot disagree about who this coordinator may ask about.
  const supabase = await createClient();
  const { data: senior } = await supabase
    .from("seniors")
    .select("id, phone")
    .eq("id", seniorId)
    .maybeSingle();

  if (!senior?.phone) {
    return NextResponse.json({ ok: false, reason: "not_yours" }, { status: 404 });
  }

  let call: { to?: string; status?: string; duration?: string } | null = null;
  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls/${sid}.json`,
      {
        headers: { Authorization: `Basic ${Buffer.from(`${accountSid}:${token}`).toString("base64")}` },
        cache: "no-store",
      },
    );
    if (!res.ok) return NextResponse.json({ ok: false, reason: "unknown_call" }, { status: 404 });
    call = await res.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "provider_unreachable" }, { status: 502 });
  }

  // The id alone proves nothing; this is what ties it to a senior they carry.
  if (last10(call?.to ?? "") !== last10(senior.phone as string)) {
    return NextResponse.json({ ok: false, reason: "not_yours" }, { status: 404 });
  }

  /**
   * Twilio's statuses, grouped by what a coordinator should DO about them.
   *
   * `completed` is deliberately not called "answered": a call that rang out
   * and hit the no-speech hangup also completes. Whether anybody actually
   * said anything is a question for the check-in, not the provider.
   */
  const status = call?.status ?? "";
  const outcome =
    status === "no-answer" || status === "busy"
      ? "no_answer"
      : status === "failed" || status === "canceled"
        ? "failed"
        : status === "completed"
          ? "ended"
          : status === "in-progress"
            ? "talking"
            : "ringing";

  return NextResponse.json({
    ok: true,
    outcome,
    status,
    seconds: Number(call?.duration ?? 0),
  });
}
