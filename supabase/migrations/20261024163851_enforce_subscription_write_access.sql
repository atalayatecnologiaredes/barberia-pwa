begin;

create or replace function private.enforce_current_saas_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_claim_role text;
begin
  v_claim_role := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  );
  if v_claim_role = 'service_role' or private.is_saas_admin() then
    return new;
  end if;

  case tg_table_name
    when 'payments', 'order_lines', 'commissions' then
      select o.tenant_id into v_tenant_id from public.service_orders o where o.id = new.order_id;
    when 'payment_splits' then
      select o.tenant_id into v_tenant_id
      from public.payments p join public.service_orders o on o.id = p.order_id
      where p.id = new.payment_id;
    when 'inventory_movements', 'restock_requests' then
      select i.tenant_id into v_tenant_id from public.inventory_items i where i.id = new.inventory_item_id;
    when 'loyalty_ledger' then
      select c.tenant_id into v_tenant_id from public.clients c where c.id = new.client_id;
    when 'service_inventory_usage' then
      select s.tenant_id into v_tenant_id from public.services s where s.id = new.service_id;
    when 'staff_shifts' then
      select p.tenant_id into v_tenant_id from public.profiles p where p.id = new.profile_id;
    else
      v_tenant_id := nullif(to_jsonb(new) ->> 'tenant_id', '')::uuid;
  end case;

  if tg_table_name = 'clients' and v_tenant_id is null then
    return new;
  end if;

  if v_tenant_id is null or not exists (
    select 1
    from public.tenants t
    join public.saas_subscriptions s on s.tenant_id = t.id
    join public.saas_settings cfg on cfg.singleton
    where t.id = v_tenant_id
      and t.active
      and s.status in ('trialing','active')
      and s.current_period_end + make_interval(days => cfg.grace_days) > now()
  ) then
    raise exception 'La suscripción de esta barbería venció. Contacta a soporte para renovar.' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_current_saas_access() from public, anon, authenticated;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'appointments','barbers','clients','commissions','inventory_items',
    'inventory_movements','loyalty_ledger','loyalty_redemptions','loyalty_rewards',
    'order_lines','payment_splits','payments','queue_visits','restock_requests',
    'service_inventory_usage','service_orders','services','staff_shifts',
    'barber_toolkit_items','loyalty_program_rules'
  ] loop
    execute format('drop trigger if exists enforce_saas_subscription_write on public.%I', v_table);
    execute format(
      'create trigger enforce_saas_subscription_write before insert or update on public.%I for each row execute function private.enforce_current_saas_access()',
      v_table
    );
  end loop;
end;
$$;

commit;
