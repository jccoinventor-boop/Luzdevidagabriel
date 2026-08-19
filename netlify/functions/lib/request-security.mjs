import crypto from "node:crypto";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ATTRIBUTION_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "gclid", "fbclid"];
const MAX_LOCAL_WINDOWS = 2_000;
const localWindows = new Map();

export class RequestInputError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export async function readJsonBody(request, maxBytes = 16_384) {
  const raw = await readLimitedBody(request, maxBytes);

  try {
    return JSON.parse(raw.toString("utf8"));
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
  let address = "unknown";
  if (process.env.VERCEL === "1") {
    address = request.headers.get("x-forwarded-for")?.trim() || address;
  } else if (process.env.NETLIFY === "true") {
    address = request.headers.get("x-nf-client-connection-ip")?.trim() || address;
  }
  const salt = process.env.RATE_LIMIT_SALT || process.env.SUPABASE_SERVICE_ROLE_KEY || "luz-de-vida-gabriel";
  return crypto.createHash("sha256").update(`${salt}:${address.slice(0, 120)}`).digest("hex");
}

export function pruneLocalWindows(windows, now, windowMs, maxEntries = MAX_LOCAL_WINDOWS) {
  for (const [candidate, value] of windows) {
    if (value.startedAt <= now - windowMs) windows.delete(candidate);
  }
  while (windows.size >= maxEntries) {
    windows.delete(windows.keys().next().value);
  }
}

export function isLocallyRateLimited(request, scope, limit = 40, windowMs = 60_000) {
  const now = Date.now();
  const key = `${scope}:${clientKey(request)}`;
  const current = localWindows.get(key);

  if (!current || current.startedAt <= now - windowMs) {
    pruneLocalWindows(localWindows, now, windowMs);
    localWindows.set(key, { startedAt: now, count: 1 });
    return false;
  }

  current.count += 1;
  return current.count > limit;
}

export async function readLimitedBody(request, maxBytes) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new RequestInputError("payload_too_large", 413);
  }

  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("payload_too_large").catch(() => undefined);
        throw new RequestInputError("payload_too_large", 413);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks, total);
}
