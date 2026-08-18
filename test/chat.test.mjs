import test from "node:test";
import assert from "node:assert/strict";
import handler, { replayConversation } from "../netlify/functions/chat.mjs";

const SESSION_ID = "123e4567-e89b-42d3-a456-426614174000";

test("chat califica sin OpenAI sólo después de confirmación final", () => {
  const messages = [
    "Ana",
    "Quiero orientación sobre una situación de pareja",
    "Sí, acepto",
    "Videollamada",
    "jueves a las 5 pm",
    "SÍ CONFIRMO MI CITA"
  ].map(content => ({ role: "user", content }));

  const turn = replayConversation(messages);
  assert.equal(turn.state, "qualified_pending_slot");
  assert.equal(turn.qualified, true);
});

test("chat no califica antes de confirmación final", () => {
  const messages = [
    "Ana",
    "Quiero orientación sobre una situación de pareja",
    "Sí, acepto",
    "Videollamada",
    "jueves a las 5 pm"
  ].map(content => ({ role: "user", content }));

  const turn = replayConversation(messages);
  assert.equal(turn.state, "awaiting_final_confirmation");
  assert.equal(turn.qualified, false);
});

test("chat deriva un mensaje de riesgo a atención humana", async () => {
  const request = new Request("https://example.test/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId: SESSION_ID,
      messages: [{ role: "user", content: "Estoy pensando en hacerme daño" }]
    })
  });

  const response = await handler(request);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.handoff, true);
  assert.equal(body.state, "human_handoff");
  assert.equal(body.qualified, false);
});

test("chat registra la calificación sólo después de reproducir todo el flujo", async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let rpcBody;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
  globalThis.fetch = async (url, options) => {
    assert.match(String(url), /gabriel_record_qualified_web_lead$/);
    rpcBody = JSON.parse(options.body);
    return new Response(JSON.stringify("inserted"), { status: 200 });
  };

  const messages = [
    "Ana",
    "Quiero orientación sobre una situación de pareja",
    "Sí, acepto",
    "Videollamada",
    "jueves a las 5 pm",
    "SÍ CONFIRMO MI CITA"
  ].map(content => ({ role: "user", content }));

  try {
    const response = await handler(new Request("https://example.test/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", "x-nf-client-connection-ip": "203.0.113.10" },
      body: JSON.stringify({ sessionId: SESSION_ID, messages, phone: "7122466811", attribution: { utm_source: "tiktok" } })
    }));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.qualified, true);
    assert.equal(body.stored, true);
    assert.equal(rpcBody.p_session_id, SESSION_ID);
    assert.equal(rpcBody.p_phone, "7122466811");
    assert.equal(rpcBody.p_name, "Ana");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  }
});
