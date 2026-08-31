const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ATTRIBUTION_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "gclid", "fbclid"];
const PUBLIC_EVENTS = new Set(["page_view", "chat_started", "whatsapp_click", "qualified_whatsapp_click", "lead_not_qualified"]);
const REASONS = new Set(["price_not_accepted", "final_confirmation_missing"]);
const RISK_PATTERN = /\b(suicid(?:io|a|arme|arte|arse|arnos|ando)?|quitar(?:me|te|se|nos)?\s+la\s+vida|acabar\s+con\s+mi\s+vida|no\s+quiero\s+vivir|quiero\s+morir|matarme|hacerme\s+daño|hacer\s+daño|violencia|amenaza|emergencia|secuestro|desaparecid[oa]|arma)\b/i;
const YES_PATTERN = /^(sí|si|acepto|de acuerdo|estoy de acuerdo|confirmo)([,!. ]|$)/i;
const NO_PATTERN = /^(no|todavía no|aún no|no acepto|no estoy seguro|lo voy a pensar)([,!. ]|$)/i;
const FINAL_CONFIRMATION_PATTERN = /^s[ií]\s+confirmo\s+mi\s+cita([,!. ]|$)/i;
const MAX_BODY_BYTES = 16_384;
const BUSINESS_TIMEZONE = "America/Mexico_City";
const MIN_NOTICE_MS = 15 * 60 * 1000;
const MAX_ADVANCE_MS = 180 * 24 * 60 * 60 * 1000;
const APPOINTMENT_DURATION_MS = 60 * 60 * 1000;
const PRIVACY_NOTICE_VERSION = "2026-08-31";
const localWindows = new Map();

const allowedOrigin = origin => !origin
  || origin === "https://luzdevidagabriel.netlify.app"
  || origin === "https://main--luzdevidagabriel.netlify.app"
  || origin === "https://bakcrmthmbbdnqmktfhy.supabase.co"
  || /^https:\/\/deploy-preview-\d+--luzdevidagabriel\.netlify\.app$/.test(origin);

const corsHeaders = origin => ({
  ...(origin && allowedOrigin(origin) ? { "access-control-allow-origin": origin } : {}),
  "access-control-allow-headers": "apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-max-age": "86400",
  vary: "Origin"
});

const json = (status, body, origin = "") => new Response(JSON.stringify(body), {
  status,
  headers: {
    ...corsHeaders(origin),
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  }
});

function normalizeText(value) {
  return String(value || "").trim().slice(0, 1000);
}

function normalizeAttribution(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(ATTRIBUTION_KEYS.flatMap(key => {
    const item = value[key];
    if (typeof item !== "string") return [];
    const clean = item.trim().slice(0, 120);
    return clean ? [[key, clean]] : [];
  }));
}

function timezoneParts(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  return Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, Number(part.value)]));
}

function zonedLocalToUtc(parts, timezone) {
  const requestedUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0);
  let candidate = requestedUtc;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const observed = timezoneParts(new Date(candidate), timezone);
    const observedAsUtc = Date.UTC(observed.year, observed.month - 1, observed.day, observed.hour, observed.minute, 0);
    candidate += requestedUtc - observedAsUtc;
  }
  const result = new Date(candidate);
  const observed = timezoneParts(result, timezone);
  return ["year", "month", "day", "hour", "minute"].every(key => observed[key] === parts[key]) ? result : null;
}

function parseAppointmentWindow(value, now = new Date()) {
  const match = String(value || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;
  const [, day, month, year, hour, minute] = match;
  const start = zonedLocalToUtc({
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute)
  }, BUSINESS_TIMEZONE);
  if (!start || start.getTime() < now.getTime() + MIN_NOTICE_MS || start.getTime() > now.getTime() + MAX_ADVANCE_MS) return null;
  return start;
}

function appointmentWindow(value, now = new Date()) {
  const start = parseAppointmentWindow(value, now);
  if (!start) return null;
  return {
    start,
    end: new Date(start.getTime() + APPOINTMENT_DURATION_MS)
  };
}

function formatAppointment(date) {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: BUSINESS_TIMEZONE,
    dateStyle: "full",
    timeStyle: "short"
  }).format(date);
}

const same = (state, lead, reply) => ({ state, lead, reply, qualified: false });

