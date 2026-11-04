-- Update 2: custom person colors + a 2-minute limit on marking the same chore done.
-- Run once in the Supabase SQL Editor. Safe to run again.

-- Each person can pick their calendar color (null = use the default color).
alter table public.members
  add column if not exists color text
  check (color is null or color ~ '^#[0-9a-fA-F]{6}$');

-- A chore can't be marked done for the same day more than once every 2 minutes.
-- Deleting/undoing the entry removes it, so the chore can be marked again right away.
-- (Logging different days back-to-back from the calendar is still allowed.)
create or replace function public.limit_repeat_completions() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists (
    select 1 from public.completions
    where chore_id = new.chore_id
      and done_on = new.done_on
      and created_at > now() - interval '2 minutes'
  ) then
    raise exception 'This chore was just marked done. Wait 2 minutes, or undo the last one first.';
  end if;
  return new;
end $$;

drop trigger if exists limit_repeat_completions on public.completions;
create trigger limit_repeat_completions
  before insert on public.completions
  for each row execute function public.limit_repeat_completions();
