# Preparación de producción — Luz de Vida Gabriel

Evaluación actualizada el 2026-09-01 para la rama `codex/production-readiness`.

## Decisión por alcance

| Alcance | Decisión | Evidencia |
| --- | --- | --- |
| Desarrollo local | GO | Pruebas, sintaxis y build automatizados. |
| Deploy Preview restringido | GO | Artefacto de Netlify, commit publicado, CSP y conexión exclusiva al backend de staging verificados. Usar sólo datos sintéticos. |
| Piloto real controlado | BLOQUEADO | El flujo sintético llegó a Calendar y superó rollback/recuperación de datos, Deploy Preview y función Edge, pero falta la entrega real por WhatsApp Cloud API, validar la identidad de servicio desplegada, restaurar un respaldo y revisar jurídicamente el aviso. |
| Campaña o lanzamiento general | BLOQUEADO | No existe evidencia de consultas completadas y pagadas ni operación sostenida. |

## Evidencia confirmada

- Git contiene nuevamente la función Edge que estaba desplegada en Supabase y las migraciones aplicadas el 25 y 26 de agosto.
- Hector Adair Lovera Garfias fue confirmado como nombre completo del responsable; también se confirmaron el domicilio para el aviso y el precio de $100 MXN el 2026-08-31.
- La web exige consentimiento antes de habilitar la captura o telemetría de nombre, motivo, horario y teléfono.
- El consentimiento se registra de manera idempotente en Supabase mediante una función disponible sólo para `service_role`.
- WhatsApp muestra el aviso y exige aceptación explícita antes de interpretar el primer mensaje como nombre; una reserva web conserva la autorización ya registrada.
- Una reserva web puede recuperarse desde el webhook firmado de WhatsApp usando código más coincidencia de teléfono.
- Calendar crea un identificador determinista y Supabase sólo cambia a `confirmed` después de recibir el identificador real del evento.
- El webhook valida HMAC de Meta y conserva inbox/outbox para no procesar dos veces un mensaje.
- Las tablas operativas mantienen RLS y las funciones privilegiadas nuevas revocan acceso a `public`, `anon` y `authenticated`.
- El proyecto aislado `Luz de vida Gabriel Staging` contiene únicamente datos sintéticos, todas las migraciones versionadas y la función Edge de esta rama.
- En staging se comprobó rechazo sin clave, registro de consentimiento, apartado de horario, rechazo de duplicado y recuperación del mismo apartado por teléfono más código.
- La prueba de staging encontró y corrigió una referencia SQL ambigua antes de que esa migración llegara a producción.
- El 2026-08-31 se ejecutó un recorrido sintético sin datos de clientes: apartado web, recuperación por código y teléfono, inbox durable de WhatsApp, evento privado en el calendario secundario real, confirmación en Supabase y reintento idempotente. Existió un solo registro con el identificador de Calendar.
- En el mismo ensayo se eliminó el evento, se devolvieron la cita y la sesión al estado pendiente, se creó un segundo evento, se recuperó el estado confirmado y se comprobó nuevamente la relación uno a uno.
- Al terminar se borraron ambos eventos de prueba y los seis tipos de registros sintéticos creados (cita, inbox, outbox, evento de lead, sesión y límite de solicitud). Las verificaciones finales devolvieron cero rastros del ensayo y el horario volvió a quedar libre.
- El Deploy Preview se revirtió al árbol estable anterior mediante el commit `cac15a0` y se recuperó al árbol actual mediante `14504bd`; CI, cabeceras, redirecciones y Netlify aprobaron ambos despliegues.
- La función Edge se desplegó en staging como versión 2, se revirtió al código estable anterior como versión 3 y se recuperó como versión 4. Las versiones 2 y 4 comparten exactamente el hash `d92b0ecc5cfec777890c6581fa1ff931ab9503e40a742d7d678e6601dbebdab1`; la versión 4 quedó `ACTIVE`.
- La función Edge expone únicamente su número de versión mediante `x-gabriel-edge-version`. La prueba automatizada valida la cabecera y el CORS; Supabase confirmó el código y hash activos, aunque este entorno no permitió inspeccionar la cabecera por HTTP externo después del despliegue.
- El Deploy Preview de Netlify publica la revisión esperada, conserva `Cache-Control: no-store` en `/release.json` y su navegador apunta al proyecto aislado, no al Supabase productivo.
- Las funciones auxiliares del Deploy Preview reciben la URL de staging; no se guarda ninguna clave administrativa en Git y fallan cerradas mientras no exista una credencial de servidor exclusiva de staging.

## Bloqueadores reales

1. Falta una revisión jurídica independiente del aviso de privacidad antes del lanzamiento general.
2. Las migraciones `20260831_record_web_privacy_consent.sql` y `20260830_connect_web_booking_to_whatsapp.sql` ya fueron probadas en staging, pero aún no se han respaldado ni aprobado para producción.
3. La función Edge corregida sólo está desplegada en staging y ningún artefacto integrado ha sido aprobado para producción.
4. Falta completar el recorrido por el número de prueba de Meta. El ensayo validó la lógica durable de WhatsApp y un evento real de Calendar, pero no atravesó el webhook oficial, el envío por Graph API ni las credenciales de cuenta de servicio de la función desplegada.
5. El rollback y la recuperación de cita, sesión, evento, Deploy Preview y función Edge ya se ensayaron fuera de producción. Falta restaurar una copia real de base de datos en un proyecto aislado y verificar su integridad.
6. No existe evidencia de un mensaje procesado por WhatsApp Cloud API ni de una cita de cliente confirmada; todos los datos y eventos de este ensayo fueron sintéticos y se eliminaron.

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
