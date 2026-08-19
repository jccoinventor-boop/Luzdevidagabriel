import test from "node:test";
import assert from "node:assert/strict";
import { BaseExternalAccountClient } from "google-auth-library";
import {
  autoBookQualifiedTurn,
  calendarConfiguration,
  externalAccountConfiguration,
  parseAppointmentWindow
} from "../netlify/functions/lib/calendar.mjs";

const CALENDAR_ENV_KEYS = [
  "VERCEL",
  "GOOGLE_CALENDAR_ID",
  "GCP_PROJECT_ID",
  "GCP_PROJECT_NUMBER",
  "GCP_SERVICE_ACCOUNT_EMAIL",
  "GCP_WORKLOAD_IDENTITY_POOL_ID",
  "GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID"
];

function restoreEnvironment(originals) {
  for (const [key, value] of Object.entries(originals)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

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
  const originals = Object.fromEntries(CALENDAR_ENV_KEYS.map(key => [key, process.env[key]]));
  CALENDAR_ENV_KEYS.forEach(key => delete process.env[key]);
  try {
    assert.equal(calendarConfiguration().configured, false);
    const turn = qualifiedTurn();
    const result = await autoBookQualifiedTurn({ from: "527122466811", id: "wamid.pending" }, turn);
    assert.equal(result.state, "qualified_pending_slot");
    assert.equal(result.qualified, true);
    assert.equal(result.reply, turn.reply);
  } finally {
    restoreEnvironment(originals);
  }
});

test("rechaza el calendario principal aunque existan credenciales", () => {
  const originals = Object.fromEntries(CALENDAR_ENV_KEYS.map(key => [key, process.env[key]]));
  Object.assign(process.env, {
    VERCEL: "1",
    GOOGLE_CALENDAR_ID: "primary",
    GCP_PROJECT_ID: "example-project",
    GCP_PROJECT_NUMBER: "123456789",
    GCP_SERVICE_ACCOUNT_EMAIL: "calendar-agent@example-project.iam.gserviceaccount.com",
    GCP_WORKLOAD_IDENTITY_POOL_ID: "vercel",
    GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: "luz-de-vida-gabriel"
  });
  try {
    assert.equal(calendarConfiguration().configured, false);
  } finally {
    restoreEnvironment(originals);
  }
});

test("construye una identidad externa limitada a Google y al proveedor configurado", () => {
  const supplier = async () => "oidc-token";
  const options = externalAccountConfiguration({
    audience: "https://iam.googleapis.com/projects/123456789/locations/global/workloadIdentityPools/vercel/providers/luz-de-vida-gabriel",
    serviceAccountEmail: "calendar-agent@example-project.iam.gserviceaccount.com"
  }, supplier);
  assert.equal(options.token_url, "https://sts.googleapis.com/v1/token");
  assert.equal(
    options.service_account_impersonation_url,
    "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/calendar-agent@example-project.iam.gserviceaccount.com:generateAccessToken"
  );
  assert.equal(options.subject_token_supplier.getSubjectToken, supplier);
});

test("confirma sólo después de disponibilidad, bloqueo, evento y commit", async () => {
  const originalFetch = globalThis.fetch;
  const originalGetAccessToken = BaseExternalAccountClient.prototype.getAccessToken;
  const envKeys = [
    ...CALENDAR_ENV_KEYS,
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY"
  ];
  const originals = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  Object.assign(process.env, {
    VERCEL: "1",
    GOOGLE_CALENDAR_ID: "gabriel-calendar@group.calendar.google.com",
    GCP_PROJECT_ID: "example-project",
    GCP_PROJECT_NUMBER: "123456789",
    GCP_SERVICE_ACCOUNT_EMAIL: "calendar-agent@example-project.iam.gserviceaccount.com",
    GCP_WORKLOAD_IDENTITY_POOL_ID: "vercel",
    GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: "luz-de-vida-gabriel",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test-only"
  });
  BaseExternalAccountClient.prototype.getAccessToken = async () => ({ token: "google-token" });

  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const value = String(url);
    calls.push(value);
    if (value.endsWith("/freeBusy")) {
      return new Response(JSON.stringify({
        calendars: { "gabriel-calendar@group.calendar.google.com": { busy: [] } }
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
    BaseExternalAccountClient.prototype.getAccessToken = originalGetAccessToken;
    restoreEnvironment(originals);
  }
});
