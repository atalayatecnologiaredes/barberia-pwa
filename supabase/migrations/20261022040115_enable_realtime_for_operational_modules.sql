do $$
declare
  target_table text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise exception 'La publicación supabase_realtime no existe.';
  end if;

  foreach target_table in array array[
    'payments',
    'commissions',
    'inventory_items',
    'inventory_movements',
    'restock_requests',
    'barber_toolkit_items',
    'services',
    'barbers',
    'profiles',
    'staff_shifts',
    'tenants',
    'saas_subscriptions'
  ] loop
    if to_regclass(format('public.%I', target_table)) is not null
       and not exists (
         select 1
         from pg_publication_tables
         where pubname = 'supabase_realtime'
           and schemaname = 'public'
           and tablename = target_table
       ) then
      execute format('alter publication supabase_realtime add table public.%I', target_table);
    end if;
  end loop;
end;
$$;
