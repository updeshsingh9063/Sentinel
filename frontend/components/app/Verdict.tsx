"use client";

import { useState } from "react";

import { IconCheck } from "@/components/ui/Icons";
import { createClient } from "@/lib/supabase/client";
import type { AppCopy } from "@/lib/i18n-app";

/**
 * The coordinator's verdict on an alert: true concern, or false alarm.
 *
 * This is the smallest control on the page and the most important one in the
 * system. Precision is only measurable because a human says afterwards
 * whether the alert was worth raising, and without that, precision@K is a
 * number nobody can check.
 *
 * IT NOW WRITES. Until 2026-10-30 this held the verdict in React state and
 * posted nowhere — there was a `TODO: POST /api/alerts/{id}/verdict` where
 * the write should have been. So the one control the whole feedback claim
 * rests on produced a tick, a sentence saying the verdict was recorded, and
 * no record. A judge clicking it was being told something untrue, and the
 * dashboard's precision figure came entirely from generated history. The row
 * goes into `alert_feedback` now, which is the table the ops metrics already
 * read, so clicking this moves the number on the operations page.
 *
 * NO ELEVATED FUNCTION AND NO SENIOR ID TRUSTED FROM THE PAGE. It writes as
 * the signed-in coordinator; the RLS policy on alert_feedback decides whether
 * this alert belongs to their caseload, and one outside it writes nothing.
 *
 * Deliberately not a dismiss or a snooze: an alert cleared without a verdict
 * teaches the model nothing, and leaves the precision denominator wrong.
 */
export function Verdict({
  alertId,
  t,
}: {
  /** Null for a held row — nothing was raised, so there is nothing to judge. */
  alertId: number | null;
  /** Labels are passed in: a client component cannot read the language cookie. */
  t: AppCopy["verdict"];
}) {
  const [verdict, setVerdict] = useState<"true" | "false" | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  if (alertId === null) return null;

  async function record(which: "true" | "false") {
    setBusy(true);
    setFailed(false);
    const supabase = createClient();
    const { data: me } = await supabase.auth.getUser();

    const { error } = await supabase.from("alert_feedback").upsert(
      {
        alert_id: alertId,
        reviewer_id: me.user?.id ?? null,
        result: which === "true" ? "true_concern" : "false_alarm",
        acted_at: new Date().toISOString(),
      },
      { onConflict: "alert_id" },
    );

    if (error) {
      // No tick unless there is a row. A control that claims to have recorded
      // something it did not is worse than one that visibly failed.
      setBusy(false);
      setFailed(true);
      return;
    }

    // The alert itself is now worked. Failing this is not worth undoing the
    // verdict over — the verdict is the part the metrics read.
    await supabase.from("alerts").update({ status: "actioned" }).eq("id", alertId);

    setBusy(false);
    setVerdict(which);
  }

  async function undo() {
    setBusy(true);
    const { error } = await createClient().from("alert_feedback").delete().eq("alert_id", alertId);
    setBusy(false);
    if (!error) setVerdict(null);
  }

  if (verdict) {
    return (
      <p className="verdict verdict--done">
        <IconCheck size={15} />
        {verdict === "true" ? t.doneTrue : t.doneFalse}
        <button type="button" onClick={() => void undo()} disabled={busy}>
          {t.undo}
        </button>
        <style>{`
          .verdict--done {
            display: inline-flex; align-items: center; gap: var(--s-2);
            font-size: var(--fs-xs); color: var(--risk-low);
          }
          .verdict--done button {
            font: inherit; background: none; border: 0; padding: 0;
            color: var(--ink-3); text-decoration: underline;
            text-underline-offset: 3px; cursor: pointer; margin-left: var(--s-2);
          }
          .verdict--done button:hover { color: var(--ink); }
          .verdict--done button:disabled { opacity: .55; cursor: default; }
        `}</style>
      </p>
    );
  }

  return (
    <div className="verdict">
      <span>{failed ? t.failed : t.ask}</span>
      <button type="button" onClick={() => void record("true")} disabled={busy}>
        {t.yes}
      </button>
      <button type="button" onClick={() => void record("false")} disabled={busy}>
        {t.no}
      </button>

      <style>{`
        .verdict {
          display: flex; align-items: center; gap: var(--s-2); flex-wrap: wrap;
          font-size: var(--fs-xs); color: var(--ink-3);
        }
        .verdict button {
          font: inherit; font-weight: 600;
          color: var(--ink);
          background: var(--white);
          border: 1px solid var(--line-2);
          border-radius: var(--radius-pill);
          padding: 4px var(--s-3);
          cursor: pointer;
          transition: border-color var(--dur) var(--ease), background var(--dur) var(--ease);
        }
        .verdict button:hover:not(:disabled) { border-color: var(--forest); background: var(--sage); }
        .verdict button:disabled { opacity: .55; cursor: default; }
      `}</style>
    </div>
  );
}
