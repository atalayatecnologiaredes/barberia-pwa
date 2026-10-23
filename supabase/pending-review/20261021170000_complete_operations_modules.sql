begin;

alter table public.tenants add column if not exists phone text not null default '';
alter table public.tenants add column if not exists address text not null default '';
alter table public.tenants add column if not exists tax_rate numeric(6,5) not null default 0.15 check (tax_rate between 0 and 0.25);
alter table public.tenants add column if not exists receipt_footer text not null default 'Gracias por tu visita';
grant update (phone,address,tax_rate,receipt_footer) on public.tenants to authenticated;
grant update (name) on public.tenants to authenticated;
drop policy if exists "tenant owners update own tenant" on public.tenants;
create policy "tenant owners update own tenant" on public.tenants for update to authenticated
  using (id = (select p.tenant_id from public.profiles p where p.id = (select auth.uid()) and p.active and p.role = 'SUPER_ADMIN'))
  with check (id = (select p.tenant_id from public.profiles p where p.id = (select auth.uid()) and p.active and p.role = 'SUPER_ADMIN'));

-- Service names are unique inside each shop, not across the whole SaaS.
alter table public.services drop constraint if exists services_name_key;
create unique index if not exists services_tenant_name_lower_key on public.services(tenant_id, lower(name)) where tenant_id is not null;

update public.subscription_plans sp
set capabilities = array(select distinct c from unnest(sp.capabilities || array['catalog']) as c);

create table if not exists public.barber_toolkit_items (
  id uuid primary key default gen_random_uuid(),
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
create unique index if not exists barber_toolkit_items_tenant_serial_key
  on public.barber_toolkit_items(tenant_id, serial_number) where serial_number is not null;
create index if not exists barber_toolkit_items_assigned_idx on public.barber_toolkit_items(tenant_id, barber_id, active);
alter table public.barber_toolkit_items enable row level security;
drop policy if exists "toolkits owner manages" on public.barber_toolkit_items;
create policy "toolkits owner manages" on public.barber_toolkit_items for all to authenticated
  using (exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active and p.role='SUPER_ADMIN' and p.tenant_id=barber_toolkit_items.tenant_id))
  with check (exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active and p.role='SUPER_ADMIN' and p.tenant_id=barber_toolkit_items.tenant_id) and exists(select 1 from public.barbers b where b.id=barber_toolkit_items.barber_id and b.tenant_id=barber_toolkit_items.tenant_id));
drop policy if exists "barber reads assigned toolkit" on public.barber_toolkit_items;
create policy "barber reads assigned toolkit" on public.barber_toolkit_items for select to authenticated
  using (exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active and p.tenant_id=barber_toolkit_items.tenant_id and p.barber_id=barber_toolkit_items.barber_id));
grant select, insert, update, delete on public.barber_toolkit_items to authenticated;

create or replace function public.create_inventory_item(
  p_name text, p_category public.stock_category, p_unit public.stock_unit,
  p_minimum numeric default 0, p_cost numeric default 0, p_retail_price numeric default 0, p_sku text default null
) returns text language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid; v_role public.app_role; v_id text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select tenant_id, role into v_tenant, v_role from public.profiles where id=auth.uid() and active;
  if v_tenant is null or v_role not in ('SUPER_ADMIN','RECEPCION') then raise exception 'Not authorized'; end if;
  if length(trim(coalesce(p_name,''))) not between 1 and 120 or p_minimum < 0 or p_cost < 0 or p_retail_price < 0 then raise exception 'Invalid inventory item'; end if;
  v_id := 'inv_' || replace(gen_random_uuid()::text,'-','');
  insert into public.inventory_items(id,tenant_id,name,category,quantity,unit,minimum_quantity,cost,retail_price,sku)
  values(v_id,v_tenant,trim(p_name),p_category,0,p_unit,p_minimum,p_cost,p_retail_price,nullif(trim(coalesce(p_sku,'')),''));
  return v_id;
end $$;

