/**
 * The proxy end to end, over a real socket.
 *
 * Every case here is answered before any upstream call is made, so the suite needs
 * no Migma key and no network: what is being proved is that the gate closes, not
 * that Migma replies.
 */

import assert from "node:assert/strict";
import test, { after } from "node:test";
import { once } from "node:events";

process.env.MIGMA_API_KEY = "sk_test_suite_only_never_real";
process.env.SESSION_SECRET = "s".repeat(64);
process.env.ALLOWED_ORIGINS = "https://xpui.app.spotify.com";
process.env.PORT = "8791";
process.env.HOST = "127.0.0.1";
process.env.SESSION_RATE_LIMIT_PER_MINUTE = "2";
process.env.LOG_LEVEL = "error";

const { server } = await import("../server.js");
const { PLUGIN_SCOPES, mint } = await import("../lib/session.js");

if (!server.listening) await once(server, "listening");
const base = `http://127.0.0.1:${server.address().port}`;
const ORIGIN = "https://xpui.app.spotify.com";
const session = scopes =>
  mint({ subject: "listener-1", scopes, ttlSeconds: 900, secret: process.env.SESSION_SECRET }).token;

after(() => server.close());

test("health answers in the envelope and carries a request id", async () => {
  const res = await fetch(`${base}/healthz`);
  assert.equal(res.status, 200);
  assert.ok(res.headers.get("x-request-id"));
  assert.equal(res.headers.get("cache-control"), "no-store");
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.data.status, "ok");
});

test("preflight admits the headers the plugin sends", async () => {
  const res = await fetch(`${base}/v1/projects`, {
    method: "OPTIONS",
    headers: {
      origin: ORIGIN,
      "access-control-request-method": "GET",
      "access-control-request-headers": "content-type,migma-session,x-migma-client"
    }
  });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("access-control-allow-origin"), ORIGIN);
  const allowed = res.headers.get("access-control-allow-headers").toLowerCase();
  for (const header of ["content-type", "migma-session", "x-migma-client", "authorization"]) {
    assert.ok(allowed.includes(header), `preflight must admit ${header}`);
  }
  assert.equal(res.headers.get("vary"), "Origin");
});

test("an origin off the allowlist is refused, and without CORS headers", async () => {
  const res = await fetch(`${base}/healthz`, { headers: { origin: "https://evil.example" } });
  assert.equal(res.status, 403);
  assert.equal(res.headers.get("access-control-allow-origin"), null);
  assert.equal((await res.json()).success, false);
});

test("no session, an unreadable one, and a forged one are all 401", async () => {
  for (const headers of [{}, { "migma-session": "nonsense" }, { "migma-session": "ms1.a.b" }]) {
    const res = await fetch(`${base}/v1/projects`, { headers: { origin: ORIGIN, ...headers } });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(typeof body.error, "string");
    // The refusal names the session and nothing about the upstream credential.
    assert.doesNotMatch(body.error, /sk_(live|test)|bearer/i);
  }
});

test("a valid session without the scope is 403, not 401", async () => {
  const res = await fetch(`${base}/v1/projects`, {
    headers: { origin: ORIGIN, "migma-session": session([]) }
  });
  assert.equal(res.status, 403);
  assert.match((await res.json()).error, /scoped/i);
});

test("a known path with the wrong verb is 405 and an unknown path is 404", async () => {
  const wrongVerb = await fetch(`${base}/v1/projects/import`, {
    headers: { origin: ORIGIN, "migma-session": session(PLUGIN_SCOPES) }
  });
  assert.equal(wrongVerb.status, 405);
  assert.match(wrongVerb.headers.get("allow") || "", /POST/);

  const unknown = await fetch(`${base}/v1/not-a-route`, { headers: { origin: ORIGIN } });
  assert.equal(unknown.status, 404);
});

test("a body over the cap is refused before it is parsed", async () => {
  const res = await fetch(`${base}/v1/projects/emails/generate`, {
    method: "POST",
    headers: {
      origin: ORIGIN,
      "content-type": "application/json",
      "migma-session": session(PLUGIN_SCOPES)
    },
    body: JSON.stringify({ projectId: "p1", prompt: "x".repeat(200000) })
  });
  assert.equal(res.status, 413);
});

test("a malformed body is 400 and never becomes an upstream call", async () => {
  const res = await fetch(`${base}/v1/projects/emails/generate`, {
    method: "POST",
    headers: {
      origin: ORIGIN,
      "content-type": "application/json",
      "migma-session": session(PLUGIN_SCOPES)
    },
    body: "{not json"
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /JSON/i);
});

test("an implausible Spotify token is refused without asking Spotify", async () => {
  const res = await fetch(`${base}/session`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ spotify_token: "too-short", client: "spicetify-migma" })
  });
  assert.equal(res.status, 401);
  assert.equal((await res.json()).success, false);
});

// Last, because it exhausts the mint bucket for this instance.
test("the mint route is rate limited per caller and says when to return", async () => {
  const call = () =>
    fetch(`${base}/session`, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      // Still implausible on purpose: the limit is spent before the handler runs,
      // so this proves the ceiling without a call to Spotify.
      body: JSON.stringify({ spotify_token: "too-short" })
    });

  let limited = null;
  for (let i = 0; i < 6 && !limited; i++) {
    const res = await call();
    if (res.status === 429) limited = res;
    else await res.text();
  }

  assert.ok(limited, "the mint bucket must close");
  const body = await limited.json();
  assert.equal(body.success, false);
  assert.ok(body.retryAfter >= 1);
  assert.ok(Number(limited.headers.get("retry-after")) >= 1);
  assert.equal(limited.headers.get("x-ratelimit-limit"), "2");
});
