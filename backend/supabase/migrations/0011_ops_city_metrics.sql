-- Operations, broken down by city.
--
-- The brief's operations persona wants "alert volumes, response times and
-- outcomes across a CITY or team", and the dashboard copy has been saying
-- "All cities" — which implies a breakdown that did not exist. A label
-- promising a cut of the data that cannot be made is a claim, not a feature.
--
-- AGGREGATES ONLY, like everything else this role can reach. No senior id,
-- no name, nothing that identifies a person. Operations holds no policy on
-- any individual table in this schema, and this view does not quietly become
-- the exception: it groups, counts, and returns one row per city.
--
-- Revoking from anon is not optional. Supabase grants anon every privilege on
-- new objects in public by default, and a security-definer view has no RLS
-- behind it, so that grant would be the whole story. Same trap as 0003 and
-- 0006.

create or replace view ops_city_metrics as
  select
    s.city,
    count(distinct s.id)                                            as seniors,
    count(a.id)                                                     as alerts_raised,
    count(a.id) filter (where a.status = 'open')                    as still_open,
    count(f.alert_id) filter (where f.result = 'true_concern')      as true_concern,
    count(f.alert_id) filter (where f.result = 'false_alarm')       as false_alarm,
    count(f.alert_id) filter (where f.result = 'unreachable')       as unreachable,
    -- Minutes from alert to the coordinator recording a verdict. Median, not
    -- mean, so one senior chased all afternoon does not define the city.
    round(percentile_cont(0.5) within group (
      order by extract(epoch from (f.acted_at - a.created_at)) / 60.0
    )::numeric, 0)                                                  as median_minutes_to_action
  from seniors s
  left join alerts a         on a.senior_id = s.id
  left join alert_feedback f on f.alert_id = a.id
  where s.is_active and s.city is not null
  group by s.city;

revoke all on ops_city_metrics from anon;
revoke all on ops_city_metrics from authenticated;
grant select on ops_city_metrics to authenticated;
