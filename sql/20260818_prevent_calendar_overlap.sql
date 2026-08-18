-- Seguimiento para proyectos donde activate_calendar_booking ya fue aplicada.
-- Impide atómicamente que dos holds/confirmaciones ocupen el mismo intervalo.

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'gabriel_appointments_no_overlap'
      and conrelid = 'public.gabriel_appointments'::regclass
  ) then
    alter table public.gabriel_appointments
      add constraint gabriel_appointments_no_overlap
      exclude using gist (
        tstzrange(starts_at, ends_at, '[)') with &&
      )
      where (status in ('hold', 'confirmed'));
  end if;
end;
$$;
