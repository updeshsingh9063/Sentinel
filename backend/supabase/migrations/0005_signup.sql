-- Real registration.
--
-- Until now every account was created through the Auth Admin API by a seed
-- script, which also wrote the matching app_users row. Open sign-up cannot
-- work that way: RLS grants no INSERT policy on app_users (by design — a user
-- must not be able to mint their own role), so a client that just signed up
-- has no way to create its own profile row and every policy keyed on
-- current_app_role() would return nothing.
--
-- A trigger closes that, running as the definer rather than as the new user.
--
-- THE SECURITY POINT. raw_user_meta_data is supplied by the CLIENT at sign-up
-- and is entirely under the user's control. Trusting it verbatim would let
-- anyone register as 'admin' and read every senior in the system, because
-- is_admin() is the one predicate that bypasses the per-senior checks. The
-- role is therefore clamped to the three self-serviceable roles, and the
-- default is the least privileged one rather than the most convenient.
--
-- 'admin' is deliberately not reachable through sign-up at all. It is granted
-- by an operator with database access, which is the only way it should be.

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested text := coalesce(new.raw_user_meta_data ->> 'demo_role', '');
  resolved  user_role;
  display   text;
begin
  resolved := case requested
    when 'coordinator' then 'coordinator'::user_role
    when 'ops'         then 'ops'::user_role
    when 'family'      then 'family'::user_role
    else 'family'::user_role          -- least privilege, never admin
  end;

  display := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    initcap(replace(split_part(new.email, '@', 1), '.', ' ')),
    'New user'
  );

  insert into app_users (id, role, full_name)
  values (new.id, resolved, display)
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function handle_new_user();

comment on function handle_new_user is
  'Creates the app_users row for a newly registered account. The role is '
  'clamped to coordinator/family/ops because sign-up metadata is '
  'client-controlled; admin is never reachable this way.';

-- A newly registered coordinator holds no care_assignments and a newly
-- registered family member holds no family_links, so both correctly see
-- nothing until someone links them. That is RLS working, not a bug, and the
-- surfaces say so rather than rendering an unexplained empty page.
