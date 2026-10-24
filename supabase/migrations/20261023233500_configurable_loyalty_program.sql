begin;

create table if not exists public.loyalty_program_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  points_per_dollar numeric(8,4) not null default 1 check (points_per_dollar between 0 and 1000),
  effective_at timestamptz not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists loyalty_program_rules_tenant_effective_uidx on public.loyalty_program_rules(tenant_id,effective_at);
create index if not exists loyalty_program_rules_current_idx on public.loyalty_program_rules(tenant_id,effective_at desc);
alter table public.loyalty_program_rules enable row level security;
revoke all on public.loyalty_program_rules from anon, authenticated;
grant select on public.loyalty_program_rules to authenticated;
drop policy if exists "loyalty rules tenant read" on public.loyalty_program_rules;
create policy "loyalty rules tenant read" on public.loyalty_program_rules for select to authenticated
using (exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active and p.role in ('SUPER_ADMIN','RECEPCION') and p.tenant_id=loyalty_program_rules.tenant_id));
insert into public.loyalty_program_rules(tenant_id,points_per_dollar,effective_at)
select t.id,1,'2026-10-23 23:32:00+00'::timestamptz from public.tenants t
on conflict (tenant_id,effective_at) do nothing;

create or replace function public.schedule_loyalty_rule(p_points_per_dollar numeric,p_effective_at timestamptz)
returns uuid language plpgsql security definer set search_path=''
as $$
declare v_tenant uuid; v_role public.app_role; v_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select tenant_id,role into v_tenant,v_role from public.profiles where id=(select auth.uid()) and active;
  if not found or v_tenant is null or v_role<>'SUPER_ADMIN' then raise exception 'Only an active shop owner can manage loyalty rules' using errcode='42501'; end if;
  if p_points_per_dollar is null or p_points_per_dollar<0 or p_points_per_dollar>1000 then raise exception 'Points per dollar must be between 0 and 1000' using errcode='22023'; end if;
  if p_effective_at is null or p_effective_at<clock_timestamp()-interval '1 minute' then raise exception 'Rule effective date cannot be in the past' using errcode='22023'; end if;
  insert into public.loyalty_program_rules(tenant_id,points_per_dollar,effective_at,created_by)
  values(v_tenant,p_points_per_dollar,p_effective_at,(select auth.uid())) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.schedule_loyalty_rule(numeric,timestamptz) from public,anon;
grant execute on function public.schedule_loyalty_rule(numeric,timestamptz) to authenticated;

create or replace function public.cancel_scheduled_loyalty_rule(p_rule_id uuid)
returns void language plpgsql security definer set search_path=''
as $$
declare v_tenant uuid; v_role public.app_role;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select tenant_id,role into v_tenant,v_role from public.profiles where id=(select auth.uid()) and active;
  if not found or v_tenant is null or v_role<>'SUPER_ADMIN' then raise exception 'Only an active shop owner can manage loyalty rules' using errcode='42501'; end if;
  delete from public.loyalty_program_rules where id=p_rule_id and tenant_id=v_tenant and effective_at>clock_timestamp();
  if not found then raise exception 'Only future rules for this shop can be cancelled' using errcode='P0002'; end if;
end;
$$;
revoke all on function public.cancel_scheduled_loyalty_rule(uuid) from public,anon;
grant execute on function public.cancel_scheduled_loyalty_rule(uuid) to authenticated;

alter table public.loyalty_rewards add column if not exists reward_type text not null default 'free_service';
alter table public.loyalty_rewards add column if not exists reward_value numeric(10,2) not null default 0;
alter table public.loyalty_rewards add column if not exists archived_at timestamptz;
do $$ begin
  if not exists(select 1 from pg_constraint where conname='loyalty_rewards_type_check' and conrelid='public.loyalty_rewards'::regclass) then
    alter table public.loyalty_rewards add constraint loyalty_rewards_type_check check(reward_type in ('free_service','fixed_service_discount','percent_service_discount'));
  end if;
  if not exists(select 1 from pg_constraint where conname='loyalty_rewards_value_check' and conrelid='public.loyalty_rewards'::regclass) then
    alter table public.loyalty_rewards add constraint loyalty_rewards_value_check check(reward_value>=0 and (reward_type<>'percent_service_discount' or reward_value<=100));
  end if;
end $$;

