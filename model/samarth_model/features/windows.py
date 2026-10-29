"""Windowed feature construction.

One row per senior-day, built only from data available on or before that day.
Any feature that peeks forward turns the whole evaluation into nonsense, so the
window functions are trailing by construction and the current day is excluded
from its own baseline.

THE TWO RULES THIS FILE EXISTS TO ENFORCE
  1. No forward information. Every rolling statistic is computed on a series
     already shifted by one day, so today can never appear in the baseline it
     is being judged against. A single extreme reading would otherwise drag
     its own band toward itself and hide the deviation.
  2. No ground truth. The generator writes `declining`, `decline_strength`,
     `hard_negative` and `hn_active` into the daily frame. Those are labels.
     They are dropped here by name, and `FEATURE_COLUMNS` is the allow-list the
     trainer uses, so a label cannot reach the model by being added upstream.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

WINDOWS = (3, 7, 14, 28)

#: Columns the generator writes as ground truth. Never features.
LABEL_COLUMNS = ("declining", "decline_strength", "hard_negative", "hn_active")

#: Vitals that get a personal-baseline deviation.
_VITALS = ("systolic_bp", "diastolic_bp", "pulse_bpm", "spo2_pct", "weight_kg", "steps")

_CUES = ("pain", "poor_sleep", "low_appetite", "dizziness", "confusion",
         "loneliness", "breathlessness", "fall")


def _trailing(g: pd.Series, window: int, fn: str, min_obs: int = 3) -> pd.Series:
    """A rolling statistic that excludes the current day.

    shift(1) first, then roll. Doing it the other way round includes today,
    which is the single easiest way to make a deviation model look brilliant
    in training and useless in production.
    """
    s = g.shift(1)
    r = s.rolling(window, min_periods=min_obs)
    return getattr(r, fn)()


def _robust_z(value: pd.Series, median: pd.Series, mad: pd.Series) -> pd.Series:
    """Deviation in MAD units, 1.4826 scaling MAD to a normal sigma.

    A floor on MAD stops a senior with a very stable history producing an
    enormous z from a trivial wobble -- division by near-zero, not insight.
    """
    scaled = 1.4826 * mad
    scaled = scaled.where(scaled > 0.5, 0.5)
    return (value - median) / scaled


def build(senior_days: pd.DataFrame, notes: pd.DataFrame | None = None) -> pd.DataFrame:
    """Return a feature frame indexed by (senior_id, day).

    `senior_days` is the generator's daily frame. `notes` is optional; when
    given, cue counts are extracted and added as trailing counts.
    """
    df = senior_days.sort_values(["senior_id", "day"]).reset_index(drop=True).copy()
    g = df.groupby("senior_id", sort=False)

    out = pd.DataFrame({
        "senior_id": df["senior_id"],
        "day": df["day"],
        "coordinator_id": df.get("coordinator_id", pd.Series(index=df.index, dtype=object)),
    })

    # ---- today's raw readings, carried through as-is ---------------------
    for col in _VITALS:
        if col in df:
            out[col] = df[col]

    # ---- personal baseline deviation -------------------------------------
    # The brief says this twice: change from a senior's OWN baseline matters
    # more than a population average. Nothing below compares across people.
    for col in _VITALS:
        if col not in df:
            continue
        med = g[col].transform(lambda s: _trailing(s, 28, "median"))
        mad = g[col].transform(
            lambda s: _trailing(s, 28, "median").pipe(
                lambda m: (s.shift(1) - m).abs().rolling(28, min_periods=3).median()
            )
        )
        out[f"{col}_med28"] = med
        out[f"{col}_z"] = _robust_z(df[col], med, mad)
        # Short-window drift: a week against the month behind it.
        out[f"{col}_d7"] = g[col].transform(lambda s: _trailing(s, 7, "mean")) - med

    # ---- adherence --------------------------------------------------------
    taken_rate = (df["doses_taken"] / df["doses_due"]).clip(0, 1)
    out["adherence_today"] = taken_rate
    for w in (7, 14):
        out[f"adherence_{w}"] = taken_rate.groupby(df["senior_id"]).transform(
            lambda s, w=w: _trailing(s, w, "mean")
        )
    out["adherence_drop"] = out["adherence_7"] - out["adherence_14"]

    # ---- contact and silence ---------------------------------------------
    # Missing data is signal, not a gap to impute. An unanswered call costs
    # nothing to compute and needs no sensor, which is what makes it usable on
    # a basic handset.
    answered = df["call_answered"].astype(float)
    for w in (7, 14):
        out[f"answered_{w}"] = answered.groupby(df["senior_id"]).transform(
            lambda s, w=w: _trailing(s, w, "mean")
        )

    def _days_since(s: pd.Series) -> pd.Series:
        last = -1
        res = []
        for i, v in enumerate(s.to_numpy()):
            res.append(i - last if last >= 0 else i + 1)
            if v:
                last = i
        return pd.Series(res, index=s.index, dtype=float)

    out["days_since_contact"] = g["call_answered"].transform(_days_since)

    checkin = df["checkin_answered"].astype(float)
    out["checkin_rate_7"] = checkin.groupby(df["senior_id"]).transform(
        lambda s: _trailing(s, 7, "mean")
    )

    # Keypad answers: 0 means not pressed, which is itself informative, so it
    # is kept as a separate indicator rather than imputed to a middle value.
    for col in ("feeling_code", "pain_code"):
        if col in df:
            v = df[col].replace(0, np.nan)
            out[col] = v
            out[f"{col}_7"] = v.groupby(df["senior_id"]).transform(
                lambda s: _trailing(s, 7, "mean")
            )

    missing = df["systolic_bp"].isna().astype(float)
    out["vitals_missing_7"] = missing.groupby(df["senior_id"]).transform(
        lambda s: _trailing(s, 7, "mean")
    )

    # ---- cues from call notes --------------------------------------------
    if notes is not None and len(notes):
        from samarth_model.nlp.cues import extract

        rows = []
        for _, r in notes.iterrows():
            found = extract(str(r["text"]))
            rows.append({
                "senior_id": r["senior_id"], "day": int(r["day"]),
                **{f"cue_{c}": 0 for c in _CUES},
                **{f"cue_{c.cue}": 1 for c in found if not c.negated},
                "cue_any": int(any(not c.negated for c in found)),
            })
        cue_df = pd.DataFrame(rows).groupby(["senior_id", "day"], as_index=False).max()
        out = out.merge(cue_df, on=["senior_id", "day"], how="left")

        cue_cols = [f"cue_{c}" for c in _CUES] + ["cue_any"]
        out[cue_cols] = out[cue_cols].fillna(0.0)
        for c in cue_cols:
            out[f"{c}_14"] = out.groupby("senior_id")[c].transform(
                lambda s: _trailing(s, 14, "sum", min_obs=1)
            )
    else:
        for c in [f"cue_{c}" for c in _CUES] + ["cue_any"]:
            out[c] = 0.0
            out[f"{c}_14"] = 0.0

    # ---- labels, carried for evaluation and stripped before training ------
    for col in LABEL_COLUMNS:
        if col in df:
            out[col] = df[col]

    return out


def feature_columns(frame: pd.DataFrame) -> list[str]:
    """The allow-list the trainer uses.

    Explicitly excludes identifiers and every label column, so a new ground
    truth column added to the generator cannot silently become a feature.
    """
    drop = {"senior_id", "day", "coordinator_id", *LABEL_COLUMNS}
    return [
        c for c in frame.columns
        if c not in drop and pd.api.types.is_numeric_dtype(frame[c])
    ]
