-- Registra consentimiento web antes de recopilar datos personales.
-- Esta migración debe aplicarse antes de desplegar gabriel-public-api con la acción consent.

alter table public.gabriel_lead_events
  add column if not exists privacy_notice_version text,
  add column if not exists privacy_consent_at timestamptz;

create index if not exists gabriel_lead_events_privacy_consent_idx
  on public.gabriel_lead_events(session_id, privacy_consent_at desc)
  where event = 'privacy_consent';

alter table public.gabriel_request_limits
  drop constraint if exists gabriel_request_limits_scope_check;
alter table public.gabriel_request_limits
  add constraint gabriel_request_limits_scope_check
  check (scope in ('telemetry', 'qualified', 'booking', 'consent'));

create or replace function public.gabriel_record_web_privacy_consent(
  p_client_key text,
  p_session_id text,
  p_notice_version text
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
    or p_notice_version <> '2026-08-31'
  then
    return 'invalid';
  end if;

  insert into public.gabriel_request_limits (
    client_key, scope, window_started_at, request_count, updated_at
  ) values (
    p_client_key, 'consent', now(), 1, now()
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
     or public.gabriel_request_limits.request_count < 10
  returning request_count into v_count;

  if v_count is null then
    return 'rate_limited';
  end if;

  insert into public.gabriel_lead_events (
    event,
    session_id,
    status,
    source,
    privacy_notice_version,
    privacy_consent_at,
    provider_message_id,
    received_at
  ) values (
    'privacy_consent',
    p_session_id,
    'consented',
    'web',
    p_notice_version,
    now(),
    'web-consent:' || p_session_id || ':' || p_notice_version,
    now()
  )
  on conflict do nothing;

  get diagnostics v_inserted = row_count;
  return case when v_inserted = 1 then 'inserted' else 'duplicate' end;
end;
$$;

revoke all on function public.gabriel_record_web_privacy_consent(text, text, text)
  from public, anon, authenticated;
grant execute on function public.gabriel_record_web_privacy_consent(text, text, text)
  to service_role;
