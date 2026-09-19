-- Run in the Supabase SQL editor or apply with `supabase db push`.
-- No customer accounts or receipt storage are needed for this version.
create table public.restaurants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (char_length(name) between 1 and 120),
  city text not null default '' check (char_length(city) <= 120),
  status text not null default 'pending' check (status in ('pending', 'active', 'suspended')),
  splitting_enabled boolean not null default false,
  -- A future billing webhook can update this entitlement; null means no expiry.
  split_access_expires_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.restaurants enable row level security;
revoke all on public.restaurants from anon, authenticated;
grant select on public.restaurants to anon, authenticated;
create policy "Public restaurant directory is readable"
  on public.restaurants for select to anon, authenticated using (true);
-- There are deliberately no public insert/update/delete policies. Registration,
-- activation and future paid entitlements are managed by trusted administrators.
-- Keep billing contacts, payment identifiers and other private data in separate
-- RLS-protected tables when restaurant accounts and payments are implemented.

create index restaurants_name_idx on public.restaurants (lower(name));

-- A non-cached database check uses database time to enforce expiring access.
create function public.restaurant_can_split(restaurant_id uuid)
returns boolean
language sql stable security invoker set search_path = ''
as $$
  select exists (
    select 1 from public.restaurants r
    where r.id = restaurant_id
      and r.status = 'active'
      and r.splitting_enabled
      and (r.split_access_expires_at is null or r.split_access_expires_at > now())
  );
$$;
revoke all on function public.restaurant_can_split(uuid) from public;
grant execute on function public.restaurant_can_split(uuid) to anon, authenticated;
