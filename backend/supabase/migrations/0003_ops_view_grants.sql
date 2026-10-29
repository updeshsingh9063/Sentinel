-- Close an anon read of the operations view.
--
-- 0002 ends with:
--     revoke all on ops_daily_metrics from public;
--     grant  select on ops_daily_metrics to authenticated;
--
-- which states the intent plainly: signed-in roles only. It does not hold on
-- Supabase. The platform ships `alter default privileges` granting anon,
-- authenticated and service_role ALL privileges (arwdDxtm) on new objects in
-- public, and those are grants to named roles -- a revoke from PUBLIC does not
-- touch them.
--
-- For the 15 base tables that is survivable: RLS is on and a role with no
-- permissive policy reads nothing. ops_daily_metrics is the exception. It is
-- deliberately `security_invoker = false` so it can aggregate across seniors,
-- which means no RLS stands behind it -- the grant is the only gate. Verified
-- against the live project: an unauthenticated caller holding only the public
-- anon key (it ships in the browser bundle) read all 21 rows.
--
-- Nothing individual leaks -- the view emits counts and rates, no senior_id
-- and no names -- but alert volumes, actioned rates and false-alarm rates are
-- operational data and were never meant to be public.

revoke all on ops_daily_metrics from anon;

-- The view aggregates, so it was never auto-updatable; these grants were
-- meaningless but are removed so the privilege list matches the intent.
revoke insert, update, delete, truncate, references, trigger
  on ops_daily_metrics from authenticated;

grant select on ops_daily_metrics to authenticated;

comment on view ops_daily_metrics is
  'Aggregates only. Ops has no table-level policy anywhere, so this view is '
  'the whole of its access to operational data. SELECT is granted to '
  'authenticated and explicitly revoked from anon: the view is security '
  'definer, so no RLS stands behind this grant.';
