import test from "node:test";
import assert from "node:assert/strict";
import { nextTurn, isExplicitAcceptance, isFinalBookingConfirmation, isRiskMessage } from "../netlify/functions/lib/qualification.mjs";
import { extractWebBookingCode, incomingMessages, loadSession, processMessage, whatsappPrivacyTurn } from "../netlify/functions/whatsapp.mjs";

const FUTURE_AVAILABILITY = (() => {
  const target = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(target).filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  return parts.day + "/" + parts.month + "/" + parts.year + " 17:00";
})();

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

test("después del horario exige confirmación final", () => {
  const turn = nextTurn({
    state: "awaiting_availability",
    lead: { name: "Ana", topic: "Una situación personal importante", priceAccepted: true, modality: "Videollamada" }
  }, FUTURE_AVAILABILITY);
  assert.equal(turn.qualified, false);
  assert.equal(turn.state, "awaiting_final_confirmation");
});

test("sólo califica con confirmación final explícita", () => {
  assert.equal(isFinalBookingConfirmation("SÍ CONFIRMO MI CITA"), true);
  assert.equal(isFinalBookingConfirmation("tal vez"), false);
  const turn = nextTurn({
    state: "awaiting_final_confirmation",
    lead: { name: "Ana", topic: "Una situación personal importante", priceAccepted: true, modality: "Videollamada", availability: FUTURE_AVAILABILITY }
  }, "SÍ CONFIRMO MI CITA");
  assert.equal(turn.qualified, true);
  assert.equal(turn.state, "qualified_pending_slot");
  assert.equal(turn.lead.bookingConfirmedIntent, true);
});

test("deriva mensajes de riesgo a atención humana", () => {
  assert.equal(isRiskMessage("Estoy pensando en hacerme daño"), true);
  assert.equal(isRiskMessage("Estoy pensando en suicidarme"), true);
  assert.equal(isRiskMessage("Quiero quitarme la vida"), true);
  assert.equal(isRiskMessage("Ya no quiero vivir"), true);
  assert.equal(isRiskMessage("Quiero morir"), true);
  const turn = nextTurn({ state: "awaiting_topic", lead: { name: "Ana" } }, "Alguien me amenaza con un arma");
  assert.equal(turn.handoff, true);
  assert.equal(turn.qualified, false);
});

test("una solicitud de reagendar una cita confirmada requiere revisión humana", () => {
  const turn = nextTurn({
    state: "confirmed",
    lead: { name: "Ana", googleEventId: "gabriel123" }
  }, "Quiero reagendar");
  assert.equal(turn.state, "human_handoff");
  assert.equal(turn.handoff, true);
  assert.equal(turn.qualified, true);
});

test("una cita confirmada conserva su calificación en mensajes posteriores", () => {
  const turn = nextTurn({
    state: "confirmed",
    lead: { name: "Ana", bookingConfirmedIntent: true }
  }, "Gracias");

  assert.equal(turn.state, "confirmed");
  assert.equal(turn.qualified, true);
  assert.equal(turn.handoff, undefined);
});

test("extrae mensajes de texto del webhook de Meta", () => {
  const payload = { entry: [{ changes: [{ value: { messages: [{ from: "521234567890", id: "wamid.1", text: { body: "Hola" } }] } }] }] };
  assert.deepEqual(incomingMessages(payload), [{ from: "521234567890", id: "wamid.1", text: "Hola" }]);
});

test("WhatsApp informa y obtiene consentimiento antes de interpretar el nombre", () => {
  const shownAt = new Date("2026-08-31T12:00:00.000Z");
  const notice = whatsappPrivacyTurn(
    { state: "awaiting_name", lead: {}, version: 0 },
    "Hola Gabriel, quiero una consulta",
    shownAt
  );
  assert.equal(notice.state, "awaiting_name");
  assert.equal(notice.lead.name, undefined);
  assert.equal(notice.lead.privacyNoticeShownAt, shownAt.toISOString());
  assert.match(notice.reply, /aviso de privacidad/);

  const acceptedAt = new Date("2026-08-31T12:01:00.000Z");
  const accepted = whatsappPrivacyTurn(
    { state: notice.state, lead: notice.lead, version: 1 },
    "Sí, acepto",
    acceptedAt
  );
  assert.equal(accepted.lead.privacyConsentAt, acceptedAt.toISOString());
  assert.equal(accepted.lead.privacyConsentSource, "whatsapp_explicit");
  assert.match(accepted.reply, /¿Cómo te llamas\?/);
  assert.equal(whatsappPrivacyTurn({ state: accepted.state, lead: accepted.lead }, "Ana"), null);
});

