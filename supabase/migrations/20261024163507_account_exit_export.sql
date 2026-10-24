begin;

alter table public.report_export_audit
  drop constraint if exists report_export_audit_report_key_check;
alter table public.report_export_audit
  add constraint report_export_audit_report_key_check
  check (report_key in ('analytics_payments','account_exit'));
alter table public.report_export_audit
  drop constraint if exists report_export_audit_file_format_check;
alter table public.report_export_audit
  add constraint report_export_audit_file_format_check
  check (file_format in ('csv','pdf','json'));

drop policy if exists "owners record subscribed report exports" on public.report_export_audit;
create policy "owners record subscribed report exports" on public.report_export_audit
  for insert to authenticated with check (
    profile_id = (select auth.uid())
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.tenant_id = report_export_audit.tenant_id and p.role = 'SUPER_ADMIN'
    )
    and (
      report_key = 'account_exit'
      or exists (
        select 1 from public.saas_subscriptions s
        join public.saas_settings cfg on cfg.singleton
        where s.tenant_id = report_export_audit.tenant_id
          and s.status in ('trialing','active')
          and s.current_period_end + make_interval(days => cfg.grace_days) > now()
      )
    )
  );

commit;
