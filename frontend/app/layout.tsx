import type { Metadata } from "next";
import { Caveat, IBM_Plex_Sans_Devanagari, Inter, Newsreader } from "next/font/google";

import { getCopy, getLang } from "@/lib/i18n-server";

import "../styles/globals.css";

/**
 * Newsreader carries every headline, Inter every piece of running text, Caveat
 * the one handwritten line in the hero, and Plex Sans Devanagari the Hindi in
 * the language switch.
 */
const display = Newsreader({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-display",
  display: "swap",
});

const sans = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

const script = Caveat({
  subsets: ["latin"],
  weight: ["400", "600"],
  variable: "--font-script",
  display: "swap",
});

const deva = IBM_Plex_Sans_Devanagari({
  subsets: ["devanagari"],
  weight: ["400", "500"],
  variable: "--font-deva",
  display: "swap",
});

// Title and description follow the language cookie: a Hindi page whose
// <meta description> is English is the version a search engine indexes.
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getCopy();
  return { title: t.meta.title, description: t.meta.description };
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // The language lives in a cookie and the page is server-rendered, so <html
  // lang> is correct in the markup itself — no flash, and a screen reader
  // picks the right pronunciation from the first paint.
  const lang = await getLang();

  return (
    // suppressHydrationWarning is here for ONE reason: browser extensions
    // write their own attributes onto <html> before React hydrates (a launcher
    // extension adding crxlauncher="" is what prompted this), and React reports
    // the difference as a mismatch even though the page is correct.
    //
    // It is safe because the flag only applies one level deep — this element's
    // own attributes. A genuine mismatch inside any component still reports
    // normally, so this hides an extension's noise, not our bugs.
    <html
      lang={lang}
      suppressHydrationWarning
      className={`${display.variable} ${sans.variable} ${script.variable} ${deva.variable}`}
    >
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <div id="main">{children}</div>
      </body>
    </html>
  );
}
