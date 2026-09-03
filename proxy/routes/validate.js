/**
 * Deliverability validation.
 *
 * What this forecasts is inbox placement -- whether a message lands in the inbox
 * rather than a spam folder. It is not a conversion estimate, and the two are worth
 * keeping apart when a surface reports a number to a user.
 *
 * The upstream path and body here are the one part of this bridge taken from a
 * summary rather than read off the reference. Confirm both against
 * https://docs.migma.ai/api-reference/introduction before relying on this route;
 * MIGMA_VALIDATE_PATH exists so a correction is a config change, not a patch.
 */

import { badRequest } from "../lib/http.js";
import { SCOPES } from "../lib/session.js";
import { requireId, requireString } from "../lib/guard.js";

const DEFAULT_PATH = "/validate/deliverability";
const MAX_HTML = 512000;

export function registerValidateRoutes(router, { path = DEFAULT_PATH } = {}) {
  router.post(
    "/v1/validate/deliverability",
    async ctx => {
      const body = await ctx.body();
      const payload = {};

      // Either an already-generated email by id, or raw markup. One of the two has
      // to be present, or there is nothing to score.
      if (body.emailId !== undefined) payload.emailId = requireId(body.emailId, "emailId");
      if (body.html !== undefined) {
        payload.html = requireString(body.html, "html", { min: 1, max: MAX_HTML, trim: false });
      }
      if (payload.emailId === undefined && payload.html === undefined) {
        throw badRequest("Either emailId or html is required");
      }
      if (body.subject !== undefined) {
        payload.subject = requireString(body.subject, "subject", { max: 998 });
      }
      if (body.projectId !== undefined) {
        payload.projectId = requireId(body.projectId, "projectId");
      }

      ctx.logger.info("validate.deliverability", {
        subject: ctx.session.sub,
        byId: payload.emailId !== undefined,
        htmlChars: payload.html ? payload.html.length : 0,
        requestId: ctx.requestId
      });

      return ctx.migma({
        method: "POST",
        path,
        body: payload,
        requestId: ctx.requestId,
        projectScoped: payload.projectId !== undefined
      });
    },
    { scope: SCOPES.VALIDATE_READ }
  );
}

export { DEFAULT_PATH, MAX_HTML };
