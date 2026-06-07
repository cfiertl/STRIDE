-- 009_session_completions.sql
-- Links an activity to the planned session it fulfilled.
-- Stores ONLY the linkage (which plan slot) — week + day — not the run type.
-- The type lives in run_logs.run_type, set at link time via saveRunLog, so a run's
-- classification is frozen even if generatePlan later produces a different plan.
-- The plan is derived (no stored session IDs), so a slot is identified positionally:
-- planned_week (same numbering as currentWeek/weeksBetween against the goal date)
-- + planned_day ('Mon'..'Sun').
--
-- Client-readable (RLS "own rows"), like run_logs/fuel_logs/cross_training —
-- not server-only like strava_tokens.

create table public.session_completions (
  activity_id  uuid primary key references public.activities (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  planned_week int  not null,
  planned_day  text not null,           -- 'Mon'..'Sun'
  created_at   timestamptz not null default now()
);
create index session_completions_user on public.session_completions (user_id);

alter table public.session_completions enable row level security;
create policy "own rows" on public.session_completions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);