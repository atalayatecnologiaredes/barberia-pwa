-- Personal QR access for loyalty members. Apply after the existing core schema.
-- Only the hash is stored; the raw token is returned once to authenticated staff.
begin;

create table if not exists public.client_qr_tokens (
  token_hash bytea primary key,
  client_id text not null references public.clients(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '365 days'),
  revoked_at timestamptz,
  created_by uuid references auth.users(id) on delete set null
);

create index if not exists client_qr_tokens_client_idx on public.client_qr_tokens(client_id, created_at desc);

-- Existing permissive staff policies are combined with these restrictive
-- tenant predicates so one barber shop cannot browse another shop's records.
drop policy if exists "clients stay inside current tenant" on public.clients;
create policy "clients stay inside current tenant" on public.clients
  as restrictive for all to authenticated
  using (tenant_id = (select p.tenant_id from public.profiles p where p.id = (select auth.uid())))
  with check (tenant_id = (select p.tenant_id from public.profiles p where p.id = (select auth.uid())));
drop policy if exists "services stay inside current tenant" on public.services;
create policy "services stay inside current tenant" on public.services
  as restrictive for all to authenticated
  using (tenant_id = (select p.tenant_id from public.profiles p where p.id = (select auth.uid())))
  with check (tenant_id = (select p.tenant_id from public.profiles p where p.id = (select auth.uid())));
drop policy if exists "barbers stay inside current tenant" on public.barbers;
create policy "barbers stay inside current tenant" on public.barbers
  as restrictive for all to authenticated
  using (tenant_id = (select p.tenant_id from public.profiles p where p.id = (select auth.uid())))
  with check (tenant_id = (select p.tenant_id from public.profiles p where p.id = (select auth.uid())));
drop policy if exists "queue stays inside current tenant" on public.queue_visits;
create policy "queue stays inside current tenant" on public.queue_visits
  as restrictive for all to authenticated
  using (tenant_id = (select p.tenant_id from public.profiles p where p.id = (select auth.uid())))
  with check (tenant_id = (select p.tenant_id from public.profiles p where p.id = (select auth.uid())));
drop policy if exists "appointments stay inside current tenant" on public.appointments;
create policy "appointments stay inside current tenant" on public.appointments
  as restrictive for all to authenticated
  using (tenant_id = (select p.tenant_id from public.profiles p where p.id = (select auth.uid())))
  with check (tenant_id = (select p.tenant_id from public.profiles p where p.id = (select auth.uid())));
drop policy if exists "orders stay inside current tenant" on public.service_orders;
create policy "orders stay inside current tenant" on public.service_orders
  as restrictive for all to authenticated
  using (tenant_id = (select p.tenant_id from public.profiles p where p.id = (select auth.uid())))
  with check (tenant_id = (select p.tenant_id from public.profiles p where p.id = (select auth.uid())));
drop policy if exists "inventory stays inside current tenant" on public.inventory_items;
create policy "inventory stays inside current tenant" on public.inventory_items
  as restrictive for all to authenticated
  using (tenant_id = (select p.tenant_id from public.profiles p where p.id = (select auth.uid())))
  with check (tenant_id = (select p.tenant_id from public.profiles p where p.id = (select auth.uid())));

alter table public.client_qr_tokens enable row level security;
revoke all on public.client_qr_tokens from anon, authenticated;

