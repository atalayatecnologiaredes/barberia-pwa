begin;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null check (event_type in (
    'appointment_booked', 'appointment_cancelled', 'checkout_ready',
    'queue_visit_created', 'restock_requested', 'shift_created',
    'shift_updated', 'shift_cancelled', 'stock_low'
  )),
  title text not null check (length(title) between 1 and 120),
  message text not null check (length(message) <= 500),
  action_path text,
  entity_id text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists notifications_recipient_created_idx
  on public.notifications (recipient_id, created_at desc);

alter table public.notifications enable row level security;
revoke all on public.notifications from public, anon, authenticated;
grant select, update (read_at) on public.notifications to authenticated;

drop policy if exists "users read own notifications" on public.notifications;
create policy "users read own notifications"
  on public.notifications for select to authenticated
  using (
    recipient_id = (select auth.uid())
    and tenant_id = (select p.tenant_id from public.profiles p where p.id = (select auth.uid()) and p.active)
  );

drop policy if exists "users mark own notifications read" on public.notifications;
create policy "users mark own notifications read"
  on public.notifications for update to authenticated
  using (
    recipient_id = (select auth.uid())
    and tenant_id = (select p.tenant_id from public.profiles p where p.id = (select auth.uid()) and p.active)
  )
  with check (
    recipient_id = (select auth.uid())
    and tenant_id = (select p.tenant_id from public.profiles p where p.id = (select auth.uid()) and p.active)
  );

create or replace function private.enqueue_notification(
  p_tenant_id uuid,
  p_recipient_id uuid,
  p_event_type text,
  p_title text,
  p_message text,
  p_action_path text,
  p_entity_id text
) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (tenant_id, recipient_id, event_type, title, message, action_path, entity_id)
  select p_tenant_id, p_recipient_id, p_event_type, left(p_title, 120), left(p_message, 500), p_action_path, p_entity_id
  from public.profiles p
  where p.id = p_recipient_id
    and p.tenant_id = p_tenant_id
    and p.active
    and p.role in ('SUPER_ADMIN', 'RECEPCION', 'BARBER');
$$;
revoke all on function private.enqueue_notification(uuid, uuid, text, text, text, text, text) from public, anon, authenticated;

create or replace function public.notify_appointment_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client_name text;
  v_service_name text;
  v_creator_role public.app_role;
  v_profile record;
  v_message text;
begin
  select c.full_name, s.name into v_client_name, v_service_name
  from public.clients c
  join public.services s on s.id = new.service_id and s.tenant_id = new.tenant_id
  where c.id = new.client_id and c.tenant_id = new.tenant_id;
  v_message := coalesce(v_client_name, 'Cliente') || ' · ' || coalesce(v_service_name, 'Servicio') || ' · ' ||
    to_char(new.starts_at at time zone 'America/Guayaquil', 'DD/MM HH24:MI');

  if tg_op = 'INSERT' and new.status in ('confirmed', 'waiting') then
    select p.role into v_creator_role from public.profiles p where p.id = new.created_by and p.tenant_id = new.tenant_id;
    if v_creator_role is distinct from 'SUPER_ADMIN' and v_creator_role is distinct from 'RECEPCION' then
      for v_profile in
        select p.id from public.profiles p
        where p.tenant_id = new.tenant_id and p.active and p.role in ('SUPER_ADMIN', 'RECEPCION')
          and p.id is distinct from (select auth.uid())
      loop
        perform private.enqueue_notification(new.tenant_id, v_profile.id, 'appointment_booked', 'Nueva cita', v_message, '/appointments', new.id);
      end loop;
    end if;
    if new.barber_id is not null then
      for v_profile in
        select p.id from public.profiles p
        where p.tenant_id = new.tenant_id and p.active and p.role = 'BARBER' and p.barber_id = new.barber_id
          and p.id is distinct from (select auth.uid())
      loop
        perform private.enqueue_notification(new.tenant_id, v_profile.id, 'appointment_booked', 'Nueva cita asignada', v_message, '/chair', new.id);
      end loop;
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status is distinct from new.status and new.status = 'cancelled' then
    for v_profile in
      select p.id, p.role, p.barber_id from public.profiles p
      where p.tenant_id = new.tenant_id and p.active
        and (p.role in ('SUPER_ADMIN', 'RECEPCION') or (p.role = 'BARBER' and p.barber_id = new.barber_id))
        and p.id is distinct from (select auth.uid())
    loop
      perform private.enqueue_notification(
        new.tenant_id, v_profile.id, 'appointment_cancelled', 'Cita cancelada', v_message,
        case when v_profile.role = 'BARBER' then '/chair' else '/appointments' end, new.id
      );
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function public.notify_appointment_changes() from public, anon, authenticated;
drop trigger if exists notifications_appointment_changes on public.appointments;
create trigger notifications_appointment_changes
  after insert or update of status on public.appointments
  for each row execute function public.notify_appointment_changes();

create or replace function public.notify_checkout_ready()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile record;
begin
  if old.status is distinct from new.status and new.status = 'ready-for-checkout' then
    for v_profile in
      select p.id from public.profiles p
      where p.tenant_id = new.tenant_id and p.active and p.role in ('SUPER_ADMIN', 'RECEPCION')
        and p.id is distinct from (select auth.uid())
    loop
      perform private.enqueue_notification(new.tenant_id, v_profile.id, 'checkout_ready', 'Servicio listo para cobrar',
        coalesce(nullif(new.guest_name, ''), 'Cliente') || ' ya terminó su servicio.', '/checkout', new.id);
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function public.notify_checkout_ready() from public, anon, authenticated;
drop trigger if exists notifications_checkout_ready on public.service_orders;
create trigger notifications_checkout_ready
  after update of status on public.service_orders
  for each row execute function public.notify_checkout_ready();

