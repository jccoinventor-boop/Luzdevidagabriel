import crypto from "node:crypto";
import { getVercelOidcToken } from "@vercel/oidc";
import { ExternalAccountClient, JWT } from "google-auth-library";

const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const BUSINESS_TIMEZONE = "America/Mexico_City";
const MIN_NOTICE_MS = 15 * 60 * 1000;
const MAX_ADVANCE_MS = 180 * 24 * 60 * 60 * 1000;

let cachedAuth = null;

function environmentValue(key) {
  const netlifyValue = globalThis.Netlify?.env?.get?.(key);
  return netlifyValue === undefined ? process.env[key] : netlifyValue;
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
  const matches = ["year", "month", "day", "hour", "minute"].every(key => observed[key] === parts[key]);
  return matches ? result : null;
}

export function parseAppointmentWindow(value, now = new Date(), timezone = BUSINESS_TIMEZONE) {
  const match = String(value || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;

  const [, day, month, year, hour, minute] = match;
  const parts = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute)
  };
  const start = zonedLocalToUtc(parts, timezone);
  if (!start || start.getTime() < now.getTime() + MIN_NOTICE_MS || start.getTime() > now.getTime() + MAX_ADVANCE_MS) return null;

  const configuredDuration = Number(environmentValue("APPOINTMENT_DURATION_MINUTES") || 60);
  const durationMinutes = Number.isInteger(configuredDuration) && configuredDuration >= 15 && configuredDuration <= 240
    ? configuredDuration
    : 60;
  return { start, end: new Date(start.getTime() + durationMinutes * 60 * 1000), timezone, durationMinutes };
}

export function appointmentInputExample(now = new Date(), timezone = BUSINESS_TIMEZONE) {
  const target = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const parts = timezoneParts(target, timezone);
  return `${String(parts.day).padStart(2, "0")}/${String(parts.month).padStart(2, "0")}/${parts.year} 17:00`;
}

export function calendarConfiguration() {
  const calendarId = environmentValue("GOOGLE_CALENDAR_ID")?.trim();
  const projectId = environmentValue("GCP_PROJECT_ID")?.trim();
  const projectNumber = environmentValue("GCP_PROJECT_NUMBER")?.trim();
  const workloadServiceAccountEmail = environmentValue("GCP_SERVICE_ACCOUNT_EMAIL")?.trim();
  const poolId = environmentValue("GCP_WORKLOAD_IDENTITY_POOL_ID")?.trim();
  const providerId = environmentValue("GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID")?.trim();
  const netlifyServiceAccountEmail = environmentValue("GOOGLE_SERVICE_ACCOUNT_EMAIL")?.trim();
  const hasNetlifyPrivateKey = Boolean(environmentValue("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY")?.trim());
  const isSecondaryCalendar = Boolean(calendarId && /@group\.calendar\.google\.com$/i.test(calendarId));
  const workloadIdentityConfigured = Boolean(
    environmentValue("VERCEL") === "1" &&
    projectId &&
    projectNumber &&
    workloadServiceAccountEmail &&
    poolId &&
    providerId
  );
  const serviceAccountConfigured = Boolean(
    environmentValue("NETLIFY") === "true" &&
    netlifyServiceAccountEmail &&
    hasNetlifyPrivateKey
  );
  const authMode = workloadIdentityConfigured
    ? "workload_identity_federation"
    : serviceAccountConfigured
      ? "service_account"
      : "unconfigured";
  return {
    calendarId,
    projectId,
    projectNumber,
    serviceAccountEmail: workloadIdentityConfigured ? workloadServiceAccountEmail : netlifyServiceAccountEmail,
    poolId,
    providerId,
    authMode,
    configured: Boolean(isSecondaryCalendar && authMode !== "unconfigured")
  };
}

