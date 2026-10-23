-- Keep manual loyalty adjustments in the same ledger used by purchases.
-- Access is limited to the active owner of the client's tenant.
create or replace function public.adjust_client_loyalty_points(
  p_client_id text,
  p_points integer,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles%rowtype;
  v_client public.clients%rowtype;
  v_new_balance integer;
  v_reason text := nullif(trim(p_reason), '');
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into v_actor
  from public.profiles
  where id = (select auth.uid()) and active;
  if not found or v_actor.role <> 'SUPER_ADMIN' or v_actor.tenant_id is null then
    raise exception 'Only the active barber shop owner can adjust loyalty points' using errcode = '42501';
  end if;
  if p_points is null or p_points = 0 then
    raise exception 'Point adjustment must be a non-zero integer' using errcode = '22023';
  end if;
  if v_reason is null or length(v_reason) < 3 or length(v_reason) > 200 then
    raise exception 'Provide an adjustment reason between 3 and 200 characters' using errcode = '22023';
  end if;

  select * into v_client
  from public.clients
  where id = p_client_id and tenant_id = v_actor.tenant_id
  for update;
  if not found then
    raise exception 'Client not found in your barber shop' using errcode = 'P0002';
  end if;
  if v_client.loyalty_points + p_points < 0 then
    raise exception 'Adjustment cannot make the loyalty balance negative' using errcode = '22023';
  end if;

  update public.clients
  set loyalty_points = loyalty_points + p_points
  where id = v_client.id and tenant_id = v_actor.tenant_id
  returning loyalty_points into v_new_balance;

  insert into public.loyalty_ledger(client_id, points, entry_type, description)
  values (v_client.id, p_points, 'adjustment', 'Ajuste del dueño: ' || v_reason);

  return v_new_balance;
end;
$$;

revoke all on function public.adjust_client_loyalty_points(text, integer, text) from public, anon;
grant execute on function public.adjust_client_loyalty_points(text, integer, text) to authenticated;
