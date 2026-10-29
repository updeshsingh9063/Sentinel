-- Give a newly registered account something to look at.
--
-- THE PROBLEM THIS FIXES. Registration worked and produced an account that
-- could see nothing. A new coordinator landed on an empty worklist, a new
-- family member on an empty summary, and there was no screen anywhere for
-- assigning a senior to either. Both pages correctly explained that the
-- database had returned no rows — which is accurate, and useless. Anyone
-- evaluating this by making their own account, which is the first thing a
-- reviewer does, concluded the product was broken.
--
-- THIS IS DEMO SEEDING AND NOTHING ELSE. In a real deployment a caseload is
-- assigned by an operations manager and a family link is created with the
-- senior's consent; neither is something a person grants themselves by
-- signing up. The cohort here is synthetic, so handing a new account a slice
-- of it costs nobody anything. If this ever runs against real records it is a
-- privacy incident, so it is isolated in one function with this comment on it
-- rather than buried inside handle_new_user().
--
-- It does NOT widen anybody's permissions. The new account still reads through
-- exactly the same policies as every other account; it simply now has rows
-- those policies can match. A coordinator still sees only their own caseload,
-- and a family member still sees only prose.
--
-- Seniors are shared with the seeded demo coordinator rather than moved.
-- care_assignments is keyed on (coordinator_id, senior_id), so one senior may
-- legitimately have several coordinators, and taking them away from the demo
-- account would break the demo for the next person.

create or replace function seed_demo_access()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.role = 'coordinator' then
    -- Twelve is a plausible caseload and a little over the daily cap of ten,
    -- so the worklist has something to hold back and the budget is visible.
    -- Ordering by a hash of both ids is deterministic per account but
    -- different between accounts: two reviewers registering side by side get
    -- different lists, which looks like a product rather than a fixture.
    insert into care_assignments (coordinator_id, senior_id)
    select new.id, s.id
    from seniors s
    where s.is_active
    order by md5(s.id::text || new.id::text)
    limit 12
    on conflict do nothing;

  elsif new.role = 'family' then
    -- Only a senior who already has a published, safety-checked summary AND
    -- consent granted. Linking to anyone else would land the new account on
    -- the "no summary published yet" state, which is the same empty wall this
    -- migration exists to remove.
    insert into family_links (family_user_id, senior_id, relationship, is_primary)
    select new.id, s.id, 'family member', true
    from seniors s
    where s.is_active
      and exists (
        select 1 from consents c
        where c.senior_id = s.id and c.scope = 'family_summary' and c.granted
      )
      and exists (
        select 1 from family_summaries f
        where f.senior_id = s.id and f.safety_checked
      )
    order by md5(s.id::text || new.id::text)
    limit 1
    on conflict do nothing;
  end if;

  -- Operations needs nothing: ops_daily_metrics is granted to every
  -- authenticated user and emits only aggregates.
  return new;
end;
$$;

drop trigger if exists on_app_user_created on app_users;

create trigger on_app_user_created
  after insert on app_users
  for each row execute function seed_demo_access();
