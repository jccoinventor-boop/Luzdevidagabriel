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

El adaptador debe implementar estas operaciones:

- `list_available_slots(date_range, modality)`
- `hold_slot(slot, lead_id)`
- `confirm_appointment(hold_id)`
- `cancel_appointment(appointment_id)`

Hasta conectar un calendario real, el asistente sólo recopila el horario preferido y lo deja como `pending_confirmation`; nunca afirma que la cita está confirmada.
