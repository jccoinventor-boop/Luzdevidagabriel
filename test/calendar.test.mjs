import crypto from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import {
  autoBookQualifiedTurn,
  calendarConfiguration,
  parseAppointmentWindow
} from "../netlify/functions/lib/calendar.mjs";

function futureAvailability(days = 7) {
  const target = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(target).filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  return parts.day + "/" + parts.month + "/" + parts.year + " 17:00";
}

function qualifiedTurn(availability = futureAvailability()) {
  return {
    state: "qualified_pending_slot",
    qualified: true,
    lead: {
      name: "Ana",
      topic: "Quiero orientación sobre una situación de pareja",
      priceAccepted: true,
      modality: "Videollamada",
      availability,
      finalConfirmation: "SÍ CONFIRMO MI CITA",
      bookingConfirmedIntent: true
    },
    reply: "Pendiente"
  };
}

test("interpreta una fecha de Ciudad de México sin ambigüedad", () => {
  const window = parseAppointmentWindow(
    "22/08/2026 17:00",
    new Date("2026-08-18T12:00:00.000Z")
  );
  assert.equal(window.start.toISOString(), "2026-08-22T23:00:00.000Z");
  assert.equal(window.end.toISOString(), "2026-08-23T00:00:00.000Z");
  assert.equal(parseAppointmentWindow("jueves a las 5 pm"), null);
  assert.equal(parseAppointmentWindow("18/08/2026 05:00", new Date("2026-08-18T12:00:00.000Z")), null);
});

test("mantiene la cita pendiente si Google Calendar no está configurado", async () => {
  const keys = [
    "GOOGLE_CALENDAR_ID",
    "GOOGLE_SERVICE_ACCOUNT_EMAIL",
    "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY"
  ];
  const originals = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  keys.forEach(key => delete process.env[key]);
  try {
    assert.equal(calendarConfiguration().configured, false);
    const turn = qualifiedTurn();
    const result = await autoBookQualifiedTurn({ from: "527122466811", id: "wamid.pending" }, turn);
    assert.equal(result.state, "qualified_pending_slot");
    assert.equal(result.qualified, true);
    assert.equal(result.reply, turn.reply);
  } finally {
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("confirma sólo después de disponibilidad, bloqueo, evento y commit", async () => {
  const originalFetch = globalThis.fetch;
  const envKeys = [
    "GOOGLE_CALENDAR_ID",
    "GOOGLE_SERVICE_ACCOUNT_EMAIL",
    "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY"
  ];
  const originals = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  Object.assign(process.env, {
    GOOGLE_CALENDAR_ID: "gabriel-calendar@example.com",
    GOOGLE_SERVICE_ACCOUNT_EMAIL: "calendar-agent@example.iam.gserviceaccount.com",
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }),
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test-only"
  });

  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const value = String(url);
    calls.push(value);
    if (value === "https://oauth2.googleapis.com/token") {
      return new Response(JSON.stringify({ access_token: "google-token", expires_in: 3600 }), { status: 200 });
    }
    if (value.endsWith("/freeBusy")) {
      return new Response(JSON.stringify({
        calendars: { "gabriel-calendar@example.com": { busy: [] } }
      }), { status: 200 });
    }
    if (value.endsWith("/rpc/gabriel_hold_appointment")) {
      return new Response(JSON.stringify([{
        appointment_id: "123e4567-e89b-42d3-a456-426614174001",
        appointment_status: "hold",
        google_event_id: null,
        result: "held"
      }]), { status: 200 });
    }
    if (value.includes("/events?sendUpdates=none")) {
      const body = JSON.parse(options.body);
      assert.match(body.id, /^[0-9a-v]{5,1024}$/);
      assert.equal(body.summary, "Consulta espiritual · Ana");
      return new Response(JSON.stringify({ id: body.id }), { status: 200 });
    }
    if (value.endsWith("/rpc/gabriel_confirm_appointment")) {
      return new Response("true", { status: 200 });
    }
    throw new Error("unexpected_fetch:" + value);
  };

  try {
    const result = await autoBookQualifiedTurn(
      { from: "527122466811", id: "wamid.confirmed" },
      qualifiedTurn()
    );
    assert.equal(result.state, "confirmed");
    assert.equal(result.qualified, true);
    assert.match(result.reply, /Tu cita quedó confirmada/);
    assert.ok(result.lead.googleEventId);
    assert.equal(calls.filter(value => value.endsWith("/freeBusy")).length, 1);
    assert.equal(calls.filter(value => value.includes("/events?sendUpdates=none")).length, 1);
    assert.equal(calls.filter(value => value.endsWith("/rpc/gabriel_confirm_appointment")).length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
