-- 011_spotify_tokens.sql
create table spotify_tokens (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  access_token  text not null,
  refresh_token text not null,
  expires_at    timestamptz not null,
  scope         text,
  updated_at    timestamptz default now()
);

alter table spotify_tokens enable row level security;
-- intentionally no policies: this table is only ever touched by the
-- service-role admin client in server routes (same as strava_tokens).