# Luz de Vida Gabriel — Plan maestro unificado

## Objetivo único

Convertir tráfico de TikTok, Instagram, Facebook y la landing en consultas reales para Gabriel, evitando ocupar agenda con curiosos.

## Oferta oficial

- Marca: Luz de Vida Gabriel
- Ubicación: Atlacomulco, Estado de México
- Consulta inicial: $100 MXN
- Modalidades: teléfono, videollamada y presencial
- WhatsApp: +52 712 246 6811
- Correo: luzdevidagabriel@gmail.com
- Redes: @luzdevidagabriel
- Web: https://luzdevidagabriel.netlify.app/

## Embudo

1. Contenido/anuncio con UTM.
2. Landing o WhatsApp.
3. Captura de nombre y motivo.
4. Aceptación explícita del precio.
5. Elección de modalidad.
6. Horario preferido.
7. Confirmación explícita `SÍ CONFIRMO MI CITA`.
8. Estado `qualified_pending_slot`.
9. Consulta de disponibilidad real en Google Calendar.
10. Creación del evento y registro `confirmed` en Supabase.
11. Recordatorio.
12. Consulta.
13. Registro de pago/asistencia.
14. Seguimiento y posible reagendamiento.

Aceptar $100 no basta. Una persona sólo es un prospecto calificado cuando completa el flujo y confirma intención. Una cita sólo es una cita confirmada cuando existe un evento real de Calendar y el registro de Supabase tiene estado `confirmed`.

## Arquitectura

### Web / Netlify o Vercel

- Landing estática de conversión.
- Chat determinista gratuito.
- Función `/api/lead` para atribución y eventos.
- Webhook `/webhooks/whatsapp` para WhatsApp Cloud API.
- Sin dependencia de OpenAI para el chat básico.

### Supabase

Fuente operativa para:

- eventos de adquisición;
- sesiones de WhatsApp;
- citas;
- configuración;
- plantillas;
- tareas de seguimiento;
- campañas;
- métricas diarias.

Tablas principales:

- `gabriel_lead_events`
- `gabriel_whatsapp_sessions`
- `gabriel_appointments`
- `gabriel_business_config`
- `gabriel_message_templates`
- `gabriel_followup_tasks`
- `gabriel_campaigns`
- `gabriel_daily_metrics`

Vistas:

- `gabriel_funnel_last_30_days`
- `gabriel_appointment_board`
- `gabriel_today_dashboard`

### Google Calendar

Debe existir un calendario secundario llamado `Luz de Vida Gabriel`.

No usar el calendario personal como agenda de clientes.

Calendar es la fuente de verdad para disponibilidad. Supabase es la fuente de verdad para CRM, estado y atribución.

El adaptador del servidor:

- exige fecha y hora inequívocas en formato `DD/MM/AAAA HH:MM`;
- consulta `freeBusy` del calendario secundario;
- crea un bloqueo temporal en Supabase;
- crea el evento con identificador determinista para evitar duplicados;
- confirma la cita sólo después de guardar el `google_event_id`;
- conserva el estado pendiente cuando falta configuración o falla un servicio.

### WhatsApp

Número oficial: `527122466811`.

El agente oficial de Cloud API requiere:

- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `META_APP_SECRET`
- `META_GRAPH_API_VERSION`

El webhook valida firma, evita procesar dos veces el mismo mensaje y conserva estado de conversación.

## Estados comerciales

- `awaiting_name`
- `awaiting_topic`
- `awaiting_price`
- `awaiting_modality`
- `awaiting_availability`
- `awaiting_final_confirmation`
- `qualified_pending_slot`
- `not_qualified`
- `human_handoff`

Estados de cita:

- `hold`
- `confirmed`
- `completed`
- `cancelled`
- `no_show`

Estados de pago:

- `pending`
- `paid`
- `waived`
- `refunded`

## Seguridad y límites

- No subir secretos a GitHub.
- Service role de Supabase sólo en servidor.
- RLS activo y acceso de cliente revocado en tablas operativas.
- No prometer resultados espirituales.
- No afirmar que una persona tiene brujería, maldición o daño como hecho.
- Emergencias y amenazas se derivan a atención humana.
- La orientación espiritual no sustituye atención médica, psicológica, legal, financiera ni de emergencia.

## Marketing

Ángulos principales:

1. Bloqueos / energía / claridad.
2. Amor y relaciones.
3. Trabajo y dinero.
4. Confianza: cómo funciona una consulta.

Cada pieza debe llevar UTM. El KPI principal es `consultations_completed`, seguido de `appointments_confirmed`, no vistas ni likes.

Cadencia inicial documentada:

- 5 videos cortos por semana.
- 2 historias diarias.
- 1 transmisión semanal.
- Reutilización en TikTok, Instagram Reels y Facebook Reels.

## Lo que todavía requiere activación externa

1. Autorizar el calendario secundario `Luz de Vida Gabriel` y guardar su ID en Supabase y el hosting.
2. Configurar Vercel OIDC y Google Cloud Workload Identity Federation sin generar una llave privada.
3. Confirmar que Meta tiene el webhook de WhatsApp Cloud API validado y las variables privadas cargadas.
4. Implementar el despachador de recordatorios/seguimientos pendientes.
5. Configurar llamadas sólo después de elegir proveedor SIP/número y probar transferencia a humano y emergencias.
6. Validar despliegue Netlify y pruebas de extremo a extremo.

## Definición de éxito

El sistema está completo cuando un prospecto puede llegar desde una campaña, quedar atribuido, completar el filtro, confirmar intención, obtener un horario libre real, aparecer en Calendar y Supabase, recibir recordatorio, ser marcado como atendido/pagado y entrar a seguimiento sin intervención manual salvo la consulta de Gabriel y los casos derivados a humano.
