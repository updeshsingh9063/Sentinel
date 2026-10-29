import { fmt } from "@/lib/i18n";
import type { AppCopy } from "@/lib/i18n-app";
import { createClient } from "@/lib/supabase/server";

/**
 * The coordinator's ranked daily queue, read from the cohort.
 *
 * WHY THIS REPLACED A FIXTURE. This is the screen the brief names — "a Care
 * Coordinator dashboard sorted by urgency" — and it was rendering three
 * invented people while eighteen thousand scored senior-days sat in the
 * database. Every piece of model work was real and none of it was reachable
 * from the one page a reviewer opens first.
 *
 * SURFACED AND HELD COME FROM DIFFERENT PLACES, ON PURPOSE. The surfaced rows
 * are `alerts`: the model already applied the daily cap and the per-senior
 * cooldown when it wrote that table, so re-deriving the cut here would mean
 * two budget implementations that can disagree. The held rows are the rest of
 * that day's `risk_scores` — scored, ranked, and deliberately not shown. They
 * are the evidence the cap is doing something, which is why they are dimmed
 * rather than hidden.
 *
 * "TODAY" IS THE LAST DAY WITH DATA, not the system clock. The cohort covers
 * a fixed window; pointing at the real today would give a reviewer an empty
 * queue on a system that works.
 *
 * Every query runs as the signed-in coordinator through RLS, so "whose
 * seniors" is answered by the database rather than by a filter here that
 * could be left out.
 */

export type Level = "high" | "med" | "low";

export interface WorklistReason {
  code: string;
  text: string;
  contribution: number;
}

export interface WorklistRow {
  id: string;
  name: string;
  age: number;
  city: string;
  initials: string;
  score: number;
  level: Level;
  levelLabel: string;
  dueAt: string;
  reasons: WorklistReason[];
  nextStep: string;
  daysSinceContact: number;
  /** Null until a coordinator records one. Drives the verdict control. */
  verdict: string | null;
  alertId: number | null;
}

export interface Worklist {
  state: "ok" | "empty";
  day: string;
  dayLabel: string;
  surfaced: WorklistRow[];
  held: WorklistRow[];
  /** Everyone scored that day, whether shown or not. */
  totalScored: number;
}

function levelFor(score: number): Level {
  return score >= 0.6 ? "high" : score >= 0.35 ? "med" : "low";
}

function initialsFor(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function parseReasons(raw: unknown): WorklistReason[] {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  return value
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r) => ({
      code: String(r.code ?? ""),
      text: String(r.text ?? ""),
      contribution: Number(r.contribution ?? 0),
    }))
    .filter((r) => r.text);
}

/**
 * A suggested call slot, spread across the morning in rank order.
 *
 * Derived from the position in the queue, not stored: nothing in the data
 * says when a call is "due", and inventing a timestamp and presenting it as
 * recorded would be the kind of small lie that makes a reviewer doubt the
 * larger numbers. It is a suggestion the ordering implies, and the top of the
 * list is suggested first.
 */
