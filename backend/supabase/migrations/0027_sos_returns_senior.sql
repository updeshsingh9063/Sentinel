-- raise_sos must say WHO it raised the alarm for.
--
-- The missed-call handler has to ring that person straight back, and to do
-- that it needs their id for the webhook URL — not their telephone number,
-- which since migration 0022 may belong to a whole household. Returning the
-- name alone meant the caller had to look the senior up again by number,
-- which is the exact ambiguity 0021 and 0025 removed from every other path.
--
-- Nothing else changes; this is the same function with one more field in its
-- result. The id is not sensitive to the caller: it already holds the
-- telephony secret and has just been told the senior's name.

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
  v_lang   text;
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

  if p_senior_id is not null then
    select id, display_name, coalesce(language, 'hi')
      into v_senior, v_name, v_lang
      from seniors where id = p_senior_id and is_active;
  end if;

  if v_senior is null then
    select id, display_name, coalesce(language, 'hi')
      into v_senior, v_name, v_lang
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

  return jsonb_build_object(
    'ok', true, 'id', v_id, 'senior_id', v_senior,
    'senior_name', v_name, 'language', v_lang, 'first', v_first);
end;
$$;

revoke all on function raise_sos(text, text, uuid) from public;
grant execute on function raise_sos(text, text, uuid) to anon;
