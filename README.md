# Samarth Sentinel

Early-warning system for seniors living at home — DEV-104, Samarth Life
Management.

Tells a Care Coordinator **who needs attention today, why, and what to do
next.** Flags concern and routes it to a human. **Never diagnoses.**

The framing matters: a coordinator can act on roughly ten seniors a day, so
this is a **ranking problem under a hard alert budget**, not disease
prediction. Everything below follows from that — including why the headline
metric is precision@K rather than AUC.

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

## Quick start

```bash
cp .env.example .env
make setup          # backend + model + frontend deps
make data           # fetch external reference datasets (~7 MB)
make test           # 30 tests, no services needed
```

Then either `make api` + `make web`, or `docker compose up --build` for the
one-command path judges can run.

Local Postgres is the default rather than a hosted Supabase project, because
free projects pause after a week of inactivity — a bad thing to discover during
judging. Point `SUPABASE_URL` at a hosted project when you need real Auth and
Storage.

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

**Done** — project structure; Supabase schema with RLS; FastAPI app skeleton;
both privacy gates implemented and tested; evaluation harness implemented and
tested; external datasets fetched with licences and checksums recorded.

**Next, and gating everything else** — the synthetic cohort generator
(≥200 seniors × 90 days, planted declines, hard negatives). It blocks Layer C,
the cue extractor, and every metric in the brief's deliverable 4.

**Not started** — Layer A/B/C implementations, cue extraction, the four
frontend views beyond their shells, auth wiring.

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
