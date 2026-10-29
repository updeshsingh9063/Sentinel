import { ReportView } from "@/components/app/report/ReportView";
import { getAppCopy } from "@/lib/i18n-server";
import { loadWeeklyReport } from "@/lib/report";

/**
 * The coordinator's weekly report for one senior.
 *
 * Under the (coordinator) route group, so middleware has already established
 * the role before this renders — and RLS establishes it a second time, since
 * loadWeeklyReport queries as the signed-in user. A coordinator who is not
 * assigned to this senior gets the same empty result as a stranger.
 *
 * ?week=YYYY-MM-DD picks an earlier week. Without it the report covers the
 * last seven days this senior was actually scored, which is not the same as
 * the last seven days: the cohort is a fixed window, and defaulting to today
 * would show an empty report for a system that has data.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { lang, t } = await getAppCopy();
  const report = await loadWeeklyReport(id, lang);
  const who = report.senior.name || t.report.heading;
  return { title: `${who} · ${t.report.heading} · Samarth Sentinel` };
}

export default async function SeniorReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ week?: string }>;
}) {
  const { id } = await params;
  const { week } = await searchParams;
  const { lang, t } = await getAppCopy();

  const report = await loadWeeklyReport(id, lang, week);

  if (report.state !== "ok") {
    const title = report.state === "not-found" ? t.report.notFoundTitle : t.report.noDataTitle;
    const body = report.state === "not-found" ? t.report.notFoundBody : t.report.noDataBody;
    return (
      <main className="page page--narrow">
        <h1 className="page__title">{title}</h1>
        <p className="page__sub">{body}</p>
      </main>
    );
  }

  return <ReportView report={report} t={t} lang={lang} />;
}