create or replace function public.delete_or_archive_loyalty_reward(p_reward_id uuid)
returns text language plpgsql security definer set search_path=''
as $$
declare v_tenant uuid; v_role public.app_role; v_reward public.loyalty_rewards%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select tenant_id,role into v_tenant,v_role from public.profiles where id=(select auth.uid()) and active;
  if not found or v_tenant is null or v_role<>'SUPER_ADMIN' then raise exception 'Only an active shop owner can manage rewards' using errcode='42501'; end if;
  select * into v_reward from public.loyalty_rewards where id=p_reward_id and tenant_id=v_tenant for update;
  if not found then raise exception 'Reward not found' using errcode='P0002'; end if;
  if exists(select 1 from public.loyalty_redemptions where reward_id=v_reward.id and tenant_id=v_tenant)
    or exists(select 1 from public.service_orders where loyalty_reward_id=v_reward.id and tenant_id=v_tenant) then
    update public.loyalty_rewards set active=false,archived_at=coalesce(archived_at,now()),updated_at=now() where id=v_reward.id;
    return 'archived';
  end if;
  delete from public.loyalty_rewards where id=v_reward.id and tenant_id=v_tenant;
  return 'deleted';
end;
$$;
revoke all on function public.delete_or_archive_loyalty_reward(uuid) from public,anon;
grant execute on function public.delete_or_archive_loyalty_reward(uuid) to authenticated;
revoke delete on public.loyalty_rewards from authenticated;
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
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_tenant_id uuid;
  v_role public.app_role;
  v_order public.service_orders%rowtype;
  v_payment_id uuid;
  v_line record;
  v_split jsonb;
  v_subtotal numeric(10,2);
  v_tax numeric(10,2);
  v_tip numeric(10,2);
  v_total numeric(10,2);
  v_tax_rate numeric(6,5);
  v_product_total numeric(10,2) := 0;
  v_service_commission numeric(10,2);
  v_product_commission numeric(10,2);
  v_points integer;
  v_points_per_dollar numeric(8,4);
