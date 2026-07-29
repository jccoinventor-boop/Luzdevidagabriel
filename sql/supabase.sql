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

alter table public.gabriel_lead_events enable row level security;
revoke all on public.gabriel_lead_events from anon, authenticated;

create index if not exists gabriel_events_session_idx on public.gabriel_lead_events(session_id);
create index if not exists gabriel_events_received_idx on public.gabriel_lead_events(received_at desc);
