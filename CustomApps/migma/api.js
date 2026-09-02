window.Migma = window.Migma || {};

Migma.api = (() => {
  // Every Migma path and response field lives here. If the published schema differs,
  // this map and the normalisers below are the only things that change.
  const ENDPOINTS = {
    projects: "/projects",
    ideas: "/campaigns/ideas",
    generate: "/campaigns/generate",
    save: "/campaigns",
    score: "/campaigns/score",
    translate: "/campaigns/translate",
    reviewers: "/workspaces/reviewers",
    comments: "/workspaces/comments",
    brandKits: "/workspaces/brand-kits"
  };

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

  function headers(accept) {
    const s = Migma.store.get();
    return {
      Authorization: `Bearer ${s.apiKey}`,
      "Content-Type": "application/json",
      Accept: accept,
      "X-Migma-Client": "spicetify-migma"
    };
  }

  async function describe(res) {
    try {
      const data = await res.json();
      return (data.error && data.error.message) || data.message || `Migma returned ${res.status}`;
    } catch (e) {
      if (res.status === 401 || res.status === 403) return "Key no longer valid";
      return `Migma returned ${res.status}`;
    }
  }

  async function request(path, opts = {}) {
    const { method = "GET", body, signal, retries = 2, accept = "application/json" } = opts;
    const base = Migma.store.get().baseUrl.replace(/\/+$/, "");
    let attempt = 0;

    for (;;) {
      let res;
      try {
        res = await fetch(base + path, {
          method,
          signal,
          headers: headers(accept),
          body: body === undefined ? undefined : JSON.stringify(body)
        });
      } catch (err) {
        if (err.name === "AbortError") throw err;
        if (attempt++ < retries) {
          await sleep(400 * attempt, signal);
          continue;
        }
        throw new ApiError("Could not reach Migma", 0);
      }
      if (res.ok) return res;

      const requestId = res.headers.get("x-request-id") || "";

      if (res.status === 429) {
        const header = Number(res.headers.get("retry-after"));
        const wait = header > 0 ? header * 1000 : 2000 * (attempt + 1);
        if (attempt++ < retries) {
          await sleep(wait, signal);
          continue;
        }
        throw new ApiError("Migma is rate limiting this workspace", 429, requestId, Math.round(wait / 1000));
      }

      if (res.status >= 500 && attempt++ < retries) {
        await sleep(500 * attempt, signal);
        continue;
      }

      throw new ApiError(await describe(res), res.status, requestId);
    }
  }

  const json = async (path, opts) => (await request(path, opts)).json();

  async function projects(signal) {
    const data = await json(ENDPOINTS.projects, { signal });
    const list = data.projects || data.data || data.items || [];
    return list.map(p => ({ id: p.id, name: p.name || p.title || p.id }));
  }

  async function ideas(digest, signal) {
    const s = Migma.store.get();
    const data = await json(ENDPOINTS.ideas, {
      method: "POST",
      signal,
      body: { project_id: s.projectId, source: "spotify_playlist", digest }
    });
    const list = data.ideas || data.data || [];
    return list.slice(0, 5).map((it, i) => ({
      id: it.id || `idea-${i}`,
      angle: it.angle || it.title || `Idea ${i + 1}`,
      subject: it.subject || it.subject_line || "",
      preheader: it.preheader || it.preview_text || "",
      rationale: it.rationale || it.description || "",
      segment: it.segment || it.audience || "",
      cta: it.cta || it.call_to_action || s.ctaLabel,
      confidence: it.confidence || it.match || ""
    }));
  }
  function parseFrame(frame, onEvent) {
    for (const line of frame.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let evt;
      try {
        evt = JSON.parse(payload);
      } catch (e) {
        evt = { delta: payload };
      }
      onEvent(evt);
    }
  }

  async function generate(brief, opts = {}) {
    const { onDelta, signal } = opts;
    const s = Migma.store.get();
    const res = await request(ENDPOINTS.generate, {
      method: "POST",
      signal,
      retries: 0,
      accept: "text/event-stream",
      body: { project_id: s.projectId, stream: true, brief }
    });

    const type = res.headers.get("content-type") || "";
    if (!res.body || !res.body.getReader || type.includes("application/json")) {
      const data = await res.json();
      const text = data.body || data.content || data.html || "";
      if (onDelta && text) onDelta(text, text);
      return { text, subject: data.subject || "", preheader: data.preheader || "" };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    const meta = {};

    const consume = evt => {
      if (evt.subject) meta.subject = evt.subject;
      if (evt.preheader) meta.preheader = evt.preheader;
      if (evt.error) throw new ApiError(evt.error.message || String(evt.error), 502);
      const delta = evt.delta !== undefined ? evt.delta : evt.text !== undefined ? evt.text : evt.content || "";
      if (delta) {
        text += delta;
        if (onDelta) onDelta(delta, text);
      }
    };
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() || "";
        frames.forEach(frame => parseFrame(frame, consume));
      }
      if (buffer.trim()) parseFrame(buffer, consume);
    } finally {
      // Releasing the lock alone leaves the body open, so a stream abandoned part-way — an error
      // frame, a consumer that threw — is cancelled as well as released: cancelling closes the
      // response, releasing hands the stream back. Neither is meaningful on a stream that has
      // already ended, so both are guarded rather than assumed.
      try {
        await reader.cancel();
      } catch (e) {
        /* already closed or errored by whatever ended the read */
      }
      try {
        reader.releaseLock();
      } catch (e) {
        /* nothing left to release */
      }
    }

    return { text, subject: meta.subject || "", preheader: meta.preheader || "" };
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

  async function brandKits(signal) {
    const data = await json(ENDPOINTS.brandKits, { signal });
    const list = data.brand_kits || data.brandKits || data.kits || data.data || data.items || [];
    return (Array.isArray(list) ? list : []).map(normKit).filter(Boolean).slice(0, 8);
  }

  // Remote records are normalised through this rather than String(), so a field that arrives
  // as an object or a number never reaches the UI as "[object Object]".
  const str = (...values) => {
    for (const v of values) if (typeof v === "string" && v.trim()) return v.trim();
    return "";
  };

  async function reviewers(signal) {
    const data = await json(ENDPOINTS.reviewers, { signal });
    const list = data.reviewers || data.members || data.data || data.items || [];
    return (Array.isArray(list) ? list : [])
      .map(r => ({
        id: str(r && r.id, r && r.user_id, r && r.email).slice(0, 64),
        name: str(r && r.name, r && r.display_name, r && r.full_name, r && r.email).slice(0, 48),
        email: str(r && r.email).slice(0, 96),
        role: str(r && r.role, r && r.title, r && r.job_title).slice(0, 32)
      }))
      .filter(r => r.id && r.name)
      .slice(0, 60);
  }

  // The canvas runs before a draft exists, so the comment thread is keyed on what is already
  // stable at that point: the project, the playlist and the chosen angle.
  const threadKey = (playlistId, ideaId) => {
    const s = Migma.store.get();
    return ["spotify", s.projectId || "workspace", playlistId || "playlist", ideaId || "custom"].join(":");
  };

  const normComment = (c, i) => ({
    id: str(c && c.id, c && c.comment_id) || `remote-${i}`,
    author: str(c && c.author_name, c && c.author, c && c.user && c.user.name, c && c.user && c.user.email).slice(0, 48) || "Teammate",
    text: str(c && c.body, c && c.text, c && c.message).slice(0, 2000),
    at: str(c && c.created_at, c && c.createdAt, c && c.at)
  });

  async function comments(thread, signal) {
    const data = await json(`${ENDPOINTS.comments}?thread=${encodeURIComponent(thread)}`, { signal });
    const list = data.comments || data.data || data.items || [];
    return (Array.isArray(list) ? list : []).map(normComment).filter(c => c.text);
  }

  async function postComment(thread, text, signal) {
    const s = Migma.store.get();
    const data = await json(ENDPOINTS.comments, {
      method: "POST",
      signal,
      retries: 0,
      body: { project_id: s.projectId, thread, body: String(text).slice(0, 2000) }
    });
    return normComment(data.comment || data.data || data, 0);
  }

  // Merge tokens are the send's contract with Migma: if a translation paraphrases one, the
  // campaign goes out with a dead unsubscribe link, so they are listed on the way out and
  // checked on the way back rather than trusted.
  const MERGE = /\{\{\s*[\w.]+\s*\}\}/g;
  const tokensIn = text => [...new Set(String(text || "").match(MERGE) || [])];

  async function translate(payload, signal) {
    const s = Migma.store.get();
    const before = tokensIn(payload.body);
    const data = await json(ENDPOINTS.translate, {
      method: "POST",
      signal,
      retries: 0,
      body: {
        project_id: s.projectId,
        locale: payload.locale,
        subject: payload.subject || "",
        preheader: payload.preheader || "",
        body: payload.body || "",
        preserve: before
      }
    });
    const out = data.translation || data.data || data;
    const body = str(out && out.body, out && out.text, out && out.content);
    const after = tokensIn(body);
    return {
      locale: str(out && out.locale, payload.locale),
      subject: str(out && out.subject, out && out.subject_line),
      preheader: str(out && out.preheader, out && out.preview_text),
      body,
      lostTokens: before.filter(t => !after.includes(t))
    };
  }

  // Migma scores the campaign when the workspace exposes the endpoint. When it does not, the
  // model below runs in-client over the digest so the pre-flight step still has something to
  // show — and every result carries `source`, so the UI can say which one produced the number
  // instead of presenting a heuristic as a prediction.
  const BANDS = [
    { at: 70, key: "high", label: "High" },
    { at: 50, key: "strong", label: "Strong" },
    { at: 30, key: "moderate", label: "Moderate" },
    { at: 0, key: "weak", label: "Weak" }
  ];
  const bandFor = n => BANDS.find(b => n >= b.at) || BANDS[BANDS.length - 1];

  function localWindow(digest) {
    const tags = (digest && digest.tags) || [];
    const pop = (digest && digest.avgPopularity) || 0;
    if (tags.includes("night listeners")) return { day: "Weeknights", hours: "21:00 – 00:00", note: "night-leaning genre mix" };
    if (tags.includes("fresh-release")) return { day: "Friday", hours: "08:00 – 11:00", note: "release-day cadence" };
    if (tags.includes("throwback")) return { day: "Sunday", hours: "10:00 – 13:00", note: "pre-2010 catalogue" };
    if (tags.includes("long-session")) return { day: "Weekdays", hours: "09:00 – 12:00", note: "long uninterrupted runtime" };
    if (pop >= 70) return { day: "Tue – Thu", hours: "17:00 – 20:00", note: "mainstream commute listening" };
    return { day: "Tue – Thu", hours: "18:00 – 21:00", note: "no strong timing signal" };
  }

  function localConfidence(digest) {
    const tracks = (digest && digest.trackCount) || 0;
    const artists = (digest && digest.artistCount) || 0;
    const genres = ((digest && digest.genres) || []).length;
    if (tracks >= 40 && artists >= 15 && genres >= 3) return "high";
    return tracks >= 15 ? "medium" : "low";
  }

  // A transparent points model rather than an opaque number: 34 is where a campaign with no
  // signal lands, every factor moves it by a stated amount with the reason it applied, and the
  // sum is clamped short of both certainty and zero.
  function localScore(digest, campaign) {
    const d = digest || {};
    const c = campaign || {};
    const factors = [];
    const add = (label, weight, note) => {
      if (weight) factors.push({ label, weight, note: note || "" });
    };

    const followers = (d.playlist && d.playlist.followers) || 0;
    add(
      "Playlist pull",
      followers >= 100000 ? 11 : followers >= 10000 ? 8 : followers >= 1000 ? 5 : followers >= 100 ? 2 : -6,
      `${followers.toLocaleString()} followers`
    );

    const tracks = d.trackCount || 0;
    add(
      "Catalogue depth",
      tracks >= 25 && tracks <= 120 ? 6 : tracks < 10 ? -7 : tracks > 400 ? -4 : 2,
      `${tracks} tracks`
    );

    const spread = tracks ? (d.artistCount || 0) / tracks : 0;
    add(
      "Artist spread",
      spread > 0.6 ? 5 : spread >= 0.25 ? 2 : spread < 0.15 ? -3 : 0,
      `${Math.round(spread * 100)}% unique artists`
    );

    const pop = d.avgPopularity || 0;
    add("Mainstream fit", pop >= 45 && pop <= 70 ? 7 : pop < 30 ? -5 : pop > 85 ? 1 : 3, `average popularity ${pop}`);

    const tags = d.tags || [];
    if (tags.includes("fresh-release")) add("Release freshness", 8, "recent releases lead the playlist");
    else if (tags.includes("throwback")) add("Nostalgia pull", 3, "catalogue skews pre-2010");

    if (tags.includes("long-session")) add("Session length", 4, d.runtimeLong || "");
    else if (tracks && tracks < 12) add("Session length", -3, d.runtimeLong || "");

    if ((d.explicitShare || 0) > 60) add("Explicit share", -3, `${d.explicitShare}% explicit`);

    const top = (d.genres || [])[0];
    if (top) {
      const share = top.share || 0;
      add("Genre focus", share >= 20 && share <= 55 ? 5 : share > 70 ? 2 : share < 12 ? -4 : 0, `${top.name} at ${share}%`);
    }
    const words = String(c.body || "").trim().split(/\s+/).filter(Boolean).length;
    if (words) add("Copy length", words >= 90 && words <= 320 ? 4 : words < 45 ? -5 : -2, `${words} words`);

    const subject = String(c.subject || "");
    if (subject) add("Subject length", subject.length >= 24 && subject.length <= 62 ? 3 : -2, `${subject.length} characters`);

    const total = factors.reduce((a, f) => a + f.weight, 0);
    const probability = Math.max(8, Math.min(92, Math.round(34 + total)));

    return {
      probability,
      band: bandFor(probability),
      window: localWindow(d),
      factors,
      confidence: localConfidence(d),
      source: "local"
    };
  }

  // Migma's own numbers are normalised too: the card renders a percentage, a band and a bounded
  // factor list, so a response that cannot be read as those is treated as no answer rather than
  // rendered half-empty, and the local model runs in its place.
  const CONFIDENCE = ["low", "medium", "high"];

  function normScore(raw) {
    if (!raw || typeof raw !== "object") return null;
    const src = raw.score && typeof raw.score === "object" ? raw.score : raw;
    const value = [src.probability, src.conversion_probability, src.conversionProbability, src.score, src.value].find(
      v => typeof v === "number" && isFinite(v)
    );
    if (value === undefined) return null;
    // A ratio and a percentage are both plausible spellings of the same field.
    const probability = Math.max(0, Math.min(100, Math.round(value > 0 && value <= 1 ? value * 100 : value)));

    const w = src.window || src.peak_window || src.peakWindow || src.send_window;
    const window =
      typeof w === "string"
        ? { day: w.slice(0, 40), hours: "", note: "" }
        : w && typeof w === "object"
          ? {
              day: str(w.day, w.days, w.label).slice(0, 40),
              hours: str(w.hours, w.time, w.range).slice(0, 40),
              note: str(w.note, w.reason, w.rationale).slice(0, 120)
            }
          : null;

    const list = Array.isArray(src.factors) ? src.factors : Array.isArray(src.signals) ? src.signals : [];
    const factors = list
      .map(f => ({
        label: str(f && f.label, f && f.name, f && f.factor).slice(0, 40),
        weight: Math.max(-20, Math.min(20, Math.round(Number(f && (f.weight !== undefined ? f.weight : f.impact)) || 0))),
        note: str(f && f.note, f && f.detail, f && f.reason).slice(0, 120)
      }))
      .filter(f => f.label)
      .slice(0, 10);

    const confidence = str(src.confidence, src.certainty).toLowerCase();

    return {
      probability,
      band: bandFor(probability),
      window,
      factors,
      confidence: CONFIDENCE.includes(confidence) ? confidence : "",
      source: "migma"
    };
  }

  async function score(digest, campaign, signal) {
    const s = Migma.store.get();
    const c = campaign || {};
    try {
      const data = await json(ENDPOINTS.score, {
        method: "POST",
        signal,
        retries: 0,
        body: {
          project_id: s.projectId,
          subject: c.subject || "",
          body: c.body || "",
          segment: c.segment || "",
          locale: c.locale || s.locale || "",
          metrics: c.metrics || {}
        }
      });
      const scored = normScore(data);
      if (scored) return scored;
    } catch (err) {
      // A workspace without this endpoint is the expected case rather than a failure, so the
      // pre-flight step falls through to the local model instead of reporting an error.
      if (err && err.name === "AbortError") throw err;
    }
    return localScore(digest, c);
  }

  async function saveDraft(campaign, signal) {
    const s = Migma.store.get();
    const data = await json(ENDPOINTS.save, {
      method: "POST",
      signal,
      body: Object.assign({ project_id: s.projectId, source: "spotify_playlist" }, campaign)
    });
    return {
      id: data.id || "",
      url: data.url || data.edit_url || (data.links && data.links.edit) || ""
    };
  }

  return {
    ApiError,
    ENDPOINTS,
    playlist,
    playlistTracks,
    artists,
    myPlaylists,
    projects,
    ideas,
    generate,
    saveDraft,
    reviewers,
    brandKits,
    normKit,
    comments,
    postComment,
    threadKey,
    translate,
    score
  };
})();
