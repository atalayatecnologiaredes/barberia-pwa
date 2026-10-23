begin;

create or replace function public.create_staff_shift(
  p_profile_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_notes text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_role public.app_role;
  v_shift_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select p.tenant_id, p.role into v_tenant, v_role
  from public.profiles p
  where p.id = auth.uid() and p.active;

  if not found or v_tenant is null or v_role <> 'SUPER_ADMIN' then
    raise exception 'Only an active shop owner can schedule staff shifts' using errcode = '42501';
  end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception 'Shift end must be after its start' using errcode = '22023';
  end if;
  if length(coalesce(p_notes, '')) > 300 then
    raise exception 'Shift notes cannot exceed 300 characters' using errcode = '22023';
  end if;

  -- Serialize scheduling attempts for this staff profile before checking overlaps.
  perform 1 from public.profiles p
  where p.id = p_profile_id and p.tenant_id = v_tenant and p.active
    and p.role in ('BARBER', 'RECEPCION')
  for update;
  if not found then
    raise exception 'Active staff member not found in this shop' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.staff_shifts s
    where s.profile_id = p_profile_id
      and s.starts_at < p_ends_at
      and s.ends_at > p_starts_at
  ) then
    raise exception 'Staff member already has a shift at that time' using errcode = '23P01';
  end if;

  insert into public.staff_shifts(profile_id, starts_at, ends_at, notes)
  values (p_profile_id, p_starts_at, p_ends_at, coalesce(p_notes, ''))
  returning id into v_shift_id;

  return v_shift_id;
end;
$$;

create or replace function public.set_staff_shift_attendance(p_shift_id uuid, p_action text)
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
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select p.tenant_id, p.role into v_tenant, v_role
  from public.profiles p
  where p.id = auth.uid() and p.active;

  if not found or v_tenant is null or v_role <> 'SUPER_ADMIN' then
    raise exception 'Only an active shop owner can manage attendance' using errcode = '42501';
  end if;

  select s.* into v_shift
  from public.staff_shifts s
  join public.profiles staff on staff.id = s.profile_id
  where s.id = p_shift_id
    and staff.tenant_id = v_tenant
    and staff.active
    and staff.role in ('BARBER', 'RECEPCION')
  for update of s;

  if not found then
    raise exception 'Shift not found in this shop' using errcode = 'P0002';
  end if;

  if p_action = 'check_in' and v_shift.checked_in_at is null and v_shift.checked_out_at is null then
    update public.staff_shifts set checked_in_at = now() where id = v_shift.id;
  elsif p_action = 'check_out' and v_shift.checked_in_at is not null and v_shift.checked_out_at is null then
    update public.staff_shifts set checked_out_at = now() where id = v_shift.id;
  else
    raise exception 'Invalid attendance transition' using errcode = '22023';
  end if;
end;
$$;

revoke all on public.staff_shifts from authenticated;
grant select on public.staff_shifts to authenticated;

revoke all on function public.create_staff_shift(uuid, timestamptz, timestamptz, text) from public, anon;
revoke all on function public.set_staff_shift_attendance(uuid, text) from public, anon;
grant execute on function public.create_staff_shift(uuid, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.set_staff_shift_attendance(uuid, text) to authenticated;

commit;
