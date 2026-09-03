/**
 * The session exchange. These are the tests that matter most: a forgeable session
 * would let any caller spend the workspace's Migma quota.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { PLUGIN_SCOPES, SCOPES, holds, mint, verify } from "../lib/session.js";

const SECRET = "0".repeat(64);

test("a minted session verifies and carries its subject", () => {
  const minted = mint({ subject: "listener-1", ttlSeconds: 900, secret: SECRET });
  const result = verify(minted.token, SECRET);
  assert.equal(result.ok, true);
  assert.equal(result.claims.sub, "listener-1");
  assert.equal(result.claims.exp - result.claims.iat, 900);
  assert.match(minted.token, /^ms1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
});

test("a session signed by another secret is refused", () => {
  const minted = mint({ subject: "listener-1", ttlSeconds: 900, secret: SECRET });
  assert.deepEqual(verify(minted.token, "1".repeat(64)), { ok: false, reason: "signature" });
});

test("editing the claims invalidates the signature", () => {
  const minted = mint({ subject: "listener-1", ttlSeconds: 900, secret: SECRET });
  const [version, payload, signature] = minted.token.split(".");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  claims.scp = [...claims.scp, "billing:write"];
  const forged = Buffer.from(JSON.stringify(claims)).toString("base64url");
  assert.equal(verify(`${version}.${forged}.${signature}`, SECRET).reason, "signature");
});

test("shapes that are not sessions are told apart from bad signatures", () => {
  assert.equal(verify(undefined, SECRET).reason, "missing");
  assert.equal(verify("", SECRET).reason, "missing");
  assert.equal(verify("not-a-token", SECRET).reason, "malformed");
  assert.equal(verify("ms2.a.b", SECRET).reason, "malformed");
  assert.equal(verify("ms1.a.b", SECRET).reason, "signature");
});

test("an elapsed session reports expiry rather than a bad signature", () => {
  const minted = mint({ subject: "listener-1", ttlSeconds: 60, secret: SECRET });
  const [version, payload] = minted.token.split(".");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  claims.exp = Math.floor(Date.now() / 1000) - 1;
  // Re-signed, so the only thing wrong with it is the clock.
  const forged = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createHmac("sha256", SECRET)
    .update(`${version}.${forged}`)
    .digest()
    .toString("base64url");
  assert.equal(verify(`${version}.${forged}.${signature}`, SECRET).reason, "expired");
});

test("the granted scope set covers the plugin and nothing beyond it", () => {
  const { claims } = verify(mint({ subject: "s", ttlSeconds: 60, secret: SECRET }).token, SECRET);
  for (const scope of Object.values(SCOPES)) assert.equal(holds(claims, scope), true);
  assert.equal(holds(claims, "email:send"), false);
  assert.equal(holds(claims, "billing:write"), false);
  assert.equal(PLUGIN_SCOPES.length, 5);
  assert.equal(Object.isFrozen(PLUGIN_SCOPES), true);
});

test("a session is scoped to one subject only", () => {
  const a = mint({ subject: "listener-a", ttlSeconds: 60, secret: SECRET });
  const b = mint({ subject: "listener-b", ttlSeconds: 60, secret: SECRET });
  assert.notEqual(a.token, b.token);
  assert.notEqual(a.jti, b.jti);
  assert.equal(verify(a.token, SECRET).claims.sub, "listener-a");
});
