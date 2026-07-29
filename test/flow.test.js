import test from "node:test";
import assert from "node:assert/strict";
import lead from "../netlify/functions/lead.mjs";

test("lead rechaza métodos distintos de POST", async () => {
  const result = await lead(new Request("https://example.test", { method: "GET" }));
  assert.equal(result.statusCode, 405);
});

test("lead exige JSON válido", async () => {
  const result = await lead(new Request("https://example.test", { method: "POST", body: "{" }));
  assert.equal(result.statusCode, 400);
});

test("lead exige un evento", async () => {
  const result = await lead(new Request("https://example.test", { method: "POST", body: JSON.stringify({ name: "Ana" }) }));
  assert.equal(result.statusCode, 422);
});

test("lead acepta un evento medible sin servicios externos", async () => {
  const result = await lead(new Request("https://example.test", { method: "POST", body: JSON.stringify({ event: "page_view", sessionId: "abc" }) }));
  assert.equal(result.statusCode, 202);
});

test("lead elimina campos no autorizados", async () => {
  const result = await lead(new Request("https://example.test", { method: "POST", body: JSON.stringify({ event: "page_view", secret: "no" }) }));
  assert.equal(JSON.parse(result.body).accepted, true);
});
