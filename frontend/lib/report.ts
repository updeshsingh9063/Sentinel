import { createClient } from "@/lib/supabase/server";

/**
 * The weekly report, assembled from what the model actually produced.
 *
 * EVERY FIGURE ON THE PAGE COMES FROM A ROW. Nothing here is illustrative and
 * nothing is interpolated. That is not fussiness: the one thing that would
 * discredit the whole system in front of a reviewer is a plausible number
 * nobody measured, sitting next to real ones in the same typeface. Where the
 * data does not exist, the report says so instead of filling the gap.
 *
 * Two of the panels people usually ask for are therefore missing. There is no
 * sleep-hours figure and no activity level, because no table records either.
 * What the system does know about sleep is whether a senior MENTIONED it on a
 * call, which the cue extractor picks up, so that is what the report shows —
 * "mentioned poor sleep on 2 days", not "6.8 hrs/night".
 *
 * EVERY QUERY RUNS AS THE SIGNED-IN USER, through the anon key and RLS. There
 * is no service-role client in this path on purpose, and the family loader at
 * the bottom is a SEPARATE function reading separate tables rather than this
 * one with columns stripped out. A filter can be forgotten; a policy that
 * returns nothing cannot be. See backend/supabase/migrations/0002_rls.sql:
 * family has no policy on vitals, call_notes or note_cues at all.
 */

/* ---- shapes ------------------------------------------------------------- */

export interface ReportWeek {
  start: string;
  end: string;
  label: string;
}

export interface MoodDay {
  date: string;
  weekday: string;
  /** 1 better · 2 same · 3 worse. Null when the senior did not answer. */
  feeling: number | null;
  pain: number | null;
  answered: boolean;
}

export interface VitalPoint {
  date: string;
  systolic: number | null;
  diastolic: number | null;
  pulse: number | null;
  spo2: number | null;
  weight: number | null;
  glucose: number | null;
}

export interface DrugAdherence {
  drug: string;
  taken: number;
  due: number;
  /** True when the drug was missed every single time it was due. */
  alwaysMissed: boolean;
}

export interface CueRollup {
  cue: string;
  days: number;
  lastSeen: string;
  /** The senior's own words, as transcribed. The code is a lossy summary. */
  evidence: string;
}

export interface CallNote {
  date: string;
  reached: boolean;
  text: string;
  lang: string;
}

export interface ScorePoint {
  date: string;
  /** 0–100, presented as wellbeing: 100 minus the day's risk. */
  health: number;
  rules: number;
  baseline: number;
  ml: number;
  nlp: number;
}

export interface WeeklyReport {
  state: "ok" | "not-found" | "no-data";
  senior: {
    id: string;
    name: string;
    age: number | null;
    sex: string | null;
    city: string | null;
    language: string | null;
    phone: string | null;
  };
  week: ReportWeek;
  /** Mean wellbeing across the week, 0–100, and the change on the week before. */
  health: { score: number; delta: number | null; series: ScorePoint[] };
  mood: MoodDay[];
  reach: { answered: number; of: number };
  vitals: { series: VitalPoint[]; latest: VitalPoint | null; readings: number };
  adherence: { taken: number; due: number; byDrug: DrugAdherence[] };
  cues: CueRollup[];
  notes: CallNote[];
  alert: {
    raisedOn: string;
    reason: string;
    nextStep: string;
    status: string;
  } | null;
}

/* ---- helpers ------------------------------------------------------------ */

const DAY = 86_400_000;

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** The seven days ending on `end`, inclusive. */
export function weekOf(end: string): ReportWeek {
  const endDate = new Date(`${end}T00:00:00Z`);
  const startDate = new Date(endDate.getTime() - 6 * DAY);
  return { start: isoDay(startDate), end: isoDay(endDate), label: "" };
}

export function weekLabel(week: ReportWeek, lang: string): string {
  const locale = lang === "hi" ? "hi-IN" : "en-IN";
  const long = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  const short = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  return `${short.format(new Date(`${week.start}T00:00:00Z`))} – ${long.format(
    new Date(`${week.end}T00:00:00Z`),
  )}`;
}

