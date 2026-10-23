-- Barber Lounge core schema. New databases are created from this migration.

begin;

create extension if not exists pgcrypto;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

do $$ begin create type public.app_role as enum ('SUPER_ADMIN', 'RECEPCION', 'BARBER', 'CLIENT'); exception when duplicate_object then null; end $$;
do $$ begin create type public.appointment_status as enum ('confirmed', 'waiting', 'in-chair', 'complete', 'cancelled', 'no-show'); exception when duplicate_object then null; end $$;
do $$ begin create type public.queue_status as enum ('waiting', 'called', 'in-chair', 'complete', 'cancelled'); exception when duplicate_object then null; end $$;
do $$ begin create type public.visit_channel as enum ('walk-in', 'booking', 'qr'); exception when duplicate_object then null; end $$;
do $$ begin create type public.order_status as enum ('in-service', 'ready-for-checkout', 'paid', 'cancelled'); exception when duplicate_object then null; end $$;
do $$ begin create type public.stock_category as enum ('Retail', 'Backbar', 'Desechables', 'Textiles', 'Herramientas'); exception when duplicate_object then null; end $$;
do $$ begin create type public.stock_unit as enum ('unit', 'ml', 'g', 'pack'); exception when duplicate_object then null; end $$;
do $$ begin create type public.payment_method as enum ('card', 'cash', 'mobile-transfer', 'loyalty', 'split'); exception when duplicate_object then null; end $$;
do $$ begin create type public.restock_status as enum ('open', 'fulfilled', 'cancelled'); exception when duplicate_object then null; end $$;
do $$ begin create type public.loyalty_entry_type as enum ('earned', 'redeemed', 'adjustment'); exception when duplicate_object then null; end $$;

create or replace function private.is_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role in ('SUPER_ADMIN', 'RECEPCION', 'BARBER')
  );
$$;

create or replace function private.has_role(allowed public.app_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = any(allowed)
  );
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.app_role not null default 'CLIENT',
  full_name text not null,
  email text not null unique,
  phone text,
  avatar_url text,
  barber_id text unique,
  client_id text unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profile_role_link check (
    (role = 'BARBER' and barber_id is not null) or
    (role = 'CLIENT' and client_id is not null) or
    role in ('SUPER_ADMIN', 'RECEPCION')
  )
);
alter table public.profiles add column if not exists tenant_id uuid;
alter table public.profiles add column if not exists tenant_id uuid;

