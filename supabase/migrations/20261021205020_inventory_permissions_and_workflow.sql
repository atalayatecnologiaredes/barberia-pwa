begin;

-- Inventory mutations must go through the validated RPCs. Barbers can read
-- stock and create their own restock requests, but cannot alter quantities,
-- prices, or other users' requests directly through the Data API.
drop policy if exists "inventory staff only" on public.inventory_items;
drop policy if exists "inventory staff read own tenant" on public.inventory_items;
drop policy if exists "inventory managers write own tenant" on public.inventory_items;
create policy "inventory staff read own tenant"
  on public.inventory_items for select to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.active
      and p.role in ('SUPER_ADMIN', 'RECEPCION', 'BARBER')
      and p.tenant_id = inventory_items.tenant_id
  ));
create policy "inventory managers write own tenant"
  on public.inventory_items for all to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.active
      and p.role in ('SUPER_ADMIN', 'RECEPCION')
      and p.tenant_id = inventory_items.tenant_id
  ))
  with check (exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.active
      and p.role in ('SUPER_ADMIN', 'RECEPCION')
      and p.tenant_id = inventory_items.tenant_id
  ));

-- Keep movement history for the shop owner and reception. Stock changes are
-- still recorded by the SECURITY DEFINER RPCs using auth.uid() as actor.
drop policy if exists "inventory movement staff only" on public.inventory_movements;
drop policy if exists "inventory managers read movements" on public.inventory_movements;
create policy "inventory managers read movements"
  on public.inventory_movements for select to authenticated
  using (exists (
    select 1 from public.profiles p
    join public.inventory_items i on i.id = inventory_movements.inventory_item_id
    where p.id = (select auth.uid()) and p.active
      and p.role in ('SUPER_ADMIN', 'RECEPCION')
      and p.tenant_id = i.tenant_id
  ));

-- Staff can manage requests in their own shop; a barber can see only their
-- requests and cannot mark them fulfilled or edit their audit fields.
drop policy if exists "restock staff only" on public.restock_requests;
drop policy if exists "stock managers manage own tenant requests" on public.restock_requests;
drop policy if exists "barbers read own restock requests" on public.restock_requests;
create policy "stock managers manage own tenant requests"
  on public.restock_requests for all to authenticated
  using (exists (
    select 1 from public.profiles p
    join public.inventory_items i on i.id = restock_requests.inventory_item_id
    where p.id = (select auth.uid()) and p.active
      and p.role in ('SUPER_ADMIN', 'RECEPCION')
      and p.tenant_id = i.tenant_id
  ))
  with check (exists (
    select 1 from public.profiles p
    join public.inventory_items i on i.id = restock_requests.inventory_item_id
    where p.id = (select auth.uid()) and p.active
      and p.role in ('SUPER_ADMIN', 'RECEPCION')
      and p.tenant_id = i.tenant_id
  ));
create policy "barbers read own restock requests"
  on public.restock_requests for select to authenticated
  using (exists (
    select 1 from public.profiles p
    join public.inventory_items i on i.id = restock_requests.inventory_item_id
    where p.id = (select auth.uid()) and p.active and p.role = 'BARBER'
      and p.barber_id = restock_requests.barber_id
      and p.tenant_id = i.tenant_id
  ));

-- Reception may view the toolkit but only the tenant owner can assign, edit,
-- or retire equipment. Barbers continue to see their assigned tools only.
drop policy if exists "reception reads tenant toolkits" on public.barber_toolkit_items;
create policy "reception reads tenant toolkits"
  on public.barber_toolkit_items for select to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.active and p.role = 'RECEPCION'
      and p.tenant_id = barber_toolkit_items.tenant_id
  ));

notify pgrst, 'reload schema';
commit;
