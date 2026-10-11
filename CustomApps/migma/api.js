window.Migma = window.Migma || {};

Migma.api = (() => {
  // Every path the client asks for lives here, and every one of them is a route the proxy
  // actually serves. `session` is the proxy's own: it exchanges the Spotify session this client
  // already holds for a short-lived, scoped one. The rest map onto Migma's published API — the
  // project list, the brand import, and the asynchronous email-generation job with its status
  // route. Nothing here points at a path Migma does not document.
  const ENDPOINTS = {
    session: "/session",
    projects: "/v1/projects",
    import: "/v1/projects/import",
    generate: "/v1/projects/emails/generate",
    status: id => `/v1/projects/emails/${encodeURIComponent(id)}/status`
  };

  // Capabilities the plugin has a surface for but Migma publishes no endpoint for yet. The UI
  // reads this to render a plain "pending Migma API" state instead of calling a route that does
  // not exist. When Migma ships one it moves from here into ENDPOINTS and the surface lights up.
  const PENDING_MIGMA_API = Object.freeze({
    ideas: true, // suggested campaign angles for a playlist
    score: true, // conversion / deliverability scoring of a draft
    translate: true, // translating already-written copy on demand
    reviewers: true, // workspace reviewer assignment
    comments: true // collaboration threads on a draft
  });

  class ApiError extends Error {
    constructor(message, status = 0, requestId = "", retryAfter = 0) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.requestId = requestId;
      this.retryAfter = retryAfter;
    }
  }

  const abortError = signal =>
    (signal && signal.reason) || Object.assign(new Error("Aborted"), { name: "AbortError" });

  // A backoff that ignores the signal keeps a timer and a queued retry alive for the whole wait —
  // and a 429 wait is however long Migma's retry-after says. A cancelled request therefore stops
  // waiting the moment it is cancelled rather than at the end of the delay, and the abort listener
  // is removed on the normal path so it does not accumulate on a long-lived signal.
  const sleep = (ms, signal) =>
    new Promise((resolve, reject) => {
      if (signal && signal.aborted) {
        reject(abortError(signal));
        return;
      }
      const onAbort = () => {
        clearTimeout(id);
        reject(abortError(signal));
      };
      const id = setTimeout(() => {
        if (signal) signal.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      if (signal) signal.addEventListener("abort", onAbort, { once: true });
    });

  const sp = path => Spicetify.CosmosAsync.get("https://api.spotify.com/v1" + path);

  const PLAYLIST_FIELDS = "id,name,description,followers(total),images,owner(display_name),tracks(total)";
  const TRACK_FIELDS =
    "total,items(track(id,name,duration_ms,popularity,explicit,album(name,release_date,images),artists(id,name)))";

  function playlist(id) {
    return sp(`/playlists/${id}?fields=${encodeURIComponent(PLAYLIST_FIELDS)}`);
  }

  async function playlistTracks(id, onProgress) {
    const out = [];
    let offset = 0;
    let total = 0;
    do {
      const page = await sp(
        `/playlists/${id}/tracks?limit=100&offset=${offset}&fields=${encodeURIComponent(TRACK_FIELDS)}`
      );
      total = typeof page.total === "number" ? page.total : out.length;
      for (const item of page.items || []) {
        if (item && item.track && item.track.id) out.push(item.track);
      }
      offset += 100;
      if (onProgress) onProgress(out.length, total);
    } while (offset < total && offset < 1000);
    return out;
  }
  async function artists(ids) {
    const unique = [...new Set(ids)].filter(Boolean);
    const out = [];
    for (let i = 0; i < unique.length; i += 50) {
      const res = await sp(`/artists?ids=${unique.slice(i, i + 50).join(",")}`);
      out.push(...(res.artists || []).filter(Boolean));
    }
    return out;
  }

  async function myPlaylists() {
    const res = await sp("/me/playlists?limit=50");
    return (res.items || []).filter(p => p && p.id);
  }

  // A single track, for the artist-announcement source. Read-only through the client's own
  // session, like every other Spotify call here; the artist's genres come from a follow-up
  // artists() lookup since the track payload does not carry them.
  function track(id) {
    return sp(`/tracks/${id}`);
  }

  // An artist's releases, newest filtered client-side. Used by the label digest and the
  // new-release watch. include_groups keeps it to the artist's own singles and albums.
  async function artistAlbums(id) {
    const res = await sp(`/artists/${encodeURIComponent(id)}/albums?include_groups=single,album&limit=50`);
    return (res.items || []).filter(Boolean);
  }

  // A few track titles from a playlist, for the pitch brief's "already features…" line. One page,
  // names only — the pitch needs a sample, not the whole tracklist.
  async function playlistTitles(id, limit = 6) {
    const page = await sp(
      `/playlists/${encodeURIComponent(id)}/tracks?limit=30&fields=${encodeURIComponent("items(track(name))")}`
    );
    return (page.items || [])
      .map(i => i && i.track && i.track.name)
      .filter(Boolean)
      .slice(0, limit);
  }

  const CLIENT = "spicetify-migma";

  // The proxy holds the workspace key and signs with it, so nothing in this client ever handles one.
  // A session is minted by presenting the token the Spotify client is already using for its own
  // reads, is short-lived, and is therefore kept in memory rather than stored: a reload mints
  // another. It is keyed by the proxy that issued it, so repointing the plugin cannot reuse a token
  // the new proxy never granted.
  const SKEW = 30 * 1000;
  let session = null;

  const endSession = () => {
    session = null;
  };

  const proxyBase = () => {
    const url = String(Migma.store.get().proxyUrl || "").trim().replace(/\/+$/, "");
    if (!url) throw new ApiError("No Migma proxy is configured", 0);
    return url;
  };

  // Spicetify names the client's own token differently across releases, so each known shape is read
  // in turn and the first non-empty string wins. None of them prompts and none of them asks for a
  // scope: this is the session the user already has.
  function spotifyToken() {
    const platform = (window.Spicetify && Spicetify.Platform) || {};
    const auth = platform.AuthorizationAPI || {};
    const reads = [
      () => auth.getState && auth.getState().accessToken,
      () => auth._state && auth._state.accessToken,
      () => platform.Session && platform.Session.accessToken,
      () => platform.Session && platform.Session.access_token
    ];
    for (const read of reads) {
      let value = "";
      try {
        value = read();
      } catch (e) {
        value = "";
      }
      if (typeof value === "string" && value) return value;
    }
    return "";
  }
  // A body is what makes the content type meaningful, and declaring it on a bodyless read would
  // force a preflight that the read does not otherwise need.
  function headers(accept, token, hasBody) {
    const out = { Accept: accept, "X-Migma-Client": CLIENT };
    if (hasBody) out["Content-Type"] = "application/json";
    if (token) out["Migma-Session"] = token;
    return out;
  }

  // Migma answers a failure with `{success:false, error:"…"}` and carries the request id under
  // `metadata`, so a failed reply is read once, up front: the message, the id and the rate-limit
  // wait all come out of that single body. The header readings are fallbacks for whatever the proxy
  // decides to surface on its own behalf.
  async function failure(res) {
    let body = null;
    try {
      body = await res.json();
    } catch (e) {
      body = null;
    }
    const raw = body && body.error;
    const message =
      (typeof raw === "string" && raw.trim()) ||
      (raw && typeof raw.message === "string" && raw.message.trim()) ||
      (body && typeof body.message === "string" && body.message.trim()) ||
      (res.status === 401 || res.status === 403
        ? "The proxy refused this session"
        : `Migma returned ${res.status}`);
    const meta = (body && body.metadata) || {};
    // The reset is published as an epoch timestamp; a small number is a wait in seconds instead, so
    // both readings are accepted and the plausible one wins.
    const reset = Number(res.headers.get("x-ratelimit-reset")) || 0;
    const seconds =
      Number(body && (body.retryAfter || body.retry_after)) ||
      Number(res.headers.get("retry-after")) ||
      (reset > 1e6 ? Math.round(reset - Date.now() / 1000) : reset);
    return {
      message,
      requestId: meta.requestId || meta.request_id || res.headers.get("x-request-id") || "",
      retryAfter: seconds > 0 ? Math.min(Math.round(seconds), 120) : 0
    };
  }
  // The session is the proxy's own resource rather than a forwarded Migma one, so both a plain
  // object and the same envelope Migma uses are accepted. A floor under the lifetime keeps a proxy
  // that reports an implausibly short one from turning every call into two.
  async function authorize(signal) {
    const base = proxyBase();
    if (session && session.base === base && session.expires > Date.now() + SKEW) return session.token;
    session = null;

    const spotify = spotifyToken();
    if (!spotify) throw new ApiError("Spotify has not finished signing in yet", 0);

    const res = await request(ENDPOINTS.session, {
      method: "POST",
      signal,
      auth: false,
      retries: 1,
      body: { spotify_token: spotify, client: CLIENT }
    });
    const body = await res.json();
    const out = (body && body.data) || body || {};
    const token = [out.token, out.session_token, out.access_token].find(
      v => typeof v === "string" && v.trim()
    );
    if (!token) throw new ApiError("The proxy did not return a session", 502);
    const ttl = Number(out.expires_in || out.expiresIn) || 300;
    session = { base, token, expires: Date.now() + Math.max(SKEW * 2, ttl * 1000) };
    return token;
  }

  async function request(path, opts = {}) {
    const { method = "GET", body, signal, retries = 2, accept = "application/json", auth = true } = opts;
    const base = proxyBase();
    let attempt = 0;
    let reminted = false;

    for (;;) {
      const token = auth ? await authorize(signal) : "";
      let res;
      try {
        res = await fetch(base + path, {
          method,
          signal,
          headers: headers(accept, token, body !== undefined),
          body: body === undefined ? undefined : JSON.stringify(body)
        });
      } catch (err) {
        if (err.name === "AbortError") throw err;
        if (attempt++ < retries) {
          await sleep(400 * attempt, signal);
          continue;
        }
        throw new ApiError("Could not reach the Migma proxy", 0);
      }
      if (res.ok) return res;

      const fail = await failure(res);

      // A short-lived session reaching its end mid-call is how it is meant to expire rather than a
      // fault, so the first 401 mints another and repeats the call. A second means the proxy is
      // refusing the Spotify session itself, which no retry repairs.
      if (res.status === 401 && auth && !reminted) {
        reminted = true;
        endSession();
        continue;
      }

      if (res.status === 429) {
        const wait = fail.retryAfter > 0 ? fail.retryAfter * 1000 : 2000 * (attempt + 1);
        if (attempt++ < retries) {
          await sleep(wait, signal);
          continue;
        }
        throw new ApiError(fail.message, 429, fail.requestId, Math.round(wait / 1000));
      }

      if (res.status >= 500 && attempt++ < retries) {
        await sleep(500 * attempt, signal);
        continue;
      }

      throw new ApiError(fail.message, res.status, fail.requestId, fail.retryAfter);
    }
  }

  const json = async (path, opts) => (await request(path, opts)).json();

  async function projects(signal) {
    const data = await json(ENDPOINTS.projects, { signal });
    const list = data.projects || data.data || data.items || [];
    return list.map(p => ({ id: p.id, name: p.name || p.title || p.id }));
  }

  // Remote records are normalised through this rather than String(), so a field that arrives as an
  // object or a number never reaches the UI as "[object Object]".
  const str = (...values) => {
    for (const v of values) if (typeof v === "string" && v.trim()) return v.trim();
    return "";
  };

  // Only https links are surfaced from a generated email; a screenshot URL that is anything else
  // is dropped rather than offered as something to open.
  const httpsUrl = value => {
    const raw = String(value == null ? "" : value).trim();
    if (!raw) return "";
    try {
      const u = new URL(raw);
      return u.protocol === "https:" ? u.toString() : "";
    } catch (e) {
      return "";
    }
  };
  // Generation is an asynchronous job, not a stream: this starts it and hands back the id to
  // poll. languages[] is passed straight through — a completed job returns one email per language
  // — so a single generate covers every language the brief asked for.
  async function startGeneration(payload, signal) {
    const s = Migma.store.get();
    const body = { projectId: s.projectId, prompt: String(payload.prompt || "") };
    const languages = (payload.languages || [])
      .map(l => String(l || "").trim())
      .filter(Boolean)
      .slice(0, 12);
    if (languages.length) body.languages = languages;
    const data = await json(ENDPOINTS.generate, { method: "POST", signal, retries: 0, body });
    const out = (data && data.data) || data || {};
    const conversationId = str(out.conversationId, out.conversation_id, out.id);
    if (!conversationId) throw new ApiError("Migma did not start a generation job", 502);
    return { conversationId, status: str(out.status, out.state).toLowerCase() || "pending" };
  }

  // No polling interval is published, so the client paces itself: a short first wait growing
  // geometrically to a ceiling, under an overall budget. Cancellation runs through the same
  // signal-aware sleep as everything else, so leaving the step stops the poll at once.
  const POLL_START_MS = 1500;
  const POLL_GROWTH = 1.6;
  const POLL_CAP_MS = 8000;
  const POLL_BUDGET_MS = 180000;
  const DONE = ["completed", "complete", "succeeded", "success", "done", "ready"];
  const FAILED = ["failed", "error", "errored", "cancelled", "canceled", "rejected"];

  // The emails a completed job carries, each normalised to what the preview and the export read.
  // The raw html is kept verbatim for copy and download but is never handed to the DOM — the
  // preview renders a plain-text reading of it instead.
  function normEmails(result) {
    const list =
      (result && (result.emails || (result.result && result.result.emails) || result.data)) || [];
    return (Array.isArray(list) ? list : [])
      .map((e, i) => ({
        emailId: str(e && e.emailId, e && e.id, e && e.email_id) || `email-${i + 1}`,
        language: str(e && e.language, e && e.locale, e && e.lang),
        subject: str(e && e.subject, e && e.subject_line),
        preheader: str(e && e.preheader, e && e.preview_text),
        html: typeof (e && e.html) === "string" ? e.html : "",
        screenshotUrl: httpsUrl(e && (e.screenshotUrl || e.screenshot_url || e.screenshot))
      }))
      .filter(e => e.html || e.subject);
  }
  async function pollStatus(conversationId, signal) {
    const s = Migma.store.get();
    const path =
      ENDPOINTS.status(conversationId) +
      (s.projectId ? `?projectId=${encodeURIComponent(s.projectId)}` : "");
    const data = await json(path, { signal });
    return (data && data.data) || data || {};
  }

  async function pollEmails(conversationId, opts = {}) {
    const { signal, onTick } = opts;
    const deadline = Date.now() + POLL_BUDGET_MS;
    let delay = POLL_START_MS;
    for (;;) {
      const body = await pollStatus(conversationId, signal);
      const state = String(body.status || body.state || "").toLowerCase();
      if (onTick) onTick(state || "pending");
      if (DONE.includes(state)) return normEmails(body.result || body.data || body);
      if (FAILED.includes(state)) {
        throw new ApiError(str(body.error, body.message, body.reason) || `Generation ${state}`, 502);
      }
      if (Date.now() >= deadline) throw new ApiError("Migma did not finish generating in time", 504);
      await sleep(Math.min(delay, Math.max(250, deadline - Date.now())), signal);
      delay = Math.min(Math.round(delay * POLL_GROWTH), POLL_CAP_MS);
    }
  }

  // Start the job and poll it to completion. The caller gets the finished emails and the id, and
  // may watch the job's state through onTick without knowing the polling cadence.
  async function generate(payload, opts = {}) {
    const started = await startGeneration(payload, opts.signal);
    const emails = await pollEmails(started.conversationId, opts);
    return { conversationId: started.conversationId, emails };
  }
  // A brand kit is workspace-authored data, so it is untrusted input: only the fields below
  // are read, each is validated here at the boundary, and none of them can reach the app's
  // own theme tokens. Everything a kit sets lands on the email artifact instead — the one
  // surface where a customer's brand should outrank Migma's.
  const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
  // Font stacks reach two places: an inline style attribute in the exported HTML, and a custom
  // property on the preview element. Validation is therefore per family rather than over the whole
  // string — each part must be a bare or single-quoted font name, which admits no character that
  // could close an attribute ("), end or open a declaration (; { }), call a function (url(,
  // expression(), name a scheme (javascript:), open a tag (< >) or escape out of any of them (\).
  // A stack with one bad family is rejected whole rather than repaired, because a repaired stack is
  // a guess about what a workspace meant.
  const FAMILY = /^(?:'[\w\s-]{1,48}'|[\w-][\w\s-]{0,47})$/;
  const LOCALE = /^[a-z]{2}(-[a-z0-9]{2,8})?$/i;

  const rgb = value => {
    let s = value.slice(1);
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    return [0, 2, 4].map(i => parseInt(s.slice(i, i + 2), 16));
  };

  const hex = (value, fallback) => {
    const s = String(value == null ? "" : value).trim().toLowerCase();
    return HEX.test(s) ? s : fallback;
  };

  const fontStack = value => {
    const s = String(value == null ? "" : value).replace(/"/g, "'").trim();
    if (!s || s.length > 120) return "";
    const parts = s.split(",").map(p => p.trim());
    // Rewritten from the parts rather than returned as received, so the stored form is the
    // canonical one and normalising it again is a no-op.
    return parts.length <= 8 && parts.every(p => FAMILY.test(p)) ? parts.join(", ") : "";
  };

  const lin = v => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };

  const luminance = value => {
    const [r, g, b] = rgb(value);
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  };

  const contrast = (a, b) => {
    const la = luminance(a);
    const lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };

  // No customer palette may produce an unreadable email, so a requested text colour that
  // misses AA against its own background is replaced by whichever end of the scale clears it.
  const readable = (on, wanted) =>
    contrast(on, wanted) >= 4.5 ? wanted : luminance(on) > 0.45 ? "#18181b" : "#ffffff";

  const pad = n => n.toString(16).padStart(2, "0");
  const mix = (from, to, t) => {
    const a = rgb(from);
    const b = rgb(to);
    return "#" + a.map((v, i) => pad(Math.round(v + (b[i] - v) * t))).join("");
  };
  // A kit is stored in its normalised form and normalised again on read, so every fallback chain
  // also accepts this function's own output — otherwise a round trip would drop the fonts and
  // reset a deliberately dark CTA label back to white.
  function normKit(raw) {
    if (!raw || typeof raw !== "object") return null;
    const id = String(raw.id || raw.key || "").slice(0, 64);
    if (!id) return null;

    const paper = hex(raw.paper || raw.background || raw.surface, "#ffffff");
    const ink = readable(paper, hex(raw.ink || raw.text_color || raw.textColor, "#18181b"));
    const accent = hex(raw.accent || raw.primary || raw.color, "#1d1e20");

    return {
      id,
      name: String(raw.name || raw.title || id).slice(0, 40),
      accent,
      ctaInk: readable(accent, hex(raw.cta_text_color || raw.ctaTextColor || raw.ctaInk, "#ffffff")),
      paper,
      ink,
      // The tints metrics.js hardcodes for a white email, re-derived against the kit's own
      // paper so a tinted or dark brand surface keeps the same hierarchy instead of losing it.
      copy: mix(paper, ink, 0.75),
      muted: mix(paper, ink, 0.62),
      line: mix(paper, ink, 0.12),
      foot: mix(paper, ink, 0.03),
      page: mix(paper, ink, 0.048),
      display: fontStack(raw.display_font || raw.displayFont || raw.heading_font || raw.display),
      body: fontStack(raw.body_font || raw.bodyFont || raw.text_font || raw.body),
      locales: (Array.isArray(raw.locales) ? raw.locales : [])
        .map(l => String(l).trim().slice(0, 12))
        .filter(l => LOCALE.test(l))
        .slice(0, 12)
    };
  }

  // Brand import is a project operation: Migma reads the site and returns the brand it inferred.
  // That inferred brand is still workspace-authored, untrusted input, so it goes through the same
  // normKit boundary as anything else before it can touch the email artifact. The proxy enforces
  // https and strips credentials from the URL; the id and name fall back to the host so a kit is
  // always identifiable even when the import names neither.
  async function importBrand(url, signal) {
    const clean = String(url || "").trim();
    const data = await json(ENDPOINTS.import, { method: "POST", signal, retries: 0, body: { url: clean } });
    const out = (data && data.data) || data || {};
    const raw = out.brandKit || out.brand_kit || out.brand || out.project || out;
    const seed = Object.assign({}, raw);
    let host = "brand";
    try {
      host = new URL(clean).hostname.replace(/^www\./, "") || "brand";
    } catch (e) {
      /* host stays the fallback */
    }
    if (!seed.id && !seed.key) seed.id = host;
    if (!seed.name && !seed.title) seed.name = host;
    return normKit(seed);
  }

  return {
    ApiError,
    ENDPOINTS,
    PENDING_MIGMA_API,
    endSession,
    playlist,
    playlistTracks,
    artists,
    myPlaylists,
    track,
    artistAlbums,
    playlistTitles,
    projects,
    generate,
    pollEmails,
    importBrand,
    normKit
  };
})();
