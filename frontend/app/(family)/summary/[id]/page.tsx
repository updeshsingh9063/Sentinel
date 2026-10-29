import { FamilySummaryView } from "@/components/app/FamilySummaryView";
import { loadFamilyView } from "@/lib/family";
import { getAppCopy } from "@/lib/i18n-server";

/**
 * Family-facing summary for one senior, for a family member linked to more
 * than one.
 *
 * The id in the URL is not the access control. RLS is: family_links only
 * returns this user's own rows, so an id they are not linked to resolves to
 * the "nothing is linked to you" state rather than someone else's summary.
 * Guessing an id here returns nothing.
 */

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const { t } = await getAppCopy();
  return { title: `${t.titles.summary} · Samarth Sentinel` };
}

export default async function FamilySummaryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { lang, t } = await getAppCopy();
  const view = await loadFamilyView(t, lang, id);
  return <FamilySummaryView view={view} t={t} />;
}
