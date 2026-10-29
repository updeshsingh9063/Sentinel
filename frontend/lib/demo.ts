/**
 * Demo cohort for the product surfaces.
 *
 * The synthetic cohort generator (200 seniors x 90 days) is still the blocking
 * piece of model work, and until it lands the API has nothing to serve. These
 * fixtures let the four surfaces render a realistic working state so the demo
 * is a product rather than an empty shell.
 *
 * Swap for the API, not for more fixtures: every shape here mirrors
 * lib/types.ts, which mirrors backend/app/schemas/core.py.
 *
 * TWO RULES EVERY STRING HERE KEEPS
 *  1. No reason, action or summary names a condition. They describe what
 *     changed and what a human should do. The never-diagnose gate enforces
 *     this server-side; fixtures must not model the wrong thing.
 *  2. A senior's own words are quoted verbatim and never interpreted.
 */

export type Level = "high" | "med" | "low";

export interface DemoReason {
  code: string;
  text: string;
  /** SHAP-style contribution, stored with the score so reasons survive. */
  contribution: number;
}

export interface DemoSenior {
  id: string;
  name: string;
  age: number;
  city: string;
  initials: string;
  score: number;
  level: Level;
  levelLabel: string;
  dueAt: string;
  reasons: DemoReason[];
  nextStep: string;
  daysSinceContact: number;
}

const LEVEL_LABEL: Record<Level, string> = {
  high: "High Risk",
  med: "Medium Risk",
  low: "Low Risk",
};

function level(score: number): Level {
  if (score >= 0.7) return "high";
  if (score >= 0.4) return "med";
  return "low";
}

function senior(
  s: Omit<DemoSenior, "level" | "levelLabel" | "initials">,
): DemoSenior {
  const lv = level(s.score);
  return {
    ...s,
    level: lv,
    levelLabel: LEVEL_LABEL[lv],
    initials: s.name
      .split(" ")
      .map((w) => w[0])
      .slice(0, 2)
      .join(""),
  };
}

/** The daily alert budget. Rows past it are scored but not surfaced. */
export const ALERT_BUDGET = 3;

export const COHORT: DemoSenior[] = [
  senior({
    id: "savitri-devi",
    name: "Savitri Devi",
    age: 72,
    city: "Lucknow",
    score: 0.87,
    dueAt: "9:20 AM",
    daysSinceContact: 2,
    reasons: [
      { code: "bp_above_baseline", text: "Systolic above her own 14-day median for six days running", contribution: 0.41 },
      { code: "dose_missed", text: "Two evening doses not logged this week", contribution: 0.26 },
      { code: "cue_dizziness", text: "Dizziness mentioned in a call note on Tuesday", contribution: 0.2 },
    ],
    nextStep: "Call this morning. Ask whether she has been standing up quickly, confirm the evening dose, and offer a nurse visit today.",
  }),
  senior({
    id: "ramesh-chandra",
    name: "Ramesh Chandra",
    age: 68,
    city: "Kanpur",
    score: 0.63,
    dueAt: "11:15 AM",
    daysSinceContact: 8,
    reasons: [
      { code: "no_contact", text: "Six calls unanswered; eight days since any contact", contribution: 0.38 },
      { code: "activity_down", text: "Activity down from his own weekday pattern", contribution: 0.15 },
      { code: "cue_poor_sleep", text: "Poor sleep mentioned twice this fortnight", contribution: 0.1 },
    ],
    nextStep: "Try the alternate number, then his daughter. If neither answers by noon, schedule a home visit.",
  }),
  senior({
    id: "kamla-bai",
    name: "Kamla Bai",
    age: 76,
    city: "Varanasi",
    score: 0.52,
    dueAt: "2:30 PM",
    daysSinceContact: 4,
    reasons: [
      { code: "weight_down", text: "Weight down 1.1 kg over 14 days", contribution: 0.3 },
      { code: "cue_low_appetite", text: "Appetite mentioned twice in call notes", contribution: 0.16 },
    ],
    nextStep: "Call for the daily check-in. Ask what she has eaten today and who is cooking.",
  }),
  senior({
    id: "abdul-rahman",
    name: "Abdul Rahman",
    age: 69,
    city: "Hyderabad",
    score: 0.24,
    dueAt: "—",
    daysSinceContact: 1,
    reasons: [{ code: "dose_missed", text: "Three evening doses unlogged", contribution: 0.18 }],
    nextStep: "No action today. Pattern is within his usual range for a working week.",
  }),
  senior({
    id: "joseph-dsouza",
    name: "Joseph D'Souza",
    age: 72,
    city: "Pune",
    score: 0.14,
    dueAt: "—",
    daysSinceContact: 2,
    reasons: [{ code: "stable", text: "No change from baseline", contribution: 0.04 }],
    nextStep: "No action today.",
  }),
  senior({
    id: "meena-pillai",
    name: "Meena Pillai",
    age: 68,
    city: "Kochi",
    score: 0.1,
    dueAt: "—",
    daysSinceContact: 3,
    reasons: [{ code: "stable", text: "No change from baseline", contribution: 0.02 }],
    nextStep: "No action today.",
  }),
];

