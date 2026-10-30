"use client";

import { useState } from "react";

import { IconBell, IconPhone } from "@/components/ui/Icons";
import { fmt } from "@/lib/i18n";
import type { AppCopy } from "@/lib/i18n-app";
import { createClient } from "@/lib/supabase/client";

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
  const [phase, setPhase] = useState<
    "idle" | "asking" | "number" | "saving" | "dialling" | "ringing" | "failed"
  >("idle");
  const [why, setWhy] = useState<string>("");
  const [number, setNumber] = useState<string>("");

  /**
   * Put a number on the record, then ring it.
   *
   * NOT "dial whatever is typed". That was the shortcut and it is the wrong
   * feature: a box that dials arbitrary numbers is a nuisance-call machine
   * with a login page, and every call it placed would be unattributable
   * afterwards. The number goes ON THE SENIOR, through a function that checks
   * the caseload and writes an audit row — so the next coordinator, the
   * morning round and the log all see the same number, and the rule that you
   * may only ring somebody you carry still holds.
   */
  async function saveNumber() {
    setPhase("saving");
    const { data, error } = await createClient().rpc("set_senior_phone", {
      p_senior_id: seniorId,
      p_phone: number,
    });

    const out = data as { ok?: boolean; reason?: string } | null;
    if (error || !out?.ok) {
      setWhy(
        out?.reason === "not_e164"
          ? t.badFormat
          : out?.reason === "number_in_use"
            ? t.inUse
            : out?.reason === "not_yours"
              ? t.notYours
              : t.failed,
      );
      setPhase("number");
      return;
    }
    await place();
  }

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

    // A missing number is not a failure to report and walk away from — it is
    // the one thing the person reading this can actually fix. Offer the fix
    // rather than a dead end.
    if (res.status === 404) {
      setWhy(t.noNumber);
      setPhase("number");
      return;
    }

    setWhy(
      res.status === 503
        ? t.notConfigured
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

  if (phase === "number" || phase === "saving") {
    return (
      <form
        className="cn cn--form"
        onSubmit={(e) => {
          e.preventDefault();
          void saveNumber();
        }}
      >
        <span className="cn__bad">{why}</span>
        <input
          type="tel"
          inputMode="tel"
          // autoComplete off: this is somebody else's number on a work
          // record, not the operator's own, and offering their saved
          // contacts here is how a wrong number reaches a record.
          autoComplete="off"
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          placeholder="+919876543210"
          aria-label={t.addNumber}
          disabled={phase === "saving"}
        />
        <button type="submit" className="cn__go" disabled={phase === "saving" || number.trim().length < 8}>
          <IconPhone size={14} /> {phase === "saving" ? t.saving : t.save}
        </button>
        <button type="button" onClick={() => setPhase("idle")} disabled={phase === "saving"}>
          {t.cancel}
        </button>
        <small className="cn__hint">{t.numberHint}</small>
        <Styles />
      </form>
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
      {/* SENDING A TEXT IS NOT RINGING SOMEBODY, so it does not confirm. It
          arrives silently, costs a fraction of a rupee, and an unwanted one
          is read and ignored rather than answered at an awkward moment. The
          server caps it at four a day, which is what a misread button press
          actually needs protecting against. */}
      <Remind seniorId={seniorId} t={t} />
      <Styles />
    </div>
  );
}

/**
 * Send a medicine reminder now.
 *
 * NO CONSENT SCOPE IS CONSULTED, deliberately. `auto_reminder` governs what
 * the scheduler does unprompted at eight in the morning; this is a
 * coordinator deciding to contact somebody on their own caseload, which is
 * the work, and the database records who did it by name.
 */
function Remind({ seniorId, t }: { seniorId: string; t: AppCopy["callNow"] }) {
  const [phase, setPhase] = useState<"idle" | "sending" | "done" | "failed">("idle");
  const [why, setWhy] = useState("");

  async function send() {
    setPhase("sending");
    const { data, error } = await createClient().rpc("send_reminder_now", {
      p_senior_id: seniorId,
    });
    const out = data as { ok?: boolean; reason?: string } | null;
    if (error || !out?.ok) {
      setWhy(
        out?.reason === "too_many_today"
          ? t.remindTooMany
          : out?.reason === "no_number"
            ? t.noNumber
            : out?.reason === "not_yours"
              ? t.notYours
              : t.remindFailed,
      );
      setPhase("failed");
      return;
    }
    setPhase("done");
  }

  if (phase === "done") return <span className="cn__ok">{t.reminded}</span>;

  return (
    <>
      <button type="button" onClick={() => void send()} disabled={phase === "sending"}>
        <IconBell size={14} />
        {phase === "sending" ? t.reminding : t.remind}
      </button>
      {phase === "failed" && <span className="cn__bad">{why}</span>}
    </>
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
      .cn__ok { color: var(--risk-low); font-weight: 600; }
      .cn__ask { color: var(--ink); font-weight: 600; }
      .cn--form { row-gap: var(--s-2); }
      .cn--form input {
        font: inherit; font-size: var(--fs-sm);
        color: var(--ink); background: var(--white);
        border: 1px solid var(--line-2); border-radius: var(--radius-sm);
        padding: 6px var(--s-3); min-width: 11rem; flex: 1 1 11rem;
      }
      .cn--form input:focus-visible { outline: 2px solid var(--forest); outline-offset: 1px; }
      .cn--form input:disabled { opacity: .55; }
      .cn__hint { flex-basis: 100%; color: var(--ink-3); font-size: var(--fs-xs); }
      @media (pointer: coarse) { .cn--form input { padding-block: 9px; } }
      /* Touch targets: this one spends money, so it is not a 21px tap area. */
      @media (pointer: coarse) {
        .cn button { padding-block: max(var(--s-2), 9px); }
      }
    `}</style>
  );
}
