/**
 * Entry point.
 *
 * The order of operations per request is the security design: CORS allowlist, then
 * routing, then session verification, then the rate limit, then the handler.
 * Nothing reaches an upstream call until all four have passed.
 */

import http from "node:http";
import { corsHeaders } from "./lib/cors.js";
import { createLogger } from "./lib/log.js";
import { createMigmaClient } from "./lib/migma.js";
import { createRateLimiter } from "./lib/ratelimit.js";
import { createRouter } from "./lib/router.js";
import { createSpotifyValidator } from "./lib/spotify.js";
import { loadConfig } from "./lib/config.js";
import { HttpError, clientAddress, fail, newRequestId, ok, readJson, send } from "./lib/http.js";
import { holds, verify } from "./lib/session.js";
import { registerEmailRoutes } from "./routes/emails.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerSessionRoutes } from "./routes/session.js";
import { registerValidateRoutes } from "./routes/validate.js";

let config;
try {
  config = loadConfig();
} catch (error) {
  // Written directly rather than through the logger: a misconfigured deployment
  // needs this legible in a crash log, not wrapped in JSON.
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}

const logger = createLogger(config.logLevel);
const migma = createMigmaClient({
  apiKey: config.apiKey,
  baseUrl: config.baseUrl,
  timeoutMs: config.upstreamTimeoutMs,
  logger
});
const spotify = createSpotifyValidator({ timeoutMs: config.spotifyTimeoutMs, logger });
const limiter = createRateLimiter({ perMinute: config.rateLimitPerMinute });
const sessionLimiter = createRateLimiter({ perMinute: config.sessionRateLimitPerMinute });

const health = async ctx => ({
  status: 200,
  body: ok({ status: "ok", uptime: Math.round(process.uptime()) }, ctx.requestId)
});

const router = createRouter();
router.get("/healthz", health, { auth: false });
registerSessionRoutes(router);
registerProjectRoutes(router);
registerEmailRoutes(router);
registerValidateRoutes(
  router,
  process.env.MIGMA_VALIDATE_PATH ? { path: process.env.MIGMA_VALIDATE_PATH } : undefined
);

// Why a session was refused is worth telling the client: "expired" means re-mint,
// "signature" means the proxy was repointed or the secret rotated. Neither reveals
// anything an attacker does not already hold.
const REFUSAL = {
  missing: "No proxy session was presented",
  malformed: "The proxy session is not readable",
  signature: "The proxy session was not issued by this proxy",
  expired: "The proxy session has expired"
};

async function handle(req, res, requestId, cors) {
  const url = new URL(req.url || "/", "http://proxy.invalid");
  const matched = router.match(req.method || "GET", url.pathname);

  if (matched === null) throw new HttpError(404, "No such route on this proxy");
  if (matched === "method") {
    const allow = [...router.allowed(url.pathname), "OPTIONS"].join(", ");
    throw new HttpError(405, `${req.method} is not allowed on this route`, {
      headers: { allow }
    });
  }

  const { route, params } = matched;

  let claims = null;
  if (route.auth) {
    const result = verify(req.headers["migma-session"], config.sessionSecret);
    if (!result.ok) throw new HttpError(401, REFUSAL[result.reason] || REFUSAL.missing);
    claims = result.claims;
    if (route.scope && !holds(claims, route.scope)) {
      throw new HttpError(403, "This session is not scoped for that call");
    }
  }

  // Authenticated traffic is limited per Spotify account, so one client stuck in a
  // retry loop cannot spend another listener's share. Unauthenticated /session is
  // limited per address, which is all there is to key on before a session exists,
  // and on a tighter bucket because each attempt costs a call to Spotify.
  const metered = route.pattern !== "/healthz";
  const bucket = claims ? limiter : sessionLimiter;
  const verdict = metered
    ? bucket.take(claims ? `sub:${claims.sub}` : `ip:${clientAddress(req, config.trustProxyHeaders)}`)
    : null;
  const rateHeaders = verdict ? bucket.headers(verdict) : {};

  if (verdict && !verdict.allowed) {
    throw new HttpError(429, "Too many requests to this proxy", {
      retryAfter: verdict.retryAfter,
      headers: { ...rateHeaders, "retry-after": String(verdict.retryAfter) }
    });
  }

  // Read once and memoised: a handler that inspects the body twice would find the
  // stream already consumed on the second read.
  let cached;
  const ctx = {
    req,
    url,
    params,
    requestId,
    config,
    logger,
    migma,
    spotify,
    query: url.searchParams,
    session: claims,
    address: clientAddress(req, config.trustProxyHeaders),
    body: async () => {
      if (cached === undefined) cached = await readJson(req, config.maxBodyBytes);
      return cached;
    }
  };

  const out = await route.handler(ctx);
  send(res, out.status || 200, out.body, {
    ...cors,
    ...rateHeaders,
    ...(out.headers || {}),
    "x-request-id": requestId
  });
}