export function nextTurn(session = {}, rawText = "") {
  const text = normalizeText(rawText);
  const state = session.state || "awaiting_name";
  const lead = { ...(session.lead || {}) };

  if (RISK_PATTERN.test(text)) {
    return {
      state: "human_handoff",
      lead,
      qualified: false,
      handoff: true,
      reply: "Lo que describes requiere atención humana inmediata. Este asistente no puede atender emergencias. Contacta a los servicios de emergencia de tu localidad y, si es seguro hacerlo, avisa a una persona de confianza."
    };
  }
  if (state === "awaiting_name") {
    if (text.length < 2) return same(state, lead, "Escribe tu nombre para poder atenderte.");
    lead.name = text.slice(0, 100);
    return same("awaiting_topic", lead, `Gracias, ${lead.name}. Cuéntame brevemente qué situación deseas consultar.`);
  }
  if (state === "awaiting_topic") {
    if (text.length < 8) return same(state, lead, "Necesito una explicación breve de tu situación para saber si la consulta es adecuada.");
    lead.topic = text.slice(0, 500);
    return same("awaiting_price", lead, "La consulta cuesta $100 MXN. ¿Aceptas expresamente ese precio? Responde “Sí, acepto” o “No”.");
  }
  if (state === "awaiting_price") {
    if (NO_PATTERN.test(text)) return { state: "not_qualified", lead: { ...lead, priceAccepted: false }, qualified: false, reply: "Entendido. No agendaré una cita." };
    if (!YES_PATTERN.test(text) || NO_PATTERN.test(text)) return same(state, lead, "Para continuar necesito una respuesta explícita: “Sí, acepto” o “No”.");
    lead.priceAccepted = true;
    return same("awaiting_modality", lead, "¿Cómo prefieres la consulta: teléfono, videollamada o presencial?");
  }
  if (state === "awaiting_modality") {
    const modality = /video/i.test(text) ? "Videollamada" : /presencial/i.test(text) ? "Presencial" : /tel[eé]fono|llamada/i.test(text) ? "Teléfono" : null;
    if (!modality) return same(state, lead, "Elige una modalidad: teléfono, videollamada o presencial.");
    lead.modality = modality;
    return same("awaiting_availability", lead, "Indica fecha y hora como DD/MM/AAAA HH:MM, usando 24 horas.");
  }
  if (state === "awaiting_availability") {
    if (!parseAppointmentWindow(text)) return same(state, lead, "Necesito una fecha futura válida como DD/MM/AAAA HH:MM, usando 24 horas.");
    lead.availability = text.slice(0, 200);
    return same("awaiting_final_confirmation", lead, "Para marcarte como prospecto serio, responde exactamente: “SÍ CONFIRMO MI CITA”.");
  }
  if (state === "awaiting_final_confirmation") {
    if (NO_PATTERN.test(text)) return { state: "not_qualified", lead: { ...lead, bookingConfirmedIntent: false }, qualified: false, reply: "Entendido. No registraré una cita." };
    if (!FINAL_CONFIRMATION_PATTERN.test(text)) return same(state, lead, "Responde exactamente: “SÍ CONFIRMO MI CITA”.");
    return {
      state: "qualified_pending_slot",
      lead: { ...lead, finalConfirmation: "SÍ CONFIRMO MI CITA", bookingConfirmedIntent: true },
      qualified: true,
      reply: "Solicitud seria registrada. La cita queda pendiente de comprobar disponibilidad real; Gabriel confirmará fecha y hora definitivas por WhatsApp."
    };
  }
  return { state: "human_handoff", lead, qualified: false, handoff: true, reply: "Gabriel revisará personalmente esta conversación." };
}

export function replayConversation(messages = []) {
  let turn = { state: "awaiting_name", lead: {}, qualified: false };
  for (const item of messages.slice(-12)) {
    if (item?.role === "user") turn = nextTurn({ state: turn.state, lead: turn.lead }, item.content);
  }
  return turn;
}

async function readJsonBody(request) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw Object.assign(new Error("payload_too_large"), { status: 413 });
  if (!request.body) throw Object.assign(new Error("invalid_json"), { status: 400 });
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel("payload_too_large").catch(() => undefined);
      throw Object.assign(new Error("payload_too_large"), { status: 413 });
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(merged));
  } catch {
    throw Object.assign(new Error("invalid_json"), { status: 400 });
  }
}

function secretKey(getEnv) {
  const modern = getEnv("SUPABASE_SECRET_KEYS");
  if (modern) {
    try {
      const parsed = JSON.parse(modern);
      if (typeof parsed.default === "string" && parsed.default) return parsed.default;
    } catch {
      // Fall through to the legacy key during the migration window.
    }
  }
  return getEnv("SUPABASE_SERVICE_ROLE_KEY") || "";
}

