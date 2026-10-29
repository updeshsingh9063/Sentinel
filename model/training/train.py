"""Train and evaluate the risk pipeline end to end.

Produces deliverable 4 of the brief: precision, recall and how many days early
decline was caught on the planted cases, plus the layer ablation that shows
what each part of the pipeline is actually contributing.

    python model/training/train.py
    python model/training/train.py --k 10 --out model/artifacts

WHAT "DAYS EARLY" MEANS HERE, stated plainly because the number is meaningless
without it. Each planted decline has an onset day and then builds. We define
the OBVIOUS day as the first day the generator's decline strength reaches 0.8 —
the point by which a coordinator would very likely have noticed anyway, from a
reading far off baseline or a run of missed calls. Days early is then

    obvious_day - first_day_the_senior_was_surfaced_in_the_top_K

measured only on episodes that were caught at all, and only on days the alert
was actually SURFACED under the daily budget. Alerts the budget suppressed do
not count: a detection nobody saw is not a detection.

Missed episodes are excluded rather than counted as zero, because averaging a
miss into "late" would hide it. Always read days-early next to recall.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "model"))

from evaluation.metrics import Alert, Episode, episode_recall, precision_at_k  # noqa: E402
from samarth_model.alerts.budget import apply_budget  # noqa: E402
from samarth_model.alerts.rank import blend, rank_all  # noqa: E402
from samarth_model.explain.reasons import (  # noqa: E402
    next_step_hi_for,
    summarise,
    text_hi_for,
)
from samarth_model.features.windows import build, feature_columns  # noqa: E402
from samarth_model.scoring import baseline as layer_b  # noqa: E402
from samarth_model.scoring import feedback as layer_f  # noqa: E402
from samarth_model.scoring import ml as layer_c  # noqa: E402
from samarth_model.scoring import rules as layer_a  # noqa: E402

START = date(2025, 1, 6)
OBVIOUS_AT = 0.8


def load(cohort: Path):
    daily = pd.read_parquet(cohort / "daily.parquet")
    notes = pd.read_parquet(cohort / "notes.parquet")
    seniors = pd.read_parquet(cohort / "seniors.parquet")
    return daily, notes, seniors


def obvious_day(row, daily_by_senior) -> int | None:
    """First day this senior's planted decline reaches OBVIOUS_AT."""
    d = daily_by_senior.get(row.senior_id)
    if d is None:
        return None
    hit = d[d["decline_strength"] >= OBVIOUS_AT]
    if hit.empty:
        return int(d["day"].max())
    return int(hit["day"].min())


def episodes_for(seniors: pd.DataFrame, daily: pd.DataFrame) -> list[Episode]:
    by_senior = {sid: g for sid, g in daily.groupby("senior_id", sort=False)}
    out = []
    for row in seniors[seniors["declines"]].itertuples():
        onset = int(row.onset_day)
        obv = obvious_day(row, by_senior) or onset
        end = int(by_senior[row.senior_id]["day"].max())
        out.append(Episode(
            senior_id=row.senior_id,
            onset=START + timedelta(days=onset),
            end=START + timedelta(days=end),
            # Reference day for lead time: the day it would have been obvious.
            detectable_from=START + timedelta(days=obv),
        ))
    return out


def days_early(surfaced: pd.DataFrame, episodes: list[Episode]) -> dict:
    """Days between the first SURFACED alert INSIDE the episode and obvious day.

    Within the episode window specifically. Taking a senior's globally first
    surfaced day instead would score anyone who was ever surfaced before their
    onset — a false alarm — as a missed episode, which is both wrong and
    flattering in the wrong direction.
    """
    shown = surfaced[surfaced["surfaced"]]
    by_senior = {sid: g["day"].to_numpy() for sid, g in shown.groupby("senior_id")}

    per, missed, before_obvious = {}, 0, 0
    for e in episodes:
        onset_day = (e.onset - START).days
        obv_day = (e.reference_day - START).days
        end_day = (e.end - START).days
        days = by_senior.get(e.senior_id)
        in_window = [int(d) for d in (days if days is not None else [])
                     if onset_day <= d <= end_day]
        if not in_window:
            missed += 1
            continue
        got = min(in_window)
        per[e.senior_id] = obv_day - got
        if got < obv_day:
            before_obvious += 1
    vals = sorted(per.values())
    if not vals:
        return {"caught": 0, "missed": missed, "caught_before_obvious": 0,
                "mean_days_early": 0.0, "median_days_early": 0.0, "per_episode": {}}
    mid = len(vals) // 2
    return {
        "caught": len(vals),
        "missed": missed,
        "caught_before_obvious": before_obvious,
        "mean_days_early": round(float(np.mean(vals)), 2),
        "median_days_early": float(vals[mid] if len(vals) % 2 else (vals[mid - 1] + vals[mid]) / 2),
        "per_episode": per,
    }


