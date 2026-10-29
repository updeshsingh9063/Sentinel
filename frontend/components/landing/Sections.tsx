import Image from "next/image";
import Link from "next/link";

import { Reveal } from "@/components/motion/Reveal";
import {
  IconArrow,
  IconBell,
  IconBrain,
  IconHeart,
  IconLock,
  IconMic,
  Logo,
} from "@/components/ui/Icons";
import { AmbientVideo } from "@/components/ui/AmbientVideo";
import { getCopy } from "@/lib/i18n-server";
import { SLOTS, hasImage, hasVideo, slotSrc } from "@/lib/images";

/* ---- features ----------------------------------------------------------- */

const FEATURE_ICONS = [IconHeart, IconBrain, IconBell, IconLock, IconMic];

export async function Features() {
  const { t } = await getCopy();
  const items = t.features.items.map((f, i) => ({ ...f, icon: FEATURE_ICONS[i] }));

  return (
    <section id="features" className="section feat">
      <div className="wrap">
        <Reveal className="feat__head">
          <div>
            <span className="eyebrow">{t.features.eyebrow}</span>
            <h2 className="display display--h2 feat__title">{t.features.title}</h2>
          </div>
          <Link href="#impact" className="feat__link">
            {t.features.link} <IconArrow size={15} />
          </Link>
        </Reveal>

        <ul className="feat__grid">
          {items.map(({ icon: Icon, title, lead, body, lead2, body2 }, i) => (
            <Reveal as="li" key={title} delay={0.05 * i} className="card feat__card">
              <Icon size={26} />
              <h3>{title}</h3>
              <p>
                {lead && <span className="feat__em">{lead}</span>}
                {body}
                {lead2 && <span className="feat__em">{lead2}</span>}
                {body2}
              </p>
            </Reveal>
          ))}
        </ul>
      </div>

      <style>{`
        .feat { background: var(--sage); }
        .feat__head {
          display: flex; align-items: flex-end; justify-content: space-between;
          gap: var(--s-6); flex-wrap: wrap; margin-bottom: var(--s-10);
        }
        .feat__title { margin-top: var(--s-3); }
        .feat__link {
          display: inline-flex; align-items: center; gap: var(--s-2);
          font-size: var(--fs-sm); font-weight: 600; color: var(--forest);
          text-decoration: none; padding-bottom: 4px;
        }
        .feat__link svg { transition: transform var(--dur) var(--ease); }
        .feat__link:hover { text-decoration: underline; }
        .feat__link:hover svg { transform: translateX(3px); }
        .feat__card svg { transition: color var(--dur) var(--ease); }
        .feat__card:hover svg { color: var(--forest); }
        /* Five across on a desktop, as in the reference. auto-fit would drop
           the fifth card onto a row of its own at this container width. */
        .feat__grid {
          list-style: none; margin: 0; padding: 0;
          display: grid; gap: var(--s-4);
          grid-template-columns: repeat(5, minmax(0, 1fr));
        }
        .feat__card { padding: var(--s-5); }
        .feat__card h3 { font-size: 0.9375rem; line-height: 1.35; }
        .feat__card p { font-size: var(--fs-xs); }
        @media (max-width: 72rem) { .feat__grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
        @media (max-width: 48rem) { .feat__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
        @media (max-width: 30rem) { .feat__grid { grid-template-columns: minmax(0, 1fr); } }
        .feat__card { display: grid; gap: var(--s-3); align-content: start; }
        .feat__card svg { color: var(--forest-3); }
        .feat__card p { font-size: var(--fs-sm); line-height: 1.6; color: var(--ink-2); }
        .feat__em { color: var(--gold); }
      `}</style>
    </section>
  );
}

/* ---- impact ------------------------------------------------------------- */

