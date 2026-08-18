-- Cierre operativo y de seguridad aplicado el 2026-08-18.
-- Protege vistas privadas, limita entradas web y hace durable el flujo de WhatsApp.

alter view public.gabriel_funnel_last_30_days set (security_invoker = true);
alter view public.gabriel_appointment_board set (security_invoker = true);
alter view public.gabriel_today_dashboard set (security_invoker = true);

revoke all on public.gabriel_funnel_last_30_days from public, anon, authenticated;
revoke all on public.gabriel_appointment_board from public, anon, authenticated;
revoke all on public.gabriel_today_dashboard from public, anon, authenticated;
grant select on public.gabriel_funnel_last_30_days to service_role;
grant select on public.gabriel_appointment_board to service_role;
grant select on public.gabriel_today_dashboard to service_role;

create table if not exists public.gabriel_request_limits (
  client_key text not null,
  scope text not null check (scope in ('telemetry', 'qualified')),
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (client_key, scope)
);

alter table public.gabriel_request_limits enable row level security;
revoke all on public.gabriel_request_limits from public, anon, authenticated;
grant select, insert, update, delete on public.gabriel_request_limits to service_role;

create or replace function public.gabriel_record_public_event(
  p_client_key text,
  p_event text,
  p_session_id text,
  p_reason text,
  p_source text,
  p_attribution jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_provider_message_id text;
begin
  if length(coalesce(p_client_key, '')) <> 64
    or p_event not in ('page_view', 'chat_started', 'whatsapp_click', 'qualified_whatsapp_click', 'lead_not_qualified')
    or p_session_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or jsonb_typeof(coalesce(p_attribution, '{}'::jsonb)) <> 'object'
  then
    return 'invalid';
  end if;

  insert into public.gabriel_request_limits (
    client_key, scope, window_started_at, request_count, updated_at
  ) values (
    p_client_key, 'telemetry', now(), 1, now()
  )
  on conflict (client_key, scope) do update
  set window_started_at = case
        when public.gabriel_request_limits.window_started_at <= now() - interval '1 minute' then now()
        else public.gabriel_request_limits.window_started_at
      end,
      request_count = case
        when public.gabriel_request_limits.window_started_at <= now() - interval '1 minute' then 1
        else public.gabriel_request_limits.request_count + 1
      end,
      updated_at = now()
  where public.gabriel_request_limits.window_started_at <= now() - interval '1 minute'
     or public.gabriel_request_limits.request_count < 30
  returning request_count into v_count;

  if v_count is null then
    return 'rate_limited';
  end if;

  v_provider_message_id := case
    when p_event in ('page_view', 'chat_started')
      then 'web-telemetry:' || p_session_id || ':' || p_event
    else null
  end;

  insert into public.gabriel_lead_events (
    event, session_id, reason, source, attribution, provider_message_id, received_at
  ) values (
    p_event,
    p_session_id,
    nullif(left(coalesce(p_reason, ''), 80), ''),
    nullif(left(coalesce(p_source, ''), 80), ''),
    coalesce(p_attribution, '{}'::jsonb),
    v_provider_message_id,
    now()
  )
  on conflict do nothing;

  return 'accepted';
end;
$$;

revoke all on function public.gabriel_record_public_event(text, text, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.gabriel_record_public_event(text, text, text, text, text, jsonb)
  to service_role;

create or replace function public.gabriel_record_qualified_web_lead(
  p_client_key text,
  p_session_id text,
  p_name text,
  p_topic text,
  p_modality text,
  p_availability text,
  p_phone text,
  p_attribution jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_inserted integer;
begin
  if length(coalesce(p_client_key, '')) <> 64
    or p_session_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or length(trim(coalesce(p_name, ''))) not between 2 and 100
    or length(trim(coalesce(p_topic, ''))) not between 8 and 500
    or p_modality not in ('Teléfono', 'Videollamada', 'Presencial')
    or length(trim(coalesce(p_availability, ''))) not between 5 and 200
    or p_phone !~ '^[0-9]{10}$'
    or jsonb_typeof(coalesce(p_attribution, '{}'::jsonb)) <> 'object'
  then
    return 'invalid';
  end if;

  insert into public.gabriel_request_limits (
    client_key, scope, window_started_at, request_count, updated_at
  ) values (
    p_client_key, 'qualified', now(), 1, now()
  )
  on conflict (client_key, scope) do update
  set window_started_at = case
        when public.gabriel_request_limits.window_started_at <= now() - interval '1 minute' then now()
        else public.gabriel_request_limits.window_started_at
      end,
      request_count = case
        when public.gabriel_request_limits.window_started_at <= now() - interval '1 minute' then 1
        else public.gabriel_request_limits.request_count + 1
      end,
      updated_at = now()
  where public.gabriel_request_limits.window_started_at <= now() - interval '1 minute'
     or public.gabriel_request_limits.request_count < 30
  returning request_count into v_count;

  if v_count is null then
    return 'rate_limited';
  end if;

  insert into public.gabriel_lead_events (
    event,
    session_id,
    name,
    topic,
    price_accepted,
    modality,
    availability,
    phone,
    status,
    source,
    attribution,
    final_confirmation,
    booking_confirmed_intent,
    provider_message_id,
    received_at
  ) values (
    'qualified_lead',
    p_session_id,
    left(trim(p_name), 100),
    left(trim(p_topic), 500),
    'Sí, acepto',
    p_modality,
    left(trim(p_availability), 200),
    p_phone,
    'qualified_pending_slot',
    'web',
    coalesce(p_attribution, '{}'::jsonb),
    'SÍ CONFIRMO MI CITA',
    true,
    'web-qualified:' || p_session_id,
    now()
  )
  on conflict do nothing;

  get diagnostics v_inserted = row_count;
  return case when v_inserted = 1 then 'inserted' else 'duplicate' end;
end;
$$;

revoke all on function public.gabriel_record_qualified_web_lead(text, text, text, text, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.gabriel_record_qualified_web_lead(text, text, text, text, text, text, text, jsonb)
  to service_role;

alter table public.gabriel_whatsapp_sessions
  add column if not exists last_reply text,
  add column if not exists version bigint not null default 0;

create table if not exists public.gabriel_whatsapp_inbox (
  provider_message_id text primary key,
  phone text not null,
  message_text text not null,
  status text not null default 'processing'
    check (status in ('processing', 'processed', 'failed')),
  attempts integer not null default 1 check (attempts > 0),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  processed_at timestamptz
);

create table if not exists public.gabriel_whatsapp_outbox (
  provider_message_id text primary key
    references public.gabriel_whatsapp_inbox(provider_message_id) on delete cascade,
  phone text not null,
  body text not null,
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  locked_at timestamptz,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.gabriel_whatsapp_rate_limits (
  phone text primary key,
  window_started_at timestamptz not null default now(),
  message_count integer not null default 0 check (message_count >= 0),
  updated_at timestamptz not null default now()
);

create index if not exists gabriel_whatsapp_inbox_status_idx
  on public.gabriel_whatsapp_inbox(status, updated_at);
create index if not exists gabriel_whatsapp_outbox_status_idx
  on public.gabriel_whatsapp_outbox(status, updated_at);

alter table public.gabriel_whatsapp_inbox enable row level security;
alter table public.gabriel_whatsapp_outbox enable row level security;
alter table public.gabriel_whatsapp_rate_limits enable row level security;
revoke all on public.gabriel_whatsapp_inbox from public, anon, authenticated;
revoke all on public.gabriel_whatsapp_outbox from public, anon, authenticated;
revoke all on public.gabriel_whatsapp_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on public.gabriel_whatsapp_inbox to service_role;
grant select, insert, update, delete on public.gabriel_whatsapp_outbox to service_role;
grant select, insert, update, delete on public.gabriel_whatsapp_rate_limits to service_role;

create or replace function public.gabriel_claim_whatsapp_message(
  p_message_id text,
  p_phone text,
  p_message_text text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claimed text;
  v_count integer;
begin
  if length(trim(coalesce(p_message_id, ''))) not between 3 and 250
    or p_phone !~ '^[0-9]{8,15}$'
    or length(trim(coalesce(p_message_text, ''))) not between 1 and 1000
  then
    return false;
  end if;

  update public.gabriel_whatsapp_inbox
  set status = 'processing',
      attempts = attempts + 1,
      last_error = null,
      updated_at = now()
  where provider_message_id = p_message_id
    and (
      status = 'failed'
      or (status = 'processing' and updated_at <= now() - interval '5 minutes')
    )
  returning provider_message_id into v_claimed;

  if v_claimed is not null then
    return true;
  end if;

  if exists (
    select 1 from public.gabriel_whatsapp_inbox
    where provider_message_id = p_message_id
  ) then
    return false;
  end if;

  insert into public.gabriel_whatsapp_rate_limits (
    phone, window_started_at, message_count, updated_at
  ) values (
    p_phone, now(), 1, now()
  )
  on conflict (phone) do update
  set window_started_at = case
        when public.gabriel_whatsapp_rate_limits.window_started_at <= now() - interval '1 minute' then now()
        else public.gabriel_whatsapp_rate_limits.window_started_at
      end,
      message_count = case
        when public.gabriel_whatsapp_rate_limits.window_started_at <= now() - interval '1 minute' then 1
        else public.gabriel_whatsapp_rate_limits.message_count + 1
      end,
      updated_at = now()
  where public.gabriel_whatsapp_rate_limits.window_started_at <= now() - interval '1 minute'
     or public.gabriel_whatsapp_rate_limits.message_count < 20
  returning message_count into v_count;

  if v_count is null then
    return false;
  end if;

  insert into public.gabriel_whatsapp_inbox (
    provider_message_id, phone, message_text, status, attempts, updated_at
  ) values (
    p_message_id, p_phone, left(trim(p_message_text), 1000), 'processing', 1, now()
  )
  on conflict do nothing
  returning provider_message_id into v_claimed;

  return v_claimed is not null;
end;
$$;

revoke all on function public.gabriel_claim_whatsapp_message(text, text, text)
  from public, anon, authenticated;
grant execute on function public.gabriel_claim_whatsapp_message(text, text, text)
  to service_role;

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
begin
  if p_expected_version < 0
    or p_event not in ('whatsapp_turn', 'qualified_lead', 'human_handoff')
    or length(trim(coalesce(p_reply, ''))) not between 1 and 4096
    or jsonb_typeof(coalesce(p_lead, '{}'::jsonb)) <> 'object'
  then
    return false;
  end if;

  update public.gabriel_whatsapp_sessions
  set state = left(p_state, 80),
      lead = coalesce(p_lead, '{}'::jsonb),
      last_message_id = p_message_id,
      qualified = p_qualified,
      handoff = p_handoff,
      last_reply = left(p_reply, 4096),
      version = version + 1,
      updated_at = now()
  where phone = p_phone and version = p_expected_version;

  get diagnostics v_updated = row_count;

  if v_updated = 0 and p_expected_version = 0 then
    insert into public.gabriel_whatsapp_sessions (
      phone, state, lead, last_message_id, qualified, handoff, last_reply, version, updated_at
    ) values (
      p_phone,
      left(p_state, 80),
      coalesce(p_lead, '{}'::jsonb),
      p_message_id,
      p_qualified,
      p_handoff,
      left(p_reply, 4096),
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
    received_at
  ) values (
    p_event,
    p_phone,
    p_message_id,
    nullif(left(coalesce(p_lead->>'name', ''), 100), ''),
    nullif(left(coalesce(p_lead->>'topic', ''), 500), ''),
    case when coalesce((p_lead->>'priceAccepted')::boolean, false) then 'Sí, acepto' else null end,
    nullif(left(coalesce(p_lead->>'modality', ''), 40), ''),
    nullif(left(coalesce(p_lead->>'availability', ''), 200), ''),
    p_phone,
    left(p_state, 80),
    'whatsapp',
    nullif(left(coalesce(p_lead->>'finalConfirmation', ''), 80), ''),
    coalesce((p_lead->>'bookingConfirmedIntent')::boolean, false),
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

create or replace function public.gabriel_claim_whatsapp_outbox(p_message_id text)
returns table (phone text, body text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  update public.gabriel_whatsapp_outbox
  set status = 'sending',
      attempts = attempts + 1,
      locked_at = now(),
      updated_at = now(),
      last_error = null
  where provider_message_id = p_message_id
    and attempts < 5
    and (
      status in ('pending', 'failed')
      or (status = 'sending' and locked_at <= now() - interval '5 minutes')
    )
  returning gabriel_whatsapp_outbox.phone, gabriel_whatsapp_outbox.body;
end;
$$;

revoke all on function public.gabriel_claim_whatsapp_outbox(text)
  from public, anon, authenticated;
grant execute on function public.gabriel_claim_whatsapp_outbox(text)
  to service_role;

create or replace function public.gabriel_mark_whatsapp_outbox_sent(p_message_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  update public.gabriel_whatsapp_outbox
  set status = 'sent', sent_at = now(), updated_at = now(), last_error = null
  where provider_message_id = p_message_id and status = 'sending';
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.gabriel_mark_whatsapp_outbox_sent(text)
  from public, anon, authenticated;
grant execute on function public.gabriel_mark_whatsapp_outbox_sent(text)
  to service_role;

create or replace function public.gabriel_mark_whatsapp_outbox_failed(
  p_message_id text,
  p_error text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  update public.gabriel_whatsapp_outbox
  set status = 'failed', last_error = left(coalesce(p_error, 'send_failed'), 500), updated_at = now()
  where provider_message_id = p_message_id and status = 'sending';
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.gabriel_mark_whatsapp_outbox_failed(text, text)
  from public, anon, authenticated;
grant execute on function public.gabriel_mark_whatsapp_outbox_failed(text, text)
  to service_role;

create or replace function public.gabriel_mark_whatsapp_inbox_failed(
  p_message_id text,
  p_error text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  update public.gabriel_whatsapp_inbox
  set status = 'failed', last_error = left(coalesce(p_error, 'processing_failed'), 500), updated_at = now()
  where provider_message_id = p_message_id and status = 'processing';
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.gabriel_mark_whatsapp_inbox_failed(text, text)
  from public, anon, authenticated;
grant execute on function public.gabriel_mark_whatsapp_inbox_failed(text, text)
  to service_role;
