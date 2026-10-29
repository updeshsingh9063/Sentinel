import { CheckinSim } from "@/components/app/CheckinSim";
import { LangSwitch } from "@/components/landing/LangSwitch";
import { getAppCopy } from "@/lib/i18n-server";

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
 */

export async function generateMetadata() {
  const { t } = await getAppCopy();
  return { title: `${t.titles.checkin} · Samarth Sentinel` };
}

export default async function CheckinPage() {
  const { lang, t } = await getAppCopy();
  return (
    <>
      <div className="ivr__lang">
        <LangSwitch lang={lang} label={t.bar.language} />
      </div>
      <CheckinSim t={t.checkin} lang={lang} />
      <style>{`
        .ivr__lang {
          display: flex; justify-content: center;
          padding: var(--s-4) var(--gutter) 0;
          color: var(--ink-2);
        }
        .ivr__lang .nav__langbtn { font-size: 1.0625rem; padding: 6px 10px; }
      `}</style>
    </>
  );
}
