# Activación de llamadas y calendario

El repositorio deja el embudo web funcionando sin exponer credenciales. Las llamadas telefónicas reales y la confirmación automática de horarios requieren servicios externos configurados por el propietario.

## Llamadas

Arquitectura prevista:

1. Un número telefónico/SIP recibe la llamada.
2. El proveedor SIP dirige la llamada a OpenAI Realtime SIP.
3. Un webhook del servidor acepta la llamada con las instrucciones de recepción.
4. Las herramientas del agente consultan disponibilidad y registran la solicitud.
5. La cita sólo se confirma después de que el calendario devuelve un espacio libre.

No se debe marcar esta función como activa hasta probar llamadas entrantes, transferencia a humano, cortes, silencio, ruido, consentimiento y emergencias.

Documentación oficial:

- https://developers.openai.com/api/docs/guides/realtime-sip
- https://developers.openai.com/api/docs/guides/realtime-webrtc
- https://developers.openai.com/api/docs/guides/function-calling

## Calendario

El calendario operativo debe ser uno secundario y separado llamado
`Luz de Vida Gabriel`. No se deben crear citas en el calendario personal.
Su identificador se configura en Netlify como `GOOGLE_CALENDAR_ID`.

Activación manual necesaria en Google Calendar:

1. Crear el calendario secundario `Luz de Vida Gabriel` con zona horaria `America/Mexico_City`.
2. Copiar su identificador desde **Configuración e integración**.
3. Guardarlo en `gabriel_business_config.google_calendar_id` y como variable privada `GOOGLE_CALENDAR_ID` en Netlify.
4. Ejecutar una prueba controlada de disponibilidad, alta, modificación y cancelación antes de aceptar citas automáticas.

El adaptador del servidor ya implementa:

- lectura de disponibilidad mediante `freeBusy`;
- bloqueo temporal e idempotente en Supabase;
- creación idempotente del evento de Google;
- confirmación conjunta de `google_event_id` y estado `confirmed`;
- liberación de bloqueos cuando la creación del evento falla antes de completarse.

Variables privadas de Calendar necesarias en Netlify:

- `GOOGLE_CALENDAR_ID`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`
- `APPOINTMENT_DURATION_MINUTES` (opcional; el valor predeterminado es 60)

El calendario secundario debe compartirse con `GOOGLE_SERVICE_ACCOUNT_EMAIL` con
permiso para modificar eventos. `GOOGLE_CALENDAR_ID` nunca debe apuntar a
`primary` ni al calendario personal. El adaptador sólo se activa para un ID de
calendario secundario terminado en `@group.calendar.google.com`.

Hasta conectar un calendario real, el asistente sólo recopila el horario preferido y lo deja como `qualified_pending_slot`; nunca afirma que la cita está confirmada.

Supabase es la fuente operativa de prospectos, estados y atribución; Google
Calendar es la fuente de disponibilidad. Una reserva se considera confirmada
solamente cuando existen tanto el registro `confirmed` en
`gabriel_appointments` como el `google_event_id` correspondiente.

## WhatsApp Business

El número oficial del sitio y de los mensajes prellenados es
`+52 712 246 6811` (`527122466811` en formato E.164 sin el signo `+`). El enlace
usa `wa.me`, que abre WhatsApp o WhatsApp Business según la aplicación instalada
en el dispositivo. `PUBLIC_WHATSAPP` debe conservar ese mismo valor en Netlify.

El agente usa la API oficial de WhatsApp Cloud y recibe mensajes en:
`https://luzdevidagabriel.netlify.app/webhooks/whatsapp`.

Reglas operativas:

- La firma `X-Hub-Signature-256` se valida con `META_APP_SECRET`.
- Cada mensaje se registra una sola vez mediante su identificador de Meta.
- La sesión se conserva en `gabriel_whatsapp_sessions` con control de versión.
- `gabriel_whatsapp_inbox` evita reprocesar mensajes y permite reintentos controlados.
- `gabriel_whatsapp_outbox` conserva la respuesta antes de enviarla a Meta.
- El trabajo por webhook y por remitente tiene límites explícitos.
- Aceptar el precio no basta: exige nombre, motivo, modalidad y horario.
- Un mensaje de riesgo se deriva a revisión humana y nunca se agenda.
- Sin calendario real, el estado final es `qualified_pending_slot`, no confirmado.

Variables privadas necesarias:

- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `META_APP_SECRET`
- `META_GRAPH_API_VERSION`

El token, el secreto y el identificador del número se obtienen en la aplicación
de Meta propiedad del negocio. Nunca se escriben en GitHub, archivos públicos o
mensajes de chat.

## Supabase

Para un proyecto nuevo, ejecutar primero `sql/supabase.sql` y después las
migraciones fechadas de `sql/` en orden. En producción ya están aplicadas hasta
`20260818_improve_whatsapp_claim_status.sql`.

Agregar `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` sólo como variables privadas
de Netlify. La clave de servicio nunca debe aparecer en `public/`, en el
navegador, en GitHub ni en mensajes.