-- All privileged entry points derive identity and tenant from the authenticated profile.
create or replace function public.adjust_inventory_stock(
  p_item_id text, p_delta numeric, p_movement_type text, p_note text default ''
) returns numeric
language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid; v_role public.app_role; v_item public.inventory_items%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select tenant_id, role into v_tenant, v_role from public.profiles where id = auth.uid() and active;
  if v_tenant is null or v_role not in ('SUPER_ADMIN','RECEPCION') then raise exception 'Not authorized'; end if;
  if p_delta = 0 or p_movement_type not in ('purchase','restock','adjustment') then raise exception 'Invalid stock movement'; end if;
  select * into v_item from public.inventory_items where id = p_item_id and tenant_id = v_tenant and active for update;
  if not found then raise exception 'Inventory item not found'; end if;
  if v_item.quantity + p_delta < 0 then raise exception 'Insufficient stock'; end if;
  update public.inventory_items set quantity = quantity + p_delta where id = p_item_id returning quantity into v_item.quantity;
  insert into public.inventory_movements(inventory_item_id, quantity_delta, unit, movement_type, note, actor_id)
  values (p_item_id, p_delta, v_item.unit, p_movement_type, coalesce(p_note,''), auth.uid());
  return v_item.quantity;
end $$;

create or replace function public.create_restock_request(
  p_item_id text, p_quantity numeric, p_urgency text default 'normal'
) returns text
language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid; v_role public.app_role; v_barber text; v_station text; v_unit public.stock_unit; v_id text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select tenant_id, role, barber_id into v_tenant, v_role, v_barber from public.profiles where id = auth.uid() and active;
  if v_tenant is null or v_role not in ('SUPER_ADMIN','RECEPCION','BARBER') then raise exception 'Not authorized'; end if;
  if p_quantity <= 0 or p_urgency not in ('normal','urgent') then raise exception 'Invalid request'; end if;
  select unit into v_unit from public.inventory_items where id = p_item_id and tenant_id = v_tenant and active;
  if not found then raise exception 'Inventory item not found'; end if;
  select station_id into v_station from public.barbers where id = v_barber and tenant_id = v_tenant;
  insert into public.restock_requests(inventory_item_id, quantity, unit, urgency, station_id, barber_id, requested_by)
  values (p_item_id, p_quantity, v_unit, p_urgency, coalesce(v_station,'warehouse'), v_barber, auth.uid()) returning id into v_id;
  return v_id;
end $$;

create or replace function public.fulfill_restock_request(p_request_id text)
returns text
language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid; v_role public.app_role; v_request public.restock_requests%rowtype; v_item public.inventory_items%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select tenant_id, role into v_tenant, v_role from public.profiles where id = auth.uid() and active;
  if v_tenant is null or v_role not in ('SUPER_ADMIN','RECEPCION') then raise exception 'Not authorized'; end if;
  select r.* into v_request from public.restock_requests r join public.inventory_items i on i.id = r.inventory_item_id
    where r.id = p_request_id and i.tenant_id = v_tenant for update of r;
  if not found or v_request.status <> 'open' then raise exception 'Open request not found'; end if;
  select * into v_item from public.inventory_items where id = v_request.inventory_item_id and tenant_id = v_tenant for update;
  if v_item.quantity < v_request.quantity then raise exception 'Insufficient stock to fulfill request'; end if;
  update public.inventory_items set quantity = quantity - v_request.quantity where id = v_item.id;
  insert into public.inventory_movements(inventory_item_id, quantity_delta, unit, movement_type, note, actor_id)
  values (v_item.id, -v_request.quantity, v_item.unit, 'adjustment', 'Despacho de solicitud ' || v_request.id, auth.uid());
  update public.restock_requests set status = 'fulfilled', fulfilled_by = auth.uid(), fulfilled_at = now() where id = p_request_id;
  return p_request_id;
end $$;

create or replace function public.create_appointment(
  p_client_id text, p_service_id text, p_barber_id text, p_starts_at timestamptz, p_notes text default ''
) returns text
language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid; v_role public.app_role; v_duration integer; v_end timestamptz; v_id text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select tenant_id, role into v_tenant, v_role from public.profiles where id = auth.uid() and active;
  if v_tenant is null or v_role not in ('SUPER_ADMIN','RECEPCION') then raise exception 'Not authorized'; end if;
  if p_starts_at <= now() then raise exception 'Appointment must be in the future'; end if;
  if not exists(select 1 from public.clients where id = p_client_id and tenant_id = v_tenant) then raise exception 'Client not found'; end if;
  select duration_minutes into v_duration from public.services where id = p_service_id and tenant_id = v_tenant and active;
  if not found then raise exception 'Service not found'; end if;
  v_end := p_starts_at + make_interval(mins => v_duration);
  if p_barber_id is not null then
    perform 1 from public.barbers where id = p_barber_id and tenant_id = v_tenant and active for update;
    if not found then raise exception 'Barber not found'; end if;
    if exists(select 1 from public.appointments where tenant_id = v_tenant and barber_id = p_barber_id
      and status in ('confirmed','waiting','in-chair') and starts_at < v_end and coalesce(ends_at, starts_at + interval '2 hours') > p_starts_at) then
      raise exception 'The barber already has an appointment at that time';
    end if;
  end if;
  insert into public.appointments(client_id, service_id, barber_id, starts_at, ends_at, source, notes, created_by, tenant_id)
  values (p_client_id, p_service_id, p_barber_id, p_starts_at, v_end, 'booking', coalesce(p_notes,''), auth.uid(), v_tenant)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.check_in_appointment(p_appointment_id text)
