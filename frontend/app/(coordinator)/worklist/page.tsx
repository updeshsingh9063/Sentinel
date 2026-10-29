import Link from "next/link";

import { Verdict } from "@/components/app/Verdict";
import { IconArrow } from "@/components/ui/Icons";
import { fmt } from "@/lib/i18n";
import { getAppCopy } from "@/lib/i18n-server";
import { loadWorklist } from "@/lib/worklist";

/**
 * FR-4: the urgency-sorted daily queue. The only surface that shows individual
 * health data, and the one the brief describes most directly.
 *
 * Three rules it must keep:
 *   · never longer than the daily cap — everything else is scored and left
 *   · every row carries a why and a next step, not just a score
 *   · no row names a condition; reasons describe what changed
 *
 * Rows past the cap are shown, dimmed, rather than hidden. They are the
 * evidence that the cap is doing something, and a coordinator who cannot see
 * what was left out has no reason to trust the list.
 *
 * READS THE REAL COHORT. This page rendered three hard-coded people until
 * 2026-10-29, while the model's eighteen thousand scored senior-days sat
 * unused in the database. The surfaced rows are the model's own `alerts` —
 * it applied the cap and the cooldown when it wrote them, so the budget is
 * not re-derived here — and the held rows are the rest of that day's scores.
 * See lib/worklist.ts.
 */

export async function generateMetadata() {
  const { t } = await getAppCopy();
  return { title: `${t.titles.worklist} · Samarth Sentinel` };
}

