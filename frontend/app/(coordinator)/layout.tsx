import { AppBar, DemoNotice } from "@/components/app/AppBar";
import { getAppCopy } from "@/lib/i18n-server";

export default async function CoordinatorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { t } = await getAppCopy();

  return (
    <>
      <AppBar
        role="coordinator"
        links={[
          { href: "/worklist", label: t.nav.today },
          { href: "/senior/savitri-devi", label: t.nav.seniors },
          { href: "/dashboard", label: t.nav.operations },
        ]}
      />
      <DemoNotice />
      {children}
    </>
  );
}