create table public.barbers (
  id text primary key,
  name text not null,
  title text not null,
  station_id text not null unique,
  commission_service numeric(5,4) not null default 0.50 check (commission_service between 0 and 1),
  commission_product numeric(5,4) not null default 0.10 check (commission_product between 0 and 1),
  skills text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.barbers add column if not exists tenant_id uuid;
alter table public.barbers add column if not exists tenant_id uuid;

create table public.clients (
  id text primary key,
  full_name text not null,
  phone text not null,
  email text unique,
  tier text not null default 'Member' check (tier in ('Member', 'Silver', 'Gold', 'Platinum')),
  loyalty_points integer not null default 0 check (loyalty_points >= 0),
  visit_count integer not null default 0 check (visit_count >= 0),
  preferred_barber_id text references public.barbers(id) on delete set null,
  technical_notes text not null default '',
  consent_marketing boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.clients add column if not exists tenant_id uuid;
alter table public.clients add column if not exists tenant_id uuid;

create table public.services (
  id text primary key,
  name text not null unique,
  description text not null default '',
  duration_minutes integer not null check (duration_minutes > 0),
  price numeric(10,2) not null check (price >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.services add column if not exists tenant_id uuid;
alter table public.services add column if not exists tenant_id uuid;

create table public.service_inventory_usage (
  service_id text not null references public.services(id) on delete cascade,
  inventory_item_id text not null,
  quantity numeric(12,3) not null check (quantity > 0),
  unit public.stock_unit not null check (unit in ('ml', 'g', 'unit')),
  primary key (service_id, inventory_item_id)
);

create table public.inventory_items (
  id text primary key,
  name text not null,
  category public.stock_category not null,
  quantity numeric(12,3) not null default 0 check (quantity >= 0),
  unit public.stock_unit not null,
  minimum_quantity numeric(12,3) not null default 0 check (minimum_quantity >= 0),
  cost numeric(10,2) not null default 0 check (cost >= 0),
  retail_price numeric(10,2) not null default 0 check (retail_price >= 0),
  sku text unique,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.inventory_items add column if not exists tenant_id uuid;
alter table public.inventory_items add column if not exists tenant_id uuid;

alter table public.service_inventory_usage
  add constraint service_inventory_usage_item_fk
  foreign key (inventory_item_id) references public.inventory_items(id) on delete restrict;

create table public.appointments (
  id text primary key default ('apt_' || replace(gen_random_uuid()::text, '-', '')),
  client_id text not null references public.clients(id) on delete restrict,
  service_id text not null references public.services(id) on delete restrict,
  barber_id text references public.barbers(id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  status public.appointment_status not null default 'confirmed',
  source public.visit_channel not null default 'booking',
  confirmation_code text unique default upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 10)),
  notes text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);
alter table public.appointments add column if not exists tenant_id uuid;
alter table public.appointments add column if not exists tenant_id uuid;

create index appointments_schedule_idx on public.appointments (starts_at, status);
create index appointments_client_idx on public.appointments (client_id, starts_at desc);

create table public.queue_visits (
  id text primary key,
  appointment_id text unique references public.appointments(id) on delete set null,
  client_id text references public.clients(id) on delete set null,
  guest_name text not null,
  guest_phone text not null default '',
  service_id text not null references public.services(id) on delete restrict,
  barber_id text references public.barbers(id) on delete set null,
  station_id text,
  channel public.visit_channel not null,
  status public.queue_status not null default 'waiting',
  queue_number integer generated always as identity,
  checked_in_at timestamptz not null default now(),
  called_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.queue_visits add column if not exists tenant_id uuid;
alter table public.queue_visits add column if not exists tenant_id uuid;

create index queue_active_idx on public.queue_visits (status, queue_number) where status in ('waiting', 'called', 'in-chair');

create table public.service_orders (
  id text primary key,
  queue_visit_id text references public.queue_visits(id) on delete set null,
  appointment_id text references public.appointments(id) on delete set null,
  client_id text references public.clients(id) on delete set null,
  guest_name text not null,
  guest_phone text not null default '',
  barber_id text not null references public.barbers(id) on delete restrict,
  station_id text not null,
  service_id text not null references public.services(id) on delete restrict,
  service_price numeric(10,2) not null check (service_price >= 0),
  status public.order_status not null default 'in-service',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  paid_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.service_orders add column if not exists tenant_id uuid;
alter table public.service_orders add column if not exists tenant_id uuid;

create index service_orders_status_idx on public.service_orders (status, created_at desc);

create table public.order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id text not null references public.service_orders(id) on delete cascade,
  inventory_item_id text not null references public.inventory_items(id) on delete restrict,
  item_name text not null,
  quantity numeric(12,3) not null check (quantity > 0),
  unit_price numeric(10,2) not null check (unit_price >= 0),
  created_at timestamptz not null default now()
);

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id text not null references public.inventory_items(id) on delete restrict,
  order_id text references public.service_orders(id) on delete set null,
  quantity_delta numeric(12,3) not null check (quantity_delta <> 0),
  unit public.stock_unit not null,
  movement_type text not null check (movement_type in ('purchase', 'service-use', 'retail-sale', 'adjustment', 'restock')),
  note text not null default '',
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id text not null unique references public.service_orders(id) on delete restrict,
  client_id text references public.clients(id) on delete set null,
  subtotal numeric(10,2) not null check (subtotal >= 0),
  tax numeric(10,2) not null default 0 check (tax >= 0),
  tip numeric(10,2) not null default 0 check (tip >= 0),
  total numeric(10,2) not null check (total >= 0),
  method public.payment_method not null,
  completed_at timestamptz not null default now(),
  receipt_code text not null unique default upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 12)),
  created_by uuid references public.profiles(id) on delete set null
);

create table public.payment_splits (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete cascade,
  method public.payment_method not null check (method <> 'split'),
  amount numeric(10,2) not null check (amount > 0),
  reference text,
  created_at timestamptz not null default now()
);

create table public.commissions (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null unique references public.payments(id) on delete cascade,
  order_id text not null references public.service_orders(id) on delete restrict,
  barber_id text not null references public.barbers(id) on delete restrict,
  service_amount numeric(10,2) not null check (service_amount >= 0),
  product_amount numeric(10,2) not null check (product_amount >= 0),
  total numeric(10,2) generated always as (service_amount + product_amount) stored,
  created_at timestamptz not null default now()
);

create table public.restock_requests (
  id text primary key default ('restock_' || replace(gen_random_uuid()::text, '-', '')),
  inventory_item_id text not null references public.inventory_items(id) on delete restrict,
  quantity numeric(12,3) not null check (quantity > 0),
  unit public.stock_unit not null,
  urgency text not null default 'normal' check (urgency in ('normal', 'urgent')),
  station_id text not null,
  barber_id text references public.barbers(id) on delete set null,
  status public.restock_status not null default 'open',
  requested_by uuid references public.profiles(id) on delete set null,
  fulfilled_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  fulfilled_at timestamptz
);

create table public.loyalty_ledger (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references public.clients(id) on delete cascade,
  payment_id uuid references public.payments(id) on delete set null,
  points integer not null check (points <> 0),
  entry_type public.loyalty_entry_type not null,
  description text not null default '',
  created_at timestamptz not null default now()
);

create table public.staff_shifts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  checked_in_at timestamptz,
  checked_out_at timestamptz,
  notes text not null default '',
  check (ends_at > starts_at)
);

create table public.client_look_photos (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references public.clients(id) on delete cascade,
  storage_path text not null unique,
  caption text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
drop trigger if exists clients_updated_at on public.clients;
create trigger clients_updated_at before update on public.clients for each row execute function public.set_updated_at();
drop trigger if exists inventory_items_updated_at on public.inventory_items;
create trigger inventory_items_updated_at before update on public.inventory_items for each row execute function public.set_updated_at();
drop trigger if exists appointments_updated_at on public.appointments;
create trigger appointments_updated_at before update on public.appointments for each row execute function public.set_updated_at();
drop trigger if exists service_orders_updated_at on public.service_orders;
create trigger service_orders_updated_at before update on public.service_orders for each row execute function public.set_updated_at();

-- Service usage is recorded once per order; row locks prevent negative stock.
create or replace function public.finish_service(p_order_id text, p_actor uuid default auth.uid())
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_order public.service_orders%rowtype;
  v_usage record;
begin
  if not private.has_role(array['SUPER_ADMIN', 'BARBER']::public.app_role[]) then
    raise exception 'Not authorized to complete service';
  end if;
  select * into v_order from public.service_orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_order.status in ('ready-for-checkout', 'paid') then return; end if;
  for v_usage in
    select su.inventory_item_id, su.quantity, su.unit
    from public.service_inventory_usage su where su.service_id = v_order.service_id
  loop
    update public.inventory_items
      set quantity = quantity - v_usage.quantity
      where id = v_usage.inventory_item_id and quantity >= v_usage.quantity;
    if not found then raise exception 'Insufficient stock for item %', v_usage.inventory_item_id; end if;
    insert into public.inventory_movements(inventory_item_id, order_id, quantity_delta, unit, movement_type, note, actor_id)
    values (v_usage.inventory_item_id, v_order.id, -v_usage.quantity, v_usage.unit, 'service-use', 'Consumo automático por servicio', p_actor);
  end loop;
  update public.service_orders set status = 'ready-for-checkout', ended_at = now() where id = p_order_id;
  if v_order.queue_visit_id is not null then
    update public.queue_visits set status = 'complete', completed_at = now() where id = v_order.queue_visit_id;
  end if;
end;
$$;

-- Atomic checkout: persists payment/splits, decrements retail stock and records commission.
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
  v_product_total numeric(10,2) := 0;
  v_service_commission numeric(10,2);
  v_product_commission numeric(10,2);
begin
  if not private.has_role(array['SUPER_ADMIN', 'RECEPCION']::public.app_role[]) then
    raise exception 'Not authorized to complete checkout';
  end if;
  select * into v_order from public.service_orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_order.status = 'paid' then
    select id into v_payment_id from public.payments where order_id = p_order_id;
    return v_payment_id;
  end if;
  if v_order.status <> 'ready-for-checkout' then raise exception 'Service must be finished before checkout'; end if;
  if round(p_subtotal + p_tax + p_tip, 2) <> round(p_total, 2) then raise exception 'Payment totals do not match'; end if;

  for v_line in select * from public.order_lines where order_id = p_order_id for update loop
    update public.inventory_items
      set quantity = quantity - v_line.quantity
      where id = v_line.inventory_item_id and quantity >= v_line.quantity;
    if not found then raise exception 'Insufficient stock for product %', v_line.inventory_item_id; end if;
    v_product_total := v_product_total + v_line.quantity * v_line.unit_price;
    insert into public.inventory_movements(inventory_item_id, order_id, quantity_delta, unit, movement_type, note, actor_id)
    select v_line.inventory_item_id, p_order_id, -v_line.quantity, i.unit, 'retail-sale', 'Venta POS', p_actor
    from public.inventory_items i where i.id = v_line.inventory_item_id;
  end loop;

  insert into public.payments(order_id, client_id, subtotal, tax, tip, total, method, created_by)
  values (p_order_id, v_order.client_id, p_subtotal, p_tax, p_tip, p_total, p_method, p_actor)
  returning id into v_payment_id;

  if p_method = 'split' then
    if jsonb_typeof(p_splits) <> 'array' or jsonb_array_length(p_splits) = 0 then raise exception 'Split payment requires payment parts'; end if;
    for v_split in select value from jsonb_array_elements(p_splits) loop
      insert into public.payment_splits(payment_id, method, amount, reference)
      values (v_payment_id, (v_split ->> 'method')::public.payment_method, (v_split ->> 'amount')::numeric, v_split ->> 'reference');
    end loop;
    if (select round(coalesce(sum(amount), 0), 2) from public.payment_splits where payment_id = v_payment_id) <> round(p_total, 2) then
      raise exception 'Split amounts must equal total';
    end if;
  end if;

  select round(v_order.service_price * b.commission_service, 2), round(v_product_total * b.commission_product, 2)
  into v_service_commission, v_product_commission
  from public.barbers b where b.id = v_order.barber_id;
  insert into public.commissions(payment_id, order_id, barber_id, service_amount, product_amount)
  values (v_payment_id, p_order_id, v_order.barber_id, coalesce(v_service_commission, 0), coalesce(v_product_commission, 0));

  update public.service_orders set status = 'paid', paid_at = now() where id = p_order_id;
  if v_order.client_id is not null then
    update public.clients set visit_count = visit_count + 1, loyalty_points = loyalty_points + floor(p_total)::integer where id = v_order.client_id;
    insert into public.loyalty_ledger(client_id, payment_id, points, entry_type, description)
    values (v_order.client_id, v_payment_id, floor(p_total)::integer, 'earned', 'Puntos por compra');
  end if;
  return v_payment_id;
end;
$$;

-- Profile creation is public; role assignment remains owner-only.
alter table public.profiles enable row level security;
alter table public.barbers enable row level security;
alter table public.clients enable row level security;
alter table public.services enable row level security;
alter table public.service_inventory_usage enable row level security;
alter table public.inventory_items enable row level security;
alter table public.appointments enable row level security;
alter table public.queue_visits enable row level security;
alter table public.service_orders enable row level security;
alter table public.order_lines enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.payments enable row level security;
alter table public.payment_splits enable row level security;
alter table public.commissions enable row level security;
alter table public.restock_requests enable row level security;
alter table public.loyalty_ledger enable row level security;
alter table public.staff_shifts enable row level security;
alter table public.client_look_photos enable row level security;


grant usage on schema public to authenticated;
grant usage on schema private to authenticated;
grant execute on function private.is_staff() to authenticated;
grant execute on function private.has_role(public.app_role[]) to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on function public.finish_service(text, uuid) to authenticated;
grant execute on function public.complete_checkout(text, numeric, numeric, numeric, numeric, public.payment_method, jsonb, uuid) to authenticated;

do $$
declare
  v_table text;
  v_policy record;
begin
  foreach v_table in array array[
    'profiles', 'barbers', 'clients', 'services', 'service_inventory_usage',
    'inventory_items', 'appointments', 'queue_visits', 'service_orders',
    'order_lines', 'inventory_movements', 'payments', 'payment_splits',
    'commissions', 'restock_requests', 'loyalty_ledger', 'staff_shifts',
    'client_look_photos'
  ] loop
    execute format('alter table public.%I enable row level security', v_table);
    for v_policy in
      select policyname
      from pg_policies
      where schemaname = 'public' and tablename = v_table
    loop
      execute format('drop policy %I on public.%I', v_policy.policyname, v_table);
    end loop;
  end loop;
end;
$$;

create policy "profiles read self or staff" on public.profiles for select to authenticated using (id = (select auth.uid()) or private.is_staff());
create policy "owner manages profiles" on public.profiles for all to authenticated using (private.has_role(array['SUPER_ADMIN']::public.app_role[])) with check (private.has_role(array['SUPER_ADMIN']::public.app_role[]));
create policy "catalog visible to signed-in users" on public.barbers for select to authenticated using (true);
create policy "owner manages barbers" on public.barbers for all to authenticated using (private.has_role(array['SUPER_ADMIN']::public.app_role[])) with check (private.has_role(array['SUPER_ADMIN']::public.app_role[]));
create policy "clients self or staff read" on public.clients for select to authenticated using (private.is_staff() or id = (select p.client_id from public.profiles p where p.id = (select auth.uid())));
create policy "staff manages clients" on public.clients for all to authenticated using (private.is_staff()) with check (private.is_staff());
create policy "services visible to signed-in users" on public.services for select to authenticated using (true);
create policy "owner manages services" on public.services for all to authenticated using (private.has_role(array['SUPER_ADMIN']::public.app_role[])) with check (private.has_role(array['SUPER_ADMIN']::public.app_role[]));
create policy "service recipe staff only" on public.service_inventory_usage for all to authenticated using (private.is_staff()) with check (private.is_staff());
create policy "inventory staff only" on public.inventory_items for all to authenticated using (private.is_staff()) with check (private.is_staff());
create policy "appointments visible by owner or staff" on public.appointments for select to authenticated using (private.is_staff() or client_id = (select p.client_id from public.profiles p where p.id = (select auth.uid())));
create policy "clients create own appointments" on public.appointments for insert to authenticated with check (client_id = (select p.client_id from public.profiles p where p.id = (select auth.uid())) or private.is_staff());
create policy "staff updates appointments" on public.appointments for update to authenticated using (private.is_staff()) with check (private.is_staff());
create policy "queue visible to staff and own client" on public.queue_visits for select to authenticated using (private.is_staff() or client_id = (select p.client_id from public.profiles p where p.id = (select auth.uid())));
create policy "staff manages queue" on public.queue_visits for all to authenticated using (private.is_staff()) with check (private.is_staff());
create policy "orders visible to staff or own client" on public.service_orders for select to authenticated using (private.is_staff() or client_id = (select p.client_id from public.profiles p where p.id = (select auth.uid())));
create policy "barber creates own orders" on public.service_orders for insert to authenticated with check (private.has_role(array['SUPER_ADMIN', 'BARBER']::public.app_role[]) and (private.has_role(array['SUPER_ADMIN']::public.app_role[]) or barber_id = (select p.barber_id from public.profiles p where p.id = (select auth.uid()))));
create policy "reception starts service orders" on public.service_orders for insert to authenticated with check (private.has_role(array['SUPER_ADMIN', 'RECEPCION']::public.app_role[]));
create policy "staff updates orders" on public.service_orders for update to authenticated using (private.is_staff()) with check (private.is_staff());
create policy "order lines visible to staff or order client" on public.order_lines for select to authenticated using (private.is_staff() or exists (select 1 from public.service_orders o where o.id = order_id and o.client_id = (select p.client_id from public.profiles p where p.id = (select auth.uid()))));
create policy "staff manages order lines" on public.order_lines for all to authenticated using (private.is_staff()) with check (private.is_staff());
create policy "inventory movement staff only" on public.inventory_movements for select to authenticated using (private.is_staff());
create policy "payment visible to staff or own client" on public.payments for select to authenticated using (private.is_staff() or client_id = (select p.client_id from public.profiles p where p.id = (select auth.uid())));
create policy "payment splits staff only" on public.payment_splits for select to authenticated using (private.is_staff());
create policy "commission owner or barber" on public.commissions for select to authenticated using (private.has_role(array['SUPER_ADMIN']::public.app_role[]) or barber_id = (select p.barber_id from public.profiles p where p.id = (select auth.uid())));
create policy "restock staff only" on public.restock_requests for all to authenticated using (private.is_staff()) with check (private.is_staff());
create policy "loyalty self or staff" on public.loyalty_ledger for select to authenticated using (private.is_staff() or client_id = (select p.client_id from public.profiles p where p.id = (select auth.uid())));
create policy "staff shift owner or self" on public.staff_shifts for select to authenticated using (private.has_role(array['SUPER_ADMIN']::public.app_role[]) or profile_id = (select auth.uid()));
create policy "owner manages shifts" on public.staff_shifts for all to authenticated using (private.has_role(array['SUPER_ADMIN']::public.app_role[])) with check (private.has_role(array['SUPER_ADMIN']::public.app_role[]));
create policy "client photos self or staff" on public.client_look_photos for select to authenticated using (private.is_staff() or client_id = (select p.client_id from public.profiles p where p.id = (select auth.uid())));
create policy "staff manages client photos" on public.client_look_photos for all to authenticated using (private.is_staff()) with check (private.is_staff());

commit;
