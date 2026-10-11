// Demo mode: a canned campaign email per type, returned instead of calling api.migma.ai.
// Off by default; the generate and status routes only reach this when config.demoMode is on.

const NOTE = "Simulated locally - pending Migma API access";
const JOBS = new Map();

// The campaign type is a client concept, so the proxy infers it from the brief the client sends.
function detectType(prompt) {
  const p = String(prompt || "").toLowerCase();
  if (p.includes("pitch email")) return "pitch";
  if (p.includes("fan announcement")) return "artist";
  if (p.includes("live-show announcement") || p.includes("show announcement")) return "show";
  if (p.includes("digest")) return "label";
  return "playlist";
}

function shell(subject, inner) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${subject}</title></head>
<body style="margin:0;background:#f4f4f5;font-family:Helvetica,Arial,sans-serif">
<div style="background:#fff3cd;color:#664d03;padding:8px 12px;font:600 12px Helvetica,Arial,sans-serif;text-align:center">${NOTE}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5"><tr><td align="center" style="padding:28px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px">
<tr><td style="padding:30px 32px;color:#18181b;font:400 15px/1.65 Helvetica,Arial,sans-serif">${inner}
<p style="text-align:center;margin:26px 0 4px"><a href="{{cta_url}}" style="display:inline-block;background:#1d1e20;color:#ffffff;text-decoration:none;padding:13px 28px;border-radius:8px;font-weight:700">Listen now</a></p></td></tr>
<tr><td style="padding:18px 32px;background:#f8f8fa;border-top:1px solid #e4e4e7;border-radius:0 0 14px 14px;font:400 11px/1.6 Helvetica,Arial,sans-serif;color:#71717a;text-align:center">Sent via Migma &middot; <a href="{{unsubscribe_url}}" style="color:#71717a">Unsubscribe</a></td></tr>
</table></td></tr></table></body></html>`;
}

const EMAILS = {
  playlist: {
    subject: "128 tracks for the hours that don't count",
    inner:
      "<p>Hi,</p><p>Your playlist <b>Late Night Static</b> has quietly become a place people live in after midnight: 128 tracks, mostly night-leaning indie and shoegaze, built to run long.</p><p>We pulled it into an email so the people who already love it hear the next drop first.</p>"
  },
  artist: {
    subject: "New one's out: Midnight Static",
    inner:
      "<p>Hey,</p><p><b>Midnight Static</b> is live everywhere you listen, and you're hearing it first because you've been around a while.</p><p>Three minutes, loud and blurry, right where the last record left off. Put it on, tell someone.</p>"
  },
  pitch: {
    subject: "Glass Harbor for Fresh Finds Indie?",
    inner:
      "<p>Hi,</p><p>Reaching out about <b>Fresh Finds Indie</b>, I think my track <b>Glass Harbor</b> would sit naturally next to things like Paper Lungs and Slow Tide.</p><p>Dream-pop, mixed warm, three and a half minutes. One link below, no pressure, and thanks for building the playlist either way.</p>"
  },
  show: {
    subject: "We're coming to you this autumn",
    inner:
      "<p>A short run of dates:</p><ul><li>Berlin, Berghain, Nov 2</li><li>Paris, La Cigale, Nov 5</li></ul><p>Tickets below, nearest city first. Doors are early, come say hi.</p>"
  },
  label: {
    subject: "New this week on the roster",
    inner:
      "<p>Two fresh releases from the last seven days:</p><ul><li><b>Glass Harbor</b>, Veil</li><li><b>Nightbus</b>, Hale</li></ul><p>Links below, more soon.</p>"
  }
};

function emailFor(type) {
  const e = EMAILS[type] || EMAILS.playlist;
  return { subject: e.subject, html: shell(e.subject, e.inner) };
}

function start(prompt, languages) {
  const id = "demo-" + Math.random().toString(36).slice(2, 10);
  const langs = Array.isArray(languages) && languages.length ? languages : ["en"];
  JOBS.set(id, { at: Date.now(), type: detectType(prompt), languages: langs });
  for (const [k, v] of JOBS) if (Date.now() - v.at > 600000) JOBS.delete(k);
  return id;
}

// Pending until the configured delay has passed, then completed with one email per language.
function status(id, delayMs = 3000, now = Date.now()) {
  const job = JOBS.get(id);
  if (!job) return { status: "failed", error: "unknown demo job" };
  if (now - job.at < delayMs) return { status: "pending" };
  const { subject, html } = emailFor(job.type);
  const emails = job.languages.map((lang, i) => ({
    emailId: `${id}-${i}`,
    language: lang,
    subject,
    html,
    screenshotUrl: ""
  }));
  return { status: "completed", result: { emails } };
}

export { NOTE, detectType, emailFor, start, status };

