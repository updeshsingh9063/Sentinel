# Samarth Sentinel

Early-warning system for seniors living at home — DEV-104, Samarth Life
Management.

Tells a Care Coordinator **who needs attention today, why, and what to do
next.** Flags concern and routes it to a human. **Never diagnoses.**

The framing matters: a coordinator can act on roughly ten seniors a day, so
this is a **ranking problem under a hard alert budget**, not disease
prediction. Everything below follows from that — including why the headline
metric is precision@K rather than AUC.

**Live:** <https://frontend-omega-dusky-18.vercel.app> — sign in as
`coordinator@samarth.demo` / `SamarthDemo!2026` (also `family@`, `ops@`).

**Read first:** [`docs/WRITEUP.md`](docs/WRITEUP.md) — architecture, how the
synthetic cohort was built, and the results including the one stretch goal that
measurably did not work.

Headline numbers, K = 10, 200 seniors over 90 days: **precision@10 = 0.169
against an arithmetic ceiling of 0.192** (88% of achievable), **24/24 planted
declines caught**, every one before the obvious day, median **22 days early**.
The ceiling matters — with 24 episodes across 90 days most days genuinely have
fewer than ten declining seniors.

## Layout

```
samarth-sentinel/
├── frontend/     Next.js 15 + TypeScript — four audiences, four route groups
├── backend/      FastAPI + Supabase (Postgres, Auth, RLS, Storage)
├── model/        Scoring layers, NLP, alert ranking, evaluation harness
├── datasets/     External reference data + provenance (committed)
├── scripts/      Data pipeline entry points
└── docs/         Brief, PRD, architecture
```

| Folder | What lives there |
|---|---|
| `frontend/app/(coordinator)/` | Urgency-sorted worklist; per-senior detail with the personal baseline band |
| `frontend/app/(family)/` | Plain-language summary + consent toggles. No vitals, no score |
| `frontend/app/(ops)/` | Aggregates only |
| `frontend/app/(senior)/` | IVR simulator — large type, three buttons, keypad semantics |
| `backend/supabase/migrations/` | Schema and **RLS policies** — where privacy is actually enforced |
| `backend/app/privacy/` | Never-diagnose gate, PII masking. Both tested |
| `model/samarth_model/scoring/` | Layer A rules, Layer B own-baseline, Layer C ML |
| `model/evaluation/` | precision@K, episode recall, lead time |

## Running it

### The fast path — look at the deployed app

<https://frontend-omega-dusky-18.vercel.app>, credentials above. Nothing to
install. The coordinator account is the one to use: the worklist, a senior
record, and the weekly report are the three screens that carry the work.

### Run the frontend against a Supabase project

```bash
cd frontend
cp .env.local.example .env.local      # fill in the values it lists
npm install
npm run db:migrate                    # schema + RLS, migrations 0001-0007
npm run db:seed                       # demo accounts
npm run db:load-cohort                # 200 seniors x 90 days into Postgres
npm run db:summaries                  # LLM family summaries (needs GROQ_API_KEY)
npm run dev                           # http://localhost:3000
```

`db:load-cohort` truncates `family_summaries`, so **re-run `db:summaries` after
every reload** or the family view will be empty.

`.env.local.example` is the authoritative list of variables and says which are
needed by the app and which only by the admin scripts. The service-role key is
only ever needed locally — a deployment needs four variables, no more.

### Rebuild the cohort and retrain

```bash
python scripts/generate_cohort.py --seniors 200 --days 90
python model/training/train.py            # --k 10 by default
```

Training prints the ablation, the feedback-loop sweep and the validation run,
and writes `model/artifacts/` — of which `metrics.json` is committed, because
the brief grades model metrics as a deliverable.

### Tests

```bash
make test
```

## Hard constraints

These are scored separately in the brief, so they are enforced in code, not
documented as intentions:

| Constraint | Where it is enforced |
|---|---|
| Never names a condition to a senior or family | `backend/app/privacy/safety.py` + 8 tests |
| No unmasked PII leaves the system | `backend/app/privacy/masking.py` + 10 tests |
| Family never sees raw health data | **No RLS policy** on vitals, notes, cues or risk_scores for the family role |
| Ops sees aggregates only | No table policy at all; one security-definer view |
| Precision matters as much as recall | Daily cap, dedupe, cool-down in `model/samarth_model/alerts/` |
| No app for seniors | Voice/keypad only; the web check-in is a demo simulator |
| Cite every dataset | `datasets/MANIFEST.json`, `datasets/SOURCES.md` |

The privacy design choice worth knowing: **the family and ops restrictions are
absences, not checks.** There is no `if role == "family"` to get wrong, because
those roles hold no policy granting access to the tables in question.

## State of the work

All four core capabilities and all five stretch goals are implemented. One
stretch goal is reported as **built and measurably ineffective**; see the
write-up.

| Core requirement | Where |
|---|---|
| Signal ingestion, 4 types | `vitals`, `medication_logs`, `call_notes`, `checkins` |
| Hindi/English cue extraction + STT | `model/samarth_model/nlp/`, `frontend/app/api/transcribe/` |
| Rules + personal baseline + ML + anomaly | `model/samarth_model/scoring/` |
| Reasons and next step, ranked dashboard | all 18,000 scored days carry reasons; `/worklist` |

| Stretch goal | Status |
|---|---|
| Hindi voice check-in bot | Done — `/checkin`, TTS + Whisper, keypad primary |
| LLM family summary | Done — `npm run db:summaries`; 40 written, 1 rejected by the safety gate |
| Fall / inactivity from sensors | **Inactivity only** — steps are scored; falls are detected as spoken mentions, not from accelerometers |
| Coordinator feedback loop | Built; moves precision by ±0.001 and is reported as measured |
| Medication interaction / missed-dose | Done — per-drug missed-dose patterns + 7 rules from the 2023 AGS Beers Criteria |

Every coordinator, family and ops surface reads the live cohort. Nothing in the
signed-in app renders fixtures.

**Known gaps**, stated rather than buried: fall detection from sensor data is
absent; the medication rules match generic names only; model unit tests cover
the metrics module and the intent matcher, with the scoring layers verified by
the ablation instead.

## External data

`make data` pulls ~7 MB from official publishers, recording licence, citation
and SHA-256 for each file in `datasets/MANIFEST.json`.

Read **`datasets/TRAINING_DATA.md`** first. It maps each model component to its
training data and shows which are blocked — notably that **the core risk model
cannot be trained from anything on the internet.** No public dataset has
labelled decline onset for seniors at home; that training set is the synthetic
cohort.

Two caveats that change how you would train, not just footnotes:

- The Hinglish corpora are **movie-domain dialogue with no health content** — a
  word-boundary scan for health cues matched 1 of 6,707 sentences, and that was
  a false positive. They are useful for romanisation variants (`nahi` / `nahin`
  / `nhi`) and negation markers, not for cue examples.
- **96% of SisFall's fall trials come from adults aged 19–30.** Only one of 15
  elderly participants performed falls. Split by subject and report elderly
  performance separately.

## Testing

```bash
make test
```

30 tests, all offline. The ones that matter most are the constraint tests: the
never-diagnose gate (including Hindi and Hinglish framings), PII masking across
four Indian phone formats, and the three evaluation metrics against hand-built
cases that encode *why* each is defined the way it is.
