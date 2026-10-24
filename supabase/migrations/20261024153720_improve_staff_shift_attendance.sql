begin;

alter table public.staff_shifts
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references auth.users(id) on delete set null,
  add column if not exists absence_marked_at timestamptz,
  add column if not exists absence_marked_by uuid references auth.users(id) on delete set null,
  add column if not exists absence_reason text not null default '';

do $$ begin
  if not exists(select 1 from pg_constraint where conname='staff_shifts_cancellation_state_check' and conrelid='public.staff_shifts'::regclass) then
    alter table public.staff_shifts add constraint staff_shifts_cancellation_state_check
      check(cancelled_at is null or (checked_in_at is null and checked_out_at is null and absence_marked_at is null));
  end if;
  if not exists(select 1 from pg_constraint where conname='staff_shifts_absence_state_check' and conrelid='public.staff_shifts'::regclass) then
    alter table public.staff_shifts add constraint staff_shifts_absence_state_check
      check(absence_marked_at is null or (checked_in_at is null and checked_out_at is null and cancelled_at is null));
  end if;
  if not exists(select 1 from pg_constraint where conname='staff_shifts_absence_reason_length_check' and conrelid='public.staff_shifts'::regclass) then
    alter table public.staff_shifts add constraint staff_shifts_absence_reason_length_check check(length(absence_reason)<=300);
  end if;
end $$;

create or replace function public.create_staff_shift(
  p_profile_id uuid,p_starts_at timestamptz,p_ends_at timestamptz,p_notes text default ''
)
returns uuid language plpgsql security definer set search_path=''
as $$
declare v_tenant uuid; v_role public.app_role; v_shift_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select tenant_id,role into v_tenant,v_role from public.profiles where id=(select auth.uid()) and active;
  if not found or v_tenant is null or v_role<>'SUPER_ADMIN' then raise exception 'Only an active shop owner can schedule staff shifts' using errcode='42501'; end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at<=p_starts_at then raise exception 'Shift end must be after its start' using errcode='22023'; end if;
  if length(coalesce(p_notes,''))>300 then raise exception 'Shift notes cannot exceed 300 characters' using errcode='22023'; end if;
  perform 1 from public.profiles p where p.id=p_profile_id and p.tenant_id=v_tenant and p.active and p.role in ('BARBER','RECEPCION') for update;
  if not found then raise exception 'Active staff member not found in this shop' using errcode='P0002'; end if;
  if exists(select 1 from public.staff_shifts s where s.profile_id=p_profile_id and s.cancelled_at is null and s.starts_at<p_ends_at and s.ends_at>p_starts_at) then
    raise exception 'Staff member already has a shift at that time' using errcode='23P01';
  end if;
  insert into public.staff_shifts(profile_id,starts_at,ends_at,notes) values(p_profile_id,p_starts_at,p_ends_at,coalesce(p_notes,'')) returning id into v_shift_id;
  return v_shift_id;
end;
$$;

create or replace function public.update_staff_shift(
  p_shift_id uuid,p_starts_at timestamptz,p_ends_at timestamptz,p_notes text default ''
)
returns void language plpgsql security definer set search_path=''
as $$
declare v_tenant uuid; v_role public.app_role; v_shift public.staff_shifts%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select tenant_id,role into v_tenant,v_role from public.profiles where id=(select auth.uid()) and active;
  if not found or v_tenant is null or v_role<>'SUPER_ADMIN' then raise exception 'Only an active shop owner can update staff shifts' using errcode='42501'; end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at<=p_starts_at then raise exception 'Shift end must be after its start' using errcode='22023'; end if;
  if length(coalesce(p_notes,''))>300 then raise exception 'Shift notes cannot exceed 300 characters' using errcode='22023'; end if;
  select s.* into v_shift from public.staff_shifts s join public.profiles staff on staff.id=s.profile_id
  where s.id=p_shift_id and staff.tenant_id=v_tenant and staff.active for update of s;
  if not found then raise exception 'Shift not found in this shop' using errcode='P0002'; end if;
  if v_shift.checked_in_at is not null or v_shift.checked_out_at is not null or v_shift.cancelled_at is not null or v_shift.absence_marked_at is not null then
    raise exception 'This shift can no longer be edited' using errcode='22023';
  end if;
  perform 1 from public.profiles p where p.id=v_shift.profile_id and p.tenant_id=v_tenant and p.active for update;
  if not found then raise exception 'Active staff member not found in this shop' using errcode='P0002'; end if;
  if exists(select 1 from public.staff_shifts s where s.profile_id=v_shift.profile_id and s.id<>v_shift.id and s.cancelled_at is null and s.starts_at<p_ends_at and s.ends_at>p_starts_at) then
    raise exception 'Staff member already has a shift at that time' using errcode='23P01';
  end if;
  update public.staff_shifts set starts_at=p_starts_at,ends_at=p_ends_at,notes=coalesce(p_notes,'') where id=v_shift.id;
end;
$$;

