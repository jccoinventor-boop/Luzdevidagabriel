import test from "node:test";
import assert from "node:assert/strict";
import { BaseExternalAccountClient, JWT } from "google-auth-library";
import {
  autoBookQualifiedTurn,
  appointmentInputExample,
  calendarConfiguration,
  confirmWebBooking,
  externalAccountConfiguration,
  parseAppointmentWindow
} from "../netlify/functions/lib/calendar.mjs";

const CALENDAR_ENV_KEYS = [
  "VERCEL",
  "NETLIFY",
  "GOOGLE_CALENDAR_ID",
  "GCP_PROJECT_ID",
  "GCP_PROJECT_NUMBER",
  "GCP_SERVICE_ACCOUNT_EMAIL",
  "GCP_WORKLOAD_IDENTITY_POOL_ID",
  "GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID",
  "GOOGLE_SERVICE_ACCOUNT_EMAIL",
  "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY"
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
  assert.equal(appointmentInputExample(new Date("2026-08-31T12:00:00.000Z")), "07/09/2026 17:00");
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

test("activa Calendar en Netlify sólo con una cuenta de servicio completa", () => {
  const originals = Object.fromEntries(CALENDAR_ENV_KEYS.map(key => [key, process.env[key]]));
  CALENDAR_ENV_KEYS.forEach(key => delete process.env[key]);
  Object.assign(process.env, {
    NETLIFY: "true",
    GOOGLE_CALENDAR_ID: "gabriel-calendar@group.calendar.google.com",
    GOOGLE_SERVICE_ACCOUNT_EMAIL: "calendar-agent@example-project.iam.gserviceaccount.com",
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: "test-only-private-key"
  });
  try {
    const config = calendarConfiguration();
    assert.equal(config.configured, true);
    assert.equal(config.authMode, "service_account");
    assert.equal(config.serviceAccountEmail, "calendar-agent@example-project.iam.gserviceaccount.com");
    assert.equal("privateKey" in config, false);

    delete process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
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
    if (/\/events\/gabriel[0-9a-f]+$/.test(value)) {
      return new Response("", { status: 404 });
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

test("Netlify confirma usando una cuenta de servicio sin exponer la llave", async () => {
  const originalFetch = globalThis.fetch;
  const originalGetAccessToken = JWT.prototype.getAccessToken;
  const envKeys = [
    ...CALENDAR_ENV_KEYS,
    "NETLIFY",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY"
  ];
  const originals = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  CALENDAR_ENV_KEYS.forEach(key => delete process.env[key]);
  Object.assign(process.env, {
    NETLIFY: "true",
    GOOGLE_CALENDAR_ID: "gabriel-calendar@group.calendar.google.com",
    GOOGLE_SERVICE_ACCOUNT_EMAIL: "calendar-agent@example-project.iam.gserviceaccount.com",
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: "test-only-private-key",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test-only"
  });
  JWT.prototype.getAccessToken = async () => ({ token: "google-token" });

  globalThis.fetch = async (url, options = {}) => {
    const value = String(url);
    if (value.endsWith("/freeBusy")) {
      assert.equal(options.headers.authorization, "Bearer google-token");
      return new Response(JSON.stringify({
        calendars: { "gabriel-calendar@group.calendar.google.com": { busy: [] } }
      }), { status: 200 });
    }
    if (/\/events\/gabriel[0-9a-f]+$/.test(value)) {
      return new Response("", { status: 404 });
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
      return new Response(JSON.stringify({ id: body.id }), { status: 200 });
    }
    if (value.endsWith("/rpc/gabriel_confirm_appointment")) {
      return new Response("true", { status: 200 });
    }
    throw new Error("unexpected_fetch:" + value);
  };

  try {
    const result = await autoBookQualifiedTurn(
      { from: "527122466811", id: "wamid.netlify-confirmed" },
      qualifiedTurn()
    );
    assert.equal(result.state, "confirmed");
    assert.ok(result.lead.googleEventId);
  } finally {
    globalThis.fetch = originalFetch;
    JWT.prototype.getAccessToken = originalGetAccessToken;
    restoreEnvironment(originals);
  }
});

test("conecta un apartado web con WhatsApp y confirma el mismo registro en Calendar", async () => {
  const originalFetch = globalThis.fetch;
  const originalGetAccessToken = JWT.prototype.getAccessToken;
  const envKeys = [
    ...CALENDAR_ENV_KEYS,
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY"
  ];
  const originals = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  CALENDAR_ENV_KEYS.forEach(key => delete process.env[key]);
  Object.assign(process.env, {
    NETLIFY: "true",
    GOOGLE_CALENDAR_ID: "gabriel-calendar@group.calendar.google.com",
    GOOGLE_SERVICE_ACCOUNT_EMAIL: "calendar-agent@example-project.iam.gserviceaccount.com",
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: "test-only-private-key",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test-only"
  });
  JWT.prototype.getAccessToken = async () => ({ token: "google-token" });

  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const value = String(url);
    calls.push(value);
    if (/\/events\/gabriel[0-9a-f]+$/.test(value)) return new Response("", { status: 404 });
    if (value.endsWith("/freeBusy")) {
      return new Response(JSON.stringify({
        calendars: { "gabriel-calendar@group.calendar.google.com": { busy: [] } }
      }), { status: 200 });
    }
    if (value.includes("/events?sendUpdates=none")) {
      const body = JSON.parse(options.body);
      return new Response(JSON.stringify({ id: body.id }), { status: 200 });
    }
    if (value.endsWith("/rpc/gabriel_confirm_appointment")) return new Response("true", { status: 200 });
    throw new Error("unexpected_fetch:" + value);
  };

  try {
    const startsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const result = await confirmWebBooking(
      { from: "527122466811", id: "wamid.web-confirmation" },
      {
        appointment_id: "123e4567-e89b-42d3-a456-426614174001",
        customer_name: "Ana",
        customer_phone: "7122466811",
        topic: "Quiero orientación sobre una situación de pareja",
        modality: "Videollamada",
        starts_at: startsAt.toISOString(),
        ends_at: new Date(startsAt.getTime() + 60 * 60 * 1000).toISOString(),
        appointment_status: "hold",
        google_event_id: null
      }
    );
    assert.equal(result.state, "confirmed");
    assert.match(result.reply, /Tu cita quedó confirmada/);
    assert.equal(calls.some(value => value.endsWith("/rpc/gabriel_hold_appointment")), false);
    assert.equal(calls.filter(value => value.endsWith("/rpc/gabriel_confirm_appointment")).length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    JWT.prototype.getAccessToken = originalGetAccessToken;
    restoreEnvironment(originals);
  }
});

test("un reintento no libera Supabase cuando el evento de Google ya existe", async () => {
  const originalFetch = globalThis.fetch;
  const originalGetAccessToken = JWT.prototype.getAccessToken;
  const envKeys = [...CALENDAR_ENV_KEYS, "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
  const originals = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  CALENDAR_ENV_KEYS.forEach(key => delete process.env[key]);
  Object.assign(process.env, {
    NETLIFY: "true",
    GOOGLE_CALENDAR_ID: "gabriel-calendar@group.calendar.google.com",
    GOOGLE_SERVICE_ACCOUNT_EMAIL: "calendar-agent@example-project.iam.gserviceaccount.com",
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: "test-only-private-key",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test-only"
  });
  JWT.prototype.getAccessToken = async () => ({ token: "google-token" });
  const calls = [];
  globalThis.fetch = async (url) => {
    const value = String(url);
    calls.push(value);
    if (/\/events\/gabriel[0-9a-f]+$/.test(value)) {
      return new Response(JSON.stringify({ id: value.split("/").pop() }), { status: 200 });
    }
    if (value.endsWith("/rpc/gabriel_hold_appointment")) {
      return new Response(JSON.stringify([{
        appointment_id: "123e4567-e89b-42d3-a456-426614174001",
        appointment_status: "hold",
        google_event_id: null,
        result: "existing"
      }]), { status: 200 });
    }
    if (value.endsWith("/rpc/gabriel_confirm_appointment")) return new Response("false", { status: 200 });
    throw new Error("unexpected_fetch:" + value);
  };
  try {
    const result = await autoBookQualifiedTurn(
      { from: "527122466811", id: "wamid.retry-existing-event" },
      qualifiedTurn()
    );
    assert.equal(result.state, "qualified_pending_slot");
    assert.equal(calls.some(value => value.endsWith("/freeBusy")), false);
    assert.equal(calls.some(value => value.endsWith("/rpc/gabriel_release_appointment")), false);
  } finally {
    globalThis.fetch = originalFetch;
    JWT.prototype.getAccessToken = originalGetAccessToken;
    restoreEnvironment(originals);
  }
});
