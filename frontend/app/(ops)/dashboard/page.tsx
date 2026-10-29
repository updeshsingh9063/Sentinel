import { IconLock } from "@/components/ui/Icons";
import { fmt } from "@/lib/i18n";
import { getAppCopy } from "@/lib/i18n-server";
import { loadOps } from "@/lib/ops";

/**
 * Operations view: aggregates only.
 *
 * Backed by one security-definer view that has already aggregated the
 * individual away. The ops role holds no table-level policy anywhere in the
 * schema, so there is no individual record this page could render even by
 * mistake — which is why the privacy note here states an absence rather than
 * a promise to be careful.
 *
 * The two numbers that matter most are false-alarm rate and precision@K.
 * Volume is easy to move and tells you nothing; a list nobody trusts is worse
 * than no list.
 *
 * Every figure below is read from the database at request time. Nothing on
 * this page is a fixture.
 */

export async function generateMetadata() {
  const { t } = await getAppCopy();
  return { title: `${t.titles.ops} · Samarth Sentinel` };
}

// Aggregates change as coordinators record verdicts, so do not cache the page.
export const dynamic = "force-dynamic";

export default async function OpsDashboardPage() {
  const { t } = await getAppCopy();
  const ops = await loadOps(t.ops.outcomeLabels);

  if (!ops) {
    return (
      <main className="page">
        <header className="page__head">
          <h1 className="display page__title">{t.ops.title}</h1>
        </header>
        <section className="card ops__privacy">
          <h2 className="ops__h2">{t.ops.emptyTitle}</h2>
          <p>{t.ops.emptyBody}</p>
        </section>
      </main>
    );
  }

  const peak = Math.max(...ops.daily.map((d) => d.raised), 1);
  const outcomeTotal = ops.outcomes.reduce((n, o) => n + o.count, 0) || 1;

  return (
    <main className="page">
      <header className="page__head">
        <span className="eyebrow">
          {t.ops.city} · {fmt(t.ops.period, { days: ops.periodDays })}
        </span>
        <h1 className="display page__title">{t.ops.title}</h1>
        <p className="page__sub">
          {fmt(t.ops.sub, {
            coordinators: ops.coordinators,
            seniors: ops.seniorsCovered.toLocaleString("en-IN"),
          })}
        </p>
      </header>

      <ul className="ops__stats">
        <li className="card stat">
          <span className="stat__value">{ops.alertsRaised}</span>
          <span className="stat__label">{t.ops.raised}</span>
          <span className="stat__note">
            {fmt(t.ops.raisedNote, {
              actioned: ops.alertsActioned,
              open: ops.alertsRaised - ops.alertsActioned,
            })}
          </span>
        </li>
        <li className="card stat">
          <span className="stat__value">
            {ops.medianMinutesToFirstAction === null
              ? "—"
              : `${ops.medianMinutesToFirstAction} min`}
          </span>
          <span className="stat__label">{t.ops.median}</span>
          <span className="stat__note">{t.ops.medianNote}</span>
        </li>
        <li className="card stat">
          <span className="stat__value">{Math.round(ops.falseAlarmRate * 100)}%</span>
          <span className="stat__label">{t.ops.falseAlarm}</span>
          <span className="stat__note">{t.ops.falseAlarmNote}</span>
        </li>
        <li className="card stat">
          <span className="stat__value">{ops.precisionAtK.toFixed(2)}</span>
          <span className="stat__label">{t.ops.precision}</span>
          <span className="stat__note">{t.ops.precisionNote}</span>
        </li>
      </ul>

      <div className="ops__grid">
        <section className="card ops__card">
          <h2 className="ops__h2">{t.ops.volume}</h2>
          <ul className="ops__bars">
            {ops.daily.map((d, i) => (
              <li key={i}>
                <span className="ops__bar" style={{ height: `${(d.raised / peak) * 100}%` }}>
                  <i style={{ height: `${d.raised ? (d.actioned / d.raised) * 100 : 0}%` }} />
                </span>
                <span className="ops__barday">{d.day}</span>
                <span className="visually-hidden">
                  {d.raised} raised, {d.actioned} actioned
                </span>
              </li>
            ))}
          </ul>
          <p className="ops__key">
            <i className="ops__sw ops__sw--raised" /> {t.ops.keyRaised}
            <i className="ops__sw ops__sw--actioned" /> {t.ops.keyActioned}
          </p>
          <p className="ops__note">{t.ops.volumeNote}</p>
        </section>

        <section className="card ops__card">
          <h2 className="ops__h2">{t.ops.outcomes}</h2>
          <ul className="ops__outcomes">
            {ops.outcomes.map((o) => (
              <li key={o.label}>
                <span className="ops__obar">
                  <i
                    data-tone={o.tone}
                    style={{ width: `${(o.count / outcomeTotal) * 100}%` }}
                  />
                </span>
                <span className="ops__olabel">{o.label}</span>
                <span className="ops__ocount">{o.count}</span>
              </li>
            ))}
          </ul>
          <p className="ops__note">{t.ops.outcomesNote}</p>
        </section>

      {ops.cities.length > 0 && (
        <section className="ops__panel">
          <h2 className="ops__h2">{t.ops.byCity}</h2>
          <table className="ops__cities">
            <thead>
              <tr>
                <th scope="col">{t.ops.cityCol}</th>
                <th scope="col">{t.ops.seniorsCol}</th>
                <th scope="col">{t.ops.raised}</th>
                <th scope="col">{t.ops.trueCol}</th>
                <th scope="col">{t.ops.falseCol}</th>
                <th scope="col">{t.ops.medianCol}</th>
              </tr>
            </thead>
            <tbody>
              {ops.cities.map((c) => (
                <tr key={c.city}>
                  <th scope="row">{c.city}</th>
                  <td>{c.seniors}</td>
                  <td>{c.alertsRaised}</td>
                  <td>{c.trueConcern}</td>
                  <td>{c.falseAlarm}</td>
                  <td>{c.medianMinutes === null ? "—" : `${c.medianMinutes}m`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="ops__note">{t.ops.byCityNote}</p>
        </section>
      )}

      </div>

      <section className="card ops__privacy">
        <h2 className="ops__h2">
          <IconLock size={17} />
          {t.ops.privacyTitle}
        </h2>
        <p>{t.ops.privacyBody}</p>
      </section>

      <style>{`
        .ops__stats {
          list-style: none; margin: 0 0 var(--s-5); padding: 0;
          display: grid; gap: var(--s-4);
          grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
        }
        .ops__stats .card { padding: var(--s-5); }
        .ops__grid { display: grid; gap: var(--s-5); margin-bottom: var(--s-5); }
        @media (min-width: 60rem) { .ops__grid { grid-template-columns: 1.1fr 1fr; } }
        .ops__card { padding: var(--s-5); }
        .ops__h2 {
          display: flex; align-items: center; gap: var(--s-2);
          font-family: var(--sans); font-size: var(--fs-sm); font-weight: 600;
          margin: 0 0 var(--s-5);
        }

        .ops__bars {
          list-style: none; margin: 0; padding: 0;
          display: flex; align-items: flex-end; gap: 6px; height: 160px;
        }
        .ops__bars li { flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; justify-content: flex-end; }
        .ops__bar {
          width: 100%; background: var(--sage); border-radius: 3px 3px 0 0;
          display: flex; align-items: flex-end; min-height: 4px;
        }
        .ops__bar i { display: block; width: 100%; background: var(--forest); border-radius: 3px 3px 0 0; }
        .ops__barday { font-size: 0.625rem; color: var(--ink-3); margin-top: var(--s-2); }
        .ops__key {
          display: flex; align-items: center; gap: var(--s-2);
          font-size: var(--fs-xs); color: var(--ink-3); margin-top: var(--s-4);
        }
        .ops__sw { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
        .ops__sw--raised { background: var(--sage); border: 1px solid var(--line-2); }
        .ops__sw--actioned { background: var(--forest); margin-left: var(--s-3); }

        .ops__outcomes { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-4); }
        .ops__outcomes li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--s-2) var(--s-3); }
        .ops__obar { grid-column: 1 / -1; height: 8px; background: var(--cream-2); border-radius: var(--radius-pill); overflow: hidden; }
        .ops__obar i { display: block; height: 100%; border-radius: var(--radius-pill); }
        .ops__obar i[data-tone="high"] { background: var(--risk-high); }
        .ops__obar i[data-tone="med"]  { background: var(--risk-med); }
        .ops__obar i[data-tone="low"]  { background: var(--risk-low); }
        .ops__olabel { font-size: var(--fs-sm); color: var(--ink-2); }
        .ops__ocount { font-size: var(--fs-sm); font-variant-numeric: tabular-nums; color: var(--ink-3); }

        .ops__privacy { padding: var(--s-5); background: var(--cream-2); }
        .ops__privacy p { font-size: var(--fs-sm); line-height: 1.7; color: var(--ink-2); max-width: 70ch; }
        .ops__privacy code { font-size: 0.85em; background: var(--white); padding: 1px 5px; border-radius: 4px; border: 1px solid var(--line); }
        .ops__cities { width: 100%; border-collapse: collapse; font-size: var(--fs-sm); }
        .ops__cities th, .ops__cities td {
          text-align: right; padding: var(--s-2) var(--s-3);
          border-bottom: 1px solid var(--line);
        }
        .ops__cities thead th {
          font-size: var(--fs-xs); font-weight: 600; color: var(--ink-3);
          letter-spacing: .06em; text-transform: uppercase;
        }
        .ops__cities th:first-child, .ops__cities thead th:first-child { text-align: left; }
        .ops__cities tbody th { font-weight: 600; }
        .ops__cities td { font-variant-numeric: tabular-nums; color: var(--ink-2); }
        .ops__note { margin-top: var(--s-4); font-size: var(--fs-xs); line-height: 1.6; color: var(--ink-3); }
      `}</style>
    </main>
  );
}
