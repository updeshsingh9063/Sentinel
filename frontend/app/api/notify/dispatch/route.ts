import { NextResponse } from "next/server";

/**
 * Deliver the queued family messages.
 *
 * THE HONEST PART, AND THE WHOLE REASON THIS ROUTE IS SHAPED LIKE THIS: a
 * message is marked `sent` only when a provider has accepted it and handed
 * back a reference. With no provider configured, every message stays `queued`
 * and this route says so. It would be one line to flip them to `sent` and
 * show a family a tidy "delivered" column, and that line would make the whole
 * privacy and escalation story a lie — the one place in this product where a
 * false claim could get somebody hurt is the one that says their daughter was
 * told.
 *
 * TWILIO IS WIRED BUT NOT CONNECTED. When TWILIO_ACCOUNT_SID, TWILIO_TOKEN
 * and TWILIO_FROM are present, this sends. They are deliberately absent: an
 * Indian mobile can only be reached from a non-Indian Twilio number, every
 * destination must be verified on a trial account, and India's DND registry
 * can refuse a commercial call or message outright. Those are real
 * constraints to meet before a demo, not after.
 *
 * NO SERVICE-ROLE KEY. It runs as the signed-in coordinator, whose RLS policy
 * on family_notifications already limits them to their own caseload — so this
 * route cannot touch a message about somebody they do not carry.
 */

import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Queued {
  id: number;
  body: string;
  channel: string;
  family_user_id: string | null;
  /**
   * The number to send to, when the recipient is not an app user.
   *
   * A senior's telephone is on `seniors`, not `app_users` — a senior has no
   * login, by design. Carrying the number on the message also means the
   * delivery audit shows what was actually dialled rather than whatever the
   * record says later.
   */
  to_phone: string | null;
  recipient: string;
}

async function sendOne(to: string, body: string, channel: string) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_TOKEN;
  const from = process.env.TWILIO_FROM;
  if (!sid || !token || !from) return { ok: false as const, reason: "no_provider" };

  const prefix = channel === "whatsapp" ? "whatsapp:" : "";
  const form = new URLSearchParams({
    To: `${prefix}${to}`,
    From: `${prefix}${from}`,
    Body: body,
  });

  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
    const data = (await res.json()) as { sid?: string; message?: string };
    if (!res.ok || !data.sid) {
      return { ok: false as const, reason: data.message ?? `provider ${res.status}` };
    }
    return { ok: true as const, ref: data.sid };
  } catch {
    return { ok: false as const, reason: "provider unreachable" };
  }
}

export async function POST() {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("family_notifications")
    .select("id, body, channel, family_user_id, to_phone, recipient")
    .eq("state", "queued")
    .limit(25);

  if (error) {
    return NextResponse.json({ ok: false, reason: "unreadable" }, { status: 403 });
  }

  const queued = (data ?? []) as Queued[];
  if (!queued.length) {
    return NextResponse.json({ ok: true, sent: 0, queued: 0, provider: providerName() });
  }

  // Phone numbers come from app_users, read under the same session. A message
  // whose recipient has no number is not a failure of delivery — there is
  // nowhere to deliver it — so it is recorded as such rather than retried.
  const ids = [...new Set(queued.map((q) => q.family_user_id).filter(Boolean))] as string[];
  const { data: people } = await supabase
    .from("app_users")
    .select("id, phone")
    .in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
  const phoneById = new Map((people ?? []).map((p) => [p.id as string, (p.phone as string) ?? ""]));

  let sent = 0;
  let stillQueued = 0;

  for (const q of queued) {
    // An explicit number wins: it was resolved when the message was written,
    // which is the number the sender meant.
    const to = q.to_phone || (q.family_user_id ? phoneById.get(q.family_user_id) : "");
    if (!to) {
      await supabase
        .from("family_notifications")
        .update({
          state: "failed",
          reason:
            q.recipient === "coordinator"
              ? "No phone number on file for this coordinator."
              : q.recipient === "senior"
                ? "No phone number on this senior's record."
                : "No phone number on file for this family member.",
        })
        .eq("id", q.id);
      continue;
    }

    const out = await sendOne(to, q.body, q.channel);
    if (out.ok) {
      await supabase
        .from("family_notifications")
        .update({ state: "sent", sent_at: new Date().toISOString(), provider_ref: out.ref })
        .eq("id", q.id);
      sent += 1;
    } else if (out.reason === "no_provider") {
      // Left exactly as it was. Not failed — nothing was attempted.
      stillQueued += 1;
    } else {
      await supabase
        .from("family_notifications")
        .update({ state: "failed", reason: out.reason })
        .eq("id", q.id);
    }
  }

  return NextResponse.json({
    ok: true,
    sent,
    queued: stillQueued,
    provider: providerName(),
    note: providerName() === "none" ? "No SMS provider configured — nothing was sent." : undefined,
  });
}

function providerName(): string {
  return process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_TOKEN && process.env.TWILIO_FROM
    ? "twilio"
    : "none";
}

export async function GET() {
  return NextResponse.json({ ok: true, provider: providerName(), method: "POST" });
}
