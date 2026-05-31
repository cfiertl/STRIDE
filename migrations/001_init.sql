-- ============================================================
-- Stride — database schema for Supabase (Postgres)
-- Run this once in: Supabase dashboard > SQL Editor > New query > Run.
-- ============================================================

-- NOTE 1: Supabase already gives you an auth.users table when you use
-- its built-in login. So you do NOT create your own "users" table —
-- everything hangs off auth.users(id). Before this is useful, create
-- one account for yourself (Authentication > Add user, or just sign up
-- through the app). Even as a single user, that gives you the user id
-- that every row below references.

-- NOTE 2: RLS (row level security) is at the bottom and matters. With it
-- on, the app's public/anon key can only read YOUR rows. Server-side jobs
-- (the Strava webhook + token refresh) have no logged-in user, so they
-- must use Supabase's SERVICE ROLE key, which bypasses RLS. Use the anon
-- key in the browser, the service role key only on the backend.

-- 1. PROFILE -------------------------------------------------------
create table profile (
  id                uuid primary key references auth.users(id) on delete cascade,
  name              text,
  goal_type         text default 'distance',
  goal_distance_km  numeric,
  goal_time         text,
  race_date         date,
  current_weekly_km numeric,
  days_per_week     int,
  bench_dist_km     numeric,
  bench_time_s      int,
  easy_pace_s       int,
  created_at        timestamptz default now()
);

-- 2. STRAVA TOKENS -------------------------------------------------
create table strava_tokens (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  athlete_id    bigint,
  access_token  text not null,
  refresh_token text not null,
  expires_at    timestamptz not null,   -- refresh before this; tokens last ~6h
  updated_at    timestamptz default now()
);

-- 3. ACTIVITIES — objective data synced from Strava ---------------
create table activities (
  id            bigint primary key,      -- the Strava activity id
  user_id       uuid not null references auth.users(id) on delete cascade,
  date          timestamptz,
  type          text,
  distance_km   numeric,
  moving_time_s int,
  avg_pace_s    numeric,                 -- seconds per km
  avg_hr        int,
  max_hr        int,
  elevation_m   numeric,
  splits        jsonb,                   -- per-km pace/HR, for warm-up + easy-run checks
  source        text default 'strava',   -- 'strava' or 'manual'
  created_at    timestamptz default now()
);
create index activities_user_date on activities (user_id, date desc);

-- 4. RUN LOGS — your subjective layer on top of an activity -------
create table run_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  activity_id bigint references activities(id) on delete cascade, -- null = manual-only run
  date        date not null,
  run_type    text,
  score       int check (score between 1 and 10),
  warmup      boolean default false,
  wrong       text[],                    -- e.g. {'Started too fast','Poor sleep'}
  pain        text[],                    -- e.g. {'Knee (outside / ITB)'}
  notes       text,
  created_at  timestamptz default now()
);
create index run_logs_user_date on run_logs (user_id, date desc);

-- 5. FUEL LOGS -----------------------------------------------------
create table fuel_logs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  date       date not null,
  breakfast  text,
  lunch      text,
  dinner     text,
  snacks     text,
  water      text,
  created_at timestamptz default now()
);

-- 6. CROSS TRAINING ------------------------------------------------
create table cross_training (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  date       date not null,
  activity   text,
  minutes    int,
  intensity  text,
  created_at timestamptz default now()
);

-- 7. PLAN WEEKS ----------------------------------------------------
create table plan_weeks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  week_number int,
  label       text,
  volume_km   numeric,
  sessions    jsonb,
  created_at  timestamptz default now()
);
create index plan_weeks_user on plan_weeks (user_id, week_number);

-- ============================================================
-- RLS — lock every table to its owner.
-- ============================================================
alter table profile        enable row level security;
alter table strava_tokens  enable row level security;
alter table activities     enable row level security;
alter table run_logs       enable row level security;
alter table fuel_logs      enable row level security;
alter table cross_training enable row level security;
alter table plan_weeks     enable row level security;

create policy "own rows" on profile        for all using (auth.uid() = id)      with check (auth.uid() = id);
create policy "own rows" on strava_tokens  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows" on activities     for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows" on run_logs       for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows" on fuel_logs      for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows" on cross_training for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows" on plan_weeks     for all using (auth.uid() = user_id) with check (auth.uid() = user_id);