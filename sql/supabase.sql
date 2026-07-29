create table if not exists public.gabriel_lead_events (
  id bigint generated always as identity primary key,
  event text not null,
  session_id text,
  name text,
  topic text,
  price_accepted text,
  modality text,
  availability text,
  phone text,
  status text,
  reason text,
  source text,
  attribution jsonb not null default '{}'::jsonb,
  at timestamptz,
  received_at timestamptz not null default now()
);

alter table public.gabriel_lead_events
  add column if not exists provider_message_id text;

create unique index if not exists gabriel_events_provider_message_idx
  on public.gabriel_lead_events(provider_message_id)
  where provider_message_id is not null;

alter table public.gabriel_lead_events enable row level security;
revoke all on public.gabriel_lead_events from anon, authenticated;

create index if not exists gabriel_events_session_idx on public.gabriel_lead_events(session_id);
create index if not exists gabriel_events_received_idx on public.gabriel_lead_events(received_at desc);

create table if not exists public.gabriel_business_config (
  singleton boolean primary key default true check (singleton),
  business_name text not null default 'Luz de Vida Gabriel',
  timezone text not null default 'America/Mexico_City',
  whatsapp_e164 text not null default '527122466811',
  consultation_price_mxn integer not null default 100 check (consultation_price_mxn > 0),
  google_calendar_id text,
  updated_at timestamptz not null default now()
);

insert into public.gabriel_business_config (singleton)
values (true)
on conflict (singleton) do nothing;

create table if not exists public.gabriel_appointments (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  lead_event_id bigint references public.gabriel_lead_events(id) on delete set null,
  google_event_id text unique,
  customer_name text not null,
  customer_phone text not null,
  topic text,
  modality text not null check (modality in ('Teléfono', 'Videollamada', 'Presencial')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'hold'
    check (status in ('hold', 'confirmed', 'completed', 'cancelled', 'no_show')),
  hold_expires_at timestamptz,
  source text,
  attribution jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create unique index if not exists gabriel_appointments_session_active_idx
  on public.gabriel_appointments(session_id)
  where status in ('hold', 'confirmed');

create index if not exists gabriel_appointments_schedule_idx
  on public.gabriel_appointments(starts_at, ends_at)
  where status in ('hold', 'confirmed');

alter table public.gabriel_business_config enable row level security;
alter table public.gabriel_appointments enable row level security;
revoke all on public.gabriel_business_config from anon, authenticated;
revoke all on public.gabriel_appointments from anon, authenticated;

create or replace function public.gabriel_slot_is_available(
  requested_start timestamptz,
  requested_end timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select requested_end > requested_start
    and not exists (
      select 1
      from public.gabriel_appointments
      where status in ('hold', 'confirmed')
        and starts_at < requested_end
        and ends_at > requested_start
        and (status <> 'hold' or hold_expires_at is null or hold_expires_at > now())
    );
$$;

revoke all on function public.gabriel_slot_is_available(timestamptz, timestamptz)
  from public, anon, authenticated;

create table if not exists public.gabriel_whatsapp_sessions (
  phone text primary key,
  state text not null default 'awaiting_name',
  lead jsonb not null default '{}'::jsonb,
  last_message_id text,
  qualified boolean not null default false,
  handoff boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.gabriel_whatsapp_sessions enable row level security;
revoke all on public.gabriel_whatsapp_sessions from anon, authenticated;
