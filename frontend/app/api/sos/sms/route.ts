import { NextResponse } from "next/server";

/**
 * The help line by text: "SOS", "madad", "मदद", "help".
 *
 * WHY A SECOND CHANNEL. A missed call is the best emergency control for a
 * basic handset, and it loses one case badly: somebody who cannot speak, or
 * cannot be heard, or must not be heard. A text costs nothing extra to
 * support — the same alarm, the same escalation — and covers it.
 *
 * ANY MESSAGE RAISES IT, not only the keyword. A person in trouble does not
 * type the word you documented; they type whatever comes out. The keywords
 * exist to be printed on a card next to the telephone, not to be a
 * requirement. Only an obvious reply to one of our own reminders is ignored,
 * because "ok" and "theek hai" are not a cry for help and treating them as
 * one would teach a family to ignore the alarm.
 *
 * NO CREDENTIAL LIVES HERE, same as the missed-call route: it relays the
 * shared secret to `raise_sos`, which checks it against a stored digest.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Replies to our own reminders, which must not raise an emergency.
 *
 * Deliberately a short, closed list of pure acknowledgements. Anything longer
 * than a few words is treated as a person saying something, because the cost
 * of ignoring a real message is not comparable to the cost of a false alarm.
 */
const ACKS = new Set([
  "ok", "okay", "k", "thik", "theek", "theek hai", "thik hai", "ji", "ji haan",
  "haan", "ha", "yes", "y", "done", "thanks", "thank you", "dhanyavaad",
  "ठीक", "ठीक है", "हाँ", "हां", "जी", "जी हाँ", "धन्यवाद", "ok ji",
]);

function isAck(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[.!,]/g, "");
  return ACKS.has(t) || (t.length <= 3 && /^[a-zऀ-ॿ]+$/.test(t));
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const secret =
    req.headers.get("x-sos-secret") ?? url.searchParams.get("key") ?? process.env.SOS_SECRET ?? "";

  let from = "";
  let body = "";
  try {
    const type = req.headers.get("content-type") ?? "";
    const fields = type.includes("json")
      ? ((await req.json()) as Record<string, string>)
      : (Object.fromEntries((await req.formData()).entries()) as Record<string, string>);
    from = fields.From ?? fields.from ?? fields.CallFrom ?? fields.msisdn ?? "";
    body = fields.Body ?? fields.body ?? fields.text ?? fields.message ?? "";
  } catch {
    /* handled below */
  }

  // WhatsApp numbers arrive prefixed; the senior's record holds a bare one.
  from = from.replace(/^whatsapp:/i, "").trim();

  const xml = (say: string) =>
    new NextResponse(
      `<?xml version="1.0" encoding="UTF-8"?><Response>${say ? `<Message>${say}</Message>` : ""}</Response>`,
      { status: 200, headers: { "Content-Type": "text/xml; charset=utf-8" } },
    );

  if (!from) return xml("");

  // An acknowledgement of a reminder is not an emergency. Answering nothing
  // is correct here: a reply to "take your medicines" needs no reply.
  if (body && isAck(body)) return xml("");

  const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabase || !anon) return xml("");

  const raised = (await fetch(`${supabase}/rest/v1/rpc/raise_sos`, {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ p_secret: secret, p_phone: from, p_senior_id: null }),
    cache: "no-store",
  })
    .then((r) => r.json())
    .catch(() => null)) as { ok?: boolean; language?: string } | null;

  // An unknown number gets nothing back. Somebody texted a wrong number; they
  // are not owed an explanation of what this service is.
  if (!raised?.ok) return xml("");

  // Reply in their language, and promise only what has happened.
  return xml(
    raised.language === "en"
      ? "We have your message. Your care coordinator has been told and is calling you now."
      : "आपका संदेश मिल गया है। आपके केयर कोऑर्डिनेटर को बता दिया गया है, वह अभी फ़ोन कर रहे हैं।",
  );
}

export async function GET() {
  return NextResponse.json({ ok: true, channel: "sms-sos", method: "POST" });
}
