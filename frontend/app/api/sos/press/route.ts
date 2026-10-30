import { NextResponse } from "next/server";

/**
 * The emergency button, pressed from a page rather than a device.
 *
 * THE SECRET NEVER LEAVES THIS PROCESS. /api/sos is built for a physical
 * button or a provider webhook, both of which can hold a credential. A
 * browser cannot: anything shipped to a page is public. So the page posts
 * here with no body at all, and the secret is added server-side.
 *
 * IT TAKES NO SENIOR ID. There is no argument that could aim this at
 * somebody else — the target is whichever senior carries the demo line, in
 * the database, exactly as the conversation and errand functions work.
 *
 * WHAT A CALLER LEARNS: that the alarm was accepted. Not whose it was. A
 * button does not get to read a name back out of the system.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const secret = process.env.SOS_SECRET;

  if (!url || !anon || !secret) {
    return NextResponse.json({ ok: false, reason: "not_configured" }, { status: 503 });
  }

  let verdict: { ok?: boolean; reason?: string; first?: boolean } | null = null;
  try {
    const r = await fetch(`${url}/rest/v1/rpc/raise_sos_demo`, {
      method: "POST",
      headers: { apikey: anon, "Content-Type": "application/json" },
      body: JSON.stringify({ p_secret: secret }),
      cache: "no-store",
    });
    verdict = await r.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "upstream" }, { status: 502 });
  }

  if (verdict?.ok) {
    // `first` distinguishes the alarm from a repeat press, which the page
    // says differently: a second press means nobody has reached them yet.
    return NextResponse.json({ ok: true, first: verdict.first === true });
  }

  const status = verdict?.reason === "unauthorized" ? 401 : 400;
  return NextResponse.json({ ok: false, reason: verdict?.reason ?? "failed" }, { status });
}

/** A health check must not get a 405. */
export async function GET() {
  return NextResponse.json({
    ok: true,
    configured: !!(process.env.SOS_SECRET && process.env.NEXT_PUBLIC_SUPABASE_URL),
  });
}
