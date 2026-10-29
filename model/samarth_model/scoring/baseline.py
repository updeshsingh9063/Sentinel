"""Layer B: deviation from the senior own baseline.

The brief states twice that a change from a personal baseline matters more than
a population average. A systolic of 150 is unremarkable for one senior and an
emergency delta for another, so nothing here compares across people.

Uses rolling median and MAD rather than mean and standard deviation: a single
bad reading or a cuff error should not move the band it is being judged against.

Also computes the silence features -- unanswered calls, skipped check-ins,
absent vitals. Missing data is signal, not a gap to impute.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

#: Weight on each deviation when they are combined into Layer B's score.
#: Systolic and weight carry most because they are the two signals the planted
#: declines move most reliably; silence carries real weight because it needs no
#: device at all, which is what makes it usable on a basic handset.
DEVIATION_WEIGHTS: dict[str, float] = {
    "systolic_bp_z": 0.26,
    "weight_kg_z": 0.20,
    "spo2_pct_z": 0.14,
    "pulse_bpm_z": 0.10,
    "steps_z": 0.14,
    "adherence_drop": 0.16,
}


def rolling_median_mad(values: np.ndarray, window: int,
                       min_obs: int) -> tuple[np.ndarray, np.ndarray]:
    """Trailing median and MAD, excluding the current day.

    Excluding today matters: including it would let an extreme reading drag its
    own baseline toward itself and mask the deviation.
    """
    s = pd.Series(np.asarray(values, dtype=float))
    prior = s.shift(1)
    med = prior.rolling(window, min_periods=min_obs).median()
    mad = (prior - med).abs().rolling(window, min_periods=min_obs).median()
    return med.to_numpy(), mad.to_numpy()


def robust_z(value: float, median: float, mad: float) -> float:
    """Deviation in MAD units. 1.4826 scales MAD to match a normal sigma."""
    if median is None or (isinstance(median, float) and np.isnan(median)):
        return 0.0
    scaled = 1.4826 * (mad if mad and not np.isnan(mad) else 0.0)
    # Floor the scale: a senior with an unusually flat history would otherwise
    # produce a huge z from a trivial wobble, which is division by near-zero
    # rather than a finding.
    scaled = max(scaled, 0.5)
    return float((value - median) / scaled)


def score(features: pd.DataFrame) -> pd.Series:
    """Combine the per-signal deviations into one 0-1 Layer B score.

    Only deviations in the CONCERNING direction count. A senior whose blood
    pressure drifts below their own baseline, or whose step count rises, is
    not a reason to call someone — scoring the absolute deviation would fire on
    people who are getting better.
    """
    total = pd.Series(0.0, index=features.index)

    for col, weight in DEVIATION_WEIGHTS.items():
        if col not in features:
            continue
        v = features[col].astype(float).fillna(0.0)

        if col in ("spo2_pct_z", "steps_z"):
            # Falling oxygen saturation and falling activity are the concern.
            adverse = (-v).clip(lower=0)
        elif col == "adherence_drop":
            # Already a drop: negative means this week is worse than last.
            adverse = (-v).clip(lower=0) * 6.0
        elif col == "weight_kg_z":
            adverse = (-v).clip(lower=0)
        else:
            adverse = v.clip(lower=0)

        # Saturate at 3 MAD. Beyond that it is already as alarming as it needs
        # to be, and letting one signal run away would drown the others.
        total = total + weight * (adverse / 3.0).clip(upper=1.0)

    # Silence, which no device can report.
    if "days_since_contact" in features:
        quiet = (features["days_since_contact"].astype(float).fillna(0) - 3).clip(lower=0)
        total = total + 0.18 * (quiet / 7.0).clip(upper=1.0)

    if "vitals_missing_7" in features:
        total = total + 0.08 * features["vitals_missing_7"].astype(float).fillna(0).clip(0, 1)

    return total.clip(0.0, 1.0)
