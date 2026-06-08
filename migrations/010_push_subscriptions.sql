-- 010_push_subscriptions.sql
-- Web Push subscriptions, one row per browser push endpoint.
--
-- endpoint is the PK: a given browser yields one stable endpoint, so re-enabling
-- on the same device upserts the same row (idempotent, same trick as
-- session_completions using its natural key). Re-subscribing after the browser
-- rotates the endpoint just inserts a fresh row; stale ones get pruned when a
-- send returns 404/410 (see /api/push/test and later the webhook/cron senders).
--
-- RLS: the authenticated browser manages ONLY its own rows. The server-side
-- senders read via the service-role client (admin.ts), which bypasses RLS.
--
-- Bump this number if your applied sequence is past 010.
-- Applied: <fill in when you run it>

create table push_subscriptions (
  endpoint    text primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz default now()
);

create index push_subscriptions_user_id_idx on push_subscriptions (user_id);

alter table push_subscriptions enable row level security;

create policy "own push subs - select"
  on push_subscriptions for select
  using (auth.uid() = user_id);

create policy "own push subs - insert"
  on push_subscriptions for insert
  with check (auth.uid() = user_id);

-- upsert(onConflict: endpoint) takes the UPDATE path when the row already exists.
create policy "own push subs - update"
  on push_subscriptions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "own push subs - delete"
  on push_subscriptions for delete
  using (auth.uid() = user_id);