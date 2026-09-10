-- 016_hr_anchors.sql
-- The two numbers every percentage-based zone model needs, and that STRIDE
-- never stored.
--
-- STRIDE's own zones are threshold-anchored (LT1/LT2, migration 007) and need
-- neither of these. But Strava and Apple Fitness show the runner a five-zone
-- model computed from max and resting HR, and when those two views disagree
-- there was no way to explain the gap — the app couldn't see the inputs the
-- other model was using. Storing them lets the zone hub show both side by side
-- and name the disagreement instead of leaving the runner to re-tune zones by
-- guess.
--
-- resting_hr is a stopgap. docs/healthBridge.md plans a daily resting HR from
-- Apple Health; when that lands, the daily value wins and this column becomes
-- the fallback for days the bridge didn't report.
alter table public.profile
  add column if not exists max_hr      integer,  -- observed, not 220-age
  add column if not exists resting_hr  integer;  -- until the health bridge supplies it daily
