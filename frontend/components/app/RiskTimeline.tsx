import type { AppCopy } from "@/lib/i18n-app";
import type { RiskDay } from "@/lib/senior-detail";

/**
 * How the risk built up, day by day.
 *
 * WHY THIS EARNS ITS SPACE. A score says a senior is concerning today. It
 * does not say when it started, what changed, or whether it has been building
 * for a week — and those are the three things a coordinator asks before
 * picking up the phone. The ranked list answers "who". This answers "why
 * now", which is the harder half.
 *
 * ONLY THE DAYS WHERE SOMETHING ARRIVED ARE LABELLED. Every day gets a bar,
 * because the shape of the fortnight is itself information, but a reason that
 * simply continued is a state, not an event. Printing it again each day turns
 * a story into a changelog nobody reads. The day a reason FIRST appears is
 * the day worth looking at, and that is the one that gets a sentence.
 *
 * Server-rendered, pure CSS, no script.
 */
export function RiskTimeline({
  days,
  t,
  lang,
}: {
  days: RiskDay[];
  t: AppCopy["senior"];
  lang: string;
}) {
  if (days.length < 3) return null;

  const fmt = new Intl.DateTimeFormat(lang === "hi" ? "hi-IN" : "en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  const label = (iso: string) => fmt.format(new Date(`${iso}T00:00:00Z`));

  const events = days.filter((d) => d.isNew && d.topReason);

  return (
    <section className="card sd__card rt">
      <h2 className="sd__h2">{t.timeline}</h2>
      <p className="sd__note rt__lede">{t.timelineNote}</p>

      {/* The shape of the fortnight. Height is the score, so a rise is
          visible before a single word is read. */}
      <ol className="rt__bars" aria-hidden="true">
        {days.map((d) => (
          <li key={d.date}>
            <span
              className={`rt__bar rt__bar--${d.level}${d.alerted ? " rt__bar--alerted" : ""}`}
              // Pixels, not a percentage. A percentage height inside an
              // auto-sized grid track has nothing to resolve against and
              // collapsed every bar to a hairline.
              style={{ height: `${Math.max(4, Math.round(d.score * 58))}px` }}
            />
            <span className="rt__tick">{d.date.slice(8)}</span>
          </li>
        ))}
      </ol>

      <ol className="rt__events">
        {events.map((d) => (
          <li key={d.date} className={d.alerted ? "rt__ev rt__ev--alerted" : "rt__ev"}>
            <span className="rt__day">{label(d.date)}</span>
            <span className="rt__what">
              {d.topReason}
              {d.alerted && <em className="rt__flag">{t.timelineAlerted}</em>}
            </span>
          </li>
        ))}
        {!events.length && <li className="sd__note">{t.timelineQuiet}</li>}
      </ol>

      <style>{`
        .rt__lede { margin-top: 0; margin-bottom: var(--s-4); }

        .rt__bars {
          list-style: none; margin: 0 0 var(--s-5); padding: 0;
          display: grid; grid-auto-flow: column; grid-auto-columns: 1fr;
          gap: 3px; align-items: end; height: 72px;
        }
        .rt__bars li { display: flex; flex-direction: column; justify-content: flex-end;
                       gap: 3px; height: 100%; }
        .rt__bar {
          display: block; width: 100%; border-radius: 2px 2px 0 0;
          background: var(--line-2); flex: none;
        }
        .rt__bar--low  { background: #cfd8cd; }
        .rt__bar--med  { background: var(--risk-med); opacity: .75; }
        .rt__bar--high { background: var(--risk-high); opacity: .85; }
        /* The day it actually reached a coordinator gets an outline, so the
           gap between "we knew" and "we told someone" is visible. */
        .rt__bar--alerted { outline: 2px solid var(--forest); outline-offset: 1px; }
        .rt__tick { font-size: 0.5625rem; color: var(--ink-3); text-align: center; }

        .rt__events { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-3); }
        .rt__ev {
          display: grid; grid-template-columns: 4.5rem minmax(0, 1fr); gap: var(--s-3);
          font-size: var(--fs-sm); line-height: 1.55;
          padding-left: var(--s-3); border-left: 2px solid var(--line-2);
        }
        .rt__ev--alerted { border-left-color: var(--forest); }
        .rt__day { color: var(--ink-3); font-size: var(--fs-xs); padding-top: 1px; }
        .rt__what { color: var(--ink-2); }
        .rt__flag {
          display: inline-block; margin-left: var(--s-2);
          font-style: normal; font-size: 0.625rem; font-weight: 700;
          letter-spacing: .06em; text-transform: uppercase; color: var(--forest);
        }
        @media (max-width: 34rem) {
          .rt__ev { grid-template-columns: minmax(0, 1fr); gap: 2px; }
        }
      `}</style>
    </section>
  );
}
