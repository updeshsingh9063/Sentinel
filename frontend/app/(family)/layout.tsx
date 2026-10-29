import { AppBar, DemoNotice } from "@/components/app/AppBar";
import { getAppCopy } from "@/lib/i18n-server";

export default async function FamilyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { t } = await getAppCopy();

  return (
    <>
      <AppBar role="family" links={[{ href: "/summary", label: t.nav.thisWeek }]} />
      <DemoNotice>{t.notice.family}</DemoNotice>
      {children}
    </>
  );
}
