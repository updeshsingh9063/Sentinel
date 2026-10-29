-- Row-level security.
--
-- The brief scores privacy and safety directly, and two of its constraints are
-- structural rather than cosmetic:
--
--   * A family member must never see raw health data or anything diagnostic.
--     Enforced by granting family NO policy on vitals, call_notes, note_cues
--     or risk_scores. There is nothing to leak, however the API is called.
--   * An ops manager must see aggregates only. Enforced by granting ops no
--     table policies at all and exposing one security-definer view that has
--     already aggregated away the individual.
--
-- Coordinators are the only role that reads individual health data, and only
-- for seniors assigned to them.

-- ------------------------------------------------------------- helpers -----

-- Wrapped in a function so policies stay readable and the role lookup is
-- indexed once. STABLE lets Postgres cache it per statement.
create or replace function current_app_role()
returns user_role
language sql stable security definer set search_path = public
as $$
  select role from app_users where id = auth.uid();
$$;

create or replace function is_coordinator_of(target uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from care_assignments
    where coordinator_id = auth.uid() and senior_id = target
  );
$$;

create or replace function is_family_of(target uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from family_links
    where family_user_id = auth.uid() and senior_id = target
  );
$$;

-- Consent is checked per scope. No row means no consent.
create or replace function has_consent(target uuid, want text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select granted from consents where senior_id = target and scope = want),
    false
  );
$$;

create or replace function is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select current_app_role() = 'admin';
$$;

-- ------------------------------------------- family-facing summary ---------

-- Plain-language, non-diagnostic text written for a family member. Generated
-- from a template and gated by the banned-phrase test before insert, so the
-- family path can never carry a condition name.
create table family_summaries (
  id          bigserial primary key,
  senior_id   uuid not null references seniors(id) on delete cascade,
  covers_on   date not null,
  summary_text text not null,
  -- Set by the banned-phrase gate in CI and at write time.
  safety_checked boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (senior_id, covers_on)
);
create index on family_summaries (senior_id, covers_on desc);

-- ---------------------------------------------------- enable RLS -----------

alter table app_users        enable row level security;
alter table seniors          enable row level security;
alter table care_assignments enable row level security;
alter table family_links     enable row level security;
alter table consents         enable row level security;
alter table vitals           enable row level security;
alter table medication_logs  enable row level security;
alter table call_notes       enable row level security;
alter table checkins         enable row level security;
alter table note_cues        enable row level security;
alter table risk_scores      enable row level security;
alter table alerts           enable row level security;
alter table alert_feedback   enable row level security;
alter table family_summaries enable row level security;
alter table audit_log        enable row level security;

-- ---------------------------------------------------- app_users ------------

create policy app_users_self_read on app_users
  for select using (id = auth.uid() or is_admin());

-- ---------------------------------------------------- seniors --------------

-- Coordinators see their caseload. Family see the one senior they are linked
-- to -- identity only, which they already know; no health columns live here.
create policy seniors_read on seniors
  for select using (
    is_coordinator_of(id) or is_family_of(id) or is_admin()
  );

create policy seniors_write on seniors
  for all using (is_admin()) with check (is_admin());

-- ---------------------------------------------------- assignments ----------

create policy assignments_read on care_assignments
  for select using (coordinator_id = auth.uid() or is_admin());

create policy family_links_read on family_links
  for select using (family_user_id = auth.uid() or is_admin());

-- ---------------------------------------------------- consents -------------

-- A family member may see and change consent for their own senior. This is
-- the one write a family member has.
create policy consents_read on consents
  for select using (
    is_family_of(senior_id) or is_coordinator_of(senior_id) or is_admin()
  );

create policy consents_family_update on consents
  for update using (is_family_of(senior_id))
  with check (is_family_of(senior_id));

create policy consents_admin_write on consents
  for all using (is_admin()) with check (is_admin());

-- ------------------------------------- raw health data: coordinator only ---

-- Deliberately no family and no ops policy on any table below.

create policy vitals_coordinator on vitals
  for select using (is_coordinator_of(senior_id) or is_admin());
create policy vitals_ingest on vitals
  for insert with check (is_coordinator_of(senior_id) or is_admin());

create policy meds_coordinator on medication_logs
  for select using (is_coordinator_of(senior_id) or is_admin());
create policy meds_ingest on medication_logs
  for insert with check (is_coordinator_of(senior_id) or is_admin());

create policy notes_coordinator on call_notes
  for select using (is_coordinator_of(senior_id) or is_admin());
create policy notes_author_write on call_notes
  for insert with check (is_coordinator_of(senior_id) or is_admin());

create policy checkins_coordinator on checkins
  for select using (is_coordinator_of(senior_id) or is_admin());
create policy checkins_ingest on checkins
  for insert with check (is_coordinator_of(senior_id) or is_admin());

create policy cues_coordinator on note_cues
  for select using (is_coordinator_of(senior_id) or is_admin());

create policy risk_coordinator on risk_scores
  for select using (is_coordinator_of(senior_id) or is_admin());

-- ---------------------------------------------------- alerts ---------------

create policy alerts_coordinator on alerts
  for select using (
    coordinator_id = auth.uid() or is_coordinator_of(senior_id) or is_admin()
  );

create policy alerts_coordinator_update on alerts
  for update using (is_coordinator_of(senior_id))
  with check (is_coordinator_of(senior_id));

create policy feedback_coordinator on alert_feedback
  for all using (
    exists (select 1 from alerts a
            where a.id = alert_id and is_coordinator_of(a.senior_id))
  )
  with check (
    exists (select 1 from alerts a
            where a.id = alert_id and is_coordinator_of(a.senior_id))
  );

-- ------------------------------------------- family summaries --------------

-- The only health-adjacent read a family member gets, and only with consent
-- and only once the banned-phrase gate has passed.
create policy family_summary_read on family_summaries
  for select using (
    (is_family_of(senior_id)
      and has_consent(senior_id, 'family_summary')
      and safety_checked)
    or is_coordinator_of(senior_id)
    or is_admin()
  );

-- ---------------------------------------------------- audit log ------------

-- Append-only: insert allowed, no select for non-admins, no update or delete
-- policy at all, so even an admin cannot rewrite history through the API.
create policy audit_insert on audit_log
  for insert with check (auth.uid() is not null);

create policy audit_admin_read on audit_log
  for select using (is_admin());

-- ------------------------------------------- ops: aggregates only ----------

-- Security definer so it bypasses the per-row policies, but it only ever
-- emits counts and rates. No senior_id, no names, no vitals.
create or replace view ops_daily_metrics
with (security_invoker = false) as
  select
    a.raised_on                                              as day,
    count(*)                                                 as alerts_raised,
    count(*) filter (where a.status = 'actioned')             as actioned,
    count(*) filter (where a.status = 'dismissed')            as dismissed,
    count(*) filter (where a.escalated)                       as escalated,
    count(distinct a.coordinator_id)                          as coordinators_active,
    round(avg(a.score), 4)                                   as mean_score,
    count(*) filter (where f.result = 'true_concern')        as true_concern,
    count(*) filter (where f.result = 'false_alarm')         as false_alarm
  from alerts a
  left join alert_feedback f on f.alert_id = a.id
  group by a.raised_on;

revoke all on ops_daily_metrics from public;
grant select on ops_daily_metrics to authenticated;

comment on view ops_daily_metrics is
  'Aggregates only. Ops has no table-level policy anywhere, so this view is '
  'the whole of its access to operational data.';