create or replace function public.create_client_with_qr(
  p_full_name text,
  p_phone text,
  p_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles%rowtype;
  v_client_id text := 'client_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  select * into v_actor from public.profiles where id = (select auth.uid()) and active;
  if not found or v_actor.role not in ('SUPER_ADMIN', 'RECEPCION') or v_actor.tenant_id is null then
    raise exception 'Not authorized to create clients for a barber shop';
  end if;
  if p_full_name is null or length(trim(p_full_name)) not between 2 and 100 then
    raise exception 'Enter a valid client name';
  end if;
  if p_phone is null or length(trim(p_phone)) not between 7 and 30 then
    raise exception 'Enter a valid client phone';
  end if;

  insert into public.clients(id, full_name, phone, email, tenant_id)
  values (v_client_id, trim(p_full_name), trim(p_phone), nullif(trim(p_email), ''), v_actor.tenant_id);
  insert into public.client_qr_tokens(token_hash, client_id, tenant_id, created_by)
  values (extensions.digest(v_token, 'sha256'), v_client_id, v_actor.tenant_id, (select auth.uid()));
  return jsonb_build_object('client_id', v_client_id, 'token', v_token);
end;
$$;

create or replace function public.issue_client_qr(p_client_id text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles%rowtype;
  v_client public.clients%rowtype;
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  select * into v_actor from public.profiles where id = (select auth.uid()) and active;
  if not found or v_actor.role not in ('SUPER_ADMIN', 'RECEPCION') then
    raise exception 'Not authorized to issue client QR';
  end if;

  select * into v_client from public.clients where id = p_client_id for update;
  if not found or v_client.tenant_id is distinct from v_actor.tenant_id then
    raise exception 'Client not found in your barber shop';
  end if;

  update public.client_qr_tokens set revoked_at = now()
  where client_id = p_client_id and tenant_id = v_client.tenant_id and revoked_at is null;

  insert into public.client_qr_tokens(token_hash, client_id, tenant_id, created_by)
  values (extensions.digest(v_token, 'sha256'), p_client_id, v_client.tenant_id, (select auth.uid()));
  return v_token;
end;
$$;

create or replace function public.revoke_client_qr(p_client_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles%rowtype;
begin
  select * into v_actor from public.profiles where id = (select auth.uid()) and active;
  if not found or v_actor.role not in ('SUPER_ADMIN', 'RECEPCION') then
    raise exception 'Not authorized to revoke client QR';
  end if;
  update public.client_qr_tokens t set revoked_at = now()
  where t.client_id = p_client_id and t.tenant_id = v_actor.tenant_id and t.revoked_at is null;
end;
$$;

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

  select case when q.id is null then null else jsonb_build_object(
    'id', q.id, 'status', q.status, 'queue_number', q.queue_number,
    'position', case when q.status in ('in-chair', 'complete') then 0 else 1 + (
      select count(*) from public.queue_visits ahead
      where ahead.tenant_id = q.tenant_id and ahead.status in ('waiting', 'called')
        and ahead.queue_number < q.queue_number
    ) end,
    'service_name', s.name, 'barber_name', b.name, 'station_id', q.station_id,
    'checked_in_at', q.checked_in_at
  ) end into v_queue
  from (select * from public.queue_visits where client_id = v_client.id
        and tenant_id = v_client.tenant_id and status in ('waiting', 'called', 'in-chair', 'complete')
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

create or replace function public.client_qr_check_in(p_token text, p_service_id text, p_barber_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client public.clients%rowtype;
  v_service public.services%rowtype;
  v_barber public.barbers%rowtype;
  v_visit public.queue_visits%rowtype;
begin
  if p_token is null or length(p_token) <> 64 or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid member QR';
  end if;
  select c.* into v_client from public.client_qr_tokens t
  join public.clients c on c.id = t.client_id and c.tenant_id = t.tenant_id
  where t.token_hash = extensions.digest(p_token, 'sha256') and t.revoked_at is null and t.expires_at > now()
  for update of c;
  if not found then raise exception 'This member QR is no longer valid'; end if;
  if not exists (select 1 from public.tenants where id = v_client.tenant_id and active) then
    raise exception 'This barber shop is unavailable';
  end if;

  select * into v_visit from public.queue_visits
  where client_id = v_client.id and tenant_id = v_client.tenant_id
    and status in ('waiting', 'called', 'in-chair') order by checked_in_at desc limit 1;
  if found then
    return jsonb_build_object('id', v_visit.id, 'status', v_visit.status, 'queue_number', v_visit.queue_number);
  end if;

  select * into v_service from public.services where id = p_service_id and tenant_id = v_client.tenant_id and active;
  if not found then raise exception 'Choose an available service'; end if;
  select * into v_barber from public.barbers where id = p_barber_id and tenant_id = v_client.tenant_id and active;
  if not found then raise exception 'Choose an available barber'; end if;

  insert into public.queue_visits(id, client_id, guest_name, guest_phone, service_id, barber_id,
    station_id, channel, status, tenant_id)
  values ('qr_' || replace(gen_random_uuid()::text, '-', ''), v_client.id, v_client.full_name,
    v_client.phone, v_service.id, v_barber.id, v_barber.station_id, 'qr', 'waiting', v_client.tenant_id)
  returning * into v_visit;
  return jsonb_build_object('id', v_visit.id, 'status', v_visit.status, 'queue_number', v_visit.queue_number);
end;
$$;

revoke all on function public.create_client_with_qr(text, text, text) from public, anon;
revoke all on function public.issue_client_qr(text) from public, anon;
revoke all on function public.revoke_client_qr(text) from public, anon;
revoke all on function public.read_client_loyalty(text) from public, authenticated;
revoke all on function public.client_qr_check_in(text, text, text) from public, anon;
grant execute on function public.create_client_with_qr(text, text, text) to authenticated;
grant execute on function public.issue_client_qr(text) to authenticated;
grant execute on function public.revoke_client_qr(text) to authenticated;
grant execute on function public.read_client_loyalty(text) to anon, authenticated;
grant execute on function public.client_qr_check_in(text, text, text) to anon, authenticated;

commit;
