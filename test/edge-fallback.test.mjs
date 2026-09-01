import test from "node:test";
import assert from "node:assert/strict";
import { createHandler, replayConversation } from "../supabase/functions/gabriel-public-api/handler.mjs";

const ORIGIN = "https://deploy-preview-6--luzdevidagabriel.netlify.app";
const SESSION_ID = "123e4567-e89b-42d3-a456-426614174099";
const PRIVACY = { accepted: true, noticeVersion: "2026-08-31" };
const FUTURE_AVAILABILITY = (() => {
  const target = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(target).filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  return `${parts.day}/${parts.month}/${parts.year} 17:00`;
})();

const messages = [
  "Prueba Codex",
  "Prueba técnica del recorrido sin cliente real",
  "Sí, acepto",
  "Teléfono",
  FUTURE_AVAILABILITY,
  "SÍ CONFIRMO MI CITA"
].map(content => ({ role: "user", content }));

test("la función Edge conserva el mismo criterio de calificación", () => {
  const turn = replayConversation(messages);
  assert.equal(turn.qualified, true);
  assert.equal(turn.state, "qualified_pending_slot");
});

test("la función Edge rechaza orígenes ajenos", async () => {
  const handler = createHandler({ getEnv: () => "test" });
  const response = await handler(new Request("https://example.supabase.co/functions/v1/gabriel-public-api", {
    method: "POST",
    headers: { origin: "https://evil.example", "content-type": "application/json" },
    body: JSON.stringify({ action: "lead" })
  }));
  assert.equal(response.status, 403);
});

test("la función Edge guarda un lead con la clave secreta sólo en apikey", async () => {
  const rpcRequests = [];
  const env = {
    DENO_DEPLOYMENT_ID: "kxlrtuqjclsvgchawzfe_00000000-0000-0000-0000-000000000000_2",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SECRET_KEYS: JSON.stringify({ default: "sb_secret_test_only" }),
    SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: "sb_publishable_test_only" })
  };
  const handler = createHandler({
    getEnv: key => env[key],
    fetchFn: async (url, options) => {
      const rpcRequest = { url: String(url), options };
      rpcRequests.push(rpcRequest);
      if (rpcRequest.url.endsWith("gabriel_book_web_appointment")) {
        return new Response(JSON.stringify([{
          appointment_id: "223e4567-e89b-42d3-a456-426614174099",
          appointment_status: "hold",
          starts_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          ends_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000).toISOString(),
          result: "inserted"
        }]), { status: 200 });
      }
      return new Response(JSON.stringify("inserted"), { status: 200 });
    }
  });
  const response = await handler(new Request("https://example.supabase.co/functions/v1/gabriel-public-api", {
    method: "POST",
    headers: { origin: ORIGIN, apikey: "sb_publishable_test_only", "content-type": "application/json", "x-forwarded-for": "203.0.113.91" },
    body: JSON.stringify({ action: "chat", sessionId: SESSION_ID, messages, phone: "0000000000", attribution: { utm_source: "codex_synthetic_test" }, privacy: PRIVACY })
  }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.qualified, true);
  assert.equal(body.stored, true);
  assert.deepEqual(rpcRequests.map(item => new URL(item.url).pathname.split("/").pop()), [
    "gabriel_record_web_privacy_consent",
    "gabriel_record_qualified_web_lead",
    "gabriel_book_web_appointment"
  ]);
  assert.ok(rpcRequests.every(item => item.options.headers.apikey === "sb_secret_test_only"));
  assert.ok(rpcRequests.every(item => item.options.headers.authorization === undefined));
  assert.equal(response.headers.get("access-control-allow-origin"), ORIGIN);
  assert.equal(response.headers.get("x-gabriel-edge-version"), "2");
  assert.match(response.headers.get("access-control-expose-headers"), /x-gabriel-edge-version/);
});

test("la función Edge registra consentimiento antes de pedir datos personales", async () => {
  let rpcRequest;
  const env = {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SECRET_KEYS: JSON.stringify({ default: "sb_secret_test_only" }),
    SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: "sb_publishable_test_only" })
  };
  const handler = createHandler({
    getEnv: key => env[key],
    fetchFn: async (url, options) => {
      rpcRequest = { url: String(url), body: JSON.parse(options.body) };
      return new Response(JSON.stringify("inserted"), { status: 200 });
    }
  });
  const response = await handler(new Request("https://example.supabase.co/functions/v1/gabriel-public-api", {
    method: "POST",
    headers: { origin: ORIGIN, apikey: "sb_publishable_test_only", "content-type": "application/json" },
    body: JSON.stringify({ action: "consent", sessionId: SESSION_ID, privacy: PRIVACY })
  }));
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { accepted: true, noticeVersion: "2026-08-31" });
  assert.match(rpcRequest.url, /gabriel_record_web_privacy_consent$/);
  assert.equal(rpcRequest.body.p_notice_version, "2026-08-31");
});

test("la función Edge rechaza chat sin consentimiento", async () => {
  const env = {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SECRET_KEYS: JSON.stringify({ default: "sb_secret_test_only" }),
    SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: "sb_publishable_test_only" })
  };
  const handler = createHandler({ getEnv: key => env[key] });
  const response = await handler(new Request("https://example.supabase.co/functions/v1/gabriel-public-api", {
    method: "POST",
    headers: { origin: ORIGIN, apikey: "sb_publishable_test_only", "content-type": "application/json" },
    body: JSON.stringify({ action: "chat", sessionId: SESSION_ID, messages, phone: "0000000000" })
  }));
  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), { error: "privacy_consent_required" });
});

test("la función Edge limita cuerpos antes de analizarlos", async () => {
  const env = { SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: "sb_publishable_test_only" }) };
  const handler = createHandler({ getEnv: key => env[key] });
  const response = await handler(new Request("https://example.supabase.co/functions/v1/gabriel-public-api", {
    method: "POST",
    headers: { origin: ORIGIN, apikey: "sb_publishable_test_only", "content-type": "application/json", "content-length": "20000" },
    body: "{}"
  }));
  assert.equal(response.status, 413);
});

test("la función Edge exige una clave publicable del mismo proyecto", async () => {
  const env = { SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: "sb_publishable_test_only" }) };
  const handler = createHandler({ getEnv: key => env[key] });
  const response = await handler(new Request("https://example.supabase.co/functions/v1/gabriel-public-api", {
    method: "POST",
    headers: { origin: ORIGIN, apikey: "sb_publishable_other", "content-type": "application/json" },
    body: JSON.stringify({ action: "lead" })
  }));
  assert.equal(response.status, 401);
});
