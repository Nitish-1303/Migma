/**
 * Input guards.
 *
 * Everything here crosses a trust boundary twice: it arrives from a browser and
 * is then spliced into an upstream URL or body. A conversationId that is not
 * checked against a charset is a path traversal into api.migma.ai, and a prompt
 * with no ceiling is an unbounded upstream bill.
 */

import { badRequest } from "./http.js";

// Opaque upstream identifiers. Deliberately no dot and no slash.
const ID = /^[A-Za-z0-9_-]{1,128}$/;

// BCP-47 shaped, which is what the generate route's languages[] carries.
const LOCALE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/;

export const MAX_PROMPT = 8000;
export const MAX_LANGUAGES = 12;

export function requireId(value, field) {
  if (typeof value !== "string" || !ID.test(value)) {
    throw badRequest(`${field} must be 1-128 characters of letters, digits, hyphen or underscore`);
  }
  return value;
}

export function requireString(value, field, { min = 1, max = 512, trim = true } = {}) {
  if (typeof value !== "string") throw badRequest(`${field} must be a string`);
  const out = trim ? value.trim() : value;
  if (out.length < min) throw badRequest(`${field} must be at least ${min} characters`);
  if (out.length > max) throw badRequest(`${field} must be at most ${max} characters`);
  return out;
}

export function optionalLocales(value, field) {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw badRequest(`${field} must be an array`);
  if (value.length > MAX_LANGUAGES) {
    throw badRequest(`${field} may name at most ${MAX_LANGUAGES} languages`);
  }
  const seen = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !LOCALE.test(entry.trim())) {
      throw badRequest(`${field} entries must be language tags such as "en" or "pt-BR"`);
    }
    const tag = entry.trim();
    if (!seen.includes(tag)) seen.push(tag);
  }
  return seen;
}

/**
 * Upstream caps Idempotency-Key at 100 characters and answers 400 above it, so
 * the same answer is given here rather than spending a round trip to learn it.
 */
export function optionalIdempotencyKey(headers) {
  const raw = headers["idempotency-key"];
  if (raw === undefined) return undefined;
  const value = String(Array.isArray(raw) ? raw[0] : raw).trim();
  if (!value) return undefined;
  if (value.length > 100) throw badRequest("Idempotency-Key must be at most 100 characters");
  return value;
}

/**
 * Pagination, echoed upstream. Bounded here so a caller cannot ask for a page
 * large enough to make one request expensive for everyone behind this instance.
 */
export function optionalPaging(query) {
  const out = {};
  for (const field of ["limit", "offset"]) {
    const raw = query.get(field);
    if (raw === null || raw === "") continue;
    const value = Number(raw);
    const max = field === "limit" ? 100 : 100000;
    if (!Number.isInteger(value) || value < 0 || value > max) {
      throw badRequest(`${field} must be an integer between 0 and ${max}`);
    }
    out[field] = value;
  }
  return out;
}