create or replace function public.cancel_staff_shift(p_shift_id uuid)
returns void language plpgsql security definer set search_path=''
as $$
declare v_tenant uuid; v_role public.app_role; v_shift public.staff_shifts%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select tenant_id,role into v_tenant,v_role from public.profiles where id=(select auth.uid()) and active;
  if not found or v_tenant is null or v_role<>'SUPER_ADMIN' then raise exception 'Only an active shop owner can cancel staff shifts' using errcode='42501'; end if;
  select s.* into v_shift from public.staff_shifts s join public.profiles staff on staff.id=s.profile_id
  where s.id=p_shift_id and staff.tenant_id=v_tenant for update of s;
  if not found then raise exception 'Shift not found in this shop' using errcode='P0002'; end if;
  if v_shift.checked_in_at is not null or v_shift.checked_out_at is not null or v_shift.cancelled_at is not null or v_shift.absence_marked_at is not null then
    raise exception 'This shift can no longer be cancelled' using errcode='22023';
  end if;
  if v_shift.starts_at<=clock_timestamp() then raise exception 'Past shifts must be recorded as an absence after their end time' using errcode='22023'; end if;
  update public.staff_shifts set cancelled_at=clock_timestamp(),cancelled_by=(select auth.uid()) where id=v_shift.id;
end;
$$;

create or replace function public.mark_staff_shift_absent(p_shift_id uuid,p_reason text default '')
returns void language plpgsql security definer set search_path=''
as $$
declare v_tenant uuid; v_role public.app_role; v_shift public.staff_shifts%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select tenant_id,role into v_tenant,v_role from public.profiles where id=(select auth.uid()) and active;
  if not found or v_tenant is null or v_role<>'SUPER_ADMIN' then raise exception 'Only an active shop owner can record staff absences' using errcode='42501'; end if;
  if length(coalesce(p_reason,''))>300 then raise exception 'Absence reason cannot exceed 300 characters' using errcode='22023'; end if;
  select s.* into v_shift from public.staff_shifts s join public.profiles staff on staff.id=s.profile_id
  where s.id=p_shift_id and staff.tenant_id=v_tenant for update of s;
  if not found then raise exception 'Shift not found in this shop' using errcode='P0002'; end if;
  if v_shift.ends_at>clock_timestamp() then raise exception 'An absence can only be recorded after the scheduled shift ends' using errcode='22023'; end if;
  if v_shift.checked_in_at is not null or v_shift.checked_out_at is not null or v_shift.cancelled_at is not null or v_shift.absence_marked_at is not null then
    raise exception 'This shift cannot be recorded as an absence' using errcode='22023';
  end if;
  update public.staff_shifts set absence_marked_at=clock_timestamp(),absence_marked_by=(select auth.uid()),absence_reason=coalesce(p_reason,'') where id=v_shift.id;
end;
$$;

create or replace function public.set_staff_shift_attendance(p_shift_id uuid,p_action text)
returns void language plpgsql security definer set search_path=''
as $$
declare v_tenant uuid; v_role public.app_role; v_shift public.staff_shifts%rowtype; v_now timestamptz:=clock_timestamp();
begin
  if (select auth.uid()) is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select tenant_id,role into v_tenant,v_role from public.profiles where id=(select auth.uid()) and active;
  if not found or v_tenant is null or v_role<>'SUPER_ADMIN' then raise exception 'Only an active shop owner can manage attendance' using errcode='42501'; end if;
  select s.* into v_shift from public.staff_shifts s join public.profiles staff on staff.id=s.profile_id
  where s.id=p_shift_id and staff.tenant_id=v_tenant and staff.active and staff.role in ('BARBER','RECEPCION') for update of s;
  if not found then raise exception 'Shift not found in this shop' using errcode='P0002'; end if;
  if v_shift.cancelled_at is not null or v_shift.absence_marked_at is not null then raise exception 'Cancelled or absent shifts cannot receive attendance' using errcode='22023'; end if;
  if p_action='check_in' and v_shift.checked_in_at is null and v_shift.checked_out_at is null then
    if v_now<v_shift.starts_at-interval '30 minutes' then raise exception 'Entry can be recorded starting 30 minutes before the shift' using errcode='22023'; end if;
    if v_now>v_shift.ends_at then raise exception 'The shift has ended; record the absence instead' using errcode='22023'; end if;
    update public.staff_shifts set checked_in_at=v_now where id=v_shift.id;
  elsif p_action='check_out' and v_shift.checked_in_at is not null and v_shift.checked_out_at is null then
    update public.staff_shifts set checked_out_at=v_now where id=v_shift.id;
  else raise exception 'Invalid attendance transition' using errcode='22023'; end if;
end;
$$;

revoke all on function public.create_staff_shift(uuid,timestamptz,timestamptz,text) from public,anon;
revoke all on function public.update_staff_shift(uuid,timestamptz,timestamptz,text) from public,anon;
revoke all on function public.cancel_staff_shift(uuid) from public,anon;
revoke all on function public.mark_staff_shift_absent(uuid,text) from public,anon;
revoke all on function public.set_staff_shift_attendance(uuid,text) from public,anon;
grant execute on function public.create_staff_shift(uuid,timestamptz,timestamptz,text) to authenticated;
grant execute on function public.update_staff_shift(uuid,timestamptz,timestamptz,text) to authenticated;
grant execute on function public.cancel_staff_shift(uuid) to authenticated;
grant execute on function public.mark_staff_shift_absent(uuid,text) to authenticated;
grant execute on function public.set_staff_shift_attendance(uuid,text) to authenticated;

commit;
