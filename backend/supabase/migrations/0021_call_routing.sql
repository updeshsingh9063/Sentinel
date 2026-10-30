-- Route an outbound call by WHO WAS CALLED, not by the number dialled.
--
-- THE BUG THIS CLOSES. telephony_begin resolves the senior from `To` — the
-- number Twilio dialled — and takes the first match. That is correct for an
-- inbound call, where the number is genuinely all you have. For an OUTBOUND
-- call it is a guess that happens to be right only while numbers are unique:
-- the moment two seniors share a handset, every call files against whichever
-- row the planner returns first. Press "Call now" on one senior, and the
-- check-in, the transcript and the cues all land on another.
--
-- Nothing errors. The call sounds correct, the record is wrong, and the
-- wrongness is in exactly the direction that matters — a coordinator reads
-- somebody else's symptoms under this senior's name.
--
-- Two seniors sharing a number is not hypothetical. A couple in one house
-- has one telephone; a trial telephony account can only dial one verified
-- handset at all.
--
-- THE FIX. The caller already knows who it rang: /api/call/place checked that
-- senior against the signed-in coordinator's caseload before dialling. So it
-- passes the id through the webhook URL, and the id wins. The phone lookup
-- stays as the fallback, which is what an inbound call still needs.
--
-- THE ID IS NOT A BACK DOOR. It is only read behind the telephony secret —
-- the same gate that already lets a caller open a session, read a senior's
-- preferred name and file a check-in against them. Anybody who can use this
-- id could already do all of that by dialling the number.

create or replace function telephony_begin(
  p_secret    text,
  p_call_sid  text,
  p_phone     text,
  p_senior_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_senior   uuid;
  v_name     text;
  v_lang     text;
  v_pref     text;
  v_about    text;
  v_reason   text;
  v_why      text;
  v_arranged text;
begin
  if not telephony_ok(p_secret) then
    return jsonb_build_object('ok', false, 'reason', 'unauthorized');
  end if;

  -- An established session always wins, whatever this request claims. Twilio
  -- posts here once per turn, and a mid-call request that resolved to a
  -- different senior than the one the call opened with would split a single
  -- conversation across two records.
  select cs.senior_id into v_senior
    from call_sessions cs where cs.call_sid = p_call_sid;

  -- Then the id the dialler passed, if it names an active senior. A stale or
  -- invented id falls through to the number rather than failing the call: a
  -- person has answered their telephone and is owed a conversation.
  if v_senior is null and p_senior_id is not null then
    select s.id into v_senior from seniors s
     where s.id = p_senior_id and s.is_active;
  end if;

  -- Finally the number, which is all an INBOUND call has.
  if v_senior is null then
    select s.id into v_senior
      from seniors s
     where s.is_active
       and regexp_replace(coalesce(s.phone, ''), '[^0-9]', '', 'g')
           like '%' || right(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 10)
     order by s.created_at
     limit 1;
  end if;

  if v_senior is null then
    return jsonb_build_object('ok', false, 'reason', 'unknown_number');
  end if;

  select s.display_name, coalesce(s.language, 'hi'), r.preferred_name, r.about
    into v_name, v_lang, v_pref, v_about
    from seniors s
    left join senior_routine r on r.senior_id = s.id
   where s.id = v_senior;

  select cp.reason::text, cp.why into v_reason, v_why
    from call_plan cp
   where cp.senior_id = v_senior
     and cp.planned_on = current_date
     and cp.outcome in ('planned', 'no_answer')
   order by case cp.reason
              when 'welfare' then 0 when 'medicine' then 1
              when 'follow_up' then 2 when 'company' then 3 else 4 end
   limit 1;

  select string_agg(ar.summary, '; ') into v_arranged
    from assistance_requests ar
   where ar.senior_id = v_senior and ar.state = 'arranged';

  insert into call_sessions (call_sid, senior_id, lang)
  values (p_call_sid, v_senior, v_lang)
  on conflict (call_sid) do update set updated_at = now();

  return jsonb_build_object(
    'ok', true,
    'name', coalesce(nullif(btrim(v_pref), ''), v_name),
    'language', v_lang,
    'about', v_about,
    'reason', v_reason,
    'why', v_why,
    'arranged', v_arranged
  );
end;
$$;

comment on function telephony_begin(text, text, text, uuid) is
  'Opens a call session. Resolves the senior by established session, then by '
  'the id the dialler passed, then by the number dialled. The id matters '
  'because two seniors may share a telephone, and an outbound call must file '
  'against the person it was placed for.';

-- The anon default-privilege trap: a new function is granted to anon ON
-- CREATION, and revoking from public does NOT remove it. Both signatures are
-- named because the three-argument form still exists until it is dropped.
revoke all on function telephony_begin(text, text, text, uuid) from public;
revoke all on function telephony_begin(text, text, text, uuid) from anon;
grant execute on function telephony_begin(text, text, text, uuid) to anon;

-- The old three-argument version would still be reachable and would still
-- resolve by number alone, which is the bug. PostgREST picks an overload by
-- the arguments it is given, so leaving it in place means a caller that omits
-- the id silently gets the broken behaviour back.
drop function if exists telephony_begin(text, text, text);
