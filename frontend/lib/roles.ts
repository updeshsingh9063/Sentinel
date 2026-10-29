import type { Role } from "./types";

// Where each role lands after sign-in. A family member must never be routed
// into the coordinator tree, which holds individual health data.
export const HOME_FOR: Record<Role, string> = {
  coordinator: "/worklist",
  family: "/summary",
  ops: "/dashboard",
  admin: "/worklist",
};

export const ALLOWED_PREFIXES: Record<Role, string[]> = {
  coordinator: ["/worklist", "/senior"],
  family: ["/summary"],
  ops: ["/dashboard"],
  admin: ["/worklist", "/senior", "/summary", "/dashboard"],
};
