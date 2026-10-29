"""Layer A: clinical threshold rules.

No training. Each rule returns a contribution and a plain-language reason, so
the explanation is generated with the score rather than reconstructed later.

Thresholds are deliberately conservative and configurable. They exist to catch
the obvious, not to be clever -- Layer B handles the per-person subtlety.

NEVER-DIAGNOSE. Every `text` below describes what CHANGED and what was
OBSERVED. None names a condition, and none should ever be edited to. The
reason text is shown to a coordinator and, in softened form, reaches a family
member; a condition name here would travel all the way out.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import pandas as pd


@dataclass(frozen=True)
class RuleHit:
    code: str
    text: str
    contribution: float


def _num(record: dict, key: str) -> float | None:
    v = record.get(key)
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(f) else f


def evaluate(day_record: dict) -> list[RuleHit]:
    """Apply every rule to one senior-day and return the hits.

    `day_record` carries the raw signals for the day plus a few rolling counts
    the feature layer has already computed (missed doses, unanswered calls).
    """
    hits: list[RuleHit] = []

    sys_bp = _num(day_record, "systolic_bp")
    if sys_bp is not None:
        if sys_bp >= 180:
            hits.append(RuleHit("bp_very_high",
                                "Systolic reading of %d, well above the usual range" % sys_bp,
                                0.42))
        elif sys_bp >= 160:
            hits.append(RuleHit("bp_high",
                                "Systolic reading of %d, above the usual range" % sys_bp,
                                0.26))
        elif sys_bp <= 90:
            hits.append(RuleHit("bp_low",
                                "Systolic reading of %d, below the usual range" % sys_bp,
                                0.24))

    spo2 = _num(day_record, "spo2_pct")
    if spo2 is not None and spo2 < 93:
        hits.append(RuleHit("spo2_low",
                            "Oxygen saturation at %.0f%%, lower than usual" % spo2,
                            0.30))

    pulse = _num(day_record, "pulse_bpm")
    if pulse is not None and (pulse >= 110 or pulse <= 48):
        hits.append(RuleHit("pulse_outside",
                            "Pulse of %.0f, outside the usual range" % pulse,
                            0.18))

    temp = _num(day_record, "temperature_c")
    if temp is not None and temp >= 38.0:
        hits.append(RuleHit("temp_high",
                            "Temperature of %.1f degrees" % temp, 0.22))

    # Adherence. Unlogged is not the same as not taken, which is exactly why
    # the reason says "not logged" and the action is to ask.
    adh7 = _num(day_record, "adherence_7")
    if adh7 is not None and adh7 < 0.6:
        hits.append(RuleHit("dose_missed",
                            "Under %d%% of doses logged over the past week" % round(adh7 * 100),
                            0.28))
    elif adh7 is not None and adh7 < 0.8:
        hits.append(RuleHit("dose_patchy",
                            "Doses logged patchily this week", 0.14))

    # Silence. Needs no sensor, works on any handset.
    quiet = _num(day_record, "days_since_contact")
    if quiet is not None:
        if quiet >= 7:
            hits.append(RuleHit("no_contact",
                                "No answered call in %d days" % int(quiet), 0.34))
        elif quiet >= 4:
            hits.append(RuleHit("contact_thin",
                                "No answered call in %d days" % int(quiet), 0.16))

    # Keypad check-in: 3 means "worse".
    feeling = _num(day_record, "feeling_code")
    if feeling is not None and feeling >= 3:
        hits.append(RuleHit("feels_worse",
                            "Said they feel worse at the daily check-in", 0.20))
    pain_code = _num(day_record, "pain_code")
    if pain_code is not None and pain_code >= 3:
        hits.append(RuleHit("pain_reported",
                            "Reported more pain at the daily check-in", 0.18))

    # Cues extracted from the call note.
    cue_text = {
        "pain": "Pain mentioned in a recent call note",
        "fall": "A fall mentioned in a recent call note",
        "confusion": "Memory or confusion mentioned in a recent call note",
        "low_appetite": "Appetite mentioned in a recent call note",
        "loneliness": "Loneliness mentioned in a recent call note",
        "dizziness": "Dizziness mentioned in a recent call note",
        "poor_sleep": "Poor sleep mentioned in a recent call note",
        "breathlessness": "Breathlessness mentioned in a recent call note",
    }
    weights = {"fall": 0.34, "breathlessness": 0.26, "dizziness": 0.22,
               "confusion": 0.20, "low_appetite": 0.18, "pain": 0.16,
               "poor_sleep": 0.14, "loneliness": 0.12}
    for cue, text in cue_text.items():
        if _num(day_record, f"cue_{cue}"):
            hits.append(RuleHit(f"cue_{cue}", text, weights[cue]))

    return sorted(hits, key=lambda h: -h.contribution)


def score_row(day_record: dict) -> float:
    """Combine one day's rule hits into a 0-1 Layer A score.

    Combined as independent evidence (1 - prod(1 - c)) rather than summed, so
    five small signals do not add up to a false certainty, and the score cannot
    exceed 1 however many rules fire.
    """
    remaining = 1.0
    for hit in evaluate(day_record):
        remaining *= (1.0 - min(0.95, hit.contribution))
    return float(1.0 - remaining)


def score(features: pd.DataFrame) -> pd.Series:
    """Layer A across a whole feature frame."""
    records = features.to_dict("records")
    return pd.Series([score_row(r) for r in records], index=features.index)
