begin;
revoke all on public.appointments, public.queue_visits, public.service_orders, public.order_lines from authenticated;
grant select on public.appointments, public.queue_visits, public.service_orders, public.order_lines to authenticated;
commit;
