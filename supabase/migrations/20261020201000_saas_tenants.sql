-- Multi tenant SaaS setup for databases created from supabase/schema.sql.
-- New installs apply this as migration 20261020201000_saas_tenants.sql.
-- Existing databases: use the explicit compatibility repair migration, never
-- replay the base bootstrap against production.
-- New shop-owner registrations pass signup_type=shop_owner. The trigger creates
-- a default tenant and assigns the Basic plan; owners personalize it later.
begin;

do $$
begin
  if to_regclass('public.profiles') is null
    or to_regclass('public.clients') is null
    or to_regclass('public.queue_visits') is null then
    raise exception 'Base schema is missing. Apply schema.sql once before saas_tenants_migration.sql.';
  end if;
end;
$$;

do $$ begin
  create type public.tenant_status as enum ('trialing', 'active', 'past_due', 'suspended', 'cancelled');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.saas_plan_tier as enum ('basic', 'pro');
exception when duplicate_object then null;
end $$;

do $$
declare
  v_labels text[];
begin
  select array_agg(e.enumlabel order by e.enumsortorder)
    into v_labels
  from pg_type t
  join pg_namespace n on n.oid = t.typnamespace
  join pg_enum e on e.enumtypid = t.oid
  where n.nspname = 'public' and t.typname = 'saas_plan_tier';

  if not (v_labels @> array['basic', 'pro']::text[]) then
    raise exception 'public.saas_plan_tier must include the subscription plan codes basic and pro (found: %)', v_labels;
  end if;
end;
$$;

alter table public.profiles add column if not exists tenant_id uuid;

create table if not exists public.saas_admins (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 120),
  email text not null,
  slug text unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Older deployments already had an owner email on tenants; add it for databases
-- created from the earlier repository schema and backfill from the owner profile.
alter table public.tenants add column if not exists email text;
alter table public.tenants alter column email drop not null;
update public.tenants t
set email = p.email
from public.profiles p
where p.tenant_id = t.id and t.email is null and p.email is not null;
do $$ begin
  if not exists (select 1 from public.tenants where email is null) then
    alter table public.tenants alter column email set not null;
  end if;
end $$;
alter table public.tenants add column if not exists slug text;
alter table public.tenants add column if not exists active boolean not null default true;
alter table public.tenants add column if not exists updated_at timestamptz not null default now();
update public.tenants set slug = 'barberia-' || substr(replace(id::text, '-', ''), 1, 8) where slug is null;
alter table public.tenants alter column slug set not null;
create unique index if not exists tenants_slug_key on public.tenants(slug);

create table if not exists public.subscription_plans (
  code text primary key,
  name text not null,
  monthly_price numeric(10,2) not null check (monthly_price >= 0),
  capabilities text[] not null default '{}',
  active boolean not null default true
);

create table if not exists public.saas_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references public.tenants(id) on delete cascade,
  -- Keep the plan as a native enum in schemas that already use saas_plan_tier.
  -- The signup handler casts the validated plan code at insert time.
  plan public.saas_plan_tier not null,
  status public.tenant_status not null default 'trialing',
  max_barbers integer not null default 5 check (max_barbers > 0),
  price_monthly numeric(10,2) not null check (price_monthly >= 0),
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  alter table public.profiles add constraint profiles_tenant_id_fkey
    foreign key (tenant_id) references public.tenants(id) on delete set null;
exception when duplicate_object then null;
end $$;
create index if not exists profiles_tenant_id_idx on public.profiles(tenant_id);

-- Tenant scope used by the app's operational queries. Keep these columns in the
-- SaaS migration so fresh installs and upgraded projects get the same schema.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'clients', 'barbers', 'services', 'inventory_items',
    'appointments', 'queue_visits', 'service_orders'
  ] loop
    execute format(
      'alter table public.%I add column if not exists tenant_id uuid references public.tenants(id) on delete cascade',
      v_table
    );
    execute format('create index if not exists %I on public.%I(tenant_id)', v_table || '_tenant_id_idx', v_table);
  end loop;
end;
$$;

-- Existing single-shop installations can safely assign their legacy rows to
-- that shop. With multiple tenants, leave unassigned rows untouched for review.
do $$
declare
  v_tenant_id uuid;
begin
  if (select count(*) from public.tenants) = 1 then
    select id into v_tenant_id from public.tenants limit 1;
    update public.clients set tenant_id = v_tenant_id where tenant_id is null;
    update public.barbers set tenant_id = v_tenant_id where tenant_id is null;
    update public.services set tenant_id = v_tenant_id where tenant_id is null;
    update public.inventory_items set tenant_id = v_tenant_id where tenant_id is null;
    update public.appointments set tenant_id = v_tenant_id where tenant_id is null;
    update public.queue_visits set tenant_id = v_tenant_id where tenant_id is null;
    update public.service_orders set tenant_id = v_tenant_id where tenant_id is null;
  end if;
end;
$$;

insert into public.subscription_plans(code, name, monthly_price, capabilities) values
  ('basic', 'Básico', 19.00, array['reception','chair','checkout','inventory','client_pwa','crm','appointments','catalog']),
  ('pro', 'Pro', 39.00, array['reception','chair','checkout','inventory','client_pwa','crm','appointments','catalog','staff','analytics'])
on conflict (code) do nothing;

create or replace function private.is_saas_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.saas_admins a where a.profile_id = (select auth.uid()));
$$;

-- The Auth trigger runs for both ordinary client signups and shop owners.
-- Only validated tenant metadata creates a tenant and a 14 day trial.
create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_tenant_id uuid;
  v_price numeric(10,2);
  v_plan public.saas_plan_tier := 'basic';
  v_tenant_name text;
  v_owner_name text;
  v_slug text;
  v_assigned_role public.app_role := 'CLIENT';
  v_client_id text := 'client_' || substr(replace(new.id::text, '-', ''), 1, 8);