def to_alerts(scored: pd.DataFrame) -> list[Alert]:
    return [
        Alert(senior_id=r.senior_id,
              day=START + timedelta(days=int(r.day)),
              score=float(r.score),
              coordinator_id=str(r.coordinator_id))
        for r in scored.itertuples()
    ]


def oracle_precision(scored: pd.DataFrame, episodes: list[Episode], k: int) -> float:
    """Best precision@K any ranker could reach on this cohort.

    Precision@K is capped by arithmetic, not by the model: if a coordinator
    has 35 seniors of whom 4 are declining on a given day, surfacing 10 cannot
    be more than 40% true positives however good the ordering is. Reporting
    the model's number without this ceiling invites the reader to compare it
    against 1.0, which is not the scale it lives on.
    """
    in_ep = set()
    for e in episodes:
        for d in range((e.onset - START).days, (e.end - START).days + 1):
            in_ep.add((e.senior_id, d))
    df = scored.copy()
    df["is_tp"] = [
        (r.senior_id, int(r.day)) in in_ep for r in df.itertuples()
    ]
    hits = df.groupby(["coordinator_id", "day"])["is_tp"].sum()
    sizes = df.groupby(["coordinator_id", "day"])["is_tp"].size()
    per_day = (hits.clip(upper=k) / sizes.clip(upper=k)).mean()
    return float(per_day)


def evaluate(scored: pd.DataFrame, episodes: list[Episode], k: int, label: str) -> dict:
    ranked = rank_all(scored)
    budgeted = apply_budget(ranked, k=k)
    alerts = to_alerts(scored)

    p = precision_at_k(alerts, episodes, k=k)
    r = episode_recall(alerts, episodes, k=k)
    de = days_early(budgeted, episodes)

    return {
        "layer": label,
        "k": k,
        "precision_at_k": round(p.precision, 4),
        "episode_recall": round(r.recall, 4),
        "episodes_total": r.episodes_total,
        "episodes_caught": r.episodes_caught,
        "precision_ceiling": round(oracle_precision(scored, episodes, k), 4),
        "mean_days_early": de["mean_days_early"],
        "median_days_early": de["median_days_early"],
        "episodes_caught_before_obvious": de["caught_before_obvious"],
        "episodes_missed": de["missed"],
        "surfaced_alerts": int(budgeted["surfaced"].sum()),
        "suppressed_cooldown": int((budgeted["suppressed_by"] == "cooldown").sum()),
        "suppressed_budget": int((budgeted["suppressed_by"] == "budget").sum()),
        "escalated": int(budgeted["escalated"].sum()),
    }


