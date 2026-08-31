-- Reserva web gratuita y atómica, sin depender de Netlify, Meta o Google Cloud.
-- La agenda de Supabase es la fuente de verdad para evitar dobles reservas.

create or replace function public.gabriel_book_web_appointment(
  p_client_key text,
  p_session_id text,
  p_customer_name text,
  p_customer_phone text,
  p_topic text,
  p_modality text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_attribution jsonb default '{}'::jsonb
)
returns table (
  appointment_id uuid,
  appointment_status text,
  starts_at timestamptz,
  ends_at timestamptz,
  result text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if length(coalesce(p_client_key, '')) <> 64
    or p_session_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or length(trim(coalesce(p_customer_name, ''))) not between 2 and 100
    or p_customer_phone !~ '^[0-9]{10}$'
    or length(trim(coalesce(p_topic, ''))) not between 8 and 500
    or p_modality not in ('Teléfono', 'Videollamada', 'Presencial')
    or p_ends_at <= p_starts_at
    or p_ends_at - p_starts_at <> interval '60 minutes'
    or p_starts_at <= now() + interval '15 minutes'
    or p_starts_at > now() + interval '180 days'
    or jsonb_typeof(coalesce(p_attribution, '{}'::jsonb)) <> 'object'
  then
    return query select null::uuid, null::text, null::timestamptz, null::timestamptz, 'invalid'::text;
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
    a.starts_at,
    a.ends_at,
    case
      when a.customer_phone = p_customer_phone then 'existing'::text
      else 'invalid'::text
    end
  from public.gabriel_appointments a
  where a.session_id = p_session_id
    and a.status in ('hold', 'confirmed')
  order by a.created_at desc
  limit 1;
  if found then return; end if;

  insert into public.gabriel_request_limits (
    client_key, scope, window_started_at, request_count, updated_at
  ) values (
    p_client_key, 'booking', now(), 1, now()
  )
  on conflict (client_key, scope) do update
  set window_started_at = case
        when public.gabriel_request_limits.window_started_at <= now() - interval '1 hour' then now()
        else public.gabriel_request_limits.window_started_at
      end,
      request_count = case
        when public.gabriel_request_limits.window_started_at <= now() - interval '1 hour' then 1
        else public.gabriel_request_limits.request_count + 1
      end,
      updated_at = now()
  where public.gabriel_request_limits.window_started_at <= now() - interval '1 hour'
     or public.gabriel_request_limits.request_count < 5;

  if not found then
    return query select null::uuid, null::text, null::timestamptz, null::timestamptz, 'rate_limited'::text;
    return;
  end if;

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
      attribution,
      updated_at
    ) values (
      p_session_id,
      'web:' || p_session_id,
      left(trim(p_customer_name), 100),
      p_customer_phone,
      left(trim(p_topic), 500),
      p_modality,
      p_starts_at,
      p_ends_at,
      'hold',
      now() + interval '30 minutes',
      'web_direct',
      coalesce(p_attribution, '{}'::jsonb),
      now()
    )
    returning
      public.gabriel_appointments.id,
      public.gabriel_appointments.status,
      public.gabriel_appointments.starts_at,
      public.gabriel_appointments.ends_at,
      'inserted'::text;
  exception
    when exclusion_violation or unique_violation then
      return query select null::uuid, null::text, null::timestamptz, null::timestamptz, 'unavailable'::text;
  end;
end;
$$;

alter table public.gabriel_request_limits
  drop constraint if exists gabriel_request_limits_scope_check;
alter table public.gabriel_request_limits
  add constraint gabriel_request_limits_scope_check
  check (scope in ('telemetry', 'qualified', 'booking'));

revoke all on function public.gabriel_book_web_appointment(text, text, text, text, text, text, timestamptz, timestamptz, jsonb)
  from public, anon, authenticated;
grant execute on function public.gabriel_book_web_appointment(text, text, text, text, text, text, timestamptz, timestamptz, jsonb)
  to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'gabriel-chat',
  'gabriel-chat',
  true,
  2097152,
  array['text/html', 'text/css', 'application/javascript']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- No se crean políticas de escritura pública. Los archivos se publican con un
-- proceso administrativo temporal y el sitio final sólo permite lectura.