export function externalAccountConfiguration(config, subjectTokenSupplier = () => getVercelOidcToken({ audience: config.audience })) {
  return {
    type: "external_account",
    audience: config.audience,
    subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
    token_url: "https://sts.googleapis.com/v1/token",
    service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${config.serviceAccountEmail}:generateAccessToken`,
    subject_token_supplier: { getSubjectToken: subjectTokenSupplier }
  };
}

function workloadIdentityClient() {
  const config = calendarConfiguration();
  if (!config.configured || config.authMode !== "workload_identity_federation") {
    throw new Error("calendar_not_configured");
  }
  const audience = `https://iam.googleapis.com/projects/${config.projectNumber}/locations/global/workloadIdentityPools/${config.poolId}/providers/${config.providerId}`;
  const cacheKey = `${audience}:${config.serviceAccountEmail}`;
  if (cachedAuth?.key === cacheKey) return cachedAuth.client;

  const client = ExternalAccountClient.fromJSON(externalAccountConfiguration({
    audience,
    serviceAccountEmail: config.serviceAccountEmail
  }));
  if (!client) throw new Error("calendar_identity_client_failed");
  client.scopes = [CALENDAR_SCOPE];
  cachedAuth = { key: cacheKey, client };
  return client;
}

function serviceAccountClient() {
  const config = calendarConfiguration();
  if (!config.configured || config.authMode !== "service_account") {
    throw new Error("calendar_not_configured");
  }
  const privateKey = environmentValue("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY")?.replace(/\\n/g, "\n").trim();
  if (!privateKey) throw new Error("calendar_not_configured");

  const cacheKey = `service-account:${config.serviceAccountEmail}`;
  if (cachedAuth?.key === cacheKey) return cachedAuth.client;
  const client = new JWT({
    email: config.serviceAccountEmail,
    key: privateKey,
    scopes: [CALENDAR_SCOPE]
  });
  cachedAuth = { key: cacheKey, client };
  return client;
}

async function accessToken() {
  const config = calendarConfiguration();
  const client = config.authMode === "workload_identity_federation"
    ? workloadIdentityClient()
    : serviceAccountClient();
  const response = await client.getAccessToken();
  const token = typeof response === "string" ? response : response?.token;
  if (!token) throw new Error("calendar_token_missing");
  return token;
}

async function googleRequest(path, options = {}) {
  const token = await accessToken();
  return fetch(`${CALENDAR_API}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
}

async function calendarIsFree(window) {
  const { calendarId } = calendarConfiguration();
  const response = await googleRequest("/freeBusy", {
    method: "POST",
    body: JSON.stringify({
      timeMin: window.start.toISOString(),
      timeMax: window.end.toISOString(),
      timeZone: window.timezone,
      items: [{ id: calendarId }]
    })
  });
  if (!response.ok) throw new Error(`calendar_freebusy_failed_${response.status}`);
  const payload = await response.json();
  const calendar = payload.calendars?.[calendarId];
  if (!calendar || calendar.errors?.length) throw new Error("calendar_freebusy_unavailable");
  return !calendar.busy?.length;
}

async function rpc(name, parameters) {
  const url = environmentValue("SUPABASE_URL");
  let key = "";
  let legacy = false;
  const modern = environmentValue("SUPABASE_SECRET_KEYS");
  if (modern) {
    try {
      key = JSON.parse(modern).default || "";
    } catch {
      // La clave heredada se conserva únicamente durante la transición.
    }
  }
  if (!key) {
    key = environmentValue("SUPABASE_SERVICE_ROLE_KEY") || "";
    legacy = Boolean(key);
  }
  if (!url || !key) throw new Error("supabase_not_configured");
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: key,
      ...(legacy ? { authorization: `Bearer ${key}` } : {}),
      "content-type": "application/json"
    },
    body: JSON.stringify(parameters)
  });
  if (!response.ok) throw new Error(`${name}_failed_${response.status}`);
  return response.json();
}

function deterministicEventId(messageId) {
  return `gabriel${crypto.createHash("sha256").update(messageId).digest("hex").slice(0, 48)}`;
}

async function readExistingEvent(messageId) {
  const { calendarId } = calendarConfiguration();
  const eventId = deterministicEventId(messageId);
  const encodedCalendar = encodeURIComponent(calendarId);
  const response = await googleRequest(`/calendars/${encodedCalendar}/events/${eventId}`);
  if (response.ok) return response.json();
  if (response.status === 404) return null;
  throw new Error(`calendar_event_read_failed_${response.status}`);
}

async function createOrReadEvent(messageId, lead, phone, window) {
  const { calendarId } = calendarConfiguration();
  const eventId = deterministicEventId(messageId);
  const encodedCalendar = encodeURIComponent(calendarId);
  const event = {
    id: eventId,
    summary: `Consulta espiritual · ${lead.name}`,
    description: [
      `Modalidad: ${lead.modality}`,
      `Contacto: +${phone}`,
      `Tema: ${String(lead.topic || "").slice(0, 500)}`,
      "Reserva creada por el agente de Luz de Vida Gabriel."
    ].join("\n"),
    start: { dateTime: window.start.toISOString(), timeZone: window.timezone },
    end: { dateTime: window.end.toISOString(), timeZone: window.timezone },
    extendedProperties: { private: { booking_message_id: messageId.slice(0, 250) } },
    guestsCanInviteOthers: false,
    guestsCanModify: false,
    reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 60 }] }
  };

  const response = await googleRequest(`/calendars/${encodedCalendar}/events?sendUpdates=none`, {
    method: "POST",
    body: JSON.stringify(event)
  });
  if (response.ok) return response.json();
  if (response.status === 409) {
    const existing = await googleRequest(`/calendars/${encodedCalendar}/events/${eventId}`);
    if (existing.ok) return existing.json();
  }
  throw new Error(`calendar_event_failed_${response.status}`);
}

function formatWindow(window) {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: window.timezone,
    dateStyle: "full",
    timeStyle: "short"
  }).format(window.start);
}

function pendingTurn(turn, reply, state = "qualified_pending_slot", qualified = true) {
  return { ...turn, state, qualified, reply };
}

function webBookingWindow(booking) {
  const start = new Date(booking?.starts_at || "");
  const end = new Date(booking?.ends_at || "");
  const durationMinutes = (end.getTime() - start.getTime()) / 60_000;
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())
    || !Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 240) return null;
  return { start, end, timezone: BUSINESS_TIMEZONE, durationMinutes };
}

function webBookingTurn(booking) {
  return {
    state: "qualified_pending_slot",
    qualified: true,
    lead: {
      name: booking.customer_name,
      topic: booking.topic,
      priceAccepted: true,
      modality: booking.modality,
      availability: booking.starts_at,
      finalConfirmation: "SÍ CONFIRMO MI CITA",
      bookingConfirmedIntent: true,
      webBookingId: booking.appointment_id,
      privacyNoticeVersion: "2026-08-31",
      privacyConsentSource: "web_recorded"
    },
    reply: "Solicitud web localizada y pendiente de confirmación."
  };
}

export async function confirmWebBooking(message, booking) {
  const turn = webBookingTurn(booking);
  const window = webBookingWindow(booking);
  if (!window) {
    return pendingTurn(turn, "Encontré la solicitud, pero el horario guardado no es válido. Gabriel deberá revisarla personalmente.", "human_handoff", false);
  }
  if (booking.appointment_status === "confirmed" && booking.google_event_id) {
    return {
      ...turn,
      state: "confirmed",
      lead: { ...turn.lead, appointmentStartsAt: window.start.toISOString(), googleEventId: booking.google_event_id },
      reply: `Tu cita ya está confirmada para ${formatWindow(window)}. Modalidad: ${booking.modality}. Costo: $100 MXN.`
    };
  }
  if (!calendarConfiguration().configured) {
    return pendingTurn(turn, "Encontré tu horario apartado, pero Calendar todavía no pudo confirmarlo. Gabriel lo revisará personalmente; no lo consideres confirmado aún.");
  }

  const eventKey = `web:${booking.appointment_id}`;
  let createdGoogleEventId = null;
  try {
    let event = await readExistingEvent(eventKey);
    if (!event) {
      if (!(await calendarIsFree(window))) {
        await rpc("gabriel_release_appointment", { p_appointment_id: booking.appointment_id }).catch(() => false);
        return pendingTurn(
          turn,
          "El horario apartado en la web ya no está libre en Calendar. No quedó confirmado; escribe otra fecha y hora para que Gabriel la revise.",
          "awaiting_availability",
          false
        );
      }
      event = await createOrReadEvent(eventKey, turn.lead, message.from, window);
      createdGoogleEventId = event.id;
    }
    const confirmed = await rpc("gabriel_confirm_appointment", {
      p_appointment_id: booking.appointment_id,
      p_google_event_id: event.id
    });
    if (confirmed !== true) throw new Error("appointment_confirmation_failed");
    return {
      ...turn,
      state: "confirmed",
      lead: { ...turn.lead, appointmentStartsAt: window.start.toISOString(), googleEventId: event.id },
      reply: `Tu cita quedó confirmada para ${formatWindow(window)}. Modalidad: ${booking.modality}. Costo: $100 MXN. Si necesitas cambiarla, escribe REAGENDAR.`
    };
  } catch {
    return pendingTurn(
      turn,
      createdGoogleEventId
        ? "Calendar recibió la cita, pero la confirmación interna quedó pendiente. Gabriel la revisará antes de prometerte el horario."
        : "Encontré tu solicitud, pero Calendar no pudo confirmarla. Gabriel la revisará personalmente; no la consideres confirmada todavía."
    );
  }
}

export async function autoBookQualifiedTurn(message, turn) {
  if (!turn.qualified) return turn;
  const window = parseAppointmentWindow(turn.lead?.availability);
  if (!window) {
    return pendingTurn(
      turn,
      `No pude interpretar el horario con seguridad. Envíalo como DD/MM/AAAA HH:MM en formato de 24 horas; por ejemplo: ${appointmentInputExample()}.`,
      "awaiting_availability",
      false
    );
  }
  if (!calendarConfiguration().configured) return turn;

  let hold = null;
  let observedGoogleEventId = null;
  try {
    const existingEvent = await readExistingEvent(message.id);
    observedGoogleEventId = existingEvent?.id || null;
    if (!existingEvent && !(await calendarIsFree(window))) {
      return pendingTurn(
        turn,
        `Ese horario ya está ocupado. Envíame otra opción como ${appointmentInputExample()} en formato de 24 horas.`,
        "awaiting_availability",
        false
      );
    }

    const rows = await rpc("gabriel_hold_appointment", {
      p_session_id: message.from,
      p_booking_message_id: message.id,
      p_customer_name: turn.lead.name,
      p_customer_phone: message.from,
      p_topic: turn.lead.topic,
      p_modality: turn.lead.modality,
      p_starts_at: window.start.toISOString(),
      p_ends_at: window.end.toISOString()
    });
    hold = Array.isArray(rows) ? rows[0] : null;
    if (!hold || hold.result === "unavailable" || hold.result === "invalid") {
      return pendingTurn(
        turn,
        `Ese horario dejó de estar disponible. Envíame otra opción como ${appointmentInputExample()} en formato de 24 horas.`,
        "awaiting_availability",
        false
      );
    }
    if (hold.result === "active_exists") {
      const alreadyConfirmed = hold.appointment_status === "confirmed" && hold.google_event_id;
      return pendingTurn(
        turn,
        alreadyConfirmed
          ? "Ya existe una cita activa para este número. Si necesitas cambiarla, escribe REAGENDAR."
          : "Ya existe una solicitud de cita activa para este número y sigue pendiente de confirmación. Gabriel la revisará por WhatsApp.",
        alreadyConfirmed ? "confirmed" : "qualified_pending_slot",
        true
      );
    }

    let googleEventId = hold.google_event_id || existingEvent?.id;
    if (!googleEventId) {
      const event = await createOrReadEvent(message.id, turn.lead, message.from, window);
      googleEventId = event.id;
      observedGoogleEventId = googleEventId;
    }

    const alreadyCommitted = hold.appointment_status === "confirmed" && hold.google_event_id === googleEventId;
    if (!alreadyCommitted) {
      const confirmed = await rpc("gabriel_confirm_appointment", {
        p_appointment_id: hold.appointment_id,
        p_google_event_id: googleEventId
      });
      if (confirmed !== true) throw new Error("appointment_confirmation_failed");
    }

    return {
      ...turn,
      state: "confirmed",
      qualified: true,
      lead: {
        ...turn.lead,
        appointmentStartsAt: window.start.toISOString(),
        googleEventId
      },
      reply: `Tu cita quedó confirmada para ${formatWindow(window)}. Modalidad: ${turn.lead.modality}. Costo: $100 MXN. Si necesitas cambiarla, escribe REAGENDAR.`
    };
  } catch {
    if (hold?.appointment_id && !observedGoogleEventId) {
      await rpc("gabriel_release_appointment", {
        p_appointment_id: hold.appointment_id
      }).catch(() => false);
    }
    return pendingTurn(
      turn,
      "Registré tu solicitud, pero el calendario no pudo confirmarla automáticamente. El horario sigue pendiente y Gabriel lo revisará por WhatsApp; no lo consideres reservado todavía."
    );
  }
}
