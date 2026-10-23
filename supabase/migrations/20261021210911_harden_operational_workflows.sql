begin;

-- All operational writes go through tenant-scoped, atomic RPCs.
create or replace function public.create_appointment(
  p_client_id text, p_service_id text, p_barber_id text, p_starts_at timestamptz, p_notes text default ''
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid; v_role public.app_role; v_duration integer; v_end timestamptz; v_id text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select p.tenant_id,p.role into v_tenant,v_role from public.profiles p where p.id=auth.uid() and p.active;
  if not found or v_tenant is null or v_role not in ('SUPER_ADMIN','RECEPCION') then raise exception 'Not authorized' using errcode='42501'; end if;
  if p_starts_at is null or p_starts_at <= now() then raise exception 'Appointment must be in the future'; end if;
  if length(coalesce(p_notes,'')) > 500 then raise exception 'Notes are too long'; end if;
  perform 1 from public.clients c where c.id=p_client_id and c.tenant_id=v_tenant for update;
  if not found then raise exception 'Client not found in this shop'; end if;
  select s.duration_minutes into v_duration from public.services s where s.id=p_service_id and s.tenant_id=v_tenant and s.active for share;
  if not found then raise exception 'Active service not found in this shop'; end if;
  v_end := p_starts_at + make_interval(mins => v_duration);
  if p_barber_id is not null then
    perform 1 from public.barbers b where b.id=p_barber_id and b.tenant_id=v_tenant and b.active for update;
    if not found then raise exception 'Active barber not found in this shop'; end if;
    if exists(select 1 from public.appointments a where a.tenant_id=v_tenant and a.barber_id=p_barber_id
      and a.status in ('confirmed','waiting','in-chair') and a.starts_at<v_end and coalesce(a.ends_at,a.starts_at+interval '2 hours')>p_starts_at) then
      raise exception 'The barber already has an appointment at that time';
    end if;
  end if;
  if exists(select 1 from public.appointments a where a.tenant_id=v_tenant and a.client_id=p_client_id
    and a.status in ('confirmed','waiting','in-chair') and a.starts_at<v_end and coalesce(a.ends_at,a.starts_at+interval '2 hours')>p_starts_at) then
    raise exception 'The client already has an appointment at that time';
  end if;
  insert into public.appointments(client_id,service_id,barber_id,starts_at,ends_at,source,notes,created_by,tenant_id)
  values(p_client_id,p_service_id,p_barber_id,p_starts_at,v_end,'booking',coalesce(p_notes,''),auth.uid(),v_tenant) returning id into v_id;
  return v_id;
end $$;

create or replace function public.check_in_appointment(p_appointment_id text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid; v_role public.app_role; v_appt public.appointments%rowtype; v_client public.clients%rowtype; v_visit text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select p.tenant_id,p.role into v_tenant,v_role from public.profiles p where p.id=auth.uid() and p.active;
  if not found or v_tenant is null or v_role not in ('SUPER_ADMIN','RECEPCION') then raise exception 'Not authorized' using errcode='42501'; end if;
  select a.* into v_appt from public.appointments a where a.id=p_appointment_id and a.tenant_id=v_tenant for update;
  if not found or v_appt.status<>'confirmed' then raise exception 'Confirmed appointment not found'; end if;
  select c.* into v_client from public.clients c where c.id=v_appt.client_id and c.tenant_id=v_tenant;
  if not found then raise exception 'Appointment client is no longer available'; end if;
  v_visit := 'aptq_' || replace(gen_random_uuid()::text,'-','');
  insert into public.queue_visits(id,appointment_id,client_id,guest_name,guest_phone,service_id,barber_id,station_id,channel,status,created_by,tenant_id)
  select v_visit,v_appt.id,v_client.id,v_client.full_name,v_client.phone,s.id,v_appt.barber_id,b.station_id,'booking','waiting',auth.uid(),v_tenant
  from public.services s left join public.barbers b on b.id=v_appt.barber_id and b.tenant_id=v_tenant
  where s.id=v_appt.service_id and s.tenant_id=v_tenant;
  if not found then raise exception 'Appointment service is unavailable'; end if;
  update public.appointments set status='waiting',updated_at=now() where id=v_appt.id and tenant_id=v_tenant;
  return v_visit;
end $$;

create or replace function public.cancel_appointment(p_appointment_id text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid; v_role public.app_role; v_rows integer;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select p.tenant_id,p.role into v_tenant,v_role from public.profiles p where p.id=auth.uid() and p.active;
  if not found or v_tenant is null or v_role not in ('SUPER_ADMIN','RECEPCION') then raise exception 'Not authorized' using errcode='42501'; end if;
  update public.appointments set status='cancelled',updated_at=now() where id=p_appointment_id and tenant_id=v_tenant and status='confirmed' and starts_at>now();
  get diagnostics v_rows=row_count;
  if v_rows<>1 then raise exception 'Only a future confirmed appointment can be cancelled'; end if;
end $$;

create or replace function public.create_walk_in(p_guest_name text,p_guest_phone text,p_service_id text,p_barber_id text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid; v_role public.app_role; v_id text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select p.tenant_id,p.role into v_tenant,v_role from public.profiles p where p.id=auth.uid() and p.active;
  if not found or v_tenant is null or v_role not in ('SUPER_ADMIN','RECEPCION') then raise exception 'Not authorized' using errcode='42501'; end if;
  if length(trim(coalesce(p_guest_name,''))) not between 1 and 100 or length(coalesce(p_guest_phone,''))>30 then raise exception 'Invalid guest details'; end if;
  if not exists(select 1 from public.services s where s.id=p_service_id and s.tenant_id=v_tenant and s.active) then raise exception 'Active service not found'; end if;
  if p_barber_id is not null and not exists(select 1 from public.barbers b where b.id=p_barber_id and b.tenant_id=v_tenant and b.active) then raise exception 'Active barber not found'; end if;
  v_id := 'walk_' || replace(gen_random_uuid()::text,'-','');
  insert into public.queue_visits(id,guest_name,guest_phone,service_id,barber_id,station_id,channel,status,created_by,tenant_id)
  select v_id,trim(p_guest_name),trim(coalesce(p_guest_phone,'')),s.id,b.id,b.station_id,'walk-in','waiting',auth.uid(),v_tenant
  from public.services s left join public.barbers b on b.id=p_barber_id and b.tenant_id=v_tenant
  where s.id=p_service_id and s.tenant_id=v_tenant;
  return v_id;
end $$;

create or replace function public.transition_queue_visit(p_visit_id text,p_status public.queue_status)
returns void language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid; v_role public.app_role; v_visit public.queue_visits%rowtype; v_service public.services%rowtype; v_barber public.barbers%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select p.tenant_id,p.role into v_tenant,v_role from public.profiles p where p.id=auth.uid() and p.active;
  if not found or v_tenant is null or v_role not in ('SUPER_ADMIN','RECEPCION') then raise exception 'Not authorized' using errcode='42501'; end if;
  select q.* into v_visit from public.queue_visits q where q.id=p_visit_id and q.tenant_id=v_tenant for update;
  if not found then raise exception 'Queue visit not found in this shop'; end if;
  if p_status='called' and v_visit.status='waiting' then
    update public.queue_visits set status='called',called_at=now() where id=v_visit.id and tenant_id=v_tenant;
  elsif p_status='in-chair' and v_visit.status='called' then
    if v_visit.barber_id is null then raise exception 'Assign a barber before starting service'; end if;
    select s.* into v_service from public.services s where s.id=v_visit.service_id and s.tenant_id=v_tenant and s.active;
    if not found then raise exception 'Active service not found'; end if;
    select b.* into v_barber from public.barbers b where b.id=v_visit.barber_id and b.tenant_id=v_tenant and b.active for update;
    if not found then raise exception 'Active barber not found'; end if;
    if exists(select 1 from public.service_orders o where o.queue_visit_id=v_visit.id and o.tenant_id=v_tenant) then raise exception 'Service order already exists'; end if;
    insert into public.service_orders(id,queue_visit_id,appointment_id,client_id,guest_name,guest_phone,barber_id,station_id,service_id,service_price,status,started_at,created_by,tenant_id)
    values('ord_'||replace(gen_random_uuid()::text,'-',''),v_visit.id,v_visit.appointment_id,v_visit.client_id,v_visit.guest_name,v_visit.guest_phone,v_barber.id,coalesce(v_visit.station_id,v_barber.station_id),v_service.id,v_service.price,'in-service',now(),auth.uid(),v_tenant);
    update public.queue_visits set status='in-chair',started_at=now(),station_id=coalesce(station_id,v_barber.station_id) where id=v_visit.id and tenant_id=v_tenant;
    if v_visit.appointment_id is not null then update public.appointments set status='in-chair',updated_at=now() where id=v_visit.appointment_id and tenant_id=v_tenant; end if;
  elsif p_status='cancelled' and v_visit.status in ('waiting','called','in-chair') then
    update public.service_orders set status='cancelled',ended_at=now(),updated_at=now() where queue_visit_id=v_visit.id and tenant_id=v_tenant and status='in-service';
    update public.queue_visits set status='cancelled',completed_at=now() where id=v_visit.id and tenant_id=v_tenant;
    if v_visit.appointment_id is not null then update public.appointments set status='cancelled',updated_at=now() where id=v_visit.appointment_id and tenant_id=v_tenant and status in ('waiting','in-chair'); end if;
  else
    raise exception 'Invalid queue status transition from % to %',v_visit.status,p_status using errcode='22023';
  end if;
end $$;

create or replace function public.set_checkout_product_quantity(p_order_id text,p_item_id text,p_quantity numeric)
returns void language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid; v_role public.app_role; v_order public.service_orders%rowtype; v_item public.inventory_items%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select p.tenant_id,p.role into v_tenant,v_role from public.profiles p where p.id=auth.uid() and p.active;
  if not found or v_tenant is null or v_role not in ('SUPER_ADMIN','RECEPCION') then raise exception 'Not authorized' using errcode='42501'; end if;
  if p_quantity is null or p_quantity<0 or p_quantity::text in ('NaN','Infinity','-Infinity') or p_quantity>10000 then raise exception 'Invalid product quantity'; end if;
  select o.* into v_order from public.service_orders o where o.id=p_order_id and o.tenant_id=v_tenant for update;
  if not found or v_order.status<>'ready-for-checkout' then raise exception 'Order is not available for checkout'; end if;
  select i.* into v_item from public.inventory_items i where i.id=p_item_id and i.tenant_id=v_tenant and i.active and i.category='Retail' for update;
  if not found then raise exception 'Active retail product not found'; end if;
  if p_quantity=0 then delete from public.order_lines where order_id=v_order.id and inventory_item_id=v_item.id; return; end if;
  if p_quantity>v_item.quantity then raise exception 'Insufficient stock: % available',v_item.quantity using errcode='22023'; end if;
  insert into public.order_lines(order_id,inventory_item_id,item_name,quantity,unit_price)
  values(v_order.id,v_item.id,v_item.name,p_quantity,v_item.retail_price)
  on conflict (order_id,inventory_item_id) do update set quantity=excluded.quantity,item_name=excluded.item_name,unit_price=excluded.unit_price;
end $$;

-- A uniqueness constraint makes the upsert above deterministic.
create unique index if not exists order_lines_order_item_key on public.order_lines(order_id,inventory_item_id);

-- A catalog price may change after the order is created. The order's DB-created
-- snapshot is authoritative; do not retroactively reprice an active checkout.
create or replace function public.complete_checkout(
  p_order_id text,p_subtotal numeric,p_tax numeric,p_tip numeric,p_total numeric,
  p_method public.payment_method,p_splits jsonb default '[]'::jsonb,p_actor uuid default auth.uid()
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_actor_id uuid := (select auth.uid()); v_tenant_id uuid; v_role public.app_role; v_order public.service_orders%rowtype;
  v_payment_id uuid; v_line record; v_split jsonb; v_subtotal numeric(10,2); v_tax numeric(10,2); v_tip numeric(10,2); v_total numeric(10,2);
  v_tax_rate numeric(6,5); v_product_total numeric(10,2):=0; v_service_commission numeric(10,2); v_product_commission numeric(10,2);
begin
  if v_actor_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select p.tenant_id,p.role into v_tenant_id,v_role from public.profiles p where p.id=v_actor_id and p.active;
  if not found or v_role not in ('SUPER_ADMIN','RECEPCION') then raise exception 'Not authorized to complete checkout' using errcode='42501'; end if;
  if v_tenant_id is null then raise exception 'User is not assigned to a barber shop' using errcode='42501'; end if;
  select t.tax_rate into v_tax_rate from public.tenants t where t.id=v_tenant_id and t.active;
  if v_tax_rate is null then raise exception 'Shop tax settings are unavailable' using errcode='42501'; end if;
  if not exists(select 1 from public.tenants t join public.saas_subscriptions s on s.tenant_id=t.id where t.id=v_tenant_id and t.active and s.status in ('active','trialing') and (s.current_period_end is null or s.current_period_end>now())) then raise exception 'Barber shop subscription is inactive or expired' using errcode='42501'; end if;
  select o.* into v_order from public.service_orders o where o.id=p_order_id and o.tenant_id=v_tenant_id for update;
  if not found then raise exception 'Order not found in your barber shop' using errcode='P0002'; end if;
  if v_order.status='paid' then select p.id into v_payment_id from public.payments p where p.order_id=v_order.id; return v_payment_id; end if;
  if v_order.status<>'ready-for-checkout' then raise exception 'Service must be finished before checkout' using errcode='22023'; end if;
  if p_method='loyalty' or p_method is null then raise exception 'Invalid payment method' using errcode='22023'; end if;
  if not exists(select 1 from public.services s where s.id=v_order.service_id and s.tenant_id=v_tenant_id) then raise exception 'Service belongs to another shop or is unavailable' using errcode='42501'; end if;
  for v_line in select ol.id,ol.inventory_item_id,ol.item_name,ol.quantity,ol.unit_price,i.quantity as stock_quantity,i.unit,i.tenant_id as item_tenant_id,i.active,i.category from public.order_lines ol join public.inventory_items i on i.id=ol.inventory_item_id where ol.order_id=v_order.id order by ol.inventory_item_id for update of ol,i loop
    if v_line.item_tenant_id is distinct from v_tenant_id then raise exception 'Product belongs to another barber shop' using errcode='42501'; end if;
    if not v_line.active or v_line.category<>'Retail' then raise exception 'Product is not available for retail sale' using errcode='22023'; end if;
    if v_line.quantity<=0 or v_line.unit_price<0 then raise exception 'Product price or quantity is invalid' using errcode='22023'; end if;
    v_product_total:=v_product_total+(v_line.quantity*v_line.unit_price);
  end loop;
  v_subtotal:=round(v_order.service_price+v_product_total,2);
  if p_tip is null or p_tip<0 or p_tip::text in ('NaN','Infinity','-Infinity') then raise exception 'Tip must be zero or greater' using errcode='22023'; end if;
  v_tip:=round(p_tip,2); if p_tip<>v_tip then raise exception 'Tip must use at most two decimal places' using errcode='22023'; end if;
  v_tax:=round(v_subtotal*v_tax_rate,2); v_total:=round(v_subtotal+v_tax+v_tip,2);
  if p_subtotal is null or p_subtotal<>v_subtotal or p_tax is null or p_tax<>v_tax or p_total is null or p_total<>v_total then raise exception 'Payment totals do not match the order and shop tax settings' using errcode='22023'; end if;
  if p_method='split' then
    if jsonb_typeof(p_splits)<>'array' or jsonb_array_length(p_splits)=0 then raise exception 'Split payment requires payment parts' using errcode='22023'; end if;
    if exists(select 1 from jsonb_array_elements(p_splits) s(value) where coalesce(s.value->>'method','') not in ('cash','card','mobile-transfer') or coalesce((s.value->>'amount')::numeric,0)<=0) then raise exception 'Invalid split payment part' using errcode='22023'; end if;
    if round((select coalesce(sum((s.value->>'amount')::numeric),0) from jsonb_array_elements(p_splits) s(value)),2)<>v_total then raise exception 'Split amounts must equal total' using errcode='22023'; end if;
  elsif p_method not in ('cash','card','mobile-transfer') then raise exception 'Invalid payment method' using errcode='22023'; end if;
  insert into public.payments(order_id,client_id,subtotal,tax,tip,total,method,created_by) values(v_order.id,v_order.client_id,v_subtotal,v_tax,v_tip,v_total,p_method,v_actor_id) returning id into v_payment_id;
  if p_method='split' then
    for v_split in select value from jsonb_array_elements(p_splits) loop
      insert into public.payment_splits(payment_id,method,amount,reference) values(v_payment_id,(v_split->>'method')::public.payment_method,(v_split->>'amount')::numeric,nullif(v_split->>'reference',''));
    end loop;
  end if;
  for v_line in select ol.inventory_item_id,ol.quantity from public.order_lines ol where ol.order_id=v_order.id order by ol.inventory_item_id for update loop
    update public.inventory_items i set quantity=i.quantity-v_line.quantity,updated_at=now() where i.id=v_line.inventory_item_id and i.tenant_id=v_tenant_id and i.active and i.category='Retail' and i.quantity>=v_line.quantity;
    if not found then raise exception 'Insufficient stock for product %',v_line.inventory_item_id using errcode='22023'; end if;
    insert into public.inventory_movements(inventory_item_id,order_id,quantity_delta,unit,movement_type,note,actor_id) select i.id,v_order.id,-v_line.quantity,i.unit,'retail-sale','Venta POS',v_actor_id from public.inventory_items i where i.id=v_line.inventory_item_id and i.tenant_id=v_tenant_id;
  end loop;
  select round(v_order.service_price*b.commission_service,2),round(v_product_total*b.commission_product,2) into v_service_commission,v_product_commission from public.barbers b where b.id=v_order.barber_id and b.tenant_id=v_tenant_id;
  insert into public.commissions(payment_id,order_id,barber_id,service_amount,product_amount) values(v_payment_id,v_order.id,v_order.barber_id,coalesce(v_service_commission,0),coalesce(v_product_commission,0));
  update public.service_orders set status='paid',paid_at=now(),updated_at=now() where id=v_order.id and tenant_id=v_tenant_id;
  if v_order.client_id is not null then
    update public.clients c set visit_count=c.visit_count+1,loyalty_points=c.loyalty_points+floor(v_total)::integer where c.id=v_order.client_id and c.tenant_id=v_tenant_id;
    if found then insert into public.loyalty_ledger(client_id,payment_id,points,entry_type,description) values(v_order.client_id,v_payment_id,floor(v_total)::integer,'earned','Puntos por compra'); end if;
  end if;
  return v_payment_id;
end $$;

-- Browser sessions may read operational data, but may not bypass the RPCs.
drop policy if exists "clients create own appointments" on public.appointments;
drop policy if exists "staff updates appointments" on public.appointments;
drop policy if exists "staff manages queue" on public.queue_visits;
drop policy if exists "barber creates own orders" on public.service_orders;
drop policy if exists "reception starts service orders" on public.service_orders;
drop policy if exists "staff updates orders" on public.service_orders;
drop policy if exists "staff manages order lines" on public.order_lines;
revoke insert,update,delete on public.appointments,public.queue_visits,public.service_orders,public.order_lines from authenticated;
grant select on public.appointments,public.queue_visits,public.service_orders,public.order_lines to authenticated;

revoke all on function public.create_appointment(text,text,text,timestamptz,text) from public,anon;
revoke all on function public.check_in_appointment(text) from public,anon;
revoke all on function public.cancel_appointment(text) from public,anon;
revoke all on function public.create_walk_in(text,text,text,text) from public,anon;
revoke all on function public.transition_queue_visit(text,public.queue_status) from public,anon;
revoke all on function public.set_checkout_product_quantity(text,text,numeric) from public,anon;
revoke all on function public.complete_checkout(text,numeric,numeric,numeric,numeric,public.payment_method,jsonb,uuid) from public,anon;
grant execute on function public.create_appointment(text,text,text,timestamptz,text) to authenticated;
grant execute on function public.check_in_appointment(text) to authenticated;
grant execute on function public.cancel_appointment(text) to authenticated;
grant execute on function public.create_walk_in(text,text,text,text) to authenticated;
grant execute on function public.transition_queue_visit(text,public.queue_status) to authenticated;
grant execute on function public.set_checkout_product_quantity(text,text,numeric) to authenticated;
grant execute on function public.complete_checkout(text,numeric,numeric,numeric,numeric,public.payment_method,jsonb,uuid) to authenticated;

do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='appointments') then alter publication supabase_realtime add table public.appointments; end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='queue_visits') then alter publication supabase_realtime add table public.queue_visits; end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='service_orders') then alter publication supabase_realtime add table public.service_orders; end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='order_lines') then alter publication supabase_realtime add table public.order_lines; end if;
end $$;

commit;
