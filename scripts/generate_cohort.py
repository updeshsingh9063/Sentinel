"""Generate the synthetic senior cohort.

This is the gating dependency for the whole project: it produces the training
set for Layer C and the cue extractor, and the ground truth for every metric in
the brief deliverable 4. Nothing fetched from the internet can replace it --
see datasets/TRAINING_DATA.md.

Design requirements, from the brief and from what makes the metrics honest:

  * at least 200 seniors x 90 days
  * realistic noise and missing entries
  * 10-15 percent of seniors carry a planted decline with a known onset date
  * hard negatives: a flu week that resolves, a travel week with missed doses
    and missed calls, a drifting BP cuff. These carry the precision number.
  * draw whole rows from datasets/processed/vitals_joint_sample_60plus.csv so
    BP, BMI, HbA1c and glucose stay mutually consistent. Sampling each
    independently destroys the covariance and makes seniors incoherent.
  * the validation cohort must use a DIFFERENT decline mechanism, not just a
    different seed, or a model that memorised the generator still scores well.

Run:
    python scripts/generate_cohort.py --seniors 200 --days 90 --seed 7
    python scripts/generate_cohort.py --seniors 120 --days 90 --seed 23 \
        --mechanism stepwise --out datasets/synthetic/validation
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

REPO = Path(__file__).resolve().parents[1]
VITALS_REF = REPO / "datasets" / "processed" / "vitals_joint_sample_60plus.csv"

# Day 0 of the cohort. Fixed so re-running gives identical dates.
START = date(2025, 1, 6)

CITIES = [
    "Lucknow", "Kanpur", "Varanasi", "Hyderabad", "Pune", "Kochi", "Jaipur",
    "Bhopal", "Nagpur", "Indore", "Patna", "Surat", "Delhi", "Chennai",
]

FIRST_F = ["Lakshmi", "Sarita", "Usha", "Nirmala", "Pushpa", "Shanti", "Rukmini",
           "Vimala", "Asha", "Geeta", "Radha", "Sulochana", "Indira", "Kaveri",
           "Parvati", "Yashoda", "Girija", "Mangala", "Savitri", "Kamla", "Meena"]
FIRST_M = ["Mohan", "Suresh", "Vijay", "Prakash", "Harish", "Narayan", "Shyam",
           "Dinesh", "Ashok", "Gopal", "Krishna", "Madhav", "Bhaskar", "Raghav",
           "Satish", "Kishore", "Anand", "Jagdish", "Ramesh", "Abdul", "Joseph"]
LAST = ["Sharma", "Verma", "Iyer", "Patil", "Reddy", "Gupta", "Das", "Bose",
        "Nair", "Kulkarni", "Shetty", "Bhat", "Chauhan", "Mishra", "Pandey",
        "Rao", "Menon", "Desai", "Devi", "Chandra", "Bai", "Rahman", "D'Souza"]

DRUGS = [("Amlodipine", "5 mg"), ("Metformin", "500 mg"), ("Atorvastatin", "10 mg")]


# --------------------------------------------------------------- notes -----
#
# Note text is assembled from Hinglish fragments rather than sampled from a
# corpus, because no public Hinglish HEALTH-note corpus exists -- the fetched
# code-mixed corpora are movie dialogue and contain no clinical content at all
# (datasets/TRAINING_DATA.md). The fragments below are what the cue extractor
# must handle: spelling variants, negation, and hedges.
#
# NOTE: these strings are a senior's reported words. The generator never writes
# a condition name into them, because the pipeline downstream must never have a
# diagnosis available to leak.

CUE_PHRASES: dict[str, list[str]] = {
    "pain": ["ghutno mein dard hai", "kamar mein dard", "thoda dard hai", "pain in knees"],
    "fall": ["kal gir gayi thi", "bathroom mein slip hua", "gir gaya tha", "had a fall"],
    "confusion": ["naam bhool gayi", "yaad nahi aa raha", "thoda confuse lag raha"],
    "low_appetite": ["khana nahi kha rahi", "bhookh nahi lag rahi", "not eating much"],
    "loneliness": ["akeli baithi rehti hai", "bahut akela lagta hai", "feeling lonely"],
    "dizziness": ["chakkar aa raha hai", "sar ghoom raha hai", "thoda chakkar"],
    "poor_sleep": ["raat ko neend nahi aayi", "so nahi paa rahi", "not sleeping well"],
    "breathlessness": ["saans phool rahi hai", "saans lene mein dikkat", "breathless"],
}

NEGATED_PHRASES: dict[str, list[str]] = {
    "pain": ["aaj koi dard nahi", "dard nahi hai", "no pain today"],
    "fall": ["gire nahi", "koi fall nahi hua"],
    "dizziness": ["chakkar nahi aa raha", "no dizziness"],
    "low_appetite": ["khana theek kha rahi hai", "bhookh theek hai"],
    "poor_sleep": ["neend theek thi", "slept well"],
}

NEUTRAL_OPENERS = [
    "Routine check-in call.", "Spoke to her for a few minutes.",
    "Short call, she sounded fine.", "Daughter picked up, handed the phone over.",
    "Called in the morning.",
]

NEUTRAL_TAILS = [
    "Baaki sab theek hai.", "Everything else seems normal.",
    "Will call again next week.", "Beta aata hai har weekend.",
]


@dataclass
class Senior:
    senior_id: str
    name: str
    age: int
    sex: str
    city: str
    language: str
    coordinator_id: str
    # Personal baselines, drawn as ONE row so they stay mutually consistent.
    base_systolic: float
    base_diastolic: float
    base_weight: float
    base_bmi: float
    base_hba1c: float
    base_glucose: float
    base_pulse: float
    base_spo2: float
    base_activity: float
    # Per-person behaviour
    adherence: float          # baseline probability a dose is logged
    answer_rate: float        # baseline probability a call is answered
    device_use: float         # baseline probability vitals are recorded
    # Ground truth
    declines: bool = False
    onset_day: int | None = None
    mechanism: str | None = None
    hard_negative: str | None = None
    hn_start: int | None = None
    hn_len: int = 0
    notes: list = field(default_factory=list)


def draw_profiles(rng: np.random.Generator, n: int) -> pd.DataFrame:
    """Draw n WHOLE rows from the NHANES 60+ reference sample.

    Whole rows, not per-column draws: systolic, BMI and HbA1c are correlated in
    the real population, and sampling each independently produces seniors who
    do not exist -- a 55 kg frame with a diabetic HbA1c and athletic BP. The
    model would then learn the generator's independence, not physiology.
    """
    if not VITALS_REF.exists():
        raise SystemExit(
            f"missing {VITALS_REF}\nRun scripts/fetch_datasets.py first."
        )
    ref = pd.read_csv(VITALS_REF)
    ref = ref.dropna(subset=["systolic_bp_mmhg", "diastolic_bp_mmhg", "weight_kg", "bmi"])
    idx = rng.integers(0, len(ref), size=n)
    out = ref.iloc[idx].reset_index(drop=True)
    # HbA1c and glucose have genuine gaps in NHANES. Fill from the column
    # median rather than dropping the row, so the covariance of the vitals we
    # do have survives.
    for col, fallback in (("hba1c_pct", 5.7), ("fasting_glucose_mgdl", 100.0)):
        med = ref[col].median()
        out[col] = out[col].fillna(med if pd.notna(med) else fallback)
    return out


def make_seniors(rng: np.random.Generator, n: int, days: int,
                 decline_rate: float, mechanism: str) -> list[Senior]:
    profiles = draw_profiles(rng, n)
    n_coord = max(1, round(n / 35))          # ~35 seniors per coordinator
    seniors: list[Senior] = []

    for i in range(n):
        p = profiles.iloc[i]
        sex = str(p["sex"]).lower()
        female = sex.startswith("f")
        band = str(p["age_band"])
        lo = int(band.split("-")[0]) if "-" in band else 80
        age = int(rng.integers(lo, lo + 10))

        given = rng.choice(FIRST_F if female else FIRST_M)
        name = f"{given} {rng.choice(LAST)}"

        s = Senior(
            senior_id=f"s{i + 1:04d}",
            name=name,
            age=age,
            sex="female" if female else "male",
            city=str(rng.choice(CITIES)),
            language="hi" if rng.random() < 0.72 else "en",
            coordinator_id=f"c{(i % n_coord) + 1:03d}",
            base_systolic=float(p["systolic_bp_mmhg"]),
            base_diastolic=float(p["diastolic_bp_mmhg"]),
            base_weight=float(p["weight_kg"]),
            base_bmi=float(p["bmi"]),
            base_hba1c=float(p["hba1c_pct"]),
            base_glucose=float(p["fasting_glucose_mgdl"]),
            base_pulse=float(rng.normal(74, 7)),
            base_spo2=float(np.clip(rng.normal(96.8, 1.1), 92, 99)),
            base_activity=float(np.clip(rng.normal(2800, 900), 600, 7000)),
            adherence=float(np.clip(rng.beta(8, 2), 0.45, 0.99)),
            answer_rate=float(np.clip(rng.beta(7, 2), 0.35, 0.98)),
            device_use=float(np.clip(rng.beta(6, 2), 0.3, 0.98)),
        )
        seniors.append(s)

    # ---- planted declines -------------------------------------------------
    # Onset sits in [25, days-20] so every declining senior has pre-onset
    # history to form a baseline from AND post-onset runway to be detected in.
    # Without the second margin, "days early" is bounded by the cohort end and
    # the metric measures the generator rather than the model.
    n_decline = int(round(n * decline_rate))
    for i in rng.choice(n, size=n_decline, replace=False):
        s = seniors[int(i)]
        s.declines = True
        s.onset_day = int(rng.integers(25, max(26, days - 20)))
        s.mechanism = mechanism

    # ---- hard negatives ---------------------------------------------------
    # These look like decline and are not. They are what the precision number
    # is actually made of: a model that fires on every perturbation scores well
    # on recall and is useless in a coordinator's morning.
    healthy = [i for i, s in enumerate(seniors) if not s.declines]
    n_hn = int(round(len(healthy) * 0.28))
    for i, kind in zip(
        rng.choice(healthy, size=min(n_hn, len(healthy)), replace=False),
        rng.choice(["flu_week", "travel_week", "cuff_drift"], size=n_hn),
    ):
        s = seniors[int(i)]
        s.hard_negative = str(kind)
        s.hn_start = int(rng.integers(20, max(21, days - 14)))
        s.hn_len = int(rng.integers(5, 11)) if kind != "cuff_drift" else int(rng.integers(12, 25))

    return seniors


def decline_strength(s: Senior, day: int) -> float:
    """How far into the decline this day is, 0 to 1.

    Three mechanisms so the validation cohort can use one the model has never
    seen. A model that learned "a straight ramp in systolic" from `gradual`
    should NOT transfer perfectly to `stepwise`, and if it does, the features
    are picking up something real rather than the generator's shape.
    """
    if not s.declines or s.onset_day is None or day < s.onset_day:
        return 0.0
    t = day - s.onset_day

    if s.mechanism == "stepwise":
        # A jump, a plateau, then a second jump.
        return 0.55 if t < 10 else 0.85 if t < 20 else 1.0
    if s.mechanism == "intermittent":
        # Bad spells with recovery between them. Harder: the signal disappears
        # for days at a time, so anything using only "today vs baseline" misses it.
        phase = (t // 4) % 2
        return 0.0 if phase else min(1.0, 0.35 + 0.08 * t)
    # gradual
    return float(min(1.0, t / 28.0))


def hn_strength(s: Senior, day: int) -> float:
    if s.hard_negative is None or s.hn_start is None:
        return 0.0
    t = day - s.hn_start
    if t < 0 or t >= s.hn_len:
        return 0.0
    if s.hard_negative == "cuff_drift":
        return 1.0                       # a constant device offset, not illness
    # flu and travel: rise then resolve
    half = s.hn_len / 2
    return float(1.0 - abs(t - half) / half)


def build_note(rng: np.random.Generator, s: Senior, day: int,
               dstr: float, hstr: float) -> tuple[str, list[str]]:
    """One call note, plus the cues it genuinely contains (ground truth)."""
    parts = [str(rng.choice(NEUTRAL_OPENERS))]
    present: list[str] = []

    # Cue probability rises with decline. Hard negatives also produce cues --
    # that is the point of them.
    p_cue = 0.06 + 0.55 * dstr + 0.35 * hstr
    pool = ["pain", "poor_sleep", "low_appetite", "dizziness", "confusion",
            "loneliness", "breathlessness", "fall"]
    # Decline skews toward the cues that actually accompany deterioration.
    weights = np.array([0.18, 0.18, 0.17, 0.14, 0.10, 0.10, 0.08, 0.05])
    weights = weights / weights.sum()

    for _ in range(2):
        if rng.random() < p_cue:
            cue = str(rng.choice(pool, p=weights))
            parts.append(str(rng.choice(CUE_PHRASES[cue])))
            present.append(cue)

    # Explicit negatives. A note saying "no pain today" must NOT raise a pain
    # cue; these rows are how the extractor's precision gets measured.
    if rng.random() < 0.22:
        cue = str(rng.choice(list(NEGATED_PHRASES.keys())))
        parts.append(str(rng.choice(NEGATED_PHRASES[cue])))

    if rng.random() < 0.5:
        parts.append(str(rng.choice(NEUTRAL_TAILS)))

    return " ".join(parts), sorted(set(present))


def simulate(rng: np.random.Generator, seniors: list[Senior], days: int):
    daily_rows, note_rows, med_rows = [], [], []

    for s in seniors:
        # A slow personal wander, so "baseline" is not a flat line even when
        # nothing is wrong. Without it, any deviation detector looks brilliant.
        wander = np.cumsum(rng.normal(0, 0.35, days))
        weight_walk = np.cumsum(rng.normal(0, 0.06, days))

        for day in range(days):
            on = START + timedelta(days=day)
            dstr = decline_strength(s, day)
            hstr = hn_strength(s, day)
            dow = on.weekday()

            # ---- vitals ---------------------------------------------------
            sys_bp = (
                s.base_systolic
                + wander[day]
                + 16.0 * dstr                         # decline pushes BP up
                + (9.0 * hstr if s.hard_negative == "cuff_drift" else 0.0)
                + (5.0 * hstr if s.hard_negative == "flu_week" else 0.0)
                + rng.normal(0, 3.4)
            )
            dia_bp = s.base_diastolic + 0.35 * (sys_bp - s.base_systolic) + rng.normal(0, 2.4)
            pulse = s.base_pulse + 9.0 * dstr + 12.0 * (hstr if s.hard_negative == "flu_week" else 0) + rng.normal(0, 4)
            spo2 = s.base_spo2 - 1.6 * dstr - (1.2 * hstr if s.hard_negative == "flu_week" else 0) + rng.normal(0, 0.7)
            weight = s.base_weight + weight_walk[day] - 2.6 * dstr + rng.normal(0, 0.25)
            glucose = s.base_glucose + 14 * dstr + rng.normal(0, 9)
            temp = 36.7 + (1.4 * hstr if s.hard_negative == "flu_week" else 0) + rng.normal(0, 0.18)

            # ---- missingness ----------------------------------------------
            # Missing data is signal. Device use falls as someone declines, and
            # collapses entirely while they are travelling.
            p_device = s.device_use * (1 - 0.35 * dstr)
            if s.hard_negative == "travel_week" and hstr > 0:
                p_device *= 0.15
            has_vitals = rng.random() < p_device

            # ---- adherence -------------------------------------------------
            p_dose = s.adherence * (1 - 0.40 * dstr)
            if s.hard_negative == "travel_week" and hstr > 0:
                p_dose *= 0.45
            doses_due = len(DRUGS) * 2                  # morning + evening
            doses_taken = int(rng.binomial(doses_due, min(0.99, p_dose)))

            for drug, dose in DRUGS:
                for slot in ("morning", "evening"):
                    taken = rng.random() < p_dose
                    med_rows.append({
                        "senior_id": s.senior_id, "day": day, "date": on,
                        "drug": drug, "dose": dose, "slot": slot,
                        "taken": bool(taken),
                    })

            # ---- contact ---------------------------------------------------
            p_answer = s.answer_rate * (1 - 0.30 * dstr)
            if s.hard_negative == "travel_week" and hstr > 0:
                p_answer *= 0.30
            called = dow < 5 or rng.random() < 0.3       # weekdays mostly
            answered = bool(called and rng.random() < p_answer)

            note_text, note_cues = "", []
            if answered and rng.random() < 0.55:
                note_text, note_cues = build_note(rng, s, day, dstr, hstr)
                note_rows.append({
                    "senior_id": s.senior_id, "day": day, "date": on,
                    "text": note_text,
                    "true_cues": ",".join(note_cues),
                })

            # ---- check-in (IVR keypad) -------------------------------------
            checkin_answered = bool(rng.random() < p_answer * 0.9)
            feeling = int(np.clip(round(rng.normal(1.8 + 1.0 * dstr, 0.6)), 1, 3)) if checkin_answered else 0
            painc = int(np.clip(round(rng.normal(1.4 + 0.9 * dstr, 0.6)), 1, 3)) if checkin_answered else 0

            # ---- activity ---------------------------------------------------
            steps = max(0.0, s.base_activity * (1 - 0.45 * dstr)
                        * (0.55 if (s.hard_negative in ("flu_week", "travel_week") and hstr > 0) else 1.0)
                        * (0.85 if dow >= 5 else 1.0)
                        + rng.normal(0, 320))

            daily_rows.append({
                "senior_id": s.senior_id, "day": day, "date": on,
                "coordinator_id": s.coordinator_id,
                "systolic_bp": round(sys_bp, 1) if has_vitals else np.nan,
                "diastolic_bp": round(dia_bp, 1) if has_vitals else np.nan,
                "pulse_bpm": round(pulse, 1) if has_vitals else np.nan,
                "spo2_pct": round(spo2, 1) if has_vitals else np.nan,
                "weight_kg": round(weight, 1) if has_vitals else np.nan,
                "glucose_mgdl": round(glucose, 1) if has_vitals and rng.random() < 0.35 else np.nan,
                "temperature_c": round(temp, 1) if has_vitals else np.nan,
                "doses_due": doses_due,
                "doses_taken": doses_taken,
                "call_attempted": bool(called),
                "call_answered": answered,
                "checkin_answered": checkin_answered,
                "feeling_code": feeling,
                "pain_code": painc,
                "steps": round(steps),
                "note_text": note_text,
                # ---- ground truth, never a feature --------------------------
                "declining": bool(s.declines and s.onset_day is not None and day >= s.onset_day),
                "decline_strength": round(dstr, 4),
                "hard_negative": s.hard_negative or "",
                "hn_active": bool(hstr > 0),
            })

    return (
        pd.DataFrame(daily_rows),
        pd.DataFrame(note_rows),
        pd.DataFrame(med_rows),
    )


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--seniors", type=int, default=200)
    ap.add_argument("--days", type=int, default=90)
    ap.add_argument("--decline-rate", type=float, default=0.12)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--mechanism", default="gradual",
                    choices=["gradual", "stepwise", "intermittent"],
                    help="use a different mechanism for the validation cohort")
    ap.add_argument("--out", default="datasets/synthetic")
    args = ap.parse_args()

    if args.seniors < 200 or args.days < 90:
        print(f"note: brief asks for >=200 seniors x >=90 days; "
              f"generating {args.seniors} x {args.days}", file=sys.stderr)

    rng = np.random.default_rng(args.seed)
    seniors = make_seniors(rng, args.seniors, args.days, args.decline_rate, args.mechanism)
    daily, notes, meds = simulate(rng, seniors, args.days)

    out = (REPO / args.out) if not Path(args.out).is_absolute() else Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    seniors_df = pd.DataFrame([{
        "senior_id": s.senior_id, "name": s.name, "age": s.age, "sex": s.sex,
        "city": s.city, "language": s.language, "coordinator_id": s.coordinator_id,
        "declines": s.declines, "onset_day": s.onset_day, "mechanism": s.mechanism,
        "hard_negative": s.hard_negative or "", "hn_start": s.hn_start,
        "hn_len": s.hn_len,
    } for s in seniors])

    seniors_df.to_parquet(out / "seniors.parquet", index=False)
    daily.to_parquet(out / "daily.parquet", index=False)
    notes.to_parquet(out / "notes.parquet", index=False)
    meds.to_parquet(out / "medications.parquet", index=False)
    # CSV alongside parquet: a judge should be able to open it without pandas.
    seniors_df.to_csv(out / "seniors.csv", index=False)
    daily.head(2000).to_csv(out / "daily_sample.csv", index=False)

    meta = {
        "generated_from": "scripts/generate_cohort.py",
        "seed": args.seed,
        "seniors": args.seniors,
        "days": args.days,
        "start_date": START.isoformat(),
        "decline_rate": args.decline_rate,
        "mechanism": args.mechanism,
        "n_declining": int(seniors_df["declines"].sum()),
        "n_hard_negative": int((seniors_df["hard_negative"] != "").sum()),
        "senior_days": int(len(daily)),
        "notes": int(len(notes)),
        "vitals_missing_pct": round(float(daily["systolic_bp"].isna().mean() * 100), 2),
        "vitals_reference": "datasets/processed/vitals_joint_sample_60plus.csv (NHANES 2017-2018, public domain)",
        "ground_truth_columns": ["declining", "decline_strength", "hard_negative", "hn_active"],
        "warning": "Synthetic. Not real patient data. Ground-truth columns must never be used as model features.",
    }
    (out / "manifest.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")

    print(f"wrote {out}")
    for k, v in meta.items():
        if k not in ("warning", "ground_truth_columns"):
            print(f"  {k:22} {v}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
