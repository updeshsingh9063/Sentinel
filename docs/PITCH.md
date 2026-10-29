# Five-minute pitch and demo

Deliverable 5. A running order with what to say, what to click, and the
numbers to quote. Timings are a budget, not a script to read aloud.

**Before you start:** sign in as `coordinator@samarth.demo` on the live site
and leave `/worklist` open in one tab, `/senior/<id>` in a second, the weekly
report in a third, and `/checkin` in a fourth. Switching tabs is faster than
navigating, and a slow page load is four seconds you do not have.

---

## 0:00 — 0:40 · The problem, in their words

> Samarth supports 40,000 seniors across 350 cities. A Care Coordinator looks
> after many families and can act on about ten a day. Today they choose those
> ten from memory and call notes.
>
> So the problem is not "can we predict illness". It is **"which ten people do
> I call this morning, and what do I say when they pick up"**. That is a
> ranking problem under a hard budget, and everything we built follows from it.

Say this before showing anything. It is the sentence that makes the rest of
the demo legible, and it is the brief's own framing handed back.

## 0:40 — 1:50 · The worklist *(the main event — do not rush it)*

Open `/worklist`.

- "This is today's list for one coordinator. Highest concern first, **capped at
  ten**."
- Point at one row: "every row says **why**, with the contribution each reason
  made, and **one concrete next step**. Not a score — an instruction."
- Scroll to the dimmed rows below the cap. **This is the moment that sells
  it:** "these were scored and deliberately held back. Across the window we
  suppress 2,600 alerts to the daily cap and 10,557 to per-senior cooldown.
  We show them dimmed, because a coordinator who cannot see what was withheld
  has no reason to trust the list."
- Click the language switch to Hindi. The reasons and the next steps change
  language too — they are generated in both, not translated in the browser.

## 1:50 — 2:50 · One senior: why we believe it

Open a senior record.

- The baseline chart: "that band is **her own** rolling median, computed
  excluding the day being judged. A systolic of 150 is unremarkable for one
  senior and an emergency change for another. The brief says personal change
  matters more than population averages, so the band is personal."
- The cue timeline: "these are call notes in Hindi and English. The extractor
  pulls cues and **quotes what was actually said** — the code is a lossy
  summary, the sentence is the evidence."
- If a negated cue is visible: "*gire nahi* — 'did not fall'. We record that it
  was said and raise no cue. Getting negation wrong is how you invent a fall."

## 2:50 — 3:30 · The two things it will not do

- `/checkin`: "the senior has **no app**. Three questions, keypad 1-2-3, Hindi
  or English, works on a basic handset. Press 'hear the question'."
- "Whisper invents confident Devanagari from a pure tone. So audio below a
  loudness floor is never sent and we return *no speech* rather than a string
  someone might store. **Silence is evidence, not a gap.**"
- Switch to the family account: "a family member sees plain language and no
  readings. Not hidden — **there is no database policy granting them**. There
  is no `if role == family` to get wrong."

## 3:30 — 4:20 · The numbers

Put the table on screen. Do not read every cell.

| Layer | precision@10 | ceiling |
|---|---|---|
| rules only | 0.132 | 0.192 |
| + personal baseline | 0.140 | 0.192 |
| + ML | 0.169 | 0.192 |
| + anomaly | 0.169 | 0.192 |

- "**Read the ceiling.** 24 planted declines over 90 days with a ten-a-day
  budget means the arithmetic maximum is 0.192 — most days genuinely have
  fewer than ten declining seniors. We reach **88% of what is achievable**."
- "**24 of 24 declines caught, every one before the obvious day, median 22 days
  early.**"
- "The anomaly layer adds nothing measurable. We are reporting it because the
  ablation exists to be honest, not to justify what we built."

## 4:20 — 4:50 · The thing that did not work

Say this. It is worth more than another feature.

> We built the coordinator feedback loop the brief asks for. It learns a
> per-reason multiplier from 1,381 verdicts and it moves precision by **plus or
> minus one thousandth** — nothing. Our reading is that our simulated verdicts
> agree with a ground truth the score already encodes, so they carry no new
> information. Real coordinator verdicts would. We are reporting the mechanism
> as built and the lift as measured, rather than tuning until it looked good.

## 4:50 — 5:00 · Close

> It never diagnoses. It flags a change, says why in plain language, and routes
> it to a person. Everything is live on a synthetic cohort of 200 seniors over
> 90 days, every dataset is cited, and the write-up says what we would not
> claim.

---

## If you are asked

**"Is the data real?"** No, and nothing claims otherwise. 200 synthetic seniors
over 90 days. Vitals are drawn as **whole rows** from NHANES 60+ participants
so the covariance between BP, weight and glucose survives — sampling each
column separately produces people who do not exist. 24 planted declines across
three mechanisms, plus 49 hard negatives that look like decline and are not: a
flu week, a travel week, a drifting cuff.

**"Why is precision only 0.17?"** Because the ceiling is 0.192. Quote the
ceiling first and the question usually does not arrive.

**"What stops it giving medical advice?"** A banned stem, word and phrase gate
over every generated string before storage. It is split into stems and whole
words because a naive substring check fires on "routine" — it contains *uti*.
Of 40 LLM-written family summaries, one was rejected for producing "diabet…"
and discarded rather than edited.

**"Does it scale?"** Free Vercel and Supabase tiers, CPU-only scikit-learn.
The only metered dependency is Groq, at roughly 250 tokens per weekly summary.

**"What's missing?"** Fall detection from accelerometer data — we detect falls
only as spoken mentions. The medication rules match generic names, not brands.
And the feedback loop is unproven on real verdicts.
