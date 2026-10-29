// Mirrors backend/app/schemas/core.py. Keep the two in step.

export type Role = "coordinator" | "family" | "ops" | "admin";

export type CueType =
  | "pain" | "fall" | "confusion" | "low_appetite"
  | "loneliness" | "dizziness" | "poor_sleep" | "breathlessness";

export interface Reason {
  code: string;
  /** Plain language, non-diagnostic. Never names a condition. */
  text: string;
  contribution: number;
}

export interface WorklistItem {
  senior_id: string;
  display_name: string;
  age: number;
  score: number;
  rank: number;
  reasons: Reason[];
  next_step: string;
  days_since_last_contact: number | null;
}

export interface BaselineBand {
  /** The senior own trailing median, not a population threshold. */
  median: number;
  mad: number;
  series: { day: string; value: number | null }[];
}
