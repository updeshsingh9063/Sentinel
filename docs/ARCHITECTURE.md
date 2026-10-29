# Architecture

Written for the team. Explains why the pieces sit where they do, so decisions
do not get quietly undone during the build.

## The shape of the problem

The brief looks like a prediction task and is not one. Its own framing is that
the bottleneck is **attention allocation**: a coordinator carries many families
and can act on about ten seniors a day. So the system answers

> which ten seniors should this coordinator call today, and what should they say

rather than "will this senior deteriorate". Three consequences follow, and they
drive most of the design:

1. **Optimise precision@K, not AUC.** A model with excellent AUC that puts the
   real cases at rank 40 is useless, because nobody scrolls to rank 40.
2. **Recall is per episode, not per day.** A 14-day decline is one thing the
   coordinator needed to catch, not fourteen.
3. **Suppression is a feature.** Caps, dedupe and cool-down are not polish;
   they are what keeps the list worth reading. See `alerts/budget.py`.

## Data flow

```
   signals                  features                scoring              output
 ┌──────────┐            ┌─────────────┐        ┌─────────────┐     ┌───────────┐
 │ vitals   │            │             │        │ A  rules    │     │ worklist  │
 │ med logs │──ingest──▶ │ windowed    │──────▶ │ B  baseline │────▶│ (capped,  │
 │ call     │            │ 3/7/14/28d  │        │ C  ML+iso   │     │  ranked,  │
 │  notes   │            │ + silence   │        │ NLP cues    │     │  reasoned)│
 │ IVR      │            └─────────────┘        └─────────────┘     └───────────┘
 └──────────┘                                          │                  │
                                                       ▼                  ▼
                                                  risk_scores         alerts
                                                  (per layer)      (one per day)
```

Scores are written per senior-day with **each layer kept in its own column**.
That is deliberate: the brief wants an ablation, and storing only the blended
score would make it unreproducible after the fact.

## Why the layers are separate

| Layer | Trains on | Why it exists |
|---|---|---|
| **A — rules** | nothing | Catches the obvious. Clinically legible, so a coordinator can sanity-check it |
| **B — own-baseline** | nothing (unsupervised) | The brief says twice that deviation from a *personal* baseline beats population averages. A systolic of 150 is unremarkable for one senior and an emergency delta for another |
| **C — ML** | synthetic cohort | Catches combinations the rules miss |

Layer B uses **rolling median and MAD**, not mean and standard deviation: one
cuff error should not move the band it is being judged against. It also
excludes the current day from its own baseline, or an extreme reading would
drag the baseline toward itself and mask the very deviation being measured.

**Silence is a first-class signal.** Unanswered calls, skipped check-ins and
absent vitals are among the strongest early indicators, cost nothing to
compute, and need no sensor — which matters because the senior may have only a
basic phone. Missing data is evidence, not a gap to impute.

## Where privacy lives

In Postgres, not in Python. The two structural guarantees:

- **A family member has no RLS policy** on `vitals`, `call_notes`, `note_cues`
  or `risk_scores`. There is no `if role == "family"` branch to get wrong.
  Their single health-adjacent read is `family_summaries`, gated on a granted
  consent row *and* a `safety_checked` flag.
- **Ops has no table policy anywhere.** Its entire access is the
  `ops_daily_metrics` view, which has already aggregated away the individual.

`audit_log` has an insert policy and no update or delete policy at all, so
history cannot be rewritten through the API even by an admin.

The service-role key bypasses RLS and is therefore confined to the nightly
scoring job. It must never be bound to a user-triggered route.

## The never-diagnose gate

`backend/app/privacy/safety.py` splits the banned list in two, because the
constraint is not uniform:

- **Condition names** (`dementia`, `pneumonia`, `diabetes`, …) are banned on
  every channel, including the coordinator one. The system is not licensed to
  conclude any of them.
- **Diagnostic framing** (`you have`, `symptoms of`, `aapko ... bimari hai`)
  is banned on the senior and family channels only. A coordinator may
  legitimately read "BP above personal baseline for 6 days".

Hindi and Hinglish framings are in the list too. An English-only gate would
miss the most likely leak, since the senior channel speaks Hindi.

The gate **fails closed**: no message rather than a bad one.

## Evaluation, and its honest limits

`model/evaluation/metrics.py` implements the three numbers the brief grades.
The module docstring explains each definition; the tests encode why.

The limitation to state out loud in the write-up: **we generate both the
training data and the labels, so metrics measure the pipeline, not clinical
efficacy.** Guards that make the number mean something:

- The validation cohort must use a **different decline mechanism**, not just a
  different seed. A different seed re-samples the same generating process, so a
  model that memorised that process still scores well.
- **Hard negatives carry the precision number** — a flu week that resolves, a
  travel week with missed doses and missed calls, a drifting BP cuff. Weak hard
  negatives make precision@K meaningless.
- Split by senior, never by row. Adjacent days of one senior are near
  duplicates, so a random row split leaks.
- Report the ablation even when ML adds little over the baseline. A modest
  honest gain reads as stronger work than an implausible sweep.

## Conventions

- `model/` imports neither FastAPI nor Supabase. It is shared by the API and
  the training scripts, so it stays framework-free.
- `frontend/lib/types.ts` mirrors `backend/app/schemas/core.py`. Keep them in
  step by hand; generating types is not worth the setup at this size.
- Reason text is **template-generated**. An LLM may soften tone, never author
  content, because a template cannot invent a diagnosis.
- Every outbound message passes `assert_safe` before send, every outbound
  external call passes `assert_masked`.
