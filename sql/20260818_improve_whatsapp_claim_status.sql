-- Distingue duplicados completos, trabajo en curso y reintentos recuperables.

drop function if exists public.gabriel_claim_whatsapp_message(text, text, text);

create function public.gabriel_claim_whatsapp_message(
  p_message_id text,
  p_phone text,
  p_message_text text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claimed text;
  v_count integer;
  v_inbox_status text;
  v_outbox_status text;
  v_locked_at timestamptz;
begin
  if length(trim(coalesce(p_message_id, ''))) not between 3 and 250
    or p_phone !~ '^[0-9]{8,15}$'
    or length(trim(coalesce(p_message_text, ''))) not between 1 and 1000
  then
    return 'invalid';
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
    return 'claimed';
  end if;

  select i.status, o.status, o.locked_at
  into v_inbox_status, v_outbox_status, v_locked_at
  from public.gabriel_whatsapp_inbox i
  left join public.gabriel_whatsapp_outbox o using (provider_message_id)
  where i.provider_message_id = p_message_id;

  if v_inbox_status is not null then
    if v_inbox_status = 'processed' and v_outbox_status = 'sent' then
      return 'complete';
    end if;
    if v_inbox_status = 'processed' and (
      v_outbox_status in ('pending', 'failed')
      or (v_outbox_status = 'sending' and v_locked_at <= now() - interval '5 minutes')
    ) then
      return 'outbox_ready';
    end if;
    return 'busy';
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
    return 'rate_limited';
  end if;

  insert into public.gabriel_whatsapp_inbox (
    provider_message_id, phone, message_text, status, attempts, updated_at
  ) values (
    p_message_id, p_phone, left(trim(p_message_text), 1000), 'processing', 1, now()
  )
  on conflict do nothing
  returning provider_message_id into v_claimed;

  return case when v_claimed is not null then 'claimed' else 'busy' end;
end;
$$;

revoke all on function public.gabriel_claim_whatsapp_message(text, text, text)
  from public, anon, authenticated;
grant execute on function public.gabriel_claim_whatsapp_message(text, text, text)
  to service_role;
