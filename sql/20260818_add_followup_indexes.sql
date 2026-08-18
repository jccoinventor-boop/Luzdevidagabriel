-- Índices recomendados por el asesor de rendimiento de Supabase.

create index if not exists gabriel_followup_appointment_idx
  on public.gabriel_followup_tasks(appointment_id);

create index if not exists gabriel_followup_template_idx
  on public.gabriel_followup_tasks(template_code);
