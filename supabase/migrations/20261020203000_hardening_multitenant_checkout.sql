-- Security and checkout hardening for databases that already have the SaaS and QR migrations.
-- Run after schema.sql, saas_tenants_migration.sql and client_qr_loyalty.sql.
begin;

-- Staff scope is always derived from the signed-in profile and its tenant.
create or replace function private.is_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.active
      and p.role in ('SUPER_ADMIN', 'RECEPCION', 'BARBER')
      and (private.is_saas_admin() or p.tenant_id is not null)
  );
$$;

create or replace function private.current_tenant_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select p.tenant_id from public.profiles p where p.id = (select auth.uid()) and p.active;
$$;

drop policy if exists "profiles tenant boundary" on public.profiles;
create policy "profiles tenant boundary" on public.profiles as restrictive for all to authenticated
  using (id = (select auth.uid()) or tenant_id = private.current_tenant_id() or private.is_saas_admin())
  with check (id = (select auth.uid()) or tenant_id = private.current_tenant_id() or private.is_saas_admin());

create or replace function public.finish_service(p_order_id text, p_actor uuid default auth.uid())
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_order public.service_orders%rowtype;
  v_usage record;
begin
  if not private.has_role(array['SUPER_ADMIN', 'BARBER']::public.app_role[]) then
    raise exception 'Not authorized to complete service';
  end if;
  select * into v_order from public.service_orders
    where id = p_order_id and (tenant_id = private.current_tenant_id() or private.is_saas_admin()) for update;
  if not found then raise exception 'Order not found'; end if;
  if v_order.status in ('ready-for-checkout', 'paid') then return; end if;
  for v_usage in
    select su.inventory_item_id, su.quantity, su.unit
    from public.service_inventory_usage su where su.service_id = v_order.service_id
  loop
    update public.inventory_items set quantity = quantity - v_usage.quantity
      where id = v_usage.inventory_item_id and quantity >= v_usage.quantity
        and (tenant_id = v_order.tenant_id or private.is_saas_admin());
    if not found then raise exception 'Insufficient stock for item %', v_usage.inventory_item_id; end if;
    insert into public.inventory_movements(inventory_item_id, order_id, quantity_delta, unit, movement_type, note, actor_id)
      values (v_usage.inventory_item_id, v_order.id, -v_usage.quantity, v_usage.unit, 'service-use', 'Consumo automático por servicio', (select auth.uid()));
  end loop;
  update public.service_orders set status = 'ready-for-checkout', ended_at = now() where id = p_order_id;
  if v_order.queue_visit_id is not null then
    update public.queue_visits set status = 'complete', completed_at = now()
      where id = v_order.queue_visit_id and tenant_id = v_order.tenant_id;
  end if;
end;
$$;

-- A client created by staff has no login profile, so staff in its tenant must be
-- allowed to read it. Keep the tenant restriction as an additional restrictive policy.
drop policy if exists "tenant staff can read clients" on public.clients;
create policy "tenant staff can read clients" on public.clients for select to authenticated
  using (exists (
    select 1 from public.profiles p where p.id = (select auth.uid()) and p.active
      and p.role in ('SUPER_ADMIN', 'RECEPCION') and p.tenant_id = clients.tenant_id
  ));

-- Add tenant filters to operational tables without tenant_id columns by following their foreign keys.
drop policy if exists "service_inventory_usage tenant boundary" on public.service_inventory_usage;
create policy "service_inventory_usage tenant boundary" on public.service_inventory_usage as restrictive for all to authenticated
  using (exists (select 1 from public.services s where s.id = service_id and s.tenant_id = (select p.tenant_id from public.profiles p where p.id = (select auth.uid()))))
  with check (exists (select 1 from public.services s where s.id = service_id and s.tenant_id = (select p.tenant_id from public.profiles p where p.id = (select auth.uid()))));
drop policy if exists "inventory_movements tenant boundary" on public.inventory_movements;
create policy "inventory_movements tenant boundary" on public.inventory_movements as restrictive for all to authenticated
  using (exists (select 1 from public.inventory_items i where i.id = inventory_item_id and i.tenant_id = (select p.tenant_id from public.profiles p where p.id = (select auth.uid()))))
  with check (exists (select 1 from public.inventory_items i where i.id = inventory_item_id and i.tenant_id = (select p.tenant_id from public.profiles p where p.id = (select auth.uid()))));
drop policy if exists "payments tenant boundary" on public.payments;
create policy "payments tenant boundary" on public.payments as restrictive for all to authenticated
  using (exists (select 1 from public.service_orders o where o.id = order_id and o.tenant_id = (select p.tenant_id from public.profiles p where p.id = (select auth.uid()))) or private.is_saas_admin())
  with check (exists (select 1 from public.service_orders o where o.id = order_id and o.tenant_id = (select p.tenant_id from public.profiles p where p.id = (select auth.uid()))) or private.is_saas_admin());
