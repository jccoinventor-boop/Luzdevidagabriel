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

El adaptador debe implementar estas operaciones:

- `list_available_slots(date_range, modality)`
- `hold_slot(slot, lead_id)`
- `confirm_appointment(hold_id)`
- `cancel_appointment(appointment_id)`

Hasta conectar un calendario real, el asistente sólo recopila el horario preferido y lo deja como `pending_confirmation`; nunca afirma que la cita está confirmada.

Supabase es la fuente operativa de prospectos, estados y atribución; Google
Calendar es la fuente de disponibilidad. Una reserva se considera confirmada
solamente cuando existen tanto el registro `confirmed` en
`gabriel_appointments` como el `google_event_id` correspondiente.

## WhatsApp Business

El número oficial del sitio y de los mensajes prellenados es
`+52 712 246 6811` (`527122466811` en formato E.164 sin el signo `+`). El enlace
usa `wa.me`, que abre WhatsApp o WhatsApp Business según la aplicación instalada
en el dispositivo. `PUBLIC_WHATSAPP` debe conservar ese mismo valor en Netlify.

## Supabase

Ejecutar `sql/supabase.sql` una vez en el proyecto de Supabase. Después agregar
`SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` sólo como variables privadas de
Netlify. La clave de servicio nunca debe aparecer en `public/`, en el navegador,
en GitHub ni en mensajes.
