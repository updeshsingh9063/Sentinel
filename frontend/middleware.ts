import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { LANG_COOKIE, isLang } from "./lib/i18n";
import { DEMO_USERS, isDemoRole, isGuarded, mayOpen } from "./lib/session";

/**
 * Session refresh plus a role gate.
 *
 * Still defence in depth, not the boundary. RLS is the boundary: a family
 * member holds no policy on vitals, notes, cues or risk scores, so a routing
 * bug here cannot surface individual health data -- the query comes back
 * empty. This exists so nobody is shown a page that would be blank, and so
 * the role switch visibly does something.
 *
 * What changed from the cookie demo: the role is no longer forgeable. It comes
 * from a signed Supabase JWT, and every request also refreshes that session so
 * it does not expire mid-demo.
 *
 * /checkin is deliberately NOT guarded -- a senior has no account. See
 * lib/session.ts.
 */
export async function middleware(request: NextRequest) {
  // ?lang=hi makes a language deep-linkable — someone can send their parent a
  // Hindi link directly — and persists the choice, so it behaves the same as
  // using the switch. The page itself only ever reads the cookie.
  //
  // It has to go on BOTH sides: on the request so this render already sees it
  // (server components read the request cookies), and on the response so it
  // sticks. Applied via withLang below because the Supabase client rebuilds
  // `response` when it refreshes the session, which would drop a Set-Cookie
  // written here.
  const wanted = request.nextUrl.searchParams.get("lang");
  const setLang =
    isLang(wanted) && request.cookies.get(LANG_COOKIE)?.value !== wanted ? wanted : null;
  if (setLang) request.cookies.set(LANG_COOKIE, setLang);

  const withLang = <T extends NextResponse>(res: T): T => {
    if (setLang) {
      res.cookies.set(LANG_COOKIE, setLang, {
        path: "/",
        maxAge: 31536000,
        sameSite: "lax",
      });
    }
    return res;
  };

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          toSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          toSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Must be getUser(), not getSession(): only getUser() revalidates the token
  // with the auth server, and the cookie is attacker-controlled input.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Public routes still fall through here so the session gets refreshed.
  if (!isGuarded(pathname)) return withLang(response);

  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = "/signin";
    url.searchParams.set("next", pathname);
    return withLang(NextResponse.redirect(url));
  }

  // The role is mirrored into user_metadata at account creation so the common
  // path costs no query. app_users.role stays the source of truth, so fall
  // back to it if an account predates that mirroring.
  let role = user.user_metadata?.demo_role as string | undefined;
  if (!isDemoRole(role)) {
    const { data } = await supabase
      .from("app_users")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    role = data?.role;
  }

  if (!isDemoRole(role)) {
    // Signed in but carrying no app role: send them to sign in rather than to
    // a page that would render empty.
    const url = request.nextUrl.clone();
    url.pathname = "/signin";
    url.searchParams.set("next", pathname);
    return withLang(NextResponse.redirect(url));
  }

  if (!mayOpen(role, pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = DEMO_USERS[role].home;
    url.search = "";
    return withLang(NextResponse.redirect(url));
  }

  return withLang(response);
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|img|video|favicon.ico).*)"],
};
