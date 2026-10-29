"""FR-5: the alert budget.

The brief says false alarms erode trust. This turns that into mechanism:

  * a hard cap per coordinator per day
  * deduplication, so one concern does not arrive as three alerts
  * a cool-down, so the same senior does not resurface daily unchanged
  * escalation when a concern persists across the cool-down anyway

The cool-down is the subtle one. Suppressing a repeat is right when nothing
changed and wrong when things are getting worse, so persistence escalates
rather than staying silent.
"""

from __future__ import annotations

import pandas as pd

DEFAULT_K = 10              # alerts per coordinator per day
DEFAULT_COOLDOWN_DAYS = 3
DEFAULT_ESCALATE_AFTER = 3  # consecutive concerning days inside the cool-down


def apply_cap(ranked, k: int = DEFAULT_K):
    """Keep the top k of a ranked day. The rest are scored, not surfaced.

    The suppressed rows are RETURNED, flagged, rather than dropped. A cap you
    cannot inspect is a cap nobody can trust, and the worklist shows what was
    held back for exactly that reason.
    """
    df = pd.DataFrame(ranked).copy()
    if df.empty:
        df["surfaced"] = []
        return df
    if "rank_in_day" not in df:
        df = df.sort_values("score", ascending=False)
        df["rank_in_day"] = range(1, len(df) + 1)
    df["surfaced"] = df["rank_in_day"] <= k
    return df


def within_cooldown(senior_id: str, day, history, cooldown_days: int = DEFAULT_COOLDOWN_DAYS) -> bool:
    """True if this senior was already alerted on recently.

    `history` is an iterable of (senior_id, day) pairs already surfaced.
    """
    for sid, prev_day in history or []:
        if sid == senior_id and 0 < (day - prev_day) <= cooldown_days:
            return True
    return False


def should_escalate(senior_id: str, history, consecutive_days: int = DEFAULT_ESCALATE_AFTER) -> bool:
    """True when a concern has persisted rather than resolved.

    This is the half of the cool-down that keeps it safe. Suppressing a repeat
    is correct when nothing has changed; staying silent while someone gets
    steadily worse is the failure mode that would matter most in the real
    world, so persistence breaks the suppression instead of extending it.
    """
    days = sorted(d for sid, d in (history or []) if sid == senior_id)
    if len(days) < consecutive_days:
        return False
    run = 1
    for a, b in zip(days, days[1:]):
        run = run + 1 if b - a == 1 else 1
        if run >= consecutive_days:
            return True
    return False


def apply_budget(ranked_all: pd.DataFrame, k: int = DEFAULT_K,
                 cooldown_days: int = DEFAULT_COOLDOWN_DAYS,
                 escalate_after: int = DEFAULT_ESCALATE_AFTER) -> pd.DataFrame:
    """Run cap, cool-down and escalation across every coordinator-day.

    Processed in day order because the cool-down depends on what was surfaced
    before it. Doing this vectorised would be faster and wrong.
    """
    df = ranked_all.sort_values(["coordinator_id", "day", "rank_in_day"]).copy()
    df["surfaced"] = False
    df["suppressed_by"] = ""
    df["escalated"] = False

    for coordinator, cdf in df.groupby("coordinator_id", sort=False):
        history: list[tuple[str, int]] = []
        concerning: list[tuple[str, int]] = []

        for day, day_df in cdf.groupby("day", sort=True):
            surfaced_today = 0
            for idx in day_df.index:
                sid = df.at[idx, "senior_id"]
                score = float(df.at[idx, "score"])

                # Track concern independently of whether it was shown, so a
                # senior suppressed by the cool-down can still escalate.
                if score >= 0.4:
                    concerning.append((sid, int(day)))

                if surfaced_today >= k:
                    df.at[idx, "suppressed_by"] = "budget"
                    continue

                if within_cooldown(sid, day, history, cooldown_days):
                    if should_escalate(sid, concerning, escalate_after):
                        df.at[idx, "escalated"] = True
                    else:
                        df.at[idx, "suppressed_by"] = "cooldown"
                        continue

                df.at[idx, "surfaced"] = True
                history.append((sid, int(day)))
                surfaced_today += 1

    return df