function weekdayNames(lang: string, week: ReportWeek): { date: string; weekday: string }[] {
  const locale = lang === "hi" ? "hi-IN" : "en-IN";
  const fmt = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
  const out: { date: string; weekday: string }[] = [];
  const start = new Date(`${week.start}T00:00:00Z`);
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(start.getTime() + i * DAY);
    out.push({ date: isoDay(d), weekday: fmt.format(d) });
  }
  return out;
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Risk runs 0–1 where high is bad. People read a wellbeing score the other way
 * round, so it is inverted once, here, and never again further down.
 */
function toHealth(risk: number): number {
  return Math.round((1 - risk) * 100);
}

/* ---- the coordinator's report ------------------------------------------- */

export async function loadWeeklyReport(
  seniorId: string,
  lang: string,
  endDate?: string,
): Promise<WeeklyReport> {
  const supabase = await createClient();

  const { data: senior } = await supabase
    .from("seniors")
    .select("id, display_name, age, sex, city, language, phone")
    .eq("id", seniorId)
    .maybeSingle();

  const blank = (state: WeeklyReport["state"]): WeeklyReport => ({
    state,
    senior: {
      id: seniorId,
      name: senior?.display_name ?? "",
      age: senior?.age ?? null,
      sex: senior?.sex ?? null,
      city: senior?.city ?? null,
      language: senior?.language ?? null,
      phone: senior?.phone ?? null,
    },
    week: { start: "", end: "", label: "" },
    health: { score: 0, delta: null, series: [] },
    mood: [],
    reach: { answered: 0, of: 7 },
    vitals: { series: [], latest: null, readings: 0 },
    adherence: { taken: 0, due: 0, byDrug: [] },
    cues: [],
    notes: [],
    alert: null,
  });

  // No row means no care assignment, which is RLS doing its job rather than a
  // missing senior. The caller shows the same thing either way.
  if (!senior) return blank("not-found");

  // Default to the most recent day this senior was actually scored, not to
  // today: the cohort is a fixed window, and defaulting to today would give a
  // reviewer an empty report on a system that has data.
  let end = endDate;
  if (!end) {
    const { data: last } = await supabase
      .from("risk_scores")
      .select("scored_on")
      .eq("senior_id", seniorId)
      .order("scored_on", { ascending: false })
      .limit(1)
      .maybeSingle();
    end = last?.scored_on;
  }
  if (!end) return blank("no-data");

  const week = weekOf(end);
  week.label = weekLabel(week, lang);
  // The seven days before this week, for the "up 6 from last week" figure.
  const prior = weekOf(isoDay(new Date(new Date(`${week.start}T00:00:00Z`).getTime() - DAY)));

  const [scores, priorScores, checkins, vitals, meds, cues, notes, alerts] =
    await Promise.all([
      supabase
        .from("risk_scores")
        .select("scored_on, score, rules_score, baseline_score, ml_score, nlp_score")
        .eq("senior_id", seniorId)
        .gte("scored_on", week.start)
        .lte("scored_on", week.end)
        .order("scored_on"),
      supabase
        .from("risk_scores")
        .select("score")
        .eq("senior_id", seniorId)
        .gte("scored_on", prior.start)
        .lte("scored_on", prior.end),
      supabase
        .from("checkins")
        .select("checked_on, answered, feeling_code, pain_code, meds_taken")
        .eq("senior_id", seniorId)
        .gte("checked_on", week.start)
        .lte("checked_on", week.end),
      supabase
        .from("vitals")
        .select(
          "measured_on, systolic_bp, diastolic_bp, pulse_bpm, spo2_pct, weight_kg, glucose_mgdl",
        )
        .eq("senior_id", seniorId)
        .gte("measured_on", week.start)
        .lte("measured_on", week.end)
        .order("measured_on"),
      supabase
        .from("medication_logs")
        .select("due_on, drug_name, taken")
        .eq("senior_id", seniorId)
        .gte("due_on", week.start)
        .lte("due_on", week.end),
      supabase
        .from("note_cues")
        .select("observed_on, cue, negated, confidence, span_text")
        .eq("senior_id", seniorId)
        .gte("observed_on", week.start)
        .lte("observed_on", week.end)
        .order("observed_on", { ascending: false }),
      supabase
        .from("call_notes")
        .select("called_on, reached, note_text, note_lang")
        .eq("senior_id", seniorId)
        .gte("called_on", week.start)
        .lte("called_on", week.end)
        .order("called_on", { ascending: false }),
      supabase
        .from("alerts")
        .select("raised_on, reason_text, next_step, status")
        .eq("senior_id", seniorId)
        .gte("raised_on", week.start)
        .lte("raised_on", week.end)
        .order("raised_on", { ascending: false })
        .limit(1),
    ]);

  const scoreRows = scores.data ?? [];
  if (!scoreRows.length) return blank("no-data");

  const series: ScorePoint[] = scoreRows.map((r) => ({
    date: r.scored_on,
    health: toHealth(Number(r.score)),
    rules: Number(r.rules_score ?? 0),
    baseline: Number(r.baseline_score ?? 0),
    ml: Number(r.ml_score ?? 0),
    nlp: Number(r.nlp_score ?? 0),
  }));

  const thisWeekMean = mean(scoreRows.map((r) => Number(r.score)));
  const lastWeekMean = mean((priorScores.data ?? []).map((r) => Number(r.score)));
  const score = thisWeekMean === null ? 0 : toHealth(thisWeekMean);
  // Positive delta = better this week. Inverting risk flips the sign too.
  const delta =
    thisWeekMean === null || lastWeekMean === null
      ? null
      : toHealth(thisWeekMean) - toHealth(lastWeekMean);

  const byDate = new Map((checkins.data ?? []).map((c) => [c.checked_on, c]));
  const mood: MoodDay[] = weekdayNames(lang, week).map(({ date, weekday }) => {
    const row = byDate.get(date);
    return {
      date,
      weekday,
      feeling: row?.answered ? (row.feeling_code ?? null) : null,
      pain: row?.answered ? (row.pain_code ?? null) : null,
      answered: Boolean(row?.answered),
    };
  });

  const vitalSeries: VitalPoint[] = (vitals.data ?? []).map((v) => ({
    date: v.measured_on,
    systolic: v.systolic_bp === null ? null : Number(v.systolic_bp),
    diastolic: v.diastolic_bp === null ? null : Number(v.diastolic_bp),
    pulse: v.pulse_bpm === null ? null : Number(v.pulse_bpm),
    spo2: v.spo2_pct === null ? null : Number(v.spo2_pct),
    weight: v.weight_kg === null ? null : Number(v.weight_kg),
    glucose: v.glucose_mgdl === null ? null : Number(v.glucose_mgdl),
  }));

  // Per drug, not just an overall percentage. "92% adherence" and "one of two
  // drugs never taken" can be the same number, and only the second is
  // actionable — it names the conversation the coordinator needs to have.
  const drugMap = new Map<string, { taken: number; due: number }>();
  for (const m of meds.data ?? []) {
    const row = drugMap.get(m.drug_name) ?? { taken: 0, due: 0 };
    row.due += 1;
    if (m.taken) row.taken += 1;
    drugMap.set(m.drug_name, row);
  }
  const byDrug: DrugAdherence[] = [...drugMap.entries()]
    .map(([drug, v]) => ({ drug, ...v, alwaysMissed: v.due > 0 && v.taken === 0 }))
    .sort((a, b) => a.taken / a.due - b.taken / b.due);

  // A negated cue is the senior saying the thing did NOT happen ("gire nahi" —
  // did not fall). Counting those as concerns would invert the meaning.
  const cueMap = new Map<string, CueRollup>();
  for (const c of cues.data ?? []) {
    if (c.negated) continue;
    const existing = cueMap.get(c.cue);
    if (existing) {
      existing.days += 1;
    } else {
      cueMap.set(c.cue, {
        cue: c.cue,
        days: 1,
        lastSeen: c.observed_on,
        evidence: c.span_text ?? "",
      });
    }
  }

  return {
    state: "ok",
    senior: {
      id: senior.id,
      name: senior.display_name,
      age: senior.age ?? null,
      sex: senior.sex ?? null,
      city: senior.city ?? null,
      language: senior.language ?? null,
      phone: senior.phone ?? null,
    },
    week,
    health: { score, delta, series },
    mood,
    reach: { answered: mood.filter((m) => m.answered).length, of: 7 },
    vitals: {
      series: vitalSeries,
      latest: vitalSeries.length ? vitalSeries[vitalSeries.length - 1] : null,
      readings: vitalSeries.length,
    },
    adherence: {
      taken: (meds.data ?? []).filter((m) => m.taken).length,
      due: (meds.data ?? []).length,
      byDrug,
    },
    cues: [...cueMap.values()].sort((a, b) => b.days - a.days),
    notes: (notes.data ?? []).map((n) => ({
      date: n.called_on,
      reached: n.reached,
      text: n.note_text ?? "",
      lang: n.note_lang ?? "en",
    })),
    alert: alerts.data?.length
      ? {
          raisedOn: alerts.data[0].raised_on,
          reason: alerts.data[0].reason_text ?? "",
          nextStep: alerts.data[0].next_step ?? "",
          status: alerts.data[0].status ?? "open",
        }
      : null,
  };
}

