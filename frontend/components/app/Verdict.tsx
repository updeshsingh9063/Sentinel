"use client";

import { useState } from "react";

import { IconCheck } from "@/components/ui/Icons";
import type { AppCopy } from "@/lib/i18n-app";

/**
 * The coordinator's verdict on an alert: true concern, or false alarm.
 *
 * This is the smallest control on the page and the most important one in the
 * whole system. Precision is only measurable because a human says afterwards
 * whether the alert was worth raising, and the brief asks for exactly this
 * feedback loop. Without it, precision@K is a number nobody can check.
 *
 * It holds state locally for the demo and does not post anywhere yet — the
 * endpoint is noted below. It is deliberately not a dismiss or snooze button:
 * an alert that is cleared without a verdict teaches the model nothing.
 */
export function Verdict({
  seniorId,
  t,
}: {
  seniorId: string;
  /** Labels are passed in: a client component cannot read the language cookie. */
  t: AppCopy["verdict"];
}) {
  const [verdict, setVerdict] = useState<"true" | "false" | null>(null);

  // TODO: POST /api/alerts/{seniorId}/verdict
  void seniorId;

  if (verdict) {
    return (
      <p className="verdict verdict--done">
        <IconCheck size={15} />
        {verdict === "true" ? t.doneTrue : t.doneFalse}
        <button type="button" onClick={() => setVerdict(null)}>
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
        `}</style>
      </p>
    );
  }

  return (
    <div className="verdict">
      <span>{t.ask}</span>
      <button type="button" onClick={() => setVerdict("true")}>
        {t.yes}
      </button>
      <button type="button" onClick={() => setVerdict("false")}>
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
        .verdict button:hover { border-color: var(--forest); background: var(--sage); }
      `}</style>
    </div>
  );
}
