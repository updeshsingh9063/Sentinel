# External datasets

The brief requires every dataset and model to be cited. This file is the
citation list; `MANIFEST.json` holds the machine-readable record with URLs,
SHA-256 checksums and row counts for each file.

Reproduce everything with:

```bash
python scripts/fetch_datasets.py
```

**No real patient data is used anywhere in this project.** The senior cohort is
synthetic. These external sets calibrate and validate components of it.

---

## 1. NHANES 2017–2018 — vitals calibration

**Source:** US Centers for Disease Control and Prevention, National Center for
Health Statistics.
**Licence:** Public domain (US Government work, 17 U.S.C. §105). No attribution
required; cited anyway.
**Files:** `DEMO_J` (demographics), `BPX_J` (blood pressure), `BMX_J` (body
measures), `GHB_J` (HbA1c), `GLU_J` (fasting glucose).

> Centers for Disease Control and Prevention (CDC), National Center for Health
> Statistics. *National Health and Nutrition Examination Survey, 2017–2018.*
> Hyattsville, MD: U.S. Department of Health and Human Services.

**What we derive**

| File | Contents |
|---|---|
| `processed/vitals_reference_60plus.csv` | Age-band × sex summary stats (n, mean, sd, p5/p25/p50/p75/p95) for systolic BP, diastolic BP, weight, BMI, HbA1c, fasting glucose |
| `processed/vitals_joint_sample_60plus.csv` | 2,004 row-level records of adults 60+, all six measures |

**Why the joint sample matters.** Sampling each vital independently from its own
marginal distribution destroys the correlation between them — BP and BMI
co-vary, as do HbA1c and glucose. Drawing whole rows from the joint sample keeps
a synthetic senior internally consistent.

**Sanity check that it parsed correctly.** Systolic BP rises across age bands
(134.9 → 146.9 mmHg) while diastolic *falls* (71.9 → 61.5 mmHg). That widening
pulse pressure is real physiology in older adults, which is good evidence the
join and replicate-averaging are right rather than scrambled.

### Caveats — state these in the write-up

- **Age is top-coded at 80.** Everyone 80+ is recorded as exactly 80, so the
  `80+` band understates spread in the oldest seniors.
- **US survey population, not Indian.** Use for plausible ranges and covariance
  structure. Do not make epidemiological claims about Indian seniors from it.
- **No SpO2.** These files contain none. SpO2 must be synthesised from published
  ranges and flagged as a modelling assumption, not a sourced figure.
- **Cross-sectional.** Gives *between-person* spread only. Layer B keys off
  *within-person* day-to-day variation, which this data cannot supply — that
  stays a documented generator parameter.
- **Replicate handling.** A diastolic reading of 0 in NHANES means "sound not
  heard", not a real zero. The loader drops those before averaging; naively
  averaging them would drag diastolic means down by several mmHg.

---

## 2. Hinglish corpora — surface realism for call notes

### findnitai/english-to-hinglish
**Licence:** Apache-2.0 · 5,516 sentence pairs retained
<https://huggingface.co/datasets/findnitai/english-to-hinglish>

### festvox/cmu_hinglish_dog
**Licence:** CC-BY-SA-3.0 AND GFDL · 1,191 sentence pairs retained
<https://huggingface.co/datasets/festvox/cmu_hinglish_dog>

> Zhou, L., Gao, J., Li, D., Shum, H-Y. *The Design and Implementation of
> XiaoIce.* CMU Document Grounded Conversations, Hinglish variant (festvox).

**Share-alike applies.** CC-BY-SA-3.0 propagates to derived files. Anything
built from `hinglish_sentences.jsonl` or `hinglish_token_frequencies.csv`
carries that obligation — relevant because the brief asks for a public repo.

**What we derive**

| File | Contents |
|---|---|
| `processed/hinglish_sentences.jsonl` | 6,707 deduplicated Hinglish/English pairs |
| `processed/hinglish_token_frequencies.csv` | 4,322 tokens occurring ≥2 times |

### What these are honestly good for

**They contain no health content.** Both are movie-domain dialogue. A
word-boundary scan for health cues (`dard`, `bukhar`, `neend`, `chakkar`,
`dawai`, `tabiyat`, `bimar`, …) matched **1 of 6,707 sentences**, and that one
was a false positive about a film character.

So they are **not** a source of training examples for cue extraction. They are
useful for three narrower things:

1. **Romanisation variants.** The same Hindi word appears spelled several ways
   in Latin script. The negation marker alone shows up as `nahi` (933),
   `nahin` (269), `nhi` (80). A cue extractor that only matches one spelling
   will miss real notes. This is directly what FR-2's script normaliser needs.
