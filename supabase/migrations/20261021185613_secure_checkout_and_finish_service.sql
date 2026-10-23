-- Harden order completion and checkout for the live multi-tenant schema.
-- Preserve the existing RPC signatures for current clients. p_actor is ignored:
-- all audit identities come from auth.uid().
begin;

create or replace function public.finish_service(
  p_order_id text,
  p_actor uuid default auth.uid()
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_tenant_id uuid;
  v_role public.app_role;
  v_order public.service_orders%rowtype;
  v_usage record;
begin
  if v_actor_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select p.tenant_id, p.role
    into v_tenant_id, v_role
  from public.profiles p
  where p.id = v_actor_id and p.active;

  if not found or v_role not in ('SUPER_ADMIN', 'BARBER') then
    raise exception 'Not authorized to complete service' using errcode = '42501';
  end if;

  if v_tenant_id is null then
    raise exception 'User is not assigned to a barber shop' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.tenants t
    join public.saas_subscriptions s on s.tenant_id = t.id
    where t.id = v_tenant_id and t.active
      and s.status in ('active', 'trialing')
      and (s.current_period_end is null or s.current_period_end > now())
  ) then
    raise exception 'Barber shop subscription is inactive or expired' using errcode = '42501';
  end if;

  select o.* into v_order
  from public.service_orders o
  where o.id = p_order_id and o.tenant_id = v_tenant_id
  for update;
  if not found then raise exception 'Order not found in your barber shop' using errcode = 'P0002'; end if;

  if v_role = 'BARBER' and not exists (
    select 1 from public.profiles p where p.id = v_actor_id and p.barber_id = v_order.barber_id
  ) then
    raise exception 'Barber can only complete their own service' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.services s
    where s.id = v_order.service_id and s.tenant_id = v_tenant_id
  ) or not exists (
    select 1 from public.barbers b
    where b.id = v_order.barber_id and b.tenant_id = v_tenant_id
  ) then
    raise exception 'Order service or barber does not belong to your barber shop' using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.service_inventory_usage su
    left join public.inventory_items i
      on i.id = su.inventory_item_id and i.tenant_id = v_tenant_id
    where su.service_id = v_order.service_id and i.id is null
  ) then
    raise exception 'Service recipe contains an item outside your barber shop' using errcode = '42501';
  end if;

  if v_order.status in ('ready-for-checkout', 'paid') then return; end if;
  if v_order.status <> 'in-service' then
    raise exception 'Order is not in service' using errcode = '22023';
  end if;

  for v_usage in
    select su.inventory_item_id, su.quantity, su.unit
    from public.service_inventory_usage su
    join public.inventory_items i
      on i.id = su.inventory_item_id and i.tenant_id = v_tenant_id
    where su.service_id = v_order.service_id
    order by su.inventory_item_id
    for update of i
  loop
    update public.inventory_items i
      set quantity = i.quantity - v_usage.quantity,
          updated_at = now()
    where i.id = v_usage.inventory_item_id
      and i.tenant_id = v_tenant_id
      and i.quantity >= v_usage.quantity;
    if not found then
      raise exception 'Insufficient stock for item %', v_usage.inventory_item_id using errcode = '22023';
    end if;

    insert into public.inventory_movements(
      inventory_item_id, order_id, quantity_delta, unit, movement_type, note, actor_id
    ) values (
      v_usage.inventory_item_id, v_order.id, -v_usage.quantity, v_usage.unit,
      'service-use', 'Consumo automático por servicio', v_actor_id
    );
  end loop;

  update public.service_orders
  set status = 'ready-for-checkout', ended_at = now()
  where id = v_order.id and tenant_id = v_tenant_id;

  if v_order.queue_visit_id is not null then
    update public.queue_visits
    set status = 'complete', completed_at = now()
    where id = v_order.queue_visit_id and tenant_id = v_tenant_id;
  end if;
end;
$$;

