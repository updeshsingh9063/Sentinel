import Image from "next/image";

import { CallSim } from "@/components/app/CallSim";
import { SosButton } from "@/components/app/SosButton";
import { LangSwitch } from "@/components/landing/LangSwitch";
import { getAppCopy } from "@/lib/i18n-server";
import { SLOTS, hasImage, slotSrc } from "@/lib/images";

/**
 * The phone check-in simulator.
 *
 * Public by design: a senior has no account, because the brief forbids a
 * senior-facing app. This page exists to demonstrate the IVR loop end to end
 * in the pitch, and nothing in it assumes a screen.
 *
 * The question script itself is NOT translated by the language switch. It is
 * already bilingual — Hindi leads, romanised Hindi follows, English last —
 * because that is the order the call itself uses. The chrome around it, and
 * the question that is SPOKEN aloud, follow the site language.
 *
 * The switch is repeated on this page because there is no app bar here — the
 * senior route group has no chrome by design. Without it, a Hindi speaker who
 * arrived with an English cookie had no way to change it, on the one page
 * whose whole purpose is reaching people who do not read English.
 *
 * THE BACKGROUND IS HELD WELL BACK, AND THAT IS THE WHOLE POINT. This is the
 * one surface built for someone with poor eyesight, so the photograph is a
 * room with nobody in it and a bare wall through the middle, washed out under
 * a cream veil until it is barely more than a tint. The card stays opaque
 * white. If the picture ever competes with the type, the picture is wrong —
 * contrast on this page is not a style choice, it is the feature.
 */

export async function generateMetadata() {
  const { t } = await getAppCopy();
  return { title: `${t.titles.checkin} · Samarth Sentinel` };
}

export default async function CheckinPage() {
  const { lang, t } = await getAppCopy();
  const bg = hasImage("checkin");
  const meta = SLOTS.checkin;

  return (
    <>
      {bg && (
        <div className="ivr__bg" aria-hidden="true">
          <Image
            src={slotSrc("checkin")}
            alt=""
            fill
            priority
            sizes="100vw"
            style={{ objectFit: "cover", objectPosition: meta.objectPosition }}
          />
          <span className="ivr__wash" />
        </div>
      )}

      <div className="ivr__lang">
        <LangSwitch lang={lang} label={t.bar.language} />
      </div>
      <CallSim t={t.checkin} lang={lang} />

      {/* UNDER the check-in, not above it. Somebody in trouble will find the
          largest red button on the page without help; somebody who is fine
          should meet the conversation first. */}
      <SosButton t={t.checkin} />
      <style>{`
        /* Fixed, so the room stays still while the questions scroll over it —
           a background that slides around is movement nobody asked for, and
           vestibular trouble is common in this age group. */
        .ivr__bg { position: fixed; inset: 0; z-index: -2; }
        .ivr__bg img { width: 100%; height: 100%; }
        .ivr__wash {
          position: absolute; inset: 0;
          background:
            linear-gradient(180deg,
              rgba(251, 247, 238, 0.60) 0%,
              rgba(251, 247, 238, 0.46) 42%,
              rgba(251, 247, 238, 0.62) 100%);
        }
        @media (prefers-reduced-motion: reduce) { .ivr__bg { position: absolute; } }
        /* Anyone who has asked for more contrast gets the photograph gone,
           not merely dimmed. */
        @media (prefers-contrast: more) {
          .ivr__bg img { display: none; }
          .ivr__wash { background: var(--cream); }
        }
        @media print { .ivr__bg { display: none; } }

        .ivr__lang {
          display: flex; justify-content: center;
          padding: var(--s-4) var(--gutter) 0;
          color: var(--ink-2);
        }
        /* The simulator caption is the only text sitting directly on the
           photograph rather than on the card. It gets its own small pill so
           it never has to rely on whatever is behind it. */
        .ivr__chrome {
          background: rgba(251, 247, 238, 0.92);
          border-radius: 999px;
          padding: var(--s-2) var(--s-5);
          display: inline-block;
        }
        .ivr__lang .nav__langbtn { font-size: 1.0625rem; padding: 6px 10px; }
      `}</style>
    </>
  );
}
