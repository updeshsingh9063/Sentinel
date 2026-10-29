import { AppBar, DemoNotice } from "@/components/app/AppBar";
import { getCurrentUser } from "@/lib/current-user";
import { getAppCopy } from "@/lib/i18n-server";

/**
 * The operations band, which a COORDINATOR is also allowed to open.
 *
 * That permission is deliberate — the view emits only aggregates, so there is
 * nothing here a coordinator should not see — but the layout used to ignore
 * it and render the operations navigation for everyone. A coordinator who
 * clicked "Operations" lost Today, Seniors and Reports from the bar and had
 * no link back to their own work: the only way out was the browser's back
 * button or signing out.
 *
 * So the bar follows the VIEWER, not the page. The role chip and the links
 * are whatever that person's own section uses, and operations is simply one
 * more entry in it.
 */
export default async function OpsLayout({ children }: { children: React.ReactNode }) {
  const { t } = await getAppCopy();
  const { role } = await getCurrentUser();

  const asCoordinator = role === "coordinator";

  return (
    <>
      <AppBar
        role={asCoordinator ? "coordinator" : "ops"}
        links={
          asCoordinator
            ? [
                { href: "/worklist", label: t.nav.today },
                { href: "/reports", label: t.nav.seniors },
                { href: "/dashboard", label: t.nav.operations },
              ]
            : [{ href: "/dashboard", label: t.nav.overview }]
        }
      />
      <DemoNotice>{t.notice.ops}</DemoNotice>
      {children}
    </>
  );
}