export async function Impact() {
  const { t } = await getCopy();
  const meta = SLOTS.impact;
  const filled = hasImage("impact");

  return (
    <section id="impact" className="impact on-forest">
      <div className="impact__media" aria-hidden={filled ? undefined : "true"}>
        {filled && (
          <Image
            src={slotSrc("impact")}
            alt={meta.alt}
            fill
            sizes="(max-width: 64rem) 100vw, 50vw"
            style={{ objectFit: "cover", objectPosition: meta.objectPosition }}
          />
        )}
      </div>
      <span className="impact__scrim" aria-hidden="true" />
      <span className="impact__glow" aria-hidden="true" />
      <span className="grain" aria-hidden="true" />
      <Logo size={300} className="impact__mark" />

      <div className="wrap impact__inner">
        <Reveal className="impact__intro">
          <span className="eyebrow">{t.impact.eyebrow}</span>
          <h2 className="display display--h2 impact__title">
            {t.impact.titleA}
            <br />
            {t.impact.titleB}
          </h2>
        </Reveal>

        <dl className="impact__stats">
          {t.impact.stats.map((s, i) => (
            <Reveal key={s.value} delay={0.05 * i} className="impact__stat">
              <dt>{s.value}</dt>
              <dd>
                {s.body}
                <small>{s.source}</small>
              </dd>
            </Reveal>
          ))}
        </dl>
      </div>

      <style>{`
        .impact {
          position: relative; isolation: isolate;
          padding-block: clamp(var(--s-16), 7vw, var(--s-24));
          background: var(--forest);
          overflow: hidden;
        }
        /* THIS BAND IS NUMBERS, AND NUMBERS WANT A CLEAN GROUND.

           The slot is still live — drop a file at public/img/impact.jpg and it
           appears — but the treatment now assumes the photograph will end up
           UNDER four columns of statistics, because the layout puts them
           there and no crop changes that. The previous scrim thinned to 0.45
           at the right edge, which put a man's face directly behind a figure
           and its citation. So the floor is 0.82 now: a photograph here is
           atmosphere at the outer edge, never a picture competing for the
           same space as type. Judge it with the stats on, not on its own. */
        .impact__media {
          position: absolute; inset: 0 0 0 auto; width: 55%; z-index: -2;
          animation: slowDrift 34s var(--ease) infinite alternate;
          -webkit-mask-image: linear-gradient(90deg, transparent 0%, #000 45%);
          mask-image: linear-gradient(90deg, transparent 0%, #000 45%);
        }
        .impact__scrim {
          position: absolute; inset: 0; z-index: -1;
          background: linear-gradient(90deg,
            var(--forest) 0%, var(--forest) 34%,
            rgba(21, 56, 47, 0.96) 50%,
            rgba(21, 56, 47, 0.90) 68%,
            rgba(21, 56, 47, 0.82) 100%);
        }

        /* With no photograph in the slot the band would be a flat rectangle,
           and flat is what a statistic looks worst on. Two very wide radial
           lifts give it a light source without giving it a subject. */
        .impact__glow {
          position: absolute; inset: 0; z-index: -1; pointer-events: none;
          background:
            radial-gradient(110% 85% at 86% 6%, rgba(58, 114, 98, 0.55) 0%, rgba(21, 56, 47, 0) 62%),
            radial-gradient(85% 70% at 4% 104%, rgba(44, 95, 82, 0.45) 0%, rgba(21, 56, 47, 0) 58%);
        }
        .impact__mark {
          position: absolute; right: -4.5rem; bottom: -5rem; z-index: -1;
          color: var(--on-dark); opacity: 0.045; pointer-events: none;
        }
        .impact__inner {
          display: grid; gap: var(--s-10);
          grid-template-columns: minmax(0, 1fr);
        }
        @media (min-width: 62rem) {
          .impact__inner { grid-template-columns: 0.8fr 1.2fr; gap: var(--s-12); align-items: start; }
        }
        .impact__title { margin-top: var(--s-3); }

        /* Four abreast, as in the reference. auto-fit broke 3 + 1 here. */
        .impact__stats {
          margin: 0; display: grid; gap: var(--s-5);
          grid-template-columns: repeat(4, minmax(0, 1fr));
        }
        @media (max-width: 62rem) { .impact__stats { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
        @media (max-width: 30rem) { .impact__stats { grid-template-columns: minmax(0, 1fr); } }
        .impact__stat {
          padding-left: var(--s-5);
          border-left: 1px solid rgba(244, 239, 227, 0.22);
        }
        .impact__stat dt {
          font-family: var(--display);
          font-size: clamp(1.5rem, 1.2rem + 1.1vw, 2rem);
          color: var(--on-dark);
          margin-bottom: var(--s-3);
          white-space: nowrap;
        }
        .impact__stat dd {
          margin: 0; font-size: var(--fs-xs); line-height: 1.55;
          color: var(--on-dark-2);
        }
        .impact__stat small {
          display: block; margin-top: var(--s-3);
          font-size: 0.6875rem; color: var(--on-dark-3);
        }
        @media (max-width: 48rem) {
          .impact__media { width: 100%; opacity: 0.35; }
          .impact__scrim {
            background: linear-gradient(180deg,
              rgba(21,56,47,0.96) 0%, rgba(21,56,47,0.9) 60%, rgba(21,56,47,0.96) 100%);
          }
        }
      `}</style>
    </section>
  );
}

