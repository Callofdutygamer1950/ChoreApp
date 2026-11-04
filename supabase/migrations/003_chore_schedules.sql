-- Update 3: Google Calendar-style repeat schedules for chores.
-- Run once in the Supabase SQL Editor. Safe to run again.

-- The full repeat rule (null = the original "every N days after last done" using interval_days).
alter table public.chores add column if not exists schedule jsonb;

-- The reminder job also needs how many times each chore has been done (for "ends after N times").
create or replace view public.chore_last_done with (security_invoker = true) as
  select chore_id, max(done_on) as last_done, count(*) as times_done
  from public.completions group by chore_id;
