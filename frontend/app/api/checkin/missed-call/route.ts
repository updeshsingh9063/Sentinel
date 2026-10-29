import { NextResponse } from "next/server";

/**
 * Missed-call check-in: the telephony webhook.
 *
 * A senior dials a number and hangs up. The provider posts here. That is the
 * entire interaction, and it is the only check-in channel in this product
 * that costs the senior nothing, needs no smartphone, no data, no literacy
 * and no app — which makes it the one most likely to actually be used by the
 * people the brief is about.
 *
 * THIS ROUTE HOLDS NO CREDENTIAL. It relays the caller's shared secret to
 * `record_missed_call`, a security-definer function that checks it against a
 * stored digest and does the write. The deployment therefore needs no
 * service-role key — nothing here can read a senior, a vital or a score, and
 * a compromise of this host yields the ability to mark people as having
 * phoned in, and nothing else. See migration 0012.
 *
 * ACCEPTS BOTH BODY SHAPES, because providers disagree. Exotel and Twilio
 * post form-encoded with `From`/`CallFrom`; everything else posts JSON. Being
 * strict here would mean the integration fails in the field for a reason that
 * has nothing to do with the product.
 *
 * ALWAYS ANSWERS QUICKLY AND NEVER LEAKS A NAME. The response carries the
 * date and the channel, never who the number belongs to: the provider dialled
 * it, it does not get to learn whose it is. A provider that retries is
 * harmless — the write is idempotent per senior per day.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Pull the calling number out of whichever shape the provider sent. */
async function callerNumber(req: Request): Promise<string | null> {
  const type = req.headers.get("content-type") ?? "";
  const pick = (o: Record<string, unknown>) => {
    for (const k of ["from", "From", "CallFrom", "caller", "msisdn", "phone"]) {
      const v = o[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return null;
  };
  try {
    if (type.includes("application/json")) {
      return pick((await req.json()) as Record<string, unknown>);
    }
    const form = await req.formData();
    return pick(Object.fromEntries(form.entries()) as Record<string, unknown>);
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return NextResponse.json({ ok: false, reason: "not_configured" }, { status: 503 });
  }

  // The secret may arrive as a header (most providers) or as a query
  // parameter (the ones that will not send custom headers). It is never read
  // from the body, where it would end up in the provider's request logs
  // beside the number it belongs to.
  const secret =
    req.headers.get("x-checkin-secret") ??
    new URL(req.url).searchParams.get("key") ??
    "";

  const from = await callerNumber(req);

  const r = await fetch(`${url}/rest/v1/rpc/record_missed_call`, {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ p_secret: secret, p_phone: from ?? "" }),
  });

  if (!r.ok) {
    return NextResponse.json({ ok: false, reason: "upstream" }, { status: 502 });
  }

  const verdict = (await r.json()) as { ok: boolean; reason?: string };
  if (verdict.ok) return NextResponse.json(verdict, { status: 200 });

  const status =
    verdict.reason === "unauthorized" ? 401 :
    verdict.reason === "unknown_number" ? 404 : 400;
  return NextResponse.json(verdict, { status });
}

/** A provider health-checking the URL should not get a 405. */
export async function GET() {
  return NextResponse.json({ ok: true, channel: "missed_call", method: "POST" });
}
