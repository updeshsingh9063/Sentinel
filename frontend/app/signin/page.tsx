import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";

import { LangSwitch } from "@/components/landing/LangSwitch";
import { SignInForm } from "@/components/app/SignInForm";
import {
  IconCoins,
  IconLanguage,
  IconLock,
  IconMic,
  IconShield,
  Logo,
} from "@/components/ui/Icons";
import { getAppCopy, getCopy } from "@/lib/i18n-server";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { SLOTS, hasImage, slotSrc } from "@/lib/images";

/**
 * Sign in: a photographic panel on the left, the form on the right.
 *
 * WHY A SPLIT AND NOT A CENTRED CARD. This is the first page behind the
 * landing page and, for anyone arriving from a link, possibly the first page
 * they see at all. A bare form on cream gives them nothing to tell them what
 * they are signing in to. The panel carries the promise across; the right half
 * stays a plain, quiet form, because that is what someone typing a password
 * wants.
 *
 * THE PANEL'S COPY IS THE HERO'S, DELIBERATELY REUSED. Same eyebrow, same
 * headline, same four promises, same handwritten line. Nothing new was written
 * for it: new copy means new Hindi, and a sign-in page is the wrong place to
 * risk a string nobody checked. It also means the two pages cannot drift.
 *
 * A server component so the copy renders in the cookie's language on the first
 * paint; the form itself is a client component because signing in is a browser
 * call.
 *
 * The language switch is repeated here because this is the first page after
 * the landing page, and losing the ability to change language the moment you
 * leave the homepage would make the feature pointless.
 *
 * The note at the foot says what this is and what the data is. Overstating it
 * would be the easiest thing in the whole build to get caught on.
 */

const PROMISE_ICONS = [IconLanguage, IconMic, IconShield, IconCoins];

