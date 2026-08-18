import crypto from "node:crypto";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ATTRIBUTION_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "gclid", "fbclid"];
const localWindows = new Map();

export class RequestInputError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export async function readJsonBody(request, maxBytes = 16_384) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new RequestInputError("payload_too_large", 413);
  }

  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > maxBytes) {
    throw new RequestInputError("payload_too_large", 413);
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new RequestInputError("invalid_json", 400);
  }
}

export function isUuid(value) {
  return UUID_PATTERN.test(String(value || ""));
}

export function normalizeAttribution(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    ATTRIBUTION_KEYS.flatMap(key => {
      const item = value[key];
      if (typeof item !== "string") return [];
      const clean = item.trim().slice(0, 120);
      return clean ? [[key, clean]] : [];
    })
  );
}

export function clientKey(request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = (request.headers.get("x-nf-client-connection-ip") || forwarded || "unknown").slice(0, 120);
  const salt = process.env.RATE_LIMIT_SALT || process.env.SUPABASE_SERVICE_ROLE_KEY || "luz-de-vida-gabriel";
  return crypto.createHash("sha256").update(`${salt}:${address}`).digest("hex");
}

export function isLocallyRateLimited(request, scope, limit = 40, windowMs = 60_000) {
  const now = Date.now();
  const key = `${scope}:${clientKey(request)}`;
  const current = localWindows.get(key);

  if (!current || current.startedAt <= now - windowMs) {
    localWindows.set(key, { startedAt: now, count: 1 });
    return false;
  }

  current.count += 1;
  if (localWindows.size > 2_000) {
    for (const [candidate, value] of localWindows) {
      if (value.startedAt <= now - windowMs) localWindows.delete(candidate);
      if (localWindows.size <= 2_000) break;
    }
  }
  return current.count > limit;
}
