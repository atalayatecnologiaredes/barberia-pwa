begin;

do $$
declare
  v_function record;
  v_definition text;
  v_updated text;
  v_changed integer := 0;
begin
  for v_function in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosrc like '%s.current_period_end is null or s.current_period_end>now()%'
  loop
    v_definition := pg_get_functiondef(v_function.oid);
    v_updated := replace(
      v_definition,
      's.current_period_end is null or s.current_period_end>now()',
      's.current_period_end is null or s.current_period_end + make_interval(days => coalesce((select grace_days from public.saas_settings where singleton), 0)) > now()'
    );
    if v_updated = v_definition then
      raise exception 'Could not apply subscription grace to function OID %', v_function.oid;
    end if;
    execute v_updated;
    v_changed := v_changed + 1;
  end loop;

  if v_changed < 1 then
    raise exception 'Expected at least one subscription expiry guard to update';
  end if;
end;
$$;

commit;
