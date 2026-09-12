-- 017_hr_seconds.sql
-- Seconds spent at each heart rate, per run — so intensity distribution can be
-- read without pulling stream blobs into the browser. Same bargain as 015.
--
-- A histogram rather than precomputed zone totals, deliberately. Totals would
-- be computed against whatever LT1/LT2 were true on the day they ran, and would
-- silently go stale the next time either threshold moved — and thresholds are
-- supposed to move, that's what training does. A per-bpm histogram is
-- threshold-independent: bands are applied at read time, and a re-test
-- re-buckets the whole history for free instead of invalidating it.
--
-- Shape: { "<bpm>": <seconds>, ... }, sparse — only rates actually recorded.
-- Around 80 keys and a few hundred bytes per run, against multi-megabyte
-- streams.
--
-- Backfill state is implicit, as with 015: a run with streams but a null
-- hr_seconds is pending, and /api/strava/metrics batches through those.
alter table public.activities
  add column if not exists hr_seconds jsonb;
