begin;

drop policy if exists "loyalty rewards owner management" on public.loyalty_rewards;
drop policy if exists "loyalty rewards staff read" on public.loyalty_rewards;

create policy "loyalty rewards staff read" on public.loyalty_rewards
  for select to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.active
      and p.tenant_id = loyalty_rewards.tenant_id
      and (p.role = 'SUPER_ADMIN' or (p.role = 'RECEPCION' and loyalty_rewards.active))
  ));

create policy "loyalty rewards owner insert" on public.loyalty_rewards
  for insert to authenticated
  with check (exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.active and p.role = 'SUPER_ADMIN'
      and p.tenant_id = loyalty_rewards.tenant_id
  ));

create policy "loyalty rewards owner update" on public.loyalty_rewards
  for update to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.active and p.role = 'SUPER_ADMIN'
      and p.tenant_id = loyalty_rewards.tenant_id
  ))
  with check (exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.active and p.role = 'SUPER_ADMIN'
      and p.tenant_id = loyalty_rewards.tenant_id
  ));

create policy "loyalty rewards owner delete" on public.loyalty_rewards
  for delete to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.active and p.role = 'SUPER_ADMIN'
      and p.tenant_id = loyalty_rewards.tenant_id
  ));

create index if not exists loyalty_redemptions_client_fk_idx on public.loyalty_redemptions (client_id);
create index if not exists loyalty_redemptions_reward_fk_idx on public.loyalty_redemptions (reward_id, tenant_id);
create index if not exists loyalty_redemptions_payment_fk_idx on public.loyalty_redemptions (payment_id);
create index if not exists loyalty_redemptions_redeemed_by_fk_idx on public.loyalty_redemptions (redeemed_by);

commit;
