-- 012_spotify_plays.sql
create table spotify_plays (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  activity_id   uuid not null references activities(id) on delete cascade,
  track_id      text,
  track_name    text not null,
  artists       text[] default '{}',
  album_art_url text,            -- un-backfillable: capture now or lose it
  duration_ms   integer,         -- needed later to derive play-start for scrub mapping
  played_at     timestamptz not null,
  track_uri     text,            -- spotify:track:... for deep links later
  created_at    timestamptz default now(),
  unique (activity_id, played_at)   -- dedupes re-captures; supports upsert
);
create index spotify_plays_activity on spotify_plays (activity_id, played_at);

alter table spotify_plays enable row level security;
create policy "own rows" on spotify_plays
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);