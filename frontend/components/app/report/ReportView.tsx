import Link from "next/link";

import { AdherenceRing, HealthTrend, MoodWeek, VitalsChart } from "@/components/app/report/Charts";
import { PrintButton } from "@/components/app/report/PrintButton";
import { fmt } from "@/lib/i18n";
import type { AppCopy } from "@/lib/i18n-app";
import type { WeeklyReport } from "@/lib/report";

/**
 * The coordinator's weekly report for one senior.
 *
 * Read it top to bottom and it answers, in order: how was the week, what did
 * they say, what was measured, what did they take, what came up, and what are
 * you being asked to do. That ordering is the point — the recommended action
 * is last because it only means anything after the evidence for it.
 *
 * NOTHING HERE IS A DIAGNOSIS AND NOTHING IS INFERRED. Every panel renders a
 * stored value or an aggregate of stored values. The "what this does not
 * contain" block at the foot is not boilerplate: it is there because a report
 * that looks this much like a medical document will be read as one unless it
 * says plainly what it is.
 */

function Delta({ delta, t }: { delta: number | null; t: AppCopy["report"] }) {
  if (delta === null) return <span className="rep__delta">{t.deltaNone}</span>;
  if (delta === 0) return <span className="rep__delta">{t.deltaFlat}</span>;
  const up = delta > 0;
  return (
    <span className={up ? "rep__delta rep__delta--up" : "rep__delta rep__delta--down"}>
      {up ? "↑" : "↓"}{" "}
      {fmt(up ? t.deltaUp : t.deltaDown, { n: String(Math.abs(delta)) })}
    </span>
  );
}

