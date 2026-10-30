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
          { href: "/calls", label: t.nav.calls },
          // Not a hard-coded senior. It used to point at /senior/savitri-devi,
          // a fixture slug that stopped existing the moment this app started
          // reading the real cohort — so "Seniors" led to "not on your list".
          { href: "/reports", label: t.nav.seniors },
          { href: "/dashboard", label: t.nav.operations },
        ]}
      />
      <DemoNotice />
      {children}
    </>
  );
}
