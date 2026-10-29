import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { DEMO_USERS, isDemoRole, mayOpen } from "@/lib/session";

/**
 * OAuth return leg.
 *
 * Google sends the browser back here with a one-time `code`. It has to be
 * exchanged for a session ON THE SERVER, because @supabase/ssr keeps the
 * session in cookies that the middleware and every server component read. A
 * client-side exchange would leave the session in browser storage only, and
 * the server would keep redirecting a signed-in user back to /signin.
 *
 * Errors land back on /signin with a readable message rather than a blank
 * page: the most likely failure here is the Google provider not being enabled
 * on the project yet, and that should say so.
 *
 * IT IS ALSO THE PASSWORD-RESET RETURN LEG. A recovery link lands here with
 * `flow=recovery`, and once the code is exchanged the browser is sent to
 * /signin?flow=reset to choose a new password rather than to the role's home
 * page. Sending them home would be worse than useless: they would be signed
 * in with the password they could not remember, and the reason they came
 * would be silently dropped.
 *
 * TWO LINK SHAPES, because Supabase's email template decides which one is
 * sent. The default template produces a `code` to exchange. A template using
 * {{ .TokenHash }} produces `token_hash` + `type`, which `verifyOtp` accepts
 * and which — unlike the PKCE code — works when the email is opened on a
 * different device from the one that asked for the reset. That is the common
 * case (request on a laptop, read the mail on a phone), so both are handled.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const otpType = searchParams.get("type");
  const next = searchParams.get("next");
  const recovery = searchParams.get("flow") === "recovery" || otpType === "recovery";

  // Google returns its own error params when the user cancels or the provider
  // is misconfigured. Pass the description through; it is the actual reason.
  const oauthError = searchParams.get("error_description") || searchParams.get("error");
  if (oauthError) {
    // An expired or reused recovery link arrives as an error here. It is not
    // the same failure as a broken OAuth provider, and saying "reset links
    // expire, ask for another" is the only useful thing to tell someone who
    // is already locked out.
    const back = recovery ? "/signin?flow=reset&expired=1" : "/signin";
    const join = back.includes("?") ? "&" : "?";
    return NextResponse.redirect(
      `${origin}${back}${join}error=${encodeURIComponent(oauthError)}`,
    );
  }

  if (!code && !tokenHash) {
    return NextResponse.redirect(`${origin}/signin`);
  }

  let response = NextResponse.redirect(`${origin}/`);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          toSet.forEach(({ name, value }) => request.cookies.set(name, value));
          toSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const { data, error } = tokenHash
    ? await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: (otpType as "recovery" | "email") ?? "recovery",
      })
    : await supabase.auth.exchangeCodeForSession(code!);

  if (error) {
    const back = recovery ? "/signin?flow=reset&expired=1&" : "/signin?";
    return NextResponse.redirect(
      `${origin}${back}error=${encodeURIComponent(error.message)}`,
    );
  }

  // A recovery session exists to change one thing. Hand it to the form that
  // changes it, whatever role the account turns out to hold.
  if (recovery) {
    const final = NextResponse.redirect(`${origin}/signin?flow=reset`);
    response.cookies.getAll().forEach((c) => final.cookies.set(c));
    return final;
  }

  // The role is whatever the database trigger granted. A Google account
  // carries no sign-up metadata, so the trigger defaults it to `family` —
  // the least privileged role. That is deliberate: letting an OAuth user
  // choose their own role would hand out caseload access to anyone with a
  // Google account.
  let role = data.user?.user_metadata?.demo_role as string | undefined;
  if (!isDemoRole(role)) {
    const { data: row } = await supabase
      .from("app_users")
      .select("role")
      .eq("id", data.user!.id)
      .maybeSingle();
    role = row?.role;
  }

  const home = isDemoRole(role) ? DEMO_USERS[role].home : "/summary";
  const target = next && isDemoRole(role) && mayOpen(role, next) ? next : home;

  // Rebuild the redirect so the auth cookies written above travel with it.
  const final = NextResponse.redirect(`${origin}${target}`);
  response.cookies.getAll().forEach((c) => final.cookies.set(c));
  return final;
}
