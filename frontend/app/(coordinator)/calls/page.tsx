import Link from "next/link";

import { CallBoard } from "@/components/app/CallBoard";
import { fmt } from "@/lib/i18n";
import { getAppCopy } from "@/lib/i18n-server";
import { loadCallDay, loadDeviations } from "@/lib/calls";

/**
 * The line today: what the system decided to do, before anybody asked it to.
 *
 * This is the page that answers the question the whole product is judged on —
 * "if you took the website away, how does this help an older person?" The
 * answer is on this screen: it rang them, and here is why it rang them.
 *
 * TWO HALVES, AND THE SECOND IS THE EVIDENCE FOR THE FIRST. Above, the calls
 * it planned, each carrying the sentence that caused it. Below, the numbers
 * those sentences were built from — how far each senior is from their own
 * normal. A coordinator who can see only the conclusion has to take it on
 * trust, and this product's whole posture is that they should not have to.
 */

export async function generateMetadata() {
  const { t } = await getAppCopy();
  return { title: `${t.calls.title} · Samarth Sentinel` };
}

export default async function CallsPage() {
  const { t } = await getAppCopy();
  const [plan, deviations] = await Promise.all([loadCallDay(), loadDeviations()]);

  return (
    <main className="page">
      <header className="page__head">
        <span className="eyebrow">{plan.day}</span>
        <h1 className="display page__title">{t.calls.title}</h1>
        <p className="page__sub">{t.calls.sub}</p>
      </header>

      <CallBoard plan={plan} t={t.calls} canPlan={plan.total === 0} />

      {deviations.length > 0 && (
        <section className="dev">
          <h2 className="dev__h2">{t.calls.evidenceTitle}</h2>
          <p className="dev__note">{t.calls.evidenceNote}</p>
          <ul className="dev__list">
            {deviations.map((d) => (
              <li key={d.seniorId} className="card dev__row">
                <Link href={`/senior/${d.seniorId}`} className="dev__name">
                  {d.name}
                </Link>
                <span className="dev__bar" aria-hidden="true">
                  <i style={{ width: `${Math.min(d.pct ?? 0, 100)}%` }} data-low={(d.pct ?? 100) < 50 || undefined} />
                </span>
                <span className="dev__pct">
                  {d.pct === null ? "—" : fmt(t.calls.pctOfUsual, { pct: d.pct })}
                </span>
                <small>
                  {fmt(t.calls.stepsLine, {
                    today: d.stepsToday ?? 0,
                    usual: d.usualSteps ?? 0,
                  })}
                  {d.missedWeek > 0 ? ` · ${fmt(t.calls.missedLine, { n: d.missedWeek })}` : ""}
                  {d.medsConfirmed === false ? ` · ${t.calls.medsNot}` : ""}
                </small>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="page__foot">{t.calls.foot}</p>

      <style>{`
        .dev { margin-top: var(--s-8); }
        .dev__h2 { font-family: var(--display); font-size: 1.35rem; margin: 0 0 var(--s-1); }
        .dev__note { margin: 0 0 var(--s-4); font-size: var(--fs-sm); color: var(--ink-2); max-width: 62ch; line-height: 1.6; }
        .dev__list { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-3); }
        .dev__row {
          padding: var(--s-4) var(--s-5);
          display: grid; gap: var(--s-2) var(--s-4);
          grid-template-columns: minmax(8rem, 12rem) minmax(0, 1fr) auto;
          align-items: center;
        }
        .dev__name { font-weight: 600; color: var(--ink); text-decoration: none; }
        .dev__name:hover { text-decoration: underline; text-underline-offset: 3px; }
        .dev__bar { height: 8px; background: var(--cream-2); border-radius: var(--radius-pill); overflow: hidden; }
        .dev__bar i { display: block; height: 100%; background: var(--sage); border-radius: var(--radius-pill); }
        .dev__bar i[data-low] { background: var(--risk-high); }
        .dev__pct { font-variant-numeric: tabular-nums; font-size: var(--fs-sm); color: var(--ink-2); }
        .dev__row small { grid-column: 1 / -1; font-size: var(--fs-xs); color: var(--ink-3); }
        .page__foot { margin-top: var(--s-6); font-size: var(--fs-xs); color: var(--ink-3); max-width: 62ch; line-height: 1.6; }
        @media (max-width: 40rem) {
          .dev__row { grid-template-columns: minmax(0, 1fr) auto; }
          .dev__bar { grid-column: 1 / -1; }
        }
      `}</style>
    </main>
  );
}