/* ---- closing ------------------------------------------------------------ */

export async function Closing() {
  const { t } = await getCopy();
  const meta = SLOTS.closing;
  const filled = hasImage("closing");
  const video = hasVideo("closing");

  return (
    <section id="about" className="close">
      {/* Video if there is one, the still otherwise. The still doubles as the
          video's poster, so the first paint is a photograph either way. */}
      <div className="close__media" aria-hidden={filled || video ? undefined : "true"}>
        {video ? (
          <AmbientVideo
            src="/video/closing.mp4"
            poster={filled ? slotSrc("closing") : undefined}
            objectPosition={meta.objectPosition}
            className="close__video"
          />
        ) : (
          filled && (
            <Image
              src={slotSrc("closing")}
              alt={meta.alt}
              fill
              sizes="(max-width: 64rem) 100vw, 50vw"
              style={{ objectFit: "cover", objectPosition: meta.objectPosition }}
            />
          )
        )}
      </div>
      <span className="close__fade" aria-hidden="true" />

      <Logo size={260} className="close__mark" />

      <div className="wrap close__inner">
        <Reveal className="close__copy">
          <span className="eyebrow">{t.closing.eyebrow}</span>
          <h2 className="display display--h2 close__title">
            {t.closing.titleA}
            <br />
            {t.closing.titleB}
          </h2>
          <p className="lede close__sub">{t.closing.sub}</p>
          <div className="close__actions">
            <Link href="/signin" className="btn btn--forest">
              {t.closing.cta} <IconArrow size={16} />
            </Link>
            <Link href="#features" className="btn btn--outline">
              {t.closing.learn}
            </Link>
          </div>
        </Reveal>
      </div>

      <style>{`
        .close {
          position: relative; isolation: isolate; overflow: hidden;
          background: var(--cream-2);
          padding-block: clamp(var(--s-16), 7vw, var(--s-24));
        }
        /* The photograph dissolves, rather than being veiled.

           A cream sheet laid over the whole band at partial opacity was what
           made this read as a faded mistake: every pixel lost contrast, so the
           picture looked washed out rather than blended. Masking the MEDIA
           instead means the right-hand side stays a full-strength photograph
           and only its inner edge goes, which is the difference between a
           deliberate blend and a flat image.

           One mask layer only. Intersecting two needs mask-composite, whose
           keyword differs between the standard property and the -webkit- one,
           and a mask that fails open leaves a hard-edged rectangle across the
           band. The vertical feather is done in the overlay below instead,
           where failing means a slightly harder edge and nothing worse. */
        .close__media {
          position: absolute; inset: 0 0 0 auto; width: 54%; z-index: -2;
          -webkit-mask-image:
            linear-gradient(90deg, transparent 0%, rgba(0,0,0,0.35) 22%, rgba(0,0,0,0.85) 48%, #000 70%);
          mask-image:
            linear-gradient(90deg, transparent 0%, rgba(0,0,0,0.35) 22%, rgba(0,0,0,0.85) 48%, #000 70%);
        }
        .close__video { width: 100%; height: 100%; display: block; }
        /* What is left of the old cream sheet: enough to settle the seam where
           the mask hands over to the page colour, plus a feather top and
           bottom so the frame does not butt into the bands either side. */
        .close__fade {
          position: absolute; inset: 0; z-index: -1;
          background:
            linear-gradient(180deg,
              var(--cream-2) 0%, rgba(246, 241, 228, 0) 12%,
              rgba(246, 241, 228, 0) 88%, var(--cream-2) 100%),
            linear-gradient(90deg,
              var(--cream-2) 0%, var(--cream-2) 38%,
              rgba(246, 241, 228, 0.5) 52%,
              rgba(246, 241, 228, 0) 72%);
        }
        .close__mark {
          position: absolute; left: -4rem; bottom: -3rem; z-index: -1;
          color: var(--forest); opacity: 0.05; pointer-events: none;
        }
        .close__inner { position: relative; }
        .close__copy { max-width: 34rem; }
        .close__title { margin-block: var(--s-4) var(--s-4); }
        .close__sub { margin-bottom: var(--s-8); }
        .close__actions { display: flex; flex-wrap: wrap; gap: var(--s-3); }
        @media (max-width: 48rem) {
          .close__media { width: 100%; opacity: 0.25; }
          .close__fade {
            background: linear-gradient(180deg,
              rgba(246,241,228,0.94) 0%, rgba(246,241,228,0.88) 100%);
          }
        }
      `}</style>
    </section>
  );
}

