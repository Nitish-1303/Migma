/**
 * Spotify session validation.
 *
 * The plugin does not ask for a scope and does not start an OAuth flow: it hands
 * over the token the desktop client is already using for its own reads, and this
 * is the check that the token is real and whose it is. GET /v1/me needs no scope,
 * which is why it is the right probe -- a 200 means Spotify authenticated the
 * caller, and the id in the reply is the subject of the session that follows.
 */

const ME = "https://api.spotify.com/v1/me";

// Spotify access tokens are long and opaque. A value outside these bounds cannot
// be one, so it is refused without spending an upstream call on it.
const PLAUSIBLE = /^[A-Za-z0-9._~+/=-]{40,4096}$/;

export function createSpotifyValidator({ timeoutMs, logger }) {
  return async function validate(token) {
    if (typeof token !== "string" || !PLAUSIBLE.test(token)) {
      return { ok: false, status: 401, error: "No usable Spotify session was presented" };
    }

    let res;
    try {
      res = await fetch(ME, {
        headers: { authorization: `Bearer ${token}`, accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      const timedOut = error.name === "TimeoutError" || error.name === "AbortError";
      logger.warn("spotify.unreachable", { reason: error.name });
      return {
        ok: false,
        status: 504,
        error: timedOut
          ? "Spotify did not answer in time"
          : "Spotify could not be reached to confirm this session"
      };
    }

    if (res.status === 401) {
      return { ok: false, status: 401, error: "Spotify rejected this session" };
    }
    if (res.status === 403) {
      return { ok: false, status: 403, error: "Spotify refused this session" };
    }
    if (res.status === 429) {
      const after = Number(res.headers.get("retry-after")) || 5;
      return { ok: false, status: 429, error: "Spotify is rate limiting this proxy", retryAfter: after };
    }
    if (!res.ok) {
      logger.warn("spotify.unexpected", { status: res.status });
      return { ok: false, status: 502, error: "Spotify could not confirm this session" };
    }

    let profile;
    try {
      profile = await res.json();
    } catch {
      return { ok: false, status: 502, error: "Spotify returned an unreadable profile" };
    }
    if (!profile || typeof profile.id !== "string" || !profile.id) {
      return { ok: false, status: 502, error: "Spotify returned a profile without an id" };
    }

    // Only the id is kept. Display name, email and images are not this proxy's
    // business and would turn a log line into personal data.
    return {
      ok: true,
      user: {
        id: profile.id,
        product: typeof profile.product === "string" ? profile.product : null,
        country: typeof profile.country === "string" ? profile.country : null
      }
    };
  };
}
