"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import Link from "next/link";

import { createClient } from "@/lib/supabase/client";
import { fmt } from "@/lib/i18n";
import type { AppCopy } from "@/lib/i18n-app";
import type { CallDay, PlannedCall } from "@/lib/calls";

/**
 * The day's calls, and what happened on them.
 *
 * MARKING AN OUTCOME IS NOT BOOKKEEPING. "No answer" twice on a welfare call
 * is what turns a phone call into somebody going round, so this control is
 * the trigger for the only escalation in the product that a human did not
 * decide. It is therefore a real write, not a local toggle — the last control
 * in here that held its answer in React state and posted nowhere spent weeks
 * telling people it had recorded a verdict it had not.
 */
export function CallBoard({
  plan,
  t,
  canPlan,
}: {
  plan: CallDay;
  t: AppCopy["calls"];
  /** False when the day is already planned, so the button cannot stack calls. */
  canPlan: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [escalated, setEscalated] = useState<number | null>(null);

  async function planDay() {
    setFailed(false);
    const { error } = await createClient().rpc("plan_calls", {});
    if (error) return setFailed(true);
    startTransition(() => router.refresh());
  }

  async function mark(call: PlannedCall, outcome: "reached" | "no_answer") {
    setBusy(call.id);
    setFailed(false);
    const supabase = createClient();
    const { error } = await supabase
      .from("call_plan")
      .update({
        outcome,
        attempts: outcome === "no_answer" ? call.attempts + 1 : call.attempts,
        last_attempt: new Date().toISOString(),
      })
      .eq("id", call.id);

    if (error) {
      setBusy(null);
      setFailed(true);
      return;
    }

    // Two unanswered welfare calls stop being a call. This raises the errand
    // in the database rather than in the page, so it is there whether or not
    // anybody is looking at this screen.
    if (outcome === "no_answer" && call.reason === "welfare" && call.attempts + 1 >= 2) {
      const { data } = await supabase.rpc("escalate_unanswered", {});
      const out = data as { raised?: number } | null;
      if (out?.raised) setEscalated(call.id);
    }

    setBusy(null);
    startTransition(() => router.refresh());
  }

  const kinds: { key: keyof CallDay["tally"]; label: string }[] = [
    { key: "daily", label: t.kinds.daily },
    { key: "welfare", label: t.kinds.welfare },
    { key: "medicine", label: t.kinds.medicine },
    { key: "company", label: t.kinds.company },
    { key: "follow_up", label: t.kinds.follow_up },
  ];

  return (
    <div className="cb">
      {plan.total === 0 ? (
        <section className="card cb__empty">
          <p>{t.nonePlanned}</p>
          <button type="button" className="btn btn--forest" onClick={() => void planDay()} disabled={pending}>
            {pending ? t.planning : t.planIt}
          </button>
          {failed && <p className="cb__failed">{t.failed}</p>}
        </section>
      ) : (
        <>
          <ul className="cb__tally">
            {kinds.map((k) => (
              <li key={k.key} className="card">
                <span className="cb__n">{plan.tally[k.key]}</span>
                <span className="cb__k">{k.label}</span>
              </li>
            ))}
          </ul>

          {/* The routine ones are counted above and deliberately not listed.
              Forty-five rows that all say "their usual call" is a wall, and
              the ones that say something else are why anybody opened this. */}
          <h2 className="cb__h2">{t.notableTitle}</h2>
          <p className="cb__sub">{t.notableNote}</p>

          {plan.notable.length === 0 ? (
            <p className="cb__none">{t.nothingNotable}</p>
          ) : (
            <ul className="cb__list">
              {plan.notable.map((c) => (
                <li key={c.id} className={`card cb__row cb__row--${c.reason}`}>
                  <div className="cb__top">
                    <span className="cb__time">{c.dueAt}</span>
                    <i className="cb__avatar" aria-hidden="true">
                      {c.initials}
                    </i>
                    <span className="cb__who">
                      <Link href={`/senior/${c.seniorId}`} className="cb__name">
                        {c.name}
                      </Link>
                      <small>{t.kinds[c.reason]}</small>
                    </span>
                    {c.outcome !== "planned" && (
                      <span className={c.outcome === "reached" ? "pill pill--low" : "pill pill--high"}>
                        {c.outcome === "reached" ? t.reached : fmt(t.noAnswerN, { n: c.attempts })}
                      </span>
                    )}
                  </div>

                  <p className="cb__why">{c.why}</p>

                  {escalated === c.id && <p className="cb__escalated">{t.escalated}</p>}

                  {c.outcome !== "reached" && (
                    <div className="cb__acts">
                      <button
                        type="button"
                        className="cb__btn cb__btn--go"
                        onClick={() => void mark(c, "reached")}
                        disabled={busy === c.id}
                      >
                        {t.markReached}
                      </button>
                      <button
                        type="button"
                        className="cb__btn"
                        onClick={() => void mark(c, "no_answer")}
                        disabled={busy === c.id}
                      >
                        {t.markNoAnswer}
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {plan.moreNotable > 0 && (
            <p className="cb__more">{fmt(t.moreNotable, { n: plan.moreNotable })}</p>
          )}
          {failed && <p className="cb__failed">{t.failed}</p>}
        </>
      )}

      <style>{`
        .cb { display: grid; gap: var(--s-5); }
        .cb__empty { padding: var(--s-8); display: grid; gap: var(--s-4); justify-items: start; }
        .cb__empty p { margin: 0; font-size: var(--fs-sm); color: var(--ink-2); max-width: 54ch; line-height: 1.6; }

        .cb__tally {
          list-style: none; margin: 0; padding: 0;
          display: grid; gap: var(--s-3);
          grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
        }
        .cb__tally li { padding: var(--s-4) var(--s-5); display: grid; gap: 2px; }
        .cb__n { font-family: var(--display); font-size: 1.75rem; line-height: 1; }
        .cb__k {
          font-size: var(--fs-xs); color: var(--ink-3);
          letter-spacing: .05em; text-transform: uppercase;
        }

        .cb__h2 { font-family: var(--display); font-size: 1.35rem; margin: var(--s-4) 0 var(--s-1); }
        .cb__sub { margin: 0 0 var(--s-2); font-size: var(--fs-sm); color: var(--ink-2); max-width: 62ch; line-height: 1.6; }
        .cb__none { font-size: var(--fs-sm); color: var(--ink-3); }

        .cb__list { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-4); }
        .cb__row { padding: var(--s-5); border-left: 3px solid var(--line-2); display: grid; gap: var(--s-3); }
        .cb__row--welfare   { border-left-color: var(--risk-high); }
        .cb__row--medicine  { border-left-color: var(--risk-med); }
        .cb__row--follow_up { border-left-color: var(--forest); }
        .cb__row--company   { border-left-color: var(--sage); }

        .cb__top { display: flex; align-items: center; gap: var(--s-3); }
        .cb__time {
          font-variant-numeric: tabular-nums; font-size: var(--fs-sm);
          color: var(--ink-3); min-width: 3rem;
        }
        .cb__avatar {
          width: 34px; height: 34px; border-radius: 50%; flex: none;
          background: var(--sage); color: var(--forest);
          display: grid; place-items: center;
          font-size: var(--fs-xs); font-weight: 700; font-style: normal;
        }
        .cb__who { display: grid; gap: 1px; min-width: 0; margin-right: auto; }
        .cb__name { font-weight: 600; font-size: 1.0625rem; color: var(--ink); text-decoration: none; }
        .cb__name:hover { text-decoration: underline; text-underline-offset: 3px; }
        .cb__who small { color: var(--ink-3); font-size: var(--fs-xs); }
        .cb__why { margin: 0; font-size: var(--fs-sm); line-height: 1.6; color: var(--ink-2); }
        .cb__escalated {
          margin: 0; font-size: var(--fs-xs); font-weight: 600; color: var(--risk-high);
        }
        .cb__failed { margin: 0; font-size: var(--fs-xs); color: var(--risk-high); }
        .cb__more { margin: 0; font-size: var(--fs-xs); color: var(--ink-3); line-height: 1.6; max-width: 62ch; }

        .cb__acts { display: flex; gap: var(--s-3); flex-wrap: wrap; }
        .cb__btn {
          font: inherit; font-size: var(--fs-xs); font-weight: 600;
          min-height: 2.5rem; padding-inline: var(--s-4);
          border: 1px solid var(--line-2); border-radius: var(--radius-pill);
          background: var(--white); color: var(--ink-2); cursor: pointer;
        }
        .cb__btn--go { border-color: var(--forest); color: var(--forest); }
        .cb__btn:disabled { opacity: .55; cursor: default; }

        @media (max-width: 40rem) {
          .cb__top { flex-wrap: wrap; row-gap: var(--s-2); }
        }
      `}</style>
    </div>
  );
}