begin
  v_owner_name := coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1));
  v_tenant_name := nullif(trim(new.raw_user_meta_data ->> 'tenant_name'), '');
  if v_tenant_name is not null or new.raw_user_meta_data ->> 'signup_type' = 'shop_owner' then
    v_tenant_name := coalesce(v_tenant_name, 'Mi barbería');
    if length(v_tenant_name) not between 2 and 120 then raise exception 'Nombre de barbería no válido'; end if;
    v_plan := 'basic';
    select sp.monthly_price into v_price from public.subscription_plans sp where sp.code = v_plan::text and sp.active;
    if v_price is null then raise exception 'Plan de suscripción no disponible'; end if;

    v_slug := trim(both '-' from regexp_replace(lower(v_tenant_name), '[^a-z0-9]+', '-', 'g'));
    if v_slug = '' then v_slug := 'barberia'; end if;
    v_slug := left(v_slug, 70) || '-' || substr(replace(new.id::text, '-', ''), 1, 8);

    insert into public.tenants(name, email, slug) values (v_tenant_name, new.email, v_slug) returning id into v_tenant_id;
    insert into public.saas_subscriptions(tenant_id, plan, status, max_barbers, price_monthly, current_period_end)
      values (v_tenant_id, v_plan, 'trialing', case when v_plan = 'pro' then 15 else 5 end, v_price, now() + interval '14 days');
    -- The first tenant adopts legacy demo/catalog rows from the single-shop schema.
    if (select count(*) from public.tenants) = 1 then
      update public.clients set tenant_id = v_tenant_id where tenant_id is null;
      update public.barbers set tenant_id = v_tenant_id where tenant_id is null;
      update public.services set tenant_id = v_tenant_id where tenant_id is null;
      update public.inventory_items set tenant_id = v_tenant_id where tenant_id is null;
      update public.appointments set tenant_id = v_tenant_id where tenant_id is null;
      update public.queue_visits set tenant_id = v_tenant_id where tenant_id is null;
      update public.service_orders set tenant_id = v_tenant_id where tenant_id is null;
    end if;
    v_assigned_role := 'SUPER_ADMIN';
  else
    insert into public.clients(id, full_name, phone, email)
      values (v_client_id, v_owner_name, coalesce(new.raw_user_meta_data ->> 'phone', ''), new.email)
      on conflict (id) do nothing;
  end if;

  insert into public.profiles(id, role, full_name, email, phone, client_id, tenant_id)
    values (new.id, v_assigned_role, v_owner_name, new.email, new.raw_user_meta_data ->> 'phone',
      case when v_tenant_id is null then v_client_id else null end, v_tenant_id);
  return new;
end;
$$;

-- Remove stale signup triggers that point to either historical handler.
do $$
declare
  v_trigger record;
begin
  for v_trigger in
    select t.tgname
    from pg_trigger t
    where t.tgrelid = 'auth.users'::regclass
      and not t.tgisinternal
      and (
        t.tgname = 'on_auth_user_created'
        or t.tgfoid = to_regprocedure('public.handle_new_auth_user()')::oid
        or t.tgfoid = to_regprocedure('public.handle_new_user()')::oid
      )
  loop
    execute format('drop trigger %I on auth.users', v_trigger.tgname);
  end loop;
end;
$$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

alter table public.saas_admins enable row level security;
alter table public.tenants enable row level security;
alter table public.subscription_plans enable row level security;
alter table public.saas_subscriptions enable row level security;

drop policy if exists "saas admins read own grant" on public.saas_admins;
create policy "saas admins read own grant" on public.saas_admins
  for select to authenticated using (profile_id = (select auth.uid()));
drop policy if exists "saas admins manage grants" on public.saas_admins;
create policy "saas admins manage grants" on public.saas_admins for all to authenticated
  using (private.is_saas_admin()) with check (private.is_saas_admin());
drop policy if exists "saas admins manage tenants" on public.tenants;
create policy "saas admins manage tenants" on public.tenants for all to authenticated
  using (private.is_saas_admin()) with check (private.is_saas_admin());
drop policy if exists "authenticated can read active plans" on public.subscription_plans;
create policy "authenticated can read active plans" on public.subscription_plans
  for select to authenticated using (active or private.is_saas_admin());
drop policy if exists "saas admins manage plans" on public.subscription_plans;
create policy "saas admins manage plans" on public.subscription_plans for all to authenticated
  using (private.is_saas_admin()) with check (private.is_saas_admin());
drop policy if exists "saas admins manage subscriptions" on public.saas_subscriptions;
create policy "saas admins manage subscriptions" on public.saas_subscriptions for all to authenticated
  using (private.is_saas_admin()) with check (private.is_saas_admin());
drop policy if exists "tenant owners read own subscription" on public.saas_subscriptions;
create policy "tenant owners read own subscription" on public.saas_subscriptions
  for select to authenticated using (tenant_id = (select p.tenant_id from public.profiles p where p.id = (select auth.uid())));
drop policy if exists "tenant owners read own tenant" on public.tenants;
create policy "tenant owners read own tenant" on public.tenants
  for select to authenticated using (id = (select p.tenant_id from public.profiles p where p.id = (select auth.uid())));

grant select on public.tenants, public.subscription_plans, public.saas_subscriptions, public.saas_admins to authenticated;
grant update (active) on public.tenants to authenticated;
grant update (status, max_barbers, price_monthly, current_period_end) on public.saas_subscriptions to authenticated;
grant execute on function private.is_saas_admin() to authenticated;

commit;
