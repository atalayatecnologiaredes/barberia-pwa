create index if not exists service_orders_loyalty_reward_tenant_idx
  on public.service_orders (loyalty_reward_id, tenant_id)
  where loyalty_reward_id is not null;