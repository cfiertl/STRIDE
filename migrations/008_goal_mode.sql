-- NNN_goal_mode.sql
alter table public.profile
  add column goal_mode text not null default 'race';