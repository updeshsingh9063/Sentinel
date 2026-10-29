import type { AppCopy } from "@/lib/i18n-app";
import { createClient } from "@/lib/supabase/server";
import type { Level, WorklistReason } from "@/lib/worklist";

/**
 * One senior's record, read from the cohort.
 *
 * THE BAND IS COMPUTED, NOT STORED. The brief says twice that change from a
 * senior's own baseline matters more than a population threshold, so the
 * chart draws that person's own rolling median plus a MAD-scaled band — the
 * same robust statistic model/samarth_model/scoring/baseline.py uses, for the
 * same reason: one bad cuff reading should not move the band it is being
 * judged against. A mean and a standard deviation would let the outlier widen
 * the band and hide itself.
 *
 * THE BAND EXCLUDES TODAY. It is built from the readings BEFORE the day being
 * judged, because a band that includes today's value has already absorbed the
 * thing it is supposed to detect. That is the same shift(1) rule the feature
 * windows use, and the reason this page can honestly claim a reading was out
 * of range rather than merely unusual in hindsight.
 *
 * Gaps stay gaps. A day with no reading is null and the line breaks, because
 * a continuous line through missing data is a measurement nobody took.
 */

export interface DetailSeries {
  label: string;
  unit: string;
  days: string[];
  values: (number | null)[];
  /** [low, high] of the senior's own band, from the days before the last. */
  band: [number, number];
  /** Index of the first value outside the band, or -1. */
  breachAt: number;
}

export interface DetailCue {
  day: string;
  kind: string;
  quote: string;
  script: string;
  negated: boolean;
}

export interface DetailContact {
  day: string;
  channel: string;
  outcome: "answered" | "no answer" | "keypad";
  detail: string;
}

export interface RiskDay {
  date: string;
  /** 0-1, as stored. */
  score: number;
  level: Level;
  /** The strongest reason that day, already in the reader's language. */
  topReason: string;
  /** True when this day introduced a reason the previous day did not have. */
  isNew: boolean;
  /** True when an alert was actually surfaced to a coordinator. */
  alerted: boolean;
}

export interface FamilyInput {
  observedOn: string;
  text: string;
}

export interface SeniorRecord {
  state: "ok" | "not-found";
  id: string;
  name: string;
  age: number;
  city: string;
  score: number;
  level: Level;
  levelLabel: string;
  daysSinceContact: number;
  reasons: WorklistReason[];
  nextStep: string;
  /**
   * How the risk built up, day by day.
   *
   * The single most useful thing on this page for answering "why is this
   * person on my list today". A score on its own says a senior is concerning;
   * a fortnight of scores with the reason each day shows WHEN it started and
   * WHAT changed, which is the difference between a number and a story a
   * coordinator can act on.
   */
  timeline: RiskDay[];
  series: DetailSeries;
  adherence: { day: string; drug: string; taken: boolean }[];
  cues: DetailCue[];
  contacts: DetailContact[];
  /** What the family has reported. Their words, unedited. */
  familyNotes: FamilyInput[];
}

function levelFor(score: number): Level {
  return score >= 0.6 ? "high" : score >= 0.35 ? "med" : "low";
}

function parseReasons(raw: unknown, lang: string): WorklistReason[] {
  let v = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(v)) return [];
  return v
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r) => ({
      code: String(r.code ?? ""),
      text: String((lang === "hi" && r.text_hi) || r.text || ""),
      contribution: Number(r.contribution ?? 0),
    }))
    .filter((r) => r.text);
}

/** Median of a non-empty list. */
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Median absolute deviation, scaled to be comparable with a standard
 * deviation on normal data. The 1.4826 is the usual consistency constant.
 */
function mad(xs: number[], med: number): number {
  return 1.4826 * median(xs.map((x) => Math.abs(x - med)));
}