def score_layers(feats: pd.DataFrame, cols: list[str], labels, groups,
                 fitted=None):
    """Compute every layer's score for one cohort.

    When `fitted` is given (model, iso) the models are applied rather than
    retrained — that is how the validation cohort is scored, so the stepwise
    mechanism is genuinely unseen.
    """
    X = feats[cols]
    out = {
        "rules": layer_a.score(feats).to_numpy(),
        "baseline": layer_b.score(feats).to_numpy(),
    }

    if fitted is None:
        # Out-of-fold, grouped by senior. A random row split would put day 41
        # in train and day 42 in test and inflate everything.
        out["ml"] = layer_c.cross_val_scores(X, labels, groups)
        model = layer_c.train_lightgbm(X.to_numpy(dtype=float), labels)
        iso = layer_c.train_isolation_forest(X.to_numpy(dtype=float))
        out["anomaly"] = layer_c.isolation_score(iso, X.to_numpy(dtype=float))
        return out, (model, iso)

    model, iso = fitted
    out["ml"] = model.predict_proba(np.nan_to_num(X.to_numpy(dtype=float), nan=0.0))[:, 1]
    out["anomaly"] = layer_c.isolation_score(iso, X.to_numpy(dtype=float))
    return out, fitted


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cohort", default="datasets/synthetic")
    ap.add_argument("--validation", default="datasets/synthetic/validation")
    ap.add_argument("--k", type=int, default=10)
    ap.add_argument("--out", default="model/artifacts")
    args = ap.parse_args()

    cohort = REPO / args.cohort
    daily, notes, seniors = load(cohort)
    print(f"cohort: {len(seniors)} seniors, {len(daily)} senior-days, "
          f"{int(seniors.declines.sum())} planted declines")

    print("building features...")
    feats = build(daily, notes)
    cols = feature_columns(feats)
    print(f"  {len(cols)} features, {len(feats)} rows")

    labels = feats["declining"].astype(int).to_numpy()
    groups = feats["senior_id"].to_numpy()

    print("scoring layers...")
    layers, fitted = score_layers(feats, cols, labels, groups)

    base = feats[["senior_id", "day", "coordinator_id", "days_since_contact"]].copy()
    episodes = episodes_for(seniors, daily)

    # ---- ablation ---------------------------------------------------------
    # The point of the ablation is to show each layer earns its place. If
    # adding the ML layer does not move precision, the honest thing is to say
    # so rather than ship it for the look of it.
    combos = [
        ("rules only", {"rules": layers["rules"]}),
        ("+ baseline", {"rules": layers["rules"], "baseline": layers["baseline"]}),
        ("+ ML", {"rules": layers["rules"], "baseline": layers["baseline"],
                  "ml": layers["ml"]}),
        ("+ anomaly (full)", layers),
    ]

    results = []
    for label, parts in combos:
        scored = base.copy()
        scored["score"] = blend(**parts).to_numpy()
        res = evaluate(scored, episodes, args.k, label)
        results.append(res)
        print(f"  {label:18} precision@{args.k}={res['precision_at_k']:.3f} "
              f"(ceiling {res['precision_ceiling']:.3f})  "
              f"recall={res['episode_recall']:.3f}  "
              f"early median={res['median_days_early']:.0f}d  "
              f"before-obvious {res['episodes_caught_before_obvious']}/{res['episodes_total']}")

    # ---- the coordinator feedback loop ------------------------------------
    #
    # The brief's stretch goal is a loop where coordinators mark alerts useful
    # or not and the model improves from it. Doing that honestly needs three
    # things, and skipping any one of them turns it into theatre.
    #
    # ONE: verdicts that carry signal. A simulated coordinator who agrees with
    # the ground truth 85% of the time is a fair stand-in for a real one. A
    # simulated coordinator who says "true concern" 71% of the time regardless
    # of what happened — which is what the demo loader used to generate — is
    # noise, and a model that learns from noise has not learned anything.
    #
    # TWO: a split in TIME. Feedback is fitted on the first half of the window
    # and measured on the second, because that is the only arrangement that
    # answers the actual question: does last month's feedback improve next
    # month's list. Fitting and scoring on the same days would report the
    # model's ability to memorise verdicts it had already seen.
    #
    # THREE: the comparison reported either way. If the loop does not help, it
    # says so below and the number goes in the write-up unchanged.
    print("\nfeedback loop (verdicts from the first half, measured on the second)...")

    full_scored = base.copy()
    full_scored["score"] = blend(**layers).to_numpy()
    full_ranked = apply_budget(rank_all(full_scored), k=args.k)

    mid_day = int(full_ranked["day"].max() // 2)
    rng = np.random.default_rng(20261029)

    # Ground truth per senior-day: was this person actually declining.
    truth = daily.set_index(["senior_id", "day"])["declining"].to_dict()

    feat_idx = feats.set_index(["senior_id", "day"])
    train_rows = []
    for r in full_ranked[(full_ranked["surfaced"]) & (full_ranked["day"] <= mid_day)].itertuples():
        key = (r.senior_id, r.day)
        try:
            record = feat_idx.loc[key].to_dict()
        except KeyError:
            continue
        top, _, _ = summarise(layer_a.evaluate(record))
        if not top:
            continue
        actually_declining = bool(truth.get(key, False))
        roll = rng.random()
        if roll < 0.10:
            verdict = "unreachable"          # nobody learned anything
        elif rng.random() < 0.85:
            verdict = "true_concern" if actually_declining else "false_alarm"
        else:
            verdict = "false_alarm" if actually_declining else "true_concern"
        train_rows.append({"reasons": top, "verdict": verdict})

    weights = layer_f.fit(pd.DataFrame(train_rows))
    print(f"  {len(train_rows)} verdicts, base rate {weights.base_rate:.3f}")
    tbl = weights.table()
    if not tbl.empty:
        moved = tbl[tbl["multiplier"] != 1.0]
        for row in moved.head(4).itertuples():
            print(f"    {row.code:22} x{row.multiplier:.3f}  ({row.verdicts} verdicts)")
        if moved.empty:
            print("    no reason code had enough verdicts to move")

    # Measure on the untouched second half, with and without the adjustment.
    later = full_ranked[full_ranked["day"] > mid_day].copy()
    later_reasons = []
    for r in later.itertuples():
        try:
            record = feat_idx.loc[(r.senior_id, r.day)].to_dict()
        except KeyError:
            later_reasons.append([])
            continue
        top, _, _ = summarise(layer_a.evaluate(record))
        later_reasons.append(top)

    # Episodes key on real dates; the frame keys on a day index, so the
    # cut has to be translated through the same START the generator used.
    mid_date = START + timedelta(days=mid_day)
    later_eps = [e for e in episodes if e.onset > mid_date]
    before = evaluate(later[["senior_id", "day", "coordinator_id",
                             "days_since_contact", "score"]].copy(),
                      later_eps, args.k, "second half, no feedback")
    after_df = later[["senior_id", "day", "coordinator_id", "days_since_contact"]].copy()
    after_df["score"] = weights.apply(later["score"].to_numpy(), later_reasons).to_numpy()
    after = evaluate(after_df, later_eps, args.k, "second half, with feedback")

    delta = after["precision_at_k"] - before["precision_at_k"]

    # Swept across budgets, not reported at one K. A re-ranking signal this
    # gentle changes who sits at positions 3-10 long before it changes who
    # sits at position 1, so a single K can hide the whole effect — in either
    # direction. Every value measured goes in the table, including the ones
    # that go the wrong way.
    sweep = []
    for kk in (3, 5, 10, 20):
        b = evaluate(later[["senior_id", "day", "coordinator_id",
                            "days_since_contact", "score"]].copy(),
                     later_eps, kk, f"no feedback k={kk}")
        a = evaluate(after_df.copy(), later_eps, kk, f"with feedback k={kk}")
        sweep.append({
            "k": kk,
            "precision_without": b["precision_at_k"],
            "precision_with": a["precision_at_k"],
            "delta": round(a["precision_at_k"] - b["precision_at_k"], 4),
            "recall_without": b["episode_recall"],
            "recall_with": a["episode_recall"],
        })
        print(f"  k={kk:<3} without {b['precision_at_k']:.3f}"
              f"   with {a['precision_at_k']:.3f}"
              f"   ({a['precision_at_k'] - b['precision_at_k']:+.3f})"
              f"   recall {b['episode_recall']:.2f} -> {a['episode_recall']:.2f}")

    helped = [x for x in sweep if x["delta"] > 0]
    if not helped:
        print("  the loop did not improve precision at any budget; reported as measured")

    feedback_result = {
        "verdicts_used": len(train_rows),
        "base_rate": round(float(weights.base_rate), 4),
        "multipliers": weights.table().to_dict(orient="records"),
        "precision_without": before["precision_at_k"],
        "precision_with": after["precision_at_k"],
        "delta": round(float(delta), 4),
        "episodes_in_window": len(later_eps),
        "sweep": sweep,
    }

    # ---- validation on a DIFFERENT decline mechanism ----------------------
    val_dir = REPO / args.validation
    val_result = None
    if val_dir.exists():
        print("\nvalidation cohort (stepwise mechanism, unseen)...")
        vdaily, vnotes, vseniors = load(val_dir)
        vfeats = build(vdaily, vnotes)
        for c in cols:
            if c not in vfeats:
                vfeats[c] = np.nan
        vlayers, _ = score_layers(vfeats, cols, None, None, fitted=fitted)
        vbase = vfeats[["senior_id", "day", "coordinator_id", "days_since_contact"]].copy()
        vbase["score"] = blend(**vlayers).to_numpy()
        val_result = evaluate(vbase, episodes_for(vseniors, vdaily), args.k,
                              "full, unseen mechanism")
        print(f"  precision@{args.k}={val_result['precision_at_k']:.3f} "
              f"(ceiling {val_result['precision_ceiling']:.3f})  "
              f"recall={val_result['episode_recall']:.3f}  "
              f"early median={val_result['median_days_early']:.0f}d  "
              f"before-obvious {val_result['episodes_caught_before_obvious']}"
              f"/{val_result['episodes_total']}")

    # ---- persist ----------------------------------------------------------
    out = REPO / args.out
    out.mkdir(parents=True, exist_ok=True)

    scored = base.copy()
    scored["score"] = blend(**layers).to_numpy()
    for name, vals in layers.items():
        scored[f"score_{name}"] = vals
    ranked = apply_budget(rank_all(scored), k=args.k)

    # ---- reasons, for EVERY scored day ------------------------------------
    # Generated HERE, in the layer that produced the contributions, so the
    # reason text and the score cannot drift apart. The loader copies them
    # verbatim into Postgres rather than recomputing anything in JavaScript.
    #
    # This used to run only over surfaced alerts, which left every other
    # scored day with no explanation at all — and the brief asks for the top
    # reasons behind EACH SCORE, not only behind the ones that made the cut.
    # A coordinator opening a senior who was never alerted still deserves to
    # see why the system thought they were fine. It also means the day a
    # senior ranked eleventh is inspectable after the fact, which is how you
    # tell a near miss from a lucky escape.
    print("explaining every scored day...")
    feat_by_key = feats.set_index(["senior_id", "day"])
    explanations: dict[tuple, tuple[list, str]] = {}
    for r in ranked.itertuples():
        key = (r.senior_id, r.day)
        try:
            record = feat_by_key.loc[key].to_dict()
        except KeyError:
            continue
        top, step, step_hi = summarise(layer_a.evaluate(record))
        if not top:
            # No rule fired. The score is then carried by the baseline, ML and
            # anomaly layers, which is a real finding and gets said plainly
            # rather than left blank.
            top = [{"code": "baseline_shift",
                    "text": "Readings drifting from their own recent range",
                    "text_hi": text_hi_for("baseline_shift", {}),
                    "contribution": round(float(r.score), 3)}]
            step = "Call today and ask how the last few days have been."
            step_hi = next_step_hi_for(["baseline_shift"])
        explanations[key] = (top, step, step_hi)

    scored_out = ranked.copy()
    scored_out["reasons"] = [
        json.dumps(explanations.get((r.senior_id, r.day), ([], "", ""))[0], ensure_ascii=False)
        for r in ranked.itertuples()
    ]
    scored_out["reason_text"] = [
        (explanations.get((r.senior_id, r.day), ([{}], "", ""))[0] or [{}])[0].get("text", "")
        for r in ranked.itertuples()
    ]
    scored_out["next_step"] = [
        explanations.get((r.senior_id, r.day), ([], "", ""))[1] for r in ranked.itertuples()
    ]
    scored_out["next_step_hi"] = [
        explanations.get((r.senior_id, r.day), ([], "", ""))[2] for r in ranked.itertuples()
    ]
    scored_out.to_parquet(out / "scored.parquet", index=False)
    print(f"  {len(explanations)} of {len(ranked)} scored days explained")

    # ---- alerts: the subset a coordinator is actually shown ---------------
    alert_rows = []
    for r in scored_out[scored_out["surfaced"]].itertuples():
        alert_rows.append({
            "senior_id": r.senior_id, "day": int(r.day),
            "coordinator_id": r.coordinator_id,
            "score": float(r.score), "rank_in_day": int(r.rank_in_day),
            "escalated": bool(r.escalated),
            "reasons": r.reasons,
            "reason_text": r.reason_text,
            "next_step": r.next_step,
            "next_step_hi": r.next_step_hi,
        })
    alerts_df = pd.DataFrame(alert_rows)
    alerts_df.to_parquet(out / "alerts.parquet", index=False)
    print(f"  {len(alerts_df)} surfaced alerts")

    import joblib
    joblib.dump(fitted[0], out / "ranker.joblib")
    joblib.dump(fitted[1], out / "isolation_forest.joblib")
    (out / "features.json").write_text(json.dumps(cols, indent=2), encoding="utf-8")

    report = {
        "k": args.k,
        "cohort": {"seniors": int(len(seniors)), "senior_days": int(len(daily)),
                   "planted_declines": int(seniors.declines.sum()),
                   "hard_negatives": int((seniors.hard_negative != "").sum())},
        "features": len(cols),
        "feedback": feedback_result,
        "ablation": results,
        "validation_unseen_mechanism": val_result,
        "days_early_definition": (
            "obvious_day - first surfaced alert day, where obvious_day is the "
            "first day the planted decline reaches strength 0.8. Missed "
            "episodes excluded, not counted as zero."
        ),
        "caveats": [
            "The cohort is synthetic and generated by this repository, so the "
            "supervised number is partly a measure of the generator. The "
            "Isolation Forest and the validation cohort's unseen decline "
            "mechanism exist to bound that circularity, not to remove it.",
            "No real patient data was used at any point.",
        ],
    }
    (out / "metrics.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"\nwrote {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
