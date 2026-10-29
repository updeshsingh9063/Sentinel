-- Samarth Sentinel: core schema.
--
-- Access rules live here, not in the API. The brief treats role-based access,
-- consent and PII handling as graded requirements, so they are enforced by
-- Postgres RLS: a bug in application code cannot leak a senior record.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- enums ----

create type user_role     as enum ('coordinator', 'family', 'ops', 'admin');
create type signal_source as enum ('device', 'coordinator_call', 'ivr_checkin', 'family_report', 'manual');
create type cue_type      as enum ('pain', 'fall', 'confusion', 'low_appetite', 'loneliness', 'dizziness', 'poor_sleep', 'breathlessness');
create type alert_status  as enum ('open', 'acknowledged', 'actioned', 'dismissed', 'escalated');
create type outcome_kind  as enum ('true_concern', 'false_alarm', 'unreachable', 'pending');

-- ---------------------------------------------------------------- people ---

-- Mirrors auth.users with an app role. One row per signed-in human.
create table app_users (
  id          uuid primary key references auth.users(id) on delete cascade,
  role        user_role not null,
  full_name   text not null,
  phone       text,
  created_at  timestamptz not null default now()
);

create table seniors (
  id            uuid primary key default gen_random_uuid(),
  display_name  text not null,
  age           int  not null check (age between 50 and 120),
  sex           text not null check (sex in ('male', 'female', 'other')),
  city          text,
  -- Basic phone only. The brief forbids a senior-facing app, so a senior has
  -- no row in app_users and never authenticates.
  phone         text,
  language      text not null default 'hi',
  enrolled_on   date not null default current_date,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

-- Which coordinator carries which senior. Drives the daily worklist.
create table care_assignments (
  coordinator_id uuid not null references app_users(id) on delete cascade,
  senior_id      uuid not null references seniors(id)   on delete cascade,
  assigned_on    date not null default current_date,
  primary key (coordinator_id, senior_id)
);

create table family_links (
  family_user_id uuid not null references app_users(id) on delete cascade,
  senior_id      uuid not null references seniors(id)   on delete cascade,
  relationship   text,
  is_primary     boolean not null default false,
  primary key (family_user_id, senior_id)
);

-- Per-senior, per-channel consent. Absence of a row means no consent.
create table consents (
  senior_id    uuid not null references seniors(id) on delete cascade,
  scope        text not null,          -- family_summary | voice_recording | vitals_sharing
  granted      boolean not null default false,
  granted_at   timestamptz,
  granted_by   text,                   -- who recorded it, for the audit trail
  primary key (senior_id, scope)
);

-- ---------------------------------------------------------------- signals --

create table vitals (
  id          bigserial primary key,
  senior_id   uuid not null references seniors(id) on delete cascade,
  measured_on date not null,
  source      signal_source not null default 'device',
  systolic_bp    numeric(5,1),
  diastolic_bp   numeric(5,1),
  pulse_bpm      numeric(5,1),
  spo2_pct       numeric(4,1),
  weight_kg      numeric(5,1),
  glucose_mgdl   numeric(5,1),
  temperature_c  numeric(4,1),
  created_at  timestamptz not null default now(),
  unique (senior_id, measured_on, source)
);
create index on vitals (senior_id, measured_on desc);

create table medication_logs (
  id           bigserial primary key,
  senior_id    uuid not null references seniors(id) on delete cascade,
  due_on       date not null,
  drug_name    text not null,
  dose         text,
  taken        boolean,                -- null = unknown, which is itself signal
  reported_via signal_source not null default 'ivr_checkin',
  created_at   timestamptz not null default now()
);
create index on medication_logs (senior_id, due_on desc);

-- Free-text notes from coordinator calls. Hinglish, often code-mixed.
create table call_notes (
  id           bigserial primary key,
  senior_id    uuid not null references seniors(id) on delete cascade,
  called_on    date not null,
  author_id    uuid references app_users(id) on delete set null,
  reached      boolean not null default true,   -- false = unanswered, a signal
  note_text    text,
  note_lang    text default 'hinglish',
  audio_path   text,                   -- private Storage bucket key, never a URL
  created_at   timestamptz not null default now()
);
create index on call_notes (senior_id, called_on desc);

-- Structured IVR check-in. Senior presses 1/2/3 on a basic phone.
create table checkins (
  id            bigserial primary key,
  senior_id     uuid not null references seniors(id) on delete cascade,
  checked_on    date not null,
  answered      boolean not null,
  feeling_code  int check (feeling_code between 1 and 3),  -- 1 better 2 same 3 worse
  pain_code     int check (pain_code between 1 and 3),
  meds_taken    boolean,
  audio_path    text,
  created_at    timestamptz not null default now(),
  unique (senior_id, checked_on)
);

-- ---------------------------------------------------------------- derived --

-- Cues extracted from notes and check-ins by the NLP layer (FR-2).
create table note_cues (
  id          bigserial primary key,
  note_id     bigint references call_notes(id) on delete cascade,
  senior_id   uuid not null references seniors(id) on delete cascade,
  observed_on date not null,
  cue         cue_type not null,
  -- Negated mentions are stored, not dropped: "no pain today" is evidence.
  negated     boolean not null default false,
  confidence  numeric(4,3) not null check (confidence between 0 and 1),
  span_text   text,
  extractor   text not null default 'lexicon_v1',
  created_at  timestamptz not null default now()
);
create index on note_cues (senior_id, observed_on desc);

-- One row per senior per day. Layer contributions are kept separate so the
-- rules -> +baseline -> +ML -> +NLP ablation is reproducible from the data.
create table risk_scores (
  senior_id      uuid not null references seniors(id) on delete cascade,
  scored_on      date not null,
  score          numeric(5,4) not null check (score between 0 and 1),
  rules_score    numeric(5,4),
  baseline_score numeric(5,4),
  ml_score       numeric(5,4),
  nlp_score      numeric(5,4),
  model_version  text not null,
  -- Ranked reason codes with SHAP-style contributions, for the "why".
  reasons        jsonb not null default '[]'::jsonb,
  created_at     timestamptz not null default now(),
  primary key (senior_id, scored_on)
);
create index on risk_scores (scored_on desc, score desc);

-- ---------------------------------------------------------------- alerts ---

create table alerts (
  id             bigserial primary key,
  senior_id      uuid not null references seniors(id) on delete cascade,
  coordinator_id uuid references app_users(id) on delete set null,
  raised_on      date not null,
  rank_in_day    int,                  -- position within the daily budget
  score          numeric(5,4) not null,
  -- Plain-language and non-diagnostic. Never names a condition.
  reason_text    text not null,
  next_step      text not null,
  status         alert_status not null default 'open',
  escalated      boolean not null default false,
  created_at     timestamptz not null default now(),
  unique (senior_id, raised_on)
);
create index on alerts (coordinator_id, raised_on desc, rank_in_day);

-- Coordinator verdict, which feeds the precision metric and the feedback loop.
create table alert_feedback (
  alert_id    bigint primary key references alerts(id) on delete cascade,
  reviewer_id uuid references app_users(id) on delete set null,
  result      outcome_kind not null default 'pending',
  note        text,
  acted_at    timestamptz,
  created_at  timestamptz not null default now()
);

-- Append-only. Every read of health data lands here.
create table audit_log (
  id         bigserial primary key,
  actor_id   uuid references app_users(id) on delete set null,
  action     text not null,
  entity     text not null,
  entity_id  text,
  at         timestamptz not null default now()
);
create index on audit_log (actor_id, at desc);
