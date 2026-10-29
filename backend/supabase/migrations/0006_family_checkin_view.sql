-- Family-visible check-in days.
--
-- A family member has one question this answers: did my parent pick up the
-- phone this week. That is not a health reading, it is the one pattern a
-- family can act on by themselves, and without it the family's weekly report
-- is prose with nothing to look at.
--
-- WHY A VIEW AND NOT A POLICY ON checkins.
--
-- Row-level security is row-level. A policy letting a family member read their
-- senior's check-in rows would hand over feeling_code, pain_code and
-- meds_taken along with them — how they said they felt, whether they were in
-- pain, whether they took their medicine. Those are health answers and family
-- has no business reading them. Narrowing to columns needs a view.
--
-- THE WHERE CLAUSE IS THE ONLY GATE. This view is security definer, which is
-- the default, so it reads `checkins` straight past that table's RLS. Nothing
-- underneath will stop it. Both conditions are therefore spelled out here:
-- linked to the caller, and family_summary consent currently granted. Revoke
-- the consent and this view goes empty on the next query.
--
-- Reusing is_family_of() and has_consent() rather than inlining the lookups
-- keeps one definition of "is this person's family" in the schema. Both are
-- security definer and key off auth.uid(), so they resolve per-caller even
-- from inside a definer view.
--
-- REVOKING FROM anon IS NOT OPTIONAL. Supabase ships default privileges that
-- grant anon every privilege on new objects in public, and a revoke from
-- PUBLIC does not touch a grant made to a named role. A security-definer view
-- has no RLS behind it, so that grant would be the whole story — anyone
-- holding the publishable anon key could read it. This is the same trap that
-- made ops_daily_metrics world-readable until 0003 closed it.

create view family_checkin_days as
select
  c.senior_id,
  c.checked_on,
  c.answered
from checkins c
where is_family_of(c.senior_id)
  and has_consent(c.senior_id, 'family_summary');

revoke all on family_checkin_days from anon;
revoke all on family_checkin_days from authenticated;
grant select on family_checkin_days to authenticated;
