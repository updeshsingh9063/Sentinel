import Image from "next/image";
import Link from "next/link";

import {
  IconArrow,
  IconCoins,
  IconLanguage,
  IconMic,
  IconPlay,
  IconShield,
} from "@/components/ui/Icons";
import { getCopy } from "@/lib/i18n-server";
import { SLOTS, hasImage, slotSrc } from "@/lib/images";

/**
 * Hero: photograph on the right, copy on the left over a dark gradient.
 *
 * The gradient runs left-to-right rather than bottom-up, because the subjects
 * sit in the right half of the frame and the copy must never cross them. If a
 * replacement photograph puts the subject on the left, flip `objectPosition`
 * in lib/images.ts rather than moving the text.
 *
 * THE SCRIM IS TUNED TO THE PHOTOGRAPH, not chosen once. The current frame is
 * a sunlit room whose left third is a bright window, so the copy side needs
 * MORE cover than a dark photograph would, and the right side needs much less
 * — the faces are the reason the picture is there, and a scrim heavy enough
 * to hold type over a window will bury them. Swap the photograph and these
 * stops have to be looked at again.
 *
 * There is no entrance animation on the photograph. The hero is the first
 * thing anyone sees, including a screenshot or a crawler, so it is simply
 * there.
 */

const PROMISE_ICONS = [IconLanguage, IconMic, IconShield, IconCoins];

