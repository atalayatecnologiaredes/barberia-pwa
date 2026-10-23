-- Repair the existing Auth signup trigger for the live SaaS enum and signup payload.
-- The remote project uses uppercase enum labels (BASIC/PRO/ENTERPRISE).
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_price numeric(10,2);
  v_plan public.saas_plan_tier;
  v_plan_label text;
  v_plan_code text := 'basic';
  v_tenant_name text;
  v_owner_name text;
  v_slug text;
  v_assigned_role public.app_role := 'CLIENT';
  v_client_id text := 'client_' || substr(replace(new.id::text, '-', ''), 1, 8);
begin
  v_owner_name := coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1));
  v_tenant_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'tenant_name'), ''),
    case when new.raw_user_meta_data ->> 'signup_type' = 'shop_owner' then 'Mi barbería' end
  );

  if v_tenant_name is not null then
    if length(v_tenant_name) not between 2 and 120 then
      raise exception 'Nombre de barbería no válido';
    end if;

    select e.enumlabel into v_plan_label
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    join pg_enum e on e.enumtypid = t.oid
    where n.nspname = 'public'
      and t.typname = 'saas_plan_tier'
      and lower(e.enumlabel) = v_plan_code
    limit 1;

    if v_plan_label is null then
      raise exception 'El enum saas_plan_tier no contiene el plan básico';
    end if;
    v_plan := v_plan_label::public.saas_plan_tier;

    select sp.monthly_price into v_price
    from public.subscription_plans sp
    where sp.code = v_plan_code and sp.active;
    if v_price is null then
      raise exception 'Plan de suscripción no disponible';
    end if;

    v_slug := trim(both '-' from regexp_replace(lower(v_tenant_name), '[^a-z0-9]+', '-', 'g'));
    if v_slug = '' then v_slug := 'barberia'; end if;
    v_slug := left(v_slug, 70) || '-' || substr(replace(new.id::text, '-', ''), 1, 8);

    insert into public.tenants(name, email, slug)
      values (v_tenant_name, new.email, v_slug)
      returning id into v_tenant_id;

    insert into public.saas_subscriptions(tenant_id, plan, status, max_barbers, price_monthly, current_period_end)
      values (v_tenant_id, v_plan, 'trialing', 5, v_price, now() + interval '14 days');

    -- Preserve adoption of the legacy demo catalog when the first tenant is created.
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
    values (
      new.id,
      v_assigned_role,
      v_owner_name,
      new.email,
      new.raw_user_meta_data ->> 'phone',
      case when v_tenant_id is null then v_client_id else null end,
      v_tenant_id
    );
  return new;
end;
$$;
