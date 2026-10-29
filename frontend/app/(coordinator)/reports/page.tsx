import Link from "next/link";

import { fmt } from "@/lib/i18n";
import { getAppCopy } from "@/lib/i18n-server";
import { createClient } from "@/lib/supabase/server";

/**
 * Every senior this coordinator is responsible for, with a link to each one's
 * weekly report.
 *
 * THIS IS THE FIRST COORDINATOR SURFACE READING THE REAL COHORT. The worklist
 * and the senior detail page still render lib/demo.ts fixtures, whose ids are
 * slugs ("savitri-devi"); the cohort in the database is keyed by uuid. The two
 * cannot link to each other until those pages are wired, so this page exists
 * to reach the reports in the meantime — and it is useful on its own, because
 * the worklist is deliberately capped and this is not.
 *
 * The list comes back through RLS: care_assignments only yields rows for the
 * signed-in coordinator, so the "whose seniors" question is answered by the
 * database rather than by a filter here that could be omitted.
 */

export async function generateMetadata() {
  const { t } = await getAppCopy();
  return { title: `${t.report.heading} · Samarth Sentinel` };
}

interface Row {
  id: string;
  name: string;
  age: number | null;
  city: string | null;
  score: number | null;
  scoredOn: string | null;
}

export default async function ReportsIndexPage() {
  const { lang, t } = await getAppCopy();
  const supabase = await createClient();

  const { data: assignments } = await supabase
    .from("care_assignments")
    .select("senior_id");

  const ids = (assignments ?? []).map((a) => a.senior_id);

  // Three days back covers a senior whose last score is not today's, without
  // dragging in the whole window.
  const { data: newest } = await supabase
    .from("risk_scores")
    .select("scored_on")
    .order("scored_on", { ascending: false })
    .limit(1)
    .maybeSingle();
  const scoreFloor = newest?.scored_on
    ? new Date(new Date(`${newest.scored_on}T00:00:00Z`).getTime() - 3 * 86_400_000)
        .toISOString()
        .slice(0, 10)
    : "1970-01-01";

  let rows: Row[] = [];
  if (ids.length) {
    const [seniors, scores] = await Promise.all([
      supabase
        .from("seniors")
        .select("id, display_name, age, city")
        .in("id", ids)
        .order("display_name"),
      // Only the most recent few days. This used to fetch every score for
      // every senior on the caseload — about a thousand rows — and then throw
      // all but the newest one per senior away.
      supabase
        .from("risk_scores")
        .select("senior_id, score, scored_on")
        .in("senior_id", ids)
        .gte("scored_on", scoreFloor)
        .order("scored_on", { ascending: false }),
    ]);

    // One score per senior: the most recent. The query returns every day, so
    // the first row seen per senior is already the latest.
    const latest = new Map<string, { score: number; scoredOn: string }>();
    for (const s of scores.data ?? []) {
      if (!latest.has(s.senior_id)) {
        latest.set(s.senior_id, { score: Number(s.score), scoredOn: s.scored_on });
      }
    }

    rows = (seniors.data ?? []).map((s) => ({
      id: s.id,
      name: s.display_name,
      age: s.age ?? null,
      city: s.city ?? null,
      score: latest.get(s.id)?.score ?? null,
      scoredOn: latest.get(s.id)?.scoredOn ?? null,
    }));
    // Most concerning first: this is a list someone works down.
    rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  }

  const level = (score: number | null) =>
    score === null ? "low" : score >= 0.6 ? "high" : score >= 0.35 ? "med" : "low";

  const dateFmt = new Intl.DateTimeFormat(lang === "hi" ? "hi-IN" : "en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

  return (
    <main className="page">
      <header className="page__head">
        <h1 className="page__title">{t.report.heading}</h1>
        <p className="page__sub">
          {fmt(t.report.sub, {})} {rows.length} seniors.
        </p>
      </header>

      {rows.length ? (
        <ul className="rl">
          {rows.map((row) => (
            <li key={row.id}>
              <Link href={`/senior/${row.id}/report`} className="rl__row">
                <span className="rl__name">{row.name}</span>
                <span className="rl__meta">
                  {row.age ?? "—"} · {row.city ?? "—"}
                </span>
                <span className={`pill pill--${level(row.score)} rl__pill`}>
                  {row.score === null ? t.report.noReading : row.score.toFixed(2)}
                </span>
                <span className="rl__date">
                  {row.scoredOn
                    ? dateFmt.format(new Date(`${row.scoredOn}T00:00:00Z`))
                    : "—"}
                </span>
                <span className="rl__go" aria-hidden="true">
                  &rarr;
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="page__sub">{t.report.notFoundBody}</p>
      )}

      <style>{`
        .rl { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-2); }
        .rl__row {
          display: grid;
          grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) auto auto 1.5rem;
          gap: var(--s-4); align-items: center;
          padding: var(--s-4) var(--s-5);
          background: var(--white); border: 1px solid var(--line);
          border-radius: var(--radius); text-decoration: none; color: inherit;
          transition: border-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
        }
        .rl__row:hover { border-color: var(--forest); box-shadow: var(--shadow-card); }
        .rl__name { font-weight: 600; }
        .rl__meta { font-size: var(--fs-sm); color: var(--ink-2); }
        .rl__pill { justify-self: start; font-variant-numeric: tabular-nums; }
        .rl__date { font-size: var(--fs-xs); color: var(--ink-3); }
        .rl__go { color: var(--ink-3); text-align: right; }
        .rl__row:hover .rl__go { color: var(--forest); }
        @media (max-width: 48rem) {
          .rl__row { grid-template-columns: 1fr auto; row-gap: var(--s-2); }
          .rl__meta, .rl__date { grid-column: 1 / -1; }
        }
      `}</style>
    </main>
  );
}
