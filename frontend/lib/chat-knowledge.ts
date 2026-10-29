/**
 * What the site assistant is allowed to know.
 *
 * This is grounding, not training. Nothing is fine-tuned: the relevant facts
 * are sent with each request and the model is told to answer from them and
 * refuse otherwise. That matters here for three reasons — it updates the
 * moment the product does, it costs nothing to change, and an ungrounded
 * claim about a health product is a liability rather than a rough edge.
 *
 * WHY IT IS SPLIT INTO SECTIONS. Groq's free tier allows 8,000 tokens per
 * minute. Sending this whole file as the system prompt cost ~2,300 tokens per
 * question, which ran the budget dry after three questions — measured, not
 * guessed. `retrieve` sends CORE plus only the sections a question actually
 * touches, which cuts a typical request to well under half that.
 *
 * KEEP THIS HONEST. The assistant repeats whatever is written here, so a
 * flattering sentence becomes a false claim in front of a judge. Where the
 * product is unfinished this file says so, and the assistant is instructed to
 * prefer the limitation over the pitch.
 *
 * Deliberately NOT here: the demo password, any Supabase key, anything about
 * seeded individuals. The assistant is also told it has no database access.
 */

interface Section {
  id: string;
  /** Matched case-insensitively against the question, English and Hindi. */
  keywords: string[];
  body: string;
}

/** Always sent. Keep it short — it is the floor cost of every question. */
export const CORE = `
Samarth Sentinel is a hackathon entry for DEV-104, set by Samarth Life
Management. It is an AI-assisted early-warning system that tells a Care
Coordinator WHO among the seniors they support needs attention today, WHY, and
WHAT TO DO NEXT. The problem is attention allocation, not diagnosis: a
coordinator can act on about ten seniors a day, so the hard part is ranking
under a daily limit. Tagline: "Earlier attention. Safer tomorrows."

THE SYSTEM NEVER DIAGNOSES. It flags a change and routes it to a human. It
does not name a condition, does not interpret symptoms, does not adjust
medication, and never contacts a senior on its own. Every path ends at a
person.

Four roles: Care Coordinator (the main user), Family member, Operations
manager, and Senior — who has NO app and NO account, only a simple phone
check-in, because the brief forbids a senior-facing app.

WHO SEES WHAT. Be precise about this — it is the product's central claim, and
both "family sees everything" and "family sees nothing" are wrong.

A family member IS linked to one senior and DOES see: that senior's identity
(name, age, city), a plain-language weekly wellbeing summary about them, and
their own consent switches, which they can change.

A family member NEVER sees: vitals or any reading, risk scores, call notes,
extracted cues, medication logs, check-in answers, alerts, or any condition
name. The database holds no policy granting them those tables, so the queries
return nothing — it is not a setting that can be switched on.

An operations manager sees aggregate counts and rates only, and cannot see any
individual senior at all — not even a name.

Only a Care Coordinator sees an individual senior's health data, and only for
the seniors assigned to them.

All data in the demo is synthetic. No real patient data is used anywhere and
no clinical efficacy is claimed.
`.trim();

