-- Extend the operations view so the dashboard's headline numbers come from
-- the database rather than from fixtures.
--
-- 0002's view covers volume and outcome mix but not two numbers the ops
-- surface leads with: median time to first action, and how many seniors the
-- programme covers. Both are still aggregates -- no senior_id, no names, no
-- scores per person -- so the "ops sees aggregates only" guarantee is intact
-- and ops still holds no table-level policy anywhere.
--
-- Dropped and recreated rather than `create or replace` so the column list and
-- the security_invoker setting are unambiguous. The grants are reapplied here,
-- including the revoke from anon that 0003 explains.

drop view if exists ops_daily_metrics;

create view ops_daily_metrics
with (security_invoker = false) as
  select
    a.raised_on                                              as day,
    count(*)                                                 as alerts_raised,
    count(*) filter (where a.status = 'actioned')             as actioned,
    count(*) filter (where a.status = 'dismissed')            as dismissed,
    count(*) filter (where a.escalated)                       as escalated,
    count(*) filter (where a.status = 'open')                 as still_open,
    count(distinct a.coordinator_id)                          as coordinators_active,
    count(distinct a.senior_id)                               as seniors_alerted,
    round(avg(a.score), 4)                                   as mean_score,
    count(*) filter (where f.result = 'true_concern')        as true_concern,
    count(*) filter (where f.result = 'false_alarm')         as false_alarm,
    count(*) filter (where f.result = 'unreachable')         as unreachable,
    count(*) filter (where f.result = 'pending'
                        or f.alert_id is null)                as no_verdict,
    -- Minutes from the alert being raised to the coordinator recording a
    -- verdict. Median, not mean: a single unreachable senior chased all day
    -- would otherwise move the number more than the workload does.
    round(percentile_cont(0.5) within group (
      order by extract(epoch from (f.acted_at - a.created_at)) / 60.0
    )::numeric, 1)                                           as median_minutes_to_action,
    -- Programme size. Constant across days by construction; carried on each
    -- row so the surface needs one query, not two.
    (select count(*) from seniors where is_active)            as seniors_enrolled
  from alerts a
  left join alert_feedback f on f.alert_id = a.id
  group by a.raised_on;

revoke all on ops_daily_metrics from public;
revoke all on ops_daily_metrics from anon;
grant select on ops_daily_metrics to authenticated;

comment on view ops_daily_metrics is
  'Aggregates only. Ops has no table-level policy anywhere, so this view is '
  'the whole of its access to operational data. SELECT is granted to '
  'authenticated and explicitly revoked from anon: the view is security '
  'definer, so no RLS stands behind this grant.';
