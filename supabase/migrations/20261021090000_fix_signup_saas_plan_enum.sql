-- Align existing SaaS databases with the native plan enum used in production.
-- This migration is safe for the two supported public signup plans (basic/pro).
begin;

do $$ begin
  create type public.saas_plan_tier as enum ('basic', 'pro');
exception when duplicate_object then null;
end $$;

do $$
declare
  v_labels text[];
  v_column_type regtype;
begin
  select array_agg(e.enumlabel order by e.enumsortorder)
    into v_labels
  from pg_type t
  join pg_namespace n on n.oid = t.typnamespace
  join pg_enum e on e.enumtypid = t.oid
  where n.nspname = 'public' and t.typname = 'saas_plan_tier';

  if not (v_labels @> array['basic', 'pro']::text[]) then
    raise exception 'public.saas_plan_tier must include basic and pro (found: %)', v_labels;
  end if;

  select a.atttypid::regtype into v_column_type
  from pg_attribute a
  where a.attrelid = 'public.saas_subscriptions'::regclass
    and a.attname = 'plan'
    and not a.attisdropped;

  if v_column_type is null then
    raise exception 'public.saas_subscriptions.plan does not exist';
  elsif v_column_type <> 'public.saas_plan_tier'::regtype then
    alter table public.saas_subscriptions
      alter column plan type public.saas_plan_tier
      using plan::text::public.saas_plan_tier;
  end if;
end;
$$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
    select sp.monthly_price into v_price
    from public.subscription_plans sp
    where sp.code = v_plan::text and sp.active;
    if v_price is null then raise exception 'Plan de suscripción no disponible'; end if;

    v_slug := trim(both '-' from regexp_replace(lower(v_tenant_name), '[^a-z0-9]+', '-', 'g'));
    if v_slug = '' then v_slug := 'barberia'; end if;
    v_slug := left(v_slug, 70) || '-' || substr(replace(new.id::text, '-', ''), 1, 8);

    insert into public.tenants(name, email, slug)
      values (v_tenant_name, new.email, v_slug)
      returning id into v_tenant_id;

    insert into public.saas_subscriptions(tenant_id, plan, status, max_barbers, price_monthly, current_period_end)
      values (v_tenant_id, v_plan, 'trialing',
        case when v_plan = 'pro' then 15 else 5 end, v_price, now() + interval '14 days');

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

commit;
