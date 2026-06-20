-- 014_realtime.sql
-- Enable Supabase Realtime (postgres_changes) for the tables the app subscribes
-- to, so server-side changes — most importantly a new run arriving via the
-- Strava webhook — push into the open UI without a manual reload.
--
-- Realtime still honours the existing "own rows" RLS policies, so each client
-- only receives changes to its own rows. Adding a table that's already a member
-- of the publication errors, so each ADD is guarded to stay idempotent.

do $$
declare
  t text;
begin
  foreach t in array array[
    'activities',
    'run_logs',
    'session_completions',
    'activity_streams'
  ]
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