const SECTIONS: Section[] = [
  {
    id: "roles",
    keywords: [
      "role", "who", "coordinator", "family", "ops", "operations", "senior",
      "see", "sees", "access", "login", "sign in", "account", "user",
      "reading", "readings", "record", "view", "look up", "show",
      "भूमिका", "कौन", "समन्वयक", "परिवार", "संचालन", "बुज़ुर्ग", "देख", "खाता", "साइन",
    ],
    body: `
Care Coordinator — the main user. Sees a ranked daily worklist, each senior's
own baseline chart, call notes, medication logs, and records a verdict on
every alert.
Family member — linked to one senior. Sees that senior's identity (name, age,
city), a plain-language weekly wellbeing summary, and consent switches they
can change. Sees NO vitals or readings, NO risk score, NO call notes, NO cues,
NO medication logs, NO alerts, NO condition name. Verified against the live
database: a family session reads 1 senior row, 1 summary and its consents, and
zero rows from every health table.
Operations manager — aggregates only: alert volume, median time to first
action, outcome mix, false-alarm rate. No individuals at all.
Senior — no app, no account. Answers a phone check-in (IVR) by pressing 1, 2
or 3 on an ordinary handset. The site has a simulator at /checkin showing what
she hears; it is a simulation, not a product surface.`,
  },
  {
    id: "ranking",
    keywords: [
      "rank", "score", "risk", "alert", "budget", "cap", "baseline", "how does",
      "work", "model", "ml", "ai", "precision", "signal", "vitals", "cue",
      "note", "nlp", "hinglish", "detect", "predict",
      "जोखिम", "स्कोर", "अलर्ट", "सीमा", "कैसे", "काम", "मॉडल", "संकेत", "कारण",
    ],
    body: `
Alerts are capped at a daily budget (3 per coordinator in the demo). Seniors
below the cap are still scored and shown, dimmed, so the cap is auditable.
Ranking is based on change from each senior's OWN baseline — their rolling
median and MAD over a window, computed excluding today — not population
thresholds. A reading unremarkable for one person can be a real change for
another.
Every alert carries plain-language reasons with their contributions and one
concrete next step; reasons are stored with the score so they survive.
Signals: vitals, medication logs, coordinator call notes, phone check-ins,
activity, optional family input.
Hinglish call notes are processed for cues such as dizziness or low appetite.
A negated phrase ("no pain today") raises no cue but is kept and shown to the
human. A senior's own words are quoted exactly as spoken, never interpreted or
translated.
The coordinator's verdict (true concern / false alarm) is what makes precision
measurable. The headline metric is precision@K, not accuracy or AUC, because
the list is capped.`,
  },
  {
    id: "privacy",
    keywords: [
      "privacy", "private", "secure", "security", "rls", "consent", "permission",
      "data", "leak", "protect", "gdpr", "pii", "hide", "hidden", "audit",
      "निजता", "सुरक्षा", "सहमति", "अनुमति", "डेटा", "गोपनीय",
    ],
    body: `
Access control lives in the database as Postgres row-level security, not in
application code. The family and operations roles hold NO policy on the
vitals, call_notes, note_cues or risk_scores tables, so those queries return
zero rows for them however the application is written. This has been tested
against the live database, not assumed.
Consent is per senior and per channel, and absence of a record means no
consent. A family member can change their own consent settings. Audit entries
are append-only.`,
  },
  {
    id: "language",
    keywords: [
      "language", "hindi", "english", "translate", "bilingual", "voice", "ivr",
      "accessible", "accessibility", "phone", "call", "speak",
      "भाषा", "हिंदी", "अंग्रेज़ी", "आवाज़", "फ़ोन", "सुन",
    ],
    body: `
The whole site works in Hindi and English, switchable from the header, and the
choice is remembered. Hindi can be linked directly with ?lang=hi.
The phone check-in is bilingual by design — Hindi is spoken first, then
English. Large type and big touch targets on the check-in screen.
Accessibility is explicitly part of what the brief scores.`,
  },
  {
    id: "state",
    keywords: [
      "built", "finished", "complete", "working", "status", "ready", "trained",
      "training", "dataset", "cohort", "real", "fake", "demo", "fixture",
      "limitation", "roadmap", "next", "todo",
      "बना", "तैयार", "पूरा", "डेटासेट", "प्रशिक्षित", "असली", "सीमा",
    ],
    body: `
Built and working: landing page, sign-in with real Supabase Auth, coordinator
worklist, senior detail with baseline chart and cue timeline, family summary
with consent switches, phone check-in simulator, operations dashboard.
The operations dashboard reads live aggregates from a hosted Supabase
(Postgres) database. The worklist, senior detail and family summary still run
on fixtures.
NOT built yet, and say so plainly if asked: the synthetic cohort generator is
not written, so there is no training dataset; no machine learning model has
been trained or fitted; the risk scores shown are illustrative, not model
output. The demo database holds a generated cohort of 60 seniors over 21 days,
created only so the screens have something realistic to show — it is NOT
training data and no model has learned from it.
If the site footer mentions a cohort of 200 seniors over 90 days, that text is
out of date; the generator has not been run.`,
  },
  {
    id: "tech",
    keywords: [
      "tech", "stack", "built with", "next", "react", "supabase", "postgres",
      "database", "api", "backend", "groq", "llm", "chatbot", "code",
      "तकनीक", "डेटाबेस", "कोड",
    ],
    body: `
Next.js (App Router) and TypeScript on the front end, Supabase (Postgres) for
data and authentication, row-level security for access control, and a FastAPI
backend scaffold. This assistant runs on Groq.`,
  },
  {
    id: "impact",
    keywords: [
      "how many", "statistic", "number", "india", "population", "elderly",
      "ageing", "aging", "scale", "problem", "why", "unfpa", "million",
      "कितने", "आँकड़े", "भारत", "जनसंख्या", "समस्या", "क्यों",
    ],
    body: `
149 million Indians were aged 60 or over in 2022, about 10.5% of the
population, projected to reach 347 million (20.8%) by 2050 — UNFPA India
Ageing Report 2023.
Around 1 in 5 older people live alone or only with a spouse — UNFPA, 2023.
24% face limits on daily activities; 23% have two or more chronic ailments —
UNFPA, 2023.
Samarth supports 40,000+ seniors across 350+ cities, but coordinators
currently prioritise from memory and notes — the problem statement.`,
  },
  {
    id: "try",
    keywords: [
      "try", "demo", "start", "get started", "test", "explore", "show me",
      "where", "click", "navigate", "page",
      "कोशिश", "शुरू", "देखना", "कहाँ", "पेज",
    ],
    body: `
"Get Started" leads to a sign-in page with three demo roles — Care
Coordinator, Family member, Operations manager — plus a fourth card that opens
the senior phone check-in simulator, because a senior has no account.
Signing in as the family member and finding no readings there is the quickest
way to see the privacy model working.`,
  },
];

/**
 * Pick the sections a question touches.
 *
 * Deliberately simple substring matching rather than embeddings: the corpus is
 * eight short sections, an embedding call would add a round trip and more
 * tokens to every question, and a miss here degrades to "I don't have that
 * detail" rather than to a wrong answer.
 *
 * Nothing matched still returns the two broadest sections, so a vague opener
 * like "tell me about this" gets a useful answer instead of a refusal.
 */
export function retrieve(question: string): string {
  const q = question.toLowerCase();

  const hits = SECTIONS.map((s) => ({
    s,
    score: s.keywords.reduce((n, k) => (q.includes(k.toLowerCase()) ? n + 1 : n), 0),
  }))
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((h) => h.s);

  const chosen = hits.length
    ? hits
    : SECTIONS.filter((s) => s.id === "roles" || s.id === "state");

  return [CORE, ...chosen.map((s) => s.body.trim())].join("\n\n");
}