create or replace function public.complete_checkout(
  p_order_id text,
  p_subtotal numeric,
  p_tax numeric,
  p_tip numeric,
  p_total numeric,
  p_method public.payment_method,
  p_splits jsonb default '[]'::jsonb,
  p_actor uuid default auth.uid()
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_tenant_id uuid;
  v_role public.app_role;
  v_order public.service_orders%rowtype;
  v_payment_id uuid;
  v_line record;
  v_split jsonb;
  v_subtotal numeric(10,2);
  v_tax numeric(10,2);
  v_tip numeric(10,2);
  v_total numeric(10,2);
  v_tax_rate numeric(6,5);
  v_product_total numeric(10,2) := 0;
  v_service_commission numeric(10,2);
  v_product_commission numeric(10,2);
begin
  if v_actor_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select p.tenant_id, p.role
    into v_tenant_id, v_role
  from public.profiles p
  where p.id = v_actor_id and p.active;

  if not found or v_role not in ('SUPER_ADMIN', 'RECEPCION') then
    raise exception 'Not authorized to complete checkout' using errcode = '42501';
  end if;

  if v_tenant_id is null then
    raise exception 'User is not assigned to a barber shop' using errcode = '42501';
  end if;

  select t.tax_rate into v_tax_rate from public.tenants t where t.id=v_tenant_id and t.active;
  if v_tax_rate is null then raise exception 'Shop tax settings are unavailable' using errcode='42501'; end if;

  if not exists (
    select 1
    from public.tenants t
    join public.saas_subscriptions s on s.tenant_id = t.id
    where t.id = v_tenant_id and t.active
      and s.status in ('active', 'trialing')
      and (s.current_period_end is null or s.current_period_end > now())
  ) then
    raise exception 'Barber shop subscription is inactive or expired' using errcode = '42501';
  end if;

  select o.* into v_order
  from public.service_orders o
  where o.id = p_order_id and o.tenant_id = v_tenant_id
  for update;
  if not found then raise exception 'Order not found in your barber shop' using errcode = 'P0002'; end if;

  if v_order.status = 'paid' then
    select p.id into v_payment_id
    from public.payments p
    where p.order_id = v_order.id;
    return v_payment_id;
  end if;
  if v_order.status <> 'ready-for-checkout' then
    raise exception 'Service must be finished before checkout' using errcode = '22023';
  end if;
  if p_method = 'loyalty' then
    raise exception 'Loyalty redemption is not configured for checkout' using errcode = '22023';
  end if;

  -- Lock product rows and derive all product totals from current tenant prices.
  -- The order_lines.unit_price snapshot must equal the catalog price.
  for v_line in
    select ol.id, ol.inventory_item_id, ol.item_name, ol.quantity, ol.unit_price,
           i.name as catalog_name, i.quantity as stock_quantity,
           i.unit, i.retail_price, i.tenant_id as item_tenant_id
    from public.order_lines ol
    join public.inventory_items i on i.id = ol.inventory_item_id
    where ol.order_id = v_order.id
    order by ol.inventory_item_id
    for update of ol, i
  loop
    if v_line.item_tenant_id is distinct from v_tenant_id then
      raise exception 'Product belongs to another barber shop' using errcode = '42501';
    end if;
    if not exists (
      select 1 from public.inventory_items i
      where i.id = v_line.inventory_item_id
        and i.tenant_id = v_tenant_id
        and i.active
        and i.category = 'Retail'
    ) then
      raise exception 'Product is not available for retail sale' using errcode = '22023';
    end if;
    if v_line.quantity <= 0 or v_line.unit_price is distinct from v_line.retail_price then
      raise exception 'Product price or quantity changed; reload the checkout' using errcode = '22023';
    end if;
    v_product_total := v_product_total + (v_line.quantity * v_line.retail_price);
  end loop;

  -- Revalidate the service's current price and tenant; service_price on the order
  -- is a snapshot and may not be changed by a request payload.
  if not exists (
    select 1 from public.services s
    where s.id = v_order.service_id
      and s.tenant_id = v_tenant_id
      and v_order.service_price = s.price
  ) then
    raise exception 'Service price changed or service belongs to another barber shop; reload checkout' using errcode = '22023';
  end if;

  v_subtotal := round(v_order.service_price + v_product_total, 2);
  if p_tip is null or p_tip < 0 or p_tip::text in ('NaN', 'Infinity', '-Infinity') then
    raise exception 'Tip must be zero or greater' using errcode = '22023';
  end if;
  v_tip := round(p_tip, 2);
  if p_tip <> v_tip then
    raise exception 'Tip must use at most two decimal places' using errcode = '22023';
  end if;
  v_tax := round(v_subtotal * v_tax_rate, 2);
  v_total := round(v_subtotal + v_tax + v_tip, 2);

  if p_subtotal is null or p_subtotal <> v_subtotal
     or p_tax is null or p_tax <> v_tax
     or p_total is null or p_total <> v_total then
    raise exception 'Payment totals do not match current service and retail prices' using errcode = '22023';
  end if;

  if p_method = 'split' then
    if jsonb_typeof(p_splits) <> 'array' or jsonb_array_length(p_splits) = 0 then
      raise exception 'Split payment requires payment parts' using errcode = '22023';
    end if;
    if exists (
      select 1 from jsonb_array_elements(p_splits) s(value)
      where coalesce(s.value ->> 'method', '') not in ('cash', 'card', 'mobile-transfer')
         or coalesce((s.value ->> 'amount')::numeric, 0) <= 0
    ) then
      raise exception 'Invalid split payment part' using errcode = '22023';
    end if;
    if round((select coalesce(sum((s.value ->> 'amount')::numeric), 0)
              from jsonb_array_elements(p_splits) s(value)), 2) <> v_total then
      raise exception 'Split amounts must equal total' using errcode = '22023';
    end if;
  elsif p_method is null or p_method = 'split' then
    raise exception 'Invalid payment method' using errcode = '22023';
  end if;

  -- All totals above are authoritative; client-supplied p_actor is ignored.
  insert into public.payments(order_id, client_id, subtotal, tax, tip, total, method, created_by)
  values (v_order.id, v_order.client_id, v_subtotal, v_tax, v_tip, v_total, p_method, v_actor_id)
  returning id into v_payment_id;

  if p_method = 'split' then
    for v_split in select value from jsonb_array_elements(p_splits) loop
      insert into public.payment_splits(payment_id, method, amount, reference)
      values (
        v_payment_id,
        (v_split ->> 'method')::public.payment_method,
        (v_split ->> 'amount')::numeric,
        nullif(v_split ->> 'reference', '')
      );
    end loop;
  end if;

  for v_line in
    select ol.id, ol.inventory_item_id, ol.quantity
    from public.order_lines ol
    where ol.order_id = v_order.id
    order by ol.inventory_item_id
    for update
  loop
    update public.inventory_items i
    set quantity = i.quantity - v_line.quantity,
        updated_at = now()
    where i.id = v_line.inventory_item_id
      and i.tenant_id = v_tenant_id
      and i.active
      and i.category = 'Retail'
      and i.quantity >= v_line.quantity;
    if not found then
      raise exception 'Insufficient stock for product %', v_line.inventory_item_id using errcode = '22023';
    end if;

    insert into public.inventory_movements(
      inventory_item_id, order_id, quantity_delta, unit, movement_type, note, actor_id
    )
    select i.id, v_order.id, -v_line.quantity, i.unit,
           'retail-sale', 'Venta POS', v_actor_id
    from public.inventory_items i
    where i.id = v_line.inventory_item_id and i.tenant_id = v_tenant_id;
  end loop;

  select round(v_order.service_price * b.commission_service, 2),
         round(v_product_total * b.commission_product, 2)
    into v_service_commission, v_product_commission
  from public.barbers b
  where b.id = v_order.barber_id and b.tenant_id = v_tenant_id;

  insert into public.commissions(payment_id, order_id, barber_id, service_amount, product_amount)
  values (v_payment_id, v_order.id, v_order.barber_id,
          coalesce(v_service_commission, 0), coalesce(v_product_commission, 0));

  update public.service_orders
  set status = 'paid', paid_at = now()
  where id = v_order.id and tenant_id = v_tenant_id;

  if v_order.client_id is not null then
    update public.clients c
    set visit_count = c.visit_count + 1,
        loyalty_points = c.loyalty_points + floor(v_total)::integer
    where c.id = v_order.client_id and c.tenant_id = v_tenant_id;

    if found then
      insert into public.loyalty_ledger(client_id, payment_id, points, entry_type, description)
      values (v_order.client_id, v_payment_id, floor(v_total)::integer, 'earned', 'Puntos por compra');
    end if;
  end if;

  return v_payment_id;
end;
$$;

-- Do not allow anonymous/PUBLIC execution; authenticated remains the RPC caller.
revoke all on function public.finish_service(text, uuid) from public, anon;
revoke all on function public.complete_checkout(text, numeric, numeric, numeric, numeric, public.payment_method, jsonb, uuid) from public, anon;
grant execute on function public.finish_service(text, uuid) to authenticated;
grant execute on function public.complete_checkout(text, numeric, numeric, numeric, numeric, public.payment_method, jsonb, uuid) to authenticated;

commit;
