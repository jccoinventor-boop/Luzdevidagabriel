# Preparación de producción — Luz de Vida Gabriel

Evaluación actualizada el 2026-08-31 para la rama `codex/production-readiness`.

## Decisión por alcance

| Alcance | Decisión | Evidencia |
| --- | --- | --- |
| Desarrollo local | GO | Pruebas, sintaxis y build automatizados. |
| Deploy Preview restringido | GO condicionado | No usar datos reales; requiere variables separadas y datos sintéticos. |
| Piloto real controlado | BLOQUEADO | Falta revisar jurídicamente el aviso, aplicar las migraciones nuevas y ejecutar una prueba real web → WhatsApp → Calendar. |
| Campaña o lanzamiento general | BLOQUEADO | No existe evidencia de consultas completadas y pagadas ni operación sostenida. |

## Evidencia confirmada

- Git contiene nuevamente la función Edge que estaba desplegada en Supabase y las migraciones aplicadas el 25 y 26 de agosto.
- Héctor Olvera Boll confirmó su identidad, domicilio para el aviso y el precio de $100 MXN el 2026-08-31.
- La web exige consentimiento antes de habilitar la captura o telemetría de nombre, motivo, horario y teléfono.
- El consentimiento se registra de manera idempotente en Supabase mediante una función disponible sólo para `service_role`.
- WhatsApp muestra el aviso y exige aceptación explícita antes de interpretar el primer mensaje como nombre; una reserva web conserva la autorización ya registrada.
- Una reserva web puede recuperarse desde el webhook firmado de WhatsApp usando código más coincidencia de teléfono.
- Calendar crea un identificador determinista y Supabase sólo cambia a `confirmed` después de recibir el identificador real del evento.
- El webhook valida HMAC de Meta y conserva inbox/outbox para no procesar dos veces un mensaje.
- Las tablas operativas mantienen RLS y las funciones privilegiadas nuevas revocan acceso a `public`, `anon` y `authenticated`.

## Bloqueadores reales

1. Falta una revisión jurídica independiente del aviso de privacidad antes del lanzamiento general.
2. Las migraciones `20260831_record_web_privacy_consent.sql` y `20260830_connect_web_booking_to_whatsapp.sql` aún no se han aplicado a producción.
3. La función Edge corregida aún no se ha desplegado y ningún artefacto integrado ha sido aprobado para producción.
4. No se ha demostrado con una cita sintética el recorrido completo en un entorno separado.
5. No se ha ensayado restauración de base de datos ni rollback coordinado de Netlify y la función Edge.
6. No existe evidencia de mensajes reales procesados por WhatsApp Cloud API ni de una cita real confirmada en Google Calendar.

## Criterio de aceptación del piloto

El piloto puede abrirse únicamente cuando exista evidencia reproducible de:

- consentimiento registrado antes de cualquier dato personal;
- apartado web con código;
- mensaje recibido por el webhook oficial de Meta;
- recuperación del mismo apartado por teléfono y código;
- un solo evento en el calendario secundario;
- el mismo registro en Supabase con estado `confirmed` y `google_event_id`;
- reintento sin duplicar la cita;
- rechazo correcto de horario ocupado;
- cancelación o cambio enviado a revisión humana;
- rollback probado fuera de producción.

## Criterio comercial

Registrar conversaciones, prospectos calificados, citas, pagos, cancelaciones y tiempo de respuesta. La regla operativa vigente es revisar la oferta si, después de 30 conversaciones relevantes, menos de 3 personas aceptan pagar. No ampliar automatizaciones antes de resolver esa señal.