2. **Negation and hedge markers.** `nahi`/`nahin`/`nhi`, `mat` (15),
   `bilkul` (60), `kabhi` (101), `koi` (172) — observed forms for the negation
   handler. "No pain today" must not fire a pain cue.
3. **Code-mixing patterns.** Realistic sentence shapes for the synthetic call
   note generator, so notes do not read like translated English.

**Health semantics must come from elsewhere:** a hand-built cue lexicon,
reviewed by a Hindi speaker, plus the synthetic note generator. No public
Hinglish health-note corpus exists that we could find, which is unsurprising —
such data would be patient records.

---

## 3. SisFall — fall detection (P2)

**Source:** Zenodo, DOI [10.5281/zenodo.22212281](https://doi.org/10.5281/zenodo.22212281)
**Licence:** CC-BY-4.0 · 4,505 trials, 38 subjects

> Sucerquia, A., Lopez, J.D., Vargas-Bonilla, J.F. *SisFall: A Fall and
> Movement Dataset.* Sensors 2017, 17(1), 198.

Derived: `processed/sisfall_trial_index.csv` — one row per trial with activity
code, fall/ADL flag, subject and age group.

**Caveat that changes how you train.** Only 1 of 15 elderly participants (SE06)
performed falls, 75 trials. 1,723 of 1,798 fall trials come from adults aged
19-30. Split by subject and report elderly performance separately. Falls are
simulated onto mattresses; no dataset of real unplanned senior falls exists.

## 4. UCI HAR — inactivity (P2)

**Source:** UCI Machine Learning Repository, DOI 10.24432/C54S4K
**Licence:** CC-BY-4.0 · 10,299 windows, 30 subjects, 55% sedentary

> Anguita, D., Ghio, A., Oneto, L., Parra, X., Reyes-Ortiz, J.L. *A Public
> Domain Dataset for Human Activity Recognition Using Smartphones.* ESANN 2013.

Derived: `processed/har_activity_labels.csv` — each window marked sedentary
(LAYING/SITTING/STANDING) or active (WALKING variants).

**Caveats.** Volunteers aged 19-48, waist-mounted phone, lab protocol. The
primary inactivity signal in this project stays **call and check-in silence**,
which needs no sensor and works on a basic phone.

## 5. openFDA drug labels — medication flags (P2)

**Source:** US Food and Drug Administration, openFDA Drug Label API
**Licence:** Public domain (US Government work); openFDA terms apply
18 drugs common in geriatric prescribing; 17 with interaction and geriatric-use text.

> U.S. Food and Drug Administration. *openFDA Drug Label API.* Accessed 2026-10-27.

Derived: `processed/drug_interactions_geriatric.csv`.

**Caveats.** Free text, not a structured interaction graph — any check is
keyword matching that routes to a human. US labelling; Indian formulations and
brand names differ. FDA's own disclaimer applies: not for making decisions about
medical care. **Never surface this text to a senior or family member** — it is
diagnostic-adjacent and belongs in the coordinator view only.

---

## Considered and rejected

| Source | Why not |
|---|---|
| **PhysioNet** | Did not respond from this network, and the clinically useful sets (MIMIC) need credentialed access with multi-day approval. Not on the critical path. |
| **Dakshina** (Google, CC-BY-SA-4.0) | 1.9 GB tarball for a transliteration lexicon we only partly need. Opt-in later if normalisation proves weak. |
| **MobiAct / UP-Fall** | Registration forms. SisFall turned out to be openly licensed on Zenodo, so these were unnecessary. |
| `WillHeld/hinglish_top`, `HuggMachas/en-hi-codemixed-corpus`, `ujs/hinglish` | **No declared licence.** The brief requires citing every dataset; an undeclared licence in a public repo is a liability, so these were dropped despite being usable. |
| **Open web scraping** | Rejected deliberately. Unclear provenance, no licence, and scraped health text risks containing real personal data — which collides with the project's own privacy constraint. Every source here has a named publisher and a declared licence. |

---

## Models (not yet downloaded)

Cite these if used. Verify licences before shipping.

- **Whisper-Hindi2Hinglish** (Oriserve) — Apache-2.0. Default Hindi/Hinglish ASR.
- **AI4Bharat IndicWhisper / Vistaar** — Hindi ASR; check licence terms.
- **l3cube-pune/hing-roberta**, **hing-bert**, **hing-bert-lid** — HingBERT
  family for code-mixed encoding and language ID. Confirmed present on
  HuggingFace; licence to verify before use.
- **Bodhan AI Indic-Transcribe** — named in the PRD but unverified from here.
  Do not put it on the critical path until the licence is confirmed.
