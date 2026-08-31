import { INITIAL_STATE, nextTurn } from "./lib/qualification.mjs";
import {
  RequestInputError,
  clientKey,
  isLocallyRateLimited,
  isUuid,
  normalizeAttribution,
  readJsonBody
} from "./lib/request-security.mjs";

const PRIVACY_NOTICE_VERSION = "2026-08-31";

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  }
});

const initialTurn = () => ({
  state: INITIAL_STATE,
  lead: {},
  qualified: false,
  reply: "Hola, soy el asistente de Gabriel. ¿Cómo te llamas?"
});

export function replayConversation(messages = []) {
  let turn = initialTurn();
  for (const item of messages.slice(-12)) {
    if (item?.role !== "user") continue;
    turn = nextTurn(
      { state: turn.state, lead: turn.lead },
      String(item.content || "").slice(0, 1000)
    );
  }
  return turn;
}

function validateBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new RequestInputError("invalid_payload", 422);
  }
  if (!isUuid(body.sessionId)) throw new RequestInputError("invalid_session", 422);
  if (!body.privacy || body.privacy.accepted !== true || body.privacy.noticeVersion !== PRIVACY_NOTICE_VERSION) {
    throw new RequestInputError("privacy_consent_required", 422);
  }
  if (!Array.isArray(body.messages)) throw new RequestInputError("messages_must_be_an_array", 422);
  if (body.messages.length > 12) throw new RequestInputError("too_many_messages", 422);
  for (const item of body.messages) {
    if (!item || item.role !== "user" || typeof item.content !== "string" || item.content.length > 1000) {
      throw new RequestInputError("invalid_message", 422);
    }
  }
  return {
    sessionId: body.sessionId,
    messages: body.messages,
    phone: typeof body.phone === "string" ? body.phone.replace(/\D/g, "") : "",
    attribution: normalizeAttribution(body.attribution),
    privacyNoticeVersion: PRIVACY_NOTICE_VERSION
  };
}

function supabaseCredentials() {
  const modern = process.env.SUPABASE_SECRET_KEYS;
  if (modern) {
    try {
      const key = JSON.parse(modern).default;
      if (typeof key === "string" && key) return { key, legacy: false };
    } catch {
      // Se usa la clave heredada únicamente durante la transición documentada.
    }
  }
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  return { key, legacy: Boolean(key) };
}

async function supabaseRpc(name, parameters) {
  const { key, legacy } = supabaseCredentials();
  if (!process.env.SUPABASE_URL || !key) return { configured: false, result: "not_configured" };
  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: key,
      ...(legacy ? { authorization: `Bearer ${key}` } : {}),
      "content-type": "application/json"
    },
    body: JSON.stringify(parameters)
  });
  if (!response.ok) throw new Error(`${name}_failed`);
  return { configured: true, result: await response.json() };
}

async function persistPrivacyConsent(request, body) {
  return supabaseRpc("gabriel_record_web_privacy_consent", {
    p_client_key: clientKey(request),
    p_session_id: body.sessionId,
    p_notice_version: body.privacyNoticeVersion
  });
}

async function persistQualifiedLead(request, body, lead) {
  if (!/^\d{10}$/.test(body.phone)) throw new RequestInputError("invalid_phone", 422);
  const { result } = await supabaseRpc("gabriel_record_qualified_web_lead", {
      p_client_key: clientKey(request),
      p_session_id: body.sessionId,
      p_name: lead.name,
      p_topic: lead.topic,
      p_modality: lead.modality,
      p_availability: lead.availability,
      p_phone: body.phone,
      p_attribution: body.attribution
  });

  return result;
}

export default async (request) => {
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" });
  if (isLocallyRateLimited(request, "chat")) return json(429, { error: "rate_limited" });

  let body;
  try {
    body = validateBody(await readJsonBody(request));
  } catch (error) {
    if (error instanceof RequestInputError) return json(error.status, { error: error.code });
    return json(400, { error: "invalid_json" });
  }

  try {
    const consent = await persistPrivacyConsent(request, body);
    if (!consent.configured) return json(503, { error: "storage_not_configured" });
    if (consent.result === "rate_limited") return json(429, { error: "rate_limited" });
    if (consent.result === "invalid") return json(422, { error: "invalid_privacy_consent" });
  } catch {
    return json(502, { error: "storage_failed" });
  }

  const turn = replayConversation(body.messages);
  let storage = "not_needed";
  if (turn.qualified) {
    try {
      storage = await persistQualifiedLead(request, body, turn.lead);
    } catch (error) {
      if (error instanceof RequestInputError) return json(error.status, { error: error.code });
      return json(502, { error: "storage_failed" });
    }
    if (storage === "rate_limited") return json(429, { error: "rate_limited" });
    if (storage === "invalid") return json(422, { error: "invalid_payload" });
  }

  return json(200, {
    message: turn.reply,
    state: turn.state,
    qualified: Boolean(turn.qualified),
    handoff: Boolean(turn.handoff),
    stored: storage === "inserted" || storage === "duplicate"
  });
};