export async function Hero() {
  const { t } = await getCopy();
  const meta = SLOTS.hero;
  const filled = hasImage("hero");
  const promises = t.hero.promises.map((label, i) => ({
    icon: PROMISE_ICONS[i],
    label,
  }));

  return (
    <section className="hero on-forest">
      <div className="hero__media" aria-hidden={filled ? undefined : "true"}>
        {filled && (
          <Image
            src={slotSrc("hero")}
            alt={meta.alt}
            fill
            priority
            sizes="100vw"
            style={{ objectFit: "cover", objectPosition: meta.objectPosition }}
          />
        )}
      </div>
      <span className="hero__scrim" aria-hidden="true" />
      <span className="hero__veil" aria-hidden="true" />
      <span className="grain" aria-hidden="true" />

      <div className="wrap hero__inner">
        <div className="hero__copy">
          <span className="eyebrow hero__eyebrow">{t.hero.eyebrow}</span>

          <h1 className="display display--hero hero__title">Samarth Sentinel</h1>

          <p className="display display--sub hero__sub">
            {t.hero.subA}
            <br />
            {t.hero.subB}
          </p>

          <p className="hero__body">{t.hero.body}</p>

          <ul className="hero__promises">
            {promises.map(({ icon: Icon, label }) => (
              <li key={label}>
                <Icon size={22} />
                <span>{label}</span>
              </li>
            ))}
          </ul>

          <div className="hero__actions">
            <Link href="#how" className="btn btn--cream">
              {t.hero.seeHow} <IconArrow size={16} />
            </Link>
            <Link href="#how" className="btn btn--ghost">
              <IconPlay size={16} /> {t.hero.watch}
            </Link>
          </div>
        </div>
      </div>

      {/* Left in English on purpose, in both languages. It is a decorative
          brand flourish, already aria-hidden, and Caveat is loaded with the
          latin subset only — set in Devanagari it would fall back to a system
          face and stop looking handwritten, which is the whole point of it. */}
      <p className="script hero__script" aria-hidden="true" lang="en">
        Better care.
        <br />
        Brighter tomorrows.
        <svg viewBox="0 0 220 12" className="hero__swash" aria-hidden="true">
          <path
            d="M2 8C40 3 120 2 218 6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </p>

      <style>{`
        .hero {
          position: relative;
          isolation: isolate;
          min-height: min(92svh, 54rem);
          display: flex;
          align-items: center;
          padding-block: calc(var(--nav-h) + var(--s-10)) var(--s-16);
          background: var(--forest);
          overflow: hidden;
        }
        .hero__media {
          position: absolute; inset: 0; z-index: -2;
          animation: slowDrift 28s var(--ease) infinite alternate;
        }
        .hero__media img { width: 100%; height: 100%; }

        /* Staged entrance. Each child of the copy column rises in turn, in the
           order you would read them. Pure CSS, so it runs without script and
           always completes — nothing here can be left half-played. */
        .hero__copy > * { animation: riseIn 760ms var(--ease) both; }
        .hero__copy > *:nth-child(1) { animation-delay: 60ms; }
        .hero__copy > *:nth-child(2) { animation-delay: 140ms; }
        .hero__copy > *:nth-child(3) { animation-delay: 220ms; }
        .hero__copy > *:nth-child(4) { animation-delay: 300ms; }
        .hero__copy > *:nth-child(5) { animation-delay: 380ms; }
        .hero__copy > *:nth-child(6) { animation-delay: 460ms; }
        /* Two layers rather than one, because they answer to different things.
           The horizontal scrim is a function of how wide the copy column is,
           and has to be re-cut at every breakpoint. The vertical veil holds
           the nav at the top and hands over to the next section at the
           bottom, and that is true at every width. Keeping them separate is
           what lets the media queries below rewrite one and leave the other
           alone. */
        .hero__scrim {
          position: absolute; inset: 0; z-index: -1;
          /* heavy over the window the copy sits on, off the faces */
          background: linear-gradient(90deg,
            rgba(10, 26, 21, 0.95) 0%,
            rgba(10, 26, 21, 0.90) 30%,
            rgba(10, 26, 21, 0.64) 45%,
            rgba(10, 26, 21, 0.30) 60%,
            rgba(10, 26, 21, 0.14) 76%,
            rgba(10, 26, 21, 0.10) 100%);
        }
        .hero__veil {
          position: absolute; inset: 0; z-index: -1;
          background: linear-gradient(180deg,
            rgba(10, 26, 21, 0.58) 0%,
            rgba(10, 26, 21, 0) 26%,
            rgba(10, 26, 21, 0) 88%,
            rgba(251, 247, 238, 0.28) 96.5%,
            var(--cream) 100%);
        }

        .hero__inner { width: 100%; }
        .hero__copy { max-width: 38rem; }
        .hero__eyebrow { color: var(--on-dark-3); margin-bottom: var(--s-5); }
        .hero__title { margin-bottom: var(--s-4); }
        .hero__sub { color: var(--on-dark); margin-bottom: var(--s-5); }
        .hero__body {
          color: var(--on-dark-2);
          font-size: var(--fs-lede);
          max-width: 34rem;
          margin-bottom: var(--s-8);
        }

        .hero__promises {
          list-style: none; margin: 0 0 var(--s-8); padding: 0;
          display: flex; flex-wrap: wrap; gap: 0;
        }
        .hero__promises li {
          display: grid; gap: var(--s-2); justify-items: start;
          padding-inline: var(--s-5);
          border-left: 1px solid rgba(244, 239, 227, 0.22);
          color: var(--on-dark);
          font-size: var(--fs-xs);
          line-height: 1.35;
          white-space: pre-line;
          min-width: 7.5rem;
        }
        .hero__promises li:first-child { padding-left: 0; border-left: 0; }

        .hero__actions { display: flex; flex-wrap: wrap; gap: var(--s-3); }

        .hero__script {
          position: absolute;
          right: clamp(1.25rem, 5vw, 5rem);
          bottom: clamp(1.5rem, 5vw, 3.5rem);
          color: var(--on-dark);
          font-size: clamp(1.25rem, 0.9rem + 1vw, 1.75rem);
          text-align: right;
          transform: rotate(-4deg);
          z-index: 1;
          /* It sits on the lit side of the photograph, where the scrim has
             almost let go. The shadow is what keeps it legible there. */
          text-shadow: 0 1px 14px rgba(10, 26, 21, 0.75), 0 1px 3px rgba(10, 26, 21, 0.5);
          animation: fadeIn 1s var(--ease) 620ms both;
        }
        .hero__swash { width: 11rem; height: 12px; margin-left: auto; margin-top: 4px; }
        /* The swash draws itself, once, after the words have landed. */
        .hero__swash path {
          stroke-dasharray: 230;
          stroke-dashoffset: 230;
          animation: swash 900ms var(--ease) 1s both;
        }
        @keyframes swash { to { stroke-dashoffset: 0; } }

        /* Tablet. The copy column is nearly the full width here, so the
           desktop cut — which lets go at 60% to keep the faces lit — leaves
           the last line of the paragraph sitting on a cardigan. The scrim
           holds further across and only opens at the outer edge. */
        @media (max-width: 68rem) {
          .hero__script { display: none; }
          .hero__copy { max-width: 33rem; }
          .hero__scrim {
            background: linear-gradient(90deg,
              rgba(10, 26, 21, 0.95) 0%,
              rgba(10, 26, 21, 0.92) 48%,
              rgba(10, 26, 21, 0.76) 66%,
              rgba(10, 26, 21, 0.42) 84%,
              rgba(10, 26, 21, 0.28) 100%);
          }
        }
        @media (max-width: 48rem) {
          /* No room to put copy beside the photograph at all, so the gradient
             turns vertical: the room stays visible at the top and the type
             sits on near-solid forest underneath it. */
          .hero__scrim {
            background:
              linear-gradient(180deg,
                rgba(10, 26, 21, 0.40) 0%,
                rgba(10, 26, 21, 0.62) 22%,
                rgba(10, 26, 21, 0.90) 46%,
                rgba(10, 26, 21, 0.96) 100%);
          }
          .hero { min-height: 0; padding-block: calc(var(--nav-h) + var(--s-8)) var(--s-12); }
          .hero__promises li { min-width: 50%; padding-inline: 0; border-left: 0; margin-bottom: var(--s-5); }
        }
      `}</style>
    </section>
  );
}
