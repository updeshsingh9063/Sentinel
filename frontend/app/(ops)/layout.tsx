import { AppBar, DemoNotice } from "@/components/app/AppBar";
import { getAppCopy } from "@/lib/i18n-server";

export default async function OpsLayout({ children }: { children: React.ReactNode }) {
  const { t } = await getAppCopy();

  return (
    <>
      <AppBar role="ops" links={[{ href: "/dashboard", label: t.nav.overview }]} />
      <DemoNotice>{t.notice.ops}</DemoNotice>
      {children}
    </>
  );
}
