"""Fetch external reference datasets for Samarth Sentinel.

Downloads from official sources only, records licence and checksum for every
file, and derives project-ready artifacts under datasets/processed/.

No real patient data is used. NHANES is public-domain, de-identified survey
data from the US CDC; it calibrates the *shape* of the synthetic cohort's
vitals. The Hinglish corpora supply realistic code-mixed phrasing for
synthetic call notes.

Usage:
    python scripts/fetch_datasets.py                 # core sets (~10 MB)
    python scripts/fetch_datasets.py --only nhanes
    python scripts/fetch_datasets.py --sentences 8000
    python scripts/fetch_datasets.py --list
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "datasets" / "raw"
PROCESSED = ROOT / "datasets" / "processed"
MANIFEST = ROOT / "datasets" / "MANIFEST.json"

NHANES_CYCLE = "2017-2018"
# CDC restructured its data paths; the old /Nchs/Nhanes/<cycle>/ URLs now
# answer HTTP 200 with an HTML "Page Not Found" body, so every download must
# be content-validated rather than trusted on status code alone.
NHANES_BASE = "https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2017/DataFiles"

NHANES_FILES = {
    "DEMO_J": "Demographics: age, sex",
    "BPX_J": "Blood pressure, up to 4 readings",
    "BMX_J": "Body measures: weight, height, BMI",
    "GHB_J": "Glycohemoglobin (HbA1c)",
    "GLU_J": "Fasting plasma glucose",
}

HINGLISH_SETS = [
    {
        "id": "findnitai/english-to-hinglish",
        "config": "default",
        "split": "train",
        "license": "apache-2.0",
        "hi_field": ("translation", "hi_ng"),
        "en_field": ("translation", "en"),
    },
    {
        "id": "festvox/cmu_hinglish_dog",
        "config": "default",
        "split": "train",
        "license": "cc-by-sa-3.0 AND gfdl",
        "hi_field": ("translation", "hi_en"),
        "en_field": ("translation", "en"),
    },
]

ROWS_API = "https://datasets-server.huggingface.co/rows"
UA = {"User-Agent": "samarth-sentinel-dataset-fetcher/1.0"}

# --- P2 stretch: inactivity and fall detection -----------------------------
SISFALL_URL = "https://zenodo.org/api/records/22212281/files/SisFall.zip/content"
SISFALL_DOI = "10.5281/zenodo.22212281"
UCIHAR_URL = ("https://archive.ics.uci.edu/static/public/240/"
              "human+activity+recognition+using+smartphones.zip")

# --- P2 stretch: medication interaction flags ------------------------------
# Drugs common in Indian geriatric prescribing. openFDA is US labelling, so
# this is a plausibility reference, not an India-specific formulary.
GERIATRIC_DRUGS = [
    "amlodipine", "telmisartan", "losartan", "metoprolol", "atenolol",
    "metformin", "glimepiride", "atorvastatin", "rosuvastatin",
    "levothyroxine", "aspirin", "clopidogrel", "warfarin", "furosemide",
    "pantoprazole", "amitriptyline", "alprazolam", "tramadol",
]
OPENFDA_LABEL = "https://api.fda.gov/drug/label.json"


def log(msg):
    print(msg, flush=True)


def sha256(path):
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


XPORT_MAGIC = b"HEADER RECORD"


class SourceError(RuntimeError):
    """A download succeeded at the HTTP level but did not return real data."""


def validate(path, magic):
    """Reject soft 404s. CDC serves its error page with HTTP 200, so a status
    check alone would silently write an HTML blob into the dataset."""
    if magic is None:
        return
    with path.open("rb") as fh:
        head = fh.read(256)
    if magic in head:
        return
    snippet = head[:60].decode("utf-8", "replace").strip()
    raise SourceError(
        "{} is not the expected format (got: {!r}). The source URL has most "
        "likely moved -- re-probe it before trusting this data.".format(
            path.name, snippet))


def download(url, dest, timeout=180, magic=None):
    if dest.exists() and dest.stat().st_size > 0:
        validate(dest, magic)
        log("    cached  " + dest.name)
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers=UA)
    tmp = dest.with_suffix(dest.suffix + ".part")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        with tmp.open("wb") as out:
            while True:
                chunk = resp.read(1 << 16)
                if not chunk:
                    break
                out.write(chunk)
    try:
        validate(tmp, magic)
    except SourceError:
        tmp.unlink(missing_ok=True)
        raise
    tmp.replace(dest)
    log("    got     {}  ({:,} bytes)".format(dest.name, dest.stat().st_size))
    return dest


def get_json(url, timeout=60):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


# ---------------------------------------------------------------- NHANES ----

def fetch_nhanes(entries):
    import pandas as pd

    log("\nNHANES " + NHANES_CYCLE + " (US CDC/NCHS, public domain)")
    out_dir = RAW / "nhanes"
    frames = {}

    for name, desc in NHANES_FILES.items():
        url = "{}/{}.xpt".format(NHANES_BASE, name)
        path = download(url, out_dir / (name + ".xpt"), magic=XPORT_MAGIC)
        df = pd.read_sas(path, format="xport")
        frames[name] = df
        entries.append({
            "name": "NHANES {} {}".format(NHANES_CYCLE, name),
            "description": desc,
            "url": url,
            "path": str(path.relative_to(ROOT)).replace("\\", "/"),
            "license": "Public domain (US Government work, 17 U.S.C. 105)",
            "citation": (
                "Centers for Disease Control and Prevention (CDC), National Center "
                "for Health Statistics. National Health and Nutrition Examination "
                "Survey {}, file {}. Hyattsville, MD.".format(NHANES_CYCLE, name)
            ),
            "sha256": sha256(path),
            "bytes": path.stat().st_size,
            "rows": int(len(df)),
        })

    build_vitals_reference(frames, entries)


def build_vitals_reference(frames, entries):
    """Join NHANES files, keep 60+, emit calibration table and joint sample."""
    import numpy as np
    import pandas as pd

    demo = frames["DEMO_J"][["SEQN", "RIDAGEYR", "RIAGENDR"]].copy()
    bpx = frames["BPX_J"].copy()
    bmx = frames["BMX_J"][["SEQN", "BMXWT", "BMXHT", "BMXBMI"]].copy()
    ghb = frames["GHB_J"][["SEQN", "LBXGH"]].copy()
    glu = frames["GLU_J"][["SEQN", "LBXGLU"]].copy()

    # Average the valid replicates. A diastolic reading of 0 means "sound not
    # heard" in NHANES, not a real zero, so it must not enter the mean.
    sys_cols = [c for c in bpx.columns if c.startswith("BPXSY")]
    dia_cols = [c for c in bpx.columns if c.startswith("BPXDI")]
    bp = pd.DataFrame({"SEQN": bpx["SEQN"]})
    bp["SBP"] = bpx[sys_cols].replace(0, np.nan).mean(axis=1)
    bp["DBP"] = bpx[dia_cols].replace(0, np.nan).mean(axis=1)

    df = (demo.merge(bp, on="SEQN", how="left")
              .merge(bmx, on="SEQN", how="left")
              .merge(ghb, on="SEQN", how="left")
              .merge(glu, on="SEQN", how="left"))

    df = df[df["RIDAGEYR"] >= 60].copy()
    df["sex"] = df["RIAGENDR"].map({1.0: "male", 2.0: "female"})
    df["age_band"] = pd.cut(df["RIDAGEYR"], bins=[59, 69, 79, 200],
                            labels=["60-69", "70-79", "80+"])

    measures = {
        "systolic_bp_mmhg": "SBP",
        "diastolic_bp_mmhg": "DBP",
        "weight_kg": "BMXWT",
        "bmi": "BMXBMI",
        "hba1c_pct": "LBXGH",
        "fasting_glucose_mgdl": "LBXGLU",
    }

    rows = []
    for (band, sex), grp in df.groupby(["age_band", "sex"], observed=True):
        for label, col in measures.items():
            s = grp[col].dropna()
            if len(s) < 30:                       # too thin to quote
                continue
            rows.append({
                "age_band": band, "sex": sex, "measure": label, "n": int(len(s)),
                "mean": round(float(s.mean()), 2),
                "sd": round(float(s.std(ddof=1)), 2),
                "p5": round(float(s.quantile(0.05)), 2),
                "p25": round(float(s.quantile(0.25)), 2),
                "p50": round(float(s.quantile(0.50)), 2),
                "p75": round(float(s.quantile(0.75)), 2),
                "p95": round(float(s.quantile(0.95)), 2),
            })

    PROCESSED.mkdir(parents=True, exist_ok=True)
    ref = pd.DataFrame(rows).sort_values(["measure", "age_band", "sex"])
    ref_path = PROCESSED / "vitals_reference_60plus.csv"
    ref.to_csv(ref_path, index=False)
    log("    wrote   {}  ({} rows)".format(ref_path.name, len(ref)))

    # A row-level joint sample preserves the correlation between measures that
    # independent marginals would destroy (BP and BMI co-vary).
    joint = df[["age_band", "sex"] + list(measures.values())].rename(
        columns={v: k for k, v in measures.items()})
    joint = joint.dropna(subset=["systolic_bp_mmhg", "weight_kg"], how="all")
    joint_path = PROCESSED / "vitals_joint_sample_60plus.csv"
    joint.round(2).to_csv(joint_path, index=False)
    log("    wrote   {}  ({} rows)".format(joint_path.name, len(joint)))

    entries.append({
        "name": "Derived: vitals reference, 60+",
        "description": (
            "Age-band x sex summary stats and a row-level joint sample for SBP, "
            "DBP, weight, BMI, HbA1c and fasting glucose. Calibrates the "
            "synthetic cohort generator."
        ),
        "url": "(derived locally from the NHANES files above)",
        "path": "datasets/processed/vitals_reference_60plus.csv",
        "license": "Public domain (derived from NHANES)",
        "citation": "Derived from CDC/NCHS NHANES " + NHANES_CYCLE + ".",
        "sha256": sha256(ref_path),
        "bytes": ref_path.stat().st_size,
        "rows": int(len(ref)),
        "caveats": [
            "NHANES age is top-coded at 80, so the 80+ band is all exactly 80 "
            "and understates spread in the oldest seniors.",
            "US survey population, not Indian. Use for plausible ranges and "
            "covariance structure, not for claims about Indian seniors.",
            "No SpO2 in these files. SpO2 must be synthesised from published "
            "ranges and flagged as such.",
            "Cross-sectional: gives between-person spread, not the within-person "
            "day-to-day variance Layer B needs. Within-person drift is a "
            "generator parameter, documented separately.",
        ],
    })


# -------------------------------------------------------------- Hinglish ----

def fetch_hinglish(entries, target):
    log("\nHinglish corpora (target {:,} sentences per set)".format(target))
    PROCESSED.mkdir(parents=True, exist_ok=True)
    out_path = PROCESSED / "hinglish_sentences.jsonl"

    # Re-runs accumulate: the rows API rate-limits, so a partial fetch should
    # top up the file rather than discard what previous runs already got.
    existing = []
    seen = set()
    if out_path.exists():
        with out_path.open(encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                rec = json.loads(line)
                key = rec["hinglish"].lower().strip()
                if key in seen:
                    continue
                seen.add(key)
                existing.append(rec)
        log("    resuming from {:,} existing sentences".format(len(existing)))

    written = len(existing)
    with out_path.open("w", encoding="utf-8") as out:
        for rec in existing:
            out.write(json.dumps(rec, ensure_ascii=False) + "\n")

        for spec in HINGLISH_SETS:
            have = sum(1 for r in existing if r["source"] == spec["id"])
            need = max(0, target - have)
            if need == 0:
                log("    {}: already have {:,}".format(spec["id"], have))
                entries.append(hinglish_entry(spec, have))
                continue
            pairs = pull_rows(spec, need, skip=have)
            kept = 0
            for hi, en in pairs:
                key = hi.lower().strip()
                if len(key) < 8 or key in seen:
                    continue
                seen.add(key)
                out.write(json.dumps({
                    "hinglish": hi.strip(),
                    "english": en.strip(),
                    "source": spec["id"],
                    "license": spec["license"],
                }, ensure_ascii=False) + "\n")
                kept += 1
                written += 1
            log("    {}: +{:,} new (total {:,})".format(spec["id"], kept, have + kept))
            entries.append(hinglish_entry(spec, have + kept))

    log("    wrote   {}  ({:,} sentences)".format(out_path.name, written))
    build_token_profile(out_path, entries)


def build_token_profile(jsonl_path, entries):
    """Token frequencies from the Hinglish corpus.

    These corpora are movie-domain dialogue and carry essentially no health
    content, so they are NOT a source of health cues. What they do give is
    real romanisation spread -- the same Hindi word spelled several ways in
    Latin script (nahi / nahin / nhi) -- which is what the FR-2 normaliser
    and negation handler have to survive.
    """
    import csv
    import re
    from collections import Counter

    toks = Counter()
    n = 0
    with jsonl_path.open(encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            n += 1
            toks.update(re.findall(r"[a-z']+", json.loads(line)["hinglish"].lower()))

    out = PROCESSED / "hinglish_token_frequencies.csv"
    with out.open("w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["token", "count"])
        for tok, cnt in toks.most_common():
            if cnt >= 2:
                w.writerow([tok, cnt])
    kept = sum(1 for _, c in toks.items() if c >= 2)
    log("    wrote   {}  ({:,} tokens >=2)".format(out.name, kept))

    entries.append({
        "name": "Derived: Hinglish token frequencies",
        "description": (
            "Token counts over the Hinglish sentence pool. Supplies observed "
            "romanisation variants for the FR-2 script normaliser and negation "
            "handler (e.g. nahi / nahin / nhi all appear)."
        ),
        "url": "(derived locally from the Hinglish corpora above)",
        "path": "datasets/processed/hinglish_token_frequencies.csv",
        "license": "Derived from apache-2.0 and cc-by-sa-3.0 sources; "
                   "treat the derived file as cc-by-sa-3.0 (share-alike).",
        "citation": "Derived from findnitai/english-to-hinglish and "
                    "festvox/cmu_hinglish_dog.",
        "sha256": sha256(out),
        "bytes": out.stat().st_size,
        "rows": kept,
        "caveats": [
            "Movie-domain dialogue. A word-boundary scan for health cues "
            "(dard, bukhar, neend, chakkar, dawai, ...) matched 1 of 6,707 "
            "sentences, and that one was a false positive.",
            "Use for surface realism and normalisation only. Health cue "
            "examples must come from the synthetic note generator plus a "
            "hand-built lexicon reviewed by a Hindi speaker.",
        ],
    })


def hinglish_entry(spec, rows):
    return {
        "name": spec["id"],
        "description": "Code-mixed Hindi-English sentence pairs; supplies "
                       "realistic Hinglish phrasing for synthetic call notes.",
        "url": "https://huggingface.co/datasets/" + spec["id"],
        "path": "datasets/processed/hinglish_sentences.jsonl",
        "license": spec["license"],
        "citation": "HuggingFace dataset {}, accessed {}.".format(
            spec["id"], date.today().isoformat()),
        "rows": rows,
    }


def pull_rows(spec, target, skip=0):
    """Page the HF datasets-server rows API. Avoids pyarrow/datasets deps.

    The endpoint rate-limits, so 429 and transient errors back off and retry
    rather than abandoning the corpus.
    """
    out = []
    offset, page = skip, 100
    hi_outer, hi_inner = spec["hi_field"]
    en_outer, en_inner = spec["en_field"]
    total = None

    while len(out) < target:
        url = ("{}?dataset={}&config={}&split={}&offset={}&length={}".format(
            ROWS_API, spec["id"].replace("/", "%2F"), spec["config"],
            spec["split"], offset, page))
        data = None
        for attempt in range(6):
            try:
                data = get_json(url)
                break
            except urllib.error.HTTPError as exc:
                if exc.code not in (429, 502, 503, 504):
                    log("    ! {} HTTP {} at offset {}".format(
                        spec["id"], exc.code, offset))
                    break
                wait = min(60, 5 * (2 ** attempt))
                log("      rate-limited, waiting {}s (attempt {}/6)".format(
                    wait, attempt + 1))
                time.sleep(wait)
            except Exception as exc:
                log("    ! {} error at offset {}: {}".format(spec["id"], offset, exc))
                break
        if data is None:
            log("    ! {} gave up at offset {}; re-run to resume".format(
                spec["id"], offset))
            break
        rows = data.get("rows", [])
        if not rows:
            break
        if total is None:
            total = int(data.get("num_rows_total", 0))
        for r in rows:
            row = r.get("row", {})
            hi_blob = row.get(hi_outer, {})
            en_blob = row.get(en_outer, {})
            hi = hi_blob.get(hi_inner) if isinstance(hi_blob, dict) else None
            en = en_blob.get(en_inner) if isinstance(en_blob, dict) else ""
            if hi:
                out.append((hi, en or ""))
        offset += page
        if total and offset >= total:
            break
        time.sleep(0.15)                           # be polite
    return out[:target]


# ---------------------------------------------- activity / fall (P2) ------

ZIP_MAGIC = b"PK"


def fetch_activity(entries):
    """SisFall and UCI HAR. Both carry real human labels, unlike the cohort."""
    import csv
    import re
    import zipfile

    log("\nActivity and fall datasets (P2 stretch: FR-10)")
    out_dir = RAW / "activity"

    # --- SisFall: 38 subjects incl. 15 aged 60-75, 15 fall types + 19 ADLs --
    sis = download(SISFALL_URL, out_dir / "SisFall.zip", timeout=900,
                   magic=ZIP_MAGIC)
    with zipfile.ZipFile(sis) as z:
        names = [n for n in z.namelist() if n.lower().endswith(".txt")]

    # SisFall trial files are <ActivityCode>_<Subject>_R<trial>.txt where
    # D01-D19 are activities of daily living and F01-F15 are falls.
    pat = re.compile(r"(?:^|/)([DF]\d{2})_(S[AE]\d{2})_R(\d+)\.txt$", re.I)
    rows = []
    for n in names:
        m = pat.search(n)
        if not m:
            continue
        code, subj, trial = m.group(1).upper(), m.group(2).upper(), int(m.group(3))
        rows.append({
            "file": n,
            "activity_code": code,
            "is_fall": int(code.startswith("F")),
            "subject": subj,
            # SA = adult volunteers, SE = elderly participants (60-75)
            "subject_group": "elderly" if subj.startswith("SE") else "adult",
            "trial": trial,
        })

    if not rows:
        raise SourceError(
            "SisFall.zip did not contain the expected <code>_<subject>_R<n>.txt "
            "trial files. The Zenodo record may not be the canonical SisFall.")

    PROCESSED.mkdir(parents=True, exist_ok=True)
    idx = PROCESSED / "sisfall_trial_index.csv"
    with idx.open("w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)

    falls = sum(r["is_fall"] for r in rows)
    elderly = sum(1 for r in rows if r["subject_group"] == "elderly")
    subjects = len({r["subject"] for r in rows})
    log("    wrote   {}  ({:,} trials, {:,} falls, {:,} elderly, {} subjects)"
        .format(idx.name, len(rows), falls, elderly, subjects))

    entries.append({
        "name": "SisFall",
        "description": (
            "Accelerometer and gyroscope traces for falls and activities of "
            "daily living. {} trials across {} subjects; {} trials come from "
            "participants aged 60-75.".format(len(rows), subjects, elderly)
        ),
        "url": "https://doi.org/" + SISFALL_DOI,
        "path": "datasets/raw/activity/SisFall.zip",
        "license": "cc-by-4.0",
        "citation": (
            "Sucerquia, A., Lopez, J.D., Vargas-Bonilla, J.F. SisFall: A Fall "
            "and Movement Dataset. Sensors 2017, 17(1), 198. Zenodo DOI "
            + SISFALL_DOI + "."
        ),
        "sha256": sha256(sis),
        "bytes": sis.stat().st_size,
        "rows": len(rows),
        "caveats": [
            "Falls are simulated by volunteers onto mattresses. No dataset of "
            "real unplanned falls in seniors exists; a model trained here will "
            "not transfer cleanly to real falls, and the write-up must say so.",
            "Only 1 of the 15 elderly participants (SE06) performed falls, "
            "75 trials; the other 14 did ADLs only, for safety. So 1,723 of "
            "the 1,798 fall trials come from adults aged 19-30, and the age "
            "group most at risk is nearly absent from the positive class. "
            "Split by subject and report elderly performance separately.",
            "Sensors are waist-mounted at 200 Hz, not a phone in a pocket. "
            "Expect a domain gap against any real deployment.",
        ],
    })

    # --- UCI HAR: sedentary vs active, for the inactivity signal ------------
    har = download(UCIHAR_URL, out_dir / "uci_har.zip", timeout=900,
                   magic=ZIP_MAGIC)
    build_har_labels(har, entries)


def build_har_labels(zip_path, entries):
    """Derive a sedentary-vs-active label set from UCI HAR.

    Layer B's 'silence' features need a notion of inactivity. HAR gives real
    labelled windows: LAYING/SITTING/STANDING are sedentary, the three WALKING
    classes are active.
    """
    import csv
    import io
    import zipfile

    SEDENTARY = {"LAYING", "SITTING", "STANDING"}
    with zipfile.ZipFile(zip_path) as z:
        inner = [n for n in z.namelist() if n.lower().endswith(".zip")]
        zf = z
        if inner:                                  # UCI sometimes nests a zip
            zf = zipfile.ZipFile(io.BytesIO(z.read(inner[0])))
        names = zf.namelist()

        def find(suffix):
            hits = [n for n in names if n.replace("\\", "/").endswith(suffix)]
            if not hits:
                raise SourceError("UCI HAR zip missing " + suffix)
            return hits[0]

        labels = {}
        for line in zf.read(find("activity_labels.txt")).decode().splitlines():
            if line.strip():
                i, name = line.split(None, 1)
                labels[int(i)] = name.strip()

        rows = []
        for split in ("train", "test"):
            y = zf.read(find(split + "/y_" + split + ".txt")).decode().split()
            subj = zf.read(find(split + "/subject_" + split + ".txt")).decode().split()
            for yi, si in zip(y, subj):
                name = labels[int(yi)]
                rows.append({
                    "split": split,
                    "subject": int(si),
                    "activity": name,
                    "sedentary": int(name in SEDENTARY),
                })

    out = PROCESSED / "har_activity_labels.csv"
    with out.open("w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=["split", "subject", "activity",
                                           "sedentary"])
        w.writeheader()
        w.writerows(rows)
    sed = sum(r["sedentary"] for r in rows)
    log("    wrote   {}  ({:,} windows, {:.0f}% sedentary, {} subjects)".format(
        out.name, len(rows), 100 * sed / len(rows),
        len({r["subject"] for r in rows})))

    entries.append({
        "name": "UCI HAR (Human Activity Recognition Using Smartphones)",
        "description": (
            "Smartphone accelerometer/gyroscope windows labelled with six "
            "activities. Derived file marks each window sedentary or active "
            "for the inactivity signal."
        ),
        "url": "https://doi.org/10.24432/C54S4K",
        "path": "datasets/processed/har_activity_labels.csv",
        "license": "cc-by-4.0",
        "citation": (
            "Anguita, D., Ghio, A., Oneto, L., Parra, X., Reyes-Ortiz, J.L. "
            "A Public Domain Dataset for Human Activity Recognition Using "
            "Smartphones. ESANN 2013. UCI Machine Learning Repository."
        ),
        "sha256": sha256(zip_path),
        "bytes": zip_path.stat().st_size,
        "rows": len(rows),
        "caveats": [
            "Volunteers aged 19-48, not seniors. Gait and posture transitions "
            "differ materially in older adults.",
            "Waist-mounted phone in a lab protocol; real seniors may not carry "
            "a phone at all, which is why inactivity is inferred from call and "
            "check-in silence as the primary signal.",
        ],
    })


# ----------------------------------------------- medications (P2) ---------

def fetch_drug_labels(entries):
    """openFDA drug-interaction text for drugs common in geriatric care."""
    import csv

    log("\nopenFDA drug labels (P2 stretch: missed-dose / interaction flags)")
    rows = []
    for drug in GERIATRIC_DRUGS:
        url = ("{}?search=openfda.generic_name:%22{}%22&limit=1".format(
            OPENFDA_LABEL, drug))
        try:
            data = get_json(url, timeout=45)
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                log("    {:<16} no label found".format(drug))
            else:
                log("    {:<16} HTTP {}".format(drug, exc.code))
            continue
        except Exception as exc:
            log("    {:<16} {}".format(drug, exc))
            continue

        results = data.get("results") or []
        if not results:
            continue
        r = results[0]

        def first(field):
            v = r.get(field)
            return (v[0] if isinstance(v, list) and v else "") or ""

        rows.append({
            "drug": drug,
            "brand_name": "; ".join((r.get("openfda") or {}).get("brand_name", [])[:3]),
            "drug_interactions": first("drug_interactions")[:4000],
            "warnings": first("warnings")[:2000],
            "geriatric_use": first("geriatric_use")[:2000],
        })
        log("    {:<16} ok".format(drug))
        time.sleep(0.3)                            # openFDA is rate-limited

    if not rows:
        log("    ! no labels retrieved; skipping")
        return

    PROCESSED.mkdir(parents=True, exist_ok=True)
    out = PROCESSED / "drug_interactions_geriatric.csv"
    with out.open("w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    with_inter = sum(1 for r in rows if r["drug_interactions"])
    with_ger = sum(1 for r in rows if r["geriatric_use"])
    log("    wrote   {}  ({} drugs, {} with interaction text, {} with "
        "geriatric-use text)".format(out.name, len(rows), with_inter, with_ger))

    entries.append({
        "name": "openFDA drug labels (geriatric subset)",
        "description": (
            "Drug-interaction, warning and geriatric-use text for {} drugs "
            "common in geriatric prescribing.".format(len(rows))
        ),
        "url": OPENFDA_LABEL,
        "path": "datasets/processed/drug_interactions_geriatric.csv",
        "license": "Public domain (US Government work); openFDA terms apply",
        "citation": ("U.S. Food and Drug Administration. openFDA Drug Label "
                     "API, accessed " + date.today().isoformat() + "."),
        "sha256": sha256(out),
        "bytes": out.stat().st_size,
        "rows": len(rows),
        "caveats": [
            "openFDA carries FDA's own disclaimer: not for making decisions "
            "about medical care. Use it to flag a pair for human review only.",
            "US labelling. Indian formulations, brand names and dosing differ.",
            "Free text, not a structured interaction graph. Any interaction "
            "check built on it is keyword matching and must route to a human.",
            "Never surfaces to a senior or family member -- a drug-interaction "
            "string is diagnostic-adjacent and belongs to the coordinator view.",
        ],
    })


# -------------------------------------------------------------------------

def write_manifest(entries):
    # Merge, so a --only run tops up the manifest instead of dropping the
    # entries recorded by the other group.
    merged = {}
    if MANIFEST.exists():
        try:
            prior = json.loads(MANIFEST.read_text(encoding="utf-8"))
            for e in prior.get("datasets", []):
                merged[e["name"]] = e
        except (json.JSONDecodeError, KeyError):
            pass
    for e in entries:
        merged[e["name"]] = e
    entries = sorted(merged.values(), key=lambda e: e["name"])

    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps({
        "generated": date.today().isoformat(),
        "project": "Samarth Sentinel (DEV-104)",
        "note": "No real patient data. External sets calibrate and validate "
                "components; the senior cohort itself is synthetic.",
        "datasets": entries,
    }, indent=2, ensure_ascii=False), encoding="utf-8")
    log("\nmanifest -> {}  ({} entries)".format(
        MANIFEST.relative_to(ROOT), len(entries)))


def main():
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", choices=["nhanes", "hinglish", "activity", "drugs"],
                    help="fetch one group")
    ap.add_argument("--with-activity", action="store_true",
                    help="also fetch SisFall + UCI HAR (~300 MB, P2 stretch)")
    ap.add_argument("--sentences", type=int, default=5000,
                    help="Hinglish sentences per corpus (default 5000)")
    ap.add_argument("--list", action="store_true", help="show sources and exit")
    args = ap.parse_args()

    if args.list:
        log("NHANES " + NHANES_CYCLE + " (CDC, public domain):")
        for n, d in NHANES_FILES.items():
            log("  {:<9} {}".format(n, d))
        log("\nHinglish (HuggingFace):")
        for s in HINGLISH_SETS:
            log("  {:<32} {}".format(s["id"], s["license"]))
        return 0

    entries = []
    try:
        if args.only in (None, "nhanes"):
            fetch_nhanes(entries)
        if args.only in (None, "hinglish"):
            fetch_hinglish(entries, args.sentences)
        if args.only == "activity" or (args.only is None and args.with_activity):
            fetch_activity(entries)
        if args.only in (None, "drugs"):
            fetch_drug_labels(entries)
    except SourceError as exc:
        log("\nSOURCE ERROR: {}".format(exc))
        write_manifest(entries)
        return 1
    except KeyboardInterrupt:
        log("\ninterrupted")
        return 130

    write_manifest(entries)
    log("done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
