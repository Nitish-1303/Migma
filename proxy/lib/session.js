/**
 * The session this proxy issues in exchange for a validated Spotify one.
 *
 * It is an HMAC-signed statement rather than a row in a store, so verification
 * needs nothing but the secret: two instances behind a load balancer accept each
 * other's sessions, and a restart does not sign every client out. The cost is
 * that revocation before expiry is not possible for one session alone -- rotating
 * SESSION_SECRET invalidates all of them at once, which is the intended lever.
 */

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

const VERSION = "ms1";

// What a session may ask this proxy to do. These are the proxy's own scopes, not
// Migma's: the Migma key's permissions are set once in Migma's dashboard, and no
// client-held session can widen them.
export const SCOPES = {
  PROJECTS_READ: "projects:read",
  PROJECTS_IMPORT: "projects:import",
  EMAILS_GENERATE: "emails:generate",
  EMAILS_READ: "emails:read",
  VALIDATE_READ: "validate:read"
};

// What POST /session grants. Deliberately no send scope and no billing scope:
// the plugin does not send, so a session that could would be a liability.
export const PLUGIN_SCOPES = Object.freeze([
  SCOPES.PROJECTS_READ,
  SCOPES.PROJECTS_IMPORT,
  SCOPES.EMAILS_GENERATE,
  SCOPES.EMAILS_READ,
  SCOPES.VALIDATE_READ
]);

const encode = value => Buffer.from(value).toString("base64url");
const decode = value => Buffer.from(value, "base64url");

const sign = (payload, secret) =>
  createHmac("sha256", secret).update(`${VERSION}.${payload}`).digest();

export function mint({ subject, scopes = PLUGIN_SCOPES, ttlSeconds, secret }) {
  const issued = Math.floor(Date.now() / 1000);
  const claims = {
    sub: subject,
    scp: scopes,
    iat: issued,
    exp: issued + ttlSeconds,
    jti: randomUUID()
  };
  const payload = encode(JSON.stringify(claims));
  return {
    token: `${VERSION}.${payload}.${encode(sign(payload, secret))}`,
    expiresIn: ttlSeconds,
    expiresAt: claims.exp,
    scopes,
    jti: claims.jti,
    subject
  };
}

/**
 * Signature first, then claims. Parsing a payload this proxy has not yet
 * authenticated would be reading attacker input as structure.
 */
export function verify(token, secret) {
  if (typeof token !== "string" || !token) return { ok: false, reason: "missing" };
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) return { ok: false, reason: "malformed" };

  const expected = sign(parts[1], secret);
  let given;
  try {
    given = decode(parts[2]);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (given.length !== expected.length) return { ok: false, reason: "signature" };
  if (!timingSafeEqual(given, expected)) return { ok: false, reason: "signature" };

  let claims;
  try {
    claims = JSON.parse(decode(parts[1]).toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!claims || typeof claims.sub !== "string" || !Array.isArray(claims.scp)) {
    return { ok: false, reason: "malformed" };
  }
  if (!Number.isFinite(claims.exp) || claims.exp <= Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, claims };
}

export const holds = (claims, scope) => Array.isArray(claims.scp) && claims.scp.includes(scope);
