import { FamilySummaryView } from "@/components/app/FamilySummaryView";
import { loadFamilyView } from "@/lib/family";
import { getAppCopy } from "@/lib/i18n-server";

/**
 * A family member is normally linked to exactly one senior, so this resolves
 * the link and renders that summary rather than asking them to pick from a
 * list they should not be able to see in the first place.
 *
 * The link comes from family_links, which RLS limits to the signed-in user's
 * own rows — an unlinked account gets nothing rather than someone else's
 * relative.
 */

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const { t } = await getAppCopy();
  return { title: `${t.titles.summary} · Samarth Sentinel` };
}

export default async function FamilySummaryIndex() {
  const { lang, t } = await getAppCopy();
  const view = await loadFamilyView(t, lang);
  return <FamilySummaryView view={view} t={t} />;
}
