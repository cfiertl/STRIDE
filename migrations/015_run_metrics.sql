-- 015_run_metrics.sql
-- Derived per-run numbers computed once from activity_streams, so Insights can
-- read them without pulling multi-megabyte stream blobs into the browser.
--
-- All three are grade-aware. "Flat-equivalent pace" is the pace that would cost
-- the same energy on level ground as what was actually run over the terrain,
-- using the Minetti (2002) cost-of-running curve — see src/utils/metrics/run.ts.
-- A hilly 7:30/km and a flat 6:40/km can be the same effort; these columns are
-- what let the app say so.

alter table public.activities
  -- flat-equivalent pace for the whole run, seconds per km
  add column if not exists gap_pace_s        numeric,
  -- flat-equivalent pace over the first 10 minutes, seconds per km
  add column if not exists warmup_gap_pace_s numeric,
  -- metres climbed in the first 10 minutes
  add column if not exists warmup_climb_m    numeric;

-- Backfill state is implicit: a row with streams but a null gap_pace_s is
-- pending. /api/strava/metrics batches through those; nothing to seed here.