returns text
language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid; v_role public.app_role; v_appt public.appointments%rowtype; v_client public.clients%rowtype; v_service public.services%rowtype; v_station text; v_visit text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select tenant_id, role into v_tenant, v_role from public.profiles where id = auth.uid() and active;
  if v_tenant is null or v_role not in ('SUPER_ADMIN','RECEPCION') then raise exception 'Not authorized'; end if;
  select * into v_appt from public.appointments where id = p_appointment_id and tenant_id = v_tenant for update;
  if not found or v_appt.status <> 'confirmed' then raise exception 'Confirmed appointment not found'; end if;
  select * into v_client from public.clients where id = v_appt.client_id and tenant_id = v_tenant;
  select * into v_service from public.services where id = v_appt.service_id and tenant_id = v_tenant;
  select station_id into v_station from public.barbers where id = v_appt.barber_id and tenant_id = v_tenant;
  v_visit := 'aptq_' || replace(gen_random_uuid()::text,'-','');
  insert into public.queue_visits(id, appointment_id, client_id, guest_name, guest_phone, service_id, barber_id, station_id, channel, status, created_by, tenant_id)
  values (v_visit, v_appt.id, v_client.id, v_client.full_name, v_client.phone, v_service.id, v_appt.barber_id, v_station, 'booking', 'waiting', auth.uid(), v_tenant);
  update public.appointments set status = 'waiting' where id = v_appt.id;
  return v_visit;
end $$;

