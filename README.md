# Luz de Vida Gabriel

Sistema de adquisición, calificación y agenda para las consultas espirituales de Gabriel en Atlacomulco.

## Objetivo

Convertir tráfico de TikTok, Instagram, Facebook y la landing en consultas reales, filtrando curiosos antes de ocupar la agenda.

## Oferta oficial

- Consulta inicial: **$100 MXN**.
- Modalidades: teléfono, videollamada o presencial.
- WhatsApp: **+52 712 246 6811**.
- Correo: `luzdevidagabriel@gmail.com`.
- TikTok / Instagram: `@luzdevidagabriel`.

## Incluye

- landing de conversión;
- botón flotante y enlaces de WhatsApp;
- asistente web determinista gratuito;
- aceptación explícita del precio;
- confirmación final `SÍ CONFIRMO MI CITA`;
- captura de atribución UTM;
- eventos de embudo;
- Supabase como CRM operativo;
- sesiones persistentes de WhatsApp;
- inbox/outbox durable para reintentos de WhatsApp;
- webhook oficial de WhatsApp Cloud API;
- idempotencia, control de concurrencia y límites de mensajes de Meta;
- modelo de citas y control de solapamiento;
- plantillas de mensajes;
- tareas de seguimiento;
- campañas y métricas diarias;
- dashboards SQL;
- derivación de emergencias a humano;
- plan de marketing de 30 días;
- arquitectura preparada para Google Calendar y llamadas.

## Regla de cita

Aceptar $100 no basta. El prospecto debe completar nombre, motivo, precio, modalidad, horario y confirmar explícitamente `SÍ CONFIRMO MI CITA`.

Eso genera un prospecto `qualified_pending_slot`, no una cita confirmada.

Una cita sólo debe considerarse **confirmada** cuando:

1. Google Calendar confirme un horario libre y exista el evento real; y
2. `gabriel_appointments.status = 'confirmed'` con `google_event_id` correspondiente.

## Estado verificado

- Repositorio principal: `jccoinventor-boop/Luzdevidagabriel`.
- Supabase: proyecto `Luz de vida Gabriel` con tablas de prospectos, sesiones, citas, configuración, mensajes, seguimiento, campañas y métricas.
- WhatsApp: webhook, calificación, control de concurrencia e inbox/outbox implementados.
- Seguridad web: la calificación se vuelve a comprobar en servidor; el navegador sólo puede registrar telemetría de bajo riesgo.
- Calendar: el adaptador de disponibilidad, bloqueo, creación idempotente y confirmación está implementado; permanece en modo seguro pendiente hasta crear y autorizar el calendario secundario y cargar sus credenciales privadas.
- Llamadas: arquitectura definida, no activa hasta configurar proveedor/número y pruebas reales.

## Documentación

- `docs/MASTER_PLAN.md`: arquitectura y operación unificada.
- `docs/MARKETING_30_DAYS.md`: motor de adquisición.
- `docs/VOICE_AND_CALENDAR.md`: llamadas, Calendar y WhatsApp.
- `sql/supabase.sql`: esquema base.
- `sql/20260817_complete_operating_system.sql`: ampliación CRM/marketing/seguimiento.
- `sql/20260818_finalize_secure_operations.sql`: cierre de permisos, límites web e inbox/outbox de WhatsApp.
- `sql/20260818_add_followup_indexes.sql`: índices de seguimiento recomendados por Supabase.
- `sql/20260818_improve_whatsapp_claim_status.sql`: recuperación segura de mensajes y respuestas en curso.
- `sql/20260818_activate_calendar_booking.sql`: bloqueo y confirmación idempotente de citas entre WhatsApp, Supabase y Google Calendar.
- `AVATAR-GABRIEL.md`: identidad reutilizable del presentador en HeyGen.

## Desarrollo

```bash
npm test
npm run check
npm run build
```

## Despliegue

Netlify usa `netlify.toml`. Todas las credenciales se cargan como variables privadas del sitio. Nunca subir tokens, secretos, service-role keys ni refresh tokens al repositorio.