create or replace function public.notify_queue_visit_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile record;
  v_service_name text;
begin
  if new.status in ('waiting', 'called') and new.barber_id is not null then
    select s.name into v_service_name from public.services s where s.id = new.service_id and s.tenant_id = new.tenant_id;
    for v_profile in
      select p.id from public.profiles p
      where p.tenant_id = new.tenant_id and p.active and p.role = 'BARBER' and p.barber_id = new.barber_id
        and p.id is distinct from (select auth.uid())
    loop
      perform private.enqueue_notification(new.tenant_id, v_profile.id, 'queue_visit_created', 'Cliente en recepción',
        coalesce(nullif(new.guest_name, ''), 'Cliente') || ' llegó para ' || coalesce(v_service_name, 'un servicio') || '.', '/chair', new.id);
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function public.notify_queue_visit_created() from public, anon, authenticated;
drop trigger if exists notifications_queue_visit_created on public.queue_visits;
create trigger notifications_queue_visit_created
  after insert on public.queue_visits
  for each row execute function public.notify_queue_visit_created();

create or replace function public.notify_restock_requested()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile record;
  v_item_name text;
  v_tenant_id uuid;
begin
  select i.name, i.tenant_id into v_item_name, v_tenant_id from public.inventory_items i
  where i.id = new.inventory_item_id;
  for v_profile in
    select p.id from public.profiles p
    where p.tenant_id = v_tenant_id and p.active and p.role in ('SUPER_ADMIN', 'RECEPCION')
      and p.id is distinct from new.requested_by
  loop
    perform private.enqueue_notification(v_tenant_id, v_profile.id, 'restock_requested', 'Reposición solicitada',
      coalesce(v_item_name, 'Insumo') || ' · ' || new.quantity::text || ' ' || new.unit::text, '/inventory', new.id::text);
  end loop;
  return new;
end;
$$;
revoke all on function public.notify_restock_requested() from public, anon, authenticated;
drop trigger if exists notifications_restock_requested on public.restock_requests;
create trigger notifications_restock_requested
  after insert on public.restock_requests
  for each row execute function public.notify_restock_requested();

create or replace function public.notify_staff_shift_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_type text;
  v_title text;
  v_message text;
  v_tenant_id uuid;
  v_role public.app_role;
begin
  select p.tenant_id, p.role into v_tenant_id, v_role from public.profiles p where p.id = new.profile_id;
  if tg_op = 'INSERT' then
    v_event_type := 'shift_created';
    v_title := 'Nuevo turno programado';
    v_message := 'Tu turno es el ' || to_char(new.starts_at at time zone 'America/Guayaquil', 'DD/MM HH24:MI') ||
      '–' || to_char(new.ends_at at time zone 'America/Guayaquil', 'HH24:MI') || '.';
  elsif old.cancelled_at is null and new.cancelled_at is not null then
    v_event_type := 'shift_cancelled';
    v_title := 'Turno cancelado';
    v_message := 'Se canceló tu turno del ' || to_char(old.starts_at at time zone 'America/Guayaquil', 'DD/MM HH24:MI') || '.';
  elsif old.starts_at is distinct from new.starts_at or old.ends_at is distinct from new.ends_at then
    v_event_type := 'shift_updated';
    v_title := 'Turno actualizado';
    v_message := 'Tu turno ahora es el ' || to_char(new.starts_at at time zone 'America/Guayaquil', 'DD/MM HH24:MI') ||
      '–' || to_char(new.ends_at at time zone 'America/Guayaquil', 'HH24:MI') || '.';
  else
    return new;
  end if;

  perform private.enqueue_notification(v_tenant_id, new.profile_id, v_event_type, v_title, v_message,
    case when v_role = 'BARBER' then '/chair' else '/reception' end, new.id::text);
  return new;
end;
$$;
revoke all on function public.notify_staff_shift_changes() from public, anon, authenticated;
drop trigger if exists notifications_staff_shift_changes on public.staff_shifts;
create trigger notifications_staff_shift_changes
  after insert or update of starts_at, ends_at, cancelled_at on public.staff_shifts
  for each row execute function public.notify_staff_shift_changes();

create or replace function public.notify_stock_threshold_crossing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile record;
begin
  if new.active and new.quantity <= new.minimum_quantity and old.quantity > old.minimum_quantity then
    for v_profile in
      select p.id from public.profiles p
      where p.tenant_id = new.tenant_id and p.active and p.role in ('SUPER_ADMIN', 'RECEPCION')
    loop
      perform private.enqueue_notification(new.tenant_id, v_profile.id, 'stock_low', 'Stock bajo',
        new.name || ' llegó a ' || new.quantity::text || ' ' || new.unit::text || ' (mínimo ' || new.minimum_quantity::text || ').',
        '/inventory', new.id);
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function public.notify_stock_threshold_crossing() from public, anon, authenticated;
drop trigger if exists notifications_stock_threshold_crossing on public.inventory_items;
create trigger notifications_stock_threshold_crossing
  after update of quantity, minimum_quantity on public.inventory_items
  for each row execute function public.notify_stock_threshold_crossing();

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
    ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;

commit;
