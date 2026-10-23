begin;

create table if not exists public.loyalty_rewards (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (length(trim(name)) between 2 and 100),
  description text not null default '',
  points_cost integer not null check (points_cost > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, tenant_id)
);

create index if not exists loyalty_rewards_active_idx
  on public.loyalty_rewards (tenant_id, name) where active;

create table if not exists public.loyalty_redemptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  client_id text not null references public.clients(id) on delete restrict,
  reward_id uuid not null,
  payment_id uuid references public.payments(id) on delete set null,
  points integer not null check (points > 0),
  redeemed_by uuid references auth.users(id) on delete set null,
  redeemed_at timestamptz not null default now(),
  constraint loyalty_redemptions_reward_tenant_fk
    foreign key (reward_id, tenant_id) references public.loyalty_rewards(id, tenant_id) on delete restrict
);

create index if not exists loyalty_redemptions_client_idx
  on public.loyalty_redemptions (tenant_id, client_id, redeemed_at desc);

alter table public.loyalty_rewards enable row level security;
alter table public.loyalty_redemptions enable row level security;
revoke all on public.loyalty_rewards, public.loyalty_redemptions from anon, authenticated;
grant select, insert, update, delete on public.loyalty_rewards to authenticated;
grant select on public.loyalty_redemptions to authenticated;

drop policy if exists "loyalty rewards owner management" on public.loyalty_rewards;
create policy "loyalty rewards owner management" on public.loyalty_rewards
  for all to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.active and p.role = 'SUPER_ADMIN'
      and p.tenant_id = loyalty_rewards.tenant_id
  ))
  with check (exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.active and p.role = 'SUPER_ADMIN'
      and p.tenant_id = loyalty_rewards.tenant_id
  ));

drop policy if exists "loyalty rewards staff read" on public.loyalty_rewards;
create policy "loyalty rewards staff read" on public.loyalty_rewards
  for select to authenticated
  using (active and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.active
      and p.role in ('SUPER_ADMIN', 'RECEPCION')
      and p.tenant_id = loyalty_rewards.tenant_id
  ));

drop policy if exists "loyalty redemptions staff read" on public.loyalty_redemptions;
create policy "loyalty redemptions staff read" on public.loyalty_redemptions
  for select to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.active
      and p.role in ('SUPER_ADMIN', 'RECEPCION')
      and p.tenant_id = loyalty_redemptions.tenant_id
  ));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'clients'
    ) then alter publication supabase_realtime add table public.clients; end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'loyalty_ledger'
    ) then alter publication supabase_realtime add table public.loyalty_ledger; end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'loyalty_rewards'
    ) then alter publication supabase_realtime add table public.loyalty_rewards; end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'loyalty_redemptions'
    ) then alter publication supabase_realtime add table public.loyalty_redemptions; end if;
  end if;
end;
$$;

commit;
