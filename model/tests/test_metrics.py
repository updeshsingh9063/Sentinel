"""Hand-built cases for the three graded metrics.

Each test encodes one decision from the module docstring, so if someone later
"simplifies" precision to a global count or recall to per-day, a test fails
with a message saying why that is wrong.
"""

import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from evaluation.metrics import (
    Alert, Episode, episode_recall, lead_time, precision_at_k, summary,
)

D = date(2026, 3, 1)


def day(n: int) -> date:
    return D + timedelta(days=n)


# ------------------------------------------------------------- precision ----

def test_precision_is_averaged_per_day_not_pooled():
    # Day 0: 2 alerts, both wrong. Day 1: 10 alerts, all right.
    # Pooled precision would be 10/12 = 0.83 and hide the bad day.
    # Per-day mean is (0.0 + 1.0) / 2 = 0.5.
    eps = [Episode("s9", day(1), day(1))]
    alerts = [Alert("s1", day(0), 0.9), Alert("s2", day(0), 0.8)]
    alerts += [Alert("s9", day(1), 0.9 - i / 100) for i in range(10)]
    # All 10 of day 1 are the same senior inside the episode.
    r = precision_at_k(alerts, eps, k=10)
    assert r.days_scored == 2
    assert r.precision == 0.5


def test_precision_only_counts_top_k():
    eps = [Episode("hit", day(0), day(0))]
    # The true positive is ranked 3rd; with k=2 it should not be counted.
    alerts = [
        Alert("miss1", day(0), 0.9),
        Alert("miss2", day(0), 0.8),
        Alert("hit", day(0), 0.7),
    ]
    assert precision_at_k(alerts, eps, k=2).precision == 0.0
    assert precision_at_k(alerts, eps, k=3).precision == 1 / 3


def test_quiet_days_are_skipped_not_scored_zero():
    eps = [Episode("s1", day(0), day(0))]
    alerts = [Alert("s1", day(0), 0.9)]      # nothing on days 1..5
    r = precision_at_k(alerts, eps, k=10)
    assert r.days_scored == 1
    assert r.precision == 1.0


def test_grace_window_extends_backwards_only():
    eps = [Episode("s1", day(10), day(14))]
    early = [Alert("s1", day(8), 0.9)]       # 2 days before onset
    late = [Alert("s1", day(20), 0.9)]       # 6 days after it ended
    assert precision_at_k(early, eps, k=5, grace_days=3).precision == 1.0
    assert precision_at_k(late, eps, k=5, grace_days=3).precision == 0.0


def test_precision_is_per_coordinator_not_global():
    eps = [Episode("s1", day(0), day(0))]
    alerts = [Alert("s1", day(0), 0.9, coordinator_id="A"),
              Alert("sX", day(0), 0.9, coordinator_id="B")]
    # Coordinator A scored 1.0, B scored 0.0, mean 0.5.
    assert precision_at_k(alerts, eps, k=10).precision == 0.5


# ---------------------------------------------------------------- recall ----

def test_recall_counts_episodes_once_not_days():
    # A 10-day episode flagged on a single day is fully caught.
    eps = [Episode("s1", day(0), day(9))]
    alerts = [Alert("s1", day(3), 0.9)]
    r = episode_recall(alerts, eps)
    assert r.recall == 1.0
    assert r.episodes_caught == 1


def test_recall_under_budget_ignores_alerts_nobody_saw():
    eps = [Episode("s_low", day(0), day(0))]
    # The real episode is ranked last on a crowded day.
    alerts = [Alert("noise{}".format(i), day(0), 0.9) for i in range(10)]
    alerts.append(Alert("s_low", day(0), 0.1))
    assert episode_recall(alerts, eps).recall == 1.0           # uncapped
    assert episode_recall(alerts, eps, k=10).recall == 0.0     # under budget


def test_missed_episodes_are_returned_for_inspection():
    eps = [Episode("seen", day(0), day(1)), Episode("unseen", day(0), day(1))]
    r = episode_recall([Alert("seen", day(0), 0.9)], eps)
    assert r.recall == 0.5
    assert [e.senior_id for e in r.missed] == ["unseen"]


# ------------------------------------------------------------- lead time ----

def test_lead_time_uses_first_alert_in_episode():
    eps = [Episode("s1", day(0), day(9), detectable_from=day(6))]
    alerts = [Alert("s1", day(2), 0.9), Alert("s1", day(5), 0.9)]
    # First catch is day 2; reference day is day 6 -> 4 days early.
    assert lead_time(alerts, eps).mean_days == 4.0


def test_lead_time_excludes_missed_episodes_rather_than_zeroing_them():
    eps = [Episode("caught", day(0), day(9), detectable_from=day(5)),
           Episode("missed", day(0), day(9), detectable_from=day(5))]
    r = lead_time([Alert("caught", day(1), 0.9)], eps)
    assert r.caught == 1
    assert r.mean_days == 4.0       # not 2.0, which averaging in a zero gives


def test_lead_time_falls_back_to_onset_without_detectable_from():
    eps = [Episode("s1", day(10), day(20))]
    assert lead_time([Alert("s1", day(10), 0.9)], eps).mean_days == 0.0


# ---------------------------------------------------------------- summary ---

def test_summary_reports_all_three_under_one_budget():
    eps = [Episode("s1", day(0), day(5), detectable_from=day(3))]
    alerts = [Alert("s1", day(1), 0.95)]
    out = summary(alerts, eps, k=10)
    assert out["precision_at_k"] == 1.0
    assert out["episode_recall"] == 1.0
    assert out["lead_time_mean_days"] == 2.0
    assert out["k"] == 10