/* ---- the family's report ------------------------------------------------ */

export interface FamilyReport {
  state: "ok" | "no-link" | "no-summary";
  senior: { id: string; name: string };
  week: ReportWeek;
  /** Published, safety-checked prose. Not generated here and not editable here. */
  headline: string;
  body: string[];
  /**
   * Deliberately the only structured figure a family member gets: how often
   * the daily check-in was answered. It carries no health reading, and a
   * stretch of unanswered days is the one pattern a family can usefully act
   * on themselves — by picking up the phone.
   */
  reach: { answered: number; of: number } | null;
  /** The same seven days, so the pattern is visible and not just counted. */
  days: { date: string; weekday: string; answered: boolean; known: boolean }[];
}

export async function loadFamilyReport(
  seniorId: string,
  lang: string,
): Promise<FamilyReport> {
  const supabase = await createClient();

  const empty = (state: FamilyReport["state"]): FamilyReport => ({
    state,
    senior: { id: seniorId, name: "" },
    week: { start: "", end: "", label: "" },
    headline: "",
    body: [],
    reach: null,
    days: [],
  });

  const { data: links } = await supabase
    .from("family_links")
    .select("senior_id")
    .eq("senior_id", seniorId);
  if (!links?.length) return empty("no-link");

  const { data: senior } = await supabase
    .from("seniors")
    .select("id, display_name")
    .eq("id", seniorId)
    .maybeSingle();
  if (!senior) return empty("no-link");

  const { data: summary } = await supabase
    .from("family_summaries")
    .select("summary_text, covers_on")
    .eq("senior_id", seniorId)
    .order("covers_on", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!summary) {
    return { ...empty("no-summary"), senior: { id: senior.id, name: senior.display_name } };
  }

  const week = weekOf(summary.covers_on);
  week.label = weekLabel(week, lang);

  const paras = summary.summary_text
    .split(/\n{2,}/)
    .map((p: string) => p.trim())
    .filter(Boolean);

  // family_checkin_days, NOT checkins. The base table is coordinator-only and
  // returns nothing here — querying it was a bug that silently produced an
  // empty panel. The view exposes three columns (senior_id, checked_on,
  // answered) and carries its own authorisation, so a family member learns
  // whether the phone was answered and nothing about the answers. See
  // backend/supabase/migrations/0006_family_checkin_view.sql.
  const { data: checkins } = await supabase
    .from("family_checkin_days")
    .select("checked_on, answered")
    .eq("senior_id", seniorId)
    .gte("checked_on", week.start)
    .lte("checked_on", week.end);

  const seen = new Map((checkins ?? []).map((c) => [c.checked_on, c.answered]));
  const days = weekdayNames(lang, week).map(({ date, weekday }) => ({
    date,
    weekday,
    answered: seen.get(date) === true,
    // A day with no row at all is not the same as a call that went
    // unanswered, and the strip draws them differently.
    known: seen.has(date),
  }));

  return {
    state: "ok",
    senior: { id: senior.id, name: senior.display_name },
    week,
    headline: paras[0] ?? "",
    body: paras.slice(1),
    reach: checkins?.length
      ? { answered: days.filter((d) => d.answered).length, of: 7 }
      : null,
    days,
  };
}
