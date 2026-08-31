import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("el aviso, la interfaz y las APIs usan la misma versión de consentimiento", async () => {
  const [html, notice, app, edge, whatsapp, migration] = await Promise.all([
    read("public/index.html"),
    read("public/aviso-de-privacidad.html"),
    read("public/app.js"),
    read("supabase/functions/gabriel-public-api/handler.mjs"),
    read("netlify/functions/whatsapp.mjs"),
    read("sql/20260831_record_web_privacy_consent.sql")
  ]);
  assert.match(html, /href="\/aviso-de-privacidad\.html"/);
  assert.match(html, /id="chat-input"[^>]+disabled/);
  assert.match(notice, /Versión 2026-08-31/);
  assert.match(notice, /Hector Adair Lovera Garfias/);
  assert.match(notice, /C\.P\. 50454/);
  assert.match(app, /PRIVACY_NOTICE_VERSION = "2026-08-31"/);
  assert.match(edge, /PRIVACY_NOTICE_VERSION = "2026-08-31"/);
  assert.match(whatsapp, /PRIVACY_NOTICE_VERSION = "2026-08-31"/);
  assert.match(migration, /p_notice_version <> '2026-08-31'/);
  assert.match(app, /function track[\s\S]+if \(!state\.consentRecorded\) return;/);
  assert.doesNotMatch(app, /\ntrack\("page_view"\);\s*$/);
  assert.doesNotMatch(app, /22\/08\/2026/);
  assert.doesNotMatch(app, /SUPABASE_SERVICE_ROLE_KEY/);
});

test("las funciones nuevas de base de datos quedan cerradas al público", async () => {
  const [consent, bridge] = await Promise.all([
    read("sql/20260831_record_web_privacy_consent.sql"),
    read("sql/20260830_connect_web_booking_to_whatsapp.sql")
  ]);
  for (const sql of [consent, bridge]) {
    assert.match(sql, /security definer/i);
    assert.match(sql, /set search_path = ''/i);
    assert.match(sql, /revoke all on function[\s\S]+from public, anon, authenticated/i);
    assert.match(sql, /grant execute on function[\s\S]+to service_role/i);
  }
  assert.match(bridge, /update public\.gabriel_appointments as expired[\s\S]+expired\.hold_expires_at/i);
});

test("el repositorio conserva las migraciones que ya existen en producción", async () => {
  const [classification, booking, edge] = await Promise.all([
    read("sql/20260825_add_whatsapp_lead_classification.sql"),
    read("sql/20260826_add_free_web_booking.sql"),
    read("supabase/functions/gabriel-public-api/handler.mjs")
  ]);
  assert.match(classification, /gabriel_commit_whatsapp_turn/);
  assert.match(booking, /gabriel_book_web_appointment/);
  assert.match(edge, /gabriel_book_web_appointment/);
});

test("la configuración de hosting bloquea scripts inline y publica trazabilidad", async () => {
  const [netlify, vercel, build, app] = await Promise.all([
    read("netlify.toml"),
    read("vercel.json"),
    read("scripts/build.mjs"),
    read("public/app.js")
  ]);
  assert.doesNotMatch(netlify, /script-src[^\n]+unsafe-inline/);
  assert.doesNotMatch(vercel, /script-src[^\n]+unsafe-inline/);
  assert.match(netlify, /Strict-Transport-Security/);
  assert.match(netlify, /for = "\/release\.json"[\s\S]+Cache-Control = "no-store"/);
  assert.match(vercel, /"source": "\/release\.json"[\s\S]+"Cache-Control", "value": "no-store"/);
  assert.match(build, /dist\/release\.json/);
  assert.match(build, /PUBLIC_SUPABASE_URL/);
  assert.match(build, /PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
  assert.match(build, /CONTEXT === "deploy-preview"/);
  assert.match(build, /DEFAULT_PREVIEW_SUPABASE_URL/);
  assert.match(app, /__GABRIEL_PUBLIC_API_URL__/);
  assert.match(app, /__GABRIEL_PUBLIC_API_KEY__/);
  assert.match(netlify, /connect-src 'self' https:\/\/\*\.supabase\.co/);
  assert.match(netlify, /\[context\.deploy-preview\.environment\][\s\S]+PUBLIC_SUPABASE_URL[\s\S]+SUPABASE_URL/);
  assert.match(netlify, /kxlrtuqjclsvgchawzfe\.supabase\.co/);
  assert.match(netlify, /SECRETS_SCAN_OMIT_KEYS = "SUPABASE_URL"/);
  assert.doesNotMatch(netlify, /SECRETS_SCAN_ENABLED\s*=\s*"?false"?/);
  assert.doesNotMatch(netlify, /SECRETS_SCAN_OMIT_KEYS[^\n]+SERVICE_ROLE/);
});
