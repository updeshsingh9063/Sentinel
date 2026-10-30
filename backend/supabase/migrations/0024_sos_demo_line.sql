-- The emergency button, for the one line a demo can press.
--
-- /api/sos is built for a DEVICE: a physical button or a provider webhook
-- that holds a secret. A browser cannot hold that secret — anything shipped
-- to the page is public — so a page-based button needs an entry point that
-- takes no secret from the client and can be pointed at nobody but the demo
-- line.
--
-- IT TAKES NO SENIOR ID, DELIBERATELY. There is no argument here that could
-- aim this at somebody else's grandmother. The target is whichever senior
-- carries `demo_line`, exactly as the conversation and the errand functions
-- work, and the secret is still checked — by raise_sos itself, which this
-- calls rather than reimplements. One emergency path, not two that drift.

create or replace function raise_sos_demo(p_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_phone text;
begin
  select phone into v_phone
    from seniors where demo_line and is_active and phone is not null
   order by created_at limit 1;

  if v_phone is null then
    return jsonb_build_object('ok', false, 'reason', 'no_demo_line');
  end if;

  -- raise_sos verifies the secret. Calling through it rather than copying it
  -- means the alarm, the family message, the coordinator message and the
  -- alert all stay in one place.
  return raise_sos(p_secret, v_phone);
end;
$$;

revoke all on function raise_sos_demo(text) from public;
grant execute on function raise_sos_demo(text) to anon;
