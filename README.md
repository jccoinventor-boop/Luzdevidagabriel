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
- aviso de privacidad y consentimiento versionado antes de recopilar datos;
- inicio de WhatsApp que informa y solicita aceptación antes de interpretar datos personales;
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
- puente idempotente de apartado web a confirmación por WhatsApp y Calendar.

## Regla de cita

Aceptar $100 no basta. El prospecto debe completar nombre, motivo, precio, modalidad, horario y confirmar explícitamente `SÍ CONFIRMO MI CITA`.

Eso genera un prospecto `qualified_pending_slot`, no una cita confirmada.

Una cita sólo debe considerarse **confirmada** cuando:

1. Google Calendar confirme un horario libre y exista el evento real; y
2. `gabriel_appointments.status = 'confirmed'` con `google_event_id` correspondiente.

## Estado del repositorio

- Repositorio principal: `jccoinventor-boop/Luzdevidagabriel`.
- Supabase: proyecto `Luz de vida Gabriel` con tablas de prospectos, sesiones, citas, configuración, mensajes, seguimiento, campañas y métricas.
- WhatsApp: webhook, calificación, control de concurrencia e inbox/outbox implementados.
- Seguridad web: la calificación se vuelve a comprobar en servidor; el navegador sólo puede registrar telemetría de bajo riesgo.
- Calendar: el adaptador de disponibilidad, bloqueo, creación idempotente y confirmación está implementado. Una reserva web se recupera por teléfono más código desde el webhook firmado. Vercel usa Workload Identity Federation; Netlify usa una cuenta de servicio limitada al calendario secundario y conserva la llave únicamente como variable secreta del servidor.
- Llamadas: arquitectura definida, no activa hasta configurar proveedor/número y pruebas reales.

Esta revisión todavía no está en producción. El responsable, domicilio y precio de $100 MXN fueron confirmados el 2026-08-31. El lanzamiento general permanece bloqueado hasta revisar jurídicamente el aviso, aplicar las migraciones nuevas y demostrar el flujo completo con servicios reales en staging. Ver `docs/PRODUCTION_READINESS.md`.

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
- `sql/20260818_prevent_calendar_overlap.sql`: barrera atómica contra reservas concurrentes que se solapan.
- `sql/20260819_remove_duplicate_calendar_overlap.sql`: elimina de forma idempotente la restricción GiST duplicada sin reducir la protección contra solapamientos.
- `sql/20260825_add_whatsapp_lead_classification.sql`: espejo de la clasificación durable ya aplicada en Supabase.
- `sql/20260826_add_free_web_booking.sql`: espejo de la reserva web gratuita ya aplicada en Supabase.
- `sql/20260831_record_web_privacy_consent.sql`: consentimiento web versionado; pendiente de aplicar.
- `sql/20260830_connect_web_booking_to_whatsapp.sql`: conecta el apartado web con el webhook oficial; pendiente de aplicar.
- `AVATAR-GABRIEL.md`: identidad reutilizable del presentador en HeyGen.
- `docs/RELEASE_RUNBOOK.md`: secuencia de publicación, smoke tests y rollback.
- `docs/THREAT_MODEL.md`: activos, amenazas, controles y riesgo residual.

## Desarrollo

```bash
npm test
npm run check
npm run build
```

El proyecto se verifica con Node.js 24 o posterior.

## Despliegue

Netlify usa `netlify.toml` y Vercel usa `vercel.json`. Cada build genera `/release.json` con el commit desplegado. Vercel obtiene Google Calendar mediante OIDC y Workload Identity Federation, sin llave privada exportable. Netlify requiere `GOOGLE_SERVICE_ACCOUNT_EMAIL` y `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`, ambas limitadas al calendario secundario y guardadas como variables privadas. Nunca subir tokens, claves secretas o credenciales al repositorio. Seguir `docs/RELEASE_RUNBOOK.md`; no publicar manualmente una versión distinta de Git.
