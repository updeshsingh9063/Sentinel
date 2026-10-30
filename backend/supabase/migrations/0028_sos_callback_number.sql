-- The number to ring back after a missed call to the help line.
--
-- WHY NOT JUST RING THE NUMBER THAT CALLED. Because that is the household's
-- handset, and since migration 0022 several seniors may share it. The alarm
-- was raised FOR one of them, and the callback must reach the number on that
-- senior's record — which is usually the same number, and must not be assumed
-- to be.
--
-- It returns one column and nothing else: no name, no language, no address.
-- A caller holding the telephony secret can already open a conversation with
-- this person; it must not also become a way to read the cohort's directory.

create or replace function sos_callback_number(p_secret text, p_senior_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_phone text;
begin
  if not telephony_ok(p_secret) then
    return null;
  end if;

  select phone into v_phone
    from seniors where id = p_senior_id and is_active;

  return v_phone;
end;
$$;

revoke all on function sos_callback_number(text, uuid) from public;
revoke all on function sos_callback_number(text, uuid) from anon;
grant execute on function sos_callback_number(text, uuid) to anon;