export default async function WorklistPage() {
  const { lang, t } = await getAppCopy();
  const list = await loadWorklist(t, lang);

  if (list.state === "empty") {
    return (
      <main className="page page--narrow">
        <h1 className="page__title">{t.worklist.emptyTitle}</h1>
        <p className="page__sub">{t.worklist.emptyBody}</p>
      </main>
    );
  }

  const { surfaced, held } = list;
  const cap = surfaced.length;

  return (
    <main className="page">
      <header className="page__head">
        <span className="eyebrow">{list.dayLabel}</span>
        <h1 className="display page__title">{t.worklist.title}</h1>
        <p className="page__sub">{fmt(t.worklist.sub, { cap })}</p>
      </header>

      {/* ABOVE THE RANKED LIST, AND NOT PART OF IT. These are seniors who
          picked up the phone after today's ranking was computed, so the model
          has not seen a word of it. Folding them into the ranking would break
          the alert budget that is the whole product; hiding them until
          tomorrow's run would bury the senior's own voice. So they sit here,
          and a human decides. */}
      {list.answeredToday.length > 0 && (
        <section className="card wl__came">
          <h2 className="wl__camehead">{t.worklist.cameIn}</h2>
          <ul className="wl__camelist">
            {list.answeredToday.map((c) => (
              <li key={c.seniorId}>
                <i className="wl__avatar" aria-hidden="true">{c.initials}</i>
                <span>
                  <Link href={`/senior/${c.seniorId}`} className="wl__name">{c.name}</Link>
                  <em>{c.concerns.join(" · ")}</em>
                </span>
              </li>
            ))}
          </ul>
          <p className="wl__camenote">{t.worklist.cameInNote}</p>
        </section>
      )}

      <ol className="wl">
        {surfaced.map((s, i) => (
          <li key={s.id} className={`card wl__row wl__row--${s.level}`}>
            <div className="wl__top">
              <span className="wl__rank">{String(i + 1).padStart(2, "0")}</span>
              <i className="wl__avatar" aria-hidden="true">{s.initials}</i>
              <span className="wl__who">
                <Link href={`/senior/${s.id}`} className="wl__name">
                  {s.name}
                </Link>
                <small>
                  {fmt(t.worklist.meta, {
                    age: s.age,
                    city: s.city,
                    days: s.daysSinceContact,
                    unit: s.daysSinceContact === 1 ? t.worklist.dayOne : t.worklist.dayMany,
                  })}
                </small>
              </span>
              <span className="wl__level">
                <span className={`pill pill--${s.level}`}>{s.levelLabel}</span>
                <span className="wl__score">{s.score.toFixed(2)}</span>
              </span>
            </div>

            <div className="wl__body">
              <div>
                <h2 className="wl__label">{t.worklist.why}</h2>
                <ul className="wl__reasons">
                  {s.reasons.map((r) => (
                    <li key={r.code}>
                      {r.text}
                      <em>+{r.contribution.toFixed(2)}</em>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="wl__step">
                <h2 className="wl__label">{t.worklist.nextStep}</h2>
                <p>{s.nextStep}</p>
                <div className="wl__actions">
                  <Link href={`/senior/${s.id}`} className="btn btn--forest wl__btn">
                    {t.worklist.open} <IconArrow size={15} />
                  </Link>
                  <span className="wl__due">{t.worklist.due} {s.dueAt}</span>
                </div>
                <Verdict seniorId={s.id} t={t.verdict} />
              </div>
            </div>
          </li>
        ))}
      </ol>

      <div className="wl__cap">
        <hr />
        <span>{fmt(t.worklist.cap, { cap, total: list.totalScored })}</span>
        <hr />
      </div>

      <ol className="wl wl--held" start={cap + 1}>
        {held.map((s, i) => (
          <li key={s.id} className="card wl__row wl__row--held">
            <div className="wl__top">
              <span className="wl__rank">{String(cap + i + 1).padStart(2, "0")}</span>
              <i className="wl__avatar" aria-hidden="true">{s.initials}</i>
              <span className="wl__who">
                <Link href={`/senior/${s.id}`} className="wl__name">{s.name}</Link>
                <small>
                  {fmt(t.worklist.metaShort, {
                    age: s.age,
                    city: s.city,
                    reason: s.reasons[0]?.text ?? "",
                  })}
                </small>
              </span>
              <span className="wl__level">
                <span className={`pill pill--${s.level}`}>{s.levelLabel}</span>
                <span className="wl__score">{s.score.toFixed(2)}</span>
              </span>
            </div>
          </li>
        ))}
      </ol>

      <p className="wl__foot">{t.worklist.foot}</p>

      <style>{`
        .wl { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-4); }
        .wl__row { padding: var(--s-5); border-left: 3px solid var(--line-2); }
        .wl__row--high { border-left-color: var(--risk-high); }
        .wl__row--med  { border-left-color: var(--risk-med); }
        .wl__row--low  { border-left-color: var(--risk-low); }

        .wl__top {
          display: grid;
          grid-template-columns: 2rem 34px minmax(0, 1fr) auto;
          gap: var(--s-3);
          align-items: center;
        }
        .wl__level { display: flex; align-items: center; gap: var(--s-4); }
        .wl__rank {
          font-size: var(--fs-sm); color: var(--ink-3);
          font-variant-numeric: tabular-nums;
        }
        /* Marked out from the ranked cards below rather than dressed like
           them, because it is a different kind of thing: unscored, and
           waiting on a judgement rather than carrying one. */
        .wl__came {
          padding: var(--s-5) var(--s-6); margin-bottom: var(--s-6);
          border-left: 3px solid var(--forest);
        }
        .wl__camehead {
          font-family: var(--sans); font-size: var(--fs-xs); font-weight: 600;
          letter-spacing: .07em; text-transform: uppercase; color: var(--forest);
          margin: 0 0 var(--s-4);
        }
        .wl__camelist { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-4); }
        .wl__camelist li { display: flex; align-items: center; gap: var(--s-3); }
        .wl__camelist li > span { display: grid; gap: 1px; min-width: 0; }
        .wl__camelist em {
          font-style: normal; font-size: var(--fs-sm); color: var(--risk-high);
        }
        .wl__camenote {
          margin: var(--s-4) 0 0; font-size: var(--fs-xs);
          line-height: 1.6; color: var(--ink-3);
        }

        .wl__avatar {
          width: 34px; height: 34px; border-radius: 50%;
          background: var(--sage); color: var(--forest);
          display: grid; place-items: center;
          font-size: var(--fs-xs); font-weight: 700; font-style: normal;
        }
        .wl__who { min-width: 0; }
        .wl__name {
          display: block; font-weight: 600; font-size: 1.0625rem;
          color: var(--ink); text-decoration: none;
        }
        .wl__name:hover { text-decoration: underline; text-underline-offset: 3px; }
        .wl__who small { color: var(--ink-3); font-size: var(--fs-xs); }
        .wl__score {
          font-family: var(--display); font-size: 1.5rem;
          font-variant-numeric: tabular-nums; line-height: 1;
        }
        .wl__row--high .wl__score { color: var(--risk-high); }
        .wl__row--med  .wl__score { color: var(--risk-med); }
        .wl__row--low  .wl__score { color: var(--ink-3); }

        .wl__body {
          display: grid; gap: var(--s-6);
          margin-top: var(--s-5); padding-top: var(--s-5);
          border-top: 1px solid var(--line);
        }
        @media (min-width: 56rem) {
          .wl__body { grid-template-columns: 1fr 1fr; gap: var(--s-8); }
        }
        .wl__label {
          font-size: var(--fs-xs); font-weight: 600;
          letter-spacing: 0.08em; text-transform: uppercase;
          color: var(--ink-3); margin: 0 0 var(--s-3);
        }
        .wl__reasons { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-2); }
        .wl__reasons li {
          font-size: var(--fs-sm); line-height: 1.55; color: var(--ink-2);
          padding-left: var(--s-4); position: relative;
        }
        .wl__reasons li::before {
          content: ""; position: absolute; left: 0; top: 0.62em;
          width: 6px; height: 6px; border-radius: 50%; background: var(--line-2);
        }
        .wl__reasons em {
          font-style: normal; font-size: var(--fs-xs); color: var(--ink-3);
          margin-left: var(--s-2); font-variant-numeric: tabular-nums;
        }
        .wl__step p { font-size: var(--fs-sm); line-height: 1.6; color: var(--ink-2); }
        .wl__actions {
          display: flex; align-items: center; gap: var(--s-3);
          flex-wrap: wrap; margin: var(--s-4) 0 var(--s-4);
        }
        .wl__btn { min-height: 2.5rem; font-size: var(--fs-xs); padding-inline: var(--s-4); }
        .wl__due { font-size: var(--fs-xs); color: var(--ink-3); }

        .wl__cap { display: flex; align-items: center; gap: var(--s-3); margin: var(--s-8) 0; }
        .wl__cap hr { flex: 1; border: 0; border-top: 1px dashed var(--line-2); }
        .wl__cap span {
          font-size: var(--fs-xs); font-weight: 600;
          letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-3);
          white-space: nowrap;
        }
        .wl--held { opacity: 0.62; }
        .wl__row--held { padding: var(--s-4) var(--s-5); }
        .wl__foot {
          margin-top: var(--s-5); font-size: var(--fs-xs);
          color: var(--ink-3); max-width: 56ch;
        }
        /* On a phone the rank, avatar, name, pill and score cannot share one
           line without wrapping every name. Drop the rank (the list is already
           in order) and give the pill and score a line of their own. */
        @media (max-width: 40rem) {
          .wl__top {
            grid-template-columns: 34px minmax(0, 1fr);
            row-gap: var(--s-3);
            align-items: start;
          }
          .wl__rank { display: none; }
          .wl__level { grid-column: 1 / -1; justify-content: space-between; }
          .wl__score { font-size: 1.25rem; }
        }
      `}</style>
    </main>
  );
}
