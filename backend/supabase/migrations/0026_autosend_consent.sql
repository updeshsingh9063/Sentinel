-- Consent decides what the system does ON ITS OWN. A coordinator is not the
-- system.
--
-- THE DISTINCTION THIS DRAWS, AND WHY IT IS NOT A DEMO SWITCH. Until now,
-- having a telephone number meant being rung automatically every morning and
-- texted three times a day. That conflates two different things: a number is
-- how somebody can be reached, and consent is whether a machine may reach
-- them unprompted. A senior may perfectly well want their coordinator to be
-- able to ring them while wanting nothing arriving by itself at eight in the
-- morning — and today there was no way to express that except by deleting
-- their number, which also took away the coordinator's ability to call.
--
-- So: the scheduler requires consent. A coordinator pressing a button does
-- not, because a person deciding to contact somebody on their caseload is
-- the care the product exists to support, and is already attributable to
-- them.
--
-- PLANNING IS NOT DIALLING. plan_calls still works out who ought to be
-- rung for everyone, and the worklist still shows it. What consent governs
-- is whether a machine acts on that at nine in the morning without anybody
-- deciding to. A plan a human reads is advice; a call placed on its own is
-- an act.

-- ------------------------------------------------- who the scheduler may ring

-- `consents.scope` is free text, so these need no type change. Existing
-- scopes: family_summary, urgent_call, visit_notice.
comment on column consents.scope is
  'family_summary | urgent_call | visit_notice | auto_call | auto_reminder. '
  'The last two govern what the SCHEDULER may do unprompted; a coordinator '
  'acting deliberately is not bound by them.';

create or replace function autocall_targets(p_secret text, p_day date default current_date)
returns table (senior_id uuid, phone text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not telephony_ok(p_secret) then
    return;
  end if;

  return query
    -- distinct: three reasons to ring somebody is still one telephone call.
    select distinct s.id, s.phone
      from call_plan cp
      join seniors s on s.id = cp.senior_id
      join consents c on c.senior_id = s.id and c.scope = 'auto_call' and c.granted
     where cp.planned_on = p_day
       and cp.outcome = 'planned'
       and s.is_active
       and s.phone is not null;
end;
$$;

revoke all on function autocall_targets(text, date) from public;
revoke all on function autocall_targets(text, date) from anon;
grant execute on function autocall_targets(text, date) to anon;

-- ------------------------------------------------- the scheduled reminders

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
      join consents c on c.senior_id = s.id and c.scope = 'auto_reminder' and c.granted
     where s.is_active
       and s.phone is not null
       and p_slot = any (r.med_times)
       and not exists (
         select 1 from medicine_reminder_log l
          where l.senior_id = s.id and l.slot = p_slot and l.sent_on = current_date
       )
  loop
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

-- -------------------------------------------------- the coordinator's button

-- A reminder sent because a person decided to send it. No consent scope is
-- consulted: this is a coordinator contacting somebody on their own caseload,
-- which is the work, and it is attributable to them by name.
create or replace function send_reminder_now(p_senior_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row  record;
  v_body text;
  v_sent int;
  v_id   bigint;
begin
  if not (is_coordinator_of(p_senior_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'reason', 'not_yours');
  end if;

  select s.id, s.phone, coalesce(s.language, 'hi') as lang,
         coalesce(nullif(btrim(r.preferred_name), ''), s.display_name) as name
    into v_row
    from seniors s
    left join senior_routine r on r.senior_id = s.id
   where s.id = p_senior_id and s.is_active;

  if v_row.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_such_senior');
  end if;
  if v_row.phone is null then
    return jsonb_build_object('ok', false, 'reason', 'no_number');
  end if;

  -- A HUMAN CAN MISTAKE A BUTTON FOR AN UNRESPONSIVE ONE and press it six
  -- times. Six texts in a minute is not a reminder, it is harassment of
  -- somebody who may not know how to stop it. Four a day is already generous
  -- against a three-slot schedule.
  select count(*) into v_sent
    from family_notifications
   where senior_id = p_senior_id
     and kind = 'reminder'
     and created_at >= current_date;
  if v_sent >= 4 then
    return jsonb_build_object('ok', false, 'reason', 'too_many_today');
  end if;

  v_body := case when v_row.lang = 'en'
    then v_row.name || ', this is a reminder to take your medicines. — Samarth'
    else v_row.name || ', दवाई लेने का समय हो गया है। — समर्थ'
  end;

  insert into family_notifications
    (senior_id, family_user_id, recipient, to_phone, kind, channel, body)
  values (p_senior_id, null, 'senior', v_row.phone, 'reminder', 'sms', v_body)
  returning id into v_id;

  insert into audit_log (actor_id, action, entity, entity_id)
  values (auth.uid(), 'senior.reminder.sent', 'seniors', p_senior_id::text);

  return jsonb_build_object('ok', true, 'id', v_id, 'name', v_row.name);
end;
$$;

revoke all on function send_reminder_now(uuid) from public;
revoke all on function send_reminder_now(uuid) from anon;
grant execute on function send_reminder_now(uuid) to authenticated;

-- ------------------------------------------------------------- the demo line

-- Only the demo line is enrolled in automatic contact. Every other senior
-- keeps their number, so a coordinator can ring or remind any of them from
-- the worklist — nothing reaches them on its own.
delete from consents where scope in ('auto_call', 'auto_reminder');

insert into consents (senior_id, scope, granted, granted_at, granted_by)
select s.id, v.scope, true, now(), 'demo_line'
  from seniors s, (values ('auto_call'), ('auto_reminder')) as v(scope)
 where s.demo_line is true
on conflict (senior_id, scope) do update set granted = true, granted_at = now();
