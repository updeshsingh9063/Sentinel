-- A coordinator can put a telephone number on a senior's record.
--
-- WHY THIS IS NOT A PLAIN UPDATE. `seniors` is admin-only to write (policy
-- seniors_write, migration 0002), and that is the right policy: identity,
-- age, city and language are not a coordinator's to edit. But a missing
-- telephone number is the one field that stops the product working at all —
-- the call button correctly refuses, and the only fix available was a
-- database administrator. So exactly one column opens, through a function
-- that can change nothing else.
--
-- WHY NOT "DIAL ANY NUMBER THE OPERATOR TYPES". That was the obvious
-- shortcut and it is the wrong feature: a box that dials arbitrary numbers
-- out of somebody else's telephony balance is a nuisance-call machine with a
-- login page, and every call it made would be unattributable afterwards.
-- Putting the number ON THE RECORD keeps the invariant the whole call path
-- rests on — you may only ring somebody on your caseload — and leaves the
-- number where the next coordinator, the daily round and the audit log can
-- all see it.
--
-- E.164 OR NOTHING. Twilio sends `To` in E.164 and `telephony_begin` matches
-- on the last ten digits. "9076540430" would be accepted by a looser check
-- and then never match anything, failing at call time rather than at entry,
-- which is the hardest kind of failure to attribute.

create or replace function set_senior_phone(
  p_senior_id uuid,
  p_phone     text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phone text;
  v_name  text;
begin
  -- The caller's own caseload, checked here rather than trusted from the
  -- page. A senior id is under the browser's control; this is what makes
  -- that harmless.
  if not (is_coordinator_of(p_senior_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'reason', 'not_yours');
  end if;

  v_phone := nullif(btrim(coalesce(p_phone, '')), '');

  -- Clearing the number is allowed and is not an error: a wrong number on a
  -- record is worse than no number, because the call reaches a stranger.
  if v_phone is not null then
    v_phone := regexp_replace(v_phone, '[\s()\-]', '', 'g');
    if v_phone !~ '^\+[1-9][0-9]{7,14}$' then
      return jsonb_build_object('ok', false, 'reason', 'not_e164');
    end if;

    -- Two seniors on one number makes "which senior is this call about" a
    -- matter of row order, because the voice webhook resolves a caller BY
    -- NUMBER. Refuse rather than silently pick one.
    if exists (
      select 1 from seniors
       where phone = v_phone and id <> p_senior_id and is_active
    ) then
      return jsonb_build_object('ok', false, 'reason', 'number_in_use');
    end if;
  end if;

  update seniors set phone = v_phone where id = p_senior_id
    returning display_name into v_name;

  if v_name is null then
    return jsonb_build_object('ok', false, 'reason', 'no_such_senior');
  end if;

  -- Who changed a senior's telephone number, and when. A call that reached
  -- the wrong person has to be answerable afterwards.
  insert into audit_log (actor_id, action, entity, entity_id)
  values (auth.uid(),
          case when v_phone is null then 'senior.phone.cleared' else 'senior.phone.set' end,
          'seniors', p_senior_id::text);

  return jsonb_build_object('ok', true, 'name', v_name, 'phone', v_phone);
end;
$$;

comment on function set_senior_phone(uuid, text) is
  'Sets or clears one senior''s telephone number, for a coordinator who carries them. '
  'The only write a coordinator has on seniors, and it touches no other column.';

-- The anon default-privilege trap: `alter default privileges ... grant all on
-- functions to anon` means a new function is granted to anon ON CREATION, and
-- revoking from public does NOT remove it. It has to be named.
revoke all on function set_senior_phone(uuid, text) from public;
revoke all on function set_senior_phone(uuid, text) from anon;
grant execute on function set_senior_phone(uuid, text) to authenticated;
