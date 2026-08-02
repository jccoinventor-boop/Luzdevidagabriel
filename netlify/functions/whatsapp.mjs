import crypto from "node:crypto";
import { nextTurn } from "./lib/qualification.mjs";

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
        const text = message.text?.body || message.button?.text || message.interactive?.button_reply?.title || message.interactive?.list_reply?.title;
        if (message.from && message.id && text) results.push({ from: message.from, id: message.id, text });
      }
    }
  }
  return results;
}

async function supabase(path, options = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("supabase_not_configured");
  return fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json", ...(options.headers || {}) }
  });
}

export async function loadSession(phone) {
  const response = await supabase(`gabriel_whatsapp_sessions?phone=eq.${encodeURIComponent(phone)}&select=state,lead,last_message_id&limit=1`);
  if (!response.ok) throw new Error("session_read_failed");
  const rows = await response.json();
  return rows[0] || {};
}

async function saveSession(phone, turn, messageId) {
  const response = await supabase("gabriel_whatsapp_sessions?on_conflict=phone", {
    method: "POST",
    headers: { prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ phone, state: turn.state, lead: turn.lead, last_message_id: messageId, qualified: turn.qualified, handoff: Boolean(turn.handoff), updated_at: new Date().toISOString() })
  });
  if (!response.ok) throw new Error("session_write_failed");
}

async function registerEvent(phone, messageId, turn) {
  const response = await supabase("gabriel_lead_events?on_conflict=provider_message_id", {
    method: "POST",
    headers: { prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify({
      event: turn.handoff ? "human_handoff" : turn.qualified ? "qualified_lead" : "whatsapp_turn",
      session_id: phone,
      provider_message_id: messageId,
      name: turn.lead.name,
      topic: turn.lead.topic,
      price_accepted: turn.lead.priceAccepted === true ? "Sí, acepto" : null,
      modality: turn.lead.modality,
      availability: turn.lead.availability,
      phone,
      status: turn.state,
      source: "whatsapp",
      received_at: new Date().toISOString()
    })
  });
  if (!response.ok) throw new Error("event_write_failed");
}

async function sendText(to, body) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const version = process.env.META_GRAPH_API_VERSION;
  if (!phoneNumberId || !token || !version) throw new Error("whatsapp_not_configured");
  const response = await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { preview_url: false, body } })
  });
  if (!response.ok) throw new Error("whatsapp_send_failed");
}

export { incomingMessages, validSignature };

export default async (request) => {
  if (request.method === "GET") {
    const url = new URL(request.url);
    const valid = url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === process.env.WHATSAPP_VERIFY_TOKEN;
    return valid ? new Response(url.searchParams.get("hub.challenge") || "", { status: 200 }) : json(403, { error: "verification_failed" });
  }
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" });

  const raw = await request.text();
  if (!validSignature(raw, request.headers.get("x-hub-signature-256"))) return json(401, { error: "invalid_signature" });
  let payload;
  try { payload = JSON.parse(raw); } catch { return json(400, { error: "invalid_json" }); }

  for (const message of incomingMessages(payload)) {
    const session = await loadSession(message.from);
    if (session.last_message_id === message.id) continue;
    const turn = nextTurn(session, message.text);
    await saveSession(message.from, turn, message.id);
    await registerEvent(message.from, message.id, turn);
    await sendText(message.from, turn.reply);
  }
  return json(200, { received: true });
};
