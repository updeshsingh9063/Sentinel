import { createClient } from "@/lib/supabase/server";

import type { Level } from "@/lib/demo";

/**
 * Operations aggregates, read from the database.
 *
 * Everything here comes from one security-definer view, ops_daily_metrics,
 * which has already aggregated the individual away. There is no senior_id, no
 * name and no per-person score in the result set, so this module could not
 * render an individual even if the page asked it to.
 *
 * The ops role additionally holds no table-level policy anywhere in the
 * schema, so this view is the whole of its access. SELECT on it is granted to
 * `authenticated` and explicitly revoked from `anon` -- see
 * backend/supabase/migrations/0003, which exists because Supabase's default
 * privileges had quietly granted it to anon.
 */

interface OpsRow {
  day: string;
  alerts_raised: number;
  actioned: number;
  dismissed: number;
  escalated: number;
  still_open: number;
  coordinators_active: number;
  seniors_alerted: number;
  mean_score: string | null;
  true_concern: number;
  false_alarm: number;
  unreachable: number;
  no_verdict: number;
  median_minutes_to_action: string | null;
  seniors_enrolled: number;
}

export interface OpsMetrics {
  /** Number of days covered. The caller renders the label. */
  periodDays: number;
  alertsRaised: number;
  alertsActioned: number;
  medianMinutesToFirstAction: number | null;
  falseAlarmRate: number;
  precisionAtK: number;
  coordinators: number;
  seniorsCovered: number;
  outcomes: { label: string; count: number; tone: Level }[];
  daily: { day: string; raised: number; actioned: number }[];
}

const WEEKDAY = ["S", "M", "T", "W", "T", "F", "S"];
const num = (v: string | number | null | undefined) => (v == null ? 0 : Number(v));

function median(values: number[]): number | null {
  const xs = values.filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

/**
 * @param outcomeLabels the four bucket labels, in order, already translated.
 *   They are passed in rather than written here so this module holds no copy.
 */
export async function loadOps(
  outcomeLabels: [string, string, string, string],
): Promise<OpsMetrics | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ops_daily_metrics")
    .select("*")
    .order("day", { ascending: false })
    .limit(21);

  if (error || !data || !data.length) return null;

  const rows = data as unknown as OpsRow[];

  const sum = (k: keyof OpsRow) => rows.reduce((n, r) => n + num(r[k] as number), 0);

  const trueConcern = sum("true_concern");
  const falseAlarm = sum("false_alarm");
  const unreachable = sum("unreachable");
  const stillOpen = sum("still_open");

  // Denominator is every alert a coordinator gave a verdict on. An alert still
  // open has not been judged, so counting it either way would flatter or
  // punish the model for work that has not happened yet.
  const judged = trueConcern + falseAlarm + unreachable;

  // Median of the daily medians. The view aggregates per day, and a true
  // pooled median would need the raw per-alert durations -- which would mean
  // handing this surface individual rows, exactly what it must not have.
  const medianMinutes = median(
    rows.map((r) => num(r.median_minutes_to_action)),
  );

  const chronological = [...rows].reverse().slice(-14);

  return {
    periodDays: rows.length,
    alertsRaised: sum("alerts_raised"),
    alertsActioned: sum("actioned"),
    medianMinutesToFirstAction: medianMinutes === null ? null : Math.round(medianMinutes),
    falseAlarmRate: judged ? falseAlarm / judged : 0,
    precisionAtK: judged ? trueConcern / judged : 0,
    coordinators: Math.max(...rows.map((r) => num(r.coordinators_active)), 0),
    seniorsCovered: num(rows[0]?.seniors_enrolled),

    // Mutually exclusive buckets that sum to the alerts raised, so the bars
    // are a partition rather than overlapping slices.
    //
    // Tone here means OUTCOME QUALITY, not clinical severity -- reusing the
    // risk ramp would paint "false alarm" green and "no verdict yet" green,
    // which reads as "all fine" for the two rows an operations manager is
    // actually looking for. Green: the system worked. Amber: the cost of
    // noise. Red: the gap.
    outcomes: [
      { label: outcomeLabels[0], count: trueConcern, tone: "low" },
      { label: outcomeLabels[1], count: falseAlarm, tone: "med" },
      { label: outcomeLabels[2], count: unreachable, tone: "med" },
      { label: outcomeLabels[3], count: stillOpen, tone: "high" },
    ],

    daily: chronological.map((r) => ({
      day: WEEKDAY[new Date(`${r.day}T00:00:00Z`).getUTCDay()],
      raised: num(r.alerts_raised),
      actioned: num(r.actioned),
    })),
  };
}
