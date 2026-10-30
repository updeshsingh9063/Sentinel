-- Medicine reminders by SMS, and an emergency that actually reaches a person.
--
-- TWO GAPS THIS CLOSES.
--
-- 1. `senior_routine.med_times` has existed since 0017 and nothing ever read
--    it. The schedule was modelled and never acted on, which is the quietest
--    kind of unfinished: the column looks like a feature.
--
-- 2. raise_sos() wrote an errand onto the coordinator's queue and queued a
--    message to the family. Both are correct and neither reaches anybody who
--    is not already looking at a screen. An emergency that waits for somebody
--    to refresh a page is not an emergency system.

-- ------------------------------------------------------ who a message is for

-- family_notifications already carries everything a message needs; what it
-- could not say was that the recipient might not be family. Rather than a
-- second table and a second dispatcher that would drift from this one, the
-- recipient becomes explicit.
alter table family_notifications
  add column if not exists recipient text not null default 'family'
    check (recipient in ('family', 'coordinator', 'senior'));

-- A senior's number lives on `seniors`, not `app_users`, so the dispatcher
-- cannot always resolve a recipient through a user id. When this is set it is
-- used directly, which also makes the delivery audit show the number a
-- message was actually sent to rather than one looked up later.
alter table family_notifications
  add column if not exists to_phone text;

comment on column family_notifications.recipient is
  'family | coordinator | senior. The table is named for its first use; it '
  'carries every outbound message now.';

do $$
begin
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
     where t.typname = 'notify_kind' and e.enumlabel = 'reminder'
  ) then
    alter type notify_kind add value 'reminder';
  end if;
end $$;

-- ------------------------------------------------------- medicine reminders

-- Seniors who have no agreed times get the three the product defaults to.
-- Written once, as data, so a coordinator can change any of them afterwards
-- and the change sticks -- a default applied at send time would silently
-- overwrite that choice on every run.
insert into senior_routine (senior_id, med_times)
select s.id, array['08:00', '15:00', '18:00']::time[]
  from seniors s
 where s.is_active
on conflict (senior_id) do update
   set med_times = case
         when coalesce(array_length(senior_routine.med_times, 1), 0) = 0
           then array['08:00', '15:00', '18:00']::time[]
         else senior_routine.med_times
       end;

