import crypto from "node:crypto";
import { INITIAL_STATE, isExplicitAcceptance, isRiskMessage, nextTurn } from "./lib/qualification.mjs";
import { autoBookQualifiedTurn, confirmWebBooking } from "./lib/calendar.mjs";
import { RequestInputError, readLimitedBody } from "./lib/request-security.mjs";

const MAX_WEBHOOK_BYTES = 262_144;
const MAX_MESSAGES_PER_WEBHOOK = 20;
const MAX_COMMIT_ATTEMPTS = 3;
const WEB_BOOKING_CODE_PATTERN = /\bc[oó]digo:\s*([0-9a-f]{8})\b/i;
const PRIVACY_NOTICE_VERSION = "2026-08-31";
const PRIVACY_NOTICE_URL = "https://luzdevidagabriel.netlify.app/aviso-de-privacidad.html";
const PRIVACY_DECLINE_PATTERN = /^(no|no acepto|no estoy de acuerdo)([,!. ]|$)/i;

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});

function validSignature(raw, signature) {
  const secret = process.env.META_APP_SECRET;
  if (!secret || !signature?.startsWith("sha256=")) return false;
  const expected = `sha256=${crypto.createHmac("sha256", secret).update(raw).digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function incomingMessages(payload) {
  const results = [];
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      for (const message of change.value?.messages || []) {
        const rawText = message.text?.body || message.button?.text || message.interactive?.button_reply?.title || message.interactive?.list_reply?.title;
        const text = typeof rawText === "string" ? rawText.trim().slice(0, 1000) : "";
        if (message.from && message.id && text) {
          results.push({ from: String(message.from).slice(0, 15), id: String(message.id).slice(0, 250), text });
        }
      }
    }
  }
  return results;
}

async function supabase(path, options = {}) {
  const url = process.env.SUPABASE_URL;
  let key = "";
  let legacy = false;
  if (process.env.SUPABASE_SECRET_KEYS) {
    try {
      key = JSON.parse(process.env.SUPABASE_SECRET_KEYS).default || "";
    } catch {
      // Se usa la clave heredada únicamente durante la transición.
    }
  }
  if (!key) {
    key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    legacy = Boolean(key);
  }
  if (!url || !key) throw new Error("supabase_not_configured");
  return fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: key,
      ...(legacy ? { authorization: `Bearer ${key}` } : {}),
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
}

async function rpc(name, parameters) {
  const response = await supabase(`rpc/${name}`, {
    method: "POST",
    body: JSON.stringify(parameters)
  });
  if (!response.ok) throw new Error(`${name}_failed`);
  return response.json();
}

export async function loadSession(phone) {
  const response = await supabase(`gabriel_whatsapp_sessions?phone=eq.${encodeURIComponent(phone)}&select=state,lead,last_message_id,version&limit=1`);
  if (!response.ok) throw new Error("session_read_failed");
  const rows = await response.json();
  return rows[0] || { version: 0 };
}

export function extractWebBookingCode(text) {
  return String(text || "").match(WEB_BOOKING_CODE_PATTERN)?.[1]?.toUpperCase() || null;
}

function hasCurrentPrivacyConsent(lead = {}) {
  return lead.privacyNoticeVersion === PRIVACY_NOTICE_VERSION
    && (Boolean(lead.privacyConsentAt) || lead.privacyConsentSource === "web_recorded");
}

export function whatsappPrivacyTurn(session = {}, rawText = "", now = new Date()) {
  const lead = { ...(session.lead || {}) };
  if (hasCurrentPrivacyConsent(lead) || isRiskMessage(rawText)) return null;

  const state = session.state || INITIAL_STATE;
  const noticeWasShown = lead.privacyNoticeShown === true
    && lead.privacyNoticeVersion === PRIVACY_NOTICE_VERSION;

  if (!noticeWasShown) {
    return {
      state,
      lead: {
        ...lead,
        privacyNoticeShown: true,
        privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
        privacyNoticeShownAt: now.toISOString()
      },
      qualified: false,
      reply: `Antes de pedirte nombre, motivo u horario, lee el aviso de privacidad: ${PRIVACY_NOTICE_URL}\n\nSi autorizas el uso de esos datos para atender y preparar tu cita, responde “Sí, acepto”. Si no, responde “No acepto”.`
    };
  }

  if (isExplicitAcceptance(rawText)) {
    return {
      state,
      lead: {
        ...lead,
        privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
        privacyConsentAt: now.toISOString(),
        privacyConsentSource: "whatsapp_explicit"
      },
      qualified: false,
      reply: state === INITIAL_STATE
        ? "Gracias. Registré tu autorización. ¿Cómo te llamas?"
        : "Gracias. Registré tu autorización. Ya podemos continuar; responde nuevamente la pregunta pendiente."
    };
  }

  if (PRIVACY_DECLINE_PATTERN.test(String(rawText || "").trim())) {
    return {
      state,
      lead,
      qualified: false,
      reply: "De acuerdo. No solicitaré más datos ni prepararé una cita por este asistente. Si cambias de opinión, revisa el aviso y responde “Sí, acepto”."
    };
  }

  return {
    state,
    lead,
    qualified: false,
    reply: `Para continuar necesito una respuesta clara después de leer ${PRIVACY_NOTICE_URL}: “Sí, acepto” o “No acepto”.`
  };
}

async function loadWebBooking(message) {
  const code = extractWebBookingCode(message.text);
  if (!code) return { code: null, booking: null };
  const rows = await rpc("gabriel_get_web_booking_for_whatsapp", {
    p_customer_phone: message.from,
    p_booking_code: code
  });
  return { code, booking: Array.isArray(rows) ? rows[0] || null : null };
}

async function claimMessage(message) {
  return rpc("gabriel_claim_whatsapp_message", {
    p_message_id: message.id,
    p_phone: message.from,
    p_message_text: message.text
  });
}

async function commitTurn(message, session, turn) {
  return rpc("gabriel_commit_whatsapp_turn", {
    p_message_id: message.id,
    p_phone: message.from,
    p_expected_version: Number(session.version || 0),
    p_state: turn.state,
    p_lead: turn.lead,
    p_qualified: Boolean(turn.qualified),
    p_handoff: Boolean(turn.handoff),
    p_reply: turn.reply,
    p_event: turn.handoff ? "human_handoff" : turn.qualified ? "qualified_lead" : "whatsapp_turn"
  });
}

async function markInboxFailed(messageId, error) {
  return rpc("gabriel_mark_whatsapp_inbox_failed", {
    p_message_id: messageId,
    p_error: String(error?.message || error || "processing_failed").slice(0, 500)
  }).catch(() => false);
}

async function sendText(to, body) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const version = process.env.META_GRAPH_API_VERSION;
  if (!phoneNumberId || !token || !version) throw new Error("whatsapp_not_configured");
  const response = await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { preview_url: false, body: body.slice(0, 4096) } })
  });
  if (!response.ok) throw new Error("whatsapp_send_failed");
}

async function deliverOutbox(messageId) {
  const rows = await rpc("gabriel_claim_whatsapp_outbox", { p_message_id: messageId });
  const item = Array.isArray(rows) ? rows[0] : null;
  if (!item) return false;

  try {
    await sendText(item.phone, item.body);
    await rpc("gabriel_mark_whatsapp_outbox_sent", { p_message_id: messageId });
    return true;
  } catch (error) {
    await rpc("gabriel_mark_whatsapp_outbox_failed", {
      p_message_id: messageId,
      p_error: String(error?.message || error || "send_failed").slice(0, 500)
    }).catch(() => false);
    throw error;
  }
}

export async function processMessage(message) {
  const claimStatus = await claimMessage(message);
  if (claimStatus === "complete" || claimStatus === "rate_limited") {
    return { duplicate: claimStatus === "complete", rateLimited: claimStatus === "rate_limited" };
  }
  if (claimStatus === "outbox_ready") {
    await deliverOutbox(message.id);
    return { delivered: true };
  }
  if (claimStatus !== "claimed") throw new Error(`message_${claimStatus}`);

  try {
    for (let attempt = 0; attempt < MAX_COMMIT_ATTEMPTS; attempt += 1) {
      const session = await loadSession(message.from);
      const web = await loadWebBooking(message);
      const turn = web.booking
        ? await confirmWebBooking(message, web.booking)
        : web.code
          ? {
              state: session.state || "awaiting_name",
              lead: session.lead || {},
              qualified: false,
              reply: "No encontré un apartado vigente con ese código y este número. Regresa al sitio para elegir otro horario o escribe AGENDAR para comenzar nuevamente."
            }
          : whatsappPrivacyTurn(session, message.text)
            || await autoBookQualifiedTurn(message, nextTurn(session, message.text));
      if (await commitTurn(message, session, turn)) {
        await deliverOutbox(message.id);
        return { processed: true };
      }
    }
    throw new Error("session_conflict");
  } catch (error) {
    await markInboxFailed(message.id, error);
    throw error;
  }
}

export { incomingMessages, validSignature };

export default async (request) => {
  if (request.method === "GET") {
    const url = new URL(request.url);
    const valid = url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === process.env.WHATSAPP_VERIFY_TOKEN;
    return valid ? new Response(url.searchParams.get("hub.challenge") || "", { status: 200 }) : json(403, { error: "verification_failed" });
  }
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" });

  const signature = request.headers.get("x-hub-signature-256");
  if (!/^sha256=[0-9a-f]{64}$/i.test(signature || "")) return json(401, { error: "invalid_signature" });

  let raw;
  try {
    raw = await readLimitedBody(request, MAX_WEBHOOK_BYTES);
  } catch (error) {
    if (error instanceof RequestInputError) return json(error.status, { error: error.code });
    return json(400, { error: "invalid_body" });
  }
  if (!validSignature(raw, signature)) return json(401, { error: "invalid_signature" });

  let payload;
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    return json(400, { error: "invalid_json" });
  }

  let failed = false;
  for (const message of incomingMessages(payload).slice(0, MAX_MESSAGES_PER_WEBHOOK)) {
    try {
      await processMessage(message);
    } catch {
      failed = true;
    }
  }

  return failed ? json(500, { error: "processing_failed" }) : json(200, { received: true });
};
