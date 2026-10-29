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
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next");

  // Google returns its own error params when the user cancels or the provider
  // is misconfigured. Pass the description through; it is the actual reason.
  const oauthError = searchParams.get("error_description") || searchParams.get("error");
  if (oauthError) {
    return NextResponse.redirect(
      `${origin}/signin?error=${encodeURIComponent(oauthError)}`,
    );
  }

  if (!code) {
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

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(
      `${origin}/signin?error=${encodeURIComponent(error.message)}`,
    );
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
