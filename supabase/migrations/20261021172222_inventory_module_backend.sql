begin;

-- The browser never supplies a tenant identifier for inventory writes.
-- Each function derives it from the active authenticated profile.
create or replace function public.create_inventory_item(
  p_name text,
  p_category public.stock_category,
  p_unit public.stock_unit,
  p_minimum numeric default 0,
  p_cost numeric default 0,
  p_retail_price numeric default 0,
  p_sku text default null
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_role public.app_role;
  v_id text;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select p.tenant_id, p.role
    into v_tenant, v_role
    from public.profiles p
   where p.id = (select auth.uid()) and p.active;

  if v_tenant is null or v_role not in ('SUPER_ADMIN', 'RECEPCION') then
    raise exception 'Not authorized to create inventory items' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_name, ''))) not between 1 and 120
     or p_minimum is null or p_minimum < 0
     or p_cost is null or p_cost < 0
     or p_retail_price is null or p_retail_price < 0
     or length(coalesce(p_sku, '')) > 80 then
    raise exception 'Invalid inventory item data' using errcode = '22023';
  end if;

  v_id := 'inv_' || replace(pg_catalog.gen_random_uuid()::text, '-', '');
  insert into public.inventory_items(
    id, tenant_id, name, category, quantity, unit, minimum_quantity, cost, retail_price, sku
  ) values (
    v_id, v_tenant, trim(p_name), p_category, 0, p_unit, p_minimum, p_cost, p_retail_price,
    nullif(trim(coalesce(p_sku, '')), '')
  );
  return v_id;
end;
$$;

create or replace function public.adjust_inventory_stock(
  p_item_id text,
  p_delta numeric,
  p_movement_type text,
  p_note text default ''
) returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_role public.app_role;
  v_item public.inventory_items%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select p.tenant_id, p.role
    into v_tenant, v_role
    from public.profiles p
   where p.id = (select auth.uid()) and p.active;
  if v_tenant is null or v_role not in ('SUPER_ADMIN', 'RECEPCION') then
    raise exception 'Not authorized to adjust inventory' using errcode = '42501';
  end if;
  if p_delta is null or p_delta = 0 or p_movement_type not in ('purchase', 'restock', 'adjustment') then
    raise exception 'Invalid stock movement' using errcode = '22023';
  end if;

  select i.* into v_item
    from public.inventory_items i
   where i.id = p_item_id and i.tenant_id = v_tenant and i.active
   for update;
  if not found then raise exception 'Inventory item not found'; end if;
  if v_item.quantity + p_delta < 0 then raise exception 'Insufficient stock'; end if;

  update public.inventory_items
     set quantity = quantity + p_delta
   where id = p_item_id and tenant_id = v_tenant
   returning quantity into v_item.quantity;
  insert into public.inventory_movements(inventory_item_id, quantity_delta, unit, movement_type, note, actor_id)
  values (p_item_id, p_delta, v_item.unit, p_movement_type, left(coalesce(p_note, ''), 500), (select auth.uid()));
  return v_item.quantity;
end;
$$;