/* ---- footer ------------------------------------------------------------- */

const FOOT_HREFS = ["/", "#how", "#features", "#impact", "#about"];

export async function SiteFooter() {
  const { t } = await getCopy();

  return (
    <footer className="foot on-forest">
      <div className="wrap foot__inner">
        <Link href="/" className="foot__brand">
          <Logo size={24} />
          <span>Samarth Sentinel</span>
        </Link>

        <nav className="foot__links" aria-label={t.footer.nav}>
          {t.footer.links.map((l, i) => (
            <Link key={l} href={FOOT_HREFS[i]}>
              {l}
            </Link>
          ))}
        </nav>

        <span className="foot__tag">
          {t.footer.tag}
          <IconMic size={18} />
        </span>
      </div>

      <div className="wrap foot__legal">
        <p>{t.footer.legal}</p>
      </div>

      <style>{`
        .foot { background: var(--forest); padding-block: var(--s-8) var(--s-6); }
        .foot__inner {
          display: flex; align-items: center; justify-content: space-between;
          gap: var(--s-6); flex-wrap: wrap;
        }
        .foot__brand {
          display: inline-flex; align-items: center; gap: var(--s-3);
          color: var(--on-dark); text-decoration: none;
          font-family: var(--display); font-size: 1.15rem;
        }
        .foot__links { display: flex; gap: var(--s-6); flex-wrap: wrap; }
        .foot__links a {
          color: var(--on-dark-2); text-decoration: none; font-size: var(--fs-sm);
        }
        .foot__links a:hover { color: var(--on-dark); }
        .foot__tag {
          display: inline-flex; align-items: center; gap: var(--s-3);
          color: var(--on-dark-3); font-size: var(--fs-sm);
        }
        .foot__legal {
          margin-top: var(--s-8); padding-top: var(--s-5);
          border-top: 1px solid var(--forest-3);
        }
        .foot__legal p {
          color: var(--on-dark-3); font-size: 0.6875rem; line-height: 1.6;
          max-width: 60rem;
        }
      `}</style>
    </footer>
  );
}
