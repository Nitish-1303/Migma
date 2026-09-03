/**
 * The upstream client. The only place in this service that sets an Authorization
 * header, and the only place the Migma key is read.
 *
 * Nothing from the inbound request is forwarded except a validated path, query and
 * body: no client header reaches api.migma.ai, so a caller cannot smuggle its own
 * Authorization, cookie or tracing header through this hop.
 */

import { fail, ok } from "./http.js";

const USER_AGENT = "migma-spotify-proxy (+bff)";

// Passed back to the client so its retry logic has something to read. Nothing
// else from upstream is relayed: a header this proxy does not recognise stays here.
const RELAYED = [
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
  "retry-after",
  "idempotent-replayed"
];

const relayHeaders = source => {
  const out = {};
  for (const name of RELAYED) {
    const value = source.get(name);
    if (value !== null) out[name] = value;
  }
  return out;
};

const FALLBACK = {
  400: "Migma rejected the request",
  401: "The proxy's Migma credential was refused",
  403: "The proxy's Migma credential lacks the permission for this call",
  404: "Migma has no such resource",
  409: "Migma reported a conflict with an earlier request",
  429: "Migma is rate limiting this workspace"
};

export function createMigmaClient({ apiKey, baseUrl, timeoutMs, logger }) {
  /**
   * @returns {{status:number, body:object, headers:object}} an answer already in
   * the envelope the client parses, whatever shape upstream replied in.
   */
  return async function call({
    method = "GET",
    path,
    query,
    body,
    requestId,
    idempotencyKey,
    timeoutOverrideMs,
    projectScoped = false
  }) {
    const url = new URL(baseUrl + path);
    if (query) for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);

    const headers = {
      accept: "application/json",
      authorization: `Bearer ${apiKey}`,
      "user-agent": USER_AGENT
    };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;

    const started = Date.now();
    let res;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutOverrideMs || timeoutMs)
      });
    } catch (error) {
      const timedOut = error.name === "TimeoutError" || error.name === "AbortError";
      logger.warn("migma.unreachable", { path, reason: error.name, ms: Date.now() - started });
      return {
        status: timedOut ? 504 : 502,
        headers: {},
        body: fail(
          timedOut ? "Migma did not answer in time" : "Migma could not be reached",
          requestId
        )
      };
    }

    const relayed = relayHeaders(res.headers);
    const text = await res.text();
    let parsed = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }

    logger.debug("migma.call", {
      path,
      method,
      status: res.status,
      ms: Date.now() - started,
      requestId
    });

    if (res.ok && parsed && parsed.success === true) {
      // Upstream already speaks the envelope. Its requestId is the useful one, so
      // it is kept and only filled in when absent.
      const metadata = { timestamp: new Date().toISOString(), ...(parsed.metadata || {}) };
      if (!metadata.requestId) metadata.requestId = requestId;
      return { status: res.status, headers: relayed, body: { ...parsed, metadata } };
    }

    if (res.ok) {
      // A 2xx that is not the documented envelope is still a success; wrap it so
      // the client never has to branch on shape.
      return { status: res.status, headers: relayed, body: ok(parsed ?? {}, requestId) };
    }

    let message =
      (parsed && typeof parsed.error === "string" && parsed.error.trim()) ||
      (parsed && typeof parsed.message === "string" && parsed.message.trim()) ||
      FALLBACK[res.status] ||
      `Migma returned ${res.status}`;

    // Keys are account-wide, so asking for a project resource without a projectId
    // that the key can see answers 404 rather than 403. Saying so turns an hour of
    // guessing into a one-line fix.
    if (res.status === 404 && projectScoped) {
      message += ". Check that projectId names a project this workspace key can see";
    }

    const envelope = fail(message, (parsed && parsed.metadata && parsed.metadata.requestId) || requestId);
    if (res.status === 429) {
      const retryAfter = Number(parsed && (parsed.retryAfter || parsed.retry_after)) || undefined;
      if (retryAfter) envelope.retryAfter = retryAfter;
    }
    logger.warn("migma.error", { path, status: res.status, requestId });
    return { status: res.status, headers: relayed, body: envelope };
  };
}
