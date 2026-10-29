-- Tell the caller whose line they are on, before they speak.
--
-- The sign-in page offers a card labelled "Savitri Devi", a fixture name that
-- no longer exists anywhere in this database -- the cohort loader replaced the
-- hand-written seed. Clicking it opens the check-in, which files the call to
-- whichever senior carries `demo_line`, currently Abdul D'Souza. So a person
-- could answer six questions as one name and then search the coordinator's
-- dashboard for a different one, find nothing, and reasonably conclude the
-- feature was broken. It was not broken; it was lying about who it was.
--
-- A NAME IS ALL THIS RETURNS. No id, no age, no city, no readings, nothing
-- joinable. Anon already reads zero rows from `seniors` and that stays true;
-- this is one display name for one senior who is designated public precisely
-- because the public check-in writes to them. Returning the id would hand an
-- anonymous caller the key to every other query in the schema, so it does not.

create or replace function demo_line_name()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select display_name from seniors where demo_line and is_active limit 1;
$$;

revoke all on function demo_line_name() from public;
grant execute on function demo_line_name() to anon;
grant execute on function demo_line_name() to authenticated;
