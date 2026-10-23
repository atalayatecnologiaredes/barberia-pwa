create or replace function public.read_client_loyalty(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client public.clients%rowtype;
  v_tenant public.tenants%rowtype;
  v_points jsonb;
  v_queue jsonb;
  v_history jsonb;
  v_services jsonb;
  v_barbers jsonb;
begin
  if p_token is null or length(p_token) <> 64 or p_token !~ '^[0-9a-f]{64}$' then
    return null;
  end if;

  select c.* into v_client
  from public.client_qr_tokens t
  join public.clients c on c.id = t.client_id and c.tenant_id = t.tenant_id
  where t.token_hash = extensions.digest(p_token, 'sha256')
    and t.revoked_at is null and t.expires_at > now();
  if not found then return null; end if;

  select * into v_tenant from public.tenants where id = v_client.tenant_id and active;
  if not found then return null; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'points', l.points, 'entry_type', l.entry_type, 'description', l.description, 'created_at', l.created_at
  ) order by l.created_at desc), '[]'::jsonb)
  into v_points
  from (select points, entry_type, description, created_at
        from public.loyalty_ledger where client_id = v_client.id
        order by created_at desc limit 20) l;

  -- Only an active queue entry belongs in the live-turn card. Completed
  -- visits remain available below in the service history and must not hide
  -- the client's option to join the queue again.
  select jsonb_build_object(
    'id', q.id, 'status', q.status, 'queue_number', q.queue_number,
    'position', case when q.status = 'in-chair' then 0 else 1 + (
      select count(*) from public.queue_visits ahead
      where ahead.tenant_id = q.tenant_id and ahead.status in ('waiting', 'called')
        and ahead.queue_number < q.queue_number
    ) end,
    'service_name', s.name, 'barber_name', b.name, 'station_id', q.station_id,
    'checked_in_at', q.checked_in_at
  ) into v_queue
  from (select * from public.queue_visits where client_id = v_client.id
        and tenant_id = v_client.tenant_id and status in ('waiting', 'called', 'in-chair')
        and checked_in_at >= (date_trunc('day', now() at time zone 'America/Guayaquil') at time zone 'America/Guayaquil')
        order by checked_in_at desc limit 1) q
  left join public.services s on s.id = q.service_id
  left join public.barbers b on b.id = q.barber_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'service', s.name, 'barber', b.name, 'status', o.status, 'date', o.created_at, 'amount', o.service_price
  ) order by o.created_at desc), '[]'::jsonb)
  into v_history
  from (select * from public.service_orders where client_id = v_client.id and tenant_id = v_client.tenant_id
        order by created_at desc limit 10) o
  left join public.services s on s.id = o.service_id
  left join public.barbers b on b.id = o.barber_id;

  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'price', price, 'duration_minutes', duration_minutes)
    order by name), '[]'::jsonb)
  into v_services from public.services where tenant_id = v_client.tenant_id and active;

  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'station_id', station_id) order by name), '[]'::jsonb)
  into v_barbers from public.barbers where tenant_id = v_client.tenant_id and active;

  return jsonb_build_object(
    'client', jsonb_build_object('name', v_client.full_name,
      'tier', v_client.tier, 'points', v_client.loyalty_points, 'visits', v_client.visit_count),
    'barber_shop', jsonb_build_object('name', v_tenant.name),
    'ledger', v_points,
    'queue', v_queue,
    'history', v_history,
    'services', v_services,
    'barbers', v_barbers
  );
end;
$$;

revoke all on function public.read_client_loyalty(text) from public, authenticated;
grant execute on function public.read_client_loyalty(text) to anon, authenticated;
