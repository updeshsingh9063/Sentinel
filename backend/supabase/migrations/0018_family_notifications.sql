-- 0018 — telling the family, and only when they are allowed to be told.
--
-- WHAT WAS MISSING. An emergency button raised an alarm for a coordinator and
-- nobody else. A daughter in another city learned nothing, which is the whole
-- reason families sign a parent up to something like this.
--
-- THE CONSENT SWITCH HAD TO BECOME REAL FIRST. The family page has had
-- consent toggles since the beginning and they held their answer in React
-- state — "local state for the demo", said the comment. A privacy control
-- that silently does not save is worse than no control: it tells somebody
-- they have turned sharing off while the system carries on exactly as before.
-- Nothing in this migration is worth anything until that switch writes, so it
-- gets an insert policy here and the component gets a write.
--
-- SUPPRESSED MESSAGES ARE STORED, NOT DROPPED. A row saying "we would have
-- told her daughter and did not, because consent was not given" is the only
-- evidence the gate is doing anything. Dropping it silently would leave the
-- privacy claim unfalsifiable, which is the same as untrue.

-- A family member can now RECORD a consent, not only change one that somebody
-- else created. Without this, every scope with no row was permanently off and
-- the switch failed silently for exactly the scopes that matter most.
drop policy if exists consents_family_insert on consents;
create policy consents_family_insert on consents
  for insert with check (is_family_of(senior_id));

do $$ begin
  create type notify_kind as enum (
    'emergency',  -- the button was pressed, or a fall was reported
    'arranged',   -- something they asked for has been sorted
    'weekly'      -- the ordinary summary
  );
exception when duplicate_object then null; end $$;

do $$ begin
  -- `suppressed` is a first-class outcome, not a failure.
  create type notify_state as enum ('queued', 'sent', 'suppressed', 'failed');
exception when duplicate_object then null; end $$;

create table if not exists family_notifications (
  id             bigserial primary key,
  senior_id      uuid not null references seniors(id) on delete cascade,
  family_user_id uuid references app_users(id) on delete set null,
  kind           notify_kind not null,
  channel        text not null default 'sms' check (channel in ('sms', 'whatsapp')),
  body           text not null,
  state          notify_state not null default 'queued',
  -- Why it was not sent. Written for a human reading an audit, not a code.
  reason         text,
  provider_ref   text,
  created_at     timestamptz not null default now(),
  sent_at        timestamptz
);

create index on family_notifications (senior_id, created_at desc);
create index on family_notifications (state) where state = 'queued';

alter table family_notifications enable row level security;
revoke all on family_notifications from anon;

-- A FAMILY MEMBER READS ONLY WHAT WAS ACTUALLY FOR THEM.
--
-- The first version of this policy was `family_user_id = auth.uid()`, full
-- stop, which handed them the suppressed rows too — including the body, which
-- says in plain words that an emergency button was pressed. The gate would
-- have withheld the message and then let the same person read it, which is
-- not a gate. Suppressed rows exist for the audit trail and belong to the
-- coordinator and nobody else.
drop policy if exists notify_read on family_notifications;
create policy notify_read on family_notifications
  for select using (
    (family_user_id = auth.uid() and state in ('queued', 'sent'))
    or is_coordinator_of(senior_id)
    or is_admin()
  );

-- Only the coordinator working the case may mark one as sent; a family member
-- reads their own and changes nothing.
drop policy if exists notify_coordinator_write on family_notifications;
create policy notify_coordinator_write on family_notifications
  for update using (is_coordinator_of(senior_id)) with check (is_coordinator_of(senior_id));

-- ------------------------------------------------------------ the gate -----

-- One row per linked family member, every time, recording either that a
-- message is queued or that it was withheld and why.
--
-- ABSENCE OF A CONSENT ROW MEANS NO CONSENT. That is the schema's rule from
-- migration 0001 and it is restated here because the easy mistake — treating
-- a missing row as "not configured, so go ahead" — is the one that sends a
-- stranger a message about somebody's health.
create or replace function notify_family(
  p_senior uuid,
  p_kind   text,
  p_body   text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind    notify_kind;
  v_scope   text;
  v_granted boolean;
  r         record;
  v_queued  int := 0;
  v_held    int := 0;
begin
  begin
    v_kind := p_kind::notify_kind;
  exception when invalid_text_representation then
    return jsonb_build_object('ok', false, 'reason', 'unknown_kind');
  end;

  if nullif(btrim(coalesce(p_body, '')), '') is null then
    return jsonb_build_object('ok', false, 'reason', 'empty');
  end if;

  v_scope := case v_kind
               when 'emergency' then 'urgent_call'
               when 'arranged'  then 'visit_notice'
               else 'family_summary'
             end;

  select granted into v_granted
    from consents where senior_id = p_senior and scope = v_scope;
  v_granted := coalesce(v_granted, false);

  for r in select family_user_id from family_links where senior_id = p_senior loop
    if v_granted then
      insert into family_notifications (senior_id, family_user_id, kind, body, state)
      values (p_senior, r.family_user_id, v_kind, p_body, 'queued');
      v_queued := v_queued + 1;
    else
      insert into family_notifications (senior_id, family_user_id, kind, body, state, reason)
      values (p_senior, r.family_user_id, v_kind, p_body, 'suppressed',
              'No consent recorded for ' || v_scope || '.');
      v_held := v_held + 1;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'queued', v_queued, 'withheld', v_held, 'scope', v_scope);
end;
$$;

revoke all on function notify_family(uuid, text, text) from public;
revoke all on function notify_family(uuid, text, text) from anon;
grant execute on function notify_family(uuid, text, text) to authenticated;

-- ----------------------------------------------------- hooked up -----------

-- The emergency button now reaches the family too, through the gate. Replaces
-- the body from 0016; everything else about it is unchanged.
create or replace function raise_sos(p_secret text, p_phone text)
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

  return jsonb_build_object('ok', true, 'id', v_id, 'senior_name', v_name);
end;
$$;

revoke all on function raise_sos(text, text) from public;
grant execute on function raise_sos(text, text) to anon;

-- A confirmed errand is the good news a family actually wants. Fires on the
-- transition only, so re-saving a confirmed row does not message anyone
-- twice.
create or replace function notify_on_confirmed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  if new.state = 'confirmed' and old.state is distinct from 'confirmed' then
    select display_name into v_name from seniors where id = new.senior_id;
    perform notify_family(
      new.senior_id, 'arranged',
      'Something ' || coalesce(v_name, 'they') || ' asked for has been sorted: ' || new.summary);
  end if;
  return new;
end;
$$;

drop trigger if exists assistance_confirmed_notify on assistance_requests;
create trigger assistance_confirmed_notify
  after update on assistance_requests
  for each row execute function notify_on_confirmed();
