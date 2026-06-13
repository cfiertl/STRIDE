-- 013_plan_schedule.sql
-- Start-date-anchored, day-scheduled, editable training plans.
--
-- The plan was previously derived purely from profile and anchored backward
-- from the race date, with sessions carrying only a weekday label. These four
-- additive columns let a plan start on a real date, schedule sessions on the
-- user's preferred weekdays (one marked as the long run), and persist per-session
-- reschedules/skips.
--
-- All columns are additive + nullable (overrides defaults to '{}'), so existing
-- rows keep working until they're re-saved from Setup. Client-readable under the
-- existing profile "own rows" RLS policy — no new policy needed.
--
-- schedule_overrides maps "<week>:<origDay>" -> value, where value is either an
-- ISO date string (the session was moved to that day) or the string 'skipped'.

alter table public.profile
  add column plan_start_date    date,
  add column preferred_days     text[],
  add column long_day           text,
  add column schedule_overrides jsonb not null default '{}'::jsonb;
