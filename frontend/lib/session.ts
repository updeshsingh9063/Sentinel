/**
 * Session and role metadata.
 *
 * THIS IS NOW REAL AUTHENTICATION. Coordinator, family and operations each
 * sign in through Supabase Auth with a password, and their role comes from
 * `app_users.role` -- mirrored into the JWT's user_metadata so middleware can
 * read it without a database round trip per request.
 *
 * A SENIOR NEVER SIGNS IN. The schema says so outright: a senior has no row in
 * app_users because the brief forbids a senior-facing app. /checkin is a
 * simulator of what she hears on a basic phone, so it is deliberately public
 * and absent from GUARDED. Putting it behind a login would misrepresent the
 * product.
 *
 * What makes the privacy story true is still not this file. It is the schema:
 * a family member holds no RLS policy on vitals, notes, cues or risk scores,
 * so even a valid family session reads nothing from them. Verified against the
 * live project -- see backend/supabase/migrations/0003 and 0004 for the one
 * place that guarantee had a hole, and how it was closed.
 */

export type DemoRole = "coordinator" | "family" | "ops" | "senior";

/** Roles that hold an account. `senior` is absent by design. */
export type AuthRole = Exclude<DemoRole, "senior">;

/**
 * Structural facts about a role. The display strings — name, job title and the
 * one-line "what this role sees" — live in lib/i18n-app.ts under `roles`,
 * because they are translated. Keeping an English copy here as well would be
 * two sources of truth, and the one nobody updates wins.
 */
export interface DemoUser {
  role: DemoRole;
  initials: string;
  home: string;
  /** The seeded demo account. Absent for `senior`, which has no account. */
  email?: string;
}

export const DEMO_USERS: Record<DemoRole, DemoUser> = {
  coordinator: {
    role: "coordinator",
    initials: "PS",
    home: "/worklist",
    email: "coordinator@samarth.demo",
  },
  family: {
    role: "family",
    initials: "AD",
    home: "/summary",
    email: "family@samarth.demo",
  },
  ops: {
    role: "ops",
    initials: "RM",
    home: "/dashboard",
    email: "ops@samarth.demo",
  },
  senior: {
    role: "senior",
    initials: "SD",
    home: "/checkin",
  },
};

export const ROLE_ORDER: DemoRole[] = ["coordinator", "family", "ops", "senior"];

/**
 * Shared password for the three seeded demo accounts.
 *
 * Safe to ship in the client only because these accounts hold nothing but
 * synthetic data and the project is a hackathon demo. A real deployment issues
 * credentials per coordinator and this constant does not exist.
 */
export const DEMO_PASSWORD = "SamarthDemo!2026";

/** Route prefixes each role may open. Everything else redirects to its home. */
export const ALLOWED: Record<DemoRole, string[]> = {
  // Coordinators may open the ops view: the view is granted to `authenticated`
  // and emits only aggregates, so there is nothing there they should not see.
  coordinator: ["/worklist", "/senior", "/dashboard"],
  family: ["/summary"],
  ops: ["/dashboard"],
  senior: ["/checkin"],
};

/**
 * Prefixes that require a signed-in session. /checkin is NOT here: the senior
 * has no account, and the simulator is part of the public story.
 */
export const GUARDED = ["/worklist", "/senior", "/summary", "/dashboard"];

export function isDemoRole(value: string | undefined | null): value is DemoRole {
  return (
    value === "coordinator" || value === "family" || value === "ops" || value === "senior"
  );
}

export function mayOpen(role: DemoRole, pathname: string): boolean {
  return ALLOWED[role].some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export function isGuarded(pathname: string): boolean {
  return GUARDED.some((p) => pathname === p || pathname.startsWith(p + "/"));
}