create or replace function public.cancel_appointment(p_appointment_id text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid; v_role public.app_role; v_updated integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select tenant_id, role into v_tenant, v_role from public.profiles where id=auth.uid() and active;
  if v_tenant is null or v_role not in ('SUPER_ADMIN','RECEPCION') then raise exception 'Not authorized'; end if;
  update public.appointments set status='cancelled'
  where id=p_appointment_id and tenant_id=v_tenant and status='confirmed' and starts_at>now();
  get diagnostics v_updated=row_count;
  if v_updated<>1 then raise exception 'Only a future confirmed appointment can be cancelled'; end if;
end $$;

create or replace function public.client_qr_book_appointment(p_token text,p_service_id text,p_barber_id text,p_starts_at timestamptz,p_notes text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_client public.clients%rowtype; v_service public.services%rowtype; v_barber public.barbers%rowtype; v_end timestamptz; v_id text; v_code text;
begin
  if p_token is null or length(p_token)<>64 or p_token !~ '^[0-9a-f]{64}$' then raise exception 'Invalid member QR'; end if;
  select c.* into v_client from public.client_qr_tokens t join public.clients c on c.id=t.client_id and c.tenant_id=t.tenant_id
  where t.token_hash=extensions.digest(p_token,'sha256') and t.revoked_at is null and t.expires_at>now() for update of c;
  if not found then raise exception 'This member QR is no longer valid'; end if;
  if not exists(select 1 from public.tenants where id=v_client.tenant_id and active) then raise exception 'This barber shop is unavailable'; end if;
  if p_starts_at is null or p_starts_at<=now() then raise exception 'Choose a future appointment time'; end if;
  select * into v_service from public.services where id=p_service_id and tenant_id=v_client.tenant_id and active;
  if not found then raise exception 'Choose an available service'; end if;
  select * into v_barber from public.barbers where id=p_barber_id and tenant_id=v_client.tenant_id and active for update;
  if not found then raise exception 'Choose an available barber'; end if;
  v_end:=p_starts_at+make_interval(mins=>v_service.duration_minutes);
  if exists(select 1 from public.appointments where tenant_id=v_client.tenant_id and barber_id=v_barber.id and status in ('confirmed','waiting','in-chair') and starts_at<v_end and coalesce(ends_at,starts_at+interval '2 hours')>p_starts_at) then raise exception 'The barber is already booked at that time'; end if;
  if exists(select 1 from public.appointments where tenant_id=v_client.tenant_id and client_id=v_client.id and status in ('confirmed','waiting','in-chair') and starts_at<v_end and coalesce(ends_at,starts_at+interval '2 hours')>p_starts_at) then raise exception 'You already have an appointment at that time'; end if;
  insert into public.appointments(client_id,service_id,barber_id,starts_at,ends_at,status,source,notes,tenant_id)
  values(v_client.id,v_service.id,v_barber.id,p_starts_at,v_end,'confirmed','booking',left(coalesce(p_notes,''),500),v_client.tenant_id)
  returning id,confirmation_code into v_id,v_code;
  return jsonb_build_object('id',v_id,'confirmation_code',v_code,'starts_at',p_starts_at,'service',v_service.name,'barber',v_barber.name);
end $$;

create or replace function public.client_qr_list_appointments(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_client public.clients%rowtype; v_result jsonb;
begin
  if p_token is null or length(p_token)<>64 or p_token !~ '^[0-9a-f]{64}$' then return '[]'::jsonb; end if;
  select c.* into v_client from public.client_qr_tokens t join public.clients c on c.id=t.client_id and c.tenant_id=t.tenant_id
  where t.token_hash=extensions.digest(p_token,'sha256') and t.revoked_at is null and t.expires_at>now();
  if not found then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'starts_at',a.starts_at,'ends_at',a.ends_at,'status',a.status,'confirmation_code',a.confirmation_code,'service',s.name,'barber',b.name) order by a.starts_at),'[]'::jsonb)
  into v_result from public.appointments a join public.services s on s.id=a.service_id left join public.barbers b on b.id=a.barber_id
  where a.client_id=v_client.id and a.tenant_id=v_client.tenant_id and a.status='confirmed' and a.starts_at>=now() and a.starts_at<now()+interval '180 days';
  return v_result;
end $$;

