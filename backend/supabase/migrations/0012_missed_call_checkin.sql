-- The third check-in channel: a missed call.
--
-- The brief offers a senior "a voice note, a missed-call check-in or a
-- one-tap reply". Two of those existed. The third did not, and it is the one
-- that matters most for the people this product is actually for: it costs
-- nothing, needs no smartphone, no literacy, no network data and no app. A
-- senior dials a number, lets it ring, hangs up. That is the whole interaction.
--
-- WHAT A MISSED CALL ACTUALLY MEANS, AND WHAT IT DOES NOT. It says somebody
-- at that number was awake, found the phone, and could dial. That is a real
-- signal and it is the cheapest one we will ever get. It says NOTHING about
-- pain, medication or mood, so this records answered = true with every
-- detail column left null, and `source` records which channel it came from.
-- Without that column a dial-and-hang-up would be indistinguishable from a
-- senior who answered six questions, and a coordinator would read a far
-- stronger reassurance than the evidence supports.
--
-- WHY THE AUTHORISATION LIVES IN THE DATABASE. The webhook is called by a
-- telephony provider, server to server, with no Supabase session to key an
-- RLS policy off. The obvious answer -- give the deployment a service-role
-- key -- would put a key that bypasses RLS entirely on a public host, to
-- write one boolean. Instead the check is a security-definer function that
-- verifies a shared secret against a stored digest. The deployment holds no
-- privileged credential at all; it relays a header. If the Next.js host were
-- compromised tomorrow, the attacker would gain the ability to mark seniors
-- as having phoned in, and nothing else.

-- ------------------------------------------------------------- the channel --

alter table checkins
  add column if not exists source text not null default 'ivr';

do $$ begin
  alter table checkins add constraint checkins_source_check
    check (source in ('ivr', 'missed_call', 'coordinator'));
exception when duplicate_object then null; end $$;

comment on column checkins.source is
  'Which channel the check-in arrived on. missed_call carries no detail codes by construction.';

-- A missed call is matched by the number that dialled, so the number has to
-- exist. The cohort loader never set one. These are deterministic and
-- obviously synthetic, and they are the only way to demonstrate the channel.
update seniors s
   set phone = '+91' || (9000000000 + n.rn)::text
  from (select id, row_number() over (order by created_at, id) as rn from seniors) n
 where n.id = s.id and s.phone is null;

create unique index if not exists seniors_phone_last10_idx
  on seniors ((right(regexp_replace(phone, '\D', '', 'g'), 10)))
  where phone is not null;

-- ------------------------------------------------------------- the secret --

-- Only the digest is stored, so this file is safe to commit and the raw
-- secret exists in exactly one place: whatever the telephony provider was
-- configured with. No policy and no grant, so it is unreachable through
-- PostgREST by any role; the definer function below is the only reader.
create table if not exists checkin_webhook_keys (
  name          text primary key,
  secret_sha256 text not null,
  created_at    timestamptz not null default now()
);

alter table checkin_webhook_keys enable row level security;
revoke all on checkin_webhook_keys from anon;
revoke all on checkin_webhook_keys from authenticated;

insert into checkin_webhook_keys (name, secret_sha256)
values ('missed-call', 'd1ffa0300721c5e2992de6695fa17f8b7a33bf7fa52e9a93651e27047c6af39c')
on conflict (name) do update set secret_sha256 = excluded.secret_sha256;

-- ------------------------------------------------------------ the endpoint --

-- Returns a verdict rather than raising, so the caller never depends on how
-- PostgREST maps a Postgres error code, and an unauthorised caller gets the
-- same answer for every number -- there is no way to probe which numbers are
-- enrolled without already holding the secret.
--
-- It returns no name and no id. The provider already knows the number it
-- dialled from; it has no business learning who that is.
--
-- Idempotent by the day, which is what makes a flaky telephony retry safe:
-- three deliveries of the same missed call are one check-in.
create or replace function record_missed_call(p_secret text, p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_digits text;
  v_senior uuid;
begin
  if p_secret is null or length(p_secret) < 16
     or not exists (
       select 1 from checkin_webhook_keys
        where secret_sha256 = encode(sha256(convert_to(p_secret, 'utf8')), 'hex')
     )
  then
    return jsonb_build_object('ok', false, 'reason', 'unauthorized');
  end if;

  v_digits := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);
  if length(v_digits) <> 10 then
    return jsonb_build_object('ok', false, 'reason', 'bad_number');
  end if;

  select id into v_senior
    from seniors
   where is_active
     and phone is not null
     and right(regexp_replace(phone, '\D', '', 'g'), 10) = v_digits
   limit 1;

  if v_senior is null then
    return jsonb_build_object('ok', false, 'reason', 'unknown_number');
  end if;

  -- A missed call arriving after a full answered call must not overwrite the
  -- richer record with a thinner one. It only upgrades a day that is empty or
  -- was logged as unreached.
  insert into checkins (senior_id, checked_on, answered, source)
  values (v_senior, current_date, true, 'missed_call')
  on conflict (senior_id, checked_on) do update
     set answered = true,
         source = case
           when checkins.feeling_code is null and checkins.pain_code is null
                and checkins.meds_taken is null
             then 'missed_call'
           else checkins.source
         end;

  return jsonb_build_object('ok', true, 'recorded_on', current_date, 'channel', 'missed_call');
end;
$$;

revoke all on function record_missed_call(text, text) from public;
grant execute on function record_missed_call(text, text) to anon;
grant execute on function record_missed_call(text, text) to authenticated;
