begin;

-- A barber and a chair can each have at most one active service. The RPC also
-- locks the barber row and returns a readable error before reaching these
-- indexes, so concurrent reception requests cannot start overlapping turns.
create unique index if not exists service_orders_one_active_service_per_barber_idx
  on public.service_orders (barber_id)
  where status = 'in-service';

create unique index if not exists service_orders_one_active_service_per_station_idx
  on public.service_orders (station_id)
  where status = 'in-service';

-- New appointments cannot overlap the remaining expected time of a service
-- already in progress. The barber row lock is shared with service starts.
create or replace function public.create_appointment(
  p_client_id text,p_service_id text,p_barber_id text,p_starts_at timestamptz,p_notes text default ''
) returns text language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_role public.app_role;
  v_duration integer;
  v_end timestamptz;
  v_id text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select p.tenant_id,p.role into v_tenant,v_role from public.profiles p where p.id=auth.uid() and p.active;
  if not found or v_tenant is null or v_role not in ('SUPER_ADMIN','RECEPCION') then raise exception 'Not authorized' using errcode='42501'; end if;
  if p_starts_at is null or p_starts_at <= now() then raise exception 'Appointment must be in the future'; end if;
  if length(coalesce(p_notes,'')) > 500 then raise exception 'Notes are too long'; end if;
  perform 1 from public.clients c where c.id=p_client_id and c.tenant_id=v_tenant for update;
  if not found then raise exception 'Client not found in this shop'; end if;
  select s.duration_minutes into v_duration from public.services s where s.id=p_service_id and s.tenant_id=v_tenant and s.active for share;
  if not found or v_duration is null or v_duration <= 0 then raise exception 'Active service not found in this shop'; end if;
  v_end := p_starts_at + make_interval(mins => v_duration);
  if p_barber_id is not null then
    perform 1 from public.barbers b where b.id=p_barber_id and b.tenant_id=v_tenant and b.active for update;
    if not found then raise exception 'Active barber not found in this shop'; end if;
    if exists(select 1 from public.appointments a where a.tenant_id=v_tenant and a.barber_id=p_barber_id
      and a.status in ('confirmed','waiting','in-chair') and a.starts_at<v_end
      and coalesce(a.ends_at,a.starts_at+interval '2 hours')>p_starts_at) then
      raise exception 'The barber already has an appointment at that time';
    end if;
    if exists(select 1 from public.service_orders o join public.services s on s.id=o.service_id and s.tenant_id=o.tenant_id
      where o.tenant_id=v_tenant and o.barber_id=p_barber_id and o.status='in-service'
        and o.started_at+make_interval(mins=>s.duration_minutes)>p_starts_at) then
      raise exception 'El barbero está atendiendo un servicio que se extenderá hasta ese horario.' using errcode='23P01';
    end if;
  end if;
  if exists(select 1 from public.appointments a where a.tenant_id=v_tenant and a.client_id=p_client_id
    and a.status in ('confirmed','waiting','in-chair') and a.starts_at<v_end
    and coalesce(a.ends_at,a.starts_at+interval '2 hours')>p_starts_at) then
    raise exception 'The client already has an appointment at that time';
  end if;
  if exists(select 1 from public.service_orders o join public.services s on s.id=o.service_id and s.tenant_id=o.tenant_id
    where o.tenant_id=v_tenant and o.client_id=p_client_id and o.status='in-service'
      and o.started_at+make_interval(mins=>s.duration_minutes)>p_starts_at) then
    raise exception 'El cliente tiene un servicio que se extenderá hasta ese horario.' using errcode='23P01';
  end if;
  insert into public.appointments(client_id,service_id,barber_id,starts_at,ends_at,source,notes,created_by,tenant_id)
  values(p_client_id,p_service_id,p_barber_id,p_starts_at,v_end,'booking',coalesce(p_notes,''),auth.uid(),v_tenant)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.client_qr_book_appointment(
  p_token text,p_service_id text,p_barber_id text,p_starts_at timestamptz,p_notes text default ''
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_client public.clients%rowtype;
  v_duration integer;
  v_ends_at timestamptz;
  v_appointment public.appointments%rowtype;
begin
  if p_token is null or length(p_token)<>64 or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'El QR no es válido. Solicita uno nuevo en recepción.' using errcode='22023';
  end if;
  select c.* into v_client from public.client_qr_tokens t
  join public.clients c on c.id=t.client_id and c.tenant_id=t.tenant_id
  where t.token_hash=extensions.digest(p_token,'sha256') and t.revoked_at is null and t.expires_at>now()
  for update of c;
  if not found then raise exception 'El QR venció o fue revocado. Solicita uno nuevo en recepción.' using errcode='42501'; end if;
  perform 1 from public.client_qr_tokens t
  where t.token_hash=extensions.digest(p_token,'sha256') and t.client_id=v_client.id and t.tenant_id=v_client.tenant_id
    and t.revoked_at is null and t.expires_at>now() for share;
  if not found then raise exception 'El QR venció o fue revocado. Solicita uno nuevo en recepción.' using errcode='42501'; end if;
  if not exists(select 1 from public.tenants t where t.id=v_client.tenant_id and t.active) then
    raise exception 'La barbería no está disponible para reservas.' using errcode='42501';
  end if;
  if p_starts_at is null or p_starts_at<=now() or p_starts_at='infinity'::timestamptz or p_starts_at='-infinity'::timestamptz then
    raise exception 'Selecciona una fecha y hora futura.' using errcode='22023';
  end if;
  if length(coalesce(p_notes,''))>500 then raise exception 'La nota no puede superar 500 caracteres.' using errcode='22023'; end if;
  if p_barber_id is null then raise exception 'Selecciona un barbero para la reserva.' using errcode='22023'; end if;
  select s.duration_minutes into v_duration from public.services s
  where s.id=p_service_id and s.tenant_id=v_client.tenant_id and s.active for share;
  if not found or v_duration is null or v_duration<=0 then raise exception 'El servicio seleccionado ya no está disponible.' using errcode='22023'; end if;
  perform 1 from public.barbers b where b.id=p_barber_id and b.tenant_id=v_client.tenant_id and b.active for update;
  if not found then raise exception 'El barbero seleccionado ya no está disponible.' using errcode='22023'; end if;
  v_ends_at:=p_starts_at+make_interval(mins=>v_duration);
  if exists(select 1 from public.appointments a where a.tenant_id=v_client.tenant_id and a.barber_id=p_barber_id
      and a.status in ('confirmed','waiting','in-chair') and a.starts_at<v_ends_at
      and coalesce(a.ends_at,a.starts_at+interval '2 hours')>p_starts_at)
    or exists(select 1 from public.appointments a where a.tenant_id=v_client.tenant_id and a.client_id=v_client.id
      and a.status in ('confirmed','waiting','in-chair') and a.starts_at<v_ends_at
      and coalesce(a.ends_at,a.starts_at+interval '2 hours')>p_starts_at)
    or exists(select 1 from public.service_orders o join public.services s on s.id=o.service_id and s.tenant_id=o.tenant_id
      where o.tenant_id=v_client.tenant_id and o.barber_id=p_barber_id and o.status='in-service'
        and o.started_at+make_interval(mins=>s.duration_minutes)>p_starts_at)
    or exists(select 1 from public.service_orders o join public.services s on s.id=o.service_id and s.tenant_id=o.tenant_id
      where o.tenant_id=v_client.tenant_id and o.client_id=v_client.id and o.status='in-service'
        and o.started_at+make_interval(mins=>s.duration_minutes)>p_starts_at) then
    raise exception 'Ese horario ya no está disponible. El barbero o el cliente tiene otro compromiso.' using errcode='23P01';
  end if;
  insert into public.appointments(client_id,service_id,barber_id,starts_at,ends_at,source,notes,created_by,tenant_id)
  values(v_client.id,p_service_id,p_barber_id,p_starts_at,v_ends_at,'booking',coalesce(trim(p_notes),''),(select auth.uid()),v_client.tenant_id)
  returning * into v_appointment;
  return jsonb_build_object('id',v_appointment.id,'confirmation_code',v_appointment.confirmation_code,
    'starts_at',v_appointment.starts_at,'ends_at',v_appointment.ends_at);
end $$;

create or replace function public.transition_queue_visit(p_visit_id text,p_status public.queue_status)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_role public.app_role;
  v_visit public.queue_visits%rowtype;
  v_service public.services%rowtype;
  v_barber public.barbers%rowtype;
  v_station_id text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select p.tenant_id,p.role into v_tenant,v_role
  from public.profiles p where p.id=auth.uid() and p.active;
  if not found or v_tenant is null or v_role not in ('SUPER_ADMIN','RECEPCION') then
    raise exception 'Not authorized' using errcode='42501';
  end if;

  select q.* into v_visit from public.queue_visits q
  where q.id=p_visit_id and q.tenant_id=v_tenant for update;
  if not found then raise exception 'Queue visit not found in this shop'; end if;

  if p_status='called' and v_visit.status='waiting' then
    if v_visit.barber_id is null then raise exception 'Assign a barber before calling this client'; end if;
    update public.queue_visits set status='called',called_at=now()
    where id=v_visit.id and tenant_id=v_tenant;
  elsif p_status='in-chair' and v_visit.status='called' then
    if v_visit.barber_id is null then raise exception 'Assign a barber before starting service'; end if;
    select s.* into v_service from public.services s
    where s.id=v_visit.service_id and s.tenant_id=v_tenant and s.active;
    if not found then raise exception 'Active service not found'; end if;

    -- This lock serializes chair starts for this barber. Availability is checked
    -- only after acquiring it, so a second concurrent start sees the first one.
    select b.* into v_barber from public.barbers b
    where b.id=v_visit.barber_id and b.tenant_id=v_tenant and b.active for update;
    if not found then raise exception 'Active barber not found'; end if;
    v_station_id := coalesce(v_visit.station_id,v_barber.station_id);
    if v_station_id is null then raise exception 'Assign a station to this barber before starting service'; end if;

    if exists(select 1 from public.service_orders o
      where o.tenant_id=v_tenant and o.barber_id=v_barber.id and o.status='in-service') then
      raise exception 'El barbero ya está atendiendo a otro cliente. El turno permanece en espera.' using errcode='55000';
    end if;
    if exists(select 1 from public.service_orders o
      where o.tenant_id=v_tenant and o.station_id=v_station_id and o.status='in-service') then
      raise exception 'La silla asignada está ocupada. El turno permanece en espera.' using errcode='55000';
    end if;
    if exists(select 1 from public.appointments a
      where a.tenant_id=v_tenant and a.barber_id=v_barber.id
        and a.status in ('confirmed','waiting','in-chair')
        and a.id is distinct from v_visit.appointment_id
        and a.starts_at < now() + make_interval(mins => v_service.duration_minutes)
        and coalesce(a.ends_at,a.starts_at+interval '2 hours') > now()) then
      raise exception 'El barbero tiene una cita reservada para este horario. El turno permanece en espera.' using errcode='55000';
    end if;
    if exists(select 1 from public.service_orders o
      where o.queue_visit_id=v_visit.id and o.tenant_id=v_tenant) then
      raise exception 'Service order already exists';
    end if;

    insert into public.service_orders(id,queue_visit_id,appointment_id,client_id,guest_name,guest_phone,barber_id,station_id,service_id,service_price,status,started_at,created_by,tenant_id)
    values('ord_'||replace(gen_random_uuid()::text,'-',''),v_visit.id,v_visit.appointment_id,v_visit.client_id,v_visit.guest_name,v_visit.guest_phone,v_barber.id,v_station_id,v_service.id,v_service.price,'in-service',now(),auth.uid(),v_tenant);
    update public.queue_visits set status='in-chair',started_at=now(),station_id=v_station_id
    where id=v_visit.id and tenant_id=v_tenant;
    if v_visit.appointment_id is not null then
      update public.appointments set status='in-chair',updated_at=now()
      where id=v_visit.appointment_id and tenant_id=v_tenant and status='waiting';
    end if;
  elsif p_status='cancelled' and v_visit.status in ('waiting','called','in-chair') then
    update public.service_orders set status='cancelled',ended_at=now(),updated_at=now()
    where queue_visit_id=v_visit.id and tenant_id=v_tenant and status='in-service';
    update public.queue_visits set status='cancelled',completed_at=now()
    where id=v_visit.id and tenant_id=v_tenant;
    if v_visit.appointment_id is not null then
      update public.appointments set status='cancelled',updated_at=now()
      where id=v_visit.appointment_id and tenant_id=v_tenant and status in ('waiting','in-chair');
    end if;
  else
    raise exception 'Invalid queue status transition from % to %',v_visit.status,p_status using errcode='22023';
  end if;
end $$;

-- Reception can choose or change the barber while a client remains in the
-- waiting queue. Occupancy is enforced when the client is actually seated.
create or replace function public.assign_queue_visit_barber(p_visit_id text,p_barber_id text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_role public.app_role;
  v_visit public.queue_visits%rowtype;
  v_appointment public.appointments%rowtype;
  v_barber public.barbers%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select p.tenant_id,p.role into v_tenant,v_role from public.profiles p where p.id=auth.uid() and p.active;
  if not found or v_tenant is null or v_role not in ('SUPER_ADMIN','RECEPCION') then raise exception 'Not authorized' using errcode='42501'; end if;
  select q.* into v_visit from public.queue_visits q where q.id=p_visit_id and q.tenant_id=v_tenant for update;
  if not found or v_visit.status not in ('waiting','called') then raise exception 'Solo se puede asignar un turno que sigue en espera'; end if;
  select b.* into v_barber from public.barbers b
  where b.id=p_barber_id and b.tenant_id=v_tenant and b.active for update;
  if not found then raise exception 'Barbero activo no encontrado en esta barbería'; end if;
  if v_barber.station_id is null then raise exception 'Asigna una silla al barbero antes de asignar este turno'; end if;
  if v_visit.appointment_id is not null then
    select a.* into v_appointment from public.appointments a
    where a.id=v_visit.appointment_id and a.tenant_id=v_tenant for update;
    if found then
      if exists(select 1 from public.appointments a where a.tenant_id=v_tenant and a.barber_id=v_barber.id
        and a.id<>v_appointment.id and a.status in ('confirmed','waiting','in-chair')
        and a.starts_at<coalesce(v_appointment.ends_at,v_appointment.starts_at+interval '2 hours')
        and coalesce(a.ends_at,a.starts_at+interval '2 hours')>v_appointment.starts_at) then
        raise exception 'Ese barbero ya tiene otra cita en el horario reservado.' using errcode='23P01';
      end if;
      update public.appointments set barber_id=v_barber.id,updated_at=now()
      where id=v_appointment.id and tenant_id=v_tenant and status='waiting';
    end if;
  end if;
  update public.queue_visits set barber_id=v_barber.id,station_id=v_barber.station_id
  where id=v_visit.id and tenant_id=v_tenant;
end $$;

revoke all on function public.assign_queue_visit_barber(text,text) from public,anon;
grant execute on function public.assign_queue_visit_barber(text,text) to authenticated;

-- A confirmed booking that is more than 15 minutes late and never checked in
-- can be explicitly closed by reception as a no-show.
create or replace function public.mark_appointment_no_show(p_appointment_id text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_role public.app_role;
  v_appointment public.appointments%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select p.tenant_id,p.role into v_tenant,v_role
  from public.profiles p where p.id=auth.uid() and p.active;
  if not found or v_tenant is null or v_role not in ('SUPER_ADMIN','RECEPCION') then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  select a.* into v_appointment from public.appointments a
  where a.id=p_appointment_id and a.tenant_id=v_tenant for update;
  if not found or v_appointment.status <> 'confirmed' then
    raise exception 'Only a confirmed appointment can be marked as no-show' using errcode='22023';
  end if;
  if v_appointment.starts_at > now() - interval '15 minutes' then
    raise exception 'La cita todavía está dentro del margen de llegada de 15 minutos.' using errcode='22023';
  end if;
  if exists(select 1 from public.queue_visits q where q.appointment_id=v_appointment.id and q.tenant_id=v_tenant)
    or exists(select 1 from public.service_orders o where o.appointment_id=v_appointment.id and o.tenant_id=v_tenant) then
    raise exception 'La cita ya tiene actividad en recepción y no puede marcarse como inasistencia' using errcode='22023';
  end if;
  update public.appointments set status='no-show',updated_at=now()
  where id=v_appointment.id and tenant_id=v_tenant and status='confirmed';
end $$;

revoke all on function public.mark_appointment_no_show(text) from public,anon;
grant execute on function public.mark_appointment_no_show(text) to authenticated;

-- Complete the related appointment in the same transaction as service finish.
create or replace function public.finish_service(
  p_order_id text,
  p_actor uuid default auth.uid()
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_tenant_id uuid;
  v_role public.app_role;
  v_order public.service_orders%rowtype;
  v_usage record;
begin
  if v_actor_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select p.tenant_id,p.role into v_tenant_id,v_role
  from public.profiles p where p.id=v_actor_id and p.active;
  if not found or v_role not in ('SUPER_ADMIN','BARBER') then
    raise exception 'Not authorized to complete service' using errcode='42501';
  end if;
  if v_tenant_id is null then raise exception 'User is not assigned to a barber shop' using errcode='42501'; end if;
  if not exists(select 1 from public.tenants t join public.saas_subscriptions s on s.tenant_id=t.id
    where t.id=v_tenant_id and t.active and s.status in ('active','trialing')
      and (s.current_period_end is null or s.current_period_end>now())) then
    raise exception 'Barber shop subscription is inactive or expired' using errcode='42501';
  end if;
  select o.* into v_order from public.service_orders o
  where o.id=p_order_id and o.tenant_id=v_tenant_id for update;
  if not found then raise exception 'Order not found in your barber shop' using errcode='P0002'; end if;
  if v_role='BARBER' and not exists(select 1 from public.profiles p where p.id=v_actor_id and p.barber_id=v_order.barber_id) then
    raise exception 'Barber can only complete their own service' using errcode='42501';
  end if;
  if not exists(select 1 from public.services s where s.id=v_order.service_id and s.tenant_id=v_tenant_id)
    or not exists(select 1 from public.barbers b where b.id=v_order.barber_id and b.tenant_id=v_tenant_id) then
    raise exception 'Order service or barber does not belong to your barber shop' using errcode='42501';
  end if;
  if exists(select 1 from public.service_inventory_usage su
    left join public.inventory_items i on i.id=su.inventory_item_id and i.tenant_id=v_tenant_id
    where su.service_id=v_order.service_id and i.id is null) then
    raise exception 'Service recipe contains an item outside your barber shop' using errcode='42501';
  end if;
  if v_order.status in ('ready-for-checkout','paid') then return; end if;
  if v_order.status <> 'in-service' then raise exception 'Order is not in service' using errcode='22023'; end if;

  for v_usage in
    select su.inventory_item_id,su.quantity,su.unit from public.service_inventory_usage su
    join public.inventory_items i on i.id=su.inventory_item_id and i.tenant_id=v_tenant_id
    where su.service_id=v_order.service_id order by su.inventory_item_id for update of i
  loop
    update public.inventory_items i set quantity=i.quantity-v_usage.quantity,updated_at=now()
    where i.id=v_usage.inventory_item_id and i.tenant_id=v_tenant_id and i.quantity>=v_usage.quantity;
    if not found then raise exception 'Insufficient stock for item %',v_usage.inventory_item_id using errcode='22023'; end if;
    insert into public.inventory_movements(inventory_item_id,order_id,quantity_delta,unit,movement_type,note,actor_id)
    values(v_usage.inventory_item_id,v_order.id,-v_usage.quantity,v_usage.unit,'service-use','Consumo automático por servicio',v_actor_id);
  end loop;

  update public.service_orders set status='ready-for-checkout',ended_at=now(),updated_at=now()
  where id=v_order.id and tenant_id=v_tenant_id;
  if v_order.queue_visit_id is not null then
    update public.queue_visits set status='complete',completed_at=now()
    where id=v_order.queue_visit_id and tenant_id=v_tenant_id;
  end if;
  if v_order.appointment_id is not null then
    update public.appointments set status='complete',updated_at=now()
    where id=v_order.appointment_id and tenant_id=v_tenant_id and status in ('waiting','in-chair');
  end if;
end $$;

-- Repair only appointments demonstrably completed by a paid/checkout-ready order.
update public.appointments a set status='complete',updated_at=now()
where a.status='in-chair' and exists(
  select 1 from public.service_orders o
  where o.appointment_id=a.id and o.tenant_id=a.tenant_id and o.status in ('ready-for-checkout','paid')
);

notify pgrst,'reload schema';
commit;