drop policy if exists "payment_splits tenant boundary" on public.payment_splits;
create policy "payment_splits tenant boundary" on public.payment_splits as restrictive for all to authenticated
  using (exists (select 1 from public.payments x join public.service_orders o on o.id = x.order_id where x.id = payment_id and o.tenant_id = (select p.tenant_id from public.profiles p where p.id = (select auth.uid()))) or private.is_saas_admin())
  with check (exists (select 1 from public.payments x join public.service_orders o on o.id = x.order_id where x.id = payment_id and o.tenant_id = (select p.tenant_id from public.profiles p where p.id = (select auth.uid()))) or private.is_saas_admin());
drop policy if exists "commissions tenant boundary" on public.commissions;
create policy "commissions tenant boundary" on public.commissions as restrictive for all to authenticated
  using (exists (select 1 from public.service_orders o where o.id = order_id and o.tenant_id = (select p.tenant_id from public.profiles p where p.id = (select auth.uid()))) or private.is_saas_admin())
  with check (exists (select 1 from public.service_orders o where o.id = order_id and o.tenant_id = (select p.tenant_id from public.profiles p where p.id = (select auth.uid()))) or private.is_saas_admin());
drop policy if exists "restock_requests tenant boundary" on public.restock_requests;
create policy "restock_requests tenant boundary" on public.restock_requests as restrictive for all to authenticated
  using (exists (select 1 from public.inventory_items i where i.id = inventory_item_id and i.tenant_id = (select p.tenant_id from public.profiles p where p.id = (select auth.uid()))) or private.is_saas_admin())
  with check (exists (select 1 from public.inventory_items i where i.id = inventory_item_id and i.tenant_id = (select p.tenant_id from public.profiles p where p.id = (select auth.uid()))) or private.is_saas_admin());
drop policy if exists "loyalty_ledger tenant boundary" on public.loyalty_ledger;
create policy "loyalty_ledger tenant boundary" on public.loyalty_ledger as restrictive for all to authenticated
  using (exists (select 1 from public.clients c where c.id = client_id and c.tenant_id = (select p.tenant_id from public.profiles p where p.id = (select auth.uid()))) or private.is_saas_admin())
  with check (exists (select 1 from public.clients c where c.id = client_id and c.tenant_id = (select p.tenant_id from public.profiles p where p.id = (select auth.uid()))) or private.is_saas_admin());
drop policy if exists "staff_shifts tenant boundary" on public.staff_shifts;
create policy "staff_shifts tenant boundary" on public.staff_shifts as restrictive for all to authenticated
  using (exists (select 1 from public.profiles x where x.id = profile_id and x.tenant_id = (select p.tenant_id from public.profiles p where p.id = (select auth.uid()))) or private.is_saas_admin())
  with check (exists (select 1 from public.profiles x where x.id = profile_id and x.tenant_id = (select p.tenant_id from public.profiles p where p.id = (select auth.uid()))) or private.is_saas_admin());
drop policy if exists "client_look_photos tenant boundary" on public.client_look_photos;
create policy "client_look_photos tenant boundary" on public.client_look_photos as restrictive for all to authenticated
  using (exists (select 1 from public.clients c where c.id = client_id and c.tenant_id = (select p.tenant_id from public.profiles p where p.id = (select auth.uid()))) or private.is_saas_admin())
  with check (exists (select 1 from public.clients c where c.id = client_id and c.tenant_id = (select p.tenant_id from public.profiles p where p.id = (select auth.uid()))) or private.is_saas_admin());
drop policy if exists "order_lines tenant boundary" on public.order_lines;
create policy "order_lines tenant boundary" on public.order_lines as restrictive for all to authenticated
  using (exists (select 1 from public.service_orders o where o.id = order_id and (o.tenant_id = private.current_tenant_id() or private.is_saas_admin())))
  with check (exists (select 1 from public.service_orders o where o.id = order_id and (o.tenant_id = private.current_tenant_id() or private.is_saas_admin())));

-- A queue visit can have only one service order, even if two clients start it concurrently.
create unique index if not exists service_orders_queue_visit_unique
  on public.service_orders(queue_visit_id) where queue_visit_id is not null;

-- Recompute authoritative totals from saved service and retail prices. Client-provided
-- amounts are retained in the signature for compatibility but must match the calculation.
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
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_order public.service_orders%rowtype;
  v_payment_id uuid;
  v_line record;
  v_split jsonb;
  v_subtotal numeric(10,2);
  v_tax numeric(10,2);
  v_total numeric(10,2);
  v_product_total numeric(10,2) := 0;
  v_service_commission numeric(10,2);
  v_product_commission numeric(10,2);
