import { ChatWidget } from "@/components/landing/ChatWidget";
import { Dashboard } from "@/components/landing/Dashboard";
import { Hero } from "@/components/landing/Hero";
import { Nav } from "@/components/landing/Nav";
import { Closing, Features, Impact, SiteFooter } from "@/components/landing/Sections";
import { getCopy } from "@/lib/i18n-server";

/**
 * Landing page.
 *
 * One hero, then calm sections that support it rather than compete with it:
 *
 *   hero → dashboard → features → impact → closing → footer
 *
 * Keep that order. The hero carries the whole claim; everything after it is
 * evidence, and each section is deliberately quieter than the one above.
 *
 * Photographs live in frontend/public/img (hero, impact, closing). Generation
 * prompts for every image and video are in docs/PROMPTS.md. A missing file
 * degrades to the section's own background rather than breaking the layout.
 *
 * The assistant sits above all of it as a fixed launcher. It is last in the
 * DOM on purpose: it is the least important thing on the page to reach by
 * keyboard, and nothing in the page depends on it loading.
 */
export default async function Home() {
  const { lang, t } = await getCopy();

  return (
    <>
      {/* The nav is fixed to the viewport, so it is a sibling of the sections
          rather than a child of the hero. Nested inside it, the hero's own
          `isolation: isolate` trapped the nav in a stacking context that every
          later section painted over — the dashboard mock came out on top of
          the header bar. A fixed overlay has to sit outside the thing it
          started over. */}
      <Nav />
      <Hero />
      <Dashboard />
      <Features />
      <Impact />
      <Closing />
      <SiteFooter />
      <ChatWidget lang={lang} t={t.chat} />
    </>
  );
}