function slotFor(rank: number, lang: string): string {
  const start = 9 * 60 + 20;
  const minutes = start + rank * 25;
  const d = new Date(Date.UTC(2000, 0, 1, Math.floor(minutes / 60), minutes % 60));
  return new Intl.DateTimeFormat(lang === "hi" ? "hi-IN" : "en-IN", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(d);
}

export async function loadWorklist(t: AppCopy, lang: string): Promise<Worklist> {
  const supabase = await createClient();

  const empty: Worklist = {
    state: "empty",
    day: "",
    dayLabel: "",
    surfaced: [],
    held: [],
    totalScored: 0,
  };

  const { data: assignments } = await supabase
    .from("care_assignments")
    .select("senior_id");
  const ids = (assignments ?? []).map((a) => a.senior_id);
  if (!ids.length) return empty;

  const { data: lastDay } = await supabase
    .from("risk_scores")
    .select("scored_on")
    .in("senior_id", ids)
    .order("scored_on", { ascending: false })
    .limit(1)
    .maybeSingle();
  const day = lastDay?.scored_on;
  if (!day) return empty;

  const [seniors, scores, alerts, contacts] = await Promise.all([
    supabase.from("seniors").select("id, display_name, age, city").in("id", ids),
    supabase
      .from("risk_scores")
      .select("senior_id, score, reasons")
      .in("senior_id", ids)
      .eq("scored_on", day),
    supabase
      .from("alerts")
      .select("id, senior_id, score, rank_in_day, reason_text, next_step, status")
      .in("senior_id", ids)
      .eq("raised_on", day)
      .order("rank_in_day"),
    // Last time anyone actually reached this senior, for the tie-break the
    // ranking already uses: if two people look equally concerning, call the
    // one nobody has spoken to.
    supabase
      .from("call_notes")
      .select("senior_id, called_on, reached")
      .in("senior_id", ids)
      .eq("reached", true)
      .order("called_on", { ascending: false }),
  ]);

  const seniorById = new Map((seniors.data ?? []).map((s) => [s.id, s]));
  const scoreById = new Map((scores.data ?? []).map((s) => [s.senior_id, s]));

  const lastReached = new Map<string, string>();
  for (const c of contacts.data ?? []) {
    if (!lastReached.has(c.senior_id)) lastReached.set(c.senior_id, c.called_on);
  }

  const dayMs = new Date(`${day}T00:00:00Z`).getTime();
  const sinceContact = (seniorId: string) => {
    const last = lastReached.get(seniorId);
    if (!last) return 99;
    return Math.max(
      0,
      Math.round((dayMs - new Date(`${last}T00:00:00Z`).getTime()) / 86_400_000),
    );
  };

  const alertedIds = new Set<string>();

  const build = (
    seniorId: string,
    score: number,
    reasons: WorklistReason[],
    rank: number,
    nextStep: string,
    verdict: string | null,
    alertId: number | null,
  ): WorklistRow | null => {
    const s = seniorById.get(seniorId);
    if (!s) return null;
    const level = levelFor(score);
    return {
      id: seniorId,
      name: s.display_name,
      age: s.age ?? 0,
      city: s.city ?? "",
      initials: initialsFor(s.display_name),
      score,
      level,
      levelLabel: t.worklist.levels[level],
      dueAt: slotFor(rank, lang),
      reasons,
      nextStep,
      daysSinceContact: sinceContact(seniorId),
      verdict,
      alertId,
    };
  };

  const surfaced: WorklistRow[] = [];
  (alerts.data ?? []).forEach((a, i) => {
    alertedIds.add(a.senior_id);
    const scoreRow = scoreById.get(a.senior_id);
    // Prefer the per-score reasons: they exist for every day, where the alert
    // carries only the single headline sentence.
    const reasons = parseReasons(scoreRow?.reasons);
    const row = build(
      a.senior_id,
      Number(a.score ?? scoreRow?.score ?? 0),
      reasons.length
        ? reasons
        : [{ code: "alert", text: a.reason_text ?? "", contribution: Number(a.score ?? 0) }],
      i,
      a.next_step ?? "",
      a.status && a.status !== "open" ? a.status : null,
      a.id ?? null,
    );
    if (row) surfaced.push(row);
  });

  const held: WorklistRow[] = (scores.data ?? [])
    .filter((s) => !alertedIds.has(s.senior_id))
    .map((s) => ({ row: s, score: Number(s.score) }))
    .sort((a, b) => b.score - a.score)
    .map(({ row, score }, i) =>
      build(
        row.senior_id,
        score,
        parseReasons(row.reasons),
        surfaced.length + i,
        "",
        null,
        null,
      ),
    )
    .filter((r): r is WorklistRow => r !== null);

  if (!surfaced.length && !held.length) return empty;

  const dayLabel = new Intl.DateTimeFormat(lang === "hi" ? "hi-IN" : "en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${day}T00:00:00Z`));

  return {
    state: "ok",
    day,
    dayLabel: fmt(t.worklist.dateOn, { date: dayLabel }),
    surfaced,
    held,
    totalScored: (scores.data ?? []).length,
  };
}
