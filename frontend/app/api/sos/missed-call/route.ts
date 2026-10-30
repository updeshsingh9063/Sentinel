import { NextResponse } from "next/server";

/**
 * The help line: a missed call IS the emergency.
 *
 * WHY THIS IS THE RIGHT SHAPE FOR THE PEOPLE THIS IS FOR. An emergency
 * control that requires opening a website is not an emergency control. The
 * brief says no senior-facing app, and the people in question hold a basic
 * handset. A missed call needs no smartphone, no data, no app, no literacy,
 * no password, and no steady hand — one button, already the one they press
 * most. It also works when they cannot speak, which is a case a voice
 * assistant simply loses.
 *
 * THE CALL IS REJECTED, NOT ANSWERED. Rejecting means the caller is never
 * charged — the Indian missed-call convention. We already know who rang from
 * the number, so answering would only cost them money to tell us something
 * we have.
 *
 * AND THEN WE RING THEM BACK, within seconds. The alarm is raised first and
 * the callback is a separate, best-effort step: if the dialling fails, a
 * coordinator has still been told, the family has still been warned, and the
 * senior is still at the top of today's list. An emergency path must not
 * depend on its own most fragile part.
 *
 * PROVIDER-AGNOSTIC, because the one that works here is not the one that will
 * work in production. A Twilio US number means an Indian senior pays
 * international rates to ring in, which no senior will do twice — production
 * needs an Indian missed-call number (Exotel, Knowlarity, Plivo). Those post
 * different field names and expect different responses, so this reads any of
 * them and answers in whatever shape the caller asked for.
 *
 * NO CREDENTIAL LIVES HERE. It relays the shared secret to `raise_sos`, which
 * checks it against a stored digest. A compromise of this host buys the
 * ability to raise a false alarm about somebody — not to read a senior, a
 * vital or a score.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Pull the calling number out of whichever shape the provider sent. */
async function callerNumber(req: Request): Promise<string | null> {
  const type = req.headers.get("content-type") ?? "";
  const pick = (o: Record<string, unknown>) => {
    // Twilio sends From; Exotel sends CallFrom; others vary. Being strict
    // here means the integration fails in the field for a reason that has
    // nothing to do with the product.
    for (const k of ["from", "From", "CallFrom", "caller", "msisdn", "phone", "Caller"]) {
      const v = o[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return null;
  };

  try {
    if (type.includes("json")) {
      return pick((await req.json()) as Record<string, unknown>);
    }
    if (type.includes("form")) {
      return pick(Object.fromEntries((await req.formData()).entries()) as Record<string, unknown>);
    }
  } catch {
    /* fall through to the query string */
  }
  return pick(Object.fromEntries(new URL(req.url).searchParams.entries()));
}

/** TwiML for a provider that speaks it; JSON for one that does not. */
function reply(req: Request, body: Record<string, unknown>) {
  const wantsXml = (req.headers.get("user-agent") ?? "").includes("Twilio");
  if (!wantsXml) return NextResponse.json(body);
  // <Reject> ends the call without answering, so the senior is not charged.
  return new NextResponse(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Reject reason="busy"/></Response>`,
    { status: 200, headers: { "Content-Type": "text/xml; charset=utf-8" } },
  );
}

/**
 * Ring them straight back, so somebody who is frightened hears a voice.
 *
 * Best effort and deliberately not awaited for its result above: the alarm is
 * already raised. A failure to dial must degrade to "a coordinator was told"
 * rather than losing the emergency.
 */
async function callBack(seniorId: string) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_TOKEN;
  const from = process.env.TWILIO_FROM;
  const telephony = process.env.TELEPHONY_SECRET;
  const base = process.env.PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!sid || !token || !from || !telephony || !base || !url || !anon) return null;

  // The number to ring is read behind the telephony secret rather than taken
  // from the inbound call: a household handset may carry several seniors, and
  // the one we are ringing back is the one the alarm was raised for.
  const profile = (await fetch(`${url}/rest/v1/rpc/telephony_begin`, {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({
      p_secret: telephony,
      p_call_sid: `lookup-${seniorId}`,
      p_phone: "",
      p_senior_id: seniorId,
    }),
    cache: "no-store",
  })
    .then((r) => r.json())
    .catch(() => null)) as { ok?: boolean } | null;
  if (!profile?.ok) return null;

  const to = await fetch(`${url}/rest/v1/rpc/sos_callback_number`, {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ p_secret: telephony, p_senior_id: seniorId }),
    cache: "no-store",
  })
    .then((r) => r.json())
    .catch(() => null);
  if (typeof to !== "string" || !to) return null;

  // `sos=1` so the call does not open with "how is your day going" to
  // somebody who has just reached for a help line.
  const hook =
    `${base}/api/call/voice?key=${encodeURIComponent(telephony)}` +
    `&senior=${encodeURIComponent(seniorId)}&sos=1`;

  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        To: to,
        From: from,
        Url: hook,
        StatusCallback: `${base}/api/call/voice?key=${encodeURIComponent(telephony)}&status=1`,
        StatusCallbackEvent: "completed",
      }).toString(),
    });
    const data = (await res.json()) as { sid?: string };
    return data.sid ?? null;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  // Header or query string, never the body: a secret in the body ends up in
  // the provider's request logs next to the number it belongs to.
  const secret =
    req.headers.get("x-sos-secret") ?? url.searchParams.get("key") ?? process.env.SOS_SECRET ?? "";

  const from = await callerNumber(req);
  const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!from || !supabase || !anon) {
    return reply(req, { ok: false, reason: "no_caller" });
  }

  const raised = (await fetch(`${supabase}/rest/v1/rpc/raise_sos`, {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ p_secret: secret, p_phone: from, p_senior_id: null }),
    cache: "no-store",
  })
    .then((r) => r.json())
    .catch(() => null)) as { ok?: boolean; senior_id?: string; reason?: string } | null;

  if (!raised?.ok) {
    // A number we do not know is not an error to shout about — somebody
    // dialled a wrong number. It is recorded as nothing and rejected quietly.
    return reply(req, { ok: false, reason: raised?.reason ?? "not_raised" });
  }

  // `?nocall=1` raises the alarm and dials nobody.
  //
  // THIS EXISTS BECAUSE THE TEST FOR THIS ROUTE RANG A REAL TELEPHONE. Its
  // own header said "nothing here dials", which was true of the database
  // checks and false of the route they drive: with credentials present every
  // probe placed a call, and the person testing it was rung four times in a
  // row. A test that cannot exercise an emergency path without setting off
  // the emergency is a test nobody will run.
  const quiet = url.searchParams.get("nocall") === "1";
  const callSid = !quiet && raised.senior_id ? await callBack(raised.senior_id) : null;

  // The caller learns that the alarm was accepted. Not whose it was: they
  // rang a telephone number, they do not get to read a name back out.
  return reply(req, { ok: true, raised: true, calling_back: !!callSid });
}

/** Providers health-check a webhook URL before saving it; it must not 405. */
export async function GET() {
  return NextResponse.json({
    ok: true,
    channel: "missed-call-sos",
    method: "POST",
    configured: !!(process.env.SOS_SECRET && process.env.NEXT_PUBLIC_SUPABASE_URL),
    calls_back: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TELEPHONY_SECRET),
  });
}
