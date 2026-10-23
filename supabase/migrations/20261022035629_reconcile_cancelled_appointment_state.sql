begin;

-- A cancelled queue visit is terminal; its linked appointment must not remain
-- displayed as currently in the chair.
update public.appointments a
set status='cancelled',updated_at=now()
where a.status in ('waiting','in-chair')
  and exists(
    select 1 from public.queue_visits q
    where q.appointment_id=a.id and q.tenant_id=a.tenant_id and q.status='cancelled'
  );

commit;
