# Modelo de amenazas

Alcance: landing, API pública de Supabase, funciones Netlify/Vercel, webhook de Meta, Supabase y Google Calendar en la rama `codex/production-readiness`. No constituye una auditoría externa ni una garantía de riesgo cero.

## Activos

- nombre, teléfono, tema general y horario de prospectos;
- agenda y eventos de Gabriel;
- secretos de Supabase, Meta y Google;
- estados de citas y pagos;
- disponibilidad, reputación y trazabilidad del servicio;
- repositorio y artefactos desplegados.

## Fronteras de confianza

1. Navegador público → Edge Function.
2. Meta → webhook firmado de WhatsApp.
3. Funciones de servidor → Supabase con clave secreta.
4. Funciones de servidor → Google Calendar con identidad limitada.
5. Git/CI → Netlify, Supabase y Vercel.

## Amenazas prioritarias y controles

| Amenaza | Impacto | Controles actuales | Riesgo residual |
| --- | --- | --- | --- |
| Envío masivo de eventos o reservas falsas | Saturación y agenda inutilizable | Validación de esquema, cuerpos acotados, límites locales y durables, origen permitido | Un atacante distribuido puede consumir capacidad; requiere monitoreo. |
| Robo de clave privilegiada | Lectura o modificación de datos | Secretos sólo en servidor, claves publicables en navegador, RLS, RPC privilegiadas revocadas al público | Falta verificar rotación, MFA y permisos de cada cuenta externa. |
| Webhook falso o repetido | Mensajes/citas manipulados | HMAC de Meta, identificador durable de mensaje, inbox/outbox e idempotencia | Depende de proteger `META_APP_SECRET` y revisar fallos persistentes. |
| Cita duplicada por reintento | Conflicto con clientes | Exclusión de solapamiento, hold atómico, ID determinista de Google y confirmación idempotente | Debe verificarse con el Calendar real en staging. |
| Código corto adivinado | Acceso a una reserva ajena | Sólo webhook firmado, coincidencia de teléfono y código, función disponible sólo a `service_role` | El código por sí solo tiene entropía limitada; nunca se acepta sin teléfono y canal firmado. |
| Recopilar datos sin informar | Riesgo legal y de confianza | Aviso visible con responsable y domicilio confirmados, telemetría e interfaz web bloqueadas, consentimiento versionado y aviso previo en WhatsApp | Falta revisión jurídica independiente. |
| Falla parcial Google/Supabase | Confirmación falsa o estado dividido | Sólo se confirma con `google_event_id`; reintento determinista; modo pendiente y revisión humana | Falta prueba real de recuperación y alertas operativas. |
| Mensaje de emergencia tratado como venta | Daño a una persona | Detección de riesgo, bloqueo de agenda y entrega a humano | La detección por patrones no reconoce todos los casos; Gabriel debe revisar derivaciones. |
| Código desplegado distinto de Git | Imposibilidad de reproducir o revertir | Migraciones recuperadas, commit en `/release.json`, CI y runbook | La integración Git de Netlify aún debe activarse y comprobarse. |
| Dependencia vulnerable | Ejecución o filtración | Versiones fijadas, lockfile, pruebas y `npm audit` en CI | `npm audit` no sustituye revisión de código ni auditoría externa. |

## Respuesta a incidente

1. Detener tráfico pagado y automatización afectada.
2. Revocar o rotar el secreto comprometido.
3. Conservar logs técnicos sin copiar datos personales innecesarios.
4. Cambiar a confirmación manual.
5. Evaluar datos y usuarios afectados.
6. Restaurar versión estable y comprobar integridad.
7. Convertir la causa en una prueba y actualizar este documento.