-- WHAT WAS SENT, AND WHEN. Without this a scheduler that fires twice -- a
-- retry, an overlapping run, a cron that double-triggers -- sends an elderly
-- person the same reminder twice, which teaches them to ignore it. The unique
-- constraint is the guard; the row is also the audit.
create table if not exists medicine_reminder_log (
  id         bigserial primary key,
  senior_id  uuid not null references seniors(id) on delete cascade,
  slot       time not null,
  sent_on    date not null default current_date,
  notify_id  bigint references family_notifications(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (senior_id, slot, sent_on)
);

alter table medicine_reminder_log enable row level security;

create policy reminder_log_read on medicine_reminder_log
  for select using (is_coordinator_of(senior_id) or is_admin());

-- Queue every reminder due in this slot. Returns how many, so a scheduler
-- that gets no rows can tell "nobody was due" from "it did not run".
--
-- RUNS AS NOBODY. A scheduler has no session, so this takes the telephony
-- secret rather than requiring a signed-in role -- the alternative was a
-- service-role key in a web deployment, which this project does not have and
-- must not acquire.
create or replace function queue_medicine_reminders(p_secret text, p_slot time)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_queued int := 0;
  v_row    record;
  v_body   text;
  v_id     bigint;
begin
  if not telephony_ok(p_secret) then
    return jsonb_build_object('ok', false, 'reason', 'unauthorized');
  end if;

  for v_row in
    select s.id, s.phone, coalesce(s.language, 'hi') as lang,
           coalesce(nullif(btrim(r.preferred_name), ''), s.display_name) as name
      from seniors s
      join senior_routine r on r.senior_id = s.id
     where s.is_active
       and s.phone is not null
       and p_slot = any (r.med_times)
       -- Not already reminded for this slot today.
       and not exists (
         select 1 from medicine_reminder_log l
          where l.senior_id = s.id and l.slot = p_slot and l.sent_on = current_date
       )
  loop
    -- Their own language, and no drug names. A medicine list in a text
    -- message is a health record sitting in a phone anyone in the house may
    -- pick up; the reminder only has to be a reminder.
    v_body := case when v_row.lang = 'en'
      then v_row.name || ', this is a reminder to take your medicines. — Samarth'
      else v_row.name || ', दवाई लेने का समय हो गया है। — समर्थ'
    end;

    insert into family_notifications
      (senior_id, family_user_id, recipient, to_phone, kind, channel, body)
    values (v_row.id, null, 'senior', v_row.phone, 'reminder', 'sms', v_body)
    returning id into v_id;

    insert into medicine_reminder_log (senior_id, slot, notify_id)
    values (v_row.id, p_slot, v_id);

    v_queued := v_queued + 1;
  end loop;

  return jsonb_build_object('ok', true, 'queued', v_queued, 'slot', p_slot);
end;
$$;

revoke all on function queue_medicine_reminders(text, time) from public;
revoke all on function queue_medicine_reminders(text, time) from anon;
grant execute on function queue_medicine_reminders(text, time) to anon;

-- ------------------------------------------------------------------- the SOS

-- An emergency now does three things instead of one: the errand onto the
-- queue (as before), a message to the family (as before), a message to the
-- COORDINATOR'S OWN TELEPHONE, and an alert at the top of their list.
--
-- The alert matters as much as the message. A coordinator who opens the
-- worklist during an emergency must find that senior first, not ranked
-- wherever this morning's model put them -- the ranking is advice about who
-- to worry about, and somebody pressing a button is not advice.
create or replace function raise_sos(p_secret text, p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ok      boolean;
  v_senior  uuid;
  v_name    text;
  v_id      bigint;
  v_first   boolean := false;
  v_coord   record;
  v_alert   bigint;
begin
  select true into v_ok
    from checkin_webhook_keys
   where name = 'sos'
     and secret_sha256 = encode(sha256(convert_to(coalesce(p_secret, ''), 'utf8')), 'hex');

  if v_ok is not true then
    return jsonb_build_object('ok', false, 'reason', 'unauthorized');
  end if;

  select id, display_name into v_senior, v_name
    from seniors
   where is_active
     and regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')
         like '%' || right(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 10)
   order by created_at
   limit 1;

  if v_senior is null then
    return jsonb_build_object('ok', false, 'reason', 'unknown_number');
  end if;

  select id into v_id
    from assistance_requests
   where senior_id = v_senior
     and kind = 'emergency'
     and state in ('open', 'arranged')
   limit 1;

  if v_id is null then
    v_first := true;
    insert into assistance_requests (senior_id, kind, urgent, summary, source, said)
    values (v_senior, 'emergency', true,
            'Emergency button pressed. No details — somebody must call back now.',
            'sos_button', null)
    returning id into v_id;

    -- Only on the FIRST press. A family does not need the same alarm three
    -- times while somebody is already on their way.
    perform notify_family(
      v_senior, 'emergency',
      v_name || ' pressed their emergency button. Their care coordinator has been alerted and is calling now.');
  else
    update assistance_requests
       set created_at = now(),
           summary = 'Emergency button pressed again. Still nobody has reached them.'
     where id = v_id;
  end if;

  -- EVERY coordinator who carries them, on every press. The repeat is the
  -- point here and not on the family's line: a second press means the first
  -- message did not produce a human, and the people whose job it is should
  -- hear that. Families get alarm; staff get escalation.
  for v_coord in
    select ca.coordinator_id as id, u.phone
      from care_assignments ca
      join app_users u on u.id = ca.coordinator_id
     where ca.senior_id = v_senior
  loop
    insert into family_notifications
      (senior_id, family_user_id, recipient, to_phone, kind, channel, body)
    values (v_senior, v_coord.id, 'coordinator', v_coord.phone, 'emergency', 'sms',
            case when v_first
              then 'EMERGENCY: ' || v_name || ' pressed their emergency button. Call them now. — Samarth Sentinel'
              else 'EMERGENCY (again): ' || v_name || ' pressed the button a second time. Nobody has reached them. — Samarth Sentinel'
            end);
  end loop;

  -- Top of the list, today, for whoever carries them. Score 1.0 is not a
  -- model output and is not pretending to be one: a pressed button is a fact,
  -- and it outranks every prediction on the page.
  for v_coord in
    select ca.coordinator_id as id from care_assignments ca where ca.senior_id = v_senior
  loop
    select id into v_alert
      from alerts
     where senior_id = v_senior and raised_on = current_date
       and coordinator_id = v_coord.id
     limit 1;

    if v_alert is null then
      insert into alerts
        (senior_id, coordinator_id, raised_on, rank_in_day, score, reason_text, next_step, next_step_hi, status)
      values (v_senior, v_coord.id, current_date, 0, 1.0,
              'Emergency button pressed',
              'Call them now. If there is no answer, send somebody to the house.',
              'अभी फ़ोन कीजिए। जवाब न मिले तो किसी को घर भेजिए।',
              'open');
    else
      update alerts
         set rank_in_day = 0, score = 1.0, status = 'open',
             reason_text = 'Emergency button pressed',
             next_step = 'Call them now. If there is no answer, send somebody to the house.',
             next_step_hi = 'अभी फ़ोन कीजिए। जवाब न मिले तो किसी को घर भेजिए।'
       where id = v_alert;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'id', v_id, 'senior_name', v_name, 'first', v_first);
end;
$$;

revoke all on function raise_sos(text, text) from public;
grant execute on function raise_sos(text, text) to anon;
