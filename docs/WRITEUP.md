# Samarth Sentinel — DEV-104

An early-warning system that tells a Care Coordinator **who needs attention
today, why, and what to do next**, for seniors living at home.

Live: `https://samarth-sentinel.vercel.app` · Source: `github.com/updeshsingh9063/Sentinel`
Sign in as `coordinator@samarth.demo` / `SamarthDemo!2026` (also `family@`, `ops@`).

---

## 1. The problem we actually solved

The brief's own framing is that the bottleneck is **attention allocation**, not
data scarcity. Samarth's coordinators each carry many families and can act on
roughly ten seniors a day. So the task is not "is this person at risk" — it is
"which ten should be called this morning, and what do I say".

That decides everything downstream. We optimise and report **precision@K
against a fixed daily budget**, not AUC, because a model that ranks beautifully
and overflows the queue is useless to the person holding the phone.

## 2. Architecture

```
synthetic cohort ──► features ──► four scoring layers ──► rank + budget ──► alerts
 200 × 90 days       55 cols      rules · baseline          cap K=10        reasons
 NHANES-calibrated   trailing     ML · anomaly              + cooldown      next step
                     windows                                                   │
                                                                               ▼
   Postgres (Supabase) ── row-level security ──► Next.js 15, server-rendered
        │                                             │
        ├── coordinator: worklist, senior detail, weekly report
        ├── family:      plain-language summary only
        └── ops:         aggregates only, no individual record
```

**Stack.** Next.js 15 (App Router, server components), Supabase Postgres with
RLS, Python 3.11 + scikit-learn for the model, Groq for speech-to-text and for
the family summaries. It runs on a free Vercel tier and a free Supabase
project; nothing here needs a GPU.

**Access control is the schema, not the code.** The family role has *no policy*
on `vitals`, `call_notes`, `note_cues` or `risk_scores`, so those tables return
zero rows for a family account — there is no filter in the application that
could be forgotten. Where family needed one narrow fact (was the phone
answered), we added a three-column view rather than widening a policy, because
RLS is row-level and cannot hide columns. Verified by querying as each role:
anon `401`, family 30 rows of three columns, coordinator and ops `0`.

## 3. The four core capabilities

**1 · Signal ingestion.** Five types per senior: vitals (BP, pulse, SpO₂,
weight, glucose, daily step count), medication logs, free-text call notes, IVR
check-in answers, and notes written by the family. Live counts: 4,387 / 17,340
/ 1,890 / 6,000. The family channel is the only one that travels inward: a
daughter noticing her father sounded confused on Sunday knows something no
sensor recorded, and it reaches the coordinator responsible for him and nobody
else.

