import Link from "next/link";

import { PrintButton } from "@/components/app/report/PrintButton";
import { fmt } from "@/lib/i18n";
import { getAppCopy } from "@/lib/i18n-server";
import { loadFamilyReport } from "@/lib/report";

/**
 * The family's weekly summary, as a downloadable sheet.
 *
 * THIS IS A DIFFERENT DOCUMENT, NOT THE COORDINATOR'S WITH COLUMNS HIDDEN.
 * It is built by a different loader reading different tables, because the
 * family role has no policy on vitals, call_notes, note_cues or risk_scores
 * at all — see backend/supabase/migrations/0002_rls.sql. Writing it as one
 * component with a `role` flag would have put the entire privacy model behind
 * a conditional that someone could get wrong in a hurry. Here, getting it
 * wrong returns nothing instead of leaking.
 *
 * So there is no blood pressure, no sugar, no oxygen, no weight, no risk
 * score and no call transcript on this page. What a family gets is the
 * published prose summary, which has already been through the never-diagnose
 * gate, plus how often their parent answered the phone.
 */

export async function generateMetadata() {
  const { t } = await getAppCopy();
  return { title: `${t.report.familyHeading} · Samarth Sentinel` };
}

export default async function FamilyReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { lang, t } = await getAppCopy();
  const r = t.report;

  const report = await loadFamilyReport(id, lang);

  if (report.state === "no-link") {
    return (
      <main className="page page--narrow">
        <h1 className="page__title">{r.notFoundTitle}</h1>
        <p className="page__sub">{r.notFoundBody}</p>
      </main>
    );
  }

  return (
    <main className="rep rep--family">
      <div className="rep__bar">
        <Link href="/summary" className="rep__back">
          &larr; {r.backToSummary}
        </Link>
        {report.state === "ok" && <PrintButton label={r.download} />}
      </div>

      <article className="rep__sheet">
        <header className="rep__head">
          <div>
            <h1 className="rep__name">{report.senior.name}</h1>
            <p className="rep__meta">{r.familySub}</p>
          </div>
          {report.state === "ok" && (
            <div className="rep__headright">
              <p className="rep__week">{fmt(r.weekOf, { week: report.week.label })}</p>
            </div>
          )}
        </header>

        <div className="rep__title">
          <h2 className="display rep__h2">{r.familyHeading}</h2>
        </div>

        {report.state === "no-summary" ? (
          <p className="rep__empty">{r.familyNoSummary}</p>
        ) : (
          <>
            <p className="famrep__headline">{report.headline}</p>
            {report.body.map((p) => (
              <p key={p.slice(0, 24)} className="famrep__para">
                {p}
              </p>
            ))}

            {report.reach && (
              <section className="famrep__reach">
                <span className="rep__tilelabel">{r.reach}</span>
                <span className="rep__tilevalue">
                  {report.reach.answered}
                  <small>/{report.reach.of}</small>
                </span>
                <p className="rep__tilenote">{r.reachNote}</p>
              </section>
            )}
          </>
        )}

        <section className="rep__limits">
          <h3>{r.familyWhatYouSee}</h3>
          <p>{r.familyWhatYouSeeBody}</p>
        </section>

        <footer className="rep__foot">
          <span>{r.footer}</span>
        </footer>
      </article>

      <style>{`
        .rep { max-width: 48rem; margin-inline: auto; padding: var(--s-8) var(--gutter) var(--s-16); }
        .rep__bar { display: flex; align-items: center; justify-content: space-between; gap: var(--s-4); margin-bottom: var(--s-6); }
        .rep__back { font-size: var(--fs-sm); color: var(--ink-2); text-decoration: none; }
        .rep__back:hover { color: var(--forest); }
        .rep__sheet { background: var(--white); border: 1px solid var(--line); border-radius: var(--radius-lg); padding: clamp(var(--s-6), 3vw, var(--s-10)); }
        .rep__head { display: flex; flex-wrap: wrap; gap: var(--s-4); justify-content: space-between; align-items: flex-start; padding-bottom: var(--s-5); border-bottom: 1px solid var(--line); }
        .rep__name { font-family: var(--display); font-weight: 400; font-size: clamp(1.6rem, 1.3rem + 1vw, 2.1rem); line-height: 1.1; margin: 0; }
        .rep__meta { font-size: var(--fs-sm); color: var(--ink-2); margin-top: var(--s-2); }
        .rep__headright { text-align: right; }
        .rep__week { font-size: var(--fs-sm); font-weight: 600; }
        .rep__title { margin-block: var(--s-6) var(--s-5); }
        .rep__h2 { font-size: clamp(1.3rem, 1.1rem + 0.8vw, 1.7rem); }
        .rep__empty { font-size: var(--fs-sm); color: var(--ink-3); }
        .rep__tilelabel { font-size: var(--fs-xs); font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-3); }
        .rep__tilevalue { font-family: var(--display); font-size: 2.1rem; line-height: 1; display: block; margin-top: var(--s-1); }
        .rep__tilevalue small { font-size: 0.95rem; color: var(--ink-3); }
        .rep__tilenote { font-size: 0.6875rem; line-height: 1.5; color: var(--ink-3); margin-top: var(--s-2); }

        /* Bigger than the product's body text. The reader is as likely to be
           a senior's spouse as their adult child. */
        .famrep__headline { font-size: 1.15rem; line-height: 1.7; margin-bottom: var(--s-4); }
        .famrep__para { font-size: 1.0625rem; line-height: 1.75; color: var(--ink-2); margin-bottom: var(--s-4); }
        .famrep__reach { background: var(--cream); border: 1px solid var(--line); border-radius: var(--radius); padding: var(--s-4); margin-top: var(--s-5); }

        .rep__limits { margin-top: var(--s-6); padding: var(--s-5); border: 1px dashed var(--line-2); border-radius: var(--radius); }
        .rep__limits h3 { font-size: var(--fs-sm); margin-bottom: var(--s-2); }
        .rep__limits p { font-size: var(--fs-xs); line-height: 1.7; color: var(--ink-2); }
        .rep__foot { margin-top: var(--s-6); padding-top: var(--s-4); border-top: 1px solid var(--line); font-size: var(--fs-xs); color: var(--ink-3); }

        @media print {
          @page { margin: 16mm; }
          .rep { max-width: none; padding: 0; }
          .rep__bar { display: none; }
          .rep__sheet { border: 0; border-radius: 0; padding: 0; }
          .rep__limits, .famrep__reach { break-inside: avoid; background: #fff; }
        }
      `}</style>
    </main>
  );
}
