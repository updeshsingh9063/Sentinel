import { cookies } from "next/headers";

import { COPY, LANG_COOKIE, type Copy, type Lang, isLang } from "./i18n";
import { APP_COPY, type AppCopy } from "./i18n-app";

/**
 * Server-only language lookup.
 *
 * Kept apart from lib/i18n.ts because this imports next/headers, which cannot
 * reach a client bundle. The switch component needs the cookie name and the
 * Lang type, so those live in i18n.ts and this file holds only the read.
 */

export async function getLang(): Promise<Lang> {
  const store = await cookies();
  const value = store.get(LANG_COOKIE)?.value;
  return isLang(value) ? value : "en";
}

/** The language and its landing copy together, since every caller wants both. */
export async function getCopy(): Promise<{ lang: Lang; t: Copy }> {
  const lang = await getLang();
  return { lang, t: COPY[lang] };
}

/** The same, for the signed-in surfaces. */
export async function getAppCopy(): Promise<{ lang: Lang; t: AppCopy }> {
  const lang = await getLang();
  return { lang, t: APP_COPY[lang] };
}
