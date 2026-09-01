import {
  RequestInputError,
  clientKey,
  isLocallyRateLimited,
  isUuid,
  normalizeAttribution,
  readJsonBody
} from "./lib/request-security.mjs";

const PUBLIC_EVENTS = new Set([
  "page_view",
  "chat_started",
  "whatsapp_click",
  "qualified_whatsapp_click",
  "lead_not_qualified"
]);
const REASONS = new Set(["price_not_accepted", "final_confirmation_missing"]);

const json = (statusCode, body) =>
  new Response(JSON.stringify(body), {
    status: statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });

export function sanitizePublicEvent(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new RequestInputError("invalid_payload", 422);
  }
  if (!PUBLIC_EVENTS.has(input.event)) {
    throw new RequestInputError("event_not_allowed", 422);
  }
  if (!isUuid(input.sessionId)) {
    throw new RequestInputError("invalid_session", 422);
  }

  const source = typeof input.source === "string" ? input.source.trim().slice(0, 80) : "";
  const reason = REASONS.has(input.reason) ? input.reason : "";
  return {
    event: input.event,
    sessionId: input.sessionId,
    reason: reason || null,
    source: source || null,
    attribution: normalizeAttribution(input.attribution)
  };
}

export function toDatabaseRecord(body) {
  return {
    event: body.event,
    session_id: body.sessionId,
    reason: body.reason || null,
    source: body.source || null,
    attribution: body.attribution || {}
  };
}

async function recordEvent(request, body) {
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
  if (!process.env.SUPABASE_URL || !key) return "accepted";

  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/gabriel_record_public_event`, {
    method: "POST",
    headers: {
      apikey: key,
      ...(legacy ? { authorization: `Bearer ${key}` } : {}),
      "content-type": "application/json"
    },
    body: JSON.stringify({
      p_client_key: clientKey(request),
      p_event: body.event,
      p_session_id: body.sessionId,
      p_reason: body.reason,
      p_source: body.source,
      p_attribution: body.attribution
    })
  });
  if (!response.ok) throw new Error("storage_failed");
  return response.json();
}

export default async (request) => {
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" });
  if (isLocallyRateLimited(request, "public-event")) return json(429, { error: "rate_limited" });

  let body;
  try {
    body = sanitizePublicEvent(await readJsonBody(request));
  } catch (error) {
    if (error instanceof RequestInputError) return json(error.status, { error: error.code });
    return json(400, { error: "invalid_json" });
  }

  try {
    const result = await recordEvent(request, body);
    if (result === "rate_limited") return json(429, { error: "rate_limited" });
    if (result === "invalid") return json(422, { error: "invalid_payload" });
  } catch {
    return json(502, { error: "storage_failed" });
  }

  return json(202, { accepted: true });
};