begin
  if v_actor_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select p.tenant_id,p.role into v_tenant_id,v_role
  from public.profiles p where p.id=v_actor_id and p.active;
  if not found or v_role not in ('SUPER_ADMIN','RECEPCION') then raise exception 'Not authorized to complete checkout' using errcode='42501'; end if;
  if v_tenant_id is null then raise exception 'User is not assigned to a barber shop' using errcode='42501'; end if;
  select t.tax_rate into v_tax_rate from public.tenants t where t.id=v_tenant_id and t.active;
  if v_tax_rate is null then raise exception 'Shop tax settings are unavailable' using errcode='42501'; end if;
  if not exists(
    select 1 from public.tenants t join public.saas_subscriptions s on s.tenant_id=t.id
    where t.id=v_tenant_id and t.active and s.status in ('active','trialing')
      and (s.current_period_end is null or s.current_period_end>now())
  ) then raise exception 'Barber shop subscription is inactive or expired' using errcode='42501'; end if;

  select o.* into v_order from public.service_orders o
  where o.id=p_order_id and o.tenant_id=v_tenant_id for update;
  if not found then raise exception 'Order not found in your barber shop' using errcode='P0002'; end if;
  if v_order.status='paid' then
    select p.id into v_payment_id from public.payments p where p.order_id=v_order.id;
    return v_payment_id;
  end if;
  if v_order.status<>'ready-for-checkout' then raise exception 'Service must be finished before checkout' using errcode='22023'; end if;
  if coalesce(v_order.loyalty_discount,0)<0 or coalesce(v_order.loyalty_discount,0)>v_order.service_price then
    raise exception 'Loyalty discount is invalid for this service' using errcode='22023';
  end if;
  if v_order.loyalty_discount>0 and v_order.loyalty_reward_id is null then
    raise exception 'A service discount requires a redeemed loyalty reward' using errcode='22023';
  end if;
  if not exists(select 1 from public.services s where s.id=v_order.service_id and s.tenant_id=v_tenant_id) then
    raise exception 'Service belongs to another shop or is unavailable' using errcode='42501';
  end if;

  for v_line in
    select ol.id,ol.inventory_item_id,ol.item_name,ol.quantity,ol.unit_price,
      i.quantity as stock_quantity,i.unit,i.tenant_id as item_tenant_id,i.active,i.category
    from public.order_lines ol join public.inventory_items i on i.id=ol.inventory_item_id
    where ol.order_id=v_order.id order by ol.inventory_item_id for update of ol,i
  loop
    if v_line.item_tenant_id is distinct from v_tenant_id then raise exception 'Product belongs to another barber shop' using errcode='42501'; end if;
    if not v_line.active or v_line.category<>'Retail' then raise exception 'Product is not available for retail sale' using errcode='22023'; end if;
    if v_line.quantity<=0 or v_line.unit_price<0 then raise exception 'Product price or quantity is invalid' using errcode='22023'; end if;
    v_product_total:=v_product_total+(v_line.quantity*v_line.unit_price);
  end loop;

  v_subtotal:=round(v_order.service_price-coalesce(v_order.loyalty_discount,0)+v_product_total,2);
  if p_tip is null or p_tip<0 or p_tip::text in ('NaN','Infinity','-Infinity') then raise exception 'Tip must be zero or greater' using errcode='22023'; end if;
  v_tip:=round(p_tip,2);
  if p_tip<>v_tip then raise exception 'Tip must use at most two decimal places' using errcode='22023'; end if;
  v_tax:=round(v_subtotal*v_tax_rate,2);
  v_total:=round(v_subtotal+v_tax+v_tip,2);
  if p_subtotal is null or p_subtotal<>v_subtotal or p_tax is null or p_tax<>v_tax or p_total is null or p_total<>v_total then
    raise exception 'Payment totals do not match the discounted order and shop tax settings' using errcode='22023';
  end if;
  if p_method='loyalty' then
    if v_total<>0 or v_order.loyalty_reward_id is null then raise exception 'Loyalty payment is only valid for a fully covered reward checkout' using errcode='22023'; end if;
  elsif p_method='split' then
    if jsonb_typeof(p_splits)<>'array' or jsonb_array_length(p_splits)=0 then raise exception 'Split payment requires payment parts' using errcode='22023'; end if;
    if exists(select 1 from jsonb_array_elements(p_splits) s(value)
      where coalesce(s.value->>'method','') not in ('cash','card','mobile-transfer')
        or coalesce((s.value->>'amount')::numeric,0)<=0) then raise exception 'Invalid split payment part' using errcode='22023'; end if;
    if round((select coalesce(sum((s.value->>'amount')::numeric),0) from jsonb_array_elements(p_splits) s(value)),2)<>v_total then
      raise exception 'Split amounts must equal total' using errcode='22023';
    end if;
  elsif p_method not in ('cash','card','mobile-transfer') then raise exception 'Invalid payment method' using errcode='22023'; end if;

  insert into public.payments(order_id,client_id,subtotal,tax,tip,total,method,created_by,loyalty_discount)
  values(v_order.id,v_order.client_id,v_subtotal,v_tax,v_tip,v_total,p_method,v_actor_id,coalesce(v_order.loyalty_discount,0))
  returning id into v_payment_id;
  if p_method='split' then
    for v_split in select value from jsonb_array_elements(p_splits) loop
      insert into public.payment_splits(payment_id,method,amount,reference)
      values(v_payment_id,(v_split->>'method')::public.payment_method,(v_split->>'amount')::numeric,nullif(v_split->>'reference',''));
    end loop;
  end if;

  for v_line in select ol.inventory_item_id,ol.quantity from public.order_lines ol
    where ol.order_id=v_order.id order by ol.inventory_item_id for update loop
    update public.inventory_items i set quantity=i.quantity-v_line.quantity,updated_at=now()
    where i.id=v_line.inventory_item_id and i.tenant_id=v_tenant_id and i.active and i.category='Retail' and i.quantity>=v_line.quantity;
    if not found then raise exception 'Insufficient stock for product %',v_line.inventory_item_id using errcode='22023'; end if;
    insert into public.inventory_movements(inventory_item_id,order_id,quantity_delta,unit,movement_type,note,actor_id)
    select i.id,v_order.id,-v_line.quantity,i.unit,'retail-sale','Venta POS',v_actor_id
    from public.inventory_items i where i.id=v_line.inventory_item_id and i.tenant_id=v_tenant_id;
  end loop;

  select round((v_order.service_price-coalesce(v_order.loyalty_discount,0))*b.commission_service,2),
    round(v_product_total*b.commission_product,2)
  into v_service_commission,v_product_commission
  from public.barbers b where b.id=v_order.barber_id and b.tenant_id=v_tenant_id;
  insert into public.commissions(payment_id,order_id,barber_id,service_amount,product_amount)
  values(v_payment_id,v_order.id,v_order.barber_id,coalesce(v_service_commission,0),coalesce(v_product_commission,0));
  update public.service_orders set status='paid',paid_at=now(),updated_at=now()
  where id=v_order.id and tenant_id=v_tenant_id;

  if v_order.client_id is not null then
    select r.points_per_dollar into v_points_per_dollar
    from public.loyalty_program_rules r
    where r.tenant_id=v_tenant_id and r.effective_at<=clock_timestamp()
    order by r.effective_at desc limit 1;
    v_points:=floor(v_subtotal*coalesce(v_points_per_dollar,1))::integer;
    update public.clients c set visit_count=c.visit_count+1,loyalty_points=c.loyalty_points+v_points
    where c.id=v_order.client_id and c.tenant_id=v_tenant_id;
    if found and v_points>0 then
      insert into public.loyalty_ledger(client_id,payment_id,points,entry_type,description)
      values(v_order.client_id,v_payment_id,v_points,'earned','Puntos por compra');
    end if;
  end if;
  return v_payment_id;
