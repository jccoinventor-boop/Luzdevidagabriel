-- Remove the redundant overlap exclusion constraint only when both copies are
-- present and PostgreSQL reports them as semantically identical.
do $$
declare
  active_definition text;
  duplicate_definition text;
begin
  select pg_get_constraintdef(oid, true)
    into active_definition
  from pg_constraint
  where conrelid = 'public.gabriel_appointments'::regclass
    and conname = 'gabriel_appointments_no_active_overlap';

  select pg_get_constraintdef(oid, true)
    into duplicate_definition
  from pg_constraint
  where conrelid = 'public.gabriel_appointments'::regclass
    and conname = 'gabriel_appointments_no_overlap';

  if active_definition is not null
     and duplicate_definition is not null
     and active_definition = duplicate_definition then
    alter table public.gabriel_appointments
      drop constraint gabriel_appointments_no_overlap;
  end if;
end
$$;
