/**
 * Configuration, read once at boot and validated before the socket is opened.
 *
 * A misconfigured proxy should fail to start rather than start and leak: an empty
 * MIGMA_API_KEY would otherwise mean every upstream call goes out unauthenticated,
 * and a short SESSION_SECRET means forgeable sessions.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseOrigins } from "./cors.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function loadDotenv(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const split = line.indexOf("=");
    if (split < 1) continue;
    const key = line.slice(0, split).trim();
    let value = line.slice(split + 1).trim();
    if (/^".*"$/s.test(value) || /^'.*'$/s.test(value)) value = value.slice(1, -1);
    // Process environment wins, so a platform secret store overrides the file.
    if (!(key in process.env)) process.env[key] = value;
  }
}

const integer = (name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
};

const flag = (name, fallback = false) => {
  const raw = String(process.env[name] ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  return raw === "1" || raw === "true" || raw === "yes";
};

const list = name =>
  String(process.env[name] || "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);

export function loadConfig({ envFile = path.join(ROOT, ".env") } = {}) {
  loadDotenv(envFile);

  const problems = [];

  const apiKey = String(process.env.MIGMA_API_KEY || "").trim();
  if (!apiKey) problems.push("MIGMA_API_KEY is required");
  else if (!/^sk_(live|test)_.+/.test(apiKey)) {
    problems.push("MIGMA_API_KEY must begin with sk_live_ or sk_test_");
  } else if (apiKey === "sk_test_replace_me") {
    problems.push("MIGMA_API_KEY is still the placeholder from .env.example");
  }

  const sessionSecret = String(process.env.SESSION_SECRET || "");
  if (!sessionSecret) problems.push("SESSION_SECRET is required");
  else if (sessionSecret.length < 32) {
    problems.push("SESSION_SECRET must be at least 32 characters (openssl rand -hex 32)");
  }

  const origins = parseOrigins(process.env.ALLOWED_ORIGINS || "https://xpui.app.spotify.com");
  if (!origins.length) problems.push("ALLOWED_ORIGINS must list at least one origin");

  let baseUrl = String(process.env.MIGMA_BASE_URL || "https://api.migma.ai/v1").trim();
  baseUrl = baseUrl.replace(/\/+$/, "");
  try {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== "https:") problems.push("MIGMA_BASE_URL must be https");
  } catch {
    problems.push("MIGMA_BASE_URL is not a valid URL");
  }

  let numbers = {};
  try {
    numbers = {
      port: integer("PORT", 8788, { min: 1, max: 65535 }),
      sessionTtlSeconds: integer("SESSION_TTL_SECONDS", 900, { min: 60, max: 86400 }),
      upstreamTimeoutMs: integer("UPSTREAM_TIMEOUT_MS", 30000, { min: 1000, max: 120000 }),
      spotifyTimeoutMs: integer("SPOTIFY_TIMEOUT_MS", 5000, { min: 500, max: 30000 }),
      maxBodyBytes: integer("MAX_BODY_BYTES", 131072, { min: 1024, max: 5242880 }),
      rateLimitPerMinute: integer("RATE_LIMIT_PER_MINUTE", 120, { min: 1, max: 100000 }),
      sessionRateLimitPerMinute: integer("SESSION_RATE_LIMIT_PER_MINUTE", 10, { min: 1, max: 10000 })
    };
  } catch (error) {
    problems.push(error.message);
  }

  if (problems.length) {
    const error = new Error(`Configuration is incomplete:\n  - ${problems.join("\n  - ")}`);
    error.problems = problems;
    throw error;
  }

  return Object.freeze({
    ...numbers,
    host: String(process.env.HOST || "127.0.0.1").trim(),
    apiKey,
    baseUrl,
    sessionSecret,
    allowedOrigins: Object.freeze(origins),
    allowedSpotifyUsers: Object.freeze(list("ALLOWED_SPOTIFY_USERS")),
    logLevel: String(process.env.LOG_LEVEL || "info").trim(),
    trustProxyHeaders: flag("TRUST_PROXY_HEADERS", false)
  });
}
