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

      // Either an already-generated email by id, or raw markup.
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
