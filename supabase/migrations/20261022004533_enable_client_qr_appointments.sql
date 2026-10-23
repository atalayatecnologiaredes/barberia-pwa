begin;

-- QR bookings are authenticated by the high-entropy bearer token. Raw tokens are
-- never stored or exposed; each RPC resolves the token hash to one tenant/client.
create or replace function public.client_qr_book_appointment(
  p_token text,
  p_service_id text,
  p_barber_id text,
  p_starts_at timestamptz,
  p_notes text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client public.clients%rowtype;
  v_duration integer;
  v_ends_at timestamptz;
  v_appointment public.appointments%rowtype;
begin
  if p_token is null or length(p_token) <> 64 or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'El QR no es válido. Solicita uno nuevo en recepción.' using errcode = '22023';
  end if;

  select c.* into v_client
  from public.client_qr_tokens t
  join public.clients c on c.id = t.client_id and c.tenant_id = t.tenant_id
  where t.token_hash = extensions.digest(p_token, 'sha256')
    and t.revoked_at is null and t.expires_at > now()
  for update of c;
  if not found then
    raise exception 'El QR venció o fue revocado. Solicita uno nuevo en recepción.' using errcode = '42501';
  end if;
  -- Serialize with QR renewal/revocation, using the same client-then-token lock order.
  perform 1 from public.client_qr_tokens t
  where t.token_hash = extensions.digest(p_token, 'sha256')
    and t.client_id = v_client.id and t.tenant_id = v_client.tenant_id
    and t.revoked_at is null and t.expires_at > now()
  for share;
  if not found then
    raise exception 'El QR venció o fue revocado. Solicita uno nuevo en recepción.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.tenants t where t.id = v_client.tenant_id and t.active) then
    raise exception 'La barbería no está disponible para reservas.' using errcode = '42501';
  end if;
  if p_starts_at is null or p_starts_at <= now()
    or p_starts_at = 'infinity'::timestamptz or p_starts_at = '-infinity'::timestamptz then
    raise exception 'Selecciona una fecha y hora futura.' using errcode = '22023';
  end if;
  if length(coalesce(p_notes, '')) > 500 then
    raise exception 'La nota no puede superar 500 caracteres.' using errcode = '22023';
  end if;
  if p_barber_id is null then
    raise exception 'Selecciona un barbero para la reserva.' using errcode = '22023';
  end if;

  select s.duration_minutes into v_duration
  from public.services s
  where s.id = p_service_id and s.tenant_id = v_client.tenant_id and s.active
  for share;
  if not found or v_duration is null or v_duration <= 0 then
    raise exception 'El servicio seleccionado ya no está disponible.' using errcode = '22023';
  end if;
  perform 1 from public.barbers b
  where b.id = p_barber_id and b.tenant_id = v_client.tenant_id and b.active
  for update;
  if not found then
    raise exception 'El barbero seleccionado ya no está disponible.' using errcode = '22023';
  end if;
  v_ends_at := p_starts_at + make_interval(mins => v_duration);

  -- Locking the client and barber serializes concurrent booking attempts; the
  -- same lock order is used by the authenticated reception booking RPC.
  if exists (
    select 1 from public.appointments a
    where a.tenant_id = v_client.tenant_id and a.barber_id = p_barber_id
      and a.status in ('confirmed', 'waiting', 'in-chair')
      and a.starts_at < v_ends_at
      and coalesce(a.ends_at, a.starts_at + interval '2 hours') > p_starts_at
  ) or exists (
    select 1 from public.appointments a
    where a.tenant_id = v_client.tenant_id and a.client_id = v_client.id
      and a.status in ('confirmed', 'waiting', 'in-chair')
      and a.starts_at < v_ends_at
      and coalesce(a.ends_at, a.starts_at + interval '2 hours') > p_starts_at
  ) then
    raise exception 'Ese horario ya no está disponible. Elige otra hora.' using errcode = '23P01';
  end if;

  insert into public.appointments(
    client_id, service_id, barber_id, starts_at, ends_at, source, notes, created_by, tenant_id
  ) values (
    v_client.id, p_service_id, p_barber_id, p_starts_at, v_ends_at,
    'booking', coalesce(trim(p_notes), ''), (select auth.uid()), v_client.tenant_id
  ) returning * into v_appointment;

  return jsonb_build_object(
    'id', v_appointment.id,
    'confirmation_code', v_appointment.confirmation_code,
    'starts_at', v_appointment.starts_at,
    'ends_at', v_appointment.ends_at
  );
end;
$$;

create or replace function public.client_qr_list_appointments(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client public.clients%rowtype;
  v_result jsonb;
begin
  if p_token is null or length(p_token) <> 64 or p_token !~ '^[0-9a-f]{64}$' then
    return '[]'::jsonb;
  end if;
  select c.* into v_client
  from public.client_qr_tokens t
  join public.clients c on c.id = t.client_id and c.tenant_id = t.tenant_id
  join public.tenants shop on shop.id = c.tenant_id and shop.active
  where t.token_hash = extensions.digest(p_token, 'sha256')
    and t.revoked_at is null and t.expires_at > now();
  if not found then return '[]'::jsonb; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id,
    'starts_at', a.starts_at,
    'ends_at', a.ends_at,
    'status', a.status,
    'confirmation_code', a.confirmation_code,
    'service', s.name,
    'barber', b.name
  ) order by a.starts_at), '[]'::jsonb)
  into v_result
  from (
    select ap.* from public.appointments ap
    where ap.tenant_id = v_client.tenant_id and ap.client_id = v_client.id
      and ap.status in ('confirmed', 'waiting', 'in-chair')
      and (ap.starts_at >= now() or ap.status in ('waiting', 'in-chair'))
    order by ap.starts_at
    limit 20
  ) a
  left join public.services s on s.id = a.service_id and s.tenant_id = v_client.tenant_id
  left join public.barbers b on b.id = a.barber_id and b.tenant_id = v_client.tenant_id;
  return v_result;