const server = http.createServer(async (req, res) => {
  const requestId = newRequestId();
  const origin = req.headers.origin;
  const cors = corsHeaders(origin, config.allowedOrigins);

  // An origin off the allowlist is refused before routing and without CORS headers,
  // so the browser reports it as blocked rather than handing the page a 403 body to
  // read. A caller with no Origin at all -- curl, a health checker -- is not a
  // browser and is left alone.
  if (cors === null) {
    logger.warn("cors.refused", { origin, requestId });
    return send(res, 403, fail("This origin is not permitted", requestId), {
      "x-request-id": requestId
    });
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204, { ...cors, "content-length": "0" });
    return res.end();
  }

  try {
    await handle(req, res, requestId, cors);
  } catch (error) {
    if (error instanceof HttpError) {
      const body = fail(error.message, requestId);
      // Mirrors how Migma reports a wait, so the client's existing backoff reads it
      // without a second code path.
      if (error.extra.retryAfter) body.retryAfter = error.extra.retryAfter;
      const headers = { ...cors, ...(error.extra.headers || {}), "x-request-id": requestId };
      if (error.extra.retryAfter && !headers["retry-after"]) {
        headers["retry-after"] = String(error.extra.retryAfter);
      }
      return send(res, error.status, body, headers);
    }
    // An unexpected fault tells the client only that it happened and which request
    // it was. The detail goes to the log, where redaction has already run.
    logger.error("request.failed", {
      requestId,
      method: req.method,
      name: error.name,
      message: error.message,
      stack: error.stack
    });
    send(res, 500, fail("The proxy failed to handle this request", requestId), {
      ...cors,
      "x-request-id": requestId
    });
  }
});

// Above the brand-import ceiling of 90s, so the one long route is not cut off by
// the socket while it is still legitimately waiting on upstream.
server.requestTimeout = 120000;
server.headersTimeout = 20000;
server.keepAliveTimeout = 15000;

server.listen(config.port, config.host, () => {
  logger.info("proxy.listening", {
    host: config.host,
    port: config.port,
    origins: config.allowedOrigins,
    upstream: config.baseUrl,
    // The mode, never any part of the key itself.
    keyMode: config.apiKey.startsWith("sk_live_") ? "live" : "test",
    sessionTtlSeconds: config.sessionTtlSeconds,
    spotifyAllowlist: config.allowedSpotifyUsers.length || "any",
    routes: router.routes.length
  });
});

let closing = false;
const shutdown = signal => {
  if (closing) return;
  closing = true;
  logger.info("proxy.stopping", { signal });
  limiter.stop();
  sessionLimiter.stop();
  server.close(() => process.exit(0));
  // Without this an idle keep-alive socket holds close() open and every rollout
  // waits out the guard below. In-flight requests are not touched.
  server.closeIdleConnections?.();
  // A request still waiting on upstream must not hold a rollout open indefinitely.
  setTimeout(() => process.exit(1), 15000).unref();
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", reason => {
  logger.error("unhandledRejection", { message: String(reason && reason.message) || String(reason) });
});

export { config, router, server };
