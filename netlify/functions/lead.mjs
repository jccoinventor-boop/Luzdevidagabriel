const json = (statusCode, body) =>
  new Response(JSON.stringify(body), {
    status: statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });

function sanitize(input) {
  const allowed = ["event", "sessionId", "name", "topic", "priceAccepted", "modality", "availability", "phone", "status", "reason", "source", "at", "attribution"];
  return Object.fromEntries(allowed.filter(key => input[key] !== undefined).map(key => [key, typeof input[key] === "string" ? input[key].slice(0, 500) : input[key]]));
}

export function toDatabaseRecord(body) {
  return {
    event: body.event,
    session_id: body.sessionId,
    name: body.name,
    topic: body.topic,
    price_accepted: body.priceAccepted,
    modality: body.modality,
    availability: body.availability,
    phone: body.phone,
    status: body.status,
    reason: body.reason,
    source: body.source,
    attribution: body.attribution || {},
    at: body.at,
    received_at: new Date().toISOString()
  };
}

export default async (request) => {
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" });
  let body;
  try { body = sanitize(await request.json()); } catch { return json(400, { error: "invalid_json" }); }
  if (!body.event) return json(422, { error: "event_required" });
  const record = toDatabaseRecord(body);

  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/gabriel_lead_events`, {
      method: "POST",
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        "content-type": "application/json",
        prefer: "return=minimal"
      },
      body: JSON.stringify(record)
    });
    if (!response.ok) return json(502, { error: "storage_failed" });
  }

  if (body.event === "qualified_lead" && process.env.LEAD_WEBHOOK_URL) {
    await fetch(process.env.LEAD_WEBHOOK_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, receivedAt: record.received_at }) });
  }
  return json(202, { accepted: true });
};
