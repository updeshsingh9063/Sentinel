import { createClient } from "@/lib/supabase/server";

/**
 * The day's calls: who the system decided to ring, when, and why.
 *
 * THIS IS THE "WITHOUT ASKING" HALF. The ranked worklist answers "who should a
 * coordinator worry about". This answers a different question — "who has gone
 * quiet" — and the two have different answers. Somebody whose vitals are fine
 * and who has not picked up the phone in four days does not rank highly on
 * concern and is exactly who you want to ring.
 *
 * Every row carries its own sentence of reasoning, written by the planner in
 * SQL, because a schedule that cannot say why it rang somebody is a schedule
 * nobody can argue with.
 */

export type CallReason = "daily" | "medicine" | "welfare" | "follow_up" | "company";
export type CallOutcome = "planned" | "reached" | "no_answer" | "skipped";

export interface PlannedCall {
  id: number;
  seniorId: string;
  name: string;
  initials: string;
  dueAt: string;
  reason: CallReason;
  why: string;
  outcome: CallOutcome;
  attempts: number;
}

export interface CallDay {
  day: string;
  /** How many of each kind, including the routine ones not listed. */
  tally: Record<CallReason, number>;
  /** The calls with a reason beyond "it is their usual time", worst first. */
  notable: PlannedCall[];
  /** How many notable calls were left off the list below the cap. */
  moreNotable: number;
  total: number;
}

/**
 * How many non-routine calls to LIST.
 *
 * The system places all of them; this is only how many a coordinator is shown
 * at once. The same reasoning as the alert budget on the worklist: a list
 * nobody can read to the bottom is a list nobody reads, and thirty-five rows
 * each asking for a tick is work the product exists to remove rather than
 * create. The rest are placed, counted in the tally above, and surface here
 * only if they go unanswered.
 */
const SHOW_NOTABLE = 12;

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0] ?? "")
    .join("")
    .toUpperCase();
}

/** The real calendar day. A plan is about now, not about the cohort's window. */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function loadCallDay(day: string = today()): Promise<CallDay> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("call_plan")
    .select("id, senior_id, due_at, reason, why, outcome, attempts")
    .eq("planned_on", day)
    .order("due_at", { ascending: true })
    .limit(500);

  const rows = data ?? [];
  const tally: Record<CallReason, number> = {
    daily: 0,
    medicine: 0,
    welfare: 0,
    follow_up: 0,
    company: 0,
  };
  for (const r of rows) tally[r.reason as CallReason] += 1;

  // Routine calls are counted but not listed. Forty-five rows that all say
  // "their usual daily call" is a wall, and the five that say something else
  // are what a coordinator came to this page to find.
  const notableRows = rows.filter((r) => r.reason !== "daily");
  const ids = [...new Set(notableRows.map((r) => r.senior_id as string))];

  let nameById = new Map<string, string>();
  if (ids.length) {
    const { data: seniors } = await supabase
      .from("seniors")
      .select("id, display_name")
      .in("id", ids);
    nameById = new Map((seniors ?? []).map((s) => [s.id as string, s.display_name as string]));
  }

  // Worst first: somebody nobody has reached outranks a reminder about pills.
  const weight: Record<CallReason, number> = {
    welfare: 0,
    medicine: 1,
    follow_up: 2,
    company: 3,
    daily: 4,
  };

  const notable: PlannedCall[] = notableRows
    .map((r) => {
      const name = nameById.get(r.senior_id as string) ?? "";
      return {
        id: r.id as number,
        seniorId: r.senior_id as string,
        name,
        initials: initials(name),
        dueAt: String(r.due_at).slice(0, 5),
        reason: r.reason as CallReason,
        why: r.why as string,
        outcome: r.outcome as CallOutcome,
        attempts: (r.attempts as number) ?? 0,
      };
    })
    .sort(
      (a, b) =>
        weight[a.reason] - weight[b.reason] ||
        b.attempts - a.attempts ||
        a.dueAt.localeCompare(b.dueAt),
    );

  return {
    day,
    tally,
    notable: notable.slice(0, SHOW_NOTABLE),
    moreNotable: Math.max(notable.length - SHOW_NOTABLE, 0),
    total: rows.length,
  };
}

/**
 * The handful of seniors furthest from their own normal, whether or not a
 * call was planned for them. This is the evidence behind the plan: a
 * coordinator who cannot see the numbers has no reason to believe the
 * reasoning built on them.
 */
export interface Deviation {
  seniorId: string;
  name: string;
  usualSteps: number | null;
  stepsToday: number | null;
  pct: number | null;
  missedWeek: number;
  medsConfirmed: boolean | null;
  lastAnswered: string | null;
}

export async function loadDeviations(limit = 6): Promise<Deviation[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("routine_deviation")
    .select(
      "senior_id, display_name, usual_steps, steps_today, steps_pct_of_usual, missed_calls_week, meds_last_confirmed, last_answered",
    )
    .not("steps_pct_of_usual", "is", null)
    .order("steps_pct_of_usual", { ascending: true })
    .limit(limit);

  return (data ?? []).map((d) => ({
    seniorId: d.senior_id as string,
    name: (d.display_name as string) ?? "",
    usualSteps: (d.usual_steps as number | null) ?? null,
    stepsToday: (d.steps_today as number | null) ?? null,
    pct: (d.steps_pct_of_usual as number | null) ?? null,
    missedWeek: (d.missed_calls_week as number) ?? 0,
    medsConfirmed: (d.meds_last_confirmed as boolean | null) ?? null,
    lastAnswered: (d.last_answered as string | null) ?? null,
  }));
}