function hasValidPublishableKey(request, getEnv) {
  const supplied = request.headers.get("apikey") || "";
  if (!supplied) return false;
  const modern = getEnv("SUPABASE_PUBLISHABLE_KEYS");
  if (modern) {
    try {
      const parsed = JSON.parse(modern);
      if (Object.values(parsed).some(value => typeof value === "string" && value === supplied)) return true;
    } catch {
      // Fall through to the legacy key during the migration window.
    }
  }
  return supplied === getEnv("SUPABASE_ANON_KEY");
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function clientKey(request, salt) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const userAgent = request.headers.get("user-agent")?.slice(0, 160) || "unknown";
  return sha256(`${salt}:${forwarded.slice(0, 120)}:${userAgent}`);
}

function locallyRateLimited(key, scope, now = Date.now()) {
  const windowKey = `${scope}:${key}`;
  const current = localWindows.get(windowKey);
  if (!current || current.startedAt <= now - 60_000) {
    for (const [candidate, value] of localWindows) {
      if (value.startedAt <= now - 60_000) localWindows.delete(candidate);
    }
    while (localWindows.size >= 2_000) localWindows.delete(localWindows.keys().next().value);
    localWindows.set(windowKey, { startedAt: now, count: 1 });
    return false;
  }
  current.count += 1;
  return current.count > 40;
}

function validateChat(body) {
  if (!UUID_PATTERN.test(String(body.sessionId || ""))) throw Object.assign(new Error("invalid_session"), { status: 422 });
  validatePrivacy(body.privacy);
  if (!Array.isArray(body.messages) || body.messages.length > 12) throw Object.assign(new Error("invalid_messages"), { status: 422 });
  if (body.messages.some(item => !item || item.role !== "user" || typeof item.content !== "string" || item.content.length > 1000)) {
    throw Object.assign(new Error("invalid_message"), { status: 422 });
  }
  return {
    sessionId: body.sessionId,
    messages: body.messages,
    phone: typeof body.phone === "string" ? body.phone.replace(/\D/g, "") : "",
    attribution: normalizeAttribution(body.attribution),
    privacyNoticeVersion: PRIVACY_NOTICE_VERSION
  };
}

function validatePrivacy(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || value.accepted !== true
    || value.noticeVersion !== PRIVACY_NOTICE_VERSION) {
    throw Object.assign(new Error("privacy_consent_required"), { status: 422 });
  }
  return { noticeVersion: PRIVACY_NOTICE_VERSION };
}

function validateConsent(body) {
  if (!UUID_PATTERN.test(String(body.sessionId || ""))) throw Object.assign(new Error("invalid_session"), { status: 422 });
  const privacy = validatePrivacy(body.privacy);
  return { sessionId: body.sessionId, ...privacy };
}

function validateLead(body) {
  if (!PUBLIC_EVENTS.has(body.event)) throw Object.assign(new Error("event_not_allowed"), { status: 422 });
  if (!UUID_PATTERN.test(String(body.sessionId || ""))) throw Object.assign(new Error("invalid_session"), { status: 422 });
  return {
    event: body.event,
    sessionId: body.sessionId,
    reason: REASONS.has(body.reason) ? body.reason : null,
    source: typeof body.source === "string" ? body.source.trim().slice(0, 80) || null : null,
    attribution: normalizeAttribution(body.attribution)
  };
}

