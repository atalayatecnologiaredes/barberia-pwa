begin;

alter table public.tenants
  add column if not exists address text not null default '',
  add column if not exists tax_rate numeric(6,5) not null default 0.15,
  add column if not exists receipt_footer text not null default 'Gracias por tu visita';

update public.tenants set phone = '' where phone is null;
alter table public.tenants alter column phone set default '';
alter table public.tenants alter column phone set not null;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.tenants'::regclass
      and conname = 'tenants_tax_rate_range_check'
  ) then
    alter table public.tenants
      add constraint tenants_tax_rate_range_check check (tax_rate between 0 and 0.25);
  end if;
end;
$$;

revoke update on table public.tenants from authenticated;
revoke update (id, slug, email, active, created_at, updated_at)
  on table public.tenants from authenticated;
grant update (name, phone, address, tax_rate, receipt_footer)
  on table public.tenants to authenticated;

drop policy if exists "tenant owners update own tenant name" on public.tenants;
drop policy if exists "tenant owners update own tenant" on public.tenants;
create policy "tenant owners update own settings" on public.tenants
  for update to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.active
      and p.role = 'SUPER_ADMIN'
      and p.tenant_id = tenants.id
  ))
  with check (exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.active
      and p.role = 'SUPER_ADMIN'
      and p.tenant_id = tenants.id
  ));

notify pgrst, 'reload schema';
commit;