export function findSenior(id: string): DemoSenior | undefined {
  return COHORT.find((s) => s.id === id);
}

/* ---- per-senior detail -------------------------------------------------- */

export interface Series {
  label: string;
  unit: string;
  /** null is a day with no reading. Drawn as a gap, never interpolated. */
  values: (number | null)[];
  /** Her own rolling median and MAD, computed excluding today. */
  band: [number, number];
  breachAt: number;
}

export interface CueEvent {
  day: string;
  kind: string;
  quote: string;
  script: string;
  note: string;
}

export interface ContactEvent {
  day: string;
  channel: string;
  outcome: "answered" | "no answer" | "keypad";
  detail: string;
}

export interface SeniorDetail {
  series: Series;
  adherence: { day: string; morning: boolean; evening: boolean }[];
  cues: CueEvent[];
  contacts: ContactEvent[];
}

const DETAIL: Record<string, SeniorDetail> = {
  "savitri-devi": {
    series: {
      label: "Systolic",
      unit: "mmHg",
      values: [128, 126, 131, 124, 129, 127, 125, 130, 136, 139, null, 145, 148, 151],
      band: [122, 134],
      breachAt: 8,
    },
    adherence: [
      { day: "Mon", morning: true, evening: true },
      { day: "Tue", morning: true, evening: false },
      { day: "Wed", morning: true, evening: true },
      { day: "Thu", morning: true, evening: false },
      { day: "Fri", morning: true, evening: true },
      { day: "Sat", morning: true, evening: true },
      { day: "Sun", morning: false, evening: true },
    ],
    cues: [
      {
        day: "Tue",
        kind: "Dizziness",
        quote: "chakkar aa raha hai",
        script: "चक्कर आ रहा है",
        note: "Said during the Tuesday check-in call. Quoted as spoken; not interpreted.",
      },
      {
        day: "Fri",
        kind: "Negated — no cue raised",
        quote: "aaj koi dard nahi",
        script: "आज कोई दर्द नहीं",
        note: "Negation detected, so no pain cue was raised. The phrase is kept for the human.",
      },
    ],
    contacts: [
      { day: "Today", channel: "Scheduled call", outcome: "no answer", detail: "Queued for 9:20 AM" },
      { day: "2 days ago", channel: "Coordinator call", outcome: "answered", detail: "Routine check-in, 4 min" },
      { day: "5 days ago", channel: "Phone check-in", outcome: "keypad", detail: "Pressed 2 — Waisa hi (same)" },
      { day: "7 days ago", channel: "Coordinator call", outcome: "no answer", detail: "No voicemail left" },
    ],
  },
};

export function findDetail(id: string): SeniorDetail | undefined {
  return DETAIL[id];
}

