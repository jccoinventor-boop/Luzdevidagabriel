import test from "node:test";
import assert from "node:assert/strict";
import { nextTurn, isExplicitAcceptance, isRiskMessage } from "../netlify/functions/lib/qualification.mjs";
import { incomingMessages, loadSession } from "../netlify/functions/whatsapp.mjs";

test("exige aceptación explícita del precio", () => {
  assert.equal(isExplicitAcceptance("Sí, acepto"), true);
  assert.equal(isExplicitAcceptance("tal vez"), false);
  assert.equal(isExplicitAcceptance("No acepto"), false);
});

test("no califica sólo por aceptar el precio", () => {
  const turn = nextTurn({ state: "awaiting_price", lead: { name: "Ana", topic: "Una situación personal importante" } }, "Sí, acepto");
  assert.equal(turn.qualified, false);
  assert.equal(turn.state, "awaiting_modality");
});

test("califica después de completar todos los campos", () => {
  const turn = nextTurn({
    state: "awaiting_availability",
    lead: { name: "Ana", topic: "Una situación personal importante", priceAccepted: true, modality: "Videollamada" }
  }, "jueves a las 5 pm");
  assert.equal(turn.qualified, true);
  assert.equal(turn.state, "qualified_pending_slot");
});

test("deriva mensajes de riesgo a atención humana", () => {
  assert.equal(isRiskMessage("Estoy pensando en hacerme daño"), true);
  const turn = nextTurn({ state: "awaiting_topic", lead: { name: "Ana" } }, "Alguien me amenaza con un arma");
  assert.equal(turn.handoff, true);
  assert.equal(turn.qualified, false);
});

test("extrae mensajes de texto del webhook de Meta", () => {
  const payload = { entry: [{ changes: [{ value: { messages: [{ from: "521234567890", id: "wamid.1", text: { body: "Hola" } }] } }] }] };
  assert.deepEqual(incomingMessages(payload), [{ from: "521234567890", id: "wamid.1", text: "Hola" }]);
});


test("recupera el último identificador para ignorar reintentos de Meta", async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let requestedUrl = "";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return new Response(JSON.stringify([{ state: "awaiting_topic", lead: {}, last_message_id: "wamid.1" }]), { status: 200 });
  };
  try {
    const session = await loadSession("521234567890");
    assert.equal(session.last_message_id, "wamid.1");
    assert.match(requestedUrl, /select=state,lead,last_message_id/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  }
});
