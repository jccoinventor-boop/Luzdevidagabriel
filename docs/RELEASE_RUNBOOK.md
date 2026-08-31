# Runbook de publicación y reversión

## Regla principal

Git debe ser la fuente de código. No publicar cambios manuales que después no queden reflejados en el repositorio. Cada deploy debe exponer su commit en `/release.json`.

## Entornos

| Entorno | Datos | Calendar | WhatsApp | Uso |
| --- | --- | --- | --- | --- |
| Local | Sintéticos | Simulado | Simulado | Desarrollo y pruebas unitarias. |
| Deploy Preview | Sintéticos | Calendario de prueba | Número/configuración de prueba | Revisión del cambio aislado. |
| Staging | Sintéticos o anonimizados | Calendario secundario de prueba | Configuración restringida | Prueba integrada y rollback. |
| Producción | Reales | Calendario secundario de Gabriel | Número oficial | Sólo después de aprobación. |

No reutilizar datos, credenciales o calendarios entre staging y producción.

## Inventario de variables, sin valores

### Supabase

- `PUBLIC_SUPABASE_URL` sólo para compilar el navegador contra el entorno correcto
- `PUBLIC_SUPABASE_PUBLISHABLE_KEY` sólo clave pública del entorno; nunca una clave secreta
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEYS` preferida para servidor
- `SUPABASE_SERVICE_ROLE_KEY` sólo durante transición heredada
- `SUPABASE_PUBLISHABLE_KEYS` en Edge Functions
- `SUPABASE_ANON_KEY` sólo durante transición heredada
- `RATE_LIMIT_SALT`

### Google Calendar

- `GOOGLE_CALENDAR_ID`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` únicamente en Netlify y limitada al calendario secundario
- Variables `GCP_*` documentadas si se usa Vercel con Workload Identity Federation
- `APPOINTMENT_DURATION_MINUTES` opcional

### Meta / WhatsApp

- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `META_APP_SECRET`
- `META_GRAPH_API_VERSION`

Ningún valor se copia a Git, al navegador, a logs o a este documento.

Las únicas excepciones son la URL y la clave **publicable** de Supabase, que por diseño llegan al navegador. En `deploy-preview` ambas apuntan al proyecto de staging; `SUPABASE_URL` también se fuerza a staging para que una credencial de servidor heredada de otro contexto no pueda escribir en producción.

Netlify excluye del escaneo únicamente `SUPABASE_URL`, porque su valor es un endpoint público y produce un falso positivo al estar versionado. El escaneo de secretos permanece activo para claves administrativas, tokens y credenciales.

## Orden de publicación

1. Verificar que el aviso conserva la identidad y el domicilio confirmados, y obtener revisión jurídica independiente antes del lanzamiento general.
2. Abrir Pull Request desde `codex/production-readiness` y exigir CI aprobado.
3. Crear o verificar un respaldo recuperable de Supabase y documentar quién puede restaurarlo.
4. En un entorno no productivo, aplicar las migraciones nuevas en este orden:
   - `sql/20260831_record_web_privacy_consent.sql`
   - `sql/20260830_connect_web_booking_to_whatsapp.sql`
5. Ejecutar asesores de seguridad y rendimiento de Supabase después de las migraciones.
6. Desplegar `gabriel-public-api` desde la misma revisión del repositorio.
7. Probar acción `consent`, rechazo sin consentimiento, límite de tasa y reserva duplicada con datos sintéticos.
8. Verificar que una conversación nueva de WhatsApp muestra el aviso, no interpreta el primer mensaje como nombre y sólo continúa después de “Sí, acepto”.
9. Crear Deploy Preview de Netlify desde Git y confirmar que `/release.json` muestra el commit esperado.
10. Ejecutar la prueba completa web → WhatsApp → Calendar → Supabase en staging.
11. Ensayar la reversión coordinada.
12. Solicitar aprobación humana y promover exactamente el artefacto probado a producción.
13. Ejecutar smoke tests sin datos de clientes y observar errores antes de iniciar tráfico.

Las migraciones del 25 y 26 de agosto ya existen en la base productiva observada; no deben registrarse de nuevo allí. Sí forman parte del historial para ambientes nuevos.

## Smoke tests de producción

- `GET /` devuelve 200 y la cabecera CSP esperada.
- `GET /aviso-de-privacidad.html` devuelve 200.
- `GET /release.json` devuelve el commit aprobado y `Cache-Control: no-store`.
- Un chat sin consentimiento devuelve `privacy_consent_required`.
- Un cuerpo vacío o acción no permitida se rechaza sin crear prospectos.
- La verificación GET de Meta sólo responde con el token correcto.

No crear una cita real durante un smoke test. La cita integrada se prueba en staging o con autorización explícita y datos sintéticos identificables.

## Reversión

### Señales para revertir

- el consentimiento no puede registrarse;
- el chat recopila datos antes de autorización;
- se crean citas duplicadas;
- se muestra `confirmed` sin `google_event_id`;
- WhatsApp o Calendar producen errores sostenidos;
- `/release.json` no coincide con el commit aprobado.

### Procedimiento

1. Detener campañas y mantener confirmación manual por WhatsApp.
2. Restaurar en Netlify el deploy anterior conocido como estable.
3. Restaurar la versión anterior de `gabriel-public-api` si el nuevo frontend ya no está activo.
4. No revertir automáticamente migraciones aditivas; mantener columnas y funciones compatibles mientras se investiga.
5. Si una migración dañó datos, usar el respaldo verificado y el procedimiento autorizado de Supabase.
6. Confirmar que el sitio, WhatsApp manual y el registro de prospectos funcionan en modo degradado.
7. Documentar causa, impacto, versión y prueba que evitará la repetición.

### Evidencia del ensayo de staging

El 2026-08-31 se completó una reversión de aplicación con datos sintéticos:

1. se creó una cita en estado `hold` y se recuperó por teléfono más código;
2. se creó un evento privado en el calendario secundario y la cita cambió a `confirmed`;
3. se repitió la confirmación sin crear una segunda relación;
4. se eliminó el evento, se quitó `google_event_id` y tanto la cita como la sesión volvieron a estado pendiente;
5. se creó un evento nuevo y se recuperaron cita y sesión a `confirmed`;
6. se eliminaron los eventos y registros sintéticos, y se verificaron cero rastros y el horario libre.

Este ensayo no sustituye una restauración de respaldo ni una reversión de versiones de Netlify y Supabase Edge Functions. Tampoco demuestra la entrega por WhatsApp Cloud API; esos puntos permanecen bloqueados.

## Ruta degradada

Si Calendar o WhatsApp Cloud fallan, el sistema nunca debe prometer una cita confirmada. Debe conservar la solicitud como pendiente y dirigirla a revisión humana de Gabriel.
