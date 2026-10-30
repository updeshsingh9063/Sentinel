-- 0019 — a real phone, really ringing.
--
-- Everything until now has been the browser standing in for a telephone. The
-- conversation, the signals, the errands and the record are all real; the
-- ring was speech synthesis through a laptop speaker. This is the transport.
--
-- WHAT IS DIFFERENT ABOUT A TELEPHONE CALL. A telephony provider is stateless
-- between webhooks: it posts "they said this" and hangs up waiting for the
-- next thing to say, with nothing but a call id to tie the turns together. So
-- the conversation has to live somewhere between posts, and that somewhere
-- cannot be memory on a serverless function that may not be the same
-- function next time.
--
-- STILL NO SERVICE-ROLE KEY ANYWHERE. The webhook holds a shared secret and
-- nothing else, exactly like the missed-call and SOS channels. Everything it
-- can do is in these four functions, and none of them can read a senior, a
-- vital or a score.
--
-- AND IT IS NOT THE DEMO LINE. The demo-line flag exists so a public page can
-- write to exactly one senior. A telephone call knows who it rang, so these
-- functions resolve the senior from the number dialled — which means the
-- secret is the only thing standing between a caller and somebody's record,
-- and is why it is checked first in every one of them.

create table if not exists call_sessions (
  call_sid    text primary key,
  senior_id   uuid not null references seniors(id) on delete cascade,
  lang        text not null default 'hi',
  -- The conversation so far: [{"who":"ai"|"senior","text":"..."}]
  turns       jsonb not null default '[]'::jsonb,
  -- Everything understood so far, merged across turns.
  signals     jsonb not null default '{}'::jsonb,
  -- Errands heard, one per kind.
  requests    jsonb not null default '[]'::jsonb,
  finished    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index on call_sessions (senior_id, created_at desc);

alter table call_sessions enable row level security;
revoke all on call_sessions from anon;
revoke all on call_sessions from authenticated;

-- A coordinator may read a call that happened on their caseload. Nobody
-- writes through RLS: the only writer is the webhook, through the functions
-- below, holding the secret.
drop policy if exists sessions_coordinator on call_sessions;
create policy sessions_coordinator on call_sessions
  for select using (is_coordinator_of(senior_id) or is_admin());

grant select on call_sessions to authenticated;

-- One more key beside the missed-call and SOS ones, in the same table, so
-- there is a single place where device and provider secrets live and a single
-- place to rotate them.
insert into checkin_webhook_keys (name, secret_sha256)
values ('telephony', 'fafe35ade51a00d3524062cca20f51f32328242b48f5e4cb990f290f0938e96a')
on conflict (name) do nothing;

-- ------------------------------------------------------------- helpers -----

create or replace function telephony_ok(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from checkin_webhook_keys
     where name = 'telephony'
       and length(coalesce(p_secret, '')) >= 16
       and secret_sha256 = encode(sha256(convert_to(coalesce(p_secret, ''), 'utf8')), 'hex')
  );
$$;

revoke all on function telephony_ok(text) from public;
revoke all on function telephony_ok(text) from anon;

-- --------------------------------------------------------------- begin -----

-- The phone has been answered. Work out who it is, and hand back everything
-- the companion needs to open the call.
create or replace function telephony_begin(
  p_secret   text,
  p_call_sid text,
  p_phone    text
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

  select s.id, s.display_name, coalesce(s.language, 'hi'), r.preferred_name, r.about
    into v_senior, v_name, v_lang, v_pref, v_about
    from seniors s
    left join senior_routine r on r.senior_id = s.id
   where s.is_active
     and regexp_replace(coalesce(s.phone, ''), '[^0-9]', '', 'g')
         like '%' || right(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 10)
   limit 1;

  if v_senior is null then
    return jsonb_build_object('ok', false, 'reason', 'unknown_number');
  end if;

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

revoke all on function telephony_begin(text, text, text) from public;
grant execute on function telephony_begin(text, text, text) to anon;

-- ---------------------------------------------------------------- turn -----

-- Append one exchange and carry forward what is understood. Returns the
-- conversation as it now stands, so the caller never has to hold it.
create or replace function telephony_turn(
  p_secret   text,
  p_call_sid text,
  p_said     text,
  p_say      text,
  p_signals  jsonb default null,
  p_request  jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_turns jsonb;
  v_sig   jsonb;
  v_reqs  jsonb;
  v_kind  text;
begin
  if not telephony_ok(p_secret) then
    return jsonb_build_object('ok', false, 'reason', 'unauthorized');
  end if;

  select turns, signals, requests into v_turns, v_sig, v_reqs
    from call_sessions where call_sid = p_call_sid;

  if v_turns is null then
    return jsonb_build_object('ok', false, 'reason', 'no_session');
  end if;

  if nullif(btrim(coalesce(p_said, '')), '') is not null then
    v_turns := v_turns || jsonb_build_array(jsonb_build_object('who', 'senior', 'text', p_said));
  end if;
  if nullif(btrim(coalesce(p_say, '')), '') is not null then
    v_turns := v_turns || jsonb_build_array(jsonb_build_object('who', 'ai', 'text', p_say));
  end if;

  -- Merge, never replace: a later turn that says nothing about sleep must not
  -- erase what an earlier one was told about sleep. `||` on jsonb takes the
  -- right-hand value per key, so nulls are stripped out first.
  if p_signals is not null then
    v_sig := coalesce(v_sig, '{}'::jsonb) || (
      select coalesce(jsonb_object_agg(k, v), '{}'::jsonb)
        from jsonb_each(p_signals) as e(k, v)
       where v is not null and v <> 'null'::jsonb
    );
  end if;

  -- One errand per kind, same rule as the database enforces on the table.
  if p_request is not null and p_request ? 'kind' then
    v_kind := p_request->>'kind';
    v_reqs := (
      select coalesce(jsonb_agg(x), '[]'::jsonb)
        from jsonb_array_elements(coalesce(v_reqs, '[]'::jsonb)) as t(x)
       where x->>'kind' is distinct from v_kind
    ) || jsonb_build_array(p_request);
  end if;

  update call_sessions
     set turns = v_turns, signals = v_sig, requests = v_reqs, updated_at = now()
   where call_sid = p_call_sid;

  return jsonb_build_object('ok', true, 'turns', v_turns, 'signals', v_sig);
end;
$$;

revoke all on function telephony_turn(text, text, text, text, jsonb, jsonb) from public;
grant execute on function telephony_turn(text, text, text, text, jsonb, jsonb) to anon;

-- -------------------------------------------------------------- finish -----

-- The call ended. Write it to the record, through the same tables every other
-- channel writes to, and mark the planned call as reached.
create or replace function telephony_finish(
  p_secret   text,
  p_call_sid text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_senior  uuid;
  v_lang    text;
  v_turns   jsonb;
  v_sig     jsonb;
  v_reqs    jsonb;
  v_done    boolean;
  v_note    bigint;
  v_text    text;
  v_cue     jsonb;
  v_kind    text;
  v_req     jsonb;
  v_rkind   request_kind;
begin
  if not telephony_ok(p_secret) then
    return jsonb_build_object('ok', false, 'reason', 'unauthorized');
  end if;

  select senior_id, lang, turns, signals, requests, finished
    into v_senior, v_lang, v_turns, v_sig, v_reqs, v_done
    from call_sessions where call_sid = p_call_sid;

  if v_senior is null then
    return jsonb_build_object('ok', false, 'reason', 'no_session');
  end if;

  -- Providers retry. Writing the same call twice would double a senior's
  -- errands and overwrite their check-in with itself.
  if v_done then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  select string_agg((t.x->>'who') || ': ' || (t.x->>'text'), E'\n')
    into v_text
    from jsonb_array_elements(coalesce(v_turns, '[]'::jsonb)) as t(x);

  insert into checkins (
    senior_id, checked_on, answered, source,
    feeling_code, pain_code, meds_taken, sleep_code, appetite_code, fall_code
  )
  values (
    v_senior, current_date, true, 'conversation',
    nullif((v_sig->>'feeling')::int, 0),
    nullif((v_sig->>'pain')::int, 0),
    case when (v_sig->>'meds')::int in (1, 2) then true
         when (v_sig->>'meds')::int = 3       then false else null end,
    nullif((v_sig->>'sleep')::int, 0),
    nullif((v_sig->>'appetite')::int, 0),
    nullif((v_sig->>'fall')::int, 0)
  )
  on conflict (senior_id, checked_on) do update
     set answered      = true,
         source        = 'conversation',
         feeling_code  = coalesce(excluded.feeling_code,  checkins.feeling_code),
         pain_code     = coalesce(excluded.pain_code,     checkins.pain_code),
         meds_taken    = coalesce(excluded.meds_taken,    checkins.meds_taken),
         sleep_code    = coalesce(excluded.sleep_code,    checkins.sleep_code),
         appetite_code = coalesce(excluded.appetite_code, checkins.appetite_code),
         fall_code     = coalesce(excluded.fall_code,     checkins.fall_code);

  delete from note_cues
   where note_id in (select id from call_notes
                      where senior_id = v_senior and called_on = current_date and channel = 'ai_call');
  delete from call_notes
   where senior_id = v_senior and called_on = current_date and channel = 'ai_call';

  insert into call_notes (senior_id, called_on, author_id, reached, note_text, transcript, note_lang, channel)
  values (v_senior, current_date, null, true,
          coalesce(nullif(btrim(v_sig->>'summary'), ''), 'Spoke on the daily call.'),
          v_text, coalesce(v_lang, 'hi'), 'ai_call')
  returning id into v_note;

  for v_cue in select * from jsonb_array_elements(coalesce(v_sig->'cues', '[]'::jsonb))
  loop
    v_kind := v_cue->>'cue';
    if v_kind in ('pain','fall','confusion','low_appetite','loneliness',
                  'dizziness','poor_sleep','breathlessness') then
      insert into note_cues (note_id, senior_id, observed_on, cue, negated, confidence, span_text)
      values (v_note, v_senior, current_date, v_kind::cue_type,
              coalesce((v_cue->>'negated')::boolean, false),
              least(greatest(coalesce((v_cue->>'confidence')::numeric, 0.6), 0), 1),
              left(nullif(btrim(v_cue->>'span'), ''), 300));
    end if;
  end loop;

  for v_req in select * from jsonb_array_elements(coalesce(v_reqs, '[]'::jsonb))
  loop
    begin
      v_rkind := (v_req->>'kind')::request_kind;
    exception when invalid_text_representation then
      v_rkind := 'other';
    end;

    if nullif(btrim(coalesce(v_req->>'summary', '')), '') is not null
       and not exists (
         select 1 from assistance_requests
          where senior_id = v_senior and raised_on = current_date
            and kind = v_rkind and state in ('open', 'arranged'))
    then
      insert into assistance_requests (senior_id, kind, urgent, said, summary, source)
      values (v_senior, v_rkind, coalesce((v_req->>'urgent')::boolean, false),
              nullif(btrim(v_req->>'said'), ''), v_req->>'summary', 'conversation');
    end if;
  end loop;

  -- The planner asked for this call. Say it happened, so tomorrow's plan and
  -- the unanswered-twice escalation both see the truth.
  update call_plan
     set outcome = 'reached', last_attempt = now()
   where senior_id = v_senior and planned_on = current_date and outcome <> 'reached';

  update call_sessions set finished = true, updated_at = now() where call_sid = p_call_sid;

  return jsonb_build_object('ok', true, 'senior_id', v_senior);
end;
$$;

revoke all on function telephony_finish(text, text) from public;
grant execute on function telephony_finish(text, text) to anon;

-- Nobody answered. Recorded as an attempt so two of them escalate, exactly
-- as an unanswered welfare call does from any other channel.
create or replace function telephony_no_answer(p_secret text, p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_senior uuid;
begin
  if not telephony_ok(p_secret) then
    return jsonb_build_object('ok', false, 'reason', 'unauthorized');
  end if;

  select id into v_senior
    from seniors
   where is_active
     and regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')
         like '%' || right(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 10)
   limit 1;

  if v_senior is null then
    return jsonb_build_object('ok', false, 'reason', 'unknown_number');
  end if;

  update call_plan
     set outcome = 'no_answer', attempts = attempts + 1, last_attempt = now()
   where senior_id = v_senior and planned_on = current_date and outcome <> 'reached';

  -- Silence is evidence. A day with no answer is a check-in row saying so,
  -- not an absent row that looks like nobody tried.
  insert into checkins (senior_id, checked_on, answered, source)
  values (v_senior, current_date, false, 'ivr')
  on conflict (senior_id, checked_on) do nothing;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function telephony_no_answer(text, text) from public;
grant execute on function telephony_no_answer(text, text) to anon;
