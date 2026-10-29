"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { LANG_COOKIE, type Lang } from "@/lib/i18n";

/**
 * The language switch.
 *
 * Sets a cookie and refreshes. The page is server-rendered, so the refresh is
 * what actually swaps the copy — this component holds no translations itself.
 *
 * Both options are always shown rather than one toggle, because a reader who
 * cannot read the current language needs to SEE the word for theirs. "हिंदी"
 * is therefore never hidden behind an English label.
 *
 * A year-long cookie: a reader who picks Hindi should not have to pick it
 * again on their next visit.
 */

const OPTIONS: { lang: Lang; label: string; lang_attr: string }[] = [
  { lang: "hi", label: "हिंदी", lang_attr: "hi" },
  { lang: "en", label: "EN", lang_attr: "en" },
];

export function LangSwitch({ lang, label }: { lang: Lang; label: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function choose(next: Lang) {
    if (next === lang) return;
    document.cookie = `${LANG_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    startTransition(() => router.refresh());
  }

  return (
    <span className="nav__lang" role="group" aria-label={label} data-pending={pending || undefined}>
      {OPTIONS.map((o, i) => (
        <span key={o.lang} className="nav__langitem">
          {i > 0 && <span className="nav__bar" aria-hidden="true" />}
          <button
            type="button"
            lang={o.lang_attr}
            className={o.lang === lang ? "nav__langbtn nav__langbtn--on" : "nav__langbtn"}
            aria-current={o.lang === lang ? "true" : undefined}
            onClick={() => choose(o.lang)}
          >
            {o.label}
          </button>
        </span>
      ))}

      <style>{`
        .nav__langitem { display: inline-flex; align-items: center; }
        .nav__langbtn {
          font: inherit;
          font-size: var(--fs-sm);
          color: currentColor;
          opacity: 0.72;
          background: none;
          border: 0;
          padding: 2px 4px;
          border-radius: 4px;
          cursor: pointer;
          transition: opacity var(--dur) var(--ease);
        }
        .nav__langbtn:hover { opacity: 1; }
        .nav__langbtn--on { opacity: 1; font-weight: 600; }
        .nav__langbtn:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
        .nav__lang[data-pending] { opacity: 0.6; }
      `}</style>
    </span>
  );
}
