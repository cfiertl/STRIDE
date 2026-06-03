-- 003_strava_tokens.sql
-- Stores each user's Strava OAuth tokens for SERVER-SIDE use only.
-- One row per user (user_id is the PK, = auth.users id), written via upsert.
--
-- RLS is ON with NO policy on purpose: the browser clients (anon + authenticated)
-- cannot read or write this table at all. Only the server-side service-role
-- client (admin.ts) touches it, and the service-role key bypasses RLS. That keeps
-- the refresh token completely off the front end.
--
-- Note: assumes your latest migration is 002_manual_runs.sql; bump the number
-- if you've added others since.
-- Applied: <fill in the date when you run it>

create table strava_tokens (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  athlete_id    bigint,                 -- Strava athlete id (from the token response)
  access_token  text not null,
  refresh_token text not null,
  expires_at    timestamptz not null,   -- when the access token expires (refresh before this)
  scope         text,                   -- granted scope, e.g. 'read,activity:read_all'
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

alter table strava_tokens enable row level security;
-- Intentionally NO policy. Server-only access via the service-role client.