"use client";

import { useState } from "react";

import { IconPhone } from "@/components/ui/Icons";
import { fmt } from "@/lib/i18n";
import type { AppCopy } from "@/lib/i18n-app";

/**
 * Ring a senior now, from the coordinator's own list.
 *
 * WHY THIS BUTTON EXISTS. The daily round decides who to call at nine in the
 * morning. But a coordinator reading the worklist at eleven has just learned
 * something the round did not know — a reason moved, a family member wrote in
 * — and the honest response to "this person needs a call" is a call, not a
 * note to ring them tomorrow. Without this, the only path from the ranking to
 * a conversation was a human picking up their own telephone, which is the
 * work the product claims to remove.
 *
 * IT CONFIRMS FIRST, AND THAT IS NOT POLITENESS. Pressing it rings an elderly
 * person's telephone and spends money. Neither can be taken back, and a
 * single stray click on a dense list of rows should not be able to do it. The
 * confirm names the senior, so a misclick is visible before it costs
 * anything rather than after.
 *
 * IT TRUSTS NOTHING FROM THIS PAGE. The senior id goes to /api/call/place,
 * which reads that senior AS THE SIGNED-IN COORDINATOR: if the caseload does
 * not contain them, RLS returns no row, there is no number, and nothing is
 * dialled. The check and the lookup are one operation, so they cannot drift
 * apart — and an id edited in the browser buys nothing.
 *
 * IT DOES NOT CLAIM THE CALL WAS ANSWERED. All it can honestly report is that
 * the provider accepted the call; whether anybody picks up arrives later, as
 * a check-in on this same page. Saying more would be the same failure as a
 * control that reports a verdict it never saved.
 */
export function CallNow({
  seniorId,
  name,
  t,
}: {
  seniorId: string;
  /** Shown in the confirm, so a misclick is caught by reading a name. */
  name: string;
  /** Labels are passed in: a client component cannot read the language cookie. */
  t: AppCopy["callNow"];
}) {
  const [phase, setPhase] = useState<"idle" | "asking" | "dialling" | "ringing" | "failed">("idle");
  const [why, setWhy] = useState<string>("");

  async function place() {
    setPhase("dialling");
    let res: Response;
    try {
      res = await fetch("/api/call/place", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seniorId }),
      });
    } catch {
      setWhy(t.failed);
      setPhase("failed");
      return;
    }

    if (res.ok) {
      setPhase("ringing");
      return;
    }

    // Each failure says something different to the person reading it. A single
    // "something went wrong" would leave a coordinator unable to tell "this
    // deployment cannot call anyone" from "this senior has no number", which
    // are a deployment problem and a record problem respectively.
    const body = (await res.json().catch(() => null)) as { reason?: string } | null;
    setWhy(
      res.status === 503
        ? t.notConfigured
        : res.status === 404
          ? t.noNumber
          : body?.reason
            ? `${t.failed} ${body.reason}`
            : t.failed,
    );
    setPhase("failed");
  }

  if (phase === "ringing") {
    return (
      <p className="cn cn--live">
        <span className="cn__pulse" aria-hidden="true" />
        <span>
          <strong>{fmt(t.ringing, { name })}</strong>
          <em>{t.note}</em>
        </span>
        <style>{`
          .cn--live {
            display: flex; align-items: flex-start; gap: var(--s-2);
            font-size: var(--fs-xs); color: var(--ink-2);
          }
          .cn--live span { display: flex; flex-direction: column; }
          .cn--live strong { font-weight: 600; color: var(--ink); }
          .cn--live em { font-style: normal; color: var(--ink-3); }
          .cn__pulse {
            width: 8px; height: 8px; border-radius: 50%;
            background: var(--risk-low); margin-top: 5px; flex: none;
            animation: cnPulse 1.4s var(--ease) infinite;
          }
          @keyframes cnPulse { 50% { opacity: .25; transform: scale(.7); } }
          @media (prefers-reduced-motion: reduce) {
            .cn__pulse { animation: none; }
          }
        `}</style>
      </p>
    );
  }

  if (phase === "asking") {
    return (
      <div className="cn">
        <span className="cn__ask">{fmt(t.confirm, { name })}</span>
        <button type="button" className="cn__go" onClick={() => void place()}>
          <IconPhone size={14} /> {t.label}
        </button>
        <button type="button" onClick={() => setPhase("idle")}>
          {t.cancel}
        </button>
        <Styles />
      </div>
    );
  }

  return (
    <div className="cn">
      {phase === "failed" && <span className="cn__bad">{why}</span>}
      <button
        type="button"
        className={phase === "failed" ? "" : "cn__go"}
        onClick={() => setPhase("asking")}
        disabled={phase === "dialling"}
      >
        <IconPhone size={14} />
        {phase === "dialling" ? t.dialling : phase === "failed" ? t.retry : t.label}
      </button>
      <Styles />
    </div>
  );
}

/** One copy of the shared rules, rather than three that can drift apart. */
function Styles() {
  return (
    <style>{`
      .cn {
        display: flex; align-items: center; gap: var(--s-2); flex-wrap: wrap;
        font-size: var(--fs-xs); color: var(--ink-3);
      }
      .cn button {
        display: inline-flex; align-items: center; gap: 6px;
        font: inherit; font-weight: 600;
        color: var(--ink);
        background: var(--white);
        border: 1px solid var(--line-2);
        border-radius: var(--radius-pill);
        padding: 4px var(--s-3);
        cursor: pointer;
        transition: border-color var(--dur) var(--ease), background var(--dur) var(--ease);
      }
      .cn button:hover:not(:disabled) { border-color: var(--forest); background: var(--sage); }
      .cn button:disabled { opacity: .55; cursor: default; }
      .cn__bad { color: var(--risk-high); }
      .cn__ask { color: var(--ink); font-weight: 600; }
      /* Touch targets: this one spends money, so it is not a 21px tap area. */
      @media (pointer: coarse) {
        .cn button { padding-block: max(var(--s-2), 9px); }
      }
    `}</style>
  );
}
