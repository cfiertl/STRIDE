-- Safe because both tables are currently empty.
drop table if exists run_logs  cascade;
drop table if exists activities cascade;

create table activities (
  id            uuid primary key default gen_random_uuid(),  -- surrogate PK (works for manual too)
  strava_id     bigint unique,                               -- the Strava id; null for manual runs
  user_id       uuid not null references auth.users(id) on delete cascade,
  date          timestamptz,
  type          text,
  distance_km   numeric,
  moving_time_s int,
  avg_pace_s    numeric,
  avg_hr        int,
  max_hr        int,
  elevation_m   numeric,
  splits        jsonb,
  source        text default 'strava',   -- 'strava' | 'manual'
  created_at    timestamptz default now()
);
create index activities_user_date on activities (user_id, date desc);

create table run_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  activity_id uuid references activities(id) on delete cascade,  -- now uuid, was bigint
  date        date not null,
  run_type    text,
  score       int check (score between 1 and 10),
  warmup      boolean default false,
  wrong       text[],
  pain        text[],
  notes       text,
  created_at  timestamptz default now()
);
create index run_logs_user_date on run_logs (user_id, date desc);

-- dropped tables lose RLS, so re-apply it
alter table activities enable row level security;
alter table run_logs   enable row level security;
create policy "own rows" on activities for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows" on run_logs   for all using (auth.uid() = user_id) with check (auth.uid() = user_id);