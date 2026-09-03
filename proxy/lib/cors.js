/**
 * CORS, stated explicitly rather than delegated.
 *
 * The allowed origin is echoed exactly, never `*`, because the allowlist is the
 * access control on this service's client-facing side. Credentials are not
 * allowed: the session travels in the Migma-Session header, so no cookie needs
 * to ride along, and refusing them removes a whole class of mistake.
 */

// Migma-Session carries the minted session. X-Migma-Client is sent on every
// request by the plugin, so omitting it fails the preflight and blocks the call
// before it is made. Authorization is here for POST /session, which presents the
// Spotify token that way. Content-Type is not CORS-safelisted at application/json.
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