begin
  if not private.has_role(array['SUPER_ADMIN', 'RECEPCION']::public.app_role[]) then
    raise exception 'Not authorized to complete checkout';
  end if;
  select * into v_order from public.service_orders
    where id = p_order_id and (tenant_id = private.current_tenant_id() or private.is_saas_admin()) for update;
  if not found then raise exception 'Order not found'; end if;
  if v_order.status = 'paid' then
    select id into v_payment_id from public.payments where order_id = p_order_id;
    return v_payment_id;
  end if;
  if v_order.status <> 'ready-for-checkout' then raise exception 'Service must be finished before checkout'; end if;

  for v_line in select ol.*, i.quantity as stock_quantity, i.unit, i.retail_price, i.tenant_id as item_tenant_id
    from public.order_lines ol join public.inventory_items i on i.id = ol.inventory_item_id
    where ol.order_id = p_order_id for update of ol, i loop
    if v_line.item_tenant_id is distinct from v_order.tenant_id then raise exception 'Product belongs to another barber shop'; end if;
    if v_line.unit_price <> v_line.retail_price then
      raise exception 'Product price changed; reload the checkout';
    end if;
    v_product_total := v_product_total + v_line.quantity * v_line.unit_price;
  end loop;
  v_subtotal := round(v_order.service_price + v_product_total, 2);
  v_tax := round(v_subtotal * 0.15, 2);
  v_total := round(v_subtotal + v_tax + greatest(coalesce(p_tip, 0), 0), 2);
  if round(p_subtotal, 2) <> v_subtotal or round(p_tax, 2) <> v_tax or round(p_total, 2) <> v_total or p_tip < 0 then
    raise exception 'Payment totals do not match the order';
  end if;

  for v_line in select * from public.order_lines where order_id = p_order_id for update loop
    update public.inventory_items set quantity = quantity - v_line.quantity
      where id = v_line.inventory_item_id and quantity >= v_line.quantity;
    if not found then raise exception 'Insufficient stock for product %', v_line.inventory_item_id; end if;
    insert into public.inventory_movements(inventory_item_id, order_id, quantity_delta, unit, movement_type, note, actor_id)
      select v_line.inventory_item_id, p_order_id, -v_line.quantity, i.unit, 'retail-sale', 'Venta POS', p_actor
      from public.inventory_items i where i.id = v_line.inventory_item_id;
  end loop;

  insert into public.payments(order_id, client_id, subtotal, tax, tip, total, method, created_by)
    values (p_order_id, v_order.client_id, v_subtotal, v_tax, p_tip, v_total, p_method, p_actor)
    returning id into v_payment_id;

  if p_method = 'split' then
    if jsonb_typeof(p_splits) <> 'array' or jsonb_array_length(p_splits) = 0 then raise exception 'Split payment requires payment parts'; end if;
    for v_split in select value from jsonb_array_elements(p_splits) loop
      if (v_split ->> 'method') is null or (v_split ->> 'method') = 'split' or coalesce((v_split ->> 'amount')::numeric, 0) <= 0 then
        raise exception 'Invalid split payment part';
      end if;
      insert into public.payment_splits(payment_id, method, amount, reference)
        values (v_payment_id, (v_split ->> 'method')::public.payment_method, (v_split ->> 'amount')::numeric, v_split ->> 'reference');
    end loop;
    if (select round(coalesce(sum(amount), 0), 2) from public.payment_splits where payment_id = v_payment_id) <> v_total then
      raise exception 'Split amounts must equal total';
    end if;
  end if;

  select round(v_order.service_price * b.commission_service, 2), round(v_product_total * b.commission_product, 2)
    into v_service_commission, v_product_commission from public.barbers b where b.id = v_order.barber_id;
  insert into public.commissions(payment_id, order_id, barber_id, service_amount, product_amount)
    values (v_payment_id, p_order_id, v_order.barber_id, coalesce(v_service_commission, 0), coalesce(v_product_commission, 0));
  update public.service_orders set status = 'paid', paid_at = now() where id = p_order_id;
  if v_order.client_id is not null then
    update public.clients set visit_count = visit_count + 1, loyalty_points = loyalty_points + floor(v_total)::integer where id = v_order.client_id;
    insert into public.loyalty_ledger(client_id, payment_id, points, entry_type, description)
      values (v_order.client_id, v_payment_id, floor(v_total)::integer, 'earned', 'Puntos por compra');
  end if;
  return v_payment_id;
end;
$$;

grant execute on function public.complete_checkout(text, numeric, numeric, numeric, numeric, public.payment_method, jsonb, uuid) to authenticated;
grant execute on function public.finish_service(text, uuid) to authenticated;
commit;
