-- 0016 — the product stops only watching and starts fetching help.
--
-- WHAT WAS MISSING. Everything built so far observes a senior: it scores them,
-- ranks them, and tells a coordinator who needs attention. It has never once
-- got anybody anything. A senior whose medicines have run out could say so on
-- the daily call and the system's entire response was to note it down.
--
-- THE LOOP THAT MATTERS IS THE LAST STEP. Raising a request is easy and most
-- prototypes stop there. What a family actually wants to know is whether the
-- thing got done, so a request here is not closed when a coordinator reads it,
-- and not closed when they arrange it. It is closed when somebody confirms it
-- happened. `arranged` and `confirmed` are deliberately two states, because
-- "I have called the chemist" and "the medicines are in the house" are not the
-- same fact and a product that conflates them is lying to a daughter.
--
-- URGENCY IS A FLAG, NOT A TABLE. An emergency is an assistance request that
-- cannot wait. Giving it its own table would mean two code paths, two sets of
-- policies and two chances for one of them to be wrong about who can read it.

do $$ begin
  create type request_kind as enum (
  'medicine',        -- run out, or cannot collect them
  'appointment',     -- wants to see a doctor
  'groceries',       -- food, essentials
  'transport',       -- needs taking somewhere, or accompanying
  'contact_family',  -- wants someone to call their family
  'home_help',       -- something in the house they cannot manage
  'emergency',       -- needs help right now
  'other'
  );
exception when duplicate_object then null; end $$;

-- open -> arranged -> confirmed. `cancelled` is for a request that turned out
-- not to be one, which is a real outcome and must not be recorded as done.
do $$ begin
  create type request_state as enum ('open', 'arranged', 'confirmed', 'cancelled');
exception when duplicate_object then null; end $$;

create table if not exists assistance_requests (
  id            bigserial primary key,
  senior_id     uuid not null references seniors(id) on delete cascade,
  raised_on     date not null default current_date,
  kind          request_kind not null,
  urgent        boolean not null default false,
  -- The senior's own words, kept verbatim. A coordinator deciding what to do
  -- must be able to read what was actually said rather than only the system's
  -- reading of it.
  said          text,
  summary       text not null,
  source        text not null default 'conversation'
                check (source in ('conversation', 'sos_button', 'coordinator')),
  state         request_state not null default 'open',
  arranged_by   uuid references app_users(id) on delete set null,
  arranged_note text,
  arranged_at   timestamptz,
  confirmed_at  timestamptz,
  created_at    timestamptz not null default now()
);

create index on assistance_requests (senior_id, raised_on desc);
-- The coordinator's queue: anything not finished, urgent first.
create index on assistance_requests (state, urgent desc, created_at)
  where state in ('open', 'arranged');

alter table assistance_requests enable row level security;

-- Same shape as alerts: a coordinator sees their caseload and nobody else's.
drop policy if exists assistance_coordinator on assistance_requests;
create policy assistance_coordinator on assistance_requests
  for select using (is_coordinator_of(senior_id) or is_admin());

drop policy if exists assistance_coordinator_update on assistance_requests;
create policy assistance_coordinator_update on assistance_requests
  for update using (is_coordinator_of(senior_id))
  with check (is_coordinator_of(senior_id));

drop policy if exists assistance_coordinator_insert on assistance_requests;
create policy assistance_coordinator_insert on assistance_requests
  for insert with check (is_coordinator_of(senior_id));

-- FAMILY IS NOT GRANTED ANYTHING HERE, and that is a decision rather than an
-- omission. "Ran out of medicines" is a health fact, and the privacy claim
-- this product makes to a family member is that they get a summary and a
-- consent switch, not the record. A later migration can add a view that
-- exposes kind and state without `said` if that is wanted; a policy on the
-- table itself would hand over the words too.

revoke all on assistance_requests from anon;

-- ------------------------------------------------- raised on the call ------

