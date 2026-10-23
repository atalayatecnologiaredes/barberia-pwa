-- Let each shop owner edit the name of their own tenant from the signed-in app.
begin;

grant update (name) on public.tenants to authenticated;

drop policy if exists "tenant owners update own tenant name" on public.tenants;
create policy "tenant owners update own tenant name" on public.tenants
  for update to authenticated
  using (
    id = (select p.tenant_id from public.profiles p where p.id = (select auth.uid()))
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.role = 'SUPER_ADMIN'
    )
  )
  with check (
    id = (select p.tenant_id from public.profiles p where p.id = (select auth.uid()))
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.role = 'SUPER_ADMIN'
    )
  );

commit;
