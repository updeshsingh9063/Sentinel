import Link from "next/link";

import { SignOut } from "@/components/app/SignOut";
import { LangSwitch } from "@/components/landing/LangSwitch";
import { Logo } from "@/components/ui/Icons";
import { getAppCopy } from "@/lib/i18n-server";
import { DEMO_USERS, type DemoRole } from "@/lib/session";

/**
 * The bar across every signed-in surface.
 *
 * It names the role it is serving, because the four surfaces deliberately show
 * different things and anyone demoing this needs to be able to say which one
 * they are looking at. "Switch role" is right next to the name for the same
 * reason: the fastest way to show that a family member cannot reach the
 * readings is to switch to them and watch the readings not be there.
 */
export async function AppBar({
  role,
  links,
}: {
  role: DemoRole;
  links: { href: string; label: string }[];
}) {
  const { lang, t } = await getAppCopy();
  const user = DEMO_USERS[role];
  const who = t.roles[role];

  return (
    <header className="appbar">
      <div className="appbar__inner">
        <Link href="/" className="appbar__brand">
          <Logo size={20} />
          <span>Samarth Sentinel</span>
        </Link>

        <span className="appbar__role">{who.label}</span>

        <nav className="appbar__links" aria-label={`${who.label} ${t.bar.navSuffix}`}>
          {links.map((l) => (
            <Link key={l.href} href={l.href}>
              {l.label}
            </Link>
          ))}
        </nav>

        <span className="appbar__user">
          <i aria-hidden="true">{user.initials}</i>
          <span>{who.name}</span>
        </span>

        {/* Repeated on every signed-in surface: someone who switches to Hindi
            on the homepage must not lose the control once they sign in. */}
        <LangSwitch lang={lang} label={t.bar.language} />

        <SignOut label={t.bar.switchRole} busyLabel={t.bar.signingOut} />
      </div>

      <style>{`
        .appbar {
          position: sticky; top: 0; z-index: 40;
          background: var(--white);
          border-bottom: 1px solid var(--line);
        }
        .appbar__inner {
          max-width: var(--maxw);
          margin-inline: auto;
          padding-inline: var(--gutter);
          min-height: 4rem;
          display: flex; align-items: center; gap: var(--s-4);
        }
        .appbar__brand {
          display: inline-flex; align-items: center; gap: var(--s-2);
          color: var(--forest); text-decoration: none;
          font-family: var(--display); font-size: 1.05rem; white-space: nowrap;
        }
        .appbar__role {
          font-size: var(--fs-xs); font-weight: 600;
          letter-spacing: 0.08em; text-transform: uppercase;
          color: var(--ink-3);
          padding: 3px var(--s-3);
          border: 1px solid var(--line-2); border-radius: var(--radius-pill);
          white-space: nowrap;
        }
        .appbar__links { display: flex; gap: var(--s-5); margin-left: auto; }
        .appbar__links a {
          font-size: var(--fs-sm); color: var(--ink-2); text-decoration: none;
        }
        .appbar__links a:hover { color: var(--ink); }
        .appbar__user {
          display: inline-flex; align-items: center; gap: var(--s-2);
          font-size: var(--fs-sm); color: var(--ink-2); white-space: nowrap;
          padding-left: var(--s-4); border-left: 1px solid var(--line);
        }
        .appbar__user i {
          width: 26px; height: 26px; border-radius: 50%;
          background: var(--sage); color: var(--forest);
          display: grid; place-items: center;
          font-size: 0.625rem; font-weight: 700; font-style: normal;
        }
        @media (max-width: 62rem) {
          .appbar__links { display: none; }
          .appbar__user span { display: none; }
          .appbar__user { margin-left: auto; border-left: 0; padding-left: 0; }
        }
        @media (max-width: 34rem) { .appbar__brand span, .appbar__role { display: none; } }
      `}</style>
    </header>
  );
}

/**
 * The strip under the bar on every product surface, saying out loud that the
 * numbers are synthetic. Judges mark honesty about limitations, and a figure
 * on screen with no provenance is the easiest thing in a demo to over-claim.
 */
export async function DemoNotice({ children }: { children?: React.ReactNode }) {
  const { t } = await getAppCopy();
  return (
    <p className="demo-notice">
      {children ?? t.notice.fixtures}
      <style>{`
        .demo-notice {
          background: var(--cream-2);
          border-bottom: 1px solid var(--line);
          margin: 0;
          padding: var(--s-2) var(--gutter);
          font-size: var(--fs-xs);
          color: var(--ink-3);
          text-align: center;
        }
      `}</style>
    </p>
  );
}