end;
$$;

create or replace function public.client_qr_cancel_appointment(p_token text, p_appointment_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client public.clients%rowtype;
  v_cancelled_id text;
begin
  if p_token is null or length(p_token) <> 64 or p_token !~ '^[0-9a-f]{64}$' then
    return false;
  end if;
  select c.* into v_client
  from public.client_qr_tokens t
  join public.clients c on c.id = t.client_id and c.tenant_id = t.tenant_id
  join public.tenants shop on shop.id = c.tenant_id and shop.active
  where t.token_hash = extensions.digest(p_token, 'sha256')
    and t.revoked_at is null and t.expires_at > now()
  for share of t;
  if not found then return false; end if;

  update public.appointments a
  set status = 'cancelled', updated_at = now()
  where a.id = p_appointment_id
    and a.client_id = v_client.id
    and a.tenant_id = v_client.tenant_id
    and a.status = 'confirmed'
    and a.starts_at > now()
  returning a.id into v_cancelled_id;
  return v_cancelled_id is not null;
end;
$$;

revoke all on function public.client_qr_book_appointment(text, text, text, timestamptz, text) from public, anon, authenticated;
revoke all on function public.client_qr_list_appointments(text) from public, anon, authenticated;
revoke all on function public.client_qr_cancel_appointment(text, text) from public, anon, authenticated;
grant execute on function public.client_qr_book_appointment(text, text, text, timestamptz, text) to anon, authenticated;
grant execute on function public.client_qr_list_appointments(text) to anon, authenticated;
grant execute on function public.client_qr_cancel_appointment(text, text) to anon, authenticated;

create index if not exists appointments_tenant_barber_active_schedule_idx
  on public.appointments (tenant_id, barber_id, starts_at, ends_at)
  where status in ('confirmed', 'waiting', 'in-chair') and barber_id is not null;
create index if not exists appointments_tenant_client_active_schedule_idx
  on public.appointments (tenant_id, client_id, starts_at, ends_at)
  where status in ('confirmed', 'waiting', 'in-chair');

notify pgrst, 'reload schema';
commit;
