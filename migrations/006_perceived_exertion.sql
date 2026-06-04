-- 006_perceived_exertion.sql
-- Effort score (1-10): from Strava's perceived_exertion when present,
-- otherwise entered manually in Stride. effort_source tells them apart.
alter table public.activities
  add column if not exists perceived_exertion numeric,  -- 1–10
  add column if not exists effort_source      text;     -- 'strava' | 'manual' | null