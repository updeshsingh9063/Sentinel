import { createClient } from "@/lib/supabase/server";

/**
 * Errands: things a senior asked for that a person has to go and do.
 *
 * This is the half of the product that was missing. Everything else observes
 * somebody — scores them, ranks them, tells a coordinator who needs attention
 * — and never once fetches anybody anything. A senior whose medicines had run
 * out could say so on the daily call and the entire response was a note.
 *
 * READ AS THE SIGNED-IN COORDINATOR, through RLS, so "whose seniors" is
 * answered by the database rather than by a filter in here that could be left
 * out of one query and not another.
 *
 * NOT FILTERED BY THE COHORT'S "TODAY". The ranked worklist points at the last
 * day the model scored, because the cohort covers a fixed window. An errand is
 * not a score: it was raised by a person in real time and it is outstanding
 * until somebody finishes it, however many days that takes. Dating these to
 * the model's clock would hide a request raised this afternoon.
 */

export type RequestState = "open" | "arranged" | "confirmed" | "cancelled";

export interface AssistanceRequest {
  id: number;
  seniorId: string;
  name: string;
  initials: string;
  kind: string;
  urgent: boolean;
  said: string | null;
  summary: string;
  source: string;
  state: RequestState;
  raisedAt: string;
  arrangedNote: string | null;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0] ?? "")
    .join("")
    .toUpperCase();
}

/**
 * Everything still outstanding, worst first.
 *
 * Emergencies, then anything else urgent, then oldest first — because an
 * errand that has been sitting for three days is the one most likely to have
 * been forgotten, and a queue sorted newest-first quietly buries exactly
 * those.
 */
export async function loadOpenRequests(): Promise<AssistanceRequest[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("assistance_requests")
    .select("id, senior_id, kind, urgent, said, summary, source, state, created_at, arranged_note")
    .in("state", ["open", "arranged"])
    .order("created_at", { ascending: true })
    .limit(40);

  if (error || !data?.length) return [];

  const ids = [...new Set(data.map((r) => r.senior_id as string))];
  const { data: seniors } = await supabase
    .from("seniors")
    .select("id, display_name")
    .in("id", ids);

  const nameById = new Map(
    (seniors ?? []).map((s) => [s.id as string, s.display_name as string]),
  );

  const rows: AssistanceRequest[] = data.map((r) => {
    const name = nameById.get(r.senior_id as string) ?? "";
    return {
      id: r.id as number,
      seniorId: r.senior_id as string,
      name,
      initials: initials(name),
      kind: r.kind as string,
      urgent: r.urgent as boolean,
      said: (r.said as string | null) ?? null,
      summary: r.summary as string,
      source: r.source as string,
      state: r.state as RequestState,
      raisedAt: r.created_at as string,
      arrangedNote: (r.arranged_note as string | null) ?? null,
    };
  });

  const weight = (r: AssistanceRequest) => (r.kind === "emergency" ? 0 : r.urgent ? 1 : 2);
  return rows.sort((a, b) => weight(a) - weight(b) || a.raisedAt.localeCompare(b.raisedAt));
}

/**
 * How many were finished, and how many of those were confirmed rather than
 * merely arranged.
 *
 * The gap between the two is the number worth watching: "I have rung the
 * chemist" and "the medicines are in the house" are different facts, and a
 * product that reports the first as the second is lying to a daughter.
 */
export async function loadRequestTally(): Promise<{ confirmed: number; arranged: number }> {
  const supabase = await createClient();
  const [{ count: confirmed }, { count: arranged }] = await Promise.all([
    supabase
      .from("assistance_requests")
      .select("id", { count: "exact", head: true })
      .eq("state", "confirmed"),
    supabase
      .from("assistance_requests")
      .select("id", { count: "exact", head: true })
      .eq("state", "arranged"),
  ]);
  return { confirmed: confirmed ?? 0, arranged: arranged ?? 0 };
}
