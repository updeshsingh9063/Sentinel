import { AmbientVideo } from "@/components/ui/AmbientVideo";
import { IconArrow, IconCheck, Logo } from "@/components/ui/Icons";
import { Reveal } from "@/components/motion/Reveal";
import type { Copy } from "@/lib/i18n";
import { getCopy } from "@/lib/i18n-server";
import { hasVideo } from "@/lib/images";

/**
 * The coordinator's worklist, built as real markup rather than a screenshot.
 *
 * A flat image would blur on a retina screen and go stale the moment the
 * product moves. This is the actual interface in HTML, so it stays sharp, it
 * reads to a screen reader, and it is the thing we will reuse when the real
 * worklist page is built.
 *
 * Every reason here is observational and every action ends at a person. No row
 * names a condition — the brief forbids it, and a marketing page is exactly
 * where that slips.
 */

/**
 * Initials, risk level and time stay out of the dictionary: initials are
 * derived from the Latin spelling and are the same badge in both languages,
 * the level drives a CSS class, and the times are numerals.
 */
const ROW_META = [
  { initials: "SD", level: "high" as const, time: "9:20 AM" },
  { initials: "RC", level: "med" as const, time: "11:15 AM" },
  { initials: "KB", level: "low" as const, time: "2:30 PM" },
];

function rows(t: Copy) {
  return t.dash.rows.map((r, i) => ({ ...ROW_META[i], ...r }));
}

/**
 * The interface in markup. Used when there is no walkthrough clip, and kept
 * because it is sharp at any zoom and is the thing the real worklist page will
 * be built from.
 */
function WindowMock({ t }: { t: Copy }) {
  return (
    <div className="dash__window">
            <aside className="dash__side" aria-hidden="true">
              <span className="dash__brand">
                <Logo size={16} />
                Samarth Sentinel
              </span>
              <nav className="dash__nav">
                {t.dash.sidebar.map((item, i) => (
                  <span key={item} className={i === 0 ? "on" : undefined}>
                    <i />
                    {item}
                  </span>
                ))}
              </nav>
              <span className="dash__user">
                <i className="dash__avatar">PS</i>
                <span>
                  {t.dash.userName}
                  <small>{t.dash.userRole}</small>
                </span>
              </span>
            </aside>

            <div className="dash__main">
              <header className="dash__head">
                <h3>{t.dash.listHead}</h3>
                <span className="dash__date">{t.dash.date}</span>
              </header>

              <ol className="dash__rows">
                {rows(t).map((r) => (
                  <li key={r.name}>
                    <span className="dash__who">
                      <i className="dash__avatar" aria-hidden="true">
                        {r.initials}
                      </i>
                      <span>
                        <b>{r.name}</b>
                        <small>{r.meta}</small>
                      </span>
                    </span>
                    <span className={`pill pill--${r.level}`}>{r.levelLabel}</span>
                    <span className="dash__time">{r.time}</span>
                    <p className="dash__line">
                      <b>{t.dash.reason}</b> {r.reason}
                    </p>
                    <p className="dash__line">
                      <b>{t.dash.action}</b> {r.action}
                    </p>
                  </li>
                ))}
              </ol>
            </div>

            <aside className="dash__why">
              <h3>{t.dash.whyTitle}</h3>
              <svg viewBox="0 0 64 56" className="dash__leaf" aria-hidden="true">
                <path
                  d="M32 50c0-18 9-28 24-31 0 18-9 28-24 31Z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
                <path
                  d="M32 50c0-13-6-20-17-22 0 13 6 20 17 22Z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
                <path d="M32 50V34" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <p>{t.dash.whyBody}</p>
              <span className="dash__approach">
                {t.dash.approach} <IconArrow size={14} />
              </span>
            </aside>
    </div>
  );
}

/**
 * The walkthrough clip, framed exactly like the mock it replaces.
 *
 * A video carries nothing to a screen reader, so the list it shows is written
 * out beneath it as visually-hidden text. Swapping markup for a clip would
 * otherwise delete every name, reason and action from the accessibility tree —
 * and accessibility is scored separately in the brief.
 */
