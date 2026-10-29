-- Daily step count on vitals.
--
-- The brief offers "fall or inactivity detection from phone or wearable
-- sensor data" as a stretch goal, and the inactivity half was already half
-- built without anyone being able to see it: the cohort generator produces a
-- daily step count, features/windows.py puts it through the same trailing
-- window as every other vital, and scoring/baseline.py weights steps_z at
-- 0.14 against the senior's own median. So activity has been moving the risk
-- score all along.
--
-- What was missing was the last hop. `vitals` had no column for it and the
-- loader dropped it, so the number that influenced the score never reached
-- the database, the dashboard or the report. A signal you cannot show is a
-- signal a coordinator cannot check, and an unverifiable input is worse than
-- no input at all.
--
-- Nullable because it genuinely is: a senior on a basic handset has no step
-- count, and the windowing already treats a missing value as missing rather
-- than as zero. Zero steps and no pedometer are very different days.

alter table vitals add column if not exists steps int;

comment on column vitals.steps is
  'Daily step count from a phone or wearable. NULL where the senior carries '
  'neither — distinct from 0, which means measured and stationary.';
