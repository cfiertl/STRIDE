-- 007_hr_zones.sql
-- Two-threshold model: LT1 (aerobic / talk-test) and LT2 (LTHR, from a 30-min test).
alter table public.profile
  add column if not exists lt1_hr               integer,  -- aerobic threshold (talk test)
  add column if not exists lt2_hr               integer,  -- lactate threshold (computed from a test activity)
  add column if not exists lt2_source_activity  uuid,     -- which activity LT2 was computed from
  add column if not exists hr_tested_at         date;     -- when the test was linked