async function rpc(fetchFn, url, key, name, body) {
  const response = await fetchFn(`${url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: key, "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error("storage_failed");
  return response.json();
}

export function createHandler({ getEnv, fetchFn = fetch }) {
  return async request => {
    const origin = request.headers.get("origin") || "";
    if (!allowedOrigin(origin)) return json(403, { error: "origin_not_allowed" });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
    if (request.method !== "POST") return json(405, { error: "method_not_allowed" }, origin);
    if (!hasValidPublishableKey(request, getEnv)) return json(401, { error: "invalid_api_key" }, origin);

    let body;
    try {
      body = await readJsonBody(request);
    } catch (error) {
      return json(error.status || 400, { error: error.message || "invalid_json" }, origin);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return json(422, { error: "invalid_payload" }, origin);

    const key = secretKey(getEnv);
    const url = getEnv("SUPABASE_URL") || "";
    if (!key || !url) return json(503, { error: "storage_not_configured" }, origin);
    const hashedClient = await clientKey(request, key);

    try {
      if (body.action === "lead") {
        if (locallyRateLimited(hashedClient, "telemetry")) return json(429, { error: "rate_limited" }, origin);
        const lead = validateLead(body);
        const result = await rpc(fetchFn, url, key, "gabriel_record_public_event", {
          p_client_key: hashedClient,
          p_event: lead.event,
          p_session_id: lead.sessionId,
          p_reason: lead.reason,
          p_source: lead.source,
          p_attribution: lead.attribution
        });
        if (result === "rate_limited") return json(429, { error: "rate_limited" }, origin);
        if (result === "invalid") return json(422, { error: "invalid_payload" }, origin);
        return json(202, { accepted: true }, origin);
      }

      if (body.action === "consent") {
        if (locallyRateLimited(hashedClient, "consent")) return json(429, { error: "rate_limited" }, origin);
        const consent = validateConsent(body);
        const result = await rpc(fetchFn, url, key, "gabriel_record_web_privacy_consent", {
          p_client_key: hashedClient,
          p_session_id: consent.sessionId,
          p_notice_version: consent.noticeVersion
        });
        if (result === "rate_limited") return json(429, { error: "rate_limited" }, origin);
        if (result === "invalid") return json(422, { error: "invalid_privacy_consent" }, origin);
        return json(201, { accepted: true, noticeVersion: consent.noticeVersion }, origin);
      }

      if (body.action === "chat") {
        if (locallyRateLimited(hashedClient, "qualified")) return json(429, { error: "rate_limited" }, origin);
        const chat = validateChat(body);
        const consent = await rpc(fetchFn, url, key, "gabriel_record_web_privacy_consent", {
          p_client_key: hashedClient,
          p_session_id: chat.sessionId,
          p_notice_version: chat.privacyNoticeVersion
        });
        if (consent === "rate_limited") return json(429, { error: "rate_limited" }, origin);
        if (consent === "invalid") return json(422, { error: "invalid_privacy_consent" }, origin);
        const turn = replayConversation(chat.messages);
        let storage = "not_needed";
        let booking = null;
        if (turn.qualified) {
          if (!/^\d{10}$/.test(chat.phone)) return json(422, { error: "invalid_phone" }, origin);
          const window = appointmentWindow(turn.lead.availability);
          if (!window) return json(422, { error: "invalid_appointment_window" }, origin);
          storage = await rpc(fetchFn, url, key, "gabriel_record_qualified_web_lead", {
            p_client_key: hashedClient,
            p_session_id: chat.sessionId,
            p_name: turn.lead.name,
            p_topic: turn.lead.topic,
            p_modality: turn.lead.modality,
            p_availability: turn.lead.availability,
            p_phone: chat.phone,
            p_attribution: chat.attribution
          });
          if (storage === "rate_limited") return json(429, { error: "rate_limited" }, origin);
          if (storage === "invalid") return json(422, { error: "invalid_payload" }, origin);

          const rows = await rpc(fetchFn, url, key, "gabriel_book_web_appointment", {
            p_client_key: hashedClient,
            p_session_id: chat.sessionId,
            p_customer_name: turn.lead.name,
            p_customer_phone: chat.phone,
            p_topic: turn.lead.topic,
            p_modality: turn.lead.modality,
            p_starts_at: window.start.toISOString(),
            p_ends_at: window.end.toISOString(),
            p_attribution: chat.attribution
          });
          const row = Array.isArray(rows) ? rows[0] : null;
          if (!row || row.result === "invalid") return json(422, { error: "invalid_booking" }, origin);
          if (row.result === "rate_limited") return json(429, { error: "rate_limited" }, origin);
          if (row.result === "unavailable") {
            return json(409, {
              error: "slot_unavailable",
              message: "Ese horario ya no está disponible. Elige otra fecha y hora."
            }, origin);
          }
          booking = {
            id: row.appointment_id,
            code: String(row.appointment_id || "").slice(0, 8).toUpperCase(),
            startsAt: row.starts_at || window.start.toISOString(),
            endsAt: row.ends_at || window.end.toISOString(),
            status: row.appointment_status || "hold",
            result: row.result
          };
        }
        return json(200, {
          message: booking
            ? `Tu horario quedó apartado durante 30 minutos para ${formatAppointment(new Date(booking.startsAt))}. Abre WhatsApp ahora para que Gabriel confirme los detalles y la forma de pago.`
            : turn.reply,
          state: booking ? "held" : turn.state,
          qualified: Boolean(turn.qualified),
          handoff: Boolean(turn.handoff),
          stored: storage === "inserted" || storage === "duplicate",
          booking
        }, origin);
      }

      return json(422, { error: "action_not_allowed" }, origin);
    } catch (error) {
      if (error?.status) return json(error.status, { error: error.message }, origin);
      return json(502, { error: "storage_failed" }, origin);
    }
  };
}
