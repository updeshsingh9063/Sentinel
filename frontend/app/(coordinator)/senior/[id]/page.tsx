import Link from "next/link";
import { notFound } from "next/navigation";

import { BaselineChart } from "@/components/app/BaselineChart";
import { Verdict } from "@/components/app/Verdict";
import { COHORT } from "@/lib/demo";
import { localizedDetail, localizedSenior, outcomeLabel } from "@/lib/demo-i18n";
import { fmt } from "@/lib/i18n";
import { getAppCopy } from "@/lib/i18n-server";

/**
 * Per-senior detail.
 *
 * The chart draws the personal baseline band rather than a fixed clinical
 * threshold: the brief is explicit that deviation from a senior's own baseline
 * matters more than population averages, and the interface has to make that
 * visible rather than assert it in prose.
 *
 * The cue timeline quotes what was actually said, in the script it was said
 * in, and never translates it into a finding. A negated phrase is shown too,
 * with the note that no cue was raised — that is the cheapest way to show a
 * coordinator that the extractor understands "no pain today".
 */

export function generateStaticParams() {
  return COHORT.map((s) => ({ id: s.id }));
}

export default async function SeniorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { lang, t } = await getAppCopy();
  const senior = localizedSenior(lang, id);
  if (!senior) notFound();

  const detail = localizedDetail(lang, id);

  return (
    <main className="page">
      <nav className="sd__crumb" aria-label={t.senior.crumb}>
        <Link href="/worklist">{t.senior.crumb}</Link>
        <span aria-hidden="true">/</span>
        <span>{senior.name}</span>
      </nav>

      <header className="sd__head">
        <div>
          <h1 className="display sd__name">{senior.name}</h1>
          <p className="sd__meta">
            {fmt(t.senior.meta, {
              age: senior.age,
              city: senior.city,
              days: senior.daysSinceContact,
              unit: senior.daysSinceContact === 1 ? t.senior.dayOne : t.senior.dayMany,
            })}
          </p>
        </div>
        <div className="sd__scorebox">
          <span className={`pill pill--${senior.level}`}>{senior.levelLabel}</span>
          <span className="sd__score">{senior.score.toFixed(2)}</span>
        </div>
      </header>

      <div className="sd__grid">
        <div className="sd__main">
          {detail && (
            <section className="card sd__card">
              <BaselineChart series={detail.series} />
              <p className="sd__note">{t.senior.bandNote}</p>
            </section>
          )}

          <section className="card sd__card">
            <h2 className="sd__h2">{t.senior.why}</h2>
            <ul className="sd__reasons">
              {senior.reasons.map((r) => (
                <li key={r.code}>
                  <span>{r.text}</span>
                  <em>+{r.contribution.toFixed(2)}</em>
                </li>
              ))}
            </ul>
            <p className="sd__note">{t.senior.whyNote}</p>
          </section>

          {detail && (
            <section className="card sd__card">
              <h2 className="sd__h2">{t.senior.said}</h2>
              <ol className="sd__cues">
                {detail.cues.map((c) => (
                  <li key={c.day + c.kind}>
                    <span className="sd__day">{c.day}</span>
                    <div>
                      <span className="sd__kind">{c.kind}</span>
                      <blockquote>
                        <q>{c.quote}</q>
                        <span lang="hi" className="sd__script">{c.script}</span>
                      </blockquote>
                      <p className="sd__note">{c.note}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>

        <aside className="sd__side">
          <section className="card sd__card">
            <h2 className="sd__h2">{t.senior.nextStep}</h2>
            <p className="sd__step">{senior.nextStep}</p>
            <p className="sd__note">{t.senior.nextStepNote}</p>
            <div className="sd__verdict">
              <Verdict seniorId={senior.id} t={t.verdict} />
            </div>
          </section>

          {detail && (
            <>
              <section className="card sd__card">
                <h2 className="sd__h2">{t.senior.meds}</h2>
                <table className="sd__meds">
                  <thead>
                    <tr>
                      <th scope="col">{t.senior.medsDay}</th>
                      <th scope="col">{t.senior.medsAm}</th>
                      <th scope="col">{t.senior.medsPm}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.adherence.map((d) => (
                      <tr key={d.day}>
                        <th scope="row">{d.day}</th>
                        <td>
                          {d.morning ? <Tick label={t.senior.taken} /> : <Miss label={t.senior.missed} />}
                        </td>
                        <td>
                          {d.evening ? <Tick label={t.senior.taken} /> : <Miss label={t.senior.missed} />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="sd__note">{t.senior.medsNote}</p>
              </section>

              <section className="card sd__card">
                <h2 className="sd__h2">{t.senior.contacts}</h2>
                <ol className="sd__contacts">
                  {detail.contacts.map((c, i) => (
                    <li key={i} data-outcome={c.outcome}>
                      <span className="sd__day">{c.day}</span>
                      <span className="sd__channel">{c.channel}</span>
                      <span className="sd__outcome">{outcomeLabel(lang, c.outcome)}</span>
                      <small>{c.detail}</small>
                    </li>
                  ))}
                </ol>
                <p className="sd__note">{t.senior.contactsNote}</p>
              </section>
            </>
          )}
        </aside>
      </div>

      <style>{`
        .sd__crumb {
          display: flex; gap: var(--s-2); align-items: center;
          font-size: var(--fs-xs); color: var(--ink-3); margin-bottom: var(--s-5);
        }
        .sd__crumb a { color: var(--ink-2); }
        .sd__head {
          display: flex; align-items: flex-start; justify-content: space-between;
          gap: var(--s-6); flex-wrap: wrap; margin-bottom: var(--s-8);
          padding-bottom: var(--s-5); border-bottom: 1px solid var(--line);
        }
        .sd__name { font-size: var(--fs-h2); line-height: 1.1; }
        .sd__meta { color: var(--ink-3); font-size: var(--fs-sm); margin-top: var(--s-2); }
        .sd__scorebox { display: flex; align-items: center; gap: var(--s-4); }
        .sd__score {
          font-family: var(--display); font-size: 2.25rem; line-height: 1;
          font-variant-numeric: tabular-nums; color: var(--risk-high);
        }
        .sd__grid { display: grid; gap: var(--s-5); }
        @media (min-width: 64rem) {
          .sd__grid { grid-template-columns: 1.55fr 1fr; align-items: start; }
        }
        .sd__main, .sd__side { display: grid; gap: var(--s-5); align-content: start; }
        .sd__card { padding: var(--s-5); }
        .sd__h2 {
          font-family: var(--sans); font-size: var(--fs-sm); font-weight: 600;
          margin: 0 0 var(--s-4);
        }
        .sd__note {
          margin-top: var(--s-4); font-size: var(--fs-xs);
          line-height: 1.6; color: var(--ink-3);
        }
        .sd__reasons { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-3); }
        .sd__reasons li {
          display: flex; justify-content: space-between; gap: var(--s-4);
          font-size: var(--fs-sm); line-height: 1.5; color: var(--ink-2);
          padding-bottom: var(--s-3); border-bottom: 1px solid var(--line);
        }
        .sd__reasons li:last-child { border-bottom: 0; padding-bottom: 0; }
        .sd__reasons em {
          font-style: normal; color: var(--ink-3);
          font-variant-numeric: tabular-nums; white-space: nowrap;
        }
        .sd__cues { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-5); }
        .sd__cues li { display: grid; grid-template-columns: 3.5rem minmax(0, 1fr); gap: var(--s-3); }
        .sd__day {
          font-size: var(--fs-xs); font-weight: 600; color: var(--ink-3);
          text-transform: uppercase; letter-spacing: 0.06em;
        }
        .sd__kind { font-size: var(--fs-sm); font-weight: 600; }
        .sd__cues blockquote { margin: var(--s-2) 0 0; }
        .sd__cues q {
          font-family: var(--display); font-style: italic; font-size: 1.25rem;
          quotes: none; display: block;
        }
        .sd__script { font-family: var(--deva); font-size: var(--fs-sm); color: var(--ink-3); }
        .sd__step { font-size: var(--fs-sm); line-height: 1.65; color: var(--ink-2); }
        .sd__verdict { margin-top: var(--s-5); padding-top: var(--s-4); border-top: 1px solid var(--line); }
        .sd__meds { width: 100%; border-collapse: collapse; font-size: var(--fs-sm); }
        .sd__meds th, .sd__meds td { text-align: left; padding: var(--s-2) 0; }
        .sd__meds thead th {
          font-size: var(--fs-xs); font-weight: 600; color: var(--ink-3);
          text-transform: uppercase; letter-spacing: 0.06em;
          border-bottom: 1px solid var(--line);
        }
        .sd__meds tbody th { font-weight: 400; color: var(--ink-2); }
        .sd__meds td { width: 3.5rem; }
        .sd__contacts { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-3); }
        .sd__contacts li {
          display: grid; grid-template-columns: auto 1fr auto; gap: 2px var(--s-3);
          align-items: baseline; font-size: var(--fs-sm);
          padding-bottom: var(--s-3); border-bottom: 1px solid var(--line);
        }
        .sd__contacts li:last-child { border-bottom: 0; padding-bottom: 0; }
        .sd__contacts small { grid-column: 2 / -1; color: var(--ink-3); font-size: var(--fs-xs); }
        .sd__channel { color: var(--ink-2); }
        .sd__outcome { font-size: var(--fs-xs); color: var(--ink-3); }
        .sd__contacts li[data-outcome="no answer"] .sd__outcome { color: var(--risk-med); font-weight: 600; }
      `}</style>
    </main>
  );
}

function Tick({ label }: { label: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-label={label} role="img">
      <path d="m5 12.5 4.5 4.5L19 7" stroke="var(--risk-low)" strokeWidth="2.2"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Miss({ label }: { label: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-label={label} role="img">
      <path d="M6 6l12 12M18 6 6 18" stroke="var(--risk-med)" strokeWidth="2.2"
        strokeLinecap="round" />
    </svg>
  );
}
