/**
 * What a companion call establishes, and how two turns of it combine.
 *
 * The model is given a window of the conversation rather than all of it, so
 * each turn returns its reading of the call SO FAR and the caller carries that
 * forward. Merging is therefore not a convenience — it is what stops turn four
 * from erasing what turn two was told.
 */

export type Code = 1 | 2 | 3 | null;

export interface Cue {
  cue: string;
  negated: boolean;
  confidence: number;
  span: string;
}

export interface CallSignals {
  feeling: Code;
  pain: Code;
  meds: Code;
  sleep: Code;
  appetite: Code;
  fall: Code;
  cues: Cue[];
  summary: string;
}

export const EMPTY_SIGNALS: CallSignals = {
  feeling: null,
  pain: null,
  meds: null,
  sleep: null,
  appetite: null,
  fall: null,
  cues: [],
  summary: "",
};

const CODE_KEYS = ["feeling", "pain", "meds", "sleep", "appetite", "fall"] as const;

const CUE_KINDS = new Set([
  "pain",
  "fall",
  "confusion",
  "low_appetite",
  "loneliness",
  "dizziness",
  "poor_sleep",
  "breathlessness",
]);

function code(v: unknown): Code {
  const n = typeof v === "string" ? Number(v) : v;
  return n === 1 || n === 2 || n === 3 ? n : null;
}

function cues(v: unknown): Cue[] {
  if (!Array.isArray(v)) return [];
  const out: Cue[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const kind = typeof r.cue === "string" ? r.cue : "";
    // A label this schema does not define means nothing to anything reading
    // it downstream, so it is dropped here rather than stored and puzzled
    // over later.
    if (!CUE_KINDS.has(kind)) continue;
    const c = Number(r.confidence);
    out.push({
      cue: kind,
      negated: r.negated === true,
      confidence: Number.isFinite(c) ? Math.min(Math.max(c, 0), 1) : 0.6,
      span: typeof r.span === "string" ? r.span.slice(0, 300) : "",
    });
  }
  return out;
}

/** Everything a model turn claimed, with anything unrecognisable discarded. */
export function readSignals(raw: unknown): CallSignals {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out = { ...EMPTY_SIGNALS, cues: [] as Cue[] };
  for (const k of CODE_KEYS) out[k] = code(r[k]);
  out.cues = cues(r.cues);
  out.summary = typeof r.summary === "string" ? r.summary.slice(0, 400) : "";
  return out;
}

/**
 * Later turns add; they do not retract.
 *
 * A code already established stands unless the senior says something new about
 * it. "They did not mention their knee again" is not the same as "their knee
 * is fine", and on a record the two must never be confused — so a null coming
 * back from a later turn is read as silence, not as a correction.
 *
 * Cues are kept once heard, deduplicated on kind and negation, keeping the
 * reading the model was most sure of.
 */
export function mergeSignals(prev: CallSignals, next: CallSignals): CallSignals {
  const out: CallSignals = { ...prev, cues: [...prev.cues] };
  for (const k of CODE_KEYS) if (next[k] !== null) out[k] = next[k];

  for (const c of next.cues) {
    const at = out.cues.findIndex((x) => x.cue === c.cue && x.negated === c.negated);
    if (at === -1) out.cues.push(c);
    else if (c.confidence > out.cues[at].confidence) out.cues[at] = c;
  }

  // The summary describes the whole call, so the newest one wins — but an
  // empty one never overwrites a real one.
  if (next.summary.trim()) out.summary = next.summary;
  return out;
}

/** True once anything at all has been established worth writing down. */
export function hasAnything(s: CallSignals): boolean {
  return CODE_KEYS.some((k) => s[k] !== null) || s.cues.length > 0 || s.summary.trim() !== "";
}