function DemoFrame({ t }: { t: Copy }) {
  return (
    <div className="dash__frame">
      {/* The mock sits underneath as the poster. A clip has no first frame
          until it decodes, so without this the section is an empty cream
          rectangle on a slow connection — and if the video never loads at
          all, what shows is the real interface rather than a hole. */}
      <div className="dash__under" aria-hidden="true">
        <WindowMock t={t} />
      </div>

      <AmbientVideo src="/video/dashboard.mp4" className="dash__demo" />

      <div className="visually-hidden">
        <h3>{t.dash.videoHead}</h3>
        <p>{t.dash.videoBody}</p>
        <ol>
          {rows(t).map((r) => (
            <li key={r.name}>
              {r.name}, {r.meta}. {r.levelLabel}, {r.time}. {t.dash.reason}{" "}
              {r.reason}. {t.dash.action} {r.action}.
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

export async function Dashboard() {
  const { t } = await getCopy();
  const demo = hasVideo("dashboard");

  return (
    <section id="how" className="section dash">
      <div className="wrap dash__grid">
        <Reveal className="dash__figure">
          {demo ? <DemoFrame t={t} /> : <WindowMock t={t} />}
        </Reveal>

        <Reveal delay={0.08} className="dash__copy">
          <span className="eyebrow">{t.dash.eyebrow}</span>
          <h2 className="display display--h2 dash__title">
            {t.dash.titleA}
            <br />
            {t.dash.titleB}
          </h2>
          <p className="lede dash__lede">{t.dash.lede}</p>
          <ul className="dash__points">
            {t.dash.points.map((p) => (
              <li key={p}>
                <IconCheck size={18} />
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </Reveal>
      </div>

      <style>{`
        .dash { background: var(--cream); }
        .dash__grid {
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          gap: var(--s-12);
          align-items: center;
        }
        @media (min-width: 64rem) {
          .dash__grid { grid-template-columns: 1.3fr 0.7fr; gap: var(--s-12); }
        }

        /* ---- the window ----
           The sidebar and the "why" panel are kept narrow on purpose: the
           middle column is the product, and at the first attempt it was left
           with 260px, which wrapped every name onto three lines. */
        .dash__window {
          display: grid;
          grid-template-columns: 8.5rem minmax(0, 1fr);
          background: var(--white);
          border: 1px solid var(--line);
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow-float);
          overflow: hidden;
          font-size: 0.8125rem;
          transition: transform 400ms var(--ease), box-shadow 400ms var(--ease);
        }
        .dash__window:hover {
          transform: translateY(-4px);
          box-shadow: 0 32px 72px rgba(21, 56, 47, 0.2),
                      0 6px 16px rgba(21, 56, 47, 0.1);
        }
        .dash__nav span { transition: background var(--dur) var(--ease); }
        .dash__nav span:not(.on):hover { background: rgba(244, 239, 227, 0.08); }
        .dash__approach {
          transition: border-color var(--dur) var(--ease), transform var(--dur) var(--ease);
        }
        .dash__approach:hover { border-color: var(--forest); transform: translateY(-1px); }
        .dash__approach svg { transition: transform var(--dur) var(--ease); }
        .dash__approach:hover svg { transform: translateX(2px); }
        @media (min-width: 52rem) {
          .dash__window { grid-template-columns: 8.5rem minmax(0, 1fr) 10rem; }
        }

        /* The clip sits in the same frame the mock does, so the section looks
           identical whether or not a walkthrough exists. 16:9 matches the
           window's own proportions, so nothing is cropped. */
        .dash__frame {
          position: relative;
          aspect-ratio: 16 / 9;
          background: var(--cream-2);
          border: 1px solid var(--line);
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow-float);
          overflow: hidden;
          transition: transform 400ms var(--ease), box-shadow 400ms var(--ease);
        }
        .dash__frame:hover {
          transform: translateY(-4px);
          box-shadow: 0 32px 72px rgba(21, 56, 47, 0.2),
                      0 6px 16px rgba(21, 56, 47, 0.1);
        }
        .dash__demo { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 1; }
        .dash__under { position: absolute; inset: 0; }
        /* Flattened: the frame already carries the border, radius and shadow. */
        .dash__under .dash__window {
          height: 100%;
          border: 0;
          border-radius: 0;
          box-shadow: none;
        }
        .dash__under .dash__window:hover { transform: none; box-shadow: none; }

        .dash__side {
          background: var(--forest);
          color: var(--on-dark-2);
          padding: var(--s-4) var(--s-3);
          display: flex;
          flex-direction: column;
          gap: var(--s-5);
        }
        .dash__brand {
          display: inline-flex; align-items: center; gap: 5px;
          color: var(--on-dark); font-family: var(--display); font-size: 0.72rem;
          white-space: nowrap;
        }
        .dash__nav { display: grid; gap: 2px; }
        .dash__nav span {
          display: flex; align-items: center; gap: 8px;
          padding: 6px 8px; border-radius: var(--radius-sm);
          font-size: 0.75rem;
        }
        .dash__nav span.on { background: var(--forest-2); color: var(--on-dark); }
        .dash__nav i {
          width: 11px; height: 11px; border-radius: 3px;
          border: 1.2px solid currentColor; opacity: 0.75; flex: none;
        }
        .dash__user {
          margin-top: auto; display: flex; align-items: center; gap: 8px;
          padding-top: var(--s-4); border-top: 1px solid var(--forest-3);
          color: var(--on-dark); font-size: 0.65rem; line-height: 1.3;
        }
        .dash__user small { display: block; color: var(--on-dark-3); font-size: 0.6rem; }

        .dash__avatar {
          width: 26px; height: 26px; border-radius: 50%;
          background: var(--sage); color: var(--forest);
          display: grid; place-items: center;
          font-size: 0.625rem; font-weight: 700; font-style: normal;
          flex: none;
        }

        .dash__main { padding: var(--s-5); min-width: 0; }
        .dash__head {
          display: flex; align-items: baseline; justify-content: space-between;
          gap: var(--s-4); margin-bottom: var(--s-4);
        }
        .dash__head h3 { font-size: 0.9rem; }
        .dash__date { color: var(--ink-3); font-size: 0.7rem; }

        .dash__rows { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-3); }
        .dash__rows li {
          display: grid;
          grid-template-columns: minmax(0, auto) auto minmax(0, 1fr);
          gap: 3px var(--s-2);
          align-items: center;
          padding-bottom: var(--s-3);
          border-bottom: 1px solid var(--line);
        }
        .dash__rows li:last-child { border-bottom: 0; padding-bottom: 0; }
        .dash__who { display: flex; align-items: center; gap: var(--s-2); min-width: 0; }
        .dash__who b {
          font-weight: 600; font-size: 0.78rem; display: block;
          white-space: nowrap;
        }
        .dash__who small { color: var(--ink-3); font-size: 0.65rem; white-space: nowrap; }
        .dash__time { color: var(--ink-3); font-size: 0.65rem; text-align: right; }
        .dash__line {
          grid-column: 1 / -1;
          font-size: 0.65rem; line-height: 1.45; color: var(--ink-2);
        }
        .dash__line b { color: var(--ink); font-weight: 600; }

        /* On a phone the window keeps only the list. The sidebar and the time
           column were squeezing the main column to about 200px, which stacked
           the pill on top of the name and broke "9:20 AM" one letter per line. */
        @media (max-width: 40rem) {
          .dash__window { grid-template-columns: minmax(0, 1fr); }
          .dash__side { display: none; }
          .dash__rows li { grid-template-columns: minmax(0, 1fr) auto; }
          .dash__time { display: none; }
        }

        .dash__why {
          display: none;
          padding: var(--s-5) var(--s-4);
          background: var(--cream-2);
          border-left: 1px solid var(--line);
          text-align: center;
        }
        @media (min-width: 52rem) { .dash__why { display: block; } }
        .dash__why h3 { font-size: 0.8rem; text-align: left; margin-bottom: var(--s-4); }
        .dash__leaf { width: 54px; height: 48px; margin: 0 auto var(--s-3); color: var(--forest-3); }
        .dash__why p { font-size: 0.6875rem; line-height: 1.5; color: var(--ink-2); }
        .dash__approach {
          display: inline-flex; align-items: center; gap: 5px;
          margin-top: var(--s-5); padding: 6px var(--s-3);
          border: 1px solid var(--line-2); border-radius: var(--radius-pill);
          font-size: 0.625rem; font-weight: 600; background: var(--white);
          white-space: nowrap;
        }

        /* ---- the copy ---- */
        .dash__title { margin-block: var(--s-4) var(--s-5); }
        .dash__lede { margin-bottom: var(--s-8); max-width: 30rem; }
        .dash__points { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-4); }
        .dash__points li {
          display: grid; grid-template-columns: auto minmax(0, 1fr);
          gap: var(--s-3); align-items: start;
          font-size: var(--fs-sm); color: var(--ink-2);
        }
        .dash__points svg { color: var(--forest-3); margin-top: 1px; }
      `}</style>
    </section>
  );
}
