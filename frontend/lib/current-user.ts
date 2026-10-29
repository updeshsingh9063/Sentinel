import { cache } from "react";

import type { DemoRole } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

/**
 * Who is signed in, resolved once per request.
 *
 * TWO THINGS MAKE THIS FAST, AND BOTH MATTER.
 *
 * First, `cache()`. Every signed-in page needs the viewer twice — the app bar
 * wants their name, the layout wants their role to choose navigation — and
 * without memoisation that is two identical lookups per render. React's
 * per-request cache collapses them.
 *
 * Second, it reads the SESSION rather than calling `getUser()`. A round trip
 * to the auth server measured 485ms against this project, and middleware has
 * already made exactly that call for this request: it validated the token and
 * refreshed the cookies before the page began rendering. Calling again from
 * the page would pay the same half second a second time to learn the same
 * thing.
 *
 * That is safe here because NOTHING IS AUTHORISED ON THIS RESULT. It supplies
 * a display name and picks which links to draw. Every row of data is still
 * fetched under row-level security with the user's own token, so a forged
 * cookie would change the name in the corner and return no data whatsoever.
 * Access control is the database's job and this is not part of it.
 */

export interface CurrentUser {
  id: string | null;
  role: DemoRole | null;
  name: string;
  initials: string;
}

function initialsOf(name: string): string {
  return (
    name
      .split(/[\s.@_-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part: string) => part[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

export const getCurrentUser = cache(async (): Promise<CurrentUser> => {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const user = session?.user;
  if (!user) return { id: null, role: null, name: "", initials: "?" };

  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const metaName = typeof meta.full_name === "string" ? meta.full_name.trim() : "";
  const metaRole = typeof meta.demo_role === "string" ? meta.demo_role : "";

  // The JWT carries both for anyone who registered through the public form,
  // which costs no query at all. The seeded demo accounts were created
  // through the admin API and have neither, so they fall through to one
  // lookup — and app_users is readable only for your own row, so this cannot
  // return somebody else even if the id were wrong.
  let name = metaName;
  let role = metaRole;
  if (!name || !role) {
    const { data } = await supabase
      .from("app_users")
      .select("role, full_name")
      .eq("id", user.id)
      .maybeSingle();
    name = name || (data?.full_name ?? "").trim();
    role = role || (data?.role ?? "");
  }

  // Last resort: the local part of the address. Better than a blank corner,
  // and far better than another account's name, which is what this showed
  // before — every signed-in page greeted everyone as the demo coordinator.
  name = name || user.email?.split("@")[0] || "";

  return {
    id: user.id,
    role: (role || null) as DemoRole | null,
    name,
    initials: initialsOf(name),
  };
});
