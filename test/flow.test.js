import test from "node:test";
import assert from "node:assert/strict";
import lead, { sanitizePublicEvent, toDatabaseRecord } from "../netlify/functions/lead.mjs";

const SESSION_ID = "123e4567-e89b-42d3-a456-426614174000";

test("lead rechaza métodos distintos de POST", async () => {
  const result = await lead(new Request("https://example.test", { method: "GET" }));
  assert.equal(result.status, 405);
});

test("lead exige JSON válido", async () => {
  const result = await lead(new Request("https://example.test", { method: "POST", body: "{" }));
  assert.equal(result.status, 400);
});

test("lead exige un evento", async () => {
  const result = await lead(new Request("https://example.test", { method: "POST", body: JSON.stringify({ name: "Ana" }) }));
  assert.equal(result.status, 422);
});

test("lead acepta un evento medible sin servicios externos", async () => {
  const result = await lead(new Request("https://example.test", { method: "POST", body: JSON.stringify({ event: "page_view", sessionId: SESSION_ID }) }));
  assert.equal(result.status, 202);
});

test("lead rechaza calificaciones enviadas directamente por el navegador", async () => {
  const result = await lead(new Request("https://example.test", {
    method: "POST",
    body: JSON.stringify({ event: "qualified_lead", sessionId: SESSION_ID, status: "qualified_pending_slot" })
  }));
  assert.equal(result.status, 422);
  assert.equal((await result.json()).error, "event_not_allowed");
});

test("lead filtra atribución y elimina campos de negocio", () => {
  const clean = sanitizePublicEvent({
    event: "page_view",
    sessionId: SESSION_ID,
    status: "qualified_pending_slot",
    secret: "no",
    attribution: { utm_source: "tiktok", unexpected: "drop" }
  });
  assert.equal("status" in clean, false);
  assert.equal("secret" in clean, false);
  assert.deepEqual(clean.attribution, { utm_source: "tiktok" });
});

test("convierte campos web al esquema de Supabase", () => {
  const record = toDatabaseRecord({
    event: "page_view",
    sessionId: SESSION_ID,
    attribution: { utm_source: "tiktok" }
  });
  assert.equal(record.session_id, SESSION_ID);
  assert.deepEqual(record.attribution, { utm_source: "tiktok" });
  assert.equal("sessionId" in record, false);
  assert.equal("status" in record, false);
});

test("lead limita el tamaño del cuerpo", async () => {
  const result = await lead(new Request("https://example.test", {
    method: "POST",
    body: JSON.stringify({ event: "page_view", sessionId: SESSION_ID, padding: "x".repeat(17_000) })
  }));
  assert.equal(result.status, 413);
});
