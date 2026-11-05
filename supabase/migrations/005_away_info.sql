-- Update 5: away mode and the house info board.
-- Run once in the Supabase SQL Editor.

-- Away mode: the person is away until (not including) this day, the day they're back.
alter table public.members add column if not exists away_until date;

-- Reminders: remember which person each phone belongs to, so away people aren't reminded.
alter table public.push_subscriptions
  add column if not exists member_id uuid references public.members on delete set null;

drop function if exists public.save_push_subscription(text, text, text, integer, text);
create or replace function public.save_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_hour integer, p_timezone text, p_member uuid
) returns void
language plpgsql security definer set search_path = '' as $$
declare v_household uuid := public.my_household();
begin
  if v_household is null then raise exception 'Join an apartment first'; end if;
  if p_member is not null and not exists (
    select 1 from public.members where id = p_member and household_id = v_household
  ) then
    raise exception 'Person not found';
  end if;
  insert into public.push_subscriptions (endpoint, user_id, household_id, p256dh, auth, reminder_hour, timezone, member_id)
  values (p_endpoint, auth.uid(), v_household, p_p256dh, p_auth, p_hour, coalesce(nullif(p_timezone, ''), 'UTC'), p_member)
  on conflict (endpoint) do update set
    user_id = excluded.user_id,
    household_id = excluded.household_id,
    p256dh = excluded.p256dh,
    auth = excluded.auth,
    reminder_hour = excluded.reminder_hour,
    timezone = excluded.timezone,
    member_id = excluded.member_id;
end $$;
revoke execute on function public.save_push_subscription(text, text, text, integer, text, uuid) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, integer, text, uuid) to authenticated;

-- House info board: cards like "Wi-Fi" or "Landlord".
create table if not exists public.house_info (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  body text not null default '' check (char_length(body) <= 4000),
  sort double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.house_info enable row level security;
drop policy if exists "household info" on public.house_info;
create policy "household info" on public.house_info
  for all using (household_id = public.my_household()) with check (household_id = public.my_household());

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'house_info') then
    alter publication supabase_realtime add table public.house_info;
  end if;
end $$;
