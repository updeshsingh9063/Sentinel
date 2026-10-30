-- 0017 — the system decides who to ring, when, and why.
--
-- WHAT WAS MISSING. The call became a conversation in 0015, but somebody still
-- had to start it. A product whose claim is "the senior does not open
-- anything" cannot wait to be opened. And the ranking it already does answers
-- "who should a coordinator worry about" — not "who has gone quiet", which is
-- a different question with a different answer and is the one that catches
-- somebody lying on a bathroom floor.
--
-- THE BASELINE IS THE PERSON, NOT THE POPULATION. Every rule below compares a
-- senior to their own recent history. Eight hundred steps is a collapse for
-- one person and a good day for another, and a threshold that does not know
-- which is which will cry wolf about the second and miss the first. This is
-- the same principle the risk model already uses; it is restated here because
-- it is the thing most easily lost when someone adds "a quick rule".

-- ------------------------------------------------------------- routine ----

-- The handful of facts that let a call sound like it is from somebody who
-- knows them. DELIBERATELY SMALL AND DELIBERATELY NOT CLINICAL: a preferred
-- name, when they are awake, when they would like to be rung. No diagnoses,
-- no history, nothing that would turn the companion's prompt into a medical
-- record being read out over a phone line.
create table if not exists senior_routine (
  senior_id      uuid primary key references seniors(id) on delete cascade,
  -- "Sharma ji", not "Mr R. K. Sharma". What they are actually called.
  preferred_name text,
  wake_at        time,
  sleep_at       time,
  -- When they have agreed to be rung. Empty means the default below, never
  -- "ring whenever" — nobody is called at a time they did not agree to.
  call_times     time[] not null default '{}',
  med_times      time[] not null default '{}',
  -- One or two lines the companion may use to sound human: "has a grandson in
  -- Pune", "walks in the evening". Never health.
  about          text,
  updated_at     timestamptz not null default now()
);

alter table senior_routine enable row level security;
revoke all on senior_routine from anon;

drop policy if exists routine_coordinator on senior_routine;
create policy routine_coordinator on senior_routine
  for select using (is_coordinator_of(senior_id) or is_admin());

drop policy if exists routine_coordinator_write on senior_routine;
create policy routine_coordinator_write on senior_routine
  for all using (is_coordinator_of(senior_id)) with check (is_coordinator_of(senior_id));

-- --------------------------------------------------------- the day's plan --

