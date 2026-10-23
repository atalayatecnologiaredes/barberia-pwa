begin;

drop policy if exists "owner manages shifts" on public.staff_shifts;
drop policy if exists "staff shift owner or self" on public.staff_shifts;

create policy "staff shifts visible in own shop"
on public.staff_shifts
for select
to authenticated
using (
  profile_id = (select auth.uid())
  or exists (
    select 1
    from public.profiles actor
    join public.profiles staff on staff.tenant_id = actor.tenant_id
    where actor.id = (select auth.uid())
      and actor.active
      and actor.role = 'SUPER_ADMIN'
      and staff.id = staff_shifts.profile_id
  )
);

create index if not exists staff_shifts_profile_schedule_idx
on public.staff_shifts (profile_id, starts_at, ends_at);

commit;
