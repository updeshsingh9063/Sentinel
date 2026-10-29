"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { createClient } from "@/lib/supabase/client";
import type { AppCopy } from "@/lib/i18n-app";

/**
 * The one thing a family member can put INTO the system.
 *
 * Everywhere else the family view is read-only by design, which is right for
 * health data flowing outward. This goes the other way: a daughter noticing
 * her father sounded confused on Sunday knows something no sensor recorded,
 * and the only person who can act on it is the coordinator.
 *
 * It writes as the signed-in user through the ordinary anon key, so the
 * insert policy is what decides whether it lands. `author_id` is set from the
 * session rather than passed in, and the policy checks it against auth.uid()
 * anyway — a note cannot be attributed to anyone else even if this code tried.
 *
 * No character counter and no formatting. The person using this is worried
 * about their parent, not composing a document.
 */
export function FamilyNote({
  seniorId,
  t,
}: {
  seniorId: string;
  t: AppCopy["family"];
}) {
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "sent" | "error">("idle");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const note = text.trim();
    if (!note || pending) return;

    const supabase = createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) {
      setState("error");
      return;
    }

    const { error } = await supabase.from("family_notes").insert({
      senior_id: seniorId,
      author_id: auth.user.id,
      note_text: note,
    });

    if (error) {
      setState("error");
      return;
    }

    setText("");
    setState("sent");
    // Refresh so the note appears in the list below without a reload.
    startTransition(() => router.refresh());
  }

  return (
    <form className="fn" onSubmit={submit}>
      <label className="fn__label" htmlFor="family-note">
        {t.noteTitle}
      </label>
      <p className="fn__hint">{t.noteHint}</p>

      <textarea
        id="family-note"
        className="fn__input"
        rows={3}
        maxLength={1000}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (state !== "idle") setState("idle");
        }}
        placeholder={t.notePlaceholder}
      />

      <div className="fn__row">
        <button type="submit" className="btn btn--forest fn__send" disabled={!text.trim() || pending}>
          {pending ? t.noteSending : t.noteSend}
        </button>
        {state === "sent" && <span className="fn__ok">{t.noteSent}</span>}
        {state === "error" && <span className="fn__err">{t.noteError}</span>}
      </div>

      <style>{`
        .fn { display: grid; gap: var(--s-2); }
        .fn__label { font-size: var(--fs-sm); font-weight: 600; }
        .fn__hint { font-size: var(--fs-xs); line-height: 1.6; color: var(--ink-3); }
        .fn__input {
          font: inherit; font-size: 1rem; line-height: 1.6;
          padding: var(--s-3) var(--s-4);
          border: 1px solid var(--line); border-radius: var(--radius);
          background: var(--white); color: var(--ink);
          width: 100%; resize: vertical; margin-top: var(--s-2);
        }
        .fn__input:focus-visible { outline: 2px solid var(--forest); outline-offset: -1px; }
        .fn__row { display: flex; align-items: center; gap: var(--s-4); flex-wrap: wrap; margin-top: var(--s-2); }
        .fn__send { min-height: 2.75rem; }
        .fn__send:disabled { opacity: 0.5; cursor: default; }
        .fn__ok { font-size: var(--fs-sm); color: var(--risk-low); font-weight: 600; }
        .fn__err { font-size: var(--fs-sm); color: var(--risk-high); font-weight: 600; }
      `}</style>
    </form>
  );
}
