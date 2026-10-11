window.Migma = window.Migma || {};

(() => {
  const React = Spicetify.React;
  const { useState, useEffect, useRef, useReducer, useCallback, useMemo } = React;
  const U = Migma.ui;
  const h = U.h;
  const F = U.React.Fragment;

  // Three steps, and the sequence is the whole navigation model: pick the playlist, choose and
  // refine the campaign, review and export it. Each one is a single surface that changes what it
  // shows as the work progresses rather than a screen that hands off to the next. Settings sits
  // outside the sequence.
  const STEPS = [
    { value: "pick", label: "Pick a playlist" },
    { value: "refine", label: "Choose & refine" },
    { value: "export", label: "Review & export" }
  ];
  const STEP_IDS = STEPS.map(s => s.value);
  const TONES = [
    { value: "warm", label: "Warm" },
    { value: "direct", label: "Direct" },
    { value: "playful", label: "Playful" },
    { value: "editorial", label: "Editorial" }
  ];
  const LENGTHS = [
    { value: "short", label: "Short" },
    { value: "standard", label: "Standard" },
    { value: "long", label: "Long" }
  ];
  const THEMES = [
    { value: "dark", label: "Dark" },
    { value: "light", label: "White" },
    { value: "system", label: "System" }
  ];
  // The two things a campaign can be built from. Playlist campaign is the flagship — a playlist's
  // audience, drafted into an email. Artist announcement reframes the same pipeline as a fan email
  // for a release, sourced from a playlist or a single track.
  const CAMPAIGN_TYPES = [
    { value: "playlist", label: "Playlist campaign" },
    { value: "artist_announce", label: "Artist announcement" },
    { value: "playlist_pitch", label: "Playlist pitch" },
    { value: "show_promo", label: "Show promo" },
    { value: "label_digest", label: "Label digest" }
  ];
  // The three panes of step two. Only the brief calls a live endpoint; angles and review name
  // capabilities Migma has not published a route for, so they render a pending state in place.
  const TABS = [
    { value: "angles", label: "Angles" },
    { value: "brief", label: "Brief" },
    { value: "review", label: "Review" }
  ];
  // Offered as extra generation languages. Migma returns one email per language, so these add to
  // the brief's own language rather than translating after the fact.
  const GEN_LANGS = ["es", "fr", "de", "it", "pt-br", "nl", "ja", "ko"];
  // Only used to give a locale code a readable name in the select. A code that is not listed
  // still works — it falls back to the code itself rather than being hidden.
  const LOCALE_NAMES = {
    en: "English",
    "en-gb": "English (UK)",
    "en-us": "English (US)",
    es: "Spanish",
    "es-mx": "Spanish (Mexico)",
    fr: "French",
    de: "German",
    it: "Italian",
    pt: "Portuguese",
    "pt-br": "Portuguese (Brazil)",
    nl: "Dutch",
    sv: "Swedish",
    da: "Danish",
    nb: "Norwegian",
    fi: "Finnish",
    pl: "Polish",
    cs: "Czech",
    tr: "Turkish",
    ru: "Russian",
    uk: "Ukrainian",
    ja: "Japanese",
    ko: "Korean",
    zh: "Chinese",
    "zh-tw": "Chinese (Traditional)",
    hi: "Hindi",
    id: "Indonesian",
    th: "Thai",
    ar: "Arabic",
    he: "Hebrew"
  };
  const localeLabel = code => LOCALE_NAMES[String(code || "").toLowerCase()] || String(code || "").toUpperCase();

  const blank = {
    view: "pick",
    playlists: null,
    detected: null,
    source: null,
    digest: null,
    reading: false,
    tab: "brief",
    generating: false,
    jobState: "",
    conversationId: "",
    emails: null,
    emailId: "",
    stale: false,
    query: "",
    busy: null,
    importing: false,
    done: false,
    error: null,
    notice: null,
    pitchTarget: null,
    releases: null,
    newRelease: null
  };

  const patchReducer = (state, patch) =>
    Object.assign({}, state, typeof patch === "function" ? patch(state) : patch);
  const playlistId = uri => {
    const m = String(uri || "").match(/playlist[:/]([a-zA-Z0-9]+)/);
    return m ? m[1] : "";
  };
  const trackId = uri => {
    const raw = String(uri || "").trim();
    const m = raw.match(/track[:/]([a-zA-Z0-9]+)/);
    if (m) return m[1];
    return /^[a-zA-Z0-9]{20,24}$/.test(raw) ? raw : "";
  };
  const artistId = uri => {
    const m = String(uri || "").trim().match(/artist[:/]([a-zA-Z0-9]+)/);
    if (m) return m[1];
    const raw = String(uri || "").trim();
    return /^[a-zA-Z0-9]{20,24}$/.test(raw) ? raw : "";
  };

  // A digest-shaped object for the campaign types that have no single Spotify source to read — a
  // show announcement, a label digest. The fields the preview and the composer touch are present;
  // the audience metrics a playlist would carry are simply zero.
  const syntheticDigest = ({ id, name, owner, image, tracks }) => ({
    playlist: { id: id || "synthetic", name: name || "", description: "", owner: owner || "", followers: 0, image: image || "" },
    trackCount: tracks ? tracks.length : 0,
    artistCount: 0,
    avgPopularity: 0,
    explicitShare: 0,
    runtimeShort: "",
    runtimeLong: "",
    genres: [],
    eras: [],
    topArtists: [],
    tags: [],
    tracks: tracks || []
  });
  // A handoff carries the entry point's intent: the context menu and the topbar aimed at a specific
  // playlist or track on purpose, so the picker is skipped. An inferred route only preselects. A
  // track handoff flips the app into artist-announcement mode, because that is the only type a single
  // track sources.
  function detectSource() {
    const handoff = Migma.store.takeHandoff();
    if (handoff) {
      const direct = handoff.direct !== false;
      if (/track/.test(String(handoff.uri))) {
        const t = trackId(handoff.uri);
        if (t) return { kind: "track", id: t, direct };
      }
      const p = playlistId(handoff.uri);
      if (p) return { kind: "playlist", id: p, direct };
    }
    try {
      const path = Spicetify.Platform.History.location.pathname || "";
      const p = playlistId(path);
      if (p) return { kind: "playlist", id: p, direct: false };
      const t = (path.match(/track[:/]([a-zA-Z0-9]+)/) || [])[1];
      if (t) return { kind: "track", id: t, direct: false };
    } catch (e) {
      /* route unavailable during boot */
    }
    const visited = playlistId(Migma.store.lastVisited());
    if (visited) return { kind: "playlist", id: visited, direct: false };
    try {
      return { kind: "playlist", id: playlistId((Spicetify.Player.data.context || {}).uri), direct: false };
    } catch (e) {
      return { kind: "playlist", id: "", direct: false };
    }
  }

  function toError(err) {
    if (!err) return null;
    if (err.name === "AbortError") return null;
    return {
      message: err.message || "Something went wrong",
      status: err.status || 0,
      requestId: err.requestId || "",
      retryAfter: err.retryAfter || 0
    };
  }

  function copy(text) {
    try {
      Spicetify.Platform.ClipboardAPI.copy(text);
    } catch (e) {
      navigator.clipboard.writeText(text);
    }
    Spicetify.showNotification("Campaign HTML copied");
  }

  function download(name, html) {
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function openExternal(url) {
    try {
      Spicetify.Platform.OpenLinkAPI.openLink(url);
    } catch (e) {
      window.open(url, "_blank");
    }
  }
  // Migma's generated html is the real artifact, copied and downloaded verbatim — but it is never
  // handed to the DOM. The preview renders a plain-text reading of it instead, so a generated
  // email can be read on screen without the plugin ever injecting markup it did not author.
  function plainText(html) {
    if (!html) return "";
    return String(html)
      .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, " ")
      .replace(/<\s*(?:br|\/p|\/div|\/h[1-6]|\/li|\/tr)\s*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&quot;/gi, '"')
      .replace(/[ \t]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  // metrics.js owns the local composer and stays untouched, so a brand kit is applied to the HTML
  // it returns. These are the literals it writes for a white email; this list is the only place
  // the two files are coupled by value rather than by call. Migma's own generation already carries
  // the imported brand, so this only ever retints the local preview and the pre-generation export.
  const EM_COLOURS = {
    "#f4f4f5": "page",
    "#f8f8fa": "foot",
    "#e4e4e7": "line",
    "#18181b": "ink",
    "#52525b": "copy",
    "#71717a": "muted"
  };
  const EM_HEX = /#(?:f4f4f5|f8f8fa|e4e4e7|18181b|52525b|71717a)/g;

  function brandedHtml(html, kit) {
    if (!kit) return html;
    let out = html
      .split("#ffffff;border-radius:16px")
      .join(`${kit.paper};border-radius:16px`)
      .split("color:#ffffff;font:700 15px")
      .join(`color:${kit.ctaInk};font:700 15px`);

    // One pass, so a colour substituted for one token can never be re-read as another.
    out = out.replace(EM_HEX, m => kit[EM_COLOURS[m]] || m);

    // The body stack is swapped everywhere first; the heading anchor is then computed against
    // the result, so the H1 ends up with the display stack alone rather than both.
    if (kit.body) {
      out = out.split("Helvetica,Arial,sans-serif").join(kit.body);
      if (kit.display) out = out.split(`700 26px/1.25 ${kit.body}`).join(`700 26px/1.25 ${kit.display}`);
    } else if (kit.display) {
      out = out.split("700 26px/1.25 Helvetica,Arial,sans-serif").join(`700 26px/1.25 ${kit.display}`);
    }
    return out;
  }

  // Kit colours reach the preview as scoped custom properties, so nothing a workspace authors can
  // touch the app's own theme tokens — only the artifact inside .mg-email.
  const kitVars = kit =>
    kit
      ? {
          "--mg-em-paper": kit.paper,
          "--mg-em-ink": kit.ink,
          "--mg-em-copy": kit.copy,
          "--mg-em-muted": kit.muted,
          "--mg-em-line": kit.line,
          "--mg-em-hair": kit.page,
          "--mg-em-foot": kit.foot,
          "--mg-em-cta-ink": kit.ctaInk,
          "--mg-em-display": kit.display || undefined,
          "--mg-em-body": kit.body || undefined
        }
      : undefined;

  // The kit's accent wins for the CTA, handed to metrics.js as a settings object rather than
  // patched into the HTML afterwards.
  const kitSettings = (settings, kit) => (kit ? Object.assign({}, settings, { accent: kit.accent }) : settings);
  // The locally composed artifact, used for the preview and as the export before any generation
  // exists. `shown.body` is the plain-text reading of whichever email is on screen, so the local
  // composer and Migma's own output describe the same copy.
  const composeHtml = (digest, shown, settings, kit) =>
    brandedHtml(
      Migma.compose.emailHtml({ digest, idea: shown.idea, body: shown.body, settings: kitSettings(settings, kit) }),
      kit
    );

  // The preview, export and copy all read the campaign through here: whichever generated email is
  // selected, reduced to the plain fields the surfaces need. Before a generation exists there is
  // no email, so the composer runs from the digest alone.
  function viewCopy(state) {
    const emails = state.emails || [];
    const email = emails.find(e => e.emailId === state.emailId) || emails[0] || null;
    return {
      email,
      idea: email ? { angle: "", subject: email.subject, preheader: email.preheader, segment: "" } : null,
      body: email ? plainText(email.html) : "",
      locale: email ? email.language : ""
    };
  }

  // Copy and download hand back Migma's own html verbatim when a generation exists — that is the
  // real deliverable — and fall back to the local composer only before one does.
  function exportHtml(state, settings, kit) {
    const shown = viewCopy(state);
    if (shown.email && shown.email.html) return shown.email.html;
    return composeHtml(state.digest, shown, settings, kit);
  }

  // Every surface for a capability Migma has not published an endpoint for renders through here, so
  // "pending Migma API" reads the same way everywhere and never pretends to be an error.
  const Pending = ({ title, note }) =>
    h(U.StateView, {
      glyph: "◴",
      title,
      note:
        note ||
        "Migma has not published an endpoint for this yet. The plugin leaves it here, inert, rather than call a route that does not exist — it lights up the moment the API ships one."
    });
  function ConnectView({ theme, onTheme, onConnected, onForget, settings, onSetting }) {
    const saved = Migma.store.get();
    const [proxyUrl, setProxyUrl] = useState(saved.proxyUrl);
    const [projects, setProjects] = useState([]);
    const [projectId, setProjectId] = useState(saved.projectId);
    const [status, setStatus] = useState(null);
    const [busy, setBusy] = useState(false);
    const abort = useRef(null);
    const live = useRef(true);

    // The check can be pressed again before the first answer arrives, and the project list is what
    // connect() saves against — so the reply to a superseded proxy is cancelled outright rather than
    // left to fill the select with another workspace's projects.
    useEffect(() => {
      live.current = true;
      return () => {
        live.current = false;
        if (abort.current) abort.current.abort();
      };
    }, []);

    async function validate() {
      if (abort.current) abort.current.abort();
      const ctrl = new AbortController();
      abort.current = ctrl;
      const usable = () => live.current && !ctrl.signal.aborted;
      setBusy(true);
      setStatus(null);
      // Any session already in hand was granted by whatever proxy was configured a moment ago, so it
      // is dropped before the new address is asked for one.
      Migma.store.set({ proxyUrl: proxyUrl.trim() });
      Migma.api.endSession();
      try {
        const list = await Migma.api.projects(ctrl.signal);
        if (!usable()) return;
        setProjects(list);
        setProjectId(list.length ? list[0].id : "");
        setStatus(
          list.length
            ? { kind: "ok", text: `${list.length} project${list.length > 1 ? "s" : ""} found` }
            : { kind: "warn", text: "Proxy reachable, but this workspace has no projects yet" }
        );
      } catch (err) {
        const e = toError(err);
        // A cancelled check reports nothing: the request that replaced it owns the status line.
        if (!e || !usable()) return;
        setProjects([]);
        setStatus({ kind: "err", text: e.message });
      } finally {
        if (usable()) setBusy(false);
      }
    }

    function connect() {
      const project = projects.find(p => p.id === projectId);
      Migma.store.set({ projectId, projectName: project ? project.name : "" });
      onConnected();
    }
      return h(
      "div",
      { className: "mg-body" },
      h(
        "header",
        null,
        h("h2", { className: "mg-h1" }, "Connect MigmaAI"),
        h(
          "p",
          { className: "mg-sub" },
          "Point the plugin at your Migma proxy. It holds the workspace key and signs every request, so this client never handles one."
        )
      ),
      h(
        "div",
        null,
        h(
          U.Field,
          {
            label: "Proxy URL",
            hint: "Your own service. It exchanges this client's Spotify session for a scoped one and signs to Migma."
          },
          h(U.Input, {
            value: proxyUrl,
            placeholder: "https://your-proxy.example",
            onChange: e => setProxyUrl(e.target.value),
            onKeyDown: e => e.key === "Enter" && validate()
          })
        ),
        h(
          U.Btn,
          { variant: "ghost", block: true, disabled: busy || !proxyUrl.trim(), onClick: validate },
          busy ? "Checking…" : "Check connection"
        ),
        status && h("p", { className: cxStatus(status.kind) }, status.text),
        h(
          U.Field,
          {
            label: "Workspace project",
            hint: "Migma generates emails against this project, and a brand import updates it."
          },
          h(U.Select, {
            value: projectId,
            disabled: !projects.length,
            onChange: setProjectId,
            options: projects.length
              ? projects.map(p => ({ value: p.id, label: p.name }))
              : [{ value: "", label: "Check the connection first" }]
          })
        ),
        h(U.Btn, { block: true, disabled: !projectId, onClick: connect }, "Connect")
      ),
      h(
        "footer",
        { className: "mg-body__end" },
        h(
          U.Field,
          { label: "Appearance", hint: "System follows your operating system's light or dark setting." },
          h(U.Seg, { value: theme, options: THEMES, onChange: onTheme })
        ),
        h("div", { className: "mg-divider" }),
        onForget &&
          h(
            U.Field,
            {
              label: "Watch an artist",
              hint: "Watches for a new release while the app is open — no background daemon. When one drops, a banner offers to draft an announcement."
            },
            h(U.Input, {
              value: (settings && settings.watchArtist) || "",
              placeholder: "https://open.spotify.com/artist/…",
              onChange: e => onSetting({ watchArtist: e.target.value })
            }),
            h(
              "div",
              { className: "mg-optrow" },
              h("span", null, settings && settings.watchOn ? "Watching while open" : "Watch off"),
              h(U.Toggle, {
                on: settings && settings.watchOn,
                label: "Watch this artist",
                onChange: v => onSetting({ watchOn: v })
              })
            )
          ),
        onForget && h("div", { className: "mg-divider" }),
        h(
          "p",
          { className: "mg-hint" },
          "No Migma key is stored here. The plugin presents the Spotify session this client already holds and the proxy returns a short-lived, scoped one, kept in memory only."
        ),
        onForget && h(U.Btn, { variant: "ghost", size: "sm", block: true, onClick: onForget }, "Disconnect")
      )
    );
  }

  const cxStatus = kind => U.cx("mg-status", `mg-status--${kind}`);
  const PlaylistCard = ({ item, selected, compact, onClick }) =>
    h(
      "button",
      { type: "button", className: U.cx("mg-src", selected && "is-sel", compact && "is-compact"), onClick },
      h("img", { className: "mg-art", src: item.image || "", alt: "", loading: "lazy" }),
      h(
        "span",
        { className: "mg-src__txt" },
        h("b", null, item.name),
        h(
          "s",
          null,
          [item.owner, `${item.tracks} tracks`, item.followers ? `${item.followers.toLocaleString()} followers` : ""]
            .filter(Boolean)
            .join(" · ")
        )
      ),
      selected && h("span", { className: "mg-chip is-on" }, "Selected")
    );

  // Both digest halves are fragments so their blocks are direct children of the step's own column
  // and inherit its rhythm, rather than sitting in a wrapper that would need its own spacing.
  const DigestWait = ({ progress }) =>
    h(
      F,
      null,
      h(
        "div",
        { className: "mg-tiles" },
        [0, 1, 2, 3].map(i => h("div", { key: i, className: "mg-tile" }, h(U.Skeleton, { height: 17 })))
      ),
      h(U.Skeleton, { width: "40%" }),
      h(U.Skeleton, {}),
      h(U.Skeleton, { width: "86%" }),
      h(U.Skeleton, { width: "62%" }),
      h(
        "div",
        { className: "mg-body__end mg-progress" },
        h(U.Spinner),
        h("span", null, progress ? `Reading ${progress.done} of ${progress.total} tracks…` : "Reading playlist…")
      )
    );
  const Digest = ({ digest }) => {
    const peak = digest.genres.length ? digest.genres[0].share : 100;
    return h(
      F,
      null,
      h(
        "div",
        { className: "mg-tiles" },
        h(U.Tile, { value: digest.trackCount, label: "Tracks" }),
        h(U.Tile, { value: digest.runtimeShort, label: "Runtime" }),
        h(U.Tile, { value: digest.artistCount, label: "Artists" }),
        h(U.Tile, { value: digest.avgPopularity, label: "Popularity" })
      ),
      digest.genres.length
        ? h(
            "div",
            null,
            h("label", { className: "mg-lbl" }, "Top genres"),
            h(
              "div",
              { className: "mg-bars" },
              digest.genres.map(g => h(U.Bar, { key: g.name, label: g.name, share: g.share, peak }))
            )
          )
        : null,
      digest.eras.length
        ? h("div", null, h("label", { className: "mg-lbl" }, "Release era"), h(U.Spark, { items: digest.eras }))
        : null,
      h(
        "div",
        { className: "mg-grow" },
        h("label", { className: "mg-lbl" }, "Audience tags"),
        h(
          "div",
          { className: "mg-tags" },
          digest.tags.length
            ? digest.tags.map(t => h("span", { key: t, className: "mg-chip is-on" }, t))
            : h("span", { className: "mg-chip" }, "no strong signal")
        ),
        h(
          "p",
          { className: "mg-hint" },
          "Derived from playlist metadata, artist genres and release dates. Spotify's audio-features endpoint is closed to new clients, so nothing here is inferred from audio."
        )
      )
    );
  };
  // Step one is one surface rather than three screens: choose a source and the same surface fills
  // with its audience. A campaign-type toggle sits at the top — playlist campaign or artist
  // announcement — and in announcement mode a single track can be pasted or taken from the player,
  // because a release is as often one track as a playlist.
  // Playlist pitch: the artist's track plus the curator's playlist, both read through Spotify.
  function PitchPanel({ typeField, onBuild }) {
    const [trackUrl, setTrackUrl] = useState("");
    const [targetUrl, setTargetUrl] = useState("");
    const ready = Boolean(trackId(trackUrl) && playlistId(targetUrl));
    return h(
      "div",
      { className: "mg-body" },
      typeField,
      h(
        "header",
        null,
        h("h2", { className: "mg-h2" }, "Pitch a track"),
        h("p", { className: "mg-sub" }, "Pitch your track to a playlist curator. Both are read through Spotify.")
      ),
      h(
        U.Field,
        { label: "Your track", hint: "Paste a Spotify track link." },
        h(U.Input, { value: trackUrl, placeholder: "https://open.spotify.com/track/…", onChange: e => setTrackUrl(e.target.value) })
      ),
      h(
        U.Field,
        { label: "Target playlist", hint: "The curator's playlist you are pitching to." },
        h(U.Input, { value: targetUrl, placeholder: "https://open.spotify.com/playlist/…", onChange: e => setTargetUrl(e.target.value) })
      ),
      h(U.Btn, { block: true, disabled: !ready, onClick: () => onBuild(trackUrl, targetUrl) }, "Build pitch")
    );
  }

  // Show promo: an editable date list, stored in settings. No ticketing API exists, so the rows
  // are manual input and the links are whatever the artist pastes.
  function ShowPanel({ typeField, settings, onSetting, onBuild }) {
    const dates = settings.dates || [];
    const setDates = next => onSetting({ dates: next });
    const update = (i, k, v) => setDates(dates.map((d, j) => (j === i ? Object.assign({}, d, { [k]: v }) : d)));
    const add = () => setDates(dates.concat([{ city: "", venue: "", date: "", ticket: "" }]));
    const remove = i => setDates(dates.filter((_, j) => j !== i));
    const ready = dates.some(d => d && (d.city || d.venue || d.date));
    return h(
      "div",
      { className: "mg-body" },
      typeField,
      h(
        "header",
        null,
        h("h2", { className: "mg-h2" }, "Announce shows"),
        h("p", { className: "mg-sub" }, "Announce a date or a run of dates to your fans.")
      ),
      h(U.Field, { label: "Artist name" }, h(U.Input, { value: settings.showArtist, placeholder: "Your artist name", onChange: e => onSetting({ showArtist: e.target.value }) })),
      h(
        U.Field,
        { label: "Tour dates", hint: "City, venue, date and a ticket link per row." },
        h(
          "div",
          { className: "mg-rows" },
          dates.length
            ? dates.map((d, i) =>
                h(
                  "div",
                  { key: i, className: "mg-row" },
                  h(U.Input, { value: d.city, placeholder: "City", onChange: e => update(i, "city", e.target.value) }),
                  h(U.Input, { value: d.venue, placeholder: "Venue", onChange: e => update(i, "venue", e.target.value) }),
                  h(U.Input, { value: d.date, placeholder: "2026-11-02", onChange: e => update(i, "date", e.target.value) }),
                  h(U.Input, { value: d.ticket, placeholder: "Ticket link", onChange: e => update(i, "ticket", e.target.value) }),
                  h("button", { type: "button", className: "mg-x", title: "Remove", onClick: () => remove(i) }, "×")
                )
              )
            : h("p", { className: "mg-hint" }, "No dates yet."),
          h(U.Btn, { variant: "ghost", size: "sm", onClick: add }, "Add date")
        )
      ),
      h(
        "div",
        { className: "mg-optrow" },
        h(U.Chip, { tone: "warn" }, "MOCK"),
        h("span", { className: "mg-hint", style: { margin: 0 } }, "Nearest-city ordering would use listener locations — no such API, so dates stay in entry order.")
      ),
      h(U.Btn, { block: true, disabled: !ready, onClick: onBuild }, "Build announcement")
    );
  }
  // MOCK: a "nearest city first" segment would need Spotify listener-location data, which no public
  // endpoint exposes; the date order is whatever the artist entered.

  // Label digest: an editable roster, stored in settings. Releases are real — fetched per artist
  // and filtered to the last 7 days — so an empty roster or a quiet week shows an honest empty state.
  function LabelPanel({ typeField, settings, onSetting, onBuild, busy }) {
    const roster = settings.roster || [];
    const setR = next => onSetting({ roster: next });
    const update = (i, k, v) => setR(roster.map((r, j) => (j === i ? Object.assign({}, r, { [k]: v }) : r)));
    const add = () => setR(roster.concat([{ name: "", uri: "" }]));
    const remove = i => setR(roster.filter((_, j) => j !== i));
    const ready = roster.some(r => r && r.uri);
    return h(
      "div",
      { className: "mg-body" },
      typeField,
      h(
        "header",
        null,
        h("h2", { className: "mg-h2" }, "Weekly label digest"),
        h("p", { className: "mg-sub" }, "New releases across your roster, from the last 7 days.")
      ),
      h(U.Field, { label: "Label name" }, h(U.Input, { value: settings.labelName, placeholder: "Your label", onChange: e => onSetting({ labelName: e.target.value }) })),
      h(
        U.Field,
        { label: "Roster", hint: "Artist name and a Spotify artist link per row." },
        h(
          "div",
          { className: "mg-rows" },
          roster.length
            ? roster.map((r, i) =>
                h(
                  "div",
                  { key: i, className: "mg-row" },
                  h(U.Input, { value: r.name, placeholder: "Artist", onChange: e => update(i, "name", e.target.value) }),
                  h(U.Input, { value: r.uri, placeholder: "https://open.spotify.com/artist/…", onChange: e => update(i, "uri", e.target.value) }),
                  h("button", { type: "button", className: "mg-x", title: "Remove", onClick: () => remove(i) }, "×")
                )
              )
            : h("p", { className: "mg-hint" }, "No artists yet."),
          h(U.Btn, { variant: "ghost", size: "sm", onClick: add }, "Add artist")
        )
      ),
      h(U.Btn, { block: true, disabled: busy || !ready, onClick: onBuild }, busy ? "Reading releases…" : "Build digest")
    );
  }

  // Step one is one surface: a campaign-type toggle, then the source inputs that type needs. The
  // playlist and artist types read a Spotify source into a digest in place; pitch, show and label
  // collect their inputs and build straight into step two.
  function PickView(props) {
    const { state, progress, query, onQuery, onPick, onChange, campaignType, onType, onTrack, onUseCurrent, settings, onSetting } = props;
    const artist = campaignType === "artist_announce";
    const [trackUrl, setTrackUrl] = useState("");
    const list = useMemo(() => {
      const q = query.trim().toLowerCase();
      const items = state.playlists || [];
      return q ? items.filter(p => p.name.toLowerCase().includes(q)) : items;
    }, [state.playlists, query]);
    const selectedId = state.source ? state.source.id : null;

    if (state.source && (state.digest || state.reading))
      return h(
        "div",
        { className: "mg-body" },
        h(
          "div",
          { className: "mg-chosen" },
          h("img", { className: "mg-art", src: state.source.image || "", alt: "" }),
          h(
            "div",
            { className: "mg-chosen__t" },
            h("b", null, state.source.name),
            h(
              "s",
              null,
              state.digest
                ? state.digest.single
                  ? `${state.digest.playlist.owner || "Single"} · ${state.digest.runtimeShort}`
                  : `${state.digest.trackCount} tracks · ${state.digest.artistCount} artists · ${state.digest.runtimeShort}`
                : "Reading this source…"
            )
          ),
          h(U.Btn, { variant: "ghost", size: "sm", onClick: onChange }, "Change")
        ),
        state.digest ? h(Digest, { digest: state.digest }) : h(DigestWait, { progress })
      );

    const typeField = h(
      U.Field,
      { label: "Campaign type" },
      h(U.Seg, { value: campaignType, options: CAMPAIGN_TYPES, onChange: onType })
    );

    if (campaignType === "playlist_pitch") return h(PitchPanel, { typeField, onBuild: props.onBuildPitch });
    if (campaignType === "show_promo") return h(ShowPanel, { typeField, settings, onSetting, onBuild: props.onBuildShow });
    if (campaignType === "label_digest")
      return h(LabelPanel, { typeField, settings, onSetting, onBuild: props.onBuildLabel, busy: state.reading });

    const submitTrack = () => {
      const id = trackId(trackUrl);
      if (id) onTrack(id);
    };
    const trackBlock = artist
      ? h(
          U.Field,
          { label: "Or announce a single track", hint: "Paste a Spotify track link, or use the track playing now." },
          h(U.Input, {
            value: trackUrl,
            placeholder: "https://open.spotify.com/track/…",
            onChange: e => setTrackUrl(e.target.value),
            onKeyDown: e => e.key === "Enter" && submitTrack()
          }),
          h(
            "div",
            { className: "mg-optrow" },
            h(U.Btn, { variant: "ghost", size: "sm", disabled: !trackId(trackUrl), onClick: submitTrack }, "Use this track"),
            h(U.Btn, { variant: "ghost", size: "sm", onClick: onUseCurrent }, "Use the playing track")
          )
        )
      : null;

    if (state.playlists && !state.playlists.length && !state.detected && !artist)
      return h(
        "div",
        { className: "mg-body" },
        typeField,
        h(U.StateView, {
          glyph: "♪",
          title: "No playlists yet",
          note: "Create or follow a playlist, then come back to build a campaign from it.",
          action: h(
            U.Btn,
            { variant: "ghost", size: "sm", onClick: () => Spicetify.Platform.History.push("/collection/playlists") },
            "Open Your Library"
          )
        })
      );
    return h(
      "div",
      { className: "mg-body" },
      typeField,
      h(
        "header",
        null,
        h("h2", { className: "mg-h2" }, artist ? "Choose a release" : "Pick a playlist"),
        h(
          "p",
          { className: "mg-sub" },
          artist
            ? "Announce a release to your fans. Pick a playlist, or paste a single track below."
            : "A campaign is built from one playlist. Choosing it reads its audience straight away."
        )
      ),
      state.detected &&
        h(
          "div",
          null,
          h("label", { className: "mg-lbl" }, "On screen now"),
          h(PlaylistCard, {
            item: state.detected,
            selected: selectedId === state.detected.id,
            onClick: () => onPick(state.detected)
          })
        ),
      h(
        "div",
        { className: "mg-grow" },
        h("label", { className: "mg-lbl" }, state.detected ? "Or choose another" : "Your playlists"),
        h(U.Input, { value: query, placeholder: "Search your playlists…", onChange: e => onQuery(e.target.value) }),
        h(
          "div",
          { className: "mg-list" },
          state.playlists === null
            ? [0, 1, 2, 3].map(i => h(U.Skeleton, { key: i, height: 58 }))
            : list.map(p =>
                h(PlaylistCard, {
                  key: p.id,
                  item: p,
                  compact: true,
                  selected: selectedId === p.id,
                  onClick: () => onPick(p)
                })
              )
        )
      ),
      trackBlock
    );
  }

  const normPlaylist = p => ({
    id: p.id,
    name: p.name || "Untitled playlist",
    image: ((p.images || [])[0] || {}).url || "",
    owner: (p.owner || {}).display_name || "",
    tracks: (p.tracks || {}).total || 0,
    followers: (p.followers || {}).total || 0
  });
  function EmailPreview({ digest, shown, settings, kit, generating }) {
    const email = shown.email;
    const paras = Migma.compose.paragraphs(shown.body);
    return h(
      "div",
      { className: "mg-email", style: kitVars(kit) },
      h(
        "div",
        { className: "mg-email__subj" },
        h("b", null, email && email.subject ? email.subject : digest.playlist.name),
        email && email.preheader ? h("s", null, email.preheader) : null
      ),
      h(
        "div",
        { className: "mg-email__body" },
        settings.includeArtwork && digest.playlist.image
          ? h("img", { className: "mg-email__hero", src: digest.playlist.image, alt: "" })
          : null,
        h("h3", null, digest.playlist.name),
        paras.length
          ? paras.map((p, i) => h("p", { key: i }, p))
          : h("p", { className: "mg-email__wait" }, generating ? "Migma is generating…" : "Nothing generated yet."),
        settings.includeTracklist &&
          h(
            "div",
            { className: "mg-email__tl" },
            digest.tracks.slice(0, 5).map((t, i) =>
              h(
                "div",
                { key: i, className: "mg-email__row" },
                h("img", { src: t.image, alt: "", loading: "lazy" }),
                h("span", null, h("b", null, t.name), h("s", null, t.artist)),
                t.preview ? h("span", { title: "30-second preview", style: { fontSize: "9px", color: "#71717a", marginRight: "6px" } }, "▶") : null,
                h("u", null, t.duration)
              )
            )
          ),
        h(
          "span",
          { className: "mg-email__cta", style: { background: kit ? kit.accent : settings.accent || "#1d1e20" } },
          settings.ctaLabel
        )
      ),
      h(
        "div",
        { className: "mg-email__foot" },
        `Sent by ${digest.playlist.owner || "you"} via Migma · Unsubscribe · Update preferences`
      )
    );
  }
  // While a kit is active it owns the accent, so the brand-colour row shows the kit instead of a
  // swatch: offering a colour picker the export would ignore would be a lie. The brand itself is
  // imported from a site through Migma's project-import route rather than picked from a list.
  function BriefPanel(props) {
    const { state, settings, kit, onSetting, onGenerate, onStop, briefText, onBrief, onImportBrand, onClearBrand, onToggleLang } = props;
    const langs = settings.languages || [];
    return h(
      "div",
      null,
      h(U.Field, { label: "Tone" }, h(U.Seg, { value: settings.tone, options: TONES, onChange: v => onSetting({ tone: v }) })),
      h(U.Field, { label: "Length" }, h(U.Seg, { value: settings.length, options: LENGTHS, onChange: v => onSetting({ length: v }) })),
      h(
        U.Field,
        { label: "Call to action" },
        h(U.Input, { value: settings.ctaLabel, onChange: e => onSetting({ ctaLabel: e.target.value }) })
      ),
      h(
        U.Field,
        { label: "Link", hint: "Defaults to the playlist's public URL." },
        h(U.Input, {
          value: settings.ctaUrl,
          placeholder: `https://open.spotify.com/playlist/${state.digest.playlist.id}`,
          onChange: e => onSetting({ ctaUrl: e.target.value })
        })
      ),
      h(
        U.Field,
        {
          label: "Extra languages",
          hint: "Migma returns one email per language. Your brief's own language is always generated."
        },
        h(
          "div",
          { className: "mg-tags" },
          GEN_LANGS.map(code =>
            h(
              U.Chip,
              { key: code, on: langs.includes(code), onClick: () => onToggleLang(code) },
              localeLabel(code)
            )
          )
        )
      ),
      h(
        U.Field,
        { label: "Brand", hint: "Migma reads a site and uses its brand for the email. https only — nothing is stored but the result." },
        kit
          ? h(
              "div",
              { className: "mg-optrow" },
              h(U.Chip, { title: `${kit.name} sets the accent for this campaign` }, kit.name),
              h("button", { type: "button", className: "mg-link", onClick: onClearBrand }, "Clear")
            )
          : h(
              "div",
              { className: "mg-optrow" },
              "Brand colour",
              h("input", {
                type: "color",
                className: "mg-swatch",
                value: settings.accent,
                onChange: e => onSetting({ accent: e.target.value })
              })
            ),
        h(U.Input, {
          value: settings.brandSite,
          placeholder: "https://your-brand.example",
          onChange: e => onSetting({ brandSite: e.target.value })
        }),
        h(
          U.Btn,
          {
            variant: "ghost",
            size: "sm",
            block: true,
            disabled: state.importing || !String(settings.brandSite || "").trim(),
            onClick: () => onImportBrand(settings.brandSite)
          },
          state.importing ? "Importing brand…" : kit ? "Re-import brand" : "Import brand"
        )
      ),
      h(
        "div",
        { className: "mg-optrow" },
        "Include tracklist",
        h(U.Toggle, { on: settings.includeTracklist, label: "Include tracklist", onChange: v => onSetting({ includeTracklist: v }) })
      ),
      h(
        "div",
        { className: "mg-optrow" },
        "Include cover art",
        h(U.Toggle, { on: settings.includeArtwork, label: "Include cover art", onChange: v => onSetting({ includeArtwork: v }) })
      ),
      h(
        U.Field,
        { label: "Brief sent to Migma" },
        h("textarea", { className: "mg-ta", value: briefText, spellCheck: false, onChange: e => onBrief(e.target.value) })
      ),
      h(
        U.Btn,
        { variant: state.generating ? "ghost" : "accent", block: true, onClick: state.generating ? onStop : onGenerate },
        state.generating ? "Stop" : state.emails ? "Regenerate" : "Generate"
      )
    );
  }
  // The bar holds the one choice that belongs to the artifact rather than to the brief — which
  // returned language is on screen — plus the job's live state and anything that failed, reported
  // here so a hiccup never takes the draft down with it.
  function CanvasBar({ state, onEmail, onNotice }) {
    const emails = state.emails || [];
    const opts = emails.map((e, i) => ({
      value: e.emailId,
      label: e.language ? localeLabel(e.language) : emails.length > 1 ? `Email ${i + 1}` : "Generated email"
    }));
    const notice = state.notice;
    return h(
      "div",
      { className: "mg-cbar" },
      h(
        "div",
        { className: "mg-cbar__l" },
        emails.length > 1
          ? h(U.Select, { value: state.emailId, options: opts, size: "sm", ariaLabel: "Preview language", onChange: onEmail })
          : null,
        state.generating
          ? h(U.Chip, { tone: "ai" }, state.jobState ? `Generating · ${state.jobState}` : "Generating…")
          : null
      ),
      h("span", { className: "mg-cbar__sp" }),
      notice
        ? h(
            "div",
            { className: "mg-cbar__note" },
            h(U.Chip, { tone: notice.tone }, notice.label),
            h("span", null, notice.text),
            h("button", { type: "button", className: "mg-x", title: "Dismiss", onClick: () => onNotice(null) }, "×")
          )
        : null
    );
  }

  function RefineView(props) {
    const { state, settings, kit } = props;
    const shown = viewCopy(state);
    const pending = Migma.api.PENDING_MIGMA_API;
    return h(
      "div",
      { className: "mg-canvas" },
      h(CanvasBar, { state, onEmail: props.onEmail, onNotice: props.onNotice }),
      h(
        "div",
        { className: "mg-split" },
        h(
          "div",
          { className: "mg-pane" },
          h(
            "div",
            { className: "mg-tabs", role: "tablist" },
            TABS.map(t =>
              h(
                "button",
                {
                  key: t.value,
                  id: `mg-tab-${t.value}`,
                  type: "button",
                  role: "tab",
                  "aria-selected": t.value === state.tab,
                  className: U.cx(t.value === state.tab && "is-on"),
                  onClick: () => props.onTab(t.value)
                },
                t.label
              )
            )
          ),
          h(
            "div",
            { className: "mg-brief", role: "tabpanel", "aria-labelledby": `mg-tab-${state.tab}` },
            state.tab === "angles"
              ? pending.ideas
                ? h(Pending, {
                    title: "Suggested angles",
                    note: "Migma publishes no endpoint that proposes campaign angles from a playlist yet. Write the brief yourself in the Brief tab — that path is live."
                  })
                : null
              : state.tab === "review"
              ? pending.comments
                ? h(Pending, {
                    title: "Team review",
                    note: "Reviewer assignment and comment threads need a workspace endpoint Migma has not published. Nothing is lost: export the HTML and review it wherever your team already works."
                  })
                : null
              : h(BriefPanel, {
                  state,
                  settings,
                  kit,
                  onSetting: props.onSetting,
                  onGenerate: props.onGenerate,
                  onStop: props.onStop,
                  briefText: props.briefText,
                  onBrief: props.onBrief,
                  onImportBrand: props.onImportBrand,
                  onClearBrand: props.onClearBrand,
                  onToggleLang: props.onToggleLang
                })
          )
        ),
        h(
          "div",
          { className: "mg-preview" },
          h(
            "div",
            { className: "mg-pvbar" },
            h("span", null, state.stale ? "Preview is stale" : state.emails ? "Generated preview" : "Live preview"),
            h(
              "span",
              { className: "mg-pvbar__r" },
              state.emails || shown.body
                ? h(U.Chip, { onClick: () => copy(exportHtml(state, settings, kit)) }, "Copy HTML")
                : null
            )
          ),
          h(EmailPreview, { digest: state.digest, shown, settings, kit, generating: state.generating })
        )
      )
    );
  }
  // Step three is the artifact's receipt: what was generated, where its brand came from, and the
  // two exports that never touch the workspace. Scoring would belong here, but Migma publishes no
  // endpoint for it, so the surface says so plainly rather than show a number it cannot stand behind.
  function ExportView({ state, settings, kit }) {
    const shown = viewCopy(state);
    const email = shown.email;
    const html = () => exportHtml(state, settings, kit);
    const languages = (state.emails || []).map(e => e.language).filter(Boolean);

    return h(
      "div",
      { className: "mg-body" },
      state.done
        ? h(U.StateView, {
            glyph: "✓",
            tone: "accent",
            title: "Campaign exported",
            note: "The HTML is yours to send from Migma or any ESP. Nothing has been sent — the plugin holds no recipient data."
          })
        : null,
      Migma.api.PENDING_MIGMA_API.score
        ? h(Pending, {
            title: "Deliverability scoring",
            note: "Migma has not published a scoring endpoint, so the plugin shows no number it cannot stand behind. The generated copy is ready to export below."
          })
        : null,
      h(
        "div",
        null,
        h(U.Row, { label: "Project", value: settings.projectName || "—" }),
        h(U.Row, { label: "Subject", value: email && email.subject ? email.subject : state.digest.playlist.name }),
        h(U.Row, { label: "Source", value: state.digest.playlist.name }),
        h(U.Row, {
          label: "Tracklist",
          value: settings.includeTracklist ? `5 of ${state.digest.trackCount} shown` : "Not included"
        }),
        languages.length ? h(U.Row, { label: "Languages", value: languages.map(localeLabel).join(", ") }) : null,
        kit ? h(U.Row, { label: "Brand", value: kit.name }) : null,
        email ? null : h(U.Row, { label: "Copy", value: "Local draft — not generated by Migma" })
      ),
      h(
        "div",
        { className: "mg-actions" },
        email && email.screenshotUrl
          ? h(U.Btn, { block: true, onClick: () => openExternal(email.screenshotUrl) }, "Open preview image ↗")
          : null,
        h(U.Btn, { variant: "ghost", block: true, onClick: () => copy(html()) }, "Copy HTML"),
        h(U.Btn, { variant: "ghost", block: true, onClick: () => download(state.digest.playlist.name, html()) }, "Download .html")
      ),
      h(
        "div",
        { className: "mg-body__end" },
        h(
          "p",
          { className: "mg-hint" },
          "Sending, list management and unsubscribe handling stay in Migma. The plugin never holds recipient data."
        )
      )
    );
  }
  function App() {
    const [state, patch] = useReducer(patchReducer, blank);
    const [settings, setSettings] = useState(Migma.store.get);
    const theme = U.useTheme(settings.theme);
    const [progress, setProgress] = useState(null);
    const [briefText, setBriefText] = useState("");
    const briefDirty = useRef(false);
    const abort = useRef(null);
    const importAbort = useRef(null);
    const retry = useRef(null);
    const mounted = useRef(true);
    const seq = useRef({});

    // Every state change that lands after an await is fenced: the app must still be mounted, and
    // the reply must be the newest one asked for on its channel. Navigating between views therefore
    // drops the answers to questions the user has moved on from rather than patching them into
    // whatever is on screen now. Passing a signal adds a third condition — that the request was not
    // cancelled.
    const claim = (key, signal) => {
      const n = (seq.current[key] || 0) + 1;
      seq.current[key] = n;
      return () => mounted.current && seq.current[key] === n && !(signal && signal.aborted);
    };

    // Any transition that abandons a generation cancels it first, rather than leaving the client
    // polling a job for a campaign the user has left.
    const cancelPending = () => {
      if (abort.current) abort.current.abort();
      abort.current = null;
    };

    // A new generation replaces the one in flight, so the controller it displaces is aborted
    // rather than abandoned.
    const takeover = () => {
      cancelPending();
      const ctrl = new AbortController();
      abort.current = ctrl;
      return ctrl;
    };

    const onSetting = useCallback(p => setSettings(Migma.store.set(p)), []);

    // The imported brand is kept in settings in its normalised form, so the preview can be painted
    // on a later visit — and re-normalising it here means a stored kit is validated on every read
    // rather than trusted because it came from local storage.
    const activeKit = useMemo(
      () => (settings.brandKitId ? Migma.api.normKit(settings.brandKit) : null),
      [settings.brandKitId, settings.brandKit]
    );

    // Settings sits outside the sequence, so it remembers the step it was opened from and hands that
    // step back on close rather than dropping the user at the start of the flow.
    const returnTo = useRef("pick");
    const openSettings = () => {
      if (state.view !== "settings") returnTo.current = state.view;
      patch({ view: "settings", error: null });
    };
    const closeSettings = () => patch({ view: returnTo.current || "pick", error: null });

    useEffect(() => {
      mounted.current = true;
      if (Migma.store.isConnected()) bootstrap();
      return () => {
        mounted.current = false;
        cancelPending();
        if (importAbort.current) importAbort.current.abort();
      };
    }, []);
      async function bootstrap() {
      const fresh = claim("boot");
      Migma.api
        .myPlaylists()
        .then(items => fresh() && patch({ playlists: items.map(normPlaylist) }))
        .catch(() => fresh() && patch({ playlists: [] }));

      const src = detectSource();
      if (!src.id) return;
      if (src.kind === "track") {
        setSettings(Migma.store.set({ campaignType: "artist_announce", sourceKind: "track" }));
        analyseTrack(src.id);
        return;
      }
      try {
        const found = normPlaylist(await Migma.api.playlist(src.id));
        if (!fresh()) return;
        patch({ detected: found, source: found });
        if (src.direct) analyse(found);
      } catch (e) {
        /* the picker is still available */
      }
    }

    // Choosing a playlist is what starts the read, so this stays on step one and lets the step's own
    // surface change from the picker to the audience. `reading` is what tells it which: the digest is
    // not there yet but the playlist is, and the list underneath must not come back in the gap.
    async function analyse(source) {
      cancelPending();
      setSettings(Migma.store.set({ sourceKind: "playlist" }));
      patch({
        view: "pick",
        source,
        reading: true,
        digest: null,
        tab: "brief",
        generating: false,
        jobState: "",
        conversationId: "",
        emails: null,
        emailId: "",
        done: false,
        error: null,
        notice: null
      });
      retry.current = () => analyse(source);
      // Two playlists read in quick succession finish in whichever order the network decides, so
      // the digest that lands is the one the user asked for last, not the one that arrived last.
      const fresh = claim("digest");

      const cached = Migma.store.cachedDigest(source.id);
      if (cached) {
        patch({ digest: cached, reading: false });
        return;
      }

      setProgress({ done: 0, total: source.tracks });
      try {
        const [meta, tracks] = await Promise.all([
          Migma.api.playlist(source.id),
          Migma.api.playlistTracks(source.id, (done, total) => fresh() && setProgress({ done, total }))
        ]);
        const index = new Map(
          (await Migma.api.artists(tracks.flatMap(t => (t.artists || []).map(a => a.id)))).map(a => [a.id, a])
        );
        const digest = Migma.metrics.digest(meta, tracks, index);
        // Worth caching either way: the read is done and paid for even if its answer is stale here.
        Migma.store.cacheDigest(source.id, digest);
        if (fresh()) patch({ digest });
      } catch (err) {
        if (fresh()) patch({ error: toError(err) });
      } finally {
        if (fresh()) {
          patch({ reading: false });
          setProgress(null);
        }
      }
    }

    // Going back to the list mid-read must not let the digest that is still on its way resurrect the
    // surface it belongs to, so the read is invalidated on the way out rather than merely ignored.
    function changePlaylist() {
      claim("digest");
      cancelPending();
      setProgress(null);
      patch({ source: null, digest: null, reading: false, error: null });
    }

    const toTrackSource = d => ({
      id: d.playlist.id,
      name: d.playlist.name,
      image: d.playlist.image,
      owner: d.playlist.owner,
      tracks: 1,
      followers: 0
    });

    // Artist announcements can be sourced from a single track, which is read on the same digest
    // channel as a playlist so the newest source wins and the rest of the flow is identical.
    async function analyseTrack(id) {
      cancelPending();
      setSettings(Migma.store.set({ sourceKind: "track" }));
      patch({
        view: "pick",
        source: { id, name: "Track", image: "", owner: "", tracks: 1, followers: 0 },
        reading: true,
        digest: null,
        tab: "brief",
        generating: false,
        jobState: "",
        conversationId: "",
        emails: null,
        emailId: "",
        done: false,
        error: null,
        notice: null
      });
      retry.current = () => analyseTrack(id);
      const fresh = claim("digest");
      const key = `track:${id}`;
      const cached = Migma.store.cachedDigest(key);
      if (cached) {
        patch({ digest: cached, source: toTrackSource(cached), reading: false });
        return;
      }
      try {
        const t = await Migma.api.track(id);
        const index = new Map(
          (await Migma.api.artists((t.artists || []).map(a => a.id))).map(a => [a.id, a])
        );
        const digest = Migma.metrics.trackDigest(t, index);
        Migma.store.cacheDigest(key, digest);
        if (fresh()) patch({ digest, source: toTrackSource(digest) });
      } catch (err) {
        if (fresh()) patch({ error: toError(err) });
      } finally {
        if (fresh()) patch({ reading: false });
      }
    }

    function useCurrentTrack() {
      let id = "";
      try {
        id = trackId(((Spicetify.Player.data || {}).item || {}).uri || "");
      } catch (e) {
        id = "";
      }
      if (!id) {
        Spicetify.showNotification("No track is playing to announce");
        return;
      }
      analyseTrack(id);
    }

    // Playlist pitch reads the artist's track and the curator's playlist, then builds straight into
    // step two: the track is the preview source, the target playlist feeds the pitch brief.
    async function analysePitch(trackUri, targetUri) {
      const tId = trackId(trackUri);
      const pId = playlistId(targetUri);
      if (!tId || !pId) return;
      cancelPending();
      setSettings(Migma.store.set({ sourceKind: "track" }));
      patch({
        view: "pick",
        reading: true,
        source: { id: tId, name: "Track", image: "", owner: "", tracks: 1, followers: 0 },
        digest: null,
        pitchTarget: null,
        emails: null,
        emailId: "",
        done: false,
        error: null,
        notice: null
      });
      retry.current = () => analysePitch(trackUri, targetUri);
      const fresh = claim("digest");
      try {
        const [t, meta, titles] = await Promise.all([
          Migma.api.track(tId),
          Migma.api.playlist(pId),
          Migma.api.playlistTitles(pId, 6)
        ]);
        const index = new Map((await Migma.api.artists((t.artists || []).map(a => a.id))).map(a => [a.id, a]));
        const digest = Migma.metrics.trackDigest(t, index);
        const target = {
          name: meta.name || "the playlist",
          description: String(meta.description || "").replace(/<[^>]*>/g, "").slice(0, 300),
          trackTitles: titles
        };
        if (!fresh()) return;
        setBriefText(Migma.compose.brief(digest, null, settings, { target }));
        briefDirty.current = false;
        patch({ digest, source: toTrackSource(digest), pitchTarget: target, reading: false, view: "refine", tab: "brief", stale: false });
      } catch (err) {
        if (fresh()) patch({ error: toError(err), reading: false });
      }
    }

    // Show promo has no Spotify source — the dates are manual input — so it builds a synthetic
    // digest and the brief from the date list, with no network call.
    function buildShow() {
      const artistName = (settings.showArtist || "").trim() || "the artist";
      const dates = (settings.dates || []).filter(d => d && (d.city || d.venue || d.date));
      const digest = syntheticDigest({ id: "show", name: `${artistName} — Live`, owner: artistName, image: "", tracks: [] });
      cancelPending();
      setBriefText(Migma.compose.brief(digest, null, settings, { artist: artistName, dates }));
      briefDirty.current = false;
      retry.current = buildShow;
      patch({
        view: "refine",
        tab: "brief",
        source: { id: "show", name: `${artistName} — Live`, image: "", tracks: 0, followers: 0 },
        digest,
        pitchTarget: null,
        releases: null,
        emails: null,
        emailId: "",
        done: false,
        error: null,
        stale: false,
        notice: null
      });
    }

    // Label digest fetches each roster artist's releases and keeps the last 7 days — real data, so
    // an empty roster or a quiet week yields an empty release list rather than invented entries.
    async function buildLabel() {
      const label = (settings.labelName || "").trim() || "the label";
      const roster = (settings.roster || []).filter(r => r && r.uri);
      cancelPending();
      patch({
        view: "pick",
        reading: true,
        source: { id: "label", name: `${label} — New This Week`, image: "", tracks: 0, followers: 0 },
        digest: null,
        releases: null,
        emails: null,
        emailId: "",
        done: false,
        error: null,
        notice: null
      });
      retry.current = buildLabel;
      const fresh = claim("digest");
      try {
        const ids = roster.map(r => artistId(r.uri)).filter(Boolean);
        const lists = await Promise.all(ids.map(id => Migma.api.artistAlbums(id).catch(() => [])));
        const releases = Migma.metrics.recentReleases([].concat.apply([], lists), 7);
        const digest = syntheticDigest({
          id: "label",
          name: `${label} — New This Week`,
          owner: label,
          image: (releases[0] || {}).image || "",
          tracks: releases.slice(0, 10).map(r => ({ name: r.title, artist: r.artist, duration: "", image: r.image, url: r.url }))
        });
        if (!fresh()) return;
        setBriefText(Migma.compose.brief(digest, null, settings, { label, releases }));
        briefDirty.current = false;
        patch({ digest, releases, reading: false, view: "refine", tab: "brief", stale: false });
      } catch (err) {
        if (fresh()) patch({ error: toError(err), reading: false });
      }
    }

    // The watch banner's one action: open artist mode with the release pre-filled as a synthetic,
    // brand-new-release digest. No auto-send — it only drafts.
    function draftFromRelease(rel) {
      const next = Migma.store.set({ campaignType: "artist_announce" });
      setSettings(next);
      const digest = syntheticDigest({ id: rel.id, name: rel.title, owner: rel.artist, image: rel.image, tracks: [] });
      digest.single = true;
      digest.eras = rel.date ? [{ label: String(rel.date).slice(0, 4), share: 100 }] : [];
      digest.tags = ["fresh-release"];
      cancelPending();
      setBriefText(Migma.compose.brief(digest, null, next, undefined));
      briefDirty.current = false;
      patch({
        newRelease: null,
        view: "refine",
        tab: "brief",
        source: { id: rel.id, name: rel.title, image: rel.image, tracks: 1, followers: 0 },
        digest,
        pitchTarget: null,
        releases: null,
        emails: null,
        emailId: "",
        done: false,
        error: null,
        stale: false,
        notice: null
      });
    }
      // The type-specific inputs a brief needs beyond the digest, assembled from state and settings.
    const briefContext = () => {
      if (settings.campaignType === "playlist_pitch") return { target: state.pitchTarget };
      if (settings.campaignType === "show_promo") return { artist: (settings.showArtist || "").trim(), dates: settings.dates };
      if (settings.campaignType === "label_digest") return { label: (settings.labelName || "").trim(), releases: state.releases };
      return undefined;
    };

    // Entering step two seeds the brief from the digest and the campaign type. There are no angles
    // to choose first, so the Brief pane is where the step opens.
    function goRefine() {
      briefDirty.current = false;
      setBriefText(Migma.compose.brief(state.digest, null, settings, briefContext()));
      patch({ view: "refine", tab: "brief", stale: false, error: null });
    }

    // While the brief has not been hand-edited it tracks the settings, so changing tone or length
    // rewrites it; once a generation exists, the same settings change marks the preview stale.
    useEffect(() => {
      if (state.view !== "refine" || briefDirty.current || !state.digest) return;
      setBriefText(Migma.compose.brief(state.digest, null, settings, briefContext()));
      if (state.emails && !state.generating) patch({ stale: true });
    }, [settings.tone, settings.length, settings.ctaLabel, settings.campaignType]);

    useEffect(() => {
      if (state.view === "refine" && state.emails && !state.generating) patch({ stale: true });
    }, [settings.includeTracklist, settings.includeArtwork, settings.accent]);

    // Watch runs only while the app is open — there is no background daemon. On open and every 15
    // minutes it reads the artist's releases, baselines on the first poll, and banners exactly once
    // when a newer release id appears. watchSeen is read from the store, not a closure, so a second
    // interval does not re-baseline against a stale value.
    useEffect(() => {
      if (!settings.watchOn) return undefined;
      const id = artistId(settings.watchArtist);
      if (!id) return undefined;
      let active = true;
      const check = async () => {
        try {
          const latest = Migma.metrics.latestRelease(await Migma.api.artistAlbums(id));
          if (!active || !latest || !latest.id) return;
          const seen = Migma.store.get().watchSeen;
          if (!seen) {
            Migma.store.set({ watchSeen: latest.id });
            return;
          }
          if (Migma.metrics.isNewRelease(latest, seen)) {
            Migma.store.set({ watchSeen: latest.id });
            if (active) patch({ newRelease: latest });
          }
        } catch (e) {
          /* best-effort; a failed poll just tries again next interval */
        }
      };
      check();
      const iv = setInterval(check, 15 * 60 * 1000);
      return () => {
        active = false;
        clearInterval(iv);
      };
    }, [settings.watchOn, settings.watchArtist]);

    // Generation is an asynchronous job: this starts it and polls to completion, reporting the
    // job's state through onTick so the bar can say where it is without knowing the cadence. The
    // whole thing is fenced on identity, so a generation the user walked away from is dropped.
    async function generate() {
      const ctrl = takeover();
      const fresh = claim("gen");
      retry.current = generate;
      patch({
        generating: true,
        jobState: "pending",
        error: null,
        stale: false,
        done: false,
        emails: null,
        emailId: "",
        conversationId: "",
        notice: null
      });
      try {
        const { conversationId, emails } = await Migma.api.generate(
          { prompt: briefText, languages: settings.languages || [] },
          { signal: ctrl.signal, onTick: s => fresh() && patch({ jobState: s }) }
        );
        if (!fresh()) return;
        if (!emails.length) {
          patch({
            generating: false,
            jobState: "",
            notice: { tone: "warn", label: "Migma", text: "Generation finished but returned no email." }
          });
          return;
        }
        patch({ generating: false, jobState: "", conversationId, emails, emailId: emails[0].emailId });
      } catch (err) {
        const e = toError(err);
        if (fresh()) patch(e ? { generating: false, jobState: "", error: e } : { generating: false, jobState: "" });
      }
    }

    function stop() {
      cancelPending();
      patch({ generating: false, jobState: "" });
    }
      // A brand import is a slow project operation (documented at 30–60 seconds), so it runs on its
    // own controller and is fenced on mount: its result is the imported brand, stored in settings
    // in normalised form. The inferred brand is untrusted, so normKit has already vetted it.
    async function importBrand(url) {
      const clean = String(url || "").trim();
      if (!clean || state.importing) return;
      if (importAbort.current) importAbort.current.abort();
      const ctrl = new AbortController();
      importAbort.current = ctrl;
      patch({ importing: true, notice: null });
      try {
        const kit = await Migma.api.importBrand(clean, ctrl.signal);
        if (!mounted.current) return;
        if (!kit) {
          patch({
            importing: false,
            notice: { tone: "warn", label: "Brand", text: "Nothing usable came back from that site." }
          });
          return;
        }
        setSettings(Migma.store.set({ brandSite: clean, brandKitId: kit.id, brandKit: kit }));
        patch({ importing: false, notice: { tone: "ok", label: "Brand", text: `Imported ${kit.name}.` } });
      } catch (err) {
        if (!mounted.current) return;
        const e = toError(err);
        patch(e ? { importing: false, notice: { tone: "err", label: "Brand", text: e.message } } : { importing: false });
      }
    }

    function clearBrand() {
      setSettings(Migma.store.set({ brandKitId: "", brandKit: null }));
      if (state.emails) patch({ stale: true });
    }

    function toggleLang(code) {
      const cur = settings.languages || [];
      const next = cur.includes(code) ? cur.filter(c => c !== code) : cur.concat([code]).slice(0, 12);
      onSetting({ languages: next });
      if (state.emails) patch({ stale: true });
    }

    // Starting over keeps the playlist selected but drops everything derived from it, so the picker
    // opens on the last choice rather than on nothing.
    function reset() {
      cancelPending();
      briefDirty.current = false;
      setBriefText("");
      setProgress(null);
      patch({
        view: "pick",
        tab: "brief",
        reading: false,
        digest: null,
        generating: false,
        jobState: "",
        conversationId: "",
        emails: null,
        emailId: "",
        done: false,
        error: null,
        stale: false,
        notice: null
      });
    }

    function ErrorBody() {
      const e = state.error;
      const refused = e.status === 401 || e.status === 403;
      return h(U.StateView, {
        glyph: e.status === 429 ? "⏱" : refused ? "⚿" : "!",
        tone: e.status === 429 ? "warn" : "err",
        title: refused ? "Session refused" : e.status === 429 ? "Slow down a moment" : "Migma didn't respond",
        note: e.message,
        meta: [e.status || "network", e.requestId].filter(Boolean).join(" · "),
        action: refused
          ? h(U.Btn, { size: "sm", onClick: openSettings }, "Check connection")
          : h(
              U.Btn,
              {
                variant: "ghost",
                size: "sm",
                onClick: () => {
                  const again = retry.current;
                  patch({ error: null });
                  if (again) again();
                }
              },
              "Retry"
            )
      });
    }
      const stepIndex = STEP_IDS.indexOf(state.view);
    const connected = Migma.store.isConnected();

    // Movement is backwards only: the rail offers a step already finished, never one not yet
    // reached. A generation or a brand import in flight, and a finished export, all close the rail
    // to jumps — the work in flight belongs to its step, and the receipt describes copy already made.
    const stepTo = i => {
      const to = STEP_IDS[i];
      if (!to || i >= stepIndex || state.done || state.busy || state.generating || state.importing) return;
      cancelPending();
      patch({ view: to, error: null });
    };

    const title =
      state.view === "settings"
        ? "Settings"
        : !connected
        ? "MigmaAI"
        : state.view === "pick"
        ? state.digest
          ? state.digest.playlist.name
          : state.source && state.reading
          ? state.source.name
          : "Pick a playlist"
        : state.view === "refine"
        ? "Choose & refine"
        : state.done
        ? "Campaign ready"
        : "Review & export";

    const subtitle =
      state.view === "settings"
        ? connected
          ? settings.projectName
          : "Not connected"
        : !connected
        ? "Connect a workspace to begin"
        : state.view === "pick"
        ? state.digest
          ? state.digest.single
            ? `Single · ${state.digest.playlist.owner || "release"}`
            : `${state.digest.trackCount} tracks · ${state.digest.artistCount} artists`
          : state.reading
          ? "Reading the audience…"
          : settings.projectName
        : state.view === "refine"
        ? state.digest
          ? state.digest.playlist.name
          : ""
        : state.done
        ? "Exported"
        : "Ready to export";
      let body;
    if (state.error && state.view !== "settings") {
      body = h(ErrorBody);
    } else if (state.view === "settings" || !connected) {
      // Step one owns the connect form: an unconnected workspace has nothing to pick from, so the
      // proxy, the project and the appearance sit exactly where the flow already is.
      body = h(ConnectView, {
        theme: settings.theme,
        settings,
        onSetting,
        onTheme: v => onSetting({ theme: v }),
        onConnected: () => {
          setSettings(Migma.store.get());
          patch({ view: "pick", error: null });
          bootstrap();
        },
        onForget: connected
          ? () => {
              Migma.api.endSession();
              Migma.store.forget();
              setSettings(Migma.store.get());
              patch(Object.assign({}, blank));
            }
          : null
      });
    } else if (state.view === "pick") {
      body = h(PickView, {
        state,
        progress,
        query: state.query,
        settings,
        onSetting,
        campaignType: settings.campaignType,
        onType: v => onSetting({ campaignType: v }),
        onQuery: q => patch({ query: q }),
        onPick: p => analyse(p),
        onTrack: analyseTrack,
        onUseCurrent: useCurrentTrack,
        onBuildPitch: analysePitch,
        onBuildShow: buildShow,
        onBuildLabel: buildLabel,
        onChange: changePlaylist
      });
    } else if (state.view === "refine") {
      body = h(RefineView, {
        state,
        settings,
        kit: activeKit,
        onSetting,
        onGenerate: generate,
        onStop: stop,
        briefText,
        onBrief: v => {
          briefDirty.current = true;
          setBriefText(v);
        },
        onTab: v => patch({ tab: v }),
        onEmail: v => patch({ emailId: v }),
        onNotice: n => patch({ notice: n }),
        onImportBrand: importBrand,
        onClearBrand: clearBrand,
        onToggleLang: toggleLang
      });
    } else {
      body = h(ExportView, { state, settings, kit: activeKit });
    }
    // The spectrum-bordered accent is reserved for the generative action; every other forward
    // action is the monochrome raised primary. The forward action never issues a second request:
    // once a step's work exists, moving forward only changes the surface.
    const actions = {
      pick: h(U.Btn, { size: "sm", disabled: !state.digest, onClick: goRefine }, "Choose & refine"),
      refine: h(
        U.Btn,
        { size: "sm", disabled: state.generating, onClick: () => patch({ view: "export", error: null }) },
        "Review & export"
      ),
      export: state.done
        ? h(U.Btn, { variant: "ghost", size: "sm", onClick: reset }, "Create another")
        : h(U.Btn, { size: "sm", onClick: () => patch({ done: true }) }, "Finish")
    };
    const action = connected && !state.error ? actions[state.view] || null : null;
    const chars =
      state.view === "refine" && state.emails && !state.error ? `${(viewCopy(state).body || "").length} chars` : null;

    return h(
      "div",
      { className: U.cx("mg-app", state.view === "refine" && "is-wide"), "data-mg-theme": theme },
      h(
        "header",
        { className: "mg-head" },
        h("i", { className: "mg-mark" }),
        h("div", { className: "mg-head__t" }, h("b", null, title), h("s", null, subtitle)),
        h(
          "div",
          { className: "mg-head__r" },
          state.generating
            ? h("span", { className: "mg-chip mg-chip--ai" }, h("i", { className: "mg-genmark", "aria-hidden": "true" }), "Generating…")
            : connected && state.view !== "settings"
            ? h("span", { className: "mg-chip mg-chip--ok" }, "Connected")
            : null,
          state.view === "settings"
            ? h(U.Btn, { variant: "ghost", size: "sm", onClick: closeSettings }, "Close")
            : connected
            ? h(U.Btn, { variant: "ghost", size: "sm", onClick: openSettings }, "Settings")
            : null
        )
      ),
      // The rail is the navigation model, so it sits directly under the header. It shows before the
      // workspace is connected too — three words are the clearest thing a first run can be told
      // about what this does. Closing it to jumps means dropping `onJump`, so the steps render as
      // inert text rather than as buttons the guard would silently refuse.
      stepIndex >= 0
        ? h(U.Rail, {
            steps: STEPS,
            index: stepIndex,
            onJump: state.done || state.busy || state.generating || state.importing ? null : stepTo
          })
        : null,
      state.newRelease
        ? h(
            "div",
            { className: "mg-watch" },
            h(U.Chip, { tone: "ai" }, "New release"),
            h("span", { className: "mg-watch__t" }, `New release detected: ${state.newRelease.title}`),
            h(U.Btn, { size: "sm", onClick: () => draftFromRelease(state.newRelease) }, "Draft announcement"),
            h("button", { type: "button", className: "mg-x", title: "Dismiss", onClick: () => patch({ newRelease: null }) }, "×")
          )
        : null,
      h("main", { className: "mg-main" }, body),
      action || chars
        ? h(
            "footer",
            { className: "mg-foot" },
            chars ? h("span", { className: "mg-chip" }, chars) : null,
            h("span", { className: "mg-foot__r" }, action)
          )
        : null
    );
  }

  Migma.App = App;
})();

function render() {
  return Spicetify.React.createElement(Migma.App, null);
}
