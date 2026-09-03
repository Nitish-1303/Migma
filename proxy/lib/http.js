/**
 * Wire format. Both directions speak Migma's envelope, so the client parses one
 * shape whether a reply came from Migma, from this proxy, or from a rejection
 * that never reached the network.
 */

import { randomUUID } from "node:crypto";

export const newRequestId = () => randomUUID();

const metadata = requestId => ({ timestamp: new Date().toISOString(), requestId });

export const ok = (data, requestId) => ({ success: true, data, metadata: metadata(requestId) });

export const fail = (error, requestId) => ({
  success: false,
  error: String(error),
  metadata: metadata(requestId)
});

/** An error carrying the status to answer with, so handlers can throw and stop. */
export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.extra = extra;
  }
}

export const badRequest = message => new HttpError(400, message);
export const unauthorized = message => new HttpError(401, message);
export const forbidden = message => new HttpError(403, message);

const SECURITY_HEADERS = {
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "cross-origin-resource-policy": "same-site",
  // Nothing here renders markup, so the strictest policy is also the correct one.
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'"
};

export function send(res, status, body, headers = {}) {
  if (res.writableEnded) return;
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(payload.length),
    ...SECURITY_HEADERS,
    ...headers
  });
  res.end(payload);
}

export const sendOk = (res, data, requestId, headers) =>
  send(res, 200, ok(data, requestId), { "x-request-id": requestId, ...headers });

export const sendFail = (res, status, message, requestId, headers) =>
  send(res, status, fail(message, requestId), { "x-request-id": requestId, ...headers });

/**
 * Reads a JSON object body under a byte cap, counting as it goes rather than
 * trusting Content-Length, which a caller controls.
 */
export async function readJson(req, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new HttpError(413, "Request body is too large");
    chunks.push(chunk);
  }
  if (!size) return {};
  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw badRequest("Request body is not valid JSON");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw badRequest("Request body must be a JSON object");
  }
  return parsed;
}

/**
 * The address used for rate limiting. X-Forwarded-For is only read when the
 * deployment says a proxy it controls sets it, because a caller can otherwise
 * forge a fresh identity per request and the limit stops meaning anything.
 */
export function clientAddress(req, trustProxyHeaders) {
  if (trustProxyHeaders) {
    const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    if (forwarded) return forwarded;
  }
  return req.socket?.remoteAddress || "unknown";
}
