-- 005_activity_streams.sql
-- Raw per-sample time series, one row per activity (the "firehose").

create table public.activity_streams (
  activity_id uuid primary key references public.activities (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  streams     jsonb not null,          -- Strava key_by_type object; {} if none
  fetched_at  timestamptz not null default now()
);

alter table public.activity_streams enable row level security;
-- Written/read server-side via the admin client, like strava_tokens.