import test from "node:test";
import assert from "node:assert/strict";
import handler, { replayConversation } from "../netlify/functions/chat.mjs";

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
