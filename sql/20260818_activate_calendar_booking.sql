-- Activa reservas idempotentes entre WhatsApp, Supabase y Google Calendar.

alter table public.gabriel_appointments
  add column if not exists booking_message_id text;

create unique index if not exists gabriel_appointments_booking_message_idx
  on public.gabriel_appointments(booking_message_id)
  where booking_message_id is not null;

-- La consulta freeBusy de Google no es una operación de bloqueo. Esta
-- restricción hace que Postgres sea la última barrera atómica contra dos
-- reservas concurrentes para el mismo intervalo.
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

create or replace function public.gabriel_hold_appointment(
  p_session_id text,
  p_booking_message_id text,
  p_customer_name text,
  p_customer_phone text,
  p_topic text,
  p_modality text,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
returns table (
  appointment_id uuid,
  appointment_status text,
  google_event_id text,
  result text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if length(trim(coalesce(p_session_id, ''))) not between 8 and 100
    or length(trim(coalesce(p_booking_message_id, ''))) not between 3 and 250
    or length(trim(coalesce(p_customer_name, ''))) not between 2 and 100
    or p_customer_phone !~ '^[0-9]{8,15}$'
    or length(trim(coalesce(p_topic, ''))) not between 8 and 500
    or p_modality not in ('Teléfono', 'Videollamada', 'Presencial')
    or p_ends_at <= p_starts_at
    or p_starts_at <= now()
  then
    return query select null::uuid, null::text, null::text, 'invalid'::text;
    return;
  end if;

  update public.gabriel_appointments
  set status = 'cancelled', updated_at = now()
  where status = 'hold'
    and hold_expires_at is not null
    and hold_expires_at <= now();

  return query
  select
    a.id,
    a.status,
    a.google_event_id,
    case when a.booking_message_id = p_booking_message_id
      then 'existing'::text
      else 'active_exists'::text
    end
  from public.gabriel_appointments a
  where a.booking_message_id = p_booking_message_id
     or (a.session_id = p_session_id and a.status in ('hold', 'confirmed'))
  order by (a.booking_message_id = p_booking_message_id) desc, a.created_at desc
  limit 1;
  if found then return; end if;

  begin
    return query
    insert into public.gabriel_appointments (
      session_id,
      booking_message_id,
      customer_name,
      customer_phone,
      topic,
      modality,
      starts_at,
      ends_at,
      status,
      hold_expires_at,
      source,
      updated_at
    ) values (
      left(trim(p_session_id), 100),
      left(trim(p_booking_message_id), 250),
      left(trim(p_customer_name), 100),
      p_customer_phone,
      left(trim(p_topic), 500),
      p_modality,
      p_starts_at,
      p_ends_at,
      'hold',
      now() + interval '10 minutes',
      'whatsapp',
      now()
    )
    returning id, status, public.gabriel_appointments.google_event_id, 'held'::text;
  exception
    when exclusion_violation or unique_violation then
      return query select null::uuid, null::text, null::text, 'unavailable'::text;
  end;
end;
$$;

revoke all on function public.gabriel_hold_appointment(text, text, text, text, text, text, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.gabriel_hold_appointment(text, text, text, text, text, text, timestamptz, timestamptz)
  to service_role;

create or replace function public.gabriel_confirm_appointment(
  p_appointment_id uuid,
  p_google_event_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  if length(trim(coalesce(p_google_event_id, ''))) not between 5 and 1024 then
    return false;
  end if;

  update public.gabriel_appointments
  set google_event_id = left(trim(p_google_event_id), 1024),
      status = 'confirmed',
      hold_expires_at = null,
      updated_at = now()
  where id = p_appointment_id
    and status in ('hold', 'confirmed')
    and (google_event_id is null or google_event_id = p_google_event_id);
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.gabriel_confirm_appointment(uuid, text)
  from public, anon, authenticated;
grant execute on function public.gabriel_confirm_appointment(uuid, text)
  to service_role;

create or replace function public.gabriel_release_appointment(
  p_appointment_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  update public.gabriel_appointments
  set status = 'cancelled', hold_expires_at = null, updated_at = now()
  where id = p_appointment_id
    and status = 'hold'
    and google_event_id is null;
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.gabriel_release_appointment(uuid)
  from public, anon, authenticated;
grant execute on function public.gabriel_release_appointment(uuid)
  to service_role;
