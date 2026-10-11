// Migma-Session carries the minted session.
const ALLOWED_HEADERS = [
  "Content-Type",
  "Authorization",
  "Migma-Session",
  "X-Migma-Client",
  "Idempotency-Key"
];

// Without this the client can read the status but none of the retry signals.
const EXPOSED_HEADERS = [
  "X-Request-Id",
  "X-RateLimit-Limit",
  "X-RateLimit-Remaining",
  "X-RateLimit-Reset",
  "Retry-After",
  "Idempotent-Replayed"
];

const ALLOWED_METHODS = ["GET", "POST", "OPTIONS"];

export function parseOrigins(raw) {
  return String(raw || "")
    .split(",")
    .map(value => value.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

/**
 * Headers for an allowed origin, or null when the origin is not on the list.
 * A same-origin or server-to-server caller sends no Origin at all; that is not a
 * CORS request and gets no CORS headers, which is correct rather than a refusal.
 */
export function corsHeaders(origin, allowed) {
  if (!origin) return {};
  if (!allowed.includes(origin.replace(/\/+$/, ""))) return null;
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": ALLOWED_METHODS.join(", "),
    "access-control-allow-headers": ALLOWED_HEADERS.join(", "),
    "access-control-expose-headers": EXPOSED_HEADERS.join(", "),
    "access-control-max-age": "600",
    vary: "Origin"
  };
}

export { ALLOWED_HEADERS, EXPOSED_HEADERS, ALLOWED_METHODS };
