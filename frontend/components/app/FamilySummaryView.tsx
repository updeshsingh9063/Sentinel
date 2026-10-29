import Link from "next/link";

import { Consent } from "@/components/app/Consent";
import { FamilyNote } from "@/components/app/FamilyNote";
import { IconLock } from "@/components/ui/Icons";
import type { FamilyView } from "@/lib/family";
import { fmt } from "@/lib/i18n";
import type { AppCopy } from "@/lib/i18n-app";

/**
 * The family-facing summary, rendered from the database.
 *
 * Everything shown passed two gates before it could be stored: a granted
 * family_summary consent, and the never-diagnose check. The RLS policy on
 * family_summaries requires both, so a row arriving here is by definition a
 * row this family member may read — there is no second check in this file,
 * and adding one would imply the policy might be wrong.
 *
 * There is no vitals chart, no risk score and no cue list, and a family member
 * holds no database policy that would return them anyway. The restriction is
 * an absence, not an `if`.
 *
 * THREE STATES, NOT ONE. Previously this component assumed a summary existed
 * and fell back to a fixture, so an account with no linked senior was shown a
 * summary about a stranger. Now "nothing is linked to you" and "linked, but
 * nothing published yet" are rendered as themselves. An unexplained empty page
 * reads as a bug; saying which absence it is shows the access control working.
 */
export function FamilySummaryView({ view, t }: { view: FamilyView; t: AppCopy }) {
  if (view.state === "no-link") {
    return (
      <main className="page page--narrow">
        <section className="card fs__card fs__private">
          <h2 className="fs__h2">
            <IconLock size={17} />
            {t.family.noLinkTitle}
          </h2>
          <p className="fs__body">{t.family.noLinkBody}</p>
        </section>
        <FamilyStyles />
      </main>
    );
  }

  return (
    <main className="page page--narrow">
      <header className="fs__head">
        {view.week && <span className="eyebrow">{view.week}</span>}
        <h1 className="display fs__title">
          {fmt(t.family.title, { name: view.seniorName ?? "" })}
        </h1>
      </header>

      {view.state === "no-summary" ? (
        <section className="card fs__card">
          <h2 className="fs__h2">{t.family.noSummaryTitle}</h2>
          <p className="fs__body">{t.family.noSummaryBody}</p>
        </section>
      ) : (
        <article className="card fs__card">
          <p className="fs__headline">{view.headline}</p>
          {(view.body ?? []).map((p) => (
            <p key={p.slice(0, 24)} className="fs__body">
              {p}
            </p>
          ))}
          {/* The same words as a sheet to keep or send on. It carries no
              readings and no score — there is nothing on it a family member
              could not already read here. */}
          {view.seniorId && (
            <Link href={`/summary/${view.seniorId}/report`} className="btn btn--outline fs__report">
              {t.report.download}
            </Link>
          )}
        </article>
      )}

        {/* The one thing that travels the other way: family -> coordinator.
          Everywhere else this view is read-only, which is right for health
          data flowing outward. A family member noticing something knows what
          no sensor recorded. */}
      {view.seniorId && (
        <section className="card fs__card">
          <FamilyNote seniorId={view.seniorId} t={t.family} />
          {view.notes.length > 0 && (
            <div className="fs__notes">
              <h3 className="fs__noteshead">{t.family.noteYours}</h3>
              <ul>
                {view.notes.map((n) => (
                  <li key={n.id}>
                    <span>{n.observedOn}</span>
                    <p>{n.text}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <section className="card fs__card fs__private">
        <h2 className="fs__h2">
          <IconLock size={17} />
          {t.family.notIncluded}
        </h2>
        <ul>
          {t.family.notItems.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
        <p className="fs__note">{t.family.notNote}</p>
      </section>

      <section className="card fs__card">
        <h2 className="fs__h2">{t.family.receive}</h2>
        <Consent items={view.consents} />
        <p className="fs__note">{t.family.receiveNote}</p>
      </section>

      <FamilyStyles />
    </main>
  );
}

function FamilyStyles() {
  return (
    <style>{`
      .fs__head { margin-bottom: var(--s-6); }
      .fs__title { font-size: var(--fs-h2); line-height: 1.12; margin-top: var(--s-2); }
      .fs__card { padding: var(--s-6); margin-bottom: var(--s-5); }
      .fs__headline {
        font-family: var(--display); font-size: 1.375rem; line-height: 1.35;
        margin-bottom: var(--s-4);
      }
      .fs__body {
        font-size: var(--fs-lede); line-height: 1.75; color: var(--ink-2);
        margin-bottom: var(--s-4);
      }
      .fs__body:last-of-type { margin-bottom: 0; }
      .fs__doing {
        margin-top: var(--s-6); padding-top: var(--s-5);
        border-top: 1px solid var(--line);
      }
      .fs__doing p { font-size: var(--fs-sm); line-height: 1.7; color: var(--ink-2); }
      .fs__h2 {
        display: flex; align-items: center; gap: var(--s-2);
        font-family: var(--sans); font-size: var(--fs-sm); font-weight: 600;
        margin: 0 0 var(--s-4);
      }
      .fs__private { background: var(--cream-2); }
      .fs__notes { margin-top: var(--s-5); padding-top: var(--s-4); border-top: 1px solid var(--line); }
      .fs__noteshead { font-size: var(--fs-xs); font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-3); margin-bottom: var(--s-3); }
      .fs__notes ul { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-3); }
      .fs__notes li { display: grid; gap: 2px; }
      .fs__notes li span { font-size: 0.625rem; color: var(--ink-3); }
      .fs__notes li p { font-size: var(--fs-sm); line-height: 1.6; color: var(--ink-2); }
      .fs__report { margin-top: var(--s-5); }
      .fs__private ul { margin: 0; padding-left: 1.15rem; display: grid; gap: var(--s-2); }
      .fs__private li { font-size: var(--fs-sm); line-height: 1.6; color: var(--ink-2); }
      .fs__note {
        margin-top: var(--s-4); font-size: var(--fs-xs);
        line-height: 1.6; color: var(--ink-3);
      }
    `}</style>
  );
}