/* ---- family summary -----------------------------------------------------
   No vitals, no score, no cue list. A family member holds no database policy
   on those tables, so there is nothing here to leak even by mistake. */

export interface FamilySummary {
  seniorId: string;
  seniorName: string;
  week: string;
  headline: string;
  body: string[];
  doing: string;
  consents: { id: string; label: string; detail: string; granted: boolean }[];
}

export const FAMILY: FamilySummary = {
  seniorId: "savitri-devi",
  seniorName: "Savitri Devi",
  week: "Week of 7–13 April 2025",
  headline: "A quieter week than usual, and we have been in touch.",
  body: [
    "Savitri has been keeping her mornings as usual and answered our check-in call on Tuesday.",
    "A few evening medicine reminders went unlogged this week, so your coordinator is calling today to help get the evening routine back on track.",
    "Nothing here needs you to do anything right now. If that changes, we will call you directly rather than leave it in a summary.",
  ],
  doing: "Priya Sharma, her Care Coordinator, is calling this morning and will offer a nurse visit if it would help.",
  consents: [
    {
      id: "weekly",
      label: "Weekly wellbeing summary",
      detail: "A short note like this one, every Monday. Plain language, no medical readings.",
      granted: true,
    },
    {
      id: "urgent",
      label: "Call me if something is serious",
      detail: "A coordinator phones you directly. This is the only channel for anything urgent.",
      granted: true,
    },
    {
      id: "visits",
      label: "Tell me when a nurse visits",
      detail: "A short note after any home visit, saying it happened — not what was found.",
      granted: false,
    },
  ],
};

/* ---- operations ---------------------------------------------------------
   Aggregates only. One security-definer view sits behind this, and the ops
   role holds no table policy anywhere in the schema, so there is no
   individual record this surface could render even by mistake. */

export interface OpsMetrics {
  city: string;
  period: string;
  alertsRaised: number;
  alertsActioned: number;
  medianMinutesToFirstAction: number;
  falseAlarmRate: number;
  precisionAtK: number;
  coordinators: number;
  seniorsCovered: number;
  outcomes: { label: string; count: number; tone: Level }[];
  daily: { day: string; raised: number; actioned: number }[];
}

export const OPS: OpsMetrics = {
  city: "All cities",
  period: "Last 14 days",
  alertsRaised: 412,
  alertsActioned: 389,
  medianMinutesToFirstAction: 46,
  falseAlarmRate: 0.18,
  precisionAtK: 0.71,
  coordinators: 38,
  seniorsCovered: 1240,
  // Tone here means OUTCOME QUALITY, not clinical severity — reusing the risk
  // ramp would paint "false alarm" green and "not yet actioned" green, which
  // reads as "all fine" for the two rows an operations manager is actually
  // looking for. Green: the system worked. Amber: the cost of noise. Red: the
  // gap.
  outcomes: [
    { label: "True concern, handled by call", count: 214, tone: "low" },
    { label: "True concern, nurse visit arranged", count: 63, tone: "low" },
    { label: "False alarm, marked by coordinator", count: 70, tone: "med" },
    { label: "Not yet actioned", count: 23, tone: "high" },
  ],
  daily: [
    { day: "M", raised: 28, actioned: 27 },
    { day: "T", raised: 31, actioned: 29 },
    { day: "W", raised: 26, actioned: 26 },
    { day: "T", raised: 34, actioned: 31 },
    { day: "F", raised: 30, actioned: 28 },
    { day: "S", raised: 19, actioned: 18 },
    { day: "S", raised: 16, actioned: 16 },
    { day: "M", raised: 33, actioned: 32 },
    { day: "T", raised: 35, actioned: 33 },
    { day: "W", raised: 29, actioned: 27 },
    { day: "T", raised: 32, actioned: 30 },
    { day: "F", raised: 27, actioned: 26 },
    { day: "S", raised: 18, actioned: 17 },
    { day: "S", raised: 34, actioned: 29 },
  ],
};