create or replace function public.client_qr_cancel_appointment(p_token text,p_appointment_id text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_client_id text; v_tenant_id uuid; v_updated integer;
begin
  if p_token is null or length(p_token)<>64 or p_token !~ '^[0-9a-f]{64}$' then return false; end if;
  select t.client_id,t.tenant_id into v_client_id,v_tenant_id from public.client_qr_tokens t
  where t.token_hash=extensions.digest(p_token,'sha256') and t.revoked_at is null and t.expires_at>now();
  if not found then return false; end if;
  update public.appointments set status='cancelled' where id=p_appointment_id and client_id=v_client_id and tenant_id=v_tenant_id and status='confirmed' and starts_at>now();
  get diagnostics v_updated=row_count;
  return v_updated=1;
end $$;

create or replace function public.create_staff_shift(p_profile_id uuid, p_starts_at timestamptz, p_ends_at timestamptz, p_notes text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid; v_role public.app_role; v_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select tenant_id, role into v_tenant, v_role from public.profiles where id = auth.uid() and active;
  if v_tenant is null or v_role <> 'SUPER_ADMIN' then raise exception 'Not authorized'; end if;
  if p_ends_at <= p_starts_at then raise exception 'Shift end must follow start'; end if;
  if not exists(select 1 from public.profiles where id = p_profile_id and tenant_id = v_tenant and active and role in ('BARBER','RECEPCION')) then raise exception 'Staff profile not found'; end if;
  if exists(select 1 from public.staff_shifts where profile_id = p_profile_id and starts_at < p_ends_at and ends_at > p_starts_at) then raise exception 'Staff member already has a shift at that time'; end if;
  insert into public.staff_shifts(profile_id,starts_at,ends_at,notes) values (p_profile_id,p_starts_at,p_ends_at,coalesce(p_notes,'')) returning id into v_id;
  return v_id;
end $$;

create or replace function public.set_staff_shift_attendance(p_shift_id uuid, p_action text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid; v_role public.app_role; v_shift public.staff_shifts%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select tenant_id, role into v_tenant, v_role from public.profiles where id = auth.uid() and active;
  if v_tenant is null or v_role <> 'SUPER_ADMIN' then raise exception 'Not authorized'; end if;
  select s.* into v_shift from public.staff_shifts s join public.profiles p on p.id=s.profile_id where s.id=p_shift_id and p.tenant_id=v_tenant for update of s;
  if not found then raise exception 'Shift not found'; end if;
  if p_action='check_in' and v_shift.checked_in_at is null then update public.staff_shifts set checked_in_at=now() where id=p_shift_id;
  elsif p_action='check_out' and v_shift.checked_in_at is not null and v_shift.checked_out_at is null then update public.staff_shifts set checked_out_at=now() where id=p_shift_id;
  else raise exception 'Invalid attendance transition'; end if;
end $$;

alter table public.appointments enable row level security;
alter table public.restock_requests enable row level security;
alter table public.inventory_movements enable row level security;
revoke insert on public.appointments from anon,authenticated;
-- Reinforce tenant scope for every tenant-keyed table touched by these screens.
do $$
declare v_table text;
begin
  foreach v_table in array array['barbers','clients','services','inventory_items','appointments','queue_visits','service_orders'] loop
    execute format('drop policy if exists %I on public.%I', 'operations tenant boundary', v_table);
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated using (tenant_id = private.current_tenant_id() or private.is_saas_admin()) with check (tenant_id = private.current_tenant_id() or private.is_saas_admin())',
      'operations tenant boundary', v_table
    );
  end loop;
end $$;
drop policy if exists "restock tenant boundary" on public.restock_requests;
create policy "restock tenant boundary" on public.restock_requests as restrictive for all to authenticated
  using (exists(select 1 from public.inventory_items i where i.id = inventory_item_id and i.tenant_id = (select p.tenant_id from public.profiles p where p.id = (select auth.uid()))))
  with check (exists(select 1 from public.inventory_items i where i.id = inventory_item_id and i.tenant_id = (select p.tenant_id from public.profiles p where p.id = (select auth.uid()))));
drop policy if exists "inventory movement tenant read" on public.inventory_movements;
create policy "inventory movement tenant read" on public.inventory_movements as restrictive for select to authenticated
  using (exists(select 1 from public.inventory_items i where i.id = inventory_item_id and i.tenant_id = (select p.tenant_id from public.profiles p where p.id = (select auth.uid()))));

update public.subscription_plans sp
set capabilities = array(select distinct c from unnest(sp.capabilities || array['appointments']) as c);

revoke all on function public.adjust_inventory_stock(text,numeric,text,text) from public, anon;
revoke all on function public.create_restock_request(text,numeric,text) from public, anon;
revoke all on function public.fulfill_restock_request(text) from public, anon;
revoke all on function public.create_appointment(text,text,text,timestamptz,text) from public, anon;
revoke all on function public.check_in_appointment(text) from public, anon;
revoke all on function public.cancel_appointment(text) from public, anon;
revoke all on function public.create_staff_shift(uuid,timestamptz,timestamptz,text) from public, anon;
revoke all on function public.set_staff_shift_attendance(uuid,text) from public, anon;
revoke all on function public.create_inventory_item(text,public.stock_category,public.stock_unit,numeric,numeric,numeric,text) from public, anon;
revoke all on function public.client_qr_book_appointment(text,text,text,timestamptz,text) from public;
revoke all on function public.client_qr_list_appointments(text) from public;
revoke all on function public.client_qr_cancel_appointment(text,text) from public;
grant execute on function public.adjust_inventory_stock(text,numeric,text,text) to authenticated;
grant execute on function public.create_restock_request(text,numeric,text) to authenticated;
grant execute on function public.fulfill_restock_request(text) to authenticated;
grant execute on function public.create_appointment(text,text,text,timestamptz,text) to authenticated;
grant execute on function public.check_in_appointment(text) to authenticated;
grant execute on function public.cancel_appointment(text) to authenticated;
grant execute on function public.create_staff_shift(uuid,timestamptz,timestamptz,text) to authenticated;
grant execute on function public.set_staff_shift_attendance(uuid,text) to authenticated;
grant execute on function public.create_inventory_item(text,public.stock_category,public.stock_unit,numeric,numeric,numeric,text) to authenticated;
grant execute on function public.client_qr_book_appointment(text,text,text,timestamptz,text) to anon,authenticated;
grant execute on function public.client_qr_list_appointments(text) to anon,authenticated;
grant execute on function public.client_qr_cancel_appointment(text,text) to anon,authenticated;

commit;
