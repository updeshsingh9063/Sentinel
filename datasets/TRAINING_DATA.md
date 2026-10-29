# Training data: what is fetched, what must be generated

Short version: **the core risk model cannot be trained from anything on the
internet.** Everything fetchable has now been fetched. The data that actually
trains Layer C and the cue extractor does not exist publicly and has to be
generated — which is what the brief asks for anyway.

## Component by component

| Component | What it needs to train | Source | Status |
|---|---|---|---|
| **Layer A — rules** | Nothing. Thresholds from clinical guidance. | — | Ready |
| **Layer B — own-baseline** | Nothing. Median/MAD is unsupervised, fits per senior at run time. | — | Ready |
| **Layer C — LightGBM** | Labelled senior-days with known decline onset | **None exists** | **Blocked → generate** |
| **Layer C — Isolation Forest** | Unlabelled senior-day feature windows | **None exists** | **Blocked → generate** |
| **FR-2 — cue extractor** | Hinglish call notes labelled with cue spans | **None exists** | **Blocked → generate + lexicon** |
| **FR-2 — encoder init** | Pretrained weights, not data | `l3cube-pune/hing-roberta` (CC-BY-4.0, 1.1 GB) | Available, not downloaded |
| **FR-10 — ASR** | Pretrained weights, not data | `Oriserve/Whisper-Hindi2Hinglish-Prime` (Apache-2.0, 6.2 GB all formats) | Available, not downloaded |
| **FR-10 — fall detection** | Accelerometer traces with fall labels | SisFall | **Fetched** |
| **FR-10 — inactivity** | Activity-labelled windows | UCI HAR | **Fetched** |
| **FR-10 — med flags** | Interaction / geriatric-use text | openFDA | **Fetched** |
| **Cohort realism** | Plausible vitals for 60+ | NHANES | **Fetched** |
| **Note realism** | Hinglish phrasing, romanisation variants | Hinglish corpora | **Fetched** |

## Why the core training set cannot be downloaded

Layer C predicts *this senior is declining, days before the event*. Training
that needs daily records per senior, each labelled with whether decline had
begun. Such a dataset would be longitudinal home-care records with outcomes
attached — i.e. real patient data. It is not public anywhere, for the obvious
reason.

The brief anticipates this and mandates the alternative: **≥200 seniors × 90
days, 10–15% planted declines with known onset, plus hard negatives**, with the
generator documented. That generated cohort *is* the training set. NHANES makes
it plausible rather than invented; it does not replace it.

The same holds for FR-2. There is no public corpus of Hinglish health call
notes. The fetched corpora supply surface realism — spelling variants, negation
markers, code-mix patterns — and the health semantics come from a hand-built
cue lexicon plus generated notes.

## What this means for evaluation

Because you generate both the training data and the labels, **metrics on your
own cohort measure the pipeline, not clinical efficacy.** Say that out loud in
the write-up; the brief rewards honesty about limitations, and judges will
spot it otherwise.

Guards already planned in the PRD, worth keeping:

- Validation cohort from a **different decline mechanism**, not just a different
  seed. A different seed re-samples the same generating process, so a model that
  memorised that process still scores well.
- **Hard negatives** carry the precision number: a flu week that resolves, a
  travel week with missed doses and missed calls, a drifting BP cuff. If these
  are weak, precision@10 is meaningless.
- Ablate **rules → +baseline → +ML → +NLP** and report it even when ML adds
  little. A modest honest gain reads as stronger work than an implausible sweep.

## Fetched datasets: what each can and cannot support

### SisFall — 4,505 trials, 38 subjects, 1,798 falls
Real accelerometer and gyroscope traces. The strongest caveat is in the class
balance by age:

| Group | Subjects | ADL trials | Fall trials |
|---|---|---|---|
| Adult (19–30) | 23 | 1,809 | 1,723 |
| Elderly (60–75) | 15 | 898 | **75** |

Only one elderly participant (SE06) performed falls. **96% of fall examples
come from young adults**, so a model trained naively will learn young-adult
fall dynamics. Split by subject and report elderly performance separately.
Falls are also simulated onto mattresses — no dataset of real unplanned senior
falls exists.

### UCI HAR — 10,299 windows, 30 subjects, 55% sedentary
Clean labels (LAYING/SITTING/STANDING vs three WALKING classes). Volunteers are
aged 19–48, so gait transitions differ from seniors, and the phone is
waist-mounted in a lab protocol. Useful for a sedentary-vs-active classifier;
not a substitute for the primary inactivity signal, which is **call and
check-in silence** — that needs no sensor and works on a basic phone.

### openFDA — 18 drugs, 17 with interaction and geriatric-use text
Free text, not a structured interaction graph, so any check built on it is
keyword matching that routes to a human. US labelling; Indian formulations
differ. FDA's own disclaimer applies: not for making care decisions. This text
must never reach a senior or family member — it is diagnostic-adjacent and
belongs in the coordinator view only.

### NHANES / Hinglish
See `SOURCES.md`.

## Next step

Build the cohort generator. It is the gating dependency for Layer C, the cue
extractor, and every metric in the brief's deliverable 4. Calibrate it from
`processed/vitals_joint_sample_60plus.csv` — draw whole rows so BP, BMI, HbA1c
and glucose stay mutually consistent, rather than sampling each independently.
