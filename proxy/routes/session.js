import { HttpError, badRequest, ok } from "../lib/http.js";
import { PLUGIN_SCOPES, mint } from "../lib/session.js";
import { requireString } from "../lib/guard.js";

const bearer = header => {
  const match = /^Bearer\s+(.+)$/i.exec(String(header || "").trim());
  return match ? match[1].trim() : "";
};

export function registerSessionRoutes(router) {
  router.post(
    "/session",
    async ctx => {
      const body = await ctx.body();
      const presented =
        body.spotify_token ||
        body.spotifyToken ||
        bearer(ctx.req.headers.authorization) ||
        "";

      if (!presented) throw badRequest("A Spotify session token is required");
      const client = body.client ? requireString(body.client, "client", { max: 64 }) : "unknown";

      const verdict = await ctx.spotify(String(presented));
      if (!verdict.ok) {
        ctx.logger.info("session.refused", { status: verdict.status, client });
        throw new HttpError(
          verdict.status,
          verdict.error,
          verdict.retryAfter ? { retryAfter: verdict.retryAfter } : {}
        );
      }

      // A single-tenant deployment sets ALLOWED_SPOTIFY_USERS.
      const allowlist = ctx.config.allowedSpotifyUsers;
      if (allowlist.length && !allowlist.includes(verdict.user.id)) {
        ctx.logger.warn("session.notAllowlisted", { subject: verdict.user.id, client });
        throw new HttpError(403, "This Spotify account is not permitted to use this proxy");
      }

      const minted = mint({
        subject: verdict.user.id,
        scopes: PLUGIN_SCOPES,
        ttlSeconds: ctx.config.sessionTtlSeconds,
        secret: ctx.config.sessionSecret
      });

      ctx.logger.info("session.minted", {
        subject: minted.subject,
        jti: minted.jti,
        expiresAt: minted.expiresAt,
        client
      });

      return {
        status: 200,
        body: ok(
          {
            token: minted.token,
            token_type: "Migma-Session",
            expires_in: minted.expiresIn,
            expires_at: minted.expiresAt,
            scopes: minted.scopes
          },
          ctx.requestId
        )
      };
    },
    { auth: false }
  );
}
