import assert from "node:assert/strict";
import test, { after } from "node:test";
import { once } from "node:events";
import * as demo from "../lib/demo.js";

test("detectType maps a brief to its campaign type", () => {
  assert.equal(demo.detectType("Write a direct pitch email from the artist to the curator"), "pitch");
  assert.equal(demo.detectType("Write a warm fan announcement email from the artist"), "artist");
  assert.equal(demo.detectType("Write a live-show announcement email to their fans"), "show");
  assert.equal(demo.detectType("Write a weekly new-release digest email from the label"), "label");
  assert.equal(demo.detectType("Write a campaign email for the Spotify playlist"), "playlist");
});

test("demo email carries the simulated note", () => {
  const { subject, html } = demo.emailFor("playlist");
  assert.ok(subject.length > 0);
  assert.ok(html.includes(demo.NOTE));
  assert.ok(html.includes("{{unsubscribe_url}}"));
});

test("pending before the delay, completed after", () => {
  const id = demo.start("Write a fan announcement email", ["en", "es"]);
  assert.equal(demo.status(id, 3000, Date.now()).status, "pending");
  const done = demo.status(id, 3000, Date.now() + 4000);
  assert.equal(done.status, "completed");
  assert.equal(done.result.emails.length, 2);
  assert.ok(done.result.emails[0].html.includes(demo.NOTE));
  assert.equal(done.result.emails[1].language, "es");
});

process.env.MIGMA_API_KEY = "sk_test_demo_only";
process.env.SESSION_SECRET = "s".repeat(64);
process.env.ALLOWED_ORIGINS = "https://xpui.app.spotify.com";
process.env.PORT = "8792";
process.env.HOST = "127.0.0.1";
process.env.DEMO_MODE = "1";
process.env.DEMO_DELAY_MS = "0";
process.env.LOG_LEVEL = "error";

const { server } = await import("../server.js");
const { PLUGIN_SCOPES, mint } = await import("../lib/session.js");
if (!server.listening) await once(server, "listening");
const base = `http://127.0.0.1:${server.address().port}`;
const ORIGIN = "https://xpui.app.spotify.com";
const token = mint({ subject: "listener-1", scopes: PLUGIN_SCOPES, ttlSeconds: 900, secret: process.env.SESSION_SECRET }).token;

after(() => server.close());

test("demo mode generates a canned email end to end, no upstream", async () => {
  const gen = await fetch(`${base}/v1/projects/emails/generate`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json", "migma-session": token },
    body: JSON.stringify({ projectId: "p1", prompt: "Write a pitch email from the artist to the curator", languages: ["en"] })
  });
  assert.equal(gen.status, 200);
  const gj = await gen.json();
  assert.equal(gj.success, true);
  const id = gj.data.conversationId;
  assert.ok(id.startsWith("demo-"));
  assert.equal(gj.data.status, "pending");

  const st = await fetch(`${base}/v1/projects/emails/${id}/status`, {
    headers: { origin: ORIGIN, "migma-session": token }
  });
  assert.equal(st.status, 200);
  const sj = await st.json();
  assert.equal(sj.data.status, "completed");
  const email = sj.data.result.emails[0];
  assert.ok(email.html.includes("Simulated locally"));
  assert.ok(email.subject.length > 0);
});

