import Link from "next/link";

import { LangSwitch } from "@/components/landing/LangSwitch";
import { NavChrome } from "@/components/landing/NavChrome";
import { Logo } from "@/components/ui/Icons";
import { getCopy } from "@/lib/i18n-server";

/**
 * Fixed nav, transparent over the hero photograph and a forest bar below it.
 *
 * It stays on screen because the page is long and the one thing someone wants
 * after reading it is the way in; sending them back to the top to find "Get
 * Started" is the sort of friction that reads as unfinished.
 *
 * The small-screen menu is still a <details>, so it opens without JavaScript
 * and cannot get stuck shut if a bundle fails. The language switch and the
 * scroll flag are the only client pieces here; everything else renders on the
 * server in whichever language the cookie asks for.
 */

const HREFS = ["/", "#how", "#features", "#impact", "#about"];

export async function Nav() {
  const { lang, t } = await getCopy();

  const LINKS = [
    { href: HREFS[0], label: t.nav.home, current: true },
    { href: HREFS[1], label: t.nav.how },
    { href: HREFS[2], label: t.nav.features },
    { href: HREFS[3], label: t.nav.impact },
    { href: HREFS[4], label: t.nav.about },
  ];

  return (
    <header className="nav on-forest">
      <NavChrome />
      <div className="wrap nav__inner">
        <Link href="/" className="nav__brand">
          <Logo size={26} />
          <span>Samarth Sentinel</span>
        </Link>

        <nav className="nav__links" aria-label={t.nav.main}>
          {LINKS.map((l) => (
            <Link
              key={l.label}
              href={l.href}
              className={l.current ? "nav__link nav__link--on" : "nav__link"}
              aria-current={l.current ? "page" : undefined}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="nav__right">
          <Link href="/signin" className="btn btn--cream nav__cta">
            {t.nav.cta}
          </Link>
          <LangSwitch lang={lang} label={t.nav.language} />
        </div>

        <details className="nav__more">
          <summary aria-label={t.nav.menu}>
            <span /><span /><span />
          </summary>
          {/* The sheet carries the language switch and the call to action as
              well as the links. On a phone the bar has room for neither, and
              without them here a Hindi reader on the device most of this
              audience actually owns had no way to switch the home page out of
              English, and no way in except scrolling to the bottom. */}
          <div className="nav__sheet">
            {LINKS.map((l) => (
              <Link key={l.label} href={l.href}>
                {l.label}
              </Link>
            ))}
            <span className="nav__sheetrule" aria-hidden="true" />
            <LangSwitch lang={lang} label={t.nav.language} />
            <Link href="/signin" className="btn btn--cream nav__sheetcta">
              {t.nav.cta}
            </Link>
          </div>
        </details>
      </div>

      <style>{`
        .nav {
          position: fixed; inset: 0 0 auto; z-index: 20;
          transition: background var(--dur) var(--ease),
                      box-shadow var(--dur) var(--ease),
                      backdrop-filter var(--dur) var(--ease);
        }
        /* Past the fold the photograph is gone and the bar has to supply its
           own ground. Translucent rather than solid so the section underneath
           still moves behind it, which is what stops a fixed header feeling
           like a lid. */
        :root[data-scrolled="true"] .nav {
          background: rgba(16, 42, 35, 0.86);
          backdrop-filter: saturate(150%) blur(14px);
          -webkit-backdrop-filter: saturate(150%) blur(14px);
          box-shadow: inset 0 -1px 0 rgba(244, 239, 227, 0.12),
                      0 12px 32px rgba(10, 26, 21, 0.22);
        }
        .nav__inner {
          min-height: var(--nav-h);
          display: flex;
          align-items: center;
          gap: var(--s-6);
          transition: min-height var(--dur) var(--ease);
        }
        /* Condensing is the cue that you have moved. Small — 1rem — because
           the nav should settle, not animate. */
        :root[data-scrolled="true"] .nav__inner { min-height: 4rem; }
        .nav__brand {
          display: inline-flex; align-items: center; gap: var(--s-3);
          text-decoration: none; color: var(--on-dark);
          font-family: var(--display); font-size: 1.3rem; letter-spacing: -0.01em;
          white-space: nowrap; margin-right: auto;
        }
        .nav__links { display: flex; gap: var(--s-6); }
        .nav__link {
          position: relative;
          font-size: var(--fs-sm); color: var(--on-dark-2);
          text-decoration: none; padding-block: 2px;
          transition: color var(--dur) var(--ease);
        }
        .nav__link:hover { color: var(--on-dark); }
        /* The rule grows from the left rather than fading in, so it reads as
           the same mark the current page already carries. */
        .nav__link::after {
          content: ""; position: absolute; left: 0; right: 0; bottom: 0;
          height: 1.5px; background: var(--pill);
          transform: scaleX(0); transform-origin: left;
          transition: transform var(--dur) var(--ease);
        }
        .nav__link:hover::after { transform: scaleX(1); }
        .nav__link--on { color: var(--on-dark); }
        .nav__link--on::after { transform: scaleX(1); }
        .nav__right { display: flex; align-items: center; gap: var(--s-5); margin-left: auto; }
        .nav__cta { min-height: 2.6rem; padding-inline: var(--s-5); }
        .nav__lang {
          display: inline-flex; align-items: center; gap: var(--s-3);
          font-size: var(--fs-sm); color: var(--on-dark-2);
        }
        /* Devanagari is keyed off the lang attribute the button already
           carries, so the label renders in Plex Devanagari whichever
           language the rest of the page is in. */
        .nav__lang [lang="hi"] { font-family: var(--deva); }
        .nav__bar { width: 1px; height: 0.9rem; background: rgba(244,239,227,0.35); margin-right: var(--s-3); }

        .nav__more { display: none; margin-left: auto; position: relative; }
        .nav__more summary {
          list-style: none; cursor: pointer; width: 2.75rem; height: 2.75rem;
          display: grid; align-content: center; justify-items: end; gap: 5px;
        }
        .nav__more summary::-webkit-details-marker { display: none; }
        .nav__more summary span { display: block; width: 22px; height: 1.5px; background: var(--on-dark); }
        .nav__sheet {
          position: absolute; right: 0; top: 3rem; min-width: 12rem;
          background: var(--forest); border: 1px solid var(--forest-3);
          border-radius: var(--radius); padding: var(--s-3);
          display: grid; gap: var(--s-1);
        }
        .nav__sheet a {
          color: var(--on-dark-2); text-decoration: none;
          font-size: var(--fs-sm); padding: var(--s-2) var(--s-3);
          border-radius: var(--radius-sm);
        }
        .nav__sheet a:hover { color: var(--on-dark); background: var(--forest-2); }
        .nav__sheetrule {
          height: 1px; background: var(--forest-3);
          margin-block: var(--s-2);
        }
        /* The switch hides itself in the bar below 68rem; inside the sheet it
           is the only copy of it, so the rule is turned back on here. */
        .nav__sheet .nav__lang {
          display: inline-flex; align-items: center;
          padding: var(--s-2) var(--s-3);
        }
        .nav__sheet .nav__langbtn { font-size: var(--fs-body); padding: 4px 6px; }
        /* .nav__sheet a is more specific than .btn--cream, so the pill has to
           restate its own colours or it inherits the link's. */
        .nav__sheet a.nav__sheetcta {
          margin-top: var(--s-2); min-height: 2.75rem;
          background: var(--pill); color: var(--ink);
        }
        .nav__sheet a.nav__sheetcta:hover { background: var(--pill-hover); color: var(--ink); }

        /* The links go before the bar runs out of room, so the menu button has
           to appear at the SAME width. Previously the links left at 68rem and
           the button only arrived at 40rem, which left tablet widths with a
           header carrying no navigation at all. */
        @media (max-width: 68rem) {
          .nav__links { display: none; }
          .nav__lang { display: none; }
          /* Its own auto left margin would compete with .nav__right's for the
             free space and strand the pill in the middle of the bar. One auto
             margin, so one gap. */
          .nav__more { display: block; margin-left: var(--s-4); }
          /* The bar still has the switch and the pill at this width, so the
             sheet does not repeat them. */
          .nav__sheetrule,
          .nav__sheet .nav__lang,
          .nav__sheet a.nav__sheetcta { display: none; }
        }
        @media (max-width: 40rem) {
          .nav__right { display: none; }
          .nav__sheetrule { display: block; }
          .nav__sheet .nav__lang { display: inline-flex; }
          .nav__sheet a.nav__sheetcta { display: inline-flex; }
        }
      `}</style>
    </header>
  );
}
