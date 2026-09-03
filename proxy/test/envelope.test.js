/**
 * The boundaries: what CORS admits, what the guards refuse, what the router lets
 * through, and the one response shape the client is allowed to see.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { ALLOWED_HEADERS, corsHeaders, parseOrigins } from "../lib/cors.js";
import { HttpError, fail, ok } from "../lib/http.js";
import { createRateLimiter } from "../lib/ratelimit.js";
import { createRouter } from "../lib/router.js";
import { optionalLocales, optionalPaging, requireId, requireString } from "../lib/guard.js";

const ORIGINS = parseOrigins("https://xpui.app.spotify.com, http://localhost:8080/");

test("the allowlist is exact and trailing slashes do not defeat it", () => {
  assert.deepEqual(ORIGINS, ["https://xpui.app.spotify.com", "http://localhost:8080"]);
  assert.equal(corsHeaders("https://xpui.app.spotify.com", ORIGINS)["access-control-allow-origin"],
    "https://xpui.app.spotify.com");
  assert.equal(corsHeaders("https://evil.example", ORIGINS), null);
  assert.equal(corsHeaders("https://xpui.app.spotify.com.evil.example", ORIGINS), null);
  // No Origin at all is not a CORS request, so it gets no CORS headers.
  assert.deepEqual(corsHeaders(undefined, ORIGINS), {});
});

test("every header the plugin actually sends is admitted", () => {
  // X-Migma-Client rides on every request; omitting it fails the preflight and no
  // call is ever made. Migma-Session carries the minted session.
  for (const header of ["Content-Type", "Authorization", "Migma-Session", "X-Migma-Client"]) {
    assert.ok(ALLOWED_HEADERS.includes(header), `${header} must be allowed`);
  }
  const headers = corsHeaders("https://xpui.app.spotify.com", ORIGINS);
  assert.equal(headers["vary"], "Origin");
  // The session is a header, not a cookie, so credentials are never allowed.
  assert.equal(headers["access-control-allow-credentials"], undefined);
  assert.match(headers["access-control-expose-headers"], /X-RateLimit-Reset/);
});

test("identifiers cannot carry a path", () => {
  assert.equal(requireId("conv_A1-b2", "id"), "conv_A1-b2");
  for (const bad of ["../projects", "a/b", "a.b", "", "x".repeat(129), 7, null]) {
    assert.throws(() => requireId(bad, "id"), HttpError);
  }
});

test("strings are bounded and language tags are shaped and deduped", () => {
  assert.equal(requireString("  hi  ", "f"), "hi");
  assert.throws(() => requireString("x".repeat(9), "f", { max: 8 }), HttpError);
  assert.throws(() => requireString("", "f"), HttpError);
  assert.deepEqual(optionalLocales(["en", "pt-BR", "en"], "languages"), ["en", "pt-BR"]);
  assert.equal(optionalLocales(undefined, "languages"), undefined);
  assert.throws(() => optionalLocales(["english!"], "languages"), HttpError);
  assert.throws(() => optionalLocales(new Array(13).fill("en"), "languages"), HttpError);
});

test("paging is bounded so one request cannot be made expensive", () => {
  assert.deepEqual(optionalPaging(new URLSearchParams("limit=50&offset=10")), { limit: 50, offset: 10 });
  assert.deepEqual(optionalPaging(new URLSearchParams("")), {});
  assert.throws(() => optionalPaging(new URLSearchParams("limit=101")), HttpError);
  assert.throws(() => optionalPaging(new URLSearchParams("offset=-1")), HttpError);
  assert.throws(() => optionalPaging(new URLSearchParams("limit=abc")), HttpError);
});

test("the router separates a wrong verb from a wrong path", () => {
  const router = createRouter();
  router.get("/v1/projects", () => {}, { scope: "projects:read" });
  router.get("/v1/projects/emails/:conversationId/status", () => {}, { auth: true });

  const hit = router.match("GET", "/v1/projects");
  assert.equal(hit.route.scope, "projects:read");
  assert.equal(router.match("POST", "/v1/projects"), "method");
  assert.equal(router.match("GET", "/v1/nothing"), null);

  const params = router.match("GET", "/v1/projects/emails/conv_9/status").params;
  assert.equal(params.conversationId, "conv_9");
});

test("a parameter that could traverse never reaches a handler", () => {
  const router = createRouter();
  let reached = false;
  router.get("/v1/projects/emails/:conversationId/status", () => {
    reached = true;
  });
  // Encoded slash, encoded dot-dot, and a malformed escape are all simply misses.
  assert.equal(router.match("GET", "/v1/projects/emails/%2e%2e%2fprojects/status"), null);
  assert.equal(router.match("GET", "/v1/projects/emails/%zz/status"), null);
  assert.equal(reached, false);
});

test("public routes are opt-in, not the default", () => {
  const router = createRouter();
  router.post("/session", () => {}, { auth: false });
  router.get("/v1/projects", () => {});
  assert.equal(router.match("POST", "/session").route.auth, false);
  assert.equal(router.match("GET", "/v1/projects").route.auth, true);
});

test("both directions speak one envelope", () => {
  const good = ok({ projects: [] }, "req-1");
  assert.equal(good.success, true);
  assert.deepEqual(good.data, { projects: [] });
  assert.equal(good.metadata.requestId, "req-1");
  assert.ok(good.metadata.timestamp);

  const bad = fail("Migma has no such resource", "req-2");
  assert.equal(bad.success, false);
  // A plain string, matching upstream: there is no machine-readable code to pass on.
  assert.equal(typeof bad.error, "string");
  assert.equal(bad.data, undefined);
});

test("the rate limiter refuses past its ceiling and says when to return", () => {
  const limiter = createRateLimiter({ perMinute: 3, sweepMs: 60000 });
  for (let i = 0; i < 3; i++) assert.equal(limiter.take("sub:a").allowed, true);

  const refused = limiter.take("sub:a");
  assert.equal(refused.allowed, false);
  assert.ok(refused.retryAfter >= 1);
  // Epoch seconds, matching how Migma publishes its own reset.
  assert.ok(refused.resetAt > Math.floor(Date.now() / 1000) - 1);

  // One caller's exhausted bucket is not another's.
  assert.equal(limiter.take("sub:b").allowed, true);
  assert.equal(limiter.headers(refused)["x-ratelimit-limit"], "3");
  limiter.stop();
  assert.equal(limiter.size, 0);
});
