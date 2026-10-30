-- Two faults in the emergency path, both found by its own test.
--
-- 1. ONE ALERT PER SENIOR PER DAY, NOT ONE PER COORDINATOR. `alerts` is
--    unique on (senior_id, raised_on). raise_sos looped over every
--    coordinator who carries the senior and inserted a row each, which works
--    for the common case of one coordinator and raises a duplicate-key error
--    for the case that matters — a senior carried by two people, which is
--    exactly when an emergency most needs to reach somebody. The alarm then
--    failed completely: no errand, no message, no alert.
--
-- 2. THE DEMO BUTTON RESOLVED BY NUMBER. raise_sos_demo looked up the demo
--    line's telephone and passed that to raise_sos, which resolves a senior
--    from the number. Since migration 0022 a handset may be shared, so the
--    alarm landed on whichever senior was oldest rather than the one whose
--    button it is. Same fault as the call routing fixed in 0021, in a path
--    that was not rechecked when the constraint changed — a number stopped
--    naming a person and every caller that still believed it does was wrong.

create or replace function raise_sos(
  p_secret    text,
  p_phone     text,
  p_senior_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ok     boolean;
  v_senior uuid;
  v_name   text;
  v_id     bigint;
  v_first  boolean := false;
  v_coord  record;
  v_owner  uuid;
begin
  select true into v_ok
    from checkin_webhook_keys
   where name = 'sos'
     and secret_sha256 = encode(sha256(convert_to(coalesce(p_secret, ''), 'utf8')), 'hex');

  if v_ok is not true then
    return jsonb_build_object('ok', false, 'reason', 'unauthorized');
  end if;

  -- The id when there is one; the number only as a fallback, for a device
  -- that can only tell us what it dialled from.
  if p_senior_id is not null then
    select id, display_name into v_senior, v_name
      from seniors where id = p_senior_id and is_active;
  end if;

  if v_senior is null then
    select id, display_name into v_senior, v_name
      from seniors
     where is_active
       and regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')
           like '%' || right(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 10)
     order by created_at
     limit 1;
  end if;

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

    perform notify_family(
      v_senior, 'emergency',
      v_name || ' pressed their emergency button. Their care coordinator has been alerted and is calling now.');
  else
    update assistance_requests
       set created_at = now(),
           summary = 'Emergency button pressed again. Still nobody has reached them.'
     where id = v_id;
  end if;

  -- EVERY coordinator who carries them, on EVERY press. Families get alarm
  -- once; staff get escalation each time, because a second press means the
  -- first message did not produce a human.
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

  -- ONE alert for the day, whoever carries them. Score 1.0 is not a model
  -- output and does not pretend to be one: a pressed button is a fact, and it
  -- outranks every prediction on the page.
  select coordinator_id into v_owner
    from care_assignments where senior_id = v_senior limit 1;

  insert into alerts
    (senior_id, coordinator_id, raised_on, rank_in_day, score, reason_text, next_step, next_step_hi, status)
  values (v_senior, v_owner, current_date, 0, 1.0,
          'Emergency button pressed',
          'Call them now. If there is no answer, send somebody to the house.',
          'अभी फ़ोन कीजिए। जवाब न मिले तो किसी को घर भेजिए।',
          'open')
  on conflict (senior_id, raised_on) do update
    set rank_in_day  = 0,
        score        = 1.0,
        status       = 'open',
        reason_text  = excluded.reason_text,
        next_step    = excluded.next_step,
        next_step_hi = excluded.next_step_hi;

  return jsonb_build_object('ok', true, 'id', v_id, 'senior_name', v_name, 'first', v_first);
end;
$$;

revoke all on function raise_sos(text, text, uuid) from public;
grant execute on function raise_sos(text, text, uuid) to anon;

-- The two-argument form would still resolve by number alone. PostgREST picks
-- an overload by the arguments given, so leaving it in place means a caller
-- that omits the id silently gets the old behaviour back.
drop function if exists raise_sos(text, text);

-- The demo button names its senior, rather than describing them by a
-- telephone number that may belong to twelve people.
create or replace function raise_sos_demo(p_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid; v_phone text;
begin
  select id, phone into v_id, v_phone
    from seniors where demo_line and is_active order by created_at limit 1;

  if v_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_demo_line');
  end if;

  return raise_sos(p_secret, v_phone, v_id);
end;
$$;

revoke all on function raise_sos_demo(text) from public;
grant execute on function raise_sos_demo(text) to anon;