do $$ begin
  create type call_reason as enum (
    'daily',     -- their ordinary check-in
    'medicine',  -- they did not confirm yesterday's doses
    'welfare',   -- something changed, or they have gone quiet
    'follow_up', -- an errand was arranged and they have not been told
    'company'    -- they have sounded alone
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type call_outcome as enum ('planned', 'reached', 'no_answer', 'skipped');
exception when duplicate_object then null; end $$;

create table if not exists call_plan (
  id            bigserial primary key,
  senior_id     uuid not null references seniors(id) on delete cascade,
  planned_on    date not null default current_date,
  due_at        time not null,
  reason        call_reason not null,
  -- Plain language, shown to the coordinator as-is. A plan that cannot say
  -- why it rang somebody is a plan nobody can argue with, and this product's
  -- whole posture is that every decision carries its reason.
  why           text not null,
  outcome       call_outcome not null default 'planned',
  attempts      int not null default 0,
  last_attempt  timestamptz,
  created_at    timestamptz not null default now(),
  -- One call per senior per reason per day. Re-running the planner must not
  -- stack three identical welfare calls on somebody.
  unique (senior_id, planned_on, reason)
);

create index on call_plan (planned_on, due_at);
create index on call_plan (senior_id, planned_on desc);

alter table call_plan enable row level security;
revoke all on call_plan from anon;

drop policy if exists plan_coordinator on call_plan;
create policy plan_coordinator on call_plan
  for select using (is_coordinator_of(senior_id) or is_admin());

drop policy if exists plan_coordinator_write on call_plan;
create policy plan_coordinator_write on call_plan
  for all using (is_coordinator_of(senior_id)) with check (is_coordinator_of(senior_id));

-- ------------------------------------------------------ what changed -------

-- One row per senior: how they are doing against their own recent normal.
--
-- A VIEW, NOT A TABLE, so it cannot go stale and there is no job to forget to
-- run. Every column answers a question a human would ask about somebody they
-- had not heard from.
create or replace view routine_deviation as
with latest as (
  select senior_id, max(measured_on) as day
    from vitals group by senior_id
),
-- Their own normal: the median of the fortnight BEFORE their latest reading,
-- so today is compared with them rather than with everybody.
baseline as (
  select v.senior_id,
         percentile_cont(0.5) within group (order by v.steps) as usual_steps
    from vitals v
    join latest l on l.senior_id = v.senior_id
   where v.steps is not null
     and v.measured_on between l.day - 14 and l.day - 1
   group by v.senior_id
),
today as (
  select v.senior_id, v.steps, v.measured_on
    from vitals v
    join latest l on l.senior_id = v.senior_id and l.day = v.measured_on
),
-- How many days running the phone has gone unanswered. A check-in row with
-- answered=false is a call that rang out; no row at all is a day nobody tried.
answers as (
  select senior_id,
         max(checked_on) filter (where answered) as last_answered,
         count(*) filter (where not answered and checked_on > current_date - 7) as missed_week
    from checkins
   group by senior_id
),
meds as (
  select distinct on (senior_id) senior_id, meds_taken, checked_on
    from checkins
   where meds_taken is not null
   order by senior_id, checked_on desc
),
lonely as (
  select senior_id, max(observed_on) as last_lonely
    from note_cues
   where cue = 'loneliness' and not negated
   group by senior_id
)
select s.id                                   as senior_id,
       s.display_name,
       b.usual_steps::int                     as usual_steps,
       t.steps                                as steps_today,
       t.measured_on                          as steps_on,
       -- NULL rather than a guess when there is no baseline to compare with.
       case when b.usual_steps is null or b.usual_steps = 0 or t.steps is null
            then null
            else round((t.steps::numeric / b.usual_steps) * 100)::int
       end                                    as steps_pct_of_usual,
       a.last_answered,
       coalesce(a.missed_week, 0)             as missed_calls_week,
       m.meds_taken                           as meds_last_confirmed,
       m.checked_on                           as meds_checked_on,
       l.last_lonely
  from seniors s
  left join baseline b on b.senior_id = s.id
  left join today    t on t.senior_id = s.id
  left join answers  a on a.senior_id = s.id
  left join meds     m on m.senior_id = s.id
  left join lonely   l on l.senior_id = s.id
 where s.is_active;

-- The view inherits nothing from RLS, so it is granted to nobody by default
-- and explicitly to signed-in users, whose own RLS on the underlying tables
-- still decides which seniors they can see.
revoke all on routine_deviation from anon;
grant select on routine_deviation to authenticated;

-- ------------------------------------------------------- the planner -------

-- Builds a day's calls. Idempotent: running it twice changes nothing, because
-- every insert is keyed on (senior, day, reason).
--
-- SECURITY DEFINER because it reads across the whole cohort to decide, but it
-- is granted ONLY to authenticated users — a coordinator planning their day.
-- It writes nothing a coordinator could not write themselves.
create or replace function plan_calls(p_day date default current_date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r          record;
  v_made     int := 0;
  v_default  time[] := array['09:00'::time, '19:00'::time];
  v_times    time[];
  v_t        time;
begin
  for r in
    select d.*, ro.call_times, ro.wake_at
      from routine_deviation d
      left join senior_routine ro on ro.senior_id = d.senior_id
  loop
    -- 1. Their ordinary calls, at the times they agreed to.
    v_times := case when coalesce(array_length(r.call_times, 1), 0) > 0
                    then r.call_times else v_default end;
    v_t := v_times[1];

    insert into call_plan (senior_id, planned_on, due_at, reason, why)
    values (r.senior_id, p_day, v_t, 'daily', 'Their usual daily call.')
    on conflict (senior_id, planned_on, reason) do nothing;
    if found then v_made := v_made + 1; end if;

    -- 2. Medicines they did not confirm. Not a scolding and not advice: a
    --    call that asks, because a missed dose that nobody asks about is
    --    indistinguishable from one nobody noticed.
    if r.meds_last_confirmed is false then
      insert into call_plan (senior_id, planned_on, due_at, reason, why)
      values (r.senior_id, p_day, coalesce(v_times[2], '19:00'::time), 'medicine',
              'Last time they were asked, the medicines had not been taken.')
      on conflict (senior_id, planned_on, reason) do nothing;
      if found then v_made := v_made + 1; end if;
    end if;

    -- 3. THE ONE THAT MATTERS. Gone quiet, or moving far less than they
    --    normally do. Either can mean nothing at all. Both are worth a phone
    --    call before they are worth an alarm.
    if r.missed_calls_week >= 2
       or (r.steps_pct_of_usual is not null and r.steps_pct_of_usual < 50)
       or (r.last_answered is null or r.last_answered < p_day - 3)
    then
      insert into call_plan (senior_id, planned_on, due_at, reason, why)
      values (
        r.senior_id, p_day, coalesce(r.wake_at + interval '2 hours', '10:00'::time)::time, 'welfare',
        case
          when r.missed_calls_week >= 2
            then r.missed_calls_week || ' calls went unanswered this week.'
          when r.steps_pct_of_usual is not null and r.steps_pct_of_usual < 50
            then 'Moving about ' || r.steps_pct_of_usual || '% as much as they usually do ('
                 || r.steps_today || ' against their usual ' || r.usual_steps || ').'
          else 'Nobody has reached them since ' || coalesce(r.last_answered::text, 'they were enrolled') || '.'
        end)
      on conflict (senior_id, planned_on, reason) do nothing;
      if found then v_made := v_made + 1; end if;
    end if;

    -- 4. They sounded alone. A call for its own sake is the whole response
    --    here, and it is a real one.
    if r.last_lonely is not null and r.last_lonely > p_day - 7 then
      insert into call_plan (senior_id, planned_on, due_at, reason, why)
      values (r.senior_id, p_day, coalesce(v_times[2], '19:00'::time), 'company',
              'They mentioned not having spoken to anyone, on ' || r.last_lonely || '.')
      on conflict (senior_id, planned_on, reason) do nothing;
      if found then v_made := v_made + 1; end if;
    end if;
  end loop;

  -- 5. Errands that were arranged and never mentioned back to the person who
  --    asked. Arranging something and not telling them leaves them still
  --    worrying about it, which is most of what they wanted solved.
  insert into call_plan (senior_id, planned_on, due_at, reason, why)
  select ar.senior_id, p_day, '17:00'::time, 'follow_up',
         'To tell them their request was arranged: ' || ar.summary
    from assistance_requests ar
   where ar.state = 'arranged'
   group by ar.senior_id, ar.summary
  on conflict (senior_id, planned_on, reason) do nothing;

  return jsonb_build_object('ok', true, 'planned_on', p_day, 'calls', (
    select count(*) from call_plan where planned_on = p_day
  ));
end;
$$;


-- REVOKED FROM anon EXPLICITLY, not just from public. This project's Supabase
-- carries `alter default privileges ... grant all on functions to anon`, so a
-- newly created function is granted to anon the moment it exists, and a
-- revoke from PUBLIC does not touch that separate grant. Without this line
-- anybody on the internet could re-plan the whole cohort's calls, repeatedly.
-- Caught by verify:plan, not by reading the file.
revoke all on function plan_calls(date) from public;
revoke all on function plan_calls(date) from anon;
grant execute on function plan_calls(date) to authenticated;

-- ------------------------------------------- nobody answered, repeatedly ---

-- A welfare call that rings out twice stops being a call and becomes an
-- errand for a human: somebody should go round. It lands in the queue the
-- coordinator already works rather than in a new place they would have to
-- learn to look at.
create or replace function escalate_unanswered(p_day date default current_date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r      record;
  v_made int := 0;
begin
  for r in
    select cp.senior_id, s.display_name, cp.attempts
      from call_plan cp
      join seniors s on s.id = cp.senior_id
     where cp.planned_on = p_day
       and cp.reason = 'welfare'
       and cp.outcome = 'no_answer'
       and cp.attempts >= 2
  loop
    if not exists (
      select 1 from assistance_requests
       where senior_id = r.senior_id
         and raised_on = p_day
         and source = 'conversation'
         and kind = 'other'
         and state in ('open', 'arranged')
    ) then
      insert into assistance_requests (senior_id, kind, urgent, summary, source)
      values (r.senior_id, 'other', true,
              r.attempts || ' welfare calls today went unanswered. Somebody should go round.',
              'conversation');
      v_made := v_made + 1;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'raised', v_made);
end;
$$;

revoke all on function escalate_unanswered(date) from public;
revoke all on function escalate_unanswered(date) from anon;
grant execute on function escalate_unanswered(date) to authenticated;

-- -------------------------------------------------- what the call knows ----

-- The companion's briefing for the demo line: the few facts that let it sound
-- like somebody who knows them, plus the one thing it owes them.
--
-- WHY A SEPARATE FUNCTION FROM demo_line_profile. That one is read on every
-- turn of the call and must stay cheap; this is read once, when the phone is
-- answered. Keeping them apart means the per-turn cost does not grow every
-- time the briefing learns something new.
--
-- STILL NO ID AND NOTHING CLINICAL. A preferred name, a language, why this
-- call is being made, and any errand that has been arranged and not yet
-- mentioned back. No scores, no vitals, no diagnoses — the companion is not
-- reading a medical record down the phone.
create or replace function demo_line_briefing()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_id      uuid;
  v_name    text;
  v_lang    text;
  v_pref    text;
  v_about   text;
  v_reason  text;
  v_why     text;
  v_arranged text;
begin
  select s.id, s.display_name, coalesce(s.language, 'hi'),
         r.preferred_name, r.about
    into v_id, v_name, v_lang, v_pref, v_about
    from seniors s
    left join senior_routine r on r.senior_id = s.id
   where s.demo_line and s.is_active
   limit 1;

  if v_id is null then
    return jsonb_build_object('name', '', 'language', 'hi');
  end if;

  -- Today's most pressing reason to be ringing, if the planner made one.
  select cp.reason::text, cp.why into v_reason, v_why
    from call_plan cp
   where cp.senior_id = v_id
     and cp.planned_on = current_date
     and cp.outcome in ('planned', 'no_answer')
   order by case cp.reason
              when 'welfare' then 0 when 'medicine' then 1
              when 'follow_up' then 2 when 'company' then 3 else 4 end
   limit 1;

  -- THE THING IT OWES THEM. An errand arranged and never mentioned back
  -- leaves the person who asked still worrying about it, which is most of
  -- what they wanted solved.
  select string_agg(ar.summary, '; ') into v_arranged
    from assistance_requests ar
   where ar.senior_id = v_id and ar.state = 'arranged';

  return jsonb_build_object(
    'name', coalesce(nullif(btrim(v_pref), ''), v_name),
    'language', v_lang,
    'about', v_about,
    'reason', v_reason,
    'why', v_why,
    'arranged', v_arranged
  );
end;
$$;

revoke all on function demo_line_briefing() from public;
grant execute on function demo_line_briefing() to anon;
