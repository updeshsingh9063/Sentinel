"use client";

import { useState } from "react";

import type { AppCopy } from "@/lib/i18n-app";

/**
 * The emergency button a senior presses.
 *
 * TWO PRESSES, NOT ONE. Every other control in this product confirms because
 * a misclick costs money or rings somebody. This one confirms for the
 * opposite reason: it is the largest target on a page an eighty-year-old is
 * using, and a sleeve brushing it must not summon their daughter at two in
 * the morning. The second press is the one that fires, and the prompt says so
 * in words rather than relying on a dialog an older person may not parse.
 *
 * IT SENDS NOTHING BUT THE PRESS. No id, no name, no body at all. The server
 * knows which senior this line belongs to; a page cannot aim this at anybody.
 *
 * IT PROMISES ONLY WHAT HAPPENED. The confirmation says a coordinator has
 * been told and is calling — because by then rows exist, a message is queued
 * to their telephone, and an alert sits at the top of their list. It does not
 * say an ambulance is coming, because nothing in this system calls one, and
 * the one place a false claim could get somebody hurt is this one.
 */
export function SosButton({ t }: { t: AppCopy["checkin"] }) {
  const [phase, setPhase] = useState<"idle" | "arm" | "sending" | "done" | "again" | "failed">(
    "idle",
  );

  async function press() {
    setPhase("sending");
    try {
      const res = await fetch("/api/sos/press", { method: "POST" });
      const out = (await res.json()) as { ok?: boolean; first?: boolean };
      // No tick unless the alarm was accepted. Telling somebody in trouble
      // that help is coming when it is not is the worst failure available
      // here, and it is the cheapest one to make.
      if (!res.ok || !out.ok) {
        setPhase("failed");
        return;
      }
      setPhase(out.first ? "done" : "again");
    } catch {
      setPhase("failed");
    }
  }

  if (phase === "done" || phase === "again") {
    return (
      <p className="sos sos--done" role="status">
        <span className="sos__tick" aria-hidden="true">✓</span>
        {phase === "done" ? t.sosDone : t.sosAgain}
        <button type="button" onClick={() => setPhase("arm")}>
          {t.sosLabel}
        </button>
        <Styles />
      </p>
    );
  }

  return (
    <div className="sos">
      <button
        type="button"
        className="sos__btn"
        onClick={() => (phase === "arm" ? void press() : setPhase("arm"))}
        disabled={phase === "sending"}
        // The live region announces the state change for a screen reader; the
        // visible label changes for everyone else.
        aria-live="polite"
      >
        {phase === "sending" ? t.sosSending : phase === "arm" ? t.sosHold : t.sosLabel}
      </button>
      {phase === "failed" && <strong className="sos__bad">{t.sosFailed}</strong>}
      <small>{t.sosNote}</small>
      <Styles />
    </div>
  );
}

function Styles() {
  return (
    <style>{`
      .sos { display: flex; flex-direction: column; gap: var(--s-2); margin-top: var(--s-6); }
      .sos__btn {
        /* Deliberately the largest target on the page. The people this is for
           have stiff fingers and may be holding the phone in one hand. */
        font: inherit; font-size: var(--fs-lg); font-weight: 700;
        color: var(--white); background: var(--risk-high);
        border: 0; border-radius: var(--radius);
        padding: var(--s-5) var(--s-4); min-height: 4.5rem; width: 100%;
        cursor: pointer; line-height: 1.3;
        transition: filter var(--dur) var(--ease);
      }
      .sos__btn:hover:not(:disabled) { filter: brightness(1.08); }
      .sos__btn:disabled { opacity: .7; cursor: default; }
      .sos__btn:focus-visible { outline: 3px solid var(--ink); outline-offset: 3px; }
      .sos small { color: var(--ink-3); font-size: var(--fs-xs); }
      .sos__bad { color: var(--risk-high); font-size: var(--fs-sm); }
      .sos--done {
        display: flex; align-items: flex-start; gap: var(--s-2); flex-wrap: wrap;
        font-size: var(--fs-sm); color: var(--ink);
        background: var(--sage); border-radius: var(--radius);
        padding: var(--s-4); margin-top: var(--s-6);
      }
      .sos__tick { color: var(--risk-low); font-weight: 700; }
      .sos--done button {
        flex-basis: 100%; margin-top: var(--s-2);
        font: inherit; font-weight: 600; color: var(--risk-high);
        background: none; border: 0; padding: var(--s-2) 0; text-align: left;
        text-decoration: underline; text-underline-offset: 3px; cursor: pointer;
      }
    `}</style>
  );
}
