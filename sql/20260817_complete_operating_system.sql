-- Espejo versionado de la migración aplicada en Supabase el 2026-08-17.
-- Objetivo: CRM operativo, seguimiento, campañas, métricas y confirmación final.

alter table public.gabriel_lead_events
  add column if not exists final_confirmation text,
  add column if not exists booking_confirmed_intent boolean not null default false;

alter table public.gabriel_appointments
  add column if not exists topic_category text,
  add column if not exists priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high', 'urgent')),
  add column if not exists payment_status text not null default 'pending'
    check (payment_status in ('pending', 'paid', 'waived', 'refunded')),
  add column if not exists payment_reference text,
  add column if not exists followup_status text not null default 'not_started'
    check (followup_status in ('not_started', 'pending', 'completed', 'closed')),
  add column if not exists notes text;

create table if not exists public.gabriel_message_templates (
  code text primary key,
  channel text not null check (channel in ('whatsapp', 'web', 'followup', 'calendar')),
  stage text not null,
  title text not null,
  body text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.gabriel_followup_tasks (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid references public.gabriel_appointments(id) on delete cascade,
  session_id text,
  customer_name text,
  customer_phone text not null,
  task_type text not null check (task_type in ('reminder', 'recovery', 'post_consultation', 'rebooking', 'testimonial_request')),
  template_code text references public.gabriel_message_templates(code) on delete set null,
  due_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'cancelled', 'failed')),
  sent_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists gabriel_followup_due_idx on public.gabriel_followup_tasks(due_at) where status = 'pending';
create index if not exists gabriel_followup_phone_idx on public.gabriel_followup_tasks(customer_phone);

create table if not exists public.gabriel_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  platform text not null check (platform in ('facebook', 'instagram', 'tiktok', 'whatsapp', 'organic', 'other')),
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  angle text,
  daily_budget_mxn numeric(12,2) not null default 0 check (daily_budget_mxn >= 0),
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'ended')),
  started_on date,
  ended_on date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists gabriel_campaigns_status_idx on public.gabriel_campaigns(status, platform);

