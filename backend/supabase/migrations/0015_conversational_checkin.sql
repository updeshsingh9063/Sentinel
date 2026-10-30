-- 0015 — the check-in stops being a questionnaire.
--
-- WHY THIS EXISTS. The senior-facing call walked people through six
-- multiple-choice questions: "press 1 for better, 2 for same, 3 for worse."
-- That is a form read aloud. The evaluator's objection in round one was
-- exactly this — a senior should not be answering quiz questions — and they
-- were right. The call now opens with a greeting and a question, the senior
-- talks, and a model works out what was said.
--
-- WHAT DOES NOT CHANGE, DELIBERATELY. The conversation lands in the same
-- three tables the risk model already reads: the coded answers in `checkins`,
-- the words in `call_notes`, the extracted concerns in `note_cues`. No new
-- pipeline, no second source of truth, and every surface built on top of them
-- — the ranked worklist, the senior record, the weekly report, the ops
-- metrics — keeps working without being told anything.

-- ---------------------------------------------------------------- columns --

-- A conversation is still the phone line, but it is not the keypad script,
-- and the difference matters downstream: a scripted call always carries all
-- six codes, a conversation carries whatever actually came up.
alter table checkins drop constraint if exists checkins_source_check;
alter table checkins
  add constraint checkins_source_check
  check (source in ('ivr', 'missed_call', 'coordinator', 'conversation'));

-- note_text stays the one-line summary a coordinator reads at a glance. The
-- words themselves go in transcript, because a summary is a claim and the
-- transcript is the evidence for it. A coordinator who doubts the summary
-- must be able to read what was actually said.
alter table call_notes add column if not exists transcript text;

-- Who made the note. Null-author used to mean "nobody recorded it", which is
-- not the same thing as "the system recorded it", and the two must not be
-- confused on a clinical record.
alter table call_notes add column if not exists channel text not null default 'coordinator';
alter table call_notes drop constraint if exists call_notes_channel_check;
alter table call_notes
  add constraint call_notes_channel_check
  check (channel in ('coordinator', 'ai_call'));

-- ---------------------------------------------------------------- profile --

-- Name and language only. The companion has to greet somebody by name, in
-- their language, before it can sound like anything other than a form — and
-- that is all it needs to do so. No id, nothing joinable, nothing clinical.
create or replace function demo_line_profile()
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select jsonb_build_object(
           'name', display_name,
           'language', coalesce(language, 'hi')
         )
    from seniors
   where demo_line and is_active
   limit 1;
$$;

revoke all on function demo_line_profile() from public;
grant execute on function demo_line_profile() to anon;
grant execute on function demo_line_profile() to authenticated;

-- ----------------------------------------------------------------- record --

create or replace function record_demo_conversation(
  p_transcript text,
  p_signals    jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_senior  uuid;
  v_name    text;
  v_note    bigint;
  v_summary text;
  v_cue     jsonb;
  v_kind    text;
  v_n       int := 0;
begin
  select id, display_name into v_senior, v_name
    from seniors where demo_line and is_active limit 1;

  if v_senior is null then
    return jsonb_build_object('ok', false, 'reason', 'no_demo_line');
  end if;

  v_summary := nullif(btrim(coalesce(p_signals->>'summary', '')), '');

  -- Codes, when the conversation produced them. A question that never came up
  -- leaves its column null rather than taking a default: "they did not say"
  -- and "they said they were fine" are different findings, and the scoring
  -- layer already treats them differently.
  insert into checkins (
    senior_id, checked_on, answered, source,
    feeling_code, pain_code, meds_taken, sleep_code, appetite_code, fall_code
  )
  values (
    v_senior, current_date, true, 'conversation',
    nullif((p_signals->>'feeling')::int,  0),
    nullif((p_signals->>'pain')::int,     0),
    case when (p_signals->>'meds')::int in (1, 2) then true
         when (p_signals->>'meds')::int = 3       then false
         else null end,
    nullif((p_signals->>'sleep')::int,    0),
    nullif((p_signals->>'appetite')::int, 0),
    nullif((p_signals->>'fall')::int,     0)
  )
  on conflict (senior_id, checked_on) do update
     set answered = true,
         source   = 'conversation',
         -- coalesce, not overwrite. A second call later in the day that never
         -- touches on sleep must not erase what the morning call was told
         -- about sleep.
         feeling_code  = coalesce(excluded.feeling_code,  checkins.feeling_code),
         pain_code     = coalesce(excluded.pain_code,     checkins.pain_code),
         meds_taken    = coalesce(excluded.meds_taken,    checkins.meds_taken),
         sleep_code    = coalesce(excluded.sleep_code,    checkins.sleep_code),
         appetite_code = coalesce(excluded.appetite_code, checkins.appetite_code),
         fall_code     = coalesce(excluded.fall_code,     checkins.fall_code);

  -- One AI note per senior per day. Re-running the call replaces it instead
  -- of stacking near-identical notes on the record, which is what a second
  -- attempt at the same conversation actually is.
  delete from note_cues
   where note_id in (select id from call_notes
                      where senior_id = v_senior
                        and called_on = current_date
                        and channel = 'ai_call');
  delete from call_notes
   where senior_id = v_senior and called_on = current_date and channel = 'ai_call';

  insert into call_notes (senior_id, called_on, author_id, reached, note_text, transcript, note_lang, channel)
  values (v_senior, current_date, null, true,
          coalesce(v_summary, 'Spoke on the daily call.'),
          nullif(btrim(coalesce(p_transcript, '')), ''),
          coalesce(p_signals->>'language', 'hinglish'), 'ai_call')
  returning id into v_note;

  -- Cues, one row each, checked against the enum rather than cast into it.
  -- An unrecognised label from a model is dropped: a value this schema does
  -- not define has no meaning to anything reading it, and raising here would
  -- lose the whole conversation over one bad word.
  for v_cue in select * from jsonb_array_elements(coalesce(p_signals->'cues', '[]'::jsonb))
  loop
    v_kind := v_cue->>'cue';
    if v_kind in ('pain','fall','confusion','low_appetite','loneliness',
                  'dizziness','poor_sleep','breathlessness') then
      insert into note_cues (note_id, senior_id, observed_on, cue, negated, confidence, span_text)
      values (
        v_note, v_senior, current_date, v_kind::cue_type,
        coalesce((v_cue->>'negated')::boolean, false),
        least(greatest(coalesce((v_cue->>'confidence')::numeric, 0.6), 0), 1),
        left(nullif(btrim(coalesce(v_cue->>'span', '')), ''), 300)
      );
      v_n := v_n + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'senior_id', v_senior,
    'senior_name', v_name,
    'cues', v_n,
    'recorded_on', current_date
  );
end;
$$;

revoke all on function record_demo_conversation(text, jsonb) from public;
grant execute on function record_demo_conversation(text, jsonb) to anon;
