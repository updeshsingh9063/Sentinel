"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { createClient } from "@/lib/supabase/client";

/**
 * Ends the Supabase session and returns to the role picker.
 *
 * Labels arrive as props: this is a client component, so it cannot read the
 * language cookie itself.
 */
export function SignOut({ label, busyLabel }: { label: string; busyLabel: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function out() {
    setBusy(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/signin");
    router.refresh();
  }

  return (
    <button type="button" className="signout" onClick={out} disabled={busy}>
      {busy ? busyLabel : label}
      <style>{`
        .signout {
          font: inherit; font-size: var(--fs-xs);
          color: var(--ink-3); background: none;
          border: 1px solid var(--line-2); border-radius: var(--radius-pill);
          padding: 4px var(--s-3); cursor: pointer; white-space: nowrap;
          transition: border-color var(--dur) var(--ease), color var(--dur) var(--ease);
        }
        .signout:hover:not(:disabled) { color: var(--ink); border-color: var(--ink); }
        .signout:disabled { opacity: 0.55; cursor: default; }
      `}</style>
    </button>
  );
}
