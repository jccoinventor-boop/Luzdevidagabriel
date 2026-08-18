import { INITIAL_STATE, nextTurn } from "./lib/qualification.mjs";
import {
  RequestInputError,
  clientKey,
  isLocallyRateLimited,
  isUuid,
  normalizeAttribution,
  readJsonBody
} from "./lib/request-security.mjs";

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
    attribution: normalizeAttribution(body.attribution)
  };
}

async function persistQualifiedLead(request, body, lead) {
  if (!/^\d{10}$/.test(body.phone)) throw new RequestInputError("invalid_phone", 422);
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return "not_configured";

  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/gabriel_record_qualified_web_lead`, {
    method: "POST",
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      p_client_key: clientKey(request),
      p_session_id: body.sessionId,
      p_name: lead.name,
      p_topic: lead.topic,
      p_modality: lead.modality,
      p_availability: lead.availability,
      p_phone: body.phone,
      p_attribution: body.attribution
    })
  });
  if (!response.ok) throw new Error("storage_failed");
  const result = await response.json();

  if (result === "inserted" && process.env.LEAD_WEBHOOK_URL) {
    await fetch(process.env.LEAD_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        event: "qualified_lead",
        sessionId: body.sessionId,
        name: lead.name,
        topic: lead.topic,
        priceAccepted: true,
        modality: lead.modality,
        availability: lead.availability,
        phone: body.phone,
        status: "qualified_pending_slot",
        source: "web",
        attribution: body.attribution,
        finalConfirmation: "SÍ CONFIRMO MI CITA",
        bookingConfirmedIntent: true,
        receivedAt: new Date().toISOString()
      })
    }).catch(() => null);
  }
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
