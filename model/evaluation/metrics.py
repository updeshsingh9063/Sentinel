"""Evaluation metrics for the alert-budget framing.

The brief asks for precision, recall and days-early on planted declines. Those
three words hide three modelling decisions, and getting them wrong is the
easiest way to report a number that means nothing:

1. **Precision must be per coordinator-day, at the budget K.** A coordinator
   sees ten alerts a day. Global precision over 18,000 senior-days answers a
   question nobody asked. `precision_at_k` scores each day separately and
   averages, so a day where the top ten were all wrong cannot be hidden by a
   quiet month.

2. **Recall must be per episode, not per day.** A decline that runs 14 days is
   one thing the coordinator needed to catch, not 14. Counting days would let a
   model that fires late on a long episode look better than one that fires once
   on day two. `episode_recall` counts an episode caught if it was flagged any
   time within its window.

3. **Lead time is measured from the first catch**, and only over caught
   episodes. Averaging in zeros for missed episodes conflates "we were late"
   with "we never saw it", which are different failures with different fixes.

Everything here takes plain sequences, so it runs without a trained model and
can be unit-tested against hand-built cases.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import date, timedelta


@dataclass(frozen=True)
class Episode:
    """One planted decline, as the generator recorded it.

    `onset` is the first day the underlying condition was deteriorating, which
    is earlier than the day a human would have noticed. Lead time is measured
    against `detectable_from` when the generator supplies it, because claiming
    credit for predicting before any signal existed would be dishonest.
    """

    senior_id: str
    onset: date
    end: date
    detectable_from: date | None = None

    @property
    def reference_day(self) -> date:
        return self.detectable_from or self.onset

    def covers(self, day: date) -> bool:
        return self.onset <= day <= self.end


@dataclass(frozen=True)
class Alert:
    senior_id: str
    day: date
    score: float
    coordinator_id: str = "c1"


@dataclass(frozen=True)
class PrecisionResult:
    precision: float
    days_scored: int
    alerts_considered: int
    true_positives: int

    def __str__(self) -> str:
        return "precision@K={:.3f} over {} coordinator-days ({}/{} alerts)".format(
            self.precision, self.days_scored, self.true_positives,
            self.alerts_considered)


def _episodes_by_senior(episodes: Iterable[Episode]) -> dict[str, list[Episode]]:
    out: dict[str, list[Episode]] = {}
    for e in episodes:
        out.setdefault(e.senior_id, []).append(e)
    return out


def is_true_positive(alert: Alert, by_senior: dict[str, list[Episode]],
                     grace_days: int = 0) -> bool:
    """Did this alert land inside a real episode?

    `grace_days` extends the window backwards only. Firing a few days before
    onset is early detection, which is the goal; firing after the episode has
    ended is not a catch, it is noise.
    """
    for e in by_senior.get(alert.senior_id, ()):
        if e.onset - timedelta(days=grace_days) <= alert.day <= e.end:
            return True
    return False


def precision_at_k(alerts: Sequence[Alert], episodes: Iterable[Episode],
                   k: int, grace_days: int = 0) -> PrecisionResult:
    """Mean precision over the top-k alerts of each coordinator-day.

    Days where the model raised nothing are skipped rather than scored 0 or 1:
    a quiet day is neither a success nor a failure of ranking, and including it
    either way distorts the average.
    """
    by_senior = _episodes_by_senior(episodes)

    buckets: dict[tuple[str, date], list[Alert]] = {}
    for a in alerts:
        buckets.setdefault((a.coordinator_id, a.day), []).append(a)

    per_day: list[float] = []
    considered = 0
    tps = 0
    for _, day_alerts in sorted(buckets.items()):
        top = sorted(day_alerts, key=lambda a: a.score, reverse=True)[:k]
        if not top:
            continue
        hits = sum(1 for a in top if is_true_positive(a, by_senior, grace_days))
        per_day.append(hits / len(top))
        considered += len(top)
        tps += hits

    precision = sum(per_day) / len(per_day) if per_day else 0.0
    return PrecisionResult(precision, len(per_day), considered, tps)


@dataclass(frozen=True)
class RecallResult:
    recall: float
    episodes_total: int
    episodes_caught: int
    missed: list[Episode]

    def __str__(self) -> str:
        return "episode recall={:.3f} ({}/{} episodes)".format(
            self.recall, self.episodes_caught, self.episodes_total)


def episode_recall(alerts: Sequence[Alert], episodes: Sequence[Episode],
                   k: int | None = None) -> RecallResult:
    """Fraction of planted episodes flagged at least once.

    Pass `k` to measure recall *under the budget* -- only alerts that would
    actually have been shown count. Recall without the cap flatters the model,
    because an alert ranked 40th on a day is an alert nobody saw.
    """
    shown = _apply_budget(alerts, k) if k else list(alerts)

    by_senior: dict[str, list[Alert]] = {}
    for a in shown:
        by_senior.setdefault(a.senior_id, []).append(a)

    caught, missed = 0, []
    for e in episodes:
        if any(e.covers(a.day) for a in by_senior.get(e.senior_id, ())):
            caught += 1
        else:
            missed.append(e)

    total = len(episodes)
    return RecallResult(caught / total if total else 0.0, total, caught, missed)


def _apply_budget(alerts: Sequence[Alert], k: int) -> list[Alert]:
    buckets: dict[tuple[str, date], list[Alert]] = {}
    for a in alerts:
        buckets.setdefault((a.coordinator_id, a.day), []).append(a)
    kept: list[Alert] = []
    for day_alerts in buckets.values():
        kept.extend(sorted(day_alerts, key=lambda a: a.score, reverse=True)[:k])
    return kept


@dataclass(frozen=True)
class LeadTimeResult:
    mean_days: float
    median_days: float
    per_episode: dict[str, int]
    caught: int

    def __str__(self) -> str:
        return "lead time mean={:.1f}d median={:.1f}d over {} caught".format(
            self.mean_days, self.median_days, self.caught)


def lead_time(alerts: Sequence[Alert], episodes: Sequence[Episode],
              k: int | None = None) -> LeadTimeResult:
    """Days between the first alert in an episode and its reference day.

    Positive means the alert came before the reference day. Missed episodes are
    excluded, not counted as zero -- reporting them as zero would blend "late"
    into "never saw it". Read this alongside episode_recall, never alone: a
    model that catches one easy episode very early would otherwise post a
    better lead time than one that catches most of them.
    """
    shown = _apply_budget(alerts, k) if k else list(alerts)

    by_senior: dict[str, list[Alert]] = {}
    for a in shown:
        by_senior.setdefault(a.senior_id, []).append(a)

    per_episode: dict[str, int] = {}
    for i, e in enumerate(episodes):
        in_window = [a.day for a in by_senior.get(e.senior_id, ())
                     if e.covers(a.day)]
        if not in_window:
            continue
        key = "{}:{}".format(e.senior_id, i)
        per_episode[key] = (e.reference_day - min(in_window)).days

    vals = sorted(per_episode.values())
    if not vals:
        return LeadTimeResult(0.0, 0.0, {}, 0)

    mid = len(vals) // 2
    median = float(vals[mid]) if len(vals) % 2 else (vals[mid - 1] + vals[mid]) / 2
    return LeadTimeResult(sum(vals) / len(vals), median, per_episode, len(vals))


def summary(alerts: Sequence[Alert], episodes: Sequence[Episode],
            k: int = 10, grace_days: int = 0) -> dict:
    """The three numbers the brief asks for, all under the same budget."""
    p = precision_at_k(alerts, episodes, k, grace_days)
    r = episode_recall(alerts, episodes, k)
    lt = lead_time(alerts, episodes, k)
    return {
        "k": k,
        "precision_at_k": round(p.precision, 4),
        "episode_recall": round(r.recall, 4),
        "lead_time_mean_days": round(lt.mean_days, 2),
        "lead_time_median_days": round(lt.median_days, 2),
        "episodes_total": r.episodes_total,
        "episodes_caught": r.episodes_caught,
        "coordinator_days_scored": p.days_scored,
    }