create table if not exists public.gabriel_daily_metrics (
  metric_date date primary key,
  messages_received integer not null default 0 check (messages_received >= 0),
  price_accepted integer not null default 0 check (price_accepted >= 0),
  qualified_leads integer not null default 0 check (qualified_leads >= 0),
  appointments_confirmed integer not null default 0 check (appointments_confirmed >= 0),
  consultations_completed integer not null default 0 check (consultations_completed >= 0),
  no_shows integer not null default 0 check (no_shows >= 0),
  revenue_mxn numeric(12,2) not null default 0 check (revenue_mxn >= 0),
  ad_spend_mxn numeric(12,2) not null default 0 check (ad_spend_mxn >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.gabriel_message_templates enable row level security;
alter table public.gabriel_followup_tasks enable row level security;
alter table public.gabriel_campaigns enable row level security;
alter table public.gabriel_daily_metrics enable row level security;
revoke all on public.gabriel_message_templates from anon, authenticated;
revoke all on public.gabriel_followup_tasks from anon, authenticated;
revoke all on public.gabriel_campaigns from anon, authenticated;
revoke all on public.gabriel_daily_metrics from anon, authenticated;

insert into public.gabriel_message_templates (code, channel, stage, title, body) values
('bienvenida', 'whatsapp', 'nuevo', 'Bienvenida', 'Hola, te atiende el asistente de Luz de Vida Gabriel. Gabriel ofrece consulta espiritual inicial por $100 MXN para orientación en amor, trabajo, dinero, energía, bloqueos o limpias. Para ayudarte mejor, dime qué situación quieres revisar.'),
('precio', 'whatsapp', 'calificacion', 'Precio', 'La consulta espiritual inicial tiene costo de $100 MXN. En la consulta Gabriel revisa tu situación y te da orientación espiritual personalizada. ¿Deseas agendar tu consulta?'),
('aceptacion_precio', 'whatsapp', 'calificacion', 'Aceptación de precio', 'Antes de avanzar, confirma que aceptas el costo de $100 MXN. Responde: Sí, acepto.'),
('datos_cita', 'whatsapp', 'datos', 'Datos de cita', 'Para registrar tu solicitud envía nombre, tema principal, modalidad y horario deseado.'),
('confirmacion_final', 'whatsapp', 'confirmacion', 'Confirmación final', 'Para dejar tu solicitud como seria, responde exactamente: SÍ CONFIRMO MI CITA. La cita queda pendiente hasta validar disponibilidad real.'),
('recordatorio_1h', 'followup', 'recordatorio', 'Recordatorio una hora antes', 'Te recordamos tu consulta con Gabriel. Responde CONFIRMO ASISTENCIA para mantener tu horario apartado.'),
('reagendar', 'followup', 'reagendar', 'Reagendar', 'Como no recibimos confirmación, tu cita queda pendiente de reagendar. Si aún deseas tu consulta, responde REAGENDAR.'),
('postconsulta', 'followup', 'postconsulta', 'Post consulta', 'Gracias por tomar tu consulta con Luz de Vida Gabriel. Si deseas seguimiento espiritual, limpia, protección o una nueva orientación, puedes escribirnos por este mismo WhatsApp.'),
('curioso', 'whatsapp', 'no_calificado', 'Curioso', 'Claro. Cuando estés listo para agendar, responde: QUIERO MI CONSULTA. No dejaré una cita registrada hasta que confirmes precio, modalidad y horario.'),
('riesgo_humano', 'whatsapp', 'seguridad', 'Riesgo o emergencia', 'Lo que describes requiere atención humana inmediata. Este asistente no atiende emergencias. Contacta a los servicios de emergencia de tu localidad y avisa a una persona de confianza.')
on conflict (code) do update set channel=excluded.channel, stage=excluded.stage, title=excluded.title, body=excluded.body, active=true, updated_at=now();

create or replace view public.gabriel_funnel_last_30_days as
select now() as calculated_at,
  count(*) filter (where event='page_view') as page_views,
  count(*) filter (where event='chat_started') as chat_starts,
  count(*) filter (where event='whatsapp_click') as direct_whatsapp_clicks,
  count(*) filter (where event='qualified_lead') as qualified_leads,
  count(*) filter (where event='qualified_whatsapp_click') as qualified_whatsapp_clicks,
  count(*) filter (where event='lead_not_qualified') as not_qualified,
  count(*) filter (where event='human_handoff') as human_handoffs
from public.gabriel_lead_events where received_at >= now() - interval '30 days';

create or replace view public.gabriel_appointment_board as
select id, starts_at, ends_at, customer_name, customer_phone, topic, topic_category, modality, status, payment_status, followup_status, google_event_id, source, created_at, updated_at
from public.gabriel_appointments order by starts_at desc;

create or replace view public.gabriel_today_dashboard as
select current_date as metric_date,
  coalesce((select messages_received from public.gabriel_daily_metrics where metric_date=current_date),0) as manual_messages_received,
  coalesce((select appointments_confirmed from public.gabriel_daily_metrics where metric_date=current_date),0) as manual_appointments_confirmed,
  coalesce((select consultations_completed from public.gabriel_daily_metrics where metric_date=current_date),0) as manual_consultations_completed,
  coalesce((select revenue_mxn from public.gabriel_daily_metrics where metric_date=current_date),0) as manual_revenue_mxn,
  (select count(*) from public.gabriel_lead_events where received_at::date=current_date) as tracked_events_today,
  (select count(*) from public.gabriel_lead_events where event='qualified_lead' and received_at::date=current_date) as tracked_qualified_today,
  (select count(*) from public.gabriel_appointments where starts_at::date=current_date and status in ('hold','confirmed')) as active_appointments_today;
