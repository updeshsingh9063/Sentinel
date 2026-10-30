import { NextResponse } from "next/server";

/**
 * The SOS button.
 *
 * An older person falls in the bathroom. They cannot reach a phone, cannot
 * unlock it, cannot find an app and cannot type. Everything this product does
 * through the daily call assumes somebody able to hold a conversation, and
 * the moment that assumption breaks is exactly the moment help matters most.
 *
 * So this channel assumes nothing. A pendant, a button screwed to the wall by
 * the bed, or a missed call to a dedicated number — whatever the device, it
 * does one thing and carries one shared secret. No screen, no network of its
 * own, no literacy, no charge to keep topped up beyond the button itself.
 *
 * THIS ROUTE HOLDS NO CREDENTIAL, for the same reason the missed-call relay
 * does not: it passes the device's secret to `raise_sos`, which checks it
 * against a stored digest and does the write. The deployment needs no
 * service-role key, and compromising this host buys the ability to raise an
 * alarm — not to read a single thing about anybody.
 *
 * WHAT IT DOES NOT DO. It does not call an ambulance, notify next of kin, or
 * dispatch anyone. It puts a named person at the top of a human being's list
 * and records the time. A prototype that implies more than that is teaching
 * somebody to rely on something that is not there, and that is worse than
 * having no button at all.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Pull the number out of whichever shape the device or provider sent. */
async function pressedBy(req: Request): Promise<string | null> {
  const type = req.headers.get("content-type") ?? "";
  const pick = (o: Record<string, unknown>) => {
    for (const k of ["from", "From", "CallFrom", "caller", "msisdn", "phone", "device"]) {
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

  // Header or query string, never the body — a secret in the body ends up in
  // the provider's request logs next to the number it belongs to.
  const secret =
    req.headers.get("x-sos-secret") ??
    new URL(req.url).searchParams.get("key") ??
    "";

  const from = await pressedBy(req);

  const r = await fetch(`${url}/rest/v1/rpc/raise_sos`, {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ p_secret: secret, p_phone: from ?? "" }),
  });

  if (!r.ok) {
    return NextResponse.json({ ok: false, reason: "upstream" }, { status: 502 });
  }

  const verdict = (await r.json()) as { ok: boolean; reason?: string; senior_name?: string };

  // The device learns that the alarm was accepted. It does not learn whose it
  // was — it pressed a button, it does not get to read a name back out.
  if (verdict.ok) {
    return NextResponse.json({ ok: true, raised: true }, { status: 200 });
  }

  const status =
    verdict.reason === "unauthorized" ? 401 : verdict.reason === "unknown_number" ? 404 : 400;
  return NextResponse.json({ ok: false, reason: verdict.reason }, { status });
}

/** A device or provider health-checking the URL should not get a 405. */
export async function GET() {
  return NextResponse.json({ ok: true, channel: "sos", method: "POST" });
}
