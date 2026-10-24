begin;

create or replace function public.update_staff_shift(
  p_shift_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_notes text default ''
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_role public.app_role;
  v_shift public.staff_shifts%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select tenant_id, role into v_tenant, v_role from public.profiles where id = auth.uid() and active;
  if not found or v_tenant is null or v_role <> 'SUPER_ADMIN' then
    raise exception 'Only an active shop owner can update staff shifts' using errcode = '42501';
  end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception 'Shift end must be after its start' using errcode = '22023';
  end if;
  if length(coalesce(p_notes, '')) > 300 then
    raise exception 'Shift notes cannot exceed 300 characters' using errcode = '22023';
  end if;

  select s.* into v_shift
  from public.staff_shifts s
  join public.profiles staff on staff.id = s.profile_id
  where s.id = p_shift_id and staff.tenant_id = v_tenant and staff.active
  for update of s;
  if not found then raise exception 'Shift not found in this shop' using errcode = 'P0002'; end if;
  if v_shift.checked_in_at is not null or v_shift.checked_out_at is not null then
    raise exception 'Attendance has already started for this shift' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.staff_shifts s
    where s.profile_id = v_shift.profile_id and s.id <> v_shift.id
      and s.starts_at < p_ends_at and s.ends_at > p_starts_at
  ) then raise exception 'Staff member already has a shift at that time' using errcode = '23P01'; end if;

  update public.staff_shifts
  set starts_at = p_starts_at, ends_at = p_ends_at, notes = coalesce(p_notes, '')
  where id = v_shift.id;
end;
$$;

create or replace function public.cancel_staff_shift(p_shift_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_role public.app_role;
  v_shift public.staff_shifts%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select tenant_id, role into v_tenant, v_role from public.profiles where id = auth.uid() and active;
  if not found or v_tenant is null or v_role <> 'SUPER_ADMIN' then
    raise exception 'Only an active shop owner can cancel staff shifts' using errcode = '42501';
  end if;

  select s.* into v_shift
  from public.staff_shifts s
  join public.profiles staff on staff.id = s.profile_id
  where s.id = p_shift_id and staff.tenant_id = v_tenant and staff.active
  for update of s;
  if not found then raise exception 'Shift not found in this shop' using errcode = 'P0002'; end if;
  if v_shift.checked_in_at is not null or v_shift.checked_out_at is not null then
    raise exception 'Attendance has already started for this shift' using errcode = '22023';
  end if;

  delete from public.staff_shifts where id = v_shift.id;
end;
$$;

revoke all on function public.update_staff_shift(uuid, timestamptz, timestamptz, text) from public, anon;
revoke all on function public.cancel_staff_shift(uuid) from public, anon;
grant execute on function public.update_staff_shift(uuid, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.cancel_staff_shift(uuid) to authenticated;

commit;