create or replace function public.create_restock_request(
  p_item_id text,
  p_quantity numeric,
  p_urgency text default 'normal'
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_role public.app_role;
  v_barber text;
  v_station text;
  v_unit public.stock_unit;
  v_id text;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select p.tenant_id, p.role, p.barber_id
    into v_tenant, v_role, v_barber
    from public.profiles p
   where p.id = (select auth.uid()) and p.active;
  if v_tenant is null or v_role not in ('SUPER_ADMIN', 'RECEPCION', 'BARBER') then
    raise exception 'Not authorized to request restock' using errcode = '42501';
  end if;
  if p_quantity is null or p_quantity <= 0 or p_urgency not in ('normal', 'urgent') then
    raise exception 'Invalid restock request' using errcode = '22023';
  end if;

  select i.unit into v_unit
    from public.inventory_items i
   where i.id = p_item_id and i.tenant_id = v_tenant and i.active;
  if not found then raise exception 'Inventory item not found'; end if;
  select b.station_id into v_station
    from public.barbers b
   where b.id = v_barber and b.tenant_id = v_tenant;

  insert into public.restock_requests(
    inventory_item_id, quantity, unit, urgency, station_id, barber_id, requested_by
  ) values (
    p_item_id, p_quantity, v_unit, p_urgency, coalesce(v_station, 'warehouse'), v_barber, (select auth.uid())
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.fulfill_restock_request(p_request_id text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_role public.app_role;
  v_request public.restock_requests%rowtype;
  v_item public.inventory_items%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select p.tenant_id, p.role
    into v_tenant, v_role
    from public.profiles p
   where p.id = (select auth.uid()) and p.active;
  if v_tenant is null or v_role not in ('SUPER_ADMIN', 'RECEPCION') then
    raise exception 'Not authorized to fulfill restock requests' using errcode = '42501';
  end if;

  select r.* into v_request
    from public.restock_requests r
    join public.inventory_items i on i.id = r.inventory_item_id and i.tenant_id = v_tenant
   where r.id = p_request_id
   for update of r;
  if not found or v_request.status <> 'open' then raise exception 'Open request not found'; end if;

  select i.* into v_item
    from public.inventory_items i
   where i.id = v_request.inventory_item_id and i.tenant_id = v_tenant
   for update;
  if not found then raise exception 'Inventory item not found'; end if;
  if v_item.quantity < v_request.quantity then raise exception 'Insufficient stock to fulfill request'; end if;

  update public.inventory_items set quantity = quantity - v_request.quantity
   where id = v_item.id and tenant_id = v_tenant;
  insert into public.inventory_movements(inventory_item_id, quantity_delta, unit, movement_type, note, actor_id)
  values (v_item.id, -v_request.quantity, v_item.unit, 'adjustment', 'Despacho de solicitud ' || v_request.id, (select auth.uid()));
  update public.restock_requests
     set status = 'fulfilled', fulfilled_by = (select auth.uid()), fulfilled_at = now()
   where id = v_request.id;
  return v_request.id;
end;
$$;

create table if not exists public.barber_toolkit_items (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  barber_id text not null references public.barbers(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  brand text not null default '',
  serial_number text,
  condition text not null default 'excellent' check (condition in ('excellent','in_use','maintenance','laundry','retired')),
  notes text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, serial_number)
);
create index if not exists barber_toolkit_items_assigned_idx on public.barber_toolkit_items(tenant_id, barber_id, active);
alter table public.barber_toolkit_items enable row level security;
drop policy if exists "toolkits owner manages" on public.barber_toolkit_items;
create policy "toolkits owner manages" on public.barber_toolkit_items for all to authenticated
  using (exists (
    select 1 from public.profiles p
     where p.id = (select auth.uid()) and p.active and p.role = 'SUPER_ADMIN'
       and p.tenant_id = barber_toolkit_items.tenant_id
  ))
  with check (exists (
    select 1 from public.profiles p
     where p.id = (select auth.uid()) and p.active and p.role = 'SUPER_ADMIN'
       and p.tenant_id = barber_toolkit_items.tenant_id
  ) and exists (
    select 1 from public.barbers b
     where b.id = barber_toolkit_items.barber_id and b.tenant_id = barber_toolkit_items.tenant_id
  ));
drop policy if exists "barber reads assigned toolkit" on public.barber_toolkit_items;
create policy "barber reads assigned toolkit" on public.barber_toolkit_items for select to authenticated
  using (exists (
    select 1 from public.profiles p
     where p.id = (select auth.uid()) and p.active and p.tenant_id = barber_toolkit_items.tenant_id
       and p.barber_id = barber_toolkit_items.barber_id
  ));
grant select, insert, update, delete on public.barber_toolkit_items to authenticated;

revoke all on function public.create_inventory_item(text,public.stock_category,public.stock_unit,numeric,numeric,numeric,text) from public, anon;
revoke all on function public.adjust_inventory_stock(text,numeric,text,text) from public, anon;
revoke all on function public.create_restock_request(text,numeric,text) from public, anon;
revoke all on function public.fulfill_restock_request(text) from public, anon;
grant execute on function public.create_inventory_item(text,public.stock_category,public.stock_unit,numeric,numeric,numeric,text) to authenticated;
grant execute on function public.adjust_inventory_stock(text,numeric,text,text) to authenticated;
grant execute on function public.create_restock_request(text,numeric,text) to authenticated;
grant execute on function public.fulfill_restock_request(text) to authenticated;

notify pgrst, 'reload schema';
commit;
