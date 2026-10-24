begin;

create table if not exists public.report_export_audit (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  report_key text not null check (report_key in ('analytics_payments')),
  file_format text not null check (file_format in ('csv','pdf')),
  date_from date not null,
  date_to date not null,
  created_at timestamptz not null default now(),
  check (date_to >= date_from)
);

create index if not exists report_export_audit_tenant_created_idx
  on public.report_export_audit(tenant_id, created_at desc);

alter table public.report_export_audit enable row level security;
drop policy if exists "owners record subscribed report exports" on public.report_export_audit;
create policy "owners record subscribed report exports" on public.report_export_audit
  for insert to authenticated with check (
    profile_id = (select auth.uid())
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.tenant_id = report_export_audit.tenant_id and p.role = 'SUPER_ADMIN'
    )
    and exists (
      select 1 from public.saas_subscriptions s
      join public.saas_settings cfg on cfg.singleton
      where s.tenant_id = report_export_audit.tenant_id
        and s.status in ('trialing','active')
        and s.current_period_end + make_interval(days => cfg.grace_days) > now()
    )
  );
drop policy if exists "owners read own export history" on public.report_export_audit;
create policy "owners read own export history" on public.report_export_audit
  for select to authenticated using (
    exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.tenant_id = report_export_audit.tenant_id and p.role = 'SUPER_ADMIN')
  );
revoke all on public.report_export_audit from anon, authenticated;
grant select, insert on public.report_export_audit to authenticated;

commit;