export function ReportView({
  report,
  t,
  lang,
}: {
  report: WeeklyReport;
  t: AppCopy;
  lang: string;
}) {
  const r = t.report;
  const { senior, week } = report;

  const moodCounts = report.mood.filter((m) => m.answered);
  const worst = moodCounts.length
    ? Math.max(...moodCounts.map((m) => m.feeling ?? 0))
    : 0;
  const moodWord = r.moodLabels[String(worst)] ?? r.moodLabels["0"];

  const dateFmt = new Intl.DateTimeFormat(lang === "hi" ? "hi-IN" : "en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  const day = (iso: string) => dateFmt.format(new Date(`${iso}T00:00:00Z`));

  return (
    <main className="rep">
      {/* Screen-only bar. Dropped from the printed document, where a "back"
          link and a download button are meaningless. */}
      <div className="rep__bar">
        <Link href={`/senior/${senior.id}`} className="rep__back">
          &larr; {r.backToSenior}
        </Link>
        <PrintButton label={r.download} />
      </div>

      <article className="rep__sheet">
        <header className="rep__head">
          <div>
            <h1 className="rep__name">{senior.name}</h1>
            <p className="rep__meta">
              {fmt(r.meta, {
                age: senior.age === null ? "—" : String(senior.age),
                sex: senior.sex ?? "—",
                city: senior.city ?? "—",
              })}
            </p>
          </div>
          <div className="rep__headright">
            <p className="rep__week">{fmt(r.weekOf, { week: week.label })}</p>
            <p className="rep__gen">{fmt(r.generated, { date: day(week.end) })}</p>
          </div>
        </header>

        <div className="rep__title">
          <h2 className="display rep__h2">{r.heading}</h2>
          <p className="rep__sub">{r.sub}</p>
        </div>

        {/* ---- four figures ------------------------------------------- */}
        <section className="rep__tiles" aria-label={r.heading}>
          <div className="rep__tile">
            <span className="rep__tilelabel">{r.healthScore}</span>
            <span className="rep__tilevalue">
              {report.health.score}
              <small>/100</small>
            </span>
            <HealthTrend series={report.health.series} />
            <Delta delta={report.health.delta} t={r} />
            <p className="rep__tilenote">{r.healthScoreNote}</p>
          </div>

          <div className="rep__tile">
            <span className="rep__tilelabel">{r.mood}</span>
            <span className="rep__tileword">{moodWord}</span>
            <MoodWeek days={report.mood} labels={r.moodLabels} />
            <p className="rep__tilenote">{r.moodNote}</p>
          </div>

          <div className="rep__tile">
            <span className="rep__tilelabel">{r.reach}</span>
            <span className="rep__tilevalue">
              {report.reach.answered}
              <small>/{report.reach.of}</small>
            </span>
            <p className="rep__tilenote">{r.reachNote}</p>
          </div>

          <div className="rep__tile">
            <span className="rep__tilelabel">{r.adherence}</span>
            <AdherenceRing taken={report.adherence.taken} due={report.adherence.due} />
            <span className="rep__tilesmall">
              {fmt(r.dosesOf, {
                taken: String(report.adherence.taken),
                due: String(report.adherence.due),
              })}
            </span>
          </div>
        </section>

        {/* ---- vitals + medicines -------------------------------------- */}
        <div className="rep__cols">
          <section className="rep__panel">
            <h3>{r.vitals}</h3>
            <p className="rep__panelnote">{r.vitalsNote}</p>
            <VitalsChart points={report.vitals.series} emptyLabel={r.vitalsEmpty} />
            {report.vitals.latest && (
              <dl className="rep__latest">
                <div>
                  <dt>BP</dt>
                  <dd>
                    {report.vitals.latest.systolic === null
                      ? r.noReading
                      : `${Math.round(report.vitals.latest.systolic)}/${Math.round(
                          report.vitals.latest.diastolic ?? 0,
                        )}`}
                  </dd>
                </div>
                <div>
                  <dt>SpO&#8322;</dt>
                  <dd>
                    {report.vitals.latest.spo2 === null
                      ? r.noReading
                      : `${report.vitals.latest.spo2.toFixed(1)}%`}
                  </dd>
                </div>
                <div>
                  <dt>Pulse</dt>
                  <dd>
                    {report.vitals.latest.pulse === null
                      ? r.noReading
                      : Math.round(report.vitals.latest.pulse)}
                  </dd>
                </div>
                <div>
                  <dt>Weight</dt>
                  <dd>
                    {report.vitals.latest.weight === null
                      ? r.noReading
                      : `${report.vitals.latest.weight.toFixed(1)} kg`}
                  </dd>
                </div>
              </dl>
            )}
          </section>

          <section className="rep__panel">
            <h3>{r.byDrug}</h3>
            <p className="rep__panelnote">{r.adherenceNote}</p>
            <ul className="rep__drugs">
              {report.adherence.byDrug.map((d) => (
                <li key={d.drug} className={d.alwaysMissed ? "rep__drug rep__drug--bad" : "rep__drug"}>
                  <span className="rep__drugname">{d.drug}</span>
                  <span className="rep__drugbar" aria-hidden="true">
                    <span style={{ width: `${d.due ? (d.taken / d.due) * 100 : 0}%` }} />
                  </span>
                  <span className="rep__drugcount">
                    {d.taken}/{d.due}
                  </span>
                  {/* The headline number can hide this entirely: two drugs at
                      50% overall may be one taken always and one never, and
                      only the second is a conversation. */}
                  {d.alwaysMissed && <em className="rep__drugflag">{r.alwaysMissed}</em>}
                </li>
              ))}
            </ul>
          </section>
        </div>

        {/* ---- cues + notes -------------------------------------------- */}
        <div className="rep__cols">
          <section className="rep__panel">
            <h3>{r.concerns}</h3>
            <p className="rep__panelnote">{r.concernsNote}</p>
            {report.cues.length ? (
              <ul className="rep__cues">
                {report.cues.map((c) => (
                  <li key={c.cue}>
                    <div className="rep__cuehead">
                      <strong>{r.cueLabels[c.cue] ?? c.cue}</strong>
                      <span>{fmt(r.daysMentioned, { n: String(c.days) })}</span>
                    </div>
                    {c.evidence && (
                      <blockquote className="rep__quote">
                        <span className="rep__quotelabel">{r.inTheirWords}</span>
                        {c.evidence}
                      </blockquote>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rep__empty">{r.concernsEmpty}</p>
            )}
          </section>

          <section className="rep__panel">
            <h3>{r.notes}</h3>
            <p className="rep__panelnote">{r.notesNote}</p>
            <ul className="rep__notes">
              {report.notes.map((n) => (
                <li key={`${n.date}-${n.text.slice(0, 12)}`}>
                  <span className="rep__notedate">{day(n.date)}</span>
                  {n.reached ? (
                    <q lang={n.lang === "hinglish" ? "hi" : n.lang}>{n.text}</q>
                  ) : (
                    <em>{r.notReached}</em>
                  )}
                </li>
              ))}
              {!report.notes.length && <li className="rep__empty">{r.concernsEmpty}</li>}
            </ul>
          </section>
        </div>

        {/* ---- the ask -------------------------------------------------- */}
        <section className="rep__panel rep__action">
          <h3>{r.action}</h3>
          <p className="rep__panelnote">{r.actionNote}</p>
          {report.alert ? (
            <>
              <p className="rep__reason">{report.alert.reason}</p>
              <p className="rep__next">{report.alert.nextStep}</p>
              <span className="pill pill--med rep__status">
                {r.statusLabels[report.alert.status] ?? report.alert.status} ·{" "}
                {day(report.alert.raisedOn)}
              </span>
            </>
          ) : (
            <p className="rep__empty">{r.noAlert}</p>
          )}
        </section>

        <section className="rep__limits">
          <h3>{r.notMeasuredTitle}</h3>
          <p>{r.notMeasuredBody}</p>
        </section>

        <footer className="rep__foot">
          <span>{r.footer}</span>
          <span>{r.confidential}</span>
        </footer>
      </article>

      <style>{`
        .rep { max-width: 72rem; margin-inline: auto; padding: var(--s-8) var(--gutter) var(--s-16); }
        .rep__bar { display: flex; align-items: center; justify-content: space-between; gap: var(--s-4); margin-bottom: var(--s-6); }
        .rep__back { font-size: var(--fs-sm); color: var(--ink-2); text-decoration: none; }
        .rep__back:hover { color: var(--forest); }

        .rep__sheet { background: var(--white); border: 1px solid var(--line); border-radius: var(--radius-lg); padding: clamp(var(--s-6), 3vw, var(--s-10)); }

        .rep__head { display: flex; flex-wrap: wrap; gap: var(--s-4); justify-content: space-between; align-items: flex-start; padding-bottom: var(--s-5); border-bottom: 1px solid var(--line); }
        .rep__name { font-family: var(--display); font-weight: 400; font-size: clamp(1.6rem, 1.3rem + 1vw, 2.1rem); line-height: 1.1; margin: 0; }
        .rep__meta { font-size: var(--fs-sm); color: var(--ink-2); margin-top: var(--s-2); }
        .rep__headright { text-align: right; }
        .rep__week { font-size: var(--fs-sm); font-weight: 600; }
        .rep__gen { font-size: var(--fs-xs); color: var(--ink-3); margin-top: 2px; }

        .rep__title { margin-block: var(--s-6) var(--s-5); }
        .rep__h2 { font-size: clamp(1.3rem, 1.1rem + 0.8vw, 1.7rem); }
        .rep__sub { font-size: var(--fs-sm); color: var(--ink-2); margin-top: var(--s-2); max-width: 70ch; }

        .rep__tiles { display: grid; gap: var(--s-4); grid-template-columns: repeat(4, minmax(0, 1fr)); margin-bottom: var(--s-5); }
        @media (max-width: 62rem) { .rep__tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
        @media (max-width: 34rem) { .rep__tiles { grid-template-columns: minmax(0, 1fr); } }
        .rep__tile { background: var(--cream); border: 1px solid var(--line); border-radius: var(--radius); padding: var(--s-4); display: grid; gap: var(--s-2); align-content: start; }
        .rep__tilelabel { font-size: var(--fs-xs); font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-3); }
        .rep__tilevalue { font-family: var(--display); font-size: 2.1rem; line-height: 1; }
        .rep__tilevalue small { font-size: 0.95rem; color: var(--ink-3); }
        .rep__tileword { font-family: var(--display); font-size: 1.5rem; line-height: 1.1; }
        .rep__tilesmall { font-size: var(--fs-xs); color: var(--ink-2); }
        .rep__tilenote { font-size: 0.6875rem; line-height: 1.5; color: var(--ink-3); }
        .rep__spark { width: 100%; height: 44px; }
        .rep__delta { font-size: var(--fs-xs); font-weight: 600; color: var(--ink-3); }
        .rep__delta--up { color: var(--risk-low); }
        .rep__delta--down { color: var(--risk-med); }

        .rep__mood { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px; }
        .rep__mood li { display: grid; gap: 3px; justify-items: center; }
        .rep__moodbar { display: block; width: 100%; height: 42px; background: var(--white); border: 1px solid var(--line); border-radius: 3px; position: relative; overflow: hidden; }
        .rep__moodfill { position: absolute; left: 0; right: 0; bottom: 0; display: block; }
        /* An unanswered day is a hatched blank, not a zero. Zero would be a
           reading; this is the absence of one. */
        .rep__moodfill--none { background: repeating-linear-gradient(45deg, var(--line) 0 3px, transparent 3px 6px) !important; }
        .rep__moodday { font-size: 0.625rem; color: var(--ink-3); }

        .rep__cols { display: grid; gap: var(--s-4); grid-template-columns: 1.3fr 1fr; margin-bottom: var(--s-5); }
        @media (max-width: 62rem) { .rep__cols { grid-template-columns: minmax(0, 1fr); } }
        .rep__panel { background: var(--cream); border: 1px solid var(--line); border-radius: var(--radius); padding: var(--s-5); }
        .rep__panel h3 { font-size: var(--fs-h3); margin-bottom: var(--s-1); }
        .rep__panelnote { font-size: 0.6875rem; line-height: 1.55; color: var(--ink-3); margin-bottom: var(--s-4); max-width: 60ch; }
        .rep__empty { font-size: var(--fs-sm); color: var(--ink-3); }

        .rep__chart svg { width: 100%; height: auto; }
        .rep__legend { display: flex; flex-wrap: wrap; gap: var(--s-4); margin-top: var(--s-2); font-size: var(--fs-xs); color: var(--ink-2); }
        .rep__legend span { display: inline-flex; align-items: center; gap: 5px; }
        .rep__legend i { width: 10px; height: 3px; border-radius: 2px; display: block; }

        .rep__latest { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--s-3); margin-top: var(--s-4); padding-top: var(--s-4); border-top: 1px solid var(--line); }
        .rep__latest dt { font-size: 0.625rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-3); }
        .rep__latest dd { margin: 2px 0 0; font-size: 1rem; font-weight: 600; }

        .rep__drugs { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-3); }
        .rep__drug { display: grid; grid-template-columns: 1fr auto; gap: 4px var(--s-3); align-items: center; }
        .rep__drugname { font-size: var(--fs-sm); font-weight: 600; }
        .rep__drugcount { font-size: var(--fs-xs); color: var(--ink-2); font-variant-numeric: tabular-nums; }
        .rep__drugbar { grid-column: 1 / -1; height: 6px; background: var(--line); border-radius: 3px; overflow: hidden; }
        .rep__drugbar span { display: block; height: 100%; background: var(--risk-low); }
        .rep__drug--bad .rep__drugbar span { background: var(--risk-high); }
        .rep__drugflag { grid-column: 1 / -1; font-size: var(--fs-xs); font-style: normal; font-weight: 600; color: var(--risk-high); }

        .rep__cues { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-4); }
        .rep__cuehead { display: flex; justify-content: space-between; gap: var(--s-3); font-size: var(--fs-sm); }
        .rep__cuehead span { color: var(--ink-3); font-size: var(--fs-xs); }
        .rep__quote { margin: var(--s-2) 0 0; padding: var(--s-3); background: var(--white); border-left: 2px solid var(--line-2); border-radius: 0 var(--radius-sm) var(--radius-sm) 0; font-size: var(--fs-sm); line-height: 1.6; }
        .rep__quotelabel { display: block; font-size: 0.625rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-3); margin-bottom: 3px; }

        .rep__notes { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-3); }
        .rep__notes li { display: grid; gap: 2px; font-size: var(--fs-sm); line-height: 1.6; }
        .rep__notedate { font-size: 0.625rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-3); }
        .rep__notes q { color: var(--ink-2); }

        .rep__action { border-left: 3px solid var(--forest); }
        .rep__reason { font-size: 1.05rem; line-height: 1.5; margin-bottom: var(--s-2); }
        .rep__next { font-size: var(--fs-sm); color: var(--ink-2); line-height: 1.65; margin-bottom: var(--s-3); }
        .rep__status { background: var(--cream-2); color: var(--ink-2); }

        .rep__limits { margin-top: var(--s-5); padding: var(--s-5); border: 1px dashed var(--line-2); border-radius: var(--radius); }
        .rep__limits h3 { font-size: var(--fs-sm); margin-bottom: var(--s-2); }
        .rep__limits p { font-size: var(--fs-xs); line-height: 1.7; color: var(--ink-2); max-width: 80ch; }

        .rep__foot { display: flex; flex-wrap: wrap; justify-content: space-between; gap: var(--s-3); margin-top: var(--s-6); padding-top: var(--s-4); border-top: 1px solid var(--line); font-size: var(--fs-xs); color: var(--ink-3); }

        /* ---- print ---------------------------------------------------
           The document, not the application. Chrome goes, the sheet loses
           its card styling because paper is already a card, and no panel is
           allowed to break across a page. */
        @media print {
          @page { margin: 14mm; }
          .rep { max-width: none; padding: 0; }
          .rep__bar { display: none; }
          .rep__sheet { border: 0; border-radius: 0; padding: 0; }
          .rep__panel, .rep__tile, .rep__limits { break-inside: avoid; background: #fff; }
          .rep__cols { break-inside: avoid; }
          .rep__tiles { grid-template-columns: repeat(4, 1fr); }
          .rep__cols { grid-template-columns: 1.3fr 1fr; }
          .rep__foot { position: running(footer); }
          a[href]::after { content: ""; }
        }
      `}</style>
    </main>
  );
}
