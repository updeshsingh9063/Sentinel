"""Learn which reasons a coordinator actually found worth acting on.

THE LOOP THE BRIEF ASKS FOR. Coordinators already mark every alert they take
as a true concern, a false alarm, or unreachable. Until now that verdict was
stored and never read: the product collected a label and threw away the
lesson. This module closes the loop by learning, per reason code, how often an
alert citing that reason turned out to be worth raising, and nudging later
scores accordingly.

WHY PER REASON CODE AND NOT PER SENIOR. Per-senior learning sounds more
personal and is the wrong unit: a senior who was a false alarm last week may
be genuinely declining this week, and suppressing them is how a system kills
someone politely. A reason code — "pulse elevated against their own baseline",
"loneliness mentioned on a call" — is a claim about the SIGNAL, and signals
really do differ in how often they pay off. Down-weighting a noisy signal is
reasonable; down-weighting a person is not.

THE ADJUSTMENT IS DELIBERATELY TIMID. It is bounded to ±25%, it needs a
minimum number of verdicts before it moves at all, and it shrinks toward "no
opinion" when the evidence is thin. A feedback loop that can drive a score to
zero is a feedback loop that can learn to ignore someone, and nothing in a
hackathon-sized sample justifies that much confidence. The cap is the safety
property; the learning is the feature.

THE TWO DIRECTIONS ARE NOT SYMMETRIC, ON PURPOSE. A false alarm costs a
wasted call. A missed decline costs the thing this system exists to prevent.
So penalties are capped tighter than rewards — a reason may be boosted by up
to 25% but demoted by at most 20% — and a run of false alarms can quieten a
signal without ever burying it.
"""

from __future__ import annotations

import json
from collections import defaultdict

import pandas as pd

#: Verdicts that count as the alert having been worth raising.
USEFUL = {"true_concern"}
#: Verdicts that count against it. "unreachable" is deliberately in neither:
#: nobody learned anything about the signal, only about the phone line.
NOT_USEFUL = {"false_alarm"}

#: Below this many verdicts a reason code keeps its default weight. Ten is not
#: a statistical threshold, it is an honesty threshold: three verdicts is an
#: anecdote and should not move a ranking.
MIN_VERDICTS = 10

#: How far the multiplier may travel from 1.0. Rewards may reach +0.25,
#: penalties stop at -0.20, so an unpopular signal is quietened and never
#: silenced.
MAX_BOOST = 0.25
MAX_PENALTY = 0.20

#: The precision a reason is compared against. Set from the observed base rate
#: at fit time; a reason is only "reliable" relative to the others.
_DEFAULT_BASE = 0.5


def _codes(reasons) -> list[str]:
    """Reason codes from whatever the alert row happens to carry."""
    if reasons is None:
        return []
    if isinstance(reasons, str):
        try:
            reasons = json.loads(reasons)
        except json.JSONDecodeError:
            return []
    if isinstance(reasons, dict):
        reasons = [reasons]
    out = []
    for r in reasons or []:
        if isinstance(r, dict) and r.get("code"):
            out.append(str(r["code"]))
    return out


class FeedbackWeights:
    """Per-reason multipliers learned from coordinator verdicts."""

    def __init__(self, multipliers: dict[str, float], base_rate: float, counts: dict[str, int]):
        self.multipliers = multipliers
        self.base_rate = base_rate
        self.counts = counts

    def multiplier_for(self, reasons) -> float:
        """The adjustment for one alert, from the reasons it cited.

        The mean across cited reasons rather than the product: an alert citing
        three mildly unreliable signals is not nine times less interesting, and
        multiplying would let a long reason list collapse a score on its own.
        """
        codes = _codes(reasons)
        if not codes:
            return 1.0
        vals = [self.multipliers.get(c, 1.0) for c in codes]
        return sum(vals) / len(vals)

    def apply(self, scores, reasons_series) -> pd.Series:
        s = pd.Series(scores).astype(float).reset_index(drop=True)
        mult = pd.Series(
            [self.multiplier_for(r) for r in list(reasons_series)]
        ).astype(float).reset_index(drop=True)
        return (s * mult).clip(0.0, 1.0)

    def table(self) -> pd.DataFrame:
        rows = [
            {"code": c, "multiplier": round(m, 3), "verdicts": self.counts.get(c, 0)}
            for c, m in sorted(self.multipliers.items(), key=lambda kv: kv[1])
        ]
        return pd.DataFrame(rows)


def fit(labelled: pd.DataFrame) -> FeedbackWeights:
    """Learn multipliers from alerts that carry a verdict.

    `labelled` needs `reasons` and `verdict`. Rows with any other verdict —
    including unreachable — are ignored rather than counted as negative.
    """
    useful = defaultdict(int)
    total = defaultdict(int)
    n_useful = 0
    n_total = 0

    for row in labelled.itertuples():
        verdict = getattr(row, "verdict", None)
        if verdict not in USEFUL and verdict not in NOT_USEFUL:
            continue
        good = verdict in USEFUL
        n_total += 1
        n_useful += int(good)
        for code in set(_codes(getattr(row, "reasons", None))):
            total[code] += 1
            useful[code] += int(good)

    base = (n_useful / n_total) if n_total else _DEFAULT_BASE
    multipliers: dict[str, float] = {}

    for code, n in total.items():
        if n < MIN_VERDICTS:
            # Not enough evidence to have an opinion. Saying so explicitly
            # beats letting a 2-of-3 run masquerade as a finding.
            multipliers[code] = 1.0
            continue
        precision = useful[code] / n
        lift = precision - base
        # Shrink toward no-opinion in proportion to how thin the evidence is.
        # At exactly MIN_VERDICTS the adjustment is half strength.
        confidence = n / (n + MIN_VERDICTS)
        adj = lift * 2.0 * confidence
        adj = min(MAX_BOOST, max(-MAX_PENALTY, adj))
        multipliers[code] = round(1.0 + adj, 4)

    return FeedbackWeights(multipliers, base, dict(total))