end;
$$;

revoke all on function public.complete_checkout(text,numeric,numeric,numeric,numeric,public.payment_method,jsonb,uuid) from public,anon;
grant execute on function public.complete_checkout(text,numeric,numeric,numeric,numeric,public.payment_method,jsonb,uuid) to authenticated;

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
  v_discount numeric(10,2);
begin
  if (select auth.uid()) is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into v_actor from public.profiles where id=(select auth.uid()) and active;
  if not found or v_actor.role not in ('SUPER_ADMIN','RECEPCION') or v_actor.tenant_id is null then
    raise exception 'Not authorized to redeem a loyalty reward at checkout' using errcode='42501';
  end if;
  select * into v_order from public.service_orders where id=p_order_id and tenant_id=v_actor.tenant_id for update;
  if not found or v_order.status<>'ready-for-checkout' then raise exception 'Order is not available for a new checkout' using errcode='22023'; end if;
  if v_order.client_id is null then raise exception 'Link this order to a client to redeem loyalty rewards' using errcode='22023'; end if;
  if v_order.loyalty_reward_id is not null then raise exception 'A loyalty reward is already applied to this order' using errcode='22023'; end if;

  select * into v_client from public.clients where id=v_order.client_id and tenant_id=v_actor.tenant_id for update;
  if not found then raise exception 'Client not found in your barber shop' using errcode='P0002'; end if;
  select * into v_reward from public.loyalty_rewards
  where id=p_reward_id and tenant_id=v_actor.tenant_id and active for update;
  if not found then raise exception 'Reward is unavailable' using errcode='P0002'; end if;
  if v_order.service_price<=0 then raise exception 'This reward requires a paid service on the order' using errcode='22023'; end if;
  if v_client.loyalty_points<v_reward.points_cost then raise exception 'Client does not have enough loyalty points' using errcode='22023'; end if;

  v_discount:=case v_reward.reward_type
    when 'free_service' then v_order.service_price
    when 'fixed_service_discount' then least(v_order.service_price,v_reward.reward_value)
    when 'percent_service_discount' then round(v_order.service_price*v_reward.reward_value/100,2)
  end;
  update public.clients set loyalty_points=loyalty_points-v_reward.points_cost
  where id=v_client.id and tenant_id=v_actor.tenant_id returning loyalty_points into v_balance;
  update public.service_orders set loyalty_reward_id=v_reward.id,loyalty_discount=v_discount,updated_at=now()
  where id=v_order.id and tenant_id=v_actor.tenant_id;
  insert into public.loyalty_redemptions(tenant_id,client_id,reward_id,points,redeemed_by)
  values(v_actor.tenant_id,v_client.id,v_reward.id,v_reward.points_cost,(select auth.uid()))
  returning id into v_redemption_id;
  insert into public.loyalty_ledger(client_id,points,entry_type,description)
  values(v_client.id,-v_reward.points_cost,'redeemed','Canje aplicado: '||v_reward.name);

  v_payment_id:=public.complete_checkout(
    p_order_id,p_subtotal,p_tax,p_tip,p_total,p_method,coalesce(p_splits,'[]'::jsonb),(select auth.uid())
  );
  update public.loyalty_redemptions set payment_id=v_payment_id where id=v_redemption_id;
  select c.loyalty_points into v_balance from public.clients c where c.id=v_client.id and c.tenant_id=v_actor.tenant_id;
  return jsonb_build_object('payment_id',v_payment_id,'points_balance',v_balance,'reward_name',v_reward.name,'discount',v_discount);
end;
$$;
revoke all on function public.complete_checkout(text,numeric,numeric,numeric,numeric,public.payment_method,jsonb,uuid) from public,anon;
grant execute on function public.complete_checkout(text,numeric,numeric,numeric,numeric,public.payment_method,jsonb,uuid) to authenticated;
revoke all on function public.complete_checkout_with_loyalty_reward(text,numeric,numeric,numeric,numeric,public.payment_method,jsonb,uuid) from public,anon;
grant execute on function public.complete_checkout_with_loyalty_reward(text,numeric,numeric,numeric,numeric,public.payment_method,jsonb,uuid) to authenticated;

commit;


