/**
 * Line-delimited JSON logging with redaction applied on the way out.
 *
 * A proxy whose whole purpose is holding a secret must not be the thing that
 * prints it, so redaction runs over the serialised line rather than over fields
 * chosen by hand: a key that reaches a log by an unexpected path is still caught.
 */

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

const PATTERNS = [
  // Migma keys, both prefixes.
  /sk_(?:live|test)_[A-Za-z0-9]+/g,
  // Any bearer credential, ours or Spotify's.
  /Bearer\s+[A-Za-z0-9._~+/-]+=*/gi,
  // Sessions this proxy mints.
  /\bms1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  // JWT-shaped values, which is what a Spotify access token looks like.
  /\b[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{8,}\b/g
];

export function redact(text) {
  let out = text;
  for (const pattern of PATTERNS) out = out.replace(pattern, "[redacted]");
  return out;
}

export function createLogger(level = "info") {
  const threshold = LEVELS[level] ?? LEVELS.info;

  const emit = name => (msg, fields) => {
    if (LEVELS[name] > threshold) return;
    let line;
    try {
      line = JSON.stringify({ ts: new Date().toISOString(), level: name, msg, ...fields });
    } catch {
      // A field carrying a cycle must not take the process down mid-request.
      line = JSON.stringify({ ts: new Date().toISOString(), level: name, msg });
    }
    const stream = LEVELS[name] <= LEVELS.warn ? process.stderr : process.stdout;
    stream.write(redact(line) + "\n");
  };

  return {
    level,
    error: emit("error"),
    warn: emit("warn"),
    info: emit("info"),
    debug: emit("debug")
  };
}
