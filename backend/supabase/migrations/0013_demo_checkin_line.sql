-- Close the check-in loop, without handing the public a pen.
--
-- The check-in page has been a pure simulator: it ran the script, matched
-- speech, handled silence, and then told the caller "your answers have
-- reached the coordinator" having written precisely nothing. The script was
-- right -- that IS what a senior hears on a real call -- but on a screen it
-- reads as a claim the product made, and it was not true. Either the sentence
-- goes or the write arrives. The write arrives.
--
-- WHY THIS IS NOT SIMPLY "LET THE PAGE INSERT A CHECK-IN". That page is
-- public, and it has to be: a senior has no account because the brief forbids
-- a senior-facing app. A public insert into checkins would let anyone on the
-- internet file answers for a named person, and those answers feed the risk
-- model -- so a stranger could push a real senior up or down a coordinator's
-- worklist. That is not a theoretical objection; it is the whole reason the
-- TODO in CheckinSim went unimplemented for so long.
--
-- So the write is pinned to ONE senior, flagged in the schema, and the
-- function below cannot address any other. Forging it means forging the same
-- synthetic demo record that everybody already demonstrates with. The blast
-- radius is one row about one made-up person.
--
-- The other two channels are unchanged and still authenticated: the telephony
-- webhook proves itself with a shared secret (0012), and a coordinator logs a
-- call as themselves under RLS.

-- --------------------------------------------------------- the other four --

-- The script asks six questions; the table had somewhere to put three. Sleep,
-- appetite and falls were being collected and dropped on the floor, which is
-- its own quiet version of the same problem.
alter table checkins add column if not exists sleep_code    int;
alter table checkins add column if not exists appetite_code int;
alter table checkins add column if not exists fall_code     int;

do $$ begin
  alter table checkins add constraint checkins_sleep_check    check (sleep_code    between 1 and 3);
  alter table checkins add constraint checkins_appetite_check check (appetite_code between 1 and 3);
  -- 1 no, 2 nearly, 3 yes. "Nearly" is kept rather than rounded to "no": a
  -- near-fall is the signal that precedes a fall, and it is the only one that
  -- arrives before somebody is on the floor.
  alter table checkins add constraint checkins_fall_check     check (fall_code     between 1 and 3);
exception when duplicate_object then null; end $$;

comment on column checkins.fall_code is
  '1 no, 2 nearly, 3 yes. A near-fall is evidence, not a negative answer.';

-- ------------------------------------------------------- the demo handset --

alter table seniors add column if not exists demo_line boolean not null default false;

comment on column seniors.demo_line is
  'The one senior the public check-in simulator may write to. Exactly one row, enforced below.';

-- Exactly one, so the function can never be pointed at a second person by a
-- later seed script doing something careless.
create unique index if not exists seniors_one_demo_line
  on seniors ((true)) where demo_line;

-- Pick a senior the demo coordinator actually carries, so the result lands on
-- the worklist a reviewer is already looking at. Idempotent: if one is
-- already flagged, leave it alone.
do $$
declare v_id uuid;
begin
  if not exists (select 1 from seniors where demo_line) then
    -- app_users holds the role and name; the address lives in auth.users,
    -- which is where Supabase Auth keeps it.
    select s.id into v_id
      from seniors s
      join care_assignments ca on ca.senior_id = s.id
      join auth.users au       on au.id = ca.coordinator_id
     where au.email = 'coordinator@samarth.demo' and s.is_active
     order by s.display_name
     limit 1;

    if v_id is null then
      select id into v_id from seniors where is_active order by created_at limit 1;
    end if;

    if v_id is not null then
      update seniors set demo_line = true where id = v_id;
    end if;
  end if;
end $$;

-- ------------------------------------------------------------ the write ---

-- Security definer, granted to anon, and deliberately takes NO senior id.
-- There is no argument that could point it at somebody else -- the target is
-- looked up from the flag, inside the function. A caller cannot widen this by
-- sending a different payload, only by changing the database.
--
-- Codes are 1..3 as the IVR script uses them, and NULL means the question was
-- not answered. Null is not coerced to a middle value: an unanswered question
-- is evidence of its own, and inventing "2" for it would be the same mistake
-- as inventing a transcript from silence.
create or replace function record_demo_checkin(
  p_feeling  int default null,
  p_pain     int default null,
  p_meds     int default null,
  p_sleep    int default null,
  p_appetite int default null,
  p_fall     int default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_senior uuid;
  v_name   text;
begin
  select id, display_name into v_senior, v_name
    from seniors where demo_line and is_active limit 1;

  if v_senior is null then
    return jsonb_build_object('ok', false, 'reason', 'no_demo_line');
  end if;

  -- Anything outside 1..3 is discarded rather than clamped. A value this
  -- function does not recognise is a caller it does not understand, and
  -- storing a guess from it would put a number in a clinical record that
  -- nobody said.
  insert into checkins (
    senior_id, checked_on, answered, source,
    feeling_code, pain_code, meds_taken, sleep_code, appetite_code, fall_code
  )
  values (
    v_senior, current_date, true, 'ivr',
    nullif(p_feeling,  0), nullif(p_pain, 0),
    case when p_meds in (1, 2) then true when p_meds = 3 then false else null end,
    nullif(p_sleep, 0), nullif(p_appetite, 0), nullif(p_fall, 0)
  )
  on conflict (senior_id, checked_on) do update
     set answered      = true,
         source        = 'ivr',
         feeling_code  = excluded.feeling_code,
         pain_code     = excluded.pain_code,
         meds_taken    = excluded.meds_taken,
         sleep_code    = excluded.sleep_code,
         appetite_code = excluded.appetite_code,
         fall_code     = excluded.fall_code;

  -- The name comes back because the caller is standing at the demo handset
  -- and needs to be told whose record they just wrote, so the sentence on
  -- screen can be true and specific. This is the one senior in the database
  -- who is designated public for exactly this purpose.
  return jsonb_build_object(
    'ok', true,
    'senior_id', v_senior,
    'senior_name', v_name,
    'recorded_on', current_date
  );
end;
$$;

revoke all on function record_demo_checkin(int, int, int, int, int, int) from public;
grant execute on function record_demo_checkin(int, int, int, int, int, int) to anon;
grant execute on function record_demo_checkin(int, int, int, int, int, int) to authenticated;
