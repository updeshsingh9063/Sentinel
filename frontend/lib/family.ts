import { createClient } from "@/lib/supabase/server";

import type { AppCopy } from "@/lib/i18n-app";

/**
 * The family summary, read from the database.
 *
 * WHY THIS REPLACED A FIXTURE. The page used to render one hard-coded senior
 * for every family member who signed in, which meant a brand-new account with
 * no link saw a summary about someone it had no relationship with. The data
 * was invented so nothing real leaked, but the behaviour contradicted the
 * privacy claim the page itself makes — and anyone testing the product by
 * registering would have concluded the access control was broken.
 *
 * EVERY QUERY HERE RUNS AS THE SIGNED-IN USER, through the anon key and RLS.
 * There is no service-role client in this path on purpose: if the policies
 * were wrong, this code would return nothing rather than quietly working. The
 * absence of rows IS the access control, so the loader distinguishes "no
 * senior linked to you" from "linked, but nothing published yet" and says
 * which — an unexplained empty page reads like a bug.
 */

export interface FamilyConsent {
  scope: string;
  label: string;
  detail: string;
  granted: boolean;
}

export interface FamilyNoteRow {
  id: number;
  observedOn: string;
  text: string;
}

export interface FamilyView {
  state: "ok" | "no-link" | "no-summary";
  seniorId?: string;
  seniorName?: string;
  week?: string;
  headline?: string;
  body?: string[];
  consents: FamilyConsent[];
  /** What this family member has told the coordinator. Their own notes only. */
  notes: FamilyNoteRow[];
}

/** Scopes offered to a family member, in display order. */
const OFFERED = ["family_summary", "urgent_call", "visit_notice"];

function splitSummary(text: string): { headline: string; body: string[] } {
  const paras = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!paras.length) return { headline: "", body: [] };
  return { headline: paras[0], body: paras.slice(1) };
}

function formatWeek(covers: string, lang: string): string {
  const end = new Date(`${covers}T00:00:00Z`);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6);
  const fmt = new Intl.DateTimeFormat(lang === "hi" ? "hi-IN" : "en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const short = new Intl.DateTimeFormat(lang === "hi" ? "hi-IN" : "en-IN", {
    day: "numeric",
    timeZone: "UTC",
  });
  return `${short.format(start)}–${fmt.format(end)}`;
}

export async function loadFamilyView(
  t: AppCopy,
  lang: string,
  seniorId?: string,
): Promise<FamilyView> {
  const supabase = await createClient();

  const consentCopy = t.family.consents;
  const empty = (state: FamilyView["state"]): FamilyView => ({
    state,
    consents: [],
    notes: [],
  });

  // Which senior is this account linked to? RLS limits family_links to the
  // signed-in user's own rows, so this cannot return someone else's.
  const { data: links } = await supabase
    .from("family_links")
    .select("senior_id, is_primary");

  if (!links?.length) return empty("no-link");

  const chosen =
    (seniorId && links.find((l) => l.senior_id === seniorId)?.senior_id) ||
    links.find((l) => l.is_primary)?.senior_id ||
    links[0].senior_id;

  if (seniorId && chosen !== seniorId) return empty("no-link");

  // Identity only. No health column lives on this table, which is why a
  // family member is allowed to read it at all.
  const { data: senior } = await supabase
    .from("seniors")
    .select("id, display_name")
    .eq("id", chosen)
    .maybeSingle();

  if (!senior) return empty("no-link");

  const { data: consentRows } = await supabase
    .from("consents")
    .select("scope, granted")
    .eq("senior_id", chosen);

  const consents: FamilyConsent[] = OFFERED.filter((s) => consentCopy[s]).map((scope) => ({
    scope,
    label: consentCopy[scope].label,
    detail: consentCopy[scope].detail,
    granted: Boolean(consentRows?.find((c) => c.scope === scope)?.granted),
  }));

  // The policy on family_summaries already requires consent AND the
  // never-diagnose gate to have passed, so a row coming back here is a row a
  // family member is allowed to read. No second check is needed, and adding
  // one would imply the policy might be wrong.
  // Their own notes only — the read policy scopes to author_id = auth.uid(),
  // so one family member never sees another's.
  const { data: noteRows } = await supabase
    .from("family_notes")
    .select("id, observed_on, note_text")
    .eq("senior_id", chosen)
    .order("observed_on", { ascending: false })
    .limit(10);

  const notes = (noteRows ?? []).map((n) => ({
    id: n.id as number,
    observedOn: n.observed_on as string,
    text: n.note_text as string,
  }));

  const { data: summary } = await supabase
    .from("family_summaries")
    .select("summary_text, covers_on")
    .eq("senior_id", chosen)
    .order("covers_on", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!summary) {
    return {
      state: "no-summary",
      seniorId: senior.id,
      seniorName: senior.display_name,
      consents,
      notes,
    };
  }

  const { headline, body } = splitSummary(summary.summary_text);
  return {
    state: "ok",
    seniorId: senior.id,
    seniorName: senior.display_name,
    week: `${t.family.week} ${formatWeek(summary.covers_on, lang)}`,
    headline,
    body,
    consents,
    notes,
  };
}
