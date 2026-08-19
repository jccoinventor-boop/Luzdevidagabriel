import crypto from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import whatsapp from "../netlify/functions/whatsapp.mjs";
import {
  RequestInputError,
  clientKey,
  pruneLocalWindows,
  readLimitedBody
} from "../netlify/functions/lib/request-security.mjs";

function restoreEnvironment(originals) {
  for (const [key, value] of Object.entries(originals)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test("Vercel ignora la cabecera de Netlify y usa el x-forwarded-for sobrescrito por su edge", () => {
  const keys = ["VERCEL", "NETLIFY", "RATE_LIMIT_SALT"];
  const originals = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { VERCEL: "1", NETLIFY: "true", RATE_LIMIT_SALT: "test-salt" });
  try {
    const base = clientKey(new Request("https://example.test", {
      headers: { "x-forwarded-for": "203.0.113.10", "x-nf-client-connection-ip": "198.51.100.1" }
    }));
    const forgedNetlify = clientKey(new Request("https://example.test", {
      headers: { "x-forwarded-for": "203.0.113.10", "x-nf-client-connection-ip": "192.0.2.99" }
    }));
    const differentVercelIp = clientKey(new Request("https://example.test", {
      headers: { "x-forwarded-for": "203.0.113.11", "x-nf-client-connection-ip": "198.51.100.1" }
    }));
    assert.equal(base, forgedNetlify);
    assert.notEqual(base, differentVercelIp);
  } finally {
    restoreEnvironment(originals);
  }
});

test("Netlify conserva su cabecera nativa y un entorno desconocido no confía en proxys", () => {
  const keys = ["VERCEL", "NETLIFY", "RATE_LIMIT_SALT"];
  const originals = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.RATE_LIMIT_SALT = "test-salt";
  delete process.env.VERCEL;
  process.env.NETLIFY = "true";
  try {
    const netlifyA = clientKey(new Request("https://example.test", {
      headers: { "x-forwarded-for": "203.0.113.10", "x-nf-client-connection-ip": "198.51.100.1" }
    }));
    const netlifyB = clientKey(new Request("https://example.test", {
      headers: { "x-forwarded-for": "192.0.2.99", "x-nf-client-connection-ip": "198.51.100.1" }
    }));
    assert.equal(netlifyA, netlifyB);

    delete process.env.NETLIFY;
    const unknownA = clientKey(new Request("https://example.test", {
      headers: { "x-forwarded-for": "203.0.113.10", "x-nf-client-connection-ip": "198.51.100.1" }
    }));
    const unknownB = clientKey(new Request("https://example.test", {
      headers: { "x-forwarded-for": "192.0.2.99", "x-nf-client-connection-ip": "203.0.113.44" }
    }));
    assert.equal(unknownA, unknownB);
  } finally {
    restoreEnvironment(originals);
  }
});

test("el estado local del limitador conserva una capacidad fija", () => {
  const windows = new Map([
    ["old", { startedAt: 0 }],
    ["a", { startedAt: 100 }],
    ["b", { startedAt: 100 }],
    ["c", { startedAt: 100 }]
  ]);
  pruneLocalWindows(windows, 100, 50, 3);
  windows.set("new", { startedAt: 100 });
  assert.equal(windows.has("old"), false);
  assert.equal(windows.size, 3);
});

test("la lectura acotada cancela un cuerpo transmitido que supera el máximo", async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.enqueue(new Uint8Array([4, 5, 6]));
      controller.close();
    }
  });
  const request = new Request("https://example.test/webhooks/whatsapp", {
    method: "POST",
    body: stream,
    duplex: "half"
  });
  await assert.rejects(readLimitedBody(request, 4), error => {
    assert.ok(error instanceof RequestInputError);
    assert.equal(error.code, "payload_too_large");
    return true;
  });
});

test("el webhook rechaza una firma mal formada antes de procesar el cuerpo", async () => {
  const response = await whatsapp(new Request("https://example.test/webhooks/whatsapp", {
    method: "POST",
    headers: { "x-hub-signature-256": "sha256=no-es-un-digest" },
    body: "cuerpo no confiable"
  }));
  assert.equal(response.status, 401);
});

test("el webhook legítimo conserva la verificación HMAC sobre los bytes exactos", async () => {
  const originalSecret = process.env.META_APP_SECRET;
  process.env.META_APP_SECRET = "test-meta-secret";
  const body = JSON.stringify({ entry: [] });
  const signature = `sha256=${crypto.createHmac("sha256", process.env.META_APP_SECRET).update(body).digest("hex")}`;
  try {
    const response = await whatsapp(new Request("https://example.test/webhooks/whatsapp", {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": signature },
      body
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { received: true });
  } finally {
    if (originalSecret === undefined) delete process.env.META_APP_SECRET;
    else process.env.META_APP_SECRET = originalSecret;
  }
});
