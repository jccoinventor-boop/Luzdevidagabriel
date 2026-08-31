-- Clasificación durable del asistente de WhatsApp.

alter table public.gabriel_whatsapp_sessions
  add column if not exists lead_score smallint not null default 0,
  add column if not exists lead_class text not null default 'explorando',
  add column if not exists lead_priority text not null default 'baja';

alter table public.gabriel_lead_events
  add column if not exists lead_score smallint,
  add column if not exists lead_class text,
  add column if not exists lead_priority text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'gabriel_whatsapp_sessions_lead_score_check'
      and conrelid = 'public.gabriel_whatsapp_sessions'::regclass
  ) then
    alter table public.gabriel_whatsapp_sessions
      add constraint gabriel_whatsapp_sessions_lead_score_check
      check (lead_score between 0 and 100);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'gabriel_lead_events_lead_score_check'
      and conrelid = 'public.gabriel_lead_events'::regclass
  ) then
    alter table public.gabriel_lead_events
      add constraint gabriel_lead_events_lead_score_check
      check (lead_score is null or lead_score between 0 and 100);
  end if;
end
$$;

create index if not exists gabriel_whatsapp_sessions_priority_idx
  on public.gabriel_whatsapp_sessions(lead_priority, lead_score desc, updated_at desc);

create index if not exists gabriel_lead_events_class_idx
  on public.gabriel_lead_events(source, lead_class, received_at desc)
  where lead_class is not null;

create or replace function public.gabriel_commit_whatsapp_turn(
  p_message_id text,
  p_phone text,
  p_expected_version bigint,
  p_state text,
  p_lead jsonb,
  p_qualified boolean,
  p_handoff boolean,
  p_reply text,
  p_event text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
  v_score smallint;
  v_class text;
  v_priority text;
begin
  if length(trim(coalesce(p_message_id, ''))) not between 3 and 250
    or p_phone !~ '^[0-9]{8,15}$'
    or p_expected_version < 0
    or p_state not in (
      'awaiting_name', 'awaiting_topic', 'awaiting_price', 'awaiting_modality',
      'awaiting_availability', 'awaiting_final_confirmation',
      'qualified_pending_slot', 'confirmed', 'not_qualified', 'human_handoff'
    )
    or p_event not in ('whatsapp_turn', 'qualified_lead', 'human_handoff')
    or length(trim(coalesce(p_reply, ''))) not between 1 and 4096
    or jsonb_typeof(coalesce(p_lead, '{}'::jsonb)) <> 'object'
  then
    return false;
  end if;

  v_score := case
    when coalesce(p_lead->>'leadScore', '') ~ '^[0-9]{1,3}$'
      then least(greatest((p_lead->>'leadScore')::integer, 0), 100)::smallint
    else 0
  end;
  v_class := case
    when p_lead->>'leadClass' in (
      'explorando', 'interesado', 'probable', 'muy_probable',
      'calificado_para_agendar', 'cita_confirmada', 'no_calificado',
      'requiere_atencion_humana', 'atencion_humana_urgente'
    ) then p_lead->>'leadClass'
    else 'explorando'
  end;
  v_priority := case
    when p_lead->>'leadPriority' in ('baja', 'media', 'media_alta', 'alta', 'urgente')
      then p_lead->>'leadPriority'
    else 'baja'
  end;

  update public.gabriel_whatsapp_sessions
  set state = p_state,
      lead = coalesce(p_lead, '{}'::jsonb),
      last_message_id = p_message_id,
      qualified = p_qualified,
      handoff = p_handoff,
      last_reply = left(p_reply, 4096),
      lead_score = v_score,
      lead_class = v_class,
      lead_priority = v_priority,
      version = version + 1,
      updated_at = now()
  where phone = p_phone and version = p_expected_version;

  get diagnostics v_updated = row_count;

  if v_updated = 0 and p_expected_version = 0 then
    insert into public.gabriel_whatsapp_sessions (
      phone, state, lead, last_message_id, qualified, handoff, last_reply,
      lead_score, lead_class, lead_priority, version, updated_at
    ) values (
      p_phone,
      p_state,
      coalesce(p_lead, '{}'::jsonb),
      p_message_id,
      p_qualified,
      p_handoff,
      left(p_reply, 4096),
      v_score,
      v_class,
      v_priority,
      1,
      now()
    )
    on conflict do nothing;
    get diagnostics v_updated = row_count;
  end if;

  if v_updated = 0 then
    return false;
  end if;

  insert into public.gabriel_lead_events (
    event,
    session_id,
    provider_message_id,
    name,
    topic,
    price_accepted,
    modality,
    availability,
    phone,
    status,
    source,
    final_confirmation,
    booking_confirmed_intent,
    lead_score,
    lead_class,
    lead_priority,
    received_at
  ) values (
    p_event,
    p_phone,
    p_message_id,
    nullif(left(coalesce(p_lead->>'name', ''), 100), ''),
    nullif(left(coalesce(p_lead->>'topic', ''), 500), ''),
    case when lower(coalesce(p_lead->>'priceAccepted', 'false')) = 'true' then 'Sí, acepto' else null end,
    nullif(left(coalesce(p_lead->>'modality', ''), 40), ''),
    nullif(left(coalesce(p_lead->>'availability', ''), 200), ''),
    p_phone,
    p_state,
    'whatsapp',
    nullif(left(coalesce(p_lead->>'finalConfirmation', ''), 80), ''),
    lower(coalesce(p_lead->>'bookingConfirmedIntent', 'false')) = 'true',
    v_score,
    v_class,
    v_priority,
    now()
  )
  on conflict do nothing;

  insert into public.gabriel_whatsapp_outbox (
    provider_message_id, phone, body, status, updated_at
  ) values (
    p_message_id, p_phone, left(p_reply, 4096), 'pending', now()
  )
  on conflict do nothing;

  update public.gabriel_whatsapp_inbox
  set status = 'processed', processed_at = now(), updated_at = now(), last_error = null
  where provider_message_id = p_message_id;

  return true;
end;
$$;

revoke all on function public.gabriel_commit_whatsapp_turn(text, text, bigint, text, jsonb, boolean, boolean, text, text)
  from public, anon, authenticated;
grant execute on function public.gabriel_commit_whatsapp_turn(text, text, bigint, text, jsonb, boolean, boolean, text, text)
  to service_role;