test("WhatsApp prioriza una emergencia aunque falte consentimiento", () => {
  assert.equal(whatsappPrivacyTurn({ state: "awaiting_name", lead: {} }, "Quiero quitarme la vida"), null);
});

test("extrae el código de una reserva web sin aceptar formatos ambiguos", () => {
  assert.equal(extractWebBookingCode("Código: A1B2C3D4. Entiendo que Gabriel debe confirmar."), "A1B2C3D4");
  assert.equal(extractWebBookingCode("codigo: 1234abcd"), "1234ABCD");
  assert.equal(extractWebBookingCode("código: 1234"), null);
  assert.equal(extractWebBookingCode("sin código"), null);
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
    return new Response(JSON.stringify([{ state: "awaiting_topic", lead: {}, last_message_id: "wamid.1", version: 2 }]), { status: 200 });
  };
  try {
    const session = await loadSession("521234567890");
    assert.equal(session.last_message_id, "wamid.1");
    assert.equal(session.version, 2);
    assert.match(requestedUrl, /select=state,lead,last_message_id,version/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  }
});

test("procesa WhatsApp con inbox, versión y outbox durable", async () => {
  const originalFetch = globalThis.fetch;
  const originals = Object.fromEntries([
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "WHATSAPP_PHONE_NUMBER_ID",
    "WHATSAPP_ACCESS_TOKEN",
    "META_GRAPH_API_VERSION"
  ].map(key => [key, process.env[key]]));
  Object.assign(process.env, {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test-only",
    WHATSAPP_PHONE_NUMBER_ID: "12345",
    WHATSAPP_ACCESS_TOKEN: "token",
    META_GRAPH_API_VERSION: "v23.0"
  });
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const value = String(url);
    calls.push(value);
    if (value.endsWith("rpc/gabriel_claim_whatsapp_message")) return new Response(JSON.stringify("claimed"), { status: 200 });
    if (value.includes("gabriel_whatsapp_sessions?")) {
      return new Response(JSON.stringify([{
        state: "awaiting_name",
        lead: {
          privacyNoticeVersion: "2026-08-31",
          privacyConsentAt: "2026-08-31T12:00:00.000Z",
          privacyConsentSource: "whatsapp_explicit"
        },
        version: 0
      }]), { status: 200 });
    }
    if (value.endsWith("rpc/gabriel_commit_whatsapp_turn")) {
      const body = JSON.parse(options.body);
      assert.equal(body.p_expected_version, 0);
      assert.equal(body.p_state, "awaiting_topic");
      return new Response("true", { status: 200 });
    }
    if (value.endsWith("rpc/gabriel_claim_whatsapp_outbox")) {
      return new Response(JSON.stringify([{ phone: "521234567890", body: "Gracias, Ana." }]), { status: 200 });
    }
    if (value.includes("graph.facebook.com")) return new Response("{}", { status: 200 });
    if (value.endsWith("rpc/gabriel_mark_whatsapp_outbox_sent")) return new Response("true", { status: 200 });
    throw new Error(`unexpected_fetch:${value}`);
  };

  try {
    const result = await processMessage({ from: "521234567890", id: "wamid.2", text: "Ana" });
    assert.deepEqual(result, { processed: true });
    assert.equal(calls.filter(value => value.includes("graph.facebook.com")).length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("no confirma a Meta un mensaje que sigue en procesamiento", async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
  globalThis.fetch = async (url) => {
    assert.match(String(url), /rpc\/gabriel_claim_whatsapp_message$/);
    return new Response(JSON.stringify("busy"), { status: 200 });
  };

  try {
    await assert.rejects(
      processMessage({ from: "521234567890", id: "wamid.busy", text: "Ana" }),
      /message_busy/
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  }
});
