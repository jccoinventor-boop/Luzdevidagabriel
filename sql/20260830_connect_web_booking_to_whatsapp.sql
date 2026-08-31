-- Permite que el webhook firmado de WhatsApp recupere un apartado creado en la web.
-- El código corto siempre se valida junto con el teléfono y la vigencia del apartado.

create or replace function public.gabriel_get_web_booking_for_whatsapp(
  p_customer_phone text,
  p_booking_code text
)
returns table (
  appointment_id uuid,
  customer_name text,
  customer_phone text,
  topic text,
  modality text,
  starts_at timestamptz,
  ends_at timestamptz,
  appointment_status text,
  google_event_id text,
  hold_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_customer_phone !~ '^[0-9]{8,15}$'
    or p_booking_code !~* '^[0-9a-f]{8}$'
  then
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
    a.customer_name,
    a.customer_phone,
    a.topic,
    a.modality,
    a.starts_at,
    a.ends_at,
    a.status,
    a.google_event_id,
    a.hold_expires_at
  from public.gabriel_appointments a
  where a.source = 'web_direct'
    and right(p_customer_phone, 10) = a.customer_phone
    and upper(left(a.id::text, 8)) = upper(p_booking_code)
    and (
      a.status = 'confirmed'
      or (a.status = 'hold' and a.hold_expires_at > now())
    )
  order by a.created_at desc
  limit 1;
end;
$$;

revoke all on function public.gabriel_get_web_booking_for_whatsapp(text, text)
  from public, anon, authenticated;
grant execute on function public.gabriel_get_web_booking_for_whatsapp(text, text)
  to service_role;
