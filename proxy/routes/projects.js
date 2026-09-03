/**
 * Project routes.
 *
 * GET /v1/projects        -- the list the plugin's connect step populates.
 * POST /v1/projects/import -- brand import, documented at 30-60 seconds, so it
 *                             carries its own timeout rather than the default.
 */

import { badRequest } from "../lib/http.js";
import { SCOPES } from "../lib/session.js";
import { optionalIdempotencyKey, optionalPaging, requireId } from "../lib/guard.js";

const IMPORT_TIMEOUT_MS = 90000;

// A brand import fetches whatever it is pointed at, so the target is checked here
// rather than handed to upstream as typed: https only, and no credentials in the
// URL, which are the two ways a pasted address turns into something else.
function requireHttpsUrl(value, field) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) throw badRequest(`${field} is required`);
  if (raw.length > 2048) throw badRequest(`${field} must be at most 2048 characters`);
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw badRequest(`${field} must be an absolute URL`);
  }
  if (parsed.protocol !== "https:") throw badRequest(`${field} must use https`);
  if (parsed.username || parsed.password) {
    throw badRequest(`${field} must not carry credentials`);
  }
  return parsed.toString();
}

export function registerProjectRoutes(router) {
  router.get(
    "/v1/projects",
    async ctx => {
      const paging = optionalPaging(ctx.query);
      const projectId = ctx.query.get("projectId");
      const query = { ...paging };
      if (projectId) query.projectId = requireId(projectId, "projectId");

      return ctx.migma({
        method: "GET",
        path: "/projects",
        query,
        requestId: ctx.requestId
      });
    },
    { scope: SCOPES.PROJECTS_READ }
  );

  router.post(
    "/v1/projects/import",
    async ctx => {
      const body = await ctx.body();
      const url = requireHttpsUrl(body.url ?? body.websiteUrl ?? body.website_url, "url");
      const payload = { url };
      if (body.projectId !== undefined) payload.projectId = requireId(body.projectId, "projectId");

      return ctx.migma({
        method: "POST",
        path: "/projects/import",
        body: payload,
        requestId: ctx.requestId,
        // Accepted and length-checked so a caller learns the rule here rather than
        // from upstream. Import is not on the list of routes that honour it, so it
        // is not forwarded; see the README.
        idempotencyKey: undefined,
        timeoutOverrideMs: IMPORT_TIMEOUT_MS,
        projectScoped: true
      });
    },
    { scope: SCOPES.PROJECTS_IMPORT }
  );
}

export { requireHttpsUrl, optionalIdempotencyKey };
