/**
 * Email generation, as an asynchronous job.
 *
 * Migma publishes no streaming endpoint for this: generate starts a job and
 * answers { conversationId, status: "pending" }, and the caller polls the status
 * route until it reads "completed", at which point data.result.emails[] carries
 * { emailId, subject, html, screenshotUrl } per language.
 *
 * No polling interval is published. This proxy therefore sets none -- it reports
 * upstream's status verbatim and lets the client pace itself, because inventing a
 * cadence here would hide the fact that nobody has committed to one.
 */

import { SCOPES } from "../lib/session.js";
import {
  MAX_PROMPT,
  optionalLocales,
  requireId,
  requireString
} from "../lib/guard.js";

// Constrains the path parameter at the router, so a value that could traverse into
// another upstream path never reaches a handler or a URL.
const CONVERSATION_ID = /^[A-Za-z0-9_-]{1,128}$/;

export function registerEmailRoutes(router) {
  router.post(
    "/v1/projects/emails/generate",
    async ctx => {
      const body = await ctx.body();
      const payload = {
        projectId: requireId(body.projectId, "projectId"),
        prompt: requireString(body.prompt, "prompt", { min: 1, max: MAX_PROMPT })
      };
      const languages = optionalLocales(body.languages, "languages");
      if (languages && languages.length) payload.languages = languages;

      ctx.logger.info("emails.generate", {
        subject: ctx.session.sub,
        projectId: payload.projectId,
        promptChars: payload.prompt.length,
        languages: languages ? languages.length : 0,
        requestId: ctx.requestId
      });

      return ctx.migma({
        method: "POST",
        path: "/projects/emails/generate",
        body: payload,
        requestId: ctx.requestId,
        projectScoped: true
      });
    },
    { scope: SCOPES.EMAILS_GENERATE }
  );

  router.get(
    "/v1/projects/emails/:conversationId/status",
    async ctx => {
      const query = {};
      const projectId = ctx.query.get("projectId");
      if (projectId) query.projectId = requireId(projectId, "projectId");

      return ctx.migma({
        method: "GET",
        path: `/projects/emails/${encodeURIComponent(ctx.params.conversationId)}/status`,
        query,
        requestId: ctx.requestId,
        projectScoped: true
      });
    },
    {
      scope: SCOPES.EMAILS_READ,
      params: { conversationId: CONVERSATION_ID }
    }
  );
}
