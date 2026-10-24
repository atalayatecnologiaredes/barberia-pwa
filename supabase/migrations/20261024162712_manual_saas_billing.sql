begin;

create table if not exists public.saas_settings (
  singleton boolean primary key default true check (singleton),
  trial_days integer not null default 14 check (trial_days between 1 and 90),
  grace_days integer not null default 3 check (grace_days between 0 and 30),
  billing_period_months integer not null default 1 check (billing_period_months between 1 and 12),
  monthly_price numeric(10,2) not null default 15 check (monthly_price >= 0),
  whatsapp_number text not null default '593989253675',
  telegram_url text,
  exports_enabled_during_trial boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

insert into public.saas_settings(singleton) values (true)
on conflict (singleton) do nothing;

create table if not exists public.subscription_payment_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  amount numeric(10,2) not null check (amount >= 0),
  payment_method text not null check (payment_method in ('transfer','cash','complimentary')),
  reference text,
  notes text,
  period_starts_at timestamptz not null,
  period_ends_at timestamptz not null,
  recorded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check (period_ends_at > period_starts_at)
);

create index if not exists subscription_payment_records_tenant_created_idx
  on public.subscription_payment_records(tenant_id, created_at desc);

alter table public.saas_settings enable row level security;
alter table public.subscription_payment_records enable row level security;

drop policy if exists "signed in users read SaaS contact settings" on public.saas_settings;
create policy "signed in users read SaaS contact settings" on public.saas_settings
  for select to authenticated using (true);
drop policy if exists "SaaS admins update settings" on public.saas_settings;
create policy "SaaS admins update settings" on public.saas_settings
  for update to authenticated using (private.is_saas_admin()) with check (private.is_saas_admin());
drop policy if exists "SaaS admins read payment records" on public.subscription_payment_records;
create policy "SaaS admins read payment records" on public.subscription_payment_records
  for select to authenticated using (private.is_saas_admin());

revoke all on public.saas_settings, public.subscription_payment_records from anon, authenticated;
grant select on public.saas_settings to authenticated;
grant update (trial_days, grace_days, billing_period_months, monthly_price, whatsapp_number,
  telegram_url, exports_enabled_during_trial, updated_at, updated_by) on public.saas_settings to authenticated;
grant select on public.subscription_payment_records to authenticated;

create or replace function public.admin_record_subscription_payment(
  p_tenant_id uuid,
  p_payment_method text,
  p_reference text default null,
  p_notes text default null,
  p_complimentary boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_settings public.saas_settings%rowtype;
  v_subscription public.saas_subscriptions%rowtype;
  v_start timestamptz;
  v_end timestamptz;
  v_record_id uuid;
  v_method text;
begin
  if v_actor is null or not private.is_saas_admin() then
    raise exception 'SaaS administrator access required' using errcode = '42501';
  end if;
  if p_payment_method not in ('transfer','cash') and not (p_complimentary and p_payment_method = 'complimentary') then
    raise exception 'Unsupported payment method' using errcode = '22023';
  end if;
  select * into strict v_settings from public.saas_settings where singleton for share;
  select * into strict v_subscription from public.saas_subscriptions where tenant_id = p_tenant_id for update;
  if not exists (select 1 from public.tenants where id = p_tenant_id) then
    raise exception 'Barbería no encontrada' using errcode = 'P0002';
  end if;

  v_start := case
    when v_subscription.current_period_end > now() then v_subscription.current_period_end
    when v_subscription.current_period_end + make_interval(days => v_settings.grace_days) > now() then v_subscription.current_period_end
    else now()
  end;
  v_end := v_start + make_interval(months => v_settings.billing_period_months);
  v_method := case when p_complimentary then 'complimentary' else p_payment_method end;

  update public.saas_subscriptions
  set status = 'active', current_period_start = v_start, current_period_end = v_end,
      price_monthly = case when p_complimentary then 0 else v_settings.monthly_price end,
      updated_at = now()
  where tenant_id = p_tenant_id;
  update public.tenants set active = true, updated_at = now() where id = p_tenant_id;

  insert into public.subscription_payment_records(
    tenant_id, amount, payment_method, reference, notes, period_starts_at, period_ends_at, recorded_by
  ) values (
    p_tenant_id, case when p_complimentary then 0 else v_settings.monthly_price * v_settings.billing_period_months end,
    v_method, nullif(trim(p_reference), ''), nullif(trim(p_notes), ''), v_start, v_end, v_actor
  ) returning id into v_record_id;
  return v_record_id;
end;
$$;

revoke all on function public.admin_record_subscription_payment(uuid,text,text,text,boolean) from public, anon;
grant execute on function public.admin_record_subscription_payment(uuid,text,text,text,boolean) to authenticated;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_price numeric(10,2);
  v_trial_days integer;
  v_plan public.saas_plan_tier;
  v_plan_label text;
  v_plan_code text := 'basic';
  v_tenant_name text;
  v_owner_name text;
  v_slug text;
  v_assigned_role public.app_role := 'CLIENT';
  v_client_id text := 'client_' || substr(replace(new.id::text, '-', ''), 1, 8);
  v_client_email text;
begin
  v_owner_name := coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1));
  v_tenant_name := coalesce(nullif(trim(new.raw_user_meta_data ->> 'tenant_name'), ''),
    case when new.raw_user_meta_data ->> 'signup_type' = 'shop_owner' then 'Mi barbería' end);

  if v_tenant_name is not null then
    if length(v_tenant_name) not between 2 and 120 then raise exception 'Nombre de barbería no válido'; end if;
    select e.enumlabel into v_plan_label
    from pg_type t join pg_namespace n on n.oid = t.typnamespace join pg_enum e on e.enumtypid = t.oid
    where n.nspname = 'public' and t.typname = 'saas_plan_tier' and lower(e.enumlabel) = v_plan_code limit 1;
    if v_plan_label is null then raise exception 'El enum saas_plan_tier no contiene el plan básico'; end if;
    v_plan := v_plan_label::public.saas_plan_tier;
    select monthly_price into strict v_price from public.saas_settings where singleton;
    select trial_days into strict v_trial_days from public.saas_settings where singleton;

    v_slug := trim(both '-' from regexp_replace(lower(v_tenant_name), '[^a-z0-9]+', '-', 'g'));
    if v_slug = '' then v_slug := 'barberia'; end if;
    v_slug := left(v_slug, 70) || '-' || substr(replace(new.id::text, '-', ''), 1, 8);
    insert into public.tenants(name, email, slug) values (v_tenant_name, new.email, v_slug) returning id into v_tenant_id;
    insert into public.saas_subscriptions(tenant_id, plan, status, max_barbers, price_monthly, current_period_start, current_period_end)
    values (v_tenant_id, v_plan, 'trialing', 5, v_price, now(), now() + make_interval(days => v_trial_days));

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
    v_client_email := case when new.raw_user_meta_data ->> 'signup_type' = 'staff_invitation' then null else new.email end;
    insert into public.clients(id, full_name, phone, email)
      values (v_client_id, v_owner_name, coalesce(new.raw_user_meta_data ->> 'phone', ''), v_client_email)
      on conflict (id) do nothing;
  end if;

  insert into public.profiles(id, role, full_name, email, phone, client_id, tenant_id)
  values (new.id, v_assigned_role, v_owner_name, new.email, new.raw_user_meta_data ->> 'phone',
    case when v_tenant_id is null then v_client_id else null end, v_tenant_id);
  return new;
end;
$$;

commit;
