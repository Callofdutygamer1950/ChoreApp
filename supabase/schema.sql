-- Chores app database. Paste this whole file into the Supabase SQL Editor and click Run (once).
--
-- How access works: each phone signs in as an anonymous Supabase user. A phone can only
-- see or change an apartment after it has joined with that apartment's join code
-- (create_household / join_household below). Row-level security enforces this for every table.

-- ---------- Tables ----------

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  join_code text not null unique,
  created_at timestamptz not null default now()
);

-- Which apartment each phone (anonymous user) belongs to. One apartment per phone.
create table public.household_users (
  user_id uuid primary key references auth.users on delete cascade,
  household_id uuid not null references public.households on delete cascade,
  joined_at timestamptz not null default now()
);

create table public.members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.chores (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  interval_days integer not null check (interval_days between 1 and 365),
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.completions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  chore_id uuid not null references public.chores on delete cascade,
  member_id uuid references public.members on delete set null,
  done_on date not null,
  note text check (note is null or char_length(note) <= 280),
  created_at timestamptz not null default now()
);
create index completions_household_day on public.completions (household_id, done_on);
create index completions_chore_day on public.completions (chore_id, done_on desc);

-- One row per phone that turned reminders on.
create table public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users on delete cascade,
  household_id uuid not null references public.households on delete cascade,
  p256dh text not null,
  auth text not null,
  reminder_hour integer not null default 18 check (reminder_hour between 0 and 23),
  timezone text not null default 'UTC',
  last_sent_on date,
  created_at timestamptz not null default now()
);

-- Last time each chore was done (used by the reminder job).
create view public.chore_last_done with (security_invoker = true) as
  select chore_id, max(done_on) as last_done from public.completions group by chore_id;

-- ---------- Helper ----------

create function public.my_household() returns uuid
language sql stable security definer set search_path = '' as $$
  select household_id from public.household_users where user_id = auth.uid()
$$;

-- ---------- Row-level security ----------

alter table public.households enable row level security;
alter table public.household_users enable row level security;
alter table public.members enable row level security;
alter table public.chores enable row level security;
alter table public.completions enable row level security;
alter table public.push_subscriptions enable row level security;

create policy "read own household" on public.households
  for select using (id = public.my_household());
create policy "rename own household" on public.households
  for update using (id = public.my_household()) with check (id = public.my_household());

create policy "read own link" on public.household_users
  for select using (user_id = auth.uid());

create policy "household members" on public.members
  for all using (household_id = public.my_household())
  with check (household_id = public.my_household());

create policy "household chores" on public.chores
  for all using (household_id = public.my_household())
  with check (household_id = public.my_household());

create policy "read completions" on public.completions
  for select using (household_id = public.my_household());
create policy "delete completions" on public.completions
  for delete using (household_id = public.my_household());
create policy "add completions" on public.completions
  for insert with check (
    household_id = public.my_household()
    and exists (select 1 from public.chores c where c.id = chore_id and c.household_id = completions.household_id)
    and (member_id is null or exists (select 1 from public.members m where m.id = member_id and m.household_id = completions.household_id))
  );
create policy "edit completions" on public.completions
  for update using (household_id = public.my_household())
  with check (
    household_id = public.my_household()
    and exists (select 1 from public.chores c where c.id = chore_id and c.household_id = completions.household_id)
    and (member_id is null or exists (select 1 from public.members m where m.id = member_id and m.household_id = completions.household_id))
  );

create policy "read own push subscriptions" on public.push_subscriptions
  for select using (user_id = auth.uid());
create policy "delete own push subscriptions" on public.push_subscriptions
  for delete using (user_id = auth.uid());

-- ---------- Functions the app calls ----------

create function public.create_household(p_name text) returns public.households
language plpgsql security definer set search_path = '' as $$
declare
  h public.households;
  v_code text;
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; -- no 0/O/1/I/L
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.households where join_code = v_code);
  end loop;

  insert into public.households (name, join_code) values (trim(p_name), v_code) returning * into h;
  delete from public.push_subscriptions where user_id = auth.uid();
  insert into public.household_users (user_id, household_id) values (auth.uid(), h.id)
    on conflict (user_id) do update set household_id = excluded.household_id, joined_at = now();
  return h;
end $$;

create function public.join_household(p_code text) returns public.households
language plpgsql security definer set search_path = '' as $$
declare h public.households;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into h from public.households where join_code = upper(replace(trim(p_code), ' ', ''));
  if not found then raise exception 'No apartment uses that code. Check it and try again.'; end if;

  delete from public.push_subscriptions where user_id = auth.uid() and household_id <> h.id;
  insert into public.household_users (user_id, household_id) values (auth.uid(), h.id)
    on conflict (user_id) do update set household_id = excluded.household_id, joined_at = now();
  return h;
end $$;

create function public.leave_household() returns void
language sql security definer set search_path = '' as $$
  delete from public.push_subscriptions where user_id = auth.uid();
  delete from public.household_users where user_id = auth.uid();
$$;

create function public.save_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_hour integer, p_timezone text
) returns void
language plpgsql security definer set search_path = '' as $$
declare v_household uuid := public.my_household();
begin
  if v_household is null then raise exception 'Join an apartment first'; end if;
  insert into public.push_subscriptions (endpoint, user_id, household_id, p256dh, auth, reminder_hour, timezone)
  values (p_endpoint, auth.uid(), v_household, p_p256dh, p_auth, p_hour, coalesce(nullif(p_timezone, ''), 'UTC'))
  on conflict (endpoint) do update set
    user_id = excluded.user_id,
    household_id = excluded.household_id,
    p256dh = excluded.p256dh,
    auth = excluded.auth,
    reminder_hour = excluded.reminder_hour,
    timezone = excluded.timezone;
end $$;

create function public.delete_push_subscription(p_endpoint text) returns void
language sql security definer set search_path = '' as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
$$;

revoke execute on function public.create_household(text), public.join_household(text),
  public.leave_household(), public.save_push_subscription(text, text, text, integer, text),
  public.delete_push_subscription(text) from public, anon;
grant execute on function public.create_household(text), public.join_household(text),
  public.leave_household(), public.save_push_subscription(text, text, text, integer, text),
  public.delete_push_subscription(text) to authenticated;

-- ---------- Live updates between phones ----------

alter publication supabase_realtime add table public.households, public.members, public.chores, public.completions;
