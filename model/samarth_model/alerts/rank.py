"""Ranking, which is the actual product.

The task is not "is this senior at risk" but "which ten seniors should this
coordinator call today". Thresholds are therefore tuned for precision at the
budget K, not for AUC. See model/evaluation/metrics.py for why.
"""

from __future__ import annotations

import pandas as pd

#: Layer weights for the blended score.
#:
#: Rules carry the least because they fire on the obvious and would otherwise
#: dominate a list that is supposed to find the non-obvious. Baseline carries
#: most because the brief says twice that personal change is what matters, and
#: because it still works on a senior with no device at all. ML adds ordering
#: within the band the other two agree on.
LAYER_WEIGHTS = {"rules": 0.25, "baseline": 0.40, "ml": 0.25, "anomaly": 0.10}


def blend(rules=None, baseline=None, ml=None, anomaly=None,
          weights: dict | None = None) -> pd.Series:
    """Combine the layer scores into the number the list is sorted by.

    A weighted sum, renormalised over the layers actually supplied, so running
    without a trained model (rules + baseline only) still produces a sensible
    ranking rather than a score silently scaled down by the missing weights.
    That matters: the ablation in the write-up runs exactly that way.
    """
    w = {**LAYER_WEIGHTS, **(weights or {})}
    parts = {"rules": rules, "baseline": baseline, "ml": ml, "anomaly": anomaly}
    present = {k: v for k, v in parts.items() if v is not None}
    if not present:
        raise ValueError("blend needs at least one layer")

    total_w = sum(w[k] for k in present)
    out = None
    for k, v in present.items():
        term = pd.Series(v).astype(float).fillna(0.0) * (w[k] / total_w)
        out = term if out is None else out + term
    return out.clip(0.0, 1.0)


def rank_day(scores, coordinator_id: str, day):
    """Order one coordinator caseload for one day, highest concern first.

    `scores` is a frame with senior_id, coordinator_id, day and score.
    Ties break on the senior who has gone longest without contact — if two
    people look equally concerning, call the one nobody has spoken to.
    """
    df = pd.DataFrame(scores)
    sel = df[(df["coordinator_id"] == coordinator_id) & (df["day"] == day)].copy()
    if sel.empty:
        return sel

    if "days_since_contact" not in sel:
        sel["days_since_contact"] = 0.0

    sel = sel.sort_values(
        ["score", "days_since_contact"], ascending=[False, False]
    ).reset_index(drop=True)
    sel["rank_in_day"] = range(1, len(sel) + 1)
    return sel


def rank_all(scores: pd.DataFrame) -> pd.DataFrame:
    """Rank every coordinator-day in one pass."""
    df = scores.copy()
    if "days_since_contact" not in df:
        df["days_since_contact"] = 0.0
    df = df.sort_values(
        ["coordinator_id", "day", "score", "days_since_contact"],
        ascending=[True, True, False, False],
    )
    df["rank_in_day"] = df.groupby(["coordinator_id", "day"]).cumcount() + 1
    return df.reset_index(drop=True)
