-- 004_activity_detail.sql
-- Columns populated by the per-activity detail enrichment pass.

alter table public.activities
  add column if not exists laps            jsonb,
  add column if not exists best_efforts    jsonb,
  add column if not exists calories        numeric,
  add column if not exists avg_cadence     numeric,
  add column if not exists relative_effort integer,   -- Strava "suffer_score"
  add column if not exists gear_name       text,
  add column if not exists device_name     text,
  add column if not exists description     text;