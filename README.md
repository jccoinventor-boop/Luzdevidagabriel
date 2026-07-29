# Luz de Vida Gabriel

Landing de conversión y recepción para consultas espirituales de Gabriel en Atlacomulco.

## Incluye

- oferta clara de $100 MXN;
- atención por teléfono, videollamada o presencial;
- WhatsApp `+52 712 246 6811`;
- asistente determinista que filtra aceptación del precio;
- captura de atribución UTM;
- eventos para conversación, calificación y solicitud;
- almacenamiento opcional en Supabase;
- modelo de citas, estados y control de disponibilidad en Supabase;
- calendario operativo separado `Luz de Vida Gabriel`;
- función opcional para respuestas con OpenAI;
- webhook oficial para un agente de WhatsApp Cloud API;
- sesiones persistentes, idempotencia y reglas de calificación en servidor;
- plan de marketing de 30 días;
- arquitectura documentada para llamadas y calendario.

## Estado honesto

Funciona desde el despliegue: landing, WhatsApp, filtro web determinista, preparación de solicitud y captura de eventos.

Requiere configuración externa: credenciales del proyecto Supabase, alta del número en Meta WhatsApp Cloud API, creación y autorización del calendario secundario, llamadas telefónicas y notificaciones privadas. El webhook de WhatsApp y su filtro están implementados, pero no reciben mensajes hasta que Meta valide el endpoint y se carguen las variables privadas. La función generativa de OpenAI está preparada en el backend, pero no forma parte del flujo visible hasta completar controles, pruebas y medición. La cita se mantiene como pendiente hasta que un calendario real confirme la disponibilidad.

## Desarrollo

```bash
npm test
npm run check
npm run build
```

## Despliegue en Netlify

Conectar este repositorio y usar la configuración incluida en `netlify.toml`. Las variables se agregan en la configuración del sitio; nunca deben subirse al repositorio.