export async function loadSeniorRecord(
  seniorId: string,
  t: AppCopy,
  lang: string,
): Promise<SeniorRecord> {
  const supabase = await createClient();

  const blank: SeniorRecord = {
    state: "not-found",
    id: seniorId,
    name: "",
    age: 0,
    city: "",
    score: 0,
    level: "low",
    levelLabel: "",
    daysSinceContact: 0,
    reasons: [],
    nextStep: "",
    timeline: [],
    series: { label: "", unit: "", days: [], values: [], band: [0, 0], breachAt: -1 },
    adherence: [],
    cues: [],
    contacts: [],
    familyNotes: [],
  };

  const { data: senior } = await supabase
    .from("seniors")
    .select("id, display_name, age, city")
    .eq("id", seniorId)
    .maybeSingle();
  // No row means no care assignment, which is RLS answering rather than a
  // missing senior. The page says the same thing either way.
  if (!senior) return blank;

  // A fortnight of scores, not just today's. One query, same cost, and it is
  // what makes the progression visible.
  const { data: scoreRows } = await supabase
    .from("risk_scores")
    .select("scored_on, score, reasons")
    .eq("senior_id", seniorId)
    .order("scored_on", { ascending: false })
    .limit(14);

  const lastScore = scoreRows?.[0];
  const day = lastScore?.scored_on;
  const windowStart = day
    ? new Date(new Date(`${day}T00:00:00Z`).getTime() - 13 * 86_400_000)
        .toISOString()
        .slice(0, 10)
    : "1970-01-01";

  const [vitals, meds, cues, notes, checkins, alert, famNotes] = await Promise.all([
    supabase
      .from("vitals")
      .select("measured_on, systolic_bp")
      .eq("senior_id", seniorId)
      .gte("measured_on", windowStart)
      .order("measured_on"),
    supabase
      .from("medication_logs")
      .select("due_on, drug_name, taken")
      .eq("senior_id", seniorId)
      .gte("due_on", windowStart)
      .order("due_on"),
    supabase
      .from("note_cues")
      .select("observed_on, cue, negated, span_text")
      .eq("senior_id", seniorId)
      .gte("observed_on", windowStart)
      .order("observed_on", { ascending: false }),
    supabase
      .from("call_notes")
      .select("called_on, reached, note_text, note_lang")
      .eq("senior_id", seniorId)
      .gte("called_on", windowStart)
      .order("called_on", { ascending: false }),
    supabase
      .from("checkins")
      .select("checked_on, answered")
      .eq("senior_id", seniorId)
      .gte("checked_on", windowStart)
      .order("checked_on", { ascending: false }),
    supabase
      .from("alerts")
      .select("reason_text, next_step, next_step_hi, raised_on")
      .eq("senior_id", seniorId)
      .order("raised_on", { ascending: false })
      .limit(1)
      .maybeSingle(),
    // A coordinator reads these for their own seniors; see 0010.
    supabase
      .from("family_notes")
      .select("observed_on, note_text")
      .eq("senior_id", seniorId)
      .order("observed_on", { ascending: false })
      .limit(5),
  ]);

  // One continuous axis of days, so a missing reading is a visible hole
  // rather than two points drawn next to each other.
  const days: string[] = [];
  if (day) {
    for (let i = 13; i >= 0; i -= 1) {
      days.push(
        new Date(new Date(`${day}T00:00:00Z`).getTime() - i * 86_400_000)
          .toISOString()
          .slice(0, 10),
      );
    }
  }

  const sysByDay = new Map(
    (vitals.data ?? [])
      .filter((v) => v.systolic_bp !== null)
      .map((v) => [v.measured_on, Number(v.systolic_bp)]),
  );
  const values = days.map((d) => sysByDay.get(d) ?? null);

  // The band comes from everything before the final day, so the day being
  // judged is not part of what it is judged against.
  const prior = values.slice(0, -1).filter((v): v is number => v !== null);
  let band: [number, number] = [0, 0];
  if (prior.length >= 3) {
    const med = median(prior);
    const spread = mad(prior, med) || 1;
    band = [Math.round(med - 2 * spread), Math.round(med + 2 * spread)];
  }
  const breachAt = band[1] > band[0]
    ? values.findIndex((v) => v !== null && (v > band[1] || v < band[0]))
    : -1;

  const lastReached = (notes.data ?? []).find((n) => n.reached)?.called_on;
  const daysSinceContact = lastReached && day
    ? Math.max(
        0,
        Math.round(
          (new Date(`${day}T00:00:00Z`).getTime() -
            new Date(`${lastReached}T00:00:00Z`).getTime()) / 86_400_000,
        ),
      )
    : 99;

  const answeredByDay = new Map((checkins.data ?? []).map((c) => [c.checked_on, c.answered]));

  const contacts: DetailContact[] = (notes.data ?? []).slice(0, 8).map((n) => ({
    day: n.called_on,
    channel: t.senior.channelCall,
    outcome: n.reached ? "answered" : "no answer",
    detail: n.reached ? (n.note_text ?? "") : t.senior.noAnswerDetail,
  }));
  // Check-in days with no call note are still contact attempts, and a run of
  // unanswered ones is exactly the pattern worth seeing.
  for (const [d, answered] of answeredByDay) {
    if (!answered && !contacts.some((c) => c.day === d)) {
      contacts.push({
        day: d,
        channel: t.senior.channelCheckin,
        outcome: "no answer",
        detail: t.senior.noAnswerDetail,
      });
    }
  }
  contacts.sort((a, b) => (a.day < b.day ? 1 : -1));

  const score = Number(lastScore?.score ?? 0);
  const level = levelFor(score);

  // Oldest first, so it reads as a story rather than a changelog.
  const alertDays = new Set<string>(
    alert.data?.raised_on ? [alert.data.raised_on as string] : [],
  );
  const chrono = [...(scoreRows ?? [])].reverse();
  // Seen ACROSS the window, not just yesterday. A reason that flickers off
  // for a day and returns is the same fact, not a new one — comparing only
  // against the previous day reported "doses missed" four times in a
  // fortnight and turned the story back into a list.
  const seenCodes = new Set<string>();
  const timeline: RiskDay[] = chrono.map((row) => {
    const reasons = parseReasons(row.reasons, lang);
    // The sentence shown must be the reason that made this day NEW, not
    // whichever reason happened to score highest. Otherwise a day flagged
    // because loneliness first appeared gets labelled with the blood
    // pressure note that had already been there for a week — which reads as
    // the system repeating itself, and is the one thing a timeline must not
    // do.
    const firstNew = reasons.find((r) => !seenCodes.has(r.code));
    for (const r of reasons) seenCodes.add(r.code);
    const s = Number(row.score);
    return {
      date: row.scored_on as string,
      score: s,
      level: levelFor(s),
      topReason: (firstNew ?? reasons[0])?.text ?? "",
      isNew: Boolean(firstNew),
      alerted: alertDays.has(row.scored_on as string),
    };
  });

  return {
    state: "ok",
    id: senior.id,
    name: senior.display_name,
    age: senior.age ?? 0,
    city: senior.city ?? "",
    score,
    level,
    levelLabel: t.worklist.levels[level],
    daysSinceContact,
    reasons: parseReasons(lastScore?.reasons, lang),
    nextStep:
      (lang === "hi" && alert.data?.next_step_hi) || alert.data?.next_step || "",
    timeline,
    series: {
      label: t.senior.seriesSystolic,
      unit: "mmHg",
      days,
      values,
      band,
      breachAt,
    },
    adherence: (meds.data ?? []).map((m) => ({
      day: m.due_on,
      drug: m.drug_name,
      taken: Boolean(m.taken),
    })),
    cues: (cues.data ?? []).slice(0, 10).map((c) => ({
      day: c.observed_on,
      kind: c.cue,
      quote: c.span_text ?? "",
      script: "hinglish",
      negated: Boolean(c.negated),
    })),
    contacts: contacts.slice(0, 10),
    familyNotes: (famNotes.data ?? []).map((n) => ({
      observedOn: n.observed_on as string,
      text: n.note_text as string,
    })),
  };
}