**2 · Unstructured understanding.** A Hindi–English cue extractor over call
notes produces eight cue types (pain, fall, poor sleep, dizziness, low
appetite, loneliness, confusion, breathlessness). Two failure modes drove the
design and both are in the tests: substring matching scored *badhiya*
("excellent") as "bad", and intrinsic negation turned *koi badlav nahi* ("no
change") into a complaint. Matching is whole-word across both scripts, and
negated cues are recorded and excluded rather than dropped — *gire nahi* ("did
not fall") is evidence. Speech-to-text uses Whisper `large-v3-turbo`.

**3 · Risk scoring.** A daily score per senior from four layers: deterministic
rules, a **personal** baseline (rolling median and MAD, computed excluding
today), a HistGradientBoosting ranker, and an IsolationForest anomaly score.
The brief says twice that personal change matters more than population
averages, so the baseline carries the largest blend weight (0.40) and the band
is always that senior's own.

**4 · Explainable action.** Every one of the 18,000 scored days carries its top
reasons and a concrete next step, **in both English and Hindi**, generated in
the same layer that produced the contributions so the text cannot drift from
the number. Both languages are produced from the same `RuleHit` values rather
than by translating the English sentence, so they state the same figures by
construction, and both pass the never-diagnose gate before storage — a string
translated at render time would be the one sentence on the page nobody checked.

## 4. How the synthetic data was built

`scripts/generate_cohort.py` — 200 seniors × 90 days.

- **Vitals are drawn as whole rows** from NHANES 2017–18 participants aged 60+,
  not sampled per-variable, so the covariance between BP, weight and glucose
  survives. Sampling each column independently produces people who do not exist.
- **24 planted declines** across three mechanisms — gradual, stepwise and
  intermittent — each with a `detectable_from` day, so lead time is measured
  against when a signal first existed rather than when the condition started.
  Claiming credit for predicting before any evidence existed would be dishonest.
- **49 hard negatives** that look like decline and are not: a flu week, a
  travel week with missed calls, and a drifting BP cuff. Without these, "catch
  everything" scores well.
- Realistic noise, missing days and unreachable calls throughout. A missing
  reading stays missing; nothing is interpolated.

NHANES is a US survey population. It is used for plausible ranges and
covariance, never for claims about Indian seniors. Every dataset and model is
cited in `datasets/MANIFEST.json`, including the generated landing photography,
which is recorded as synthetic with the people stated not to be real.

## 5. Results

K = 10, the brief's daily budget. 200 seniors, 18,000 senior-days, 24 planted
declines, 49 hard negatives, 55 features.

| Layer | precision@10 | ceiling | episode recall | median days early |
|---|---|---|---|---|
| rules only | 0.132 | 0.192 | 1.00 | 22 |
| + personal baseline | 0.140 | 0.192 | 1.00 | 22 |
| + ML | **0.169** | 0.192 | 1.00 | 21 |
| + anomaly (full) | **0.169** | 0.192 | 1.00 | 22 |

**Read the ceiling, not the raw number.** With 24 episodes spread across 90
days and a 10-a-day budget, the arithmetic maximum precision@10 is **0.192** —
most days genuinely have fewer than ten declining seniors, so the rest of the
list is correctly non-urgent. The full stack reaches **88% of what is
achievable**. Quoting 0.169 without the ceiling understates it; quoting it as
"83% error" would be a misreading.

**All 24 declines are caught, every one before the obvious day**, at a median
of 22 days' lead.

**The anomaly layer adds nothing measurable** (+0.000 over ML). It is reported
because the ablation exists to be honest, not to justify what was built.

**Alert fatigue is enforced, not claimed.** On the full stack, 4,843 alerts
surface; 2,600 are suppressed by the daily cap and 10,557 by per-senior
cooldown. The interface shows the suppressed rows dimmed rather than hiding
them — a coordinator who cannot see what was withheld has no reason to trust
the list.

### The feedback loop did not work, and that is the finding

Coordinators mark each alert a true concern, a false alarm, or unreachable.
`scoring/feedback.py` learns a per-reason-code multiplier from those verdicts,
capped at +25% / −20% so a run of false alarms can quieten a signal but never
bury it, fitted on the first half of the window and measured on the second.

It learns sensible weights from 1,381 verdicts — `cue_low_appetite` ×1.13,
`bp_very_high` ×0.89 — and then moves precision by:

| K | 3 | 5 | 10 | 20 |
|---|---|---|---|---|
| Δ precision | +0.001 | −0.001 | 0.000 | +0.000 |

Our reading: the simulated verdicts are 85% reflections of a ground truth the
score already encodes, so per-reason precision carries no information the model
lacks. Real coordinator verdicts would. We are reporting the mechanism as built
and the lift as measured, rather than tuning until the number turned positive.

## 6. Constraints, and how each is enforced

**Never diagnoses.** A banned stem/word/phrase gate runs over every generated
string before storage, split into stems and whole words because a naive
substring check fires on "routine" (contains *uti*). Of 40 LLM-written family
summaries, **1 was rejected** for producing "diabet…" and discarded rather than
edited — silently repairing unsafe output teaches you nothing about how often
it happens.

**Low-tech seniors.** The check-in works over a phone call: six short
questions — how they feel, pain, medicines, sleep, eating, and whether they
have had a fall — answered on keypad 1/2/3, in Hindi or English. The keypad is
the primary interface, not a fallback. The questions map onto cue types the
model already scores, so the call and the notes describe the same things.

**Three ways in, and the cheapest one is the point.** The brief offers a
senior "a voice note, a missed-call check-in or a one-tap reply", and all
three exist. The third is the one that matters most for the people this is
actually for: a missed call needs no smartphone, no data, no literacy and no
app. The senior dials and hangs up. A telephony provider posts to
`/api/checkin/missed-call`, and the day is recorded.

What that record does *not* say is the design decision. A dial-and-hang-up
confirms somebody was up and able to dial — nothing about pain, mood or
medication. So `checkins.source` names the channel, the detail columns stay
null, and the coordinator's contact history reads "Missed call — no questions
were answered" rather than letting a week of silence-with-a-pulse look like a
week of reassurance.

The webhook holds no credential. Authorization is a security-definer function
that checks a shared secret against a stored digest, so the deployment never
needs a service-role key to write one boolean; compromising the web host buys
an attacker the ability to mark people as having phoned in, and nothing else.
`npm run verify:missed-call` asserts all of it, including that a caller
without the secret cannot tell an enrolled number from an unenrolled one.

Yes and no do not point the same way across those questions, and the polarity
is declared per question rather than inferred: "did you take your medicine" and
"have you eaten" are good when yes, "have you had a fall" is bad when yes.
Getting that backwards would record the opposite of what a senior said, so it
is tested in both scripts. Whisper hallucinates confident Devanagari from a pure tone, so audio
below a loudness floor is never sent and "no speech" is returned rather than a
string a caller might store — silence is evidence, not a gap.

**Privacy.** Role-based access enforced by RLS as above; consent is checked per
scope and revoking it empties the family view on the next query.

No identity reaches an external service. The weekly family summaries are
written by a model that is never shown the senior's name — it receives a
placeholder, and the real name is substituted back locally after generation.
The generator refuses to send a prompt that contains the name, so the masking
cannot be undone by a later edit without the run failing. The transcription
route forwards audio once, stores nothing, and sends no name with it.

**Low cost.** Free Vercel and Supabase tiers. Inference is CPU-only
scikit-learn. The only paid-tier dependency is Groq, used for STT and for
weekly summaries — roughly 250 tokens per summary.

## 7. Stretch goals

| Goal | Status |
|---|---|
| Voice check-in bot in Hindi | Done — TTS + Whisper, 3 questions, both languages |
| LLM family summary in plain language | Done — 40 generated, 1 rejected by the safety gate |
| Fall / inactivity from sensor data | **Inactivity only** — daily steps are scored (weight 0.14); falls are detected as *mentions* in call notes, not from accelerometer data |
| Coordinator feedback loop | Built; measured no improvement (§5) |
| Medication interaction / missed-dose flags | Done — per-drug missed-dose patterns, plus 7 rules from the 2023 AGS Beers Criteria (doi:10.1111/jgs.18372), each citing its table |

## 8. What we would not claim

- The cohort is synthetic. No clinical efficacy is demonstrated and none is claimed.
- Vitals are calibrated on a US survey population, not an Indian one.
- Fall detection from sensors is not implemented; only spoken mentions are.
- The feedback loop is unproven on real verdicts.
- Model tests cover the metrics module and the intent matcher; the scoring
  layers are verified by the ablation rather than by unit tests.
- Brand-name drugs are not resolved to generics, so the medication rules match
  only generic names.
- Hindi reason text is template-based, not model-translated. Each rule has a
  hand-written Hindi sentence with the same numeric slots as its English
  counterpart; a rule added without one falls back to English rather than
  rendering a blank.

---

*Prototype built for DEV-104, Samarth Life Management. No real patient data.
The system flags risk and routes it to a human; it never diagnoses.*
