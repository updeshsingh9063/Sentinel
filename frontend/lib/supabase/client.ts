"use client";

import { createBrowserClient } from "@supabase/ssr";

// Browser client. Carries the user session, so every query is subject to RLS.
// There is no service-role key on this side by design.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