-- Called by the public check-in page with the anon key, exactly like
-- record_demo_conversation, and containing itself the same way: no senior id
-- in the signature, the target read from the demo-line flag inside.
create or replace function record_demo_request(
  p_kind    text,
  p_urgent  boolean,
  p_said    text,
  p_summary text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_senior uuid;
  v_name   text;
  v_kind   request_kind;
  v_id     bigint;
begin
  select id, display_name into v_senior, v_name
    from seniors where demo_line and is_active limit 1;

  if v_senior is null then
    return jsonb_build_object('ok', false, 'reason', 'no_demo_line');
  end if;

  -- An unrecognised kind becomes 'other' rather than raising. A request a
  -- model could not categorise is still a person asking for something, and
  -- losing it over a label would be the worst possible trade.
  begin
    v_kind := p_kind::request_kind;
  exception when invalid_text_representation then
    v_kind := 'other';
  end;

  if nullif(btrim(coalesce(p_summary, '')), '') is null then
    return jsonb_build_object('ok', false, 'reason', 'no_summary');
  end if;

  -- One open request of a kind per senior per day. Saying "my medicines have
  -- run out" twice in one conversation is one errand, not two, and a queue
  -- that double-counts it wastes the time of the person working it.
  select id into v_id
    from assistance_requests
   where senior_id = v_senior
     and raised_on = current_date
     and kind = v_kind
     and state in ('open', 'arranged')
   limit 1;

  if v_id is not null then
    update assistance_requests
       set summary = p_summary,
           said    = coalesce(nullif(btrim(p_said), ''), said),
           -- Urgency only ever goes up. If they mentioned it calmly and then
           -- said it was urgent, it is urgent.
           urgent  = urgent or coalesce(p_urgent, false)
     where id = v_id;
  else
    insert into assistance_requests (senior_id, kind, urgent, said, summary, source)
    values (v_senior, v_kind, coalesce(p_urgent, false),
            nullif(btrim(p_said), ''), p_summary, 'conversation')
    returning id into v_id;
  end if;

  return jsonb_build_object(
    'ok', true, 'id', v_id, 'kind', v_kind,
    'senior_name', v_name, 'urgent', coalesce(p_urgent, false)
  );
end;
$$;

revoke all on function record_demo_request(text, boolean, text, text) from public;
grant execute on function record_demo_request(text, boolean, text, text) to anon;

-- ------------------------------------------------------- the SOS line ------

-- A BUTTON, NOT AN APP. The point of this channel is that it needs no screen,
-- no network and no literacy: a pendant, a wired button by the bed, or a
-- missed call to a dedicated number. The device holds nothing but a shared
-- secret, and the relay in front of this function holds nothing at all.
--
-- Deliberately reuses the key table the missed-call channel already has, so
-- there is one place where device secrets live and one place to rotate them.
insert into checkin_webhook_keys (name, secret_sha256)
values ('sos', '350adb34c537baa9704917de1b1c4aa80d807af78c39d6d2cc978b478b8b2173')
on conflict (name) do nothing;

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

  -- Returned, not raised, and identically whether or not the number is
  -- enrolled once the secret is wrong. Without this, anyone could use the
  -- error to ask "is this person a customer?" and get an answer.
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

  -- A second press while the first is still being worked is the same
  -- emergency, and it must not create a second row that a coordinator has to
  -- notice is a duplicate. It does refresh the time, because repeated presses
  -- are themselves a signal that nobody has reached them yet.
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
  else
    update assistance_requests
       set created_at = now(),
           summary = 'Emergency button pressed again. Still nobody has reached them.'
     where id = v_id;
  end if;

  -- NOTE WHAT THIS DOES NOT DO. It does not call an ambulance, notify next of
  -- kin, or dispatch anything. It puts a named person at the top of a human
  -- being's list and records the time. Claiming more than that in a system
  -- that cannot do it is how people come to rely on something that was never
  -- there.
  return jsonb_build_object('ok', true, 'id', v_id, 'senior_name', v_name);
end;
$$;

revoke all on function raise_sos(text, text) from public;
grant execute on function raise_sos(text, text) to anon;

-- ------------------------------------------------- working the queue -------

-- Arranging and confirming are separate calls because they are separate
-- facts. Both are done by a signed-in coordinator against their own caseload,
-- so these are ordinary RLS-governed updates and need no elevated function --
-- the policies above are what enforce it.
