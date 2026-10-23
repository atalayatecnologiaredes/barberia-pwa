-- Redeem a reward and collect the checkout in one database transaction.
-- If checkout validation fails, PostgreSQL rolls back the points deduction too.
create or replace function public.attach_checkout_client(p_order_id text, p_client_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles%rowtype;
  v_order public.service_orders%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into v_actor from public.profiles
  where id = (select auth.uid()) and active;
  if not found or v_actor.role not in ('SUPER_ADMIN', 'RECEPCION') or v_actor.tenant_id is null then
    raise exception 'Not authorized to link a client to checkout' using errcode = '42501';
  end if;
  select * into v_order from public.service_orders
  where id = p_order_id and tenant_id = v_actor.tenant_id
  for update;
  if not found or v_order.status <> 'ready-for-checkout' then
    raise exception 'Order is not available for client linking' using errcode = '22023';
  end if;
  if v_order.client_id is not null and v_order.client_id <> p_client_id then
    raise exception 'Order already belongs to another client' using errcode = '22023';
  end if;
  if not exists (select 1 from public.clients c where c.id = p_client_id and c.tenant_id = v_actor.tenant_id) then
    raise exception 'Client not found in your barber shop' using errcode = 'P0002';
  end if;
  update public.service_orders set client_id = p_client_id, updated_at = now()
  where id = v_order.id and tenant_id = v_actor.tenant_id;
end;
$$;

revoke all on function public.attach_checkout_client(text, text) from public, anon;
grant execute on function public.attach_checkout_client(text, text) to authenticated;

create or replace function public.complete_checkout_with_loyalty_reward(
  p_order_id text,
  p_subtotal numeric,
  p_tax numeric,
  p_tip numeric,
  p_total numeric,
  p_method public.payment_method,
  p_splits jsonb,
  p_reward_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles%rowtype;
  v_order public.service_orders%rowtype;
  v_client public.clients%rowtype;
  v_reward public.loyalty_rewards%rowtype;
  v_payment_id uuid;
  v_redemption_id uuid;
  v_balance integer;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select * into v_actor from public.profiles
  where id = (select auth.uid()) and active;
  if not found or v_actor.role not in ('SUPER_ADMIN', 'RECEPCION') or v_actor.tenant_id is null then
    raise exception 'Not authorized to redeem a loyalty reward at checkout' using errcode = '42501';
  end if;

  select * into v_order from public.service_orders
  where id = p_order_id and tenant_id = v_actor.tenant_id
  for update;
  if not found or v_order.status <> 'ready-for-checkout' then
    raise exception 'Order is not available for a new checkout' using errcode = '22023';
  end if;
  if v_order.client_id is null then
    raise exception 'Link this order to a client to redeem loyalty rewards' using errcode = '22023';
  end if;

  select * into v_client from public.clients
  where id = v_order.client_id and tenant_id = v_actor.tenant_id
  for update;
  if not found then raise exception 'Client not found in your barber shop' using errcode = 'P0002'; end if;

  select * into v_reward from public.loyalty_rewards
  where id = p_reward_id and tenant_id = v_actor.tenant_id and active
  for update;
  if not found then raise exception 'Reward is unavailable' using errcode = 'P0002'; end if;
  if v_client.loyalty_points < v_reward.points_cost then
    raise exception 'Client does not have enough loyalty points' using errcode = '22023';
  end if;

  update public.clients
  set loyalty_points = loyalty_points - v_reward.points_cost
  where id = v_client.id and tenant_id = v_actor.tenant_id
  returning loyalty_points into v_balance;

  insert into public.loyalty_redemptions(tenant_id, client_id, reward_id, points, redeemed_by)
  values (v_actor.tenant_id, v_client.id, v_reward.id, v_reward.points_cost, (select auth.uid()))
  returning id into v_redemption_id;
  insert into public.loyalty_ledger(client_id, points, entry_type, description)
  values (v_client.id, -v_reward.points_cost, 'redeemed', 'Canje en caja: ' || v_reward.name);

  v_payment_id := public.complete_checkout(
    p_order_id, p_subtotal, p_tax, p_tip, p_total, p_method, coalesce(p_splits, '[]'::jsonb), (select auth.uid())
  );
  update public.loyalty_redemptions set payment_id = v_payment_id where id = v_redemption_id;
  return jsonb_build_object('payment_id', v_payment_id, 'points_balance', v_balance, 'reward_name', v_reward.name);
end;
$$;

revoke all on function public.complete_checkout_with_loyalty_reward(text, numeric, numeric, numeric, numeric, public.payment_method, jsonb, uuid) from public, anon;
grant execute on function public.complete_checkout_with_loyalty_reward(text, numeric, numeric, numeric, numeric, public.payment_method, jsonb, uuid) to authenticated;