export async function generateMetadata() {
  const { t } = await getAppCopy();
  return { title: `${t.titles.signin} · Samarth Sentinel` };
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { lang, t } = await getAppCopy();
  const { t: landing } = await getCopy();

  // A reset link lands on this same page, so the page has to stop calling
  // itself "Sign in". Someone who arrived here from a password-reset email is
  // not being offered a choice of tabs, and a heading that says otherwise
  // reads as the wrong page having loaded.
  // Whose line the check-in card opens. The copy used to carry a hand-written
  // fixture name that the cohort loader long ago replaced, so the card named
  // somebody who is not in this database — and a person could answer six
  // questions as one name, then search the coordinator's dashboard for it and
  // find nothing. The name is read from the row that actually receives the
  // call. Just the name: anon reads zero rows from `seniors` and still does.
  const supabase = await createSupabaseClient();
  const { data: lineName } = await supabase.rpc("demo_line_name");

  const resetting = (await searchParams).flow === "reset";
  const heading = resetting ? t.signin.resetTitle : t.signin.title;
  const standfirst = resetting ? t.signin.resetBody : t.signin.sub;

  const meta = SLOTS.signin;
  const filled = hasImage("signin");
  const promises = landing.hero.promises.map((label, i) => ({
    icon: PROMISE_ICONS[i],
    label,
  }));

  return (
    <main className="si">
      {/* Decorative, and ordered after the form in the DOM would be wrong for
          a sighted keyboard user who sees it first. It carries no controls
          except the brand link home, so reading order and visual order agree. */}
      <aside className="si__panel on-forest">
        <div className="si__panelMedia" aria-hidden={filled ? undefined : "true"}>
          {filled && (
            <Image
              src={slotSrc("signin")}
              alt={meta.alt}
              fill
              priority
              sizes="(max-width: 64rem) 100vw, 50vw"
              style={{ objectFit: "cover", objectPosition: meta.objectPosition }}
            />
          )}
        </div>
        <span className="si__panelScrim" aria-hidden="true" />
        <span className="grain" aria-hidden="true" />

        <div className="si__panelInner">
          <Link href="/" className="si__panelBrand">
            <Logo size={30} />
            <span>
              Samarth Sentinel
              <small>{landing.hero.eyebrow}</small>
            </span>
          </Link>

          <div className="si__panelCopy">
            <p className="display display--sub si__panelTitle">
              {landing.hero.subA}
              <br />
              {landing.hero.subB}
            </p>
            <p className="si__panelBody">{landing.hero.body}</p>

            <ul className="si__panelPromises">
              {promises.map(({ icon: Icon, label }) => (
                <li key={label}>
                  <Icon size={22} />
                  <span>{label}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* English in both languages, as in the hero: Caveat carries no
              Devanagari, so set in Hindi it would drop to a system face and
              stop looking handwritten, which is the only reason it is here. */}
          <p className="script si__panelScript" aria-hidden="true" lang="en">
            Better care.
            <br />
            Brighter tomorrows.
          </p>
        </div>
      </aside>

      <div className="si__pane">
        <div className="si__inner">
          {/* Only the language switch. The wordmark lives on the panel at
              every width — the banner keeps it on a phone — and printing it
              twice on the same screen reads as an oversight rather than a
              lockup. That link is also the way back to the landing page. */}
          <div className="si__top">
            <LangSwitch lang={lang} label={t.bar.language} />
          </div>

          <h1 className="display si__title">{heading}</h1>
          <p className="si__sub">{standfirst}</p>

          <Suspense fallback={<p className="si__sub">{t.signin.loading}</p>}>
            <SignInForm t={t} seniorName={typeof lineName === "string" ? lineName : ""} />
          </Suspense>

          <section className="si__note">
            <h2>
              <IconLock size={15} />
              {t.signin.noteTitle}
            </h2>
            <p>{t.signin.note1}</p>
            <p>{t.signin.note2}</p>
            <p>{t.signin.note3}</p>
          </section>
        </div>
      </div>

      <style>{`
        .si {
          min-height: 100svh;
          background: var(--cream-2);
          display: grid;
          grid-template-columns: minmax(0, 1fr);
        }

        /* ---- left panel ------------------------------------------------- */

        .si__panel {
          position: relative; isolation: isolate; overflow: hidden;
          background: var(--forest);
          display: flex;
          /* On a wide screen it fills the viewport and stays put while the
             form side scrolls, so a long form never drags the photograph up
             with it. */
          min-height: 16rem;
        }
        .si__panelMedia { position: absolute; inset: 0; z-index: -2; }
        .si__panelMedia img { width: 100%; height: 100%; }
        /* Dark at the foot where the type is, open at the top where the faces
           are. The subjects are the reason the picture is here. */
        .si__panelScrim {
          position: absolute; inset: 0; z-index: -1;
          background:
            linear-gradient(180deg,
              rgba(10, 26, 21, 0.74) 0%,
              rgba(10, 26, 21, 0.20) 26%,
              rgba(10, 26, 21, 0.36) 50%,
              rgba(10, 26, 21, 0.86) 74%,
              rgba(10, 26, 21, 0.95) 100%),
            linear-gradient(90deg,
              rgba(10, 26, 21, 0.45) 0%,
              rgba(10, 26, 21, 0.06) 48%,
              rgba(10, 26, 21, 0) 100%);
        }
        .si__panelInner {
          position: relative;
          display: flex; flex-direction: column;
          width: 100%;
          padding: var(--s-10) clamp(var(--s-6), 4vw, var(--s-16));
          gap: var(--s-8);
        }
        .si__panelBrand {
          display: inline-flex; align-items: center; gap: var(--s-3);
          color: var(--on-dark); text-decoration: none;
          font-family: var(--display); font-size: 1.4rem; line-height: 1.1;
          align-self: flex-start;
        }
        .si__panelBrand small {
          display: block;
          font-family: var(--sans);
          font-size: 0.625rem; font-weight: 600;
          letter-spacing: 0.14em; text-transform: uppercase;
          color: var(--on-dark-3);
          margin-top: 3px;
        }
        /* Pushed to the foot of the panel, under the open part of the scrim. */
        .si__panelCopy { margin-top: auto; }
        /* Sized by hand rather than taking --fs-sub. This headline shares its
           half of the screen with a photograph, so it wants to be smaller than
           the hero's — big enough to be the claim, small enough that the two
           faces behind it still carry the panel. */
        .si__panelTitle {
          color: var(--on-dark);
          font-size: clamp(1.25rem, 0.95rem + 0.75vw, 1.7rem);
          margin-bottom: var(--s-4);
        }
        .si__panelBody {
          color: var(--on-dark-2); font-size: var(--fs-xs); line-height: 1.75;
          max-width: 38ch; margin-bottom: var(--s-6);
        }
        .si__panelPromises {
          list-style: none; margin: 0; padding: 0;
          display: flex; flex-wrap: wrap; gap: var(--s-6) 0;
        }
        .si__panelPromises li {
          display: grid; gap: var(--s-2); justify-items: start;
          padding-inline: var(--s-5);
          border-left: 1px solid rgba(244, 239, 227, 0.22);
          color: var(--on-dark);
          font-size: var(--fs-xs); line-height: 1.35;
          white-space: pre-line; min-width: 7rem;
        }
        .si__panelPromises li:first-child { padding-left: 0; border-left: 0; }
        .si__panelScript {
          color: var(--on-dark);
          font-size: clamp(1.1rem, 0.9rem + 0.6vw, 1.5rem);
          transform: rotate(-3deg);
          margin-top: var(--s-8);
          align-self: flex-start;
          text-shadow: 0 1px 12px rgba(10, 26, 21, 0.6);
        }

        /* ---- right pane ------------------------------------------------- */

        .si__pane {
          display: grid; justify-items: center; align-content: start;
          padding: var(--s-12) var(--gutter) var(--s-16);
        }
        .si__inner { width: 100%; max-width: 32rem; }
        .si__top {
          display: flex; align-items: center; justify-content: flex-end;
          gap: var(--s-4); margin-bottom: var(--s-6);
          color: var(--ink-2);
        }
        .si__title { font-size: var(--fs-h2); line-height: 1.1; }
        .si__sub {
          font-size: var(--fs-sm); line-height: 1.7; color: var(--ink-2);
          margin-top: var(--s-3); max-width: 46ch;
        }

        /* Two columns once there is room for the panel to be a panel rather
           than a letterbox. Below this the photograph becomes a short banner:
           still warm, but not eating the fold on the page where someone came
           to type a password. */
        @media (min-width: 64rem) {
          .si { grid-template-columns: 1fr 1fr; }
          .si__panel { position: sticky; top: 0; height: 100svh; }
          .si__pane { padding-block: var(--s-16); }
        }
        @media (max-width: 64rem) {
          .si__panel { min-height: 42svh; }
          .si__panelCopy, .si__panelScript { display: none; }
          .si__panelInner { justify-content: flex-start; }
          /* With the copy gone the foot of the scrim has nothing to hold, so
             it lifts and lets more of the room through. */
          .si__panelScrim {
            background: linear-gradient(180deg,
              rgba(10, 26, 21, 0.72) 0%,
              rgba(10, 26, 21, 0.28) 46%,
              rgba(10, 26, 21, 0.4) 100%);
          }
        }
        .si__redirect {
          display: flex; align-items: center; gap: var(--s-2);
          margin-top: var(--s-6);
          padding: var(--s-3) var(--s-4);
          background: var(--white); border: 1px solid var(--line);
          border-radius: var(--radius);
          font-size: var(--fs-xs); color: var(--ink-2);
        }
        .si__redirect code, .si__note code {
          font-size: 0.9em; background: var(--cream-2);
          padding: 1px 5px; border-radius: 4px; border: 1px solid var(--line);
        }
        .si__error {
          margin-top: var(--s-6);
          padding: var(--s-3) var(--s-4);
          background: var(--white);
          border: 1px solid var(--risk-high, #b3261e);
          border-left-width: 3px;
          border-radius: var(--radius);
          font-size: var(--fs-xs); color: var(--ink-1);
        }

        .si__tabs {
          display: flex; gap: var(--s-2); margin-top: var(--s-6);
          border-bottom: 1px solid var(--line);
        }
        .si__tab {
          font: inherit; font-size: var(--fs-sm); font-weight: 600;
          color: var(--ink-3); background: none; border: 0;
          padding: var(--s-3) var(--s-4); cursor: pointer;
          border-bottom: 2px solid transparent; margin-bottom: -1px;
        }
        .si__tab--on { color: var(--forest); border-bottom-color: var(--forest); }
        .si__tab:focus-visible { outline: 2px solid var(--forest); outline-offset: 2px; }

        .si__google {
          display: flex; align-items: center; justify-content: center;
          gap: var(--s-3); width: 100%;
          margin-top: var(--s-5);
          padding: var(--s-3) var(--s-4);
          font: inherit; font-size: var(--fs-sm); font-weight: 600;
          color: var(--ink); background: var(--white);
          border: 1px solid var(--line-2); border-radius: var(--radius);
          cursor: pointer;
          transition: border-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
        }
        .si__google:hover:not(:disabled) {
          border-color: var(--ink-3); box-shadow: var(--shadow-card);
        }
        .si__google:disabled { opacity: 0.55; cursor: default; }
        .si__google:focus-visible { outline: 2px solid var(--forest); outline-offset: 2px; }

        .si__form { display: grid; gap: var(--s-4); margin-top: var(--s-5); }
        .si__field { display: grid; gap: var(--s-2); border: 0; padding: 0; margin: 0; }
        .si__field > span, .si__field > legend {
          font-size: var(--fs-xs); font-weight: 600; color: var(--ink-2); padding: 0;
        }
        .si__field input[type="email"],
        .si__field input[type="text"],
        .si__field input[type="password"] {
          font: inherit; font-size: var(--fs-sm);
          padding: var(--s-3) var(--s-4);
          border: 1px solid var(--line); border-radius: var(--radius);
          background: var(--white); color: var(--ink); width: 100%;
        }
        .si__field input:focus-visible { outline: 2px solid var(--forest); outline-offset: -1px; }
        .si__field small { font-size: var(--fs-xs); color: var(--ink-3); }
        .si__roles-pick { display: flex; flex-wrap: wrap; gap: var(--s-3); }
        .si__roles-pick legend { width: 100%; margin-bottom: var(--s-2); }
        .si__radio {
          display: inline-flex; align-items: center; gap: var(--s-2);
          font-size: var(--fs-sm); cursor: pointer;
          padding: var(--s-2) var(--s-3);
          border: 1px solid var(--line); border-radius: var(--radius-pill);
        }
        .si__radio:has(input:checked) { border-color: var(--forest); background: var(--cream-2); }
        .si__submit { width: 100%; justify-content: center; }
        .si__hint { font-size: var(--fs-xs); line-height: 1.6; color: var(--ink-3); margin: 0; }
        .si__hint--centre { text-align: center; margin-bottom: var(--s-4); }
        .si__notice {
          margin-top: var(--s-4); padding: var(--s-3) var(--s-4);
          background: var(--white); border: 1px solid var(--forest);
          border-left-width: 3px; border-radius: var(--radius);
          font-size: var(--fs-xs); line-height: 1.6; color: var(--ink-1);
        }
        .si__divider {
          display: flex; align-items: center; gap: var(--s-3);
          margin: var(--s-8) 0 var(--s-2);
          font-size: var(--fs-xs); color: var(--ink-3);
        }
        .si__divider::before, .si__divider::after {
          content: ""; flex: 1; height: 1px; background: var(--line);
        }

        .si__roles { list-style: none; margin: var(--s-4) 0 0; padding: 0; display: grid; gap: var(--s-3); }
        .si__card {
          display: flex; align-items: center; gap: var(--s-4);
          width: 100%; text-align: left;
          padding: var(--s-4) var(--s-5);
          background: var(--white);
          border: 1px solid var(--line);
          border-radius: var(--radius);
          cursor: pointer; font: inherit;
          transition: border-color var(--dur) var(--ease),
                      box-shadow var(--dur) var(--ease),
                      transform var(--dur) var(--ease);
        }
        .si__card:hover:not(:disabled) {
          border-color: var(--forest);
          box-shadow: var(--shadow-card);
          transform: translateY(-2px);
        }
        .si__card:disabled { opacity: 0.55; cursor: default; }
        .si__card:focus-visible { outline: 2px solid var(--forest); outline-offset: 3px; }
        .si__avatar {
          flex: none;
          width: 44px; height: 44px; border-radius: 50%;
          background: var(--sage); color: var(--forest);
          display: grid; place-items: center;
          font-size: var(--fs-sm); font-weight: 700;
        }
        .si__text { display: grid; gap: 2px; min-width: 0; }
        .si__name { font-size: 1rem; font-weight: 600; }
        .si__label {
          font-size: var(--fs-xs); font-weight: 600;
          letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-3);
        }
        .si__sees { font-size: var(--fs-xs); line-height: 1.55; color: var(--ink-2); margin-top: 3px; }
        .si__go { flex: none; color: var(--ink-3); }
        .si__card:hover:not(:disabled) .si__go { color: var(--forest); }

        .si__note {
          margin-top: var(--s-8); padding: var(--s-5);
          background: var(--white);
          border: 1px solid var(--line); border-radius: var(--radius);
        }
        .si__note h2 {
          display: flex; align-items: center; gap: var(--s-2);
          font-family: var(--sans); font-size: var(--fs-sm); font-weight: 600;
          margin: 0 0 var(--s-3);
        }
        .si__note p {
          font-size: var(--fs-xs); line-height: 1.65; color: var(--ink-2);
          margin-bottom: var(--s-3);
        }
        .si__note p:last-child { margin-bottom: 0; }
      `}</style>
    </main>
  );
}
