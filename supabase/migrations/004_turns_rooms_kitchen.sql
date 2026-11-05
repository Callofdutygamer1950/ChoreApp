-- Update 4: whose turn, admin PIN, snooze, rooms, shopping list, recipes.
-- Run once in the Supabase SQL Editor.

create extension if not exists pgcrypto with schema extensions;

-- ---------- Rooms ----------
create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  created_at timestamptz not null default now()
);
alter table public.rooms enable row level security;
drop policy if exists "household rooms" on public.rooms;
create policy "household rooms" on public.rooms
  for all using (household_id = public.my_household()) with check (household_id = public.my_household());

-- ---------- Chore additions ----------
alter table public.chores add column if not exists room_id uuid references public.rooms on delete set null;
-- Ordered member ids who take turns. Empty = no rotation.
alter table public.chores add column if not exists rotation uuid[] not null default '{}';
-- Snooze: the chore isn't due before snoozed_until, unless it's done after snoozed_at.
alter table public.chores add column if not exists snoozed_until date;
alter table public.chores add column if not exists snoozed_at timestamptz;

-- Reminder job: also needs when the latest entry was recorded (to tell if a snooze still applies).
create or replace view public.chore_last_done with (security_invoker = true) as
  select chore_id, max(done_on) as last_done, count(*) as times_done, max(created_at) as last_created_at
  from public.completions group by chore_id;

-- ---------- Turn count adjustments (admin only) ----------
-- Whose turn uses: completions of the chore by that person + extra.
create table if not exists public.turn_adjustments (
  chore_id uuid not null references public.chores on delete cascade,
  member_id uuid not null references public.members on delete cascade,
  household_id uuid not null references public.households on delete cascade,
  extra integer not null default 0,
  primary key (chore_id, member_id)
);
alter table public.turn_adjustments enable row level security;
drop policy if exists "read turn adjustments" on public.turn_adjustments;
create policy "read turn adjustments" on public.turn_adjustments
  for select using (household_id = public.my_household());
-- No insert/update/delete policies: changes only go through set_turn_count, which checks the PIN.

-- ---------- Admin PIN (kept in a table nobody can read directly) ----------
create table if not exists public.household_secrets (
  household_id uuid primary key references public.households on delete cascade,
  admin_pin_hash text,
  failed_attempts integer not null default 0,
  locked_until timestamptz
);
alter table public.household_secrets enable row level security;
-- No policies at all: only the security-definer functions below can touch it.

create or replace function public.has_admin_pin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.household_secrets
    where household_id = public.my_household() and admin_pin_hash is not null
  )
$$;

-- Internal: checks the PIN, with a 5-minute lockout after 5 wrong tries.
-- Returns null when the PIN is right, otherwise an error message. It never raises, because
-- raising would roll back the failed-attempt counter.
create or replace function public._verify_admin_pin(p_pin text) returns text
language plpgsql security definer set search_path = '' as $$
declare s public.household_secrets;
begin
  select * into s from public.household_secrets where household_id = public.my_household() for update;
  if s.household_id is null or s.admin_pin_hash is null then return 'No admin PIN has been set yet.'; end if;
  if s.locked_until is not null and s.locked_until > now() then
    return 'Too many wrong tries. Try again in a few minutes.';
  end if;
  if extensions.crypt(coalesce(p_pin, ''), s.admin_pin_hash) <> s.admin_pin_hash then
    update public.household_secrets
      set failed_attempts = failed_attempts + 1,
          locked_until = case when failed_attempts + 1 >= 5 then now() + interval '5 minutes' else null end
      where household_id = s.household_id;
    return 'Wrong PIN.';
  end if;
  update public.household_secrets set failed_attempts = 0, locked_until = null where household_id = s.household_id;
  return null;
end $$;

-- The functions below return null on success, or an error message to show.

-- Sets the PIN. If one is already set, the current PIN is required.
create or replace function public.set_admin_pin(p_current text, p_new text) returns text
language plpgsql security definer set search_path = '' as $$
declare v_household uuid := public.my_household(); v_err text;
begin
  if v_household is null then return 'Join an apartment first.'; end if;
  if p_new !~ '^[0-9]{4}$' then return 'The PIN must be 4 digits.'; end if;
  if public.has_admin_pin() then
    v_err := public._verify_admin_pin(p_current);
    if v_err is not null then return v_err; end if;
  end if;
  insert into public.household_secrets (household_id, admin_pin_hash)
    values (v_household, extensions.crypt(p_new, extensions.gen_salt('bf')))
    on conflict (household_id) do update
      set admin_pin_hash = excluded.admin_pin_hash, failed_attempts = 0, locked_until = null;
  return null;
end $$;

create or replace function public.check_admin_pin(p_pin text) returns text
language plpgsql security definer set search_path = '' as $$
begin
  return public._verify_admin_pin(p_pin);
end $$;

-- Admin: make a person's turn count for a chore equal p_count.
create or replace function public.set_turn_count(p_pin text, p_chore uuid, p_member uuid, p_count integer) returns text
language plpgsql security definer set search_path = '' as $$
declare v_household uuid := public.my_household(); v_actual integer; v_err text;
begin
  v_err := public._verify_admin_pin(p_pin);
  if v_err is not null then return v_err; end if;
  if p_count is null or p_count < 0 or p_count > 100000 then return 'Enter a count of 0 or more.'; end if;
  if not exists (select 1 from public.chores where id = p_chore and household_id = v_household)
     or not exists (select 1 from public.members where id = p_member and household_id = v_household) then
    return 'Chore or person not found.';
  end if;
  select count(*) into v_actual from public.completions where chore_id = p_chore and member_id = p_member;
  insert into public.turn_adjustments (chore_id, member_id, household_id, extra)
    values (p_chore, p_member, v_household, p_count - v_actual)
    on conflict (chore_id, member_id) do update set extra = excluded.extra;
  return null;
end $$;

revoke execute on function public._verify_admin_pin(text) from public, anon, authenticated;
revoke execute on function public.has_admin_pin(), public.set_admin_pin(text, text),
  public.check_admin_pin(text), public.set_turn_count(text, uuid, uuid, integer) from public, anon;
grant execute on function public.has_admin_pin(), public.set_admin_pin(text, text),
  public.check_admin_pin(text), public.set_turn_count(text, uuid, uuid, integer) to authenticated;

-- ---------- Shopping list ----------
create table if not exists public.shopping_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  done boolean not null default false,
  added_by uuid references public.members on delete set null,
  created_at timestamptz not null default now(),
  done_at timestamptz
);
alter table public.shopping_items enable row level security;
drop policy if exists "household shopping" on public.shopping_items;
create policy "household shopping" on public.shopping_items
  for all using (household_id = public.my_household()) with check (household_id = public.my_household());

-- ---------- Recipes ----------
create table if not exists public.recipes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  servings text check (servings is null or char_length(servings) <= 40),
  ingredients text[] not null default '{}',
  steps text check (steps is null or char_length(steps) <= 20000),
  notes text check (notes is null or char_length(notes) <= 5000),
  source_url text check (source_url is null or char_length(source_url) <= 2000),
  added_by uuid references public.members on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.recipes enable row level security;
drop policy if exists "household recipes" on public.recipes;
create policy "household recipes" on public.recipes
  for all using (household_id = public.my_household()) with check (household_id = public.my_household());

-- ---------- Live updates ----------
do $$
declare t text;
begin
  foreach t in array array['rooms', 'turn_adjustments', 'shopping_items', 'recipes'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
