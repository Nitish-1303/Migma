window.Migma = window.Migma || {};

(() => {
  const React = Spicetify.React;
  const { useState, useEffect, useRef, useReducer, useCallback, useMemo } = React;
  const U = Migma.ui;
  const h = U.h;
  const F = U.React.Fragment;

  // Three steps, and the sequence is the whole navigation model: pick the playlist, choose and
  // refine the campaign, save it. Each one is a single surface that changes what it shows as the
  // work progresses rather than a screen that hands off to the next, so there is nothing to step
  // through inside a step. Settings sits outside the sequence.
  const STEPS = [
    { value: "pick", label: "Pick a playlist" },
    { value: "refine", label: "Choose & refine" },
    { value: "export", label: "Save & export" }
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
  const TABS = [
    { value: "angles", label: "Angles" },
    { value: "brief", label: "Brief" },
    { value: "review", label: "Review" }
  ];

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
    ideas: null,
    ideaId: null,
    body: "",
    subject: "",
    preheader: "",
    draft: null,
    busy: null,
    error: null,
    streaming: false,
    stale: false,
    query: "",
    tab: "angles",
    reviewers: null,
    kits: null,
    comments: null,
    commentsOff: false,
    commentDraft: "",
    lang: "",
    variants: {},
    translating: false,
    score: null,
    scoring: false,
    notice: null
  };

  const patchReducer = (state, patch) =>
    Object.assign({}, state, typeof patch === "function" ? patch(state) : patch);

  const playlistId = uri => {
    const m = String(uri || "").match(/playlist[:/]([a-zA-Z0-9]+)/);
    return m ? m[1] : "";
  };
  // A handoff carries the entry point's intent: the context menu and the topbar aimed at a
  // specific playlist, so the picker is skipped. An inferred route only preselects it.
  function detectPlaylist() {
    const handoff = Migma.store.takeHandoff();
    if (handoff) return { id: playlistId(handoff.uri), direct: handoff.direct !== false };
    try {
      const fromRoute = playlistId(Spicetify.Platform.History.location.pathname);
      if (fromRoute) return { id: fromRoute, direct: false };
    } catch (e) {
      /* route unavailable during boot */
    }
    const visited = playlistId(Migma.store.lastVisited());
    if (visited) return { id: visited, direct: false };
    try {
      return { id: playlistId((Spicetify.Player.data.context || {}).uri), direct: false };
    } catch (e) {
      return { id: "", direct: false };
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

  const metricsPayload = d => ({
    playlist_id: d.playlist.id,
    track_count: d.trackCount,
    artist_count: d.artistCount,
    avg_popularity: d.avgPopularity,
    genres: d.genres,
    tags: d.tags
  });

  // metrics.js owns the export and stays untouched, so a brand kit is applied to the HTML it
  // returns. These are the literals it writes for a white email; this list is the only place
  // the two files are coupled by value rather than by call.
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

  // Kit colours reach the preview as scoped custom properties, so nothing a workspace authors
  // can touch the app's own theme tokens — only the artifact inside .mg-email.
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

  const composeHtml = (digest, shown, settings, kit) =>
    brandedHtml(
      Migma.compose.emailHtml({ digest, idea: shown.idea, body: shown.body, settings: kitSettings(settings, kit) }),
      kit
    );

  // The canvas previews, exports and saves whichever variant is on screen, so every consumer
  // reads the copy through here instead of reaching for state.body.
  function viewCopy(state) {
    const idea = (state.ideas || []).find(i => i.id === state.ideaId) || null;
    const variant = state.lang ? state.variants[state.lang] : null;
    if (!variant) return { idea, body: state.body, locale: "" };
    return {
      idea: Object.assign({}, idea, {
        subject: variant.subject || (idea && idea.subject) || "",
        preheader: variant.preheader || (idea && idea.preheader) || ""
      }),
      body: variant.body,
      locale: state.lang
    };
  }

  const bandTone = key => (key === "high" || key === "strong" ? "ok" : key === "weak" ? "warn" : null);

  function ConnectView({ theme, onTheme, onConnected, onForget }) {
    const saved = Migma.store.get();
    const [key, setKey] = useState(saved.apiKey);
    const [baseUrl, setBaseUrl] = useState(saved.baseUrl);
    const [projects, setProjects] = useState([]);
    const [projectId, setProjectId] = useState(saved.projectId);
    const [status, setStatus] = useState(null);
    const [busy, setBusy] = useState(false);
    const abort = useRef(null);
    const live = useRef(true);

    // Check key can be pressed again before the first answer arrives, and the project list is what
    // connect() saves against — so the reply to a superseded key is cancelled outright rather than
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
      Migma.store.set({ apiKey: key.trim(), baseUrl: baseUrl.trim() });
      try {
        const list = await Migma.api.projects(ctrl.signal);
        if (!usable()) return;
        setProjects(list);
        setProjectId(list.length ? list[0].id : "");
        setStatus(
          list.length
            ? { kind: "ok", text: `${list.length} project${list.length > 1 ? "s" : ""} found` }
            : { kind: "warn", text: "Key accepted, but this workspace has no projects yet" }
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
        h("h2", { className: "mg-h1" }, "Connect Migma"),
        h(
          "p",
          { className: "mg-sub" },
          "Paste a workspace API key to let Migma read a playlist and draft campaigns against your projects."
        )
      ),
      h(
        "div",
        null,
        h(
          U.Field,
          { label: "API key", hint: "Migma → Settings → Developer → API keys." },
          h(U.Input, {
            type: "password",
            value: key,
            placeholder: "mg_live_…",
            onChange: e => setKey(e.target.value),
            onKeyDown: e => e.key === "Enter" && validate()
          })
        ),
        h(
          U.Field,
          { label: "API base URL" },
          h(U.Input, { value: baseUrl, onChange: e => setBaseUrl(e.target.value) })
        ),
        h(
          U.Btn,
          { variant: "ghost", block: true, disabled: busy || !key.trim(), onClick: validate },
          busy ? "Checking…" : "Check key"
        ),
        status &&
          h("p", { className: cxStatus(status.kind) }, status.text),
        h(
          U.Field,
          {
            label: "Workspace project",
            hint: "Generated campaigns are saved here as drafts."
          },
          h(U.Select, {
            value: projectId,
            disabled: !projects.length,
            onChange: setProjectId,
            options: projects.length
              ? projects.map(p => ({ value: p.id, label: p.name }))
              : [{ value: "", label: "Check your key first" }]
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
        h(
          "p",
          { className: "mg-hint" },
          "The key is stored in this Spotify client's local storage as plain text and is sent only to the base URL above. Use a scoped, revocable key."
        ),
        onForget &&
          h(U.Btn, { variant: "ghost", size: "sm", block: true, onClick: onForget }, "Disconnect and clear key")
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

  // Step one is one surface rather than three screens: choose a playlist and the same surface fills
  // with that playlist's audience. Choosing is what starts the read, so nothing sits between picking
  // a playlist and seeing what Migma will be writing to, and the way back to the list stays on the
  // line that names what was chosen.
  function PickView({ state, progress, query, onQuery, onPick, onChange }) {
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
                ? `${state.digest.trackCount} tracks · ${state.digest.artistCount} artists · ${state.digest.runtimeShort}`
                : "Reading this playlist…"
            )
          ),
          h(U.Btn, { variant: "ghost", size: "sm", onClick: onChange }, "Change")
        ),
        state.digest ? h(Digest, { digest: state.digest }) : h(DigestWait, { progress })
      );

    if (state.playlists && !state.playlists.length && !state.detected)
      return h(U.StateView, {
        glyph: "♪",
        title: "No playlists yet",
        note: "Create or follow a playlist, then come back to build a campaign from it.",
        action: h(
          U.Btn,
          { variant: "ghost", size: "sm", onClick: () => Spicetify.Platform.History.push("/collection/playlists") },
          "Open Your Library"
        )
      });
    return h(
      "div",
      { className: "mg-body" },
      h(
        "header",
        null,
        h("h2", { className: "mg-h2" }, "Pick a playlist"),
        h(
          "p",
          { className: "mg-sub" },
          "A campaign is built from one playlist. Choosing it reads its audience straight away."
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
      )
    );
  }

  // The angles sit in the same pane as the brief, so choosing one is a refinement rather than a
  // screen of its own and the preview beside them never leaves the surface while they are read.
  function AnglesPanel({ state, onSelect, onOwn }) {
    if (!state.ideas)
      return h(
        "div",
        { className: "mg-list" },
        [0, 1, 2].map(i =>
          h(
            "div",
            { key: i, className: "mg-idea" },
            h(U.Skeleton, { width: "52%", height: 14 }),
            h(U.Skeleton, { height: 40 }),
            h(U.Skeleton, { width: "88%" })
          )
        ),
        h("div", { className: "mg-progress" }, h(U.Spinner), h("span", null, "Migma is drafting angles…"))
      );

    if (!state.ideas.length)
      return h(U.StateView, {
        glyph: "∅",
        title: "No angles came back",
        note: "Migma returned an empty set for this digest. Write the brief yourself instead.",
        action: h(U.Btn, { variant: "ghost", size: "sm", onClick: onOwn }, "Write my own brief")
      });
    return h(
      "div",
      { className: "mg-list" },
      state.ideas.map(idea =>
        h(
          "button",
          {
            key: idea.id,
            type: "button",
            className: U.cx("mg-idea", idea.id === state.ideaId && "is-sel"),
            onClick: () => onSelect(idea.id)
          },
          h(
            "span",
            { className: "mg-idea__top" },
            h("b", null, idea.angle),
            idea.confidence && h("i", null, String(idea.confidence).toUpperCase())
          ),
          idea.subject &&
            h("span", { className: "mg-idea__subj" }, idea.subject, idea.preheader && h("s", null, idea.preheader)),
          idea.rationale && h("p", null, idea.rationale),
          h(
            "span",
            { className: "mg-idea__foot" },
            idea.segment &&
              h("span", { className: U.cx("mg-chip", idea.id === state.ideaId && "is-on") }, idea.segment),
            idea.cta && h("span", { className: "mg-chip" }, `CTA · ${idea.cta}`)
          )
        )
      ),
      h("button", { type: "button", className: "mg-link", onClick: onOwn }, "None of these — write my own brief →")
    );
  }

  function EmailPreview({ digest, shown, settings, kit, streaming }) {
    const idea = shown.idea;
    const paras = Migma.compose.paragraphs(shown.body);
    return h(
      "div",
      { className: "mg-email", style: kitVars(kit) },
      h(
        "div",
        { className: "mg-email__subj" },
        h("b", null, idea && idea.subject ? idea.subject : digest.playlist.name),
        idea && idea.preheader && h("s", null, idea.preheader)
      ),
      h(
        "div",
        { className: "mg-email__body" },
        settings.includeArtwork && digest.playlist.image
          ? h("img", { className: "mg-email__hero", src: digest.playlist.image, alt: "" })
          : null,
        h("h3", null, idea && idea.angle ? idea.angle : digest.playlist.name),
        paras.length
          ? paras.map((p, i) =>
              h(
                "p",
                { key: i },
                p,
                streaming && i === paras.length - 1 ? h("i", { className: "mg-caret" }) : null
              )
            )
          : h("p", { className: "mg-email__wait" }, streaming ? h("i", { className: "mg-caret" }) : "Nothing generated yet."),
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

  // The bar holds the two choices that belong to the artifact rather than to the brief — which
  // brand kit paints it and which language it is read in — plus anything Migma could not do,
  // which is reported here so a failed lookup never takes the draft down with it.
  function CanvasBar({ state, settings, kit, onKit, onLang, onTranslate, onNotice }) {
    const kits = state.kits || [];
    const kitOpts = [{ value: "", label: "No brand kit" }].concat(kits.map(k => ({ value: k.id, label: k.name })));
    // A kit saved on an earlier visit stays selectable before the list arrives, so the select
    // never renders blank against a value it does not know yet.
    if (settings.brandKitId && !kits.some(k => k.id === settings.brandKitId))
      kitOpts.push({ value: settings.brandKitId, label: (kit && kit.name) || "Saved brand kit" });

    const locales = [];
    const offer = code => {
      const v = String(code || "").trim();
      if (v && !locales.some(x => x.toLowerCase() === v.toLowerCase())) locales.push(v);
    };
    // Whatever the workspace itself uses comes first; the common set follows so the selector
    // still works for a workspace that has no kits and no default locale.
    kits.forEach(k => (k.locales || []).forEach(offer));
    Object.keys(state.variants).forEach(offer);
    offer(settings.locale);
    Object.keys(LOCALE_NAMES).forEach(offer);

    const langOpts = [{ value: "", label: "Source copy" }].concat(
      locales.map(c => ({ value: c, label: localeLabel(c) }))
    );
    const translated = Boolean(state.lang && state.variants[state.lang]);
    const notice = state.notice;
    return h(
      "div",
      { className: "mg-cbar" },
      h(
        "div",
        { className: "mg-cbar__l" },
        h(U.Select, {
          value: settings.brandKitId,
          options: kitOpts,
          size: "sm",
          ariaLabel: "Brand kit",
          onChange: onKit
        }),
        h(U.Select, {
          value: state.lang,
          options: langOpts,
          size: "sm",
          ariaLabel: "Preview language",
          onChange: onLang
        }),
        state.lang &&
          h(
            U.Chip,
            {
              tone: "ai",
              disabled: state.translating || state.streaming || !state.body,
              title: `Translate the generated copy into ${localeLabel(state.lang)} with Migma`,
              onClick: onTranslate
            },
            state.translating ? "Translating…" : translated ? "Retranslate" : "Translate"
          )
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
        : translated
        ? h("div", { className: "mg-cbar__note" }, "Previewing ", h("b", null, localeLabel(state.lang)))
        : state.lang
        ? h("div", { className: "mg-cbar__note" }, h("b", null, localeLabel(state.lang)), " not translated yet")
        : null
    );
  }

  // Review sits beside the brief rather than in a modal: the point of asking a teammate to look at
  // a campaign is that the campaign stays on screen while you do it. The thread is about the copy,
  // so it lives with the copy — who the draft is handed to is settled at the hand-off, in step three.
  function ReviewPanel({ state, onDraft, onComment, onRetry }) {
    const feed = state.comments;
    return h(
      "div",
      null,
      h("label", { className: "mg-lbl" }, "Team comments"),
      state.commentsOff &&
        h(
          "p",
          { className: "mg-hint mg-hint--flat" },
          "This workspace does not expose a comment thread, so notes stay in this window."
        ),
      h(
        "div",
        { className: "mg-compose" },
        h("textarea", {
          className: "mg-ta mg-ta--sm",
          value: state.commentDraft,
          placeholder: "Leave a note for the reviewer…",
          spellCheck: false,
          onChange: e => onDraft(e.target.value)
        }),
        h(
          U.Btn,
          { variant: "ghost", size: "sm", block: true, disabled: !state.commentDraft.trim(), onClick: onComment },
          "Post comment"
        )
      ),
      feed === null
        ? h("div", { className: "mg-feed" }, h(U.Skeleton, { height: 56 }), h(U.Skeleton, { height: 56 }))
        : feed.length
        ? h(
            "div",
            { className: "mg-feed" },
            feed.map(c =>
              h(U.Comment, {
                key: c.id,
                author: c.author,
                text: c.text,
                at: c.at,
                state: c.state,
                action: c.state === "failed" ? h(U.Chip, { onClick: () => onRetry(c.id) }, "Send again") : null
              })
            )
          )
        : h("p", { className: "mg-hint" }, "No comments yet.")
    );
  }

  // While a kit is active it owns the accent, so the brand-colour row shows the kit instead of a
  // swatch: offering a colour picker the export would ignore would be a lie.
  function BriefPanel({ state, settings, onSetting, onGenerate, onStop, briefText, onBrief, kit }) {
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
        "div",
        { className: "mg-optrow" },
        "Brand colour",
        kit
          ? h(U.Chip, { title: `${kit.name} sets the accent for this campaign` }, kit.name)
          : h("input", {
              type: "color",
              className: "mg-swatch",
              value: settings.accent,
              onChange: e => onSetting({ accent: e.target.value })
            })
      ),
      h(
        "div",
        { className: "mg-optrow" },
        "Include tracklist",
        h(U.Toggle, {
          on: settings.includeTracklist,
          label: "Include tracklist",
          onChange: v => onSetting({ includeTracklist: v })
        })
      ),
      h(
        "div",
        { className: "mg-optrow" },
        "Include cover art",
        h(U.Toggle, {
          on: settings.includeArtwork,
          label: "Include cover art",
          onChange: v => onSetting({ includeArtwork: v })
        })
      ),
      h(
        U.Field,
        { label: "Brief sent to Migma" },
        h("textarea", {
          className: "mg-ta",
          value: briefText,
          spellCheck: false,
          onChange: e => onBrief(e.target.value)
        })
      ),
      h(
        U.Btn,
        {
          variant: state.streaming ? "ghost" : "accent",
          block: true,
          onClick: state.streaming ? onStop : onGenerate
        },
        state.streaming ? "Stop" : state.body ? "Regenerate" : "Generate"
      )
    );
  }
  function RefineView(props) {
    const { state, settings, kit } = props;
    const shown = viewCopy(state);
    const count = (state.comments || []).length;
    return h(
      "div",
      { className: "mg-canvas" },
      h(CanvasBar, props),
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
                t.label,
                t.value === "review" && count ? h("i", null, count) : null
              )
            )
          ),
          h(
            "div",
            { className: "mg-brief", role: "tabpanel", "aria-labelledby": `mg-tab-${state.tab}` },
            state.tab === "angles"
              ? h(AnglesPanel, { state, onSelect: props.onAngle, onOwn: props.onOwnBrief })
              : state.tab === "review"
              ? h(ReviewPanel, {
                  state,
                  onDraft: props.onDraft,
                  onComment: props.onComment,
                  onRetry: props.onRetry
                })
              : h(BriefPanel, {
                  state,
                  settings,
                  kit,
                  onSetting: props.onSetting,
                  onGenerate: props.onGenerate,
                  onStop: props.onStop,
                  briefText: props.briefText,
                  onBrief: props.onBrief
                })
          )
        ),
        h(
          "div",
          { className: "mg-preview" },
          h(
            "div",
            { className: "mg-pvbar" },
            h("span", null, state.stale ? "Preview is stale" : "Live preview"),
            h(
              "span",
              { className: "mg-pvbar__r" },
              state.body &&
                h(U.Chip, { onClick: () => copy(composeHtml(state.digest, shown, settings, kit)) }, "Copy HTML")
            )
          ),
          h(EmailPreview, { digest: state.digest, shown, settings, kit, streaming: state.streaming })
        )
      )
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

  function openExternal(url) {
    try {
      Spicetify.Platform.OpenLinkAPI.openLink(url);
    } catch (e) {
      window.open(url, "_blank");
    }
  }

  // Step three is read before it is acted on: the score, the peak window and what moved the number
  // all sit above the save, and the reviewer the draft is handed to is chosen here rather than back
  // in the brief, because assignment belongs to the hand-off. The card is explicit about where its
  // number came from — Migma's own scorer when the workspace exposes one, otherwise the in-client
  // model, which is an estimate and says so.
  function ExportView({ state, settings, kit, onSetting }) {
    if (state.draft) return h(SavedView, { state, settings, kit });

    const s = state.score;
    const list = state.reviewers || [];
    const opts = [{ value: "", label: "Unassigned" }].concat(
      list.map(r => ({ value: r.id, label: r.role ? `${r.name} · ${r.role}` : r.name }))
    );
    if (settings.reviewerId && !list.some(r => r.id === settings.reviewerId))
      opts.push({ value: settings.reviewerId, label: settings.reviewerId });
    const peak = s ? Math.max(6, ...s.factors.map(f => Math.abs(f.weight))) : 6;

    return h(
      "div",
      { className: "mg-body mg-body--tight" },
      s
        ? h(
            "div",
            { className: "mg-score" },
            h(
              "div",
              { className: "mg-score__top" },
              h("span", { className: "mg-score__n" }, s.probability, h("s", null, "%")),
              h(U.Chip, { tone: bandTone(s.band.key) }, `${s.band.label} conversion probability`)
            ),
            h(U.Meter, { value: s.probability, label: `${s.probability}% conversion probability` }),
            h(
              "p",
              { className: "mg-hint" },
              s.source === "migma"
                ? "Scored by Migma against this workspace's own campaign history."
                : "Estimated in this client from the playlist's signals — the workspace does not expose a scorer."
            )
          )
        : h(
            "div",
            { className: "mg-score" },
            h("div", { className: "mg-score__top" }, h(U.Skeleton, { width: 96, height: 34 }), h(U.Spinner)),
            h(U.Meter, { value: 0, label: "Scoring" }),
            h("p", { className: "mg-hint" }, "Scoring this campaign against the playlist's own signals…")
          ),
      s && s.window
        ? h(
            "div",
            { className: "mg-win" },
            h("span", { className: "mg-win__d" }, s.window.day || "Any day"),
            h(
              "div",
              { className: "mg-win__t" },
              h("b", null, s.window.hours || "No clear hour"),
              h("s", null, s.window.note || "Peak listening window")
            )
          )
        : null,
      s && s.factors.length
        ? h(
            "div",
            null,
            h("label", { className: "mg-lbl" }, "What moved the score"),
            h(
              "div",
              { className: "mg-facs" },
              s.factors.map((f, i) =>
                h(U.Factor, { key: `${f.label}-${i}`, label: f.label, weight: f.weight, note: f.note, peak })
              )
            )
          )
        : null,
      h(
        U.Field,
        {
          label: "Reviewer",
          hint: list.length
            ? "Saved with the draft so Migma can notify them."
            : "Workspace reviewers appear here once Migma returns them."
        },
        h(U.Select, {
          value: settings.reviewerId,
          options: opts,
          disabled: !list.length && !settings.reviewerId,
          ariaLabel: "Reviewer",
          onChange: v => onSetting({ reviewerId: v })
        })
      ),
      h(
        "div",
        { className: "mg-body__end" },
        s && s.confidence ? h(U.Row, { label: "Signal confidence", value: s.confidence }) : null,
        h(
          "p",
          { className: "mg-hint" },
          "A pre-flight estimate, not a guarantee. Nothing is saved or sent until you press Save."
        )
      )
    );
  }

  // Once the draft exists the step becomes its receipt: what was saved, where it went, and the two
  // exports that do not involve the workspace at all.
  function SavedView({ state, settings, kit }) {
    const shown = viewCopy(state);
    const idea = shown.idea;
    const html = () => composeHtml(state.digest, shown, settings, kit);
    const reviewer = (state.reviewers || []).find(r => r.id === settings.reviewerId);
    const extra = Object.keys(state.variants).filter(l => l !== shown.locale);

    return h(
      "div",
      { className: "mg-body" },
      h(U.StateView, {
        glyph: "✓",
        tone: "accent",
        title: "Draft saved to Migma",
        note: "Review, add your list and send from Migma. Nothing has been sent yet."
      }),
      h(
        "div",
        null,
        h(U.Row, { label: "Project", value: settings.projectName || "—" }),
        h(U.Row, { label: "Subject", value: idea && idea.subject ? idea.subject : state.digest.playlist.name }),
        h(U.Row, { label: "Segment", value: (idea && idea.segment) || "Not set" }),
        h(U.Row, { label: "Source", value: state.digest.playlist.name }),
        h(U.Row, {
          label: "Tracklist",
          value: settings.includeTracklist ? `5 of ${state.digest.trackCount} shown` : "Not included"
        }),
        shown.locale || extra.length
          ? h(U.Row, { label: "Language", value: shown.locale ? localeLabel(shown.locale) : "Source copy" })
          : null,
        extra.length ? h(U.Row, { label: "Also saved in", value: extra.map(localeLabel).join(", ") }) : null,
        kit ? h(U.Row, { label: "Brand kit", value: kit.name }) : null,
        settings.reviewerId
          ? h(U.Row, { label: "Reviewer", value: reviewer ? reviewer.name : settings.reviewerId })
          : null,
        state.score
          ? h(U.Row, { label: "Pre-flight", value: `${state.score.probability}% · ${state.score.band.label}` })
          : null
      ),
      h(
        "div",
        { className: "mg-actions" },
        state.draft && state.draft.url
          ? h(U.Btn, { block: true, onClick: () => openExternal(state.draft.url) }, "Open in Migma ↗")
          : null,
        h(U.Btn, { variant: "ghost", block: true, onClick: () => copy(html()) }, "Copy HTML"),
        h(U.Btn, { variant: "ghost", block: true, onClick: () => download(state.digest.playlist.name, html()) }, "Download .html")
      ),
      h(
        "div",
        { className: "mg-body__end" },
        h("p", { className: "mg-hint" }, "Sending, list management and unsubscribe handling stay in Migma. The plugin never holds recipient data.")
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
    const canvasAbort = useRef(null);
    const flushTimer = useRef(null);
    const retry = useRef(null);
    const mounted = useRef(true);
    const seq = useRef({});

    // Every state change that lands after an await is fenced: the app must still be mounted, and
    // the reply must be the newest one asked for on its channel. Navigating between views therefore
    // drops the answers to questions the user has moved on from rather than patching them into
    // whatever is on screen now. Passing a signal adds a third condition — that the request was not
    // cancelled — and is used only on the workspace channels, where a cancelled read must not be
    // reported as a capability the plan does not have.
    const claim = (key, signal) => {
      const n = (seq.current[key] || 0) + 1;
      seq.current[key] = n;
      return () => mounted.current && seq.current[key] === n && !(signal && signal.aborted);
    };

    // Any transition that abandons what a generative call was filling cancels it first, rather than
    // leaving the client holding a stream open and decoding copy for a campaign the user has left.
    // The coalescing timer goes with it: it outlives the request that scheduled it.
    const cancelPending = () => {
      if (abort.current) abort.current.abort();
      abort.current = null;
      if (flushTimer.current) clearTimeout(flushTimer.current);
      flushTimer.current = null;
    };

    // A new call on the generative channel replaces the one in flight, so the controller it
    // displaces is aborted rather than abandoned.
    const takeover = () => {
      cancelPending();
      const ctrl = new AbortController();
      abort.current = ctrl;
      return ctrl;
    };

    const onSetting = useCallback(p => setSettings(Migma.store.set(p)), []);

    // The chosen kit is kept in settings in its normalised form, so the preview can be painted on
    // a later visit before the workspace list arrives — and re-normalising it here means a stored
    // kit is validated on every read rather than trusted because it came from local storage.
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
      // An unconnected client already stands on step one, whose surface is the connect form, so
      // there is no separate screen to send it to — the sequence is the same one either way.
      if (Migma.store.isConnected()) bootstrap();
      // Returned on both paths. An app that mounts straight onto the connect form still has to
      // tear down cleanly, and the flush timer outlives the request that scheduled it.
      return () => {
        mounted.current = false;
        cancelPending();
        if (canvasAbort.current) canvasAbort.current.abort();
      };
    }, []);

    async function bootstrap() {
      const fresh = claim("boot");
      Migma.api
        .myPlaylists()
        .then(items => fresh() && patch({ playlists: items.map(normPlaylist) }))
        .catch(() => fresh() && patch({ playlists: [] }));

      const { id, direct } = detectPlaylist();
      if (!id) return;
      try {
        const found = normPlaylist(await Migma.api.playlist(id));
        if (!fresh()) return;
        patch({ detected: found, source: found });
        if (direct) analyse(found);
      } catch (e) {
        /* the picker is still available */
      }
    }

    // Choosing a playlist is what starts the read, so this stays on step one and lets the step's own
    // surface change from the picker to the audience. `reading` is what tells it which: the digest is
    // not there yet but the playlist is, and the list underneath must not come back in the gap.
    async function analyse(source) {
      cancelPending();
      patch({
        view: "pick",
        source,
        reading: true,
        digest: null,
        ideas: null,
        ideaId: null,
        body: "",
        streaming: false,
        draft: null,
        error: null,
        comments: null,
        commentsOff: false,
        commentDraft: "",
        variants: {},
        lang: "",
        score: null,
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

    // Angles are the first thing step two shows, so the request goes out on the way in and the pane
    // is already filling when it lands. The brief is seeded from the angle Migma ranked first, so
    // switching to it never finds an empty textarea.
    async function loadIdeas() {
      briefDirty.current = false;
      setBriefText(Migma.compose.brief(state.digest, null, settings));
      patch({
        view: "refine",
        tab: "angles",
        ideas: null,
        ideaId: null,
        body: "",
        streaming: false,
        stale: false,
        draft: null,
        error: null,
        comments: null,
        commentsOff: false,
        commentDraft: "",
        variants: {},
        lang: "",
        score: null,
        notice: null
      });
      retry.current = loadIdeas;
      const ctrl = takeover();
      const fresh = claim("ideas");
      try {
        const list = await Migma.api.ideas(state.digest, ctrl.signal);
        if (!fresh()) return;
        const first = list.length ? list[0] : null;
        if (!briefDirty.current) setBriefText(Migma.compose.brief(state.digest, first, settings));
        patch({ ideas: list, ideaId: first ? first.id : null });
      } catch (err) {
        const e = toError(err);
        if (e && fresh()) patch({ error: e, ideas: [] });
      }
    }

    // Choosing an angle stays inside step two and moves to the brief, because the brief is written
    // from the angle — there is nothing to open. A stream still running belongs to the angle being
    // left, so it is cancelled here rather than allowed to write copy into this one.
    function chooseAngle(ideaId) {
      const idea = (state.ideas || []).find(i => i.id === ideaId) || null;
      cancelPending();
      briefDirty.current = false;
      setBriefText(Migma.compose.brief(state.digest, idea, settings));
      patch({
        tab: "brief",
        ideaId: ideaId || null,
        body: "",
        streaming: false,
        stale: false,
        draft: null,
        error: null,
        comments: null,
        commentsOff: false,
        commentDraft: "",
        variants: {},
        lang: "",
        score: null,
        notice: null
      });
    }

    // Reviewers and brand kits are optional capabilities: a workspace without them must not make
    // step two look broken, so a failed lookup degrades to an empty list and is reported in the
    // canvas bar rather than in the error view, which would discard the draft.
    async function loadWorkspace(signal) {
      const fresh = claim("workspace", signal);
      const people = Migma.store.cachedWorkspace("reviewers");
      const kits = Migma.store.cachedWorkspace("kits");
      if (people) patch({ reviewers: people });
      if (kits) patch({ kits });
      if (people && kits) return;

      const jobs = [];
      if (!people)
        jobs.push(
          Migma.api.reviewers(signal).then(
            list => {
              Migma.store.cacheWorkspace("reviewers", list);
              if (fresh()) patch({ reviewers: list });
            },
            () => {
              if (!fresh()) return null;
              patch({ reviewers: [] });
              return "Reviewers";
            }
          )
        );
      if (!kits)
        jobs.push(
          Migma.api.brandKits(signal).then(
            list => {
              Migma.store.cacheWorkspace("kits", list);
              if (fresh()) patch({ kits: list });
            },
            () => {
              if (!fresh()) return null;
              patch({ kits: [] });
              return "Brand kits";
            }
          )
        );

      const failed = (await Promise.all(jobs)).filter(Boolean);
      if (failed.length && fresh())
        patch({
          notice: {
            tone: "warn",
            label: "Workspace",
            text: `${failed.join(" and ")} unavailable on this plan — everything else still works.`
          }
        });
    }

    useEffect(() => {
      if (state.view !== "refine" || briefDirty.current || !state.digest) return;
      const idea = (state.ideas || []).find(i => i.id === state.ideaId) || null;
      setBriefText(Migma.compose.brief(state.digest, idea, settings));
      if (state.body && !state.streaming) patch({ stale: true });
    }, [settings.tone, settings.length, settings.ctaLabel]);

    useEffect(() => {
      if (state.view === "refine" && state.body && !state.streaming) patch({ stale: true });
    }, [settings.includeTracklist, settings.includeArtwork, settings.accent]);

    // The collaboration surfaces are fetched when step two opens rather than at start-up, so a user
    // who only ever exports HTML never touches the workspace endpoints at all. The thread is keyed
    // on the angle, so choosing a different one loads that angle's own notes.
    useEffect(() => {
      if (state.view !== "refine") return undefined;
      const ctrl = new AbortController();
      canvasAbort.current = ctrl;
      loadWorkspace(ctrl.signal);
      loadComments(ctrl.signal);
      // Leaving step two, or switching angle, cancels the reads this visit opened instead of
      // leaving them to resolve against a surface that is no longer on screen.
      return () => ctrl.abort();
    }, [state.view, state.ideaId]);

    const threadOf = s => Migma.api.threadKey(s.digest ? s.digest.playlist.id : "", s.ideaId);
    const thread = () => threadOf(state);

    async function loadComments(signal) {
      if (state.commentsOff) return;
      const fresh = claim("comments", signal);
      try {
        const list = await Migma.api.comments(thread(), signal);
        if (!fresh()) return;
        // Anything still carrying a local state has not been accepted yet, so it survives the
        // refresh instead of being replaced by a thread that does not contain it.
        patch(s => ({ comments: list.concat((s.comments || []).filter(c => c.state)), commentsOff: false }));
      } catch (err) {
        if (fresh()) patch(s => ({ comments: s.comments || [], commentsOff: true }));
      }
    }

    // A note joins the feed the moment it is written and keeps its text whatever the network does,
    // so nothing typed is lost to a failed request. The author stays whoever wrote it locally
    // rather than whatever the echo happens to contain.
    async function post(entry) {
      // A note is a write, so it is not one of the requests the canvas cancels: aborting it in
      // flight would show a note the workspace may already have accepted as not sent. It is fenced
      // on mount only, and it addresses one note by id, so a thread that has moved on does not
      // contain it and the update is a no-op. The failure notice is held to the thread it belongs
      // to, read from live state rather than from this closure.
      const at = thread();
      try {
        const saved = await Migma.api.postComment(at, entry.text);
        if (!mounted.current) return;
        patch(s => ({
          comments: (s.comments || []).map(c =>
            c.id === entry.id
              ? { id: saved.id || entry.id, author: entry.author, text: saved.text || entry.text, at: saved.at }
              : c
          )
        }));
      } catch (err) {
        if (!mounted.current) return;
        patch(s => ({
          comments: (s.comments || []).map(c => (c.id === entry.id ? Object.assign({}, c, { state: "failed" }) : c)),
          notice:
            threadOf(s) === at
              ? { tone: "err", label: "Comment", text: "Migma did not accept the note — it is still here, send it again." }
              : s.notice
        }));
      }
    }

    function sendComment() {
      const text = state.commentDraft.trim();
      if (!text) return;
      const entry = { id: `local-${Date.now()}`, author: "You", text, at: "", state: "pending" };
      patch(s => ({ comments: (s.comments || []).concat([entry]), commentDraft: "" }));
      post(entry);
    }

    function retryComment(id) {
      const entry = (state.comments || []).find(c => c.id === id);
      if (!entry) return;
      patch(s => ({
        comments: (s.comments || []).map(c => (c.id === id ? Object.assign({}, c, { state: "pending" }) : c)),
        notice: null
      }));
      post(entry);
    }

    function pickKit(id) {
      const kit = (state.kits || []).find(k => k.id === id) || null;
      onSetting({ brandKitId: kit ? kit.id : "", brandKit: kit });
    }

    async function generate() {
      const ctrl = takeover();
      // Fenced on identity alone rather than on the signal: an aborted stream still has to clear
      // the streaming flag and keep whatever copy arrived, and only a newer generate may overwrite
      // the body it produced.
      const fresh = claim("body");
      retry.current = generate;
      // Translations belong to the copy that produced them, so a new body clears them rather than
      // leaving a Spanish variant of a campaign that no longer exists.
      patch({
        streaming: true,
        body: "",
        error: null,
        stale: false,
        draft: null,
        variants: {},
        lang: "",
        score: null,
        notice: null
      });

      let pending = "";
      // The coalescing timer is held in a ref so teardown can clear it: a flush scheduled by the
      // last delta of a finished stream would otherwise fire into an unmounted tree.
      const clearFlush = () => {
        if (flushTimer.current) clearTimeout(flushTimer.current);
        flushTimer.current = null;
      };
      const flush = () => {
        flushTimer.current = null;
        if (fresh()) patch({ body: pending });
      };

      try {
        const res = await Migma.api.generate(briefText, {
          signal: ctrl.signal,
          onDelta: (_, full) => {
            pending = full;
            if (!flushTimer.current) flushTimer.current = setTimeout(flush, 60);
          }
        });
        clearFlush();
        if (fresh()) patch({ streaming: false, body: res.text || pending });
      } catch (err) {
        clearFlush();
        const e = toError(err);
        if (fresh()) patch(e ? { streaming: false, body: pending, error: e } : { streaming: false, body: pending });
      }
    }
    function stop() {
      cancelPending();
      patch({ streaming: false });
    }

    // Every translation runs from the source copy rather than from another translation, so a second
    // language cannot inherit the drift of the first.
    async function translate(locale) {
      if (!locale || !state.body || state.translating) return;
      const idea = (state.ideas || []).find(i => i.id === state.ideaId) || null;
      const d = state.digest;
      const src = state.body;
      const signal = canvasAbort.current ? canvasAbort.current.signal : undefined;
      // Fenced on identity rather than on the signal: a translation that resolved just before the
      // canvas closed is still the translation of the copy that is on screen, so it is kept, and a
      // cancellation is reported by the catch below instead — which is what clears the flag.
      const fresh = claim("translate");
      patch({ translating: true, notice: null });
      try {
        const out = await Migma.api.translate(
          {
            locale,
            subject: idea && idea.subject ? idea.subject : d.playlist.name,
            preheader: idea ? idea.preheader : "",
            body: state.body
          },
          signal
        );
        if (!fresh()) return;
        if (!out.body) {
          patch({
            translating: false,
            notice: { tone: "warn", label: "Translation", text: `Migma returned no copy for ${localeLabel(locale)}.` }
          });
          return;
        }
        // A variant is only kept if the copy it was made from is still the copy on screen: a
        // translation that lands after Regenerate has replaced the body describes a campaign that
        // no longer exists.
        patch(s =>
          s.body === src
            ? {
                translating: false,
                lang: locale,
                variants: Object.assign({}, s.variants, {
                  [locale]: { subject: out.subject, preheader: out.preheader, body: out.body }
                }),
                // A paraphrased merge token means a dead link in the send, so it is named rather
                // than silently accepted.
                notice: out.lostTokens.length
                  ? {
                      tone: "warn",
                      label: "Merge tokens",
                      text: `${out.lostTokens.join(", ")} did not survive the translation — restore before sending.`
                    }
                  : null
              }
            : { translating: false }
        );
      } catch (err) {
        // The flag is cleared on any outcome the app is still mounted for, cancellation included,
        // so leaving the canvas mid-translation cannot leave Translate disabled for the session.
        if (!mounted.current) return;
        const e = toError(err);
        patch(s => ({
          translating: false,
          notice: e ? { tone: "err", label: "Translation", text: e.message } : s.notice
        }));
      }
    }

    // Step three scores the campaign on the way in, so the number, the peak window and the reviewer
    // are all read before the save is pressed rather than after it.
    async function preflight() {
      const d = state.digest;
      const shown = viewCopy(state);
      const idea = shown.idea;
      const ctrl = takeover();
      const fresh = claim("score");
      retry.current = preflight;
      patch({ view: "export", score: null, scoring: true, error: null });
      try {
        const score = await Migma.api.score(
          d,
          {
            subject: idea && idea.subject ? idea.subject : d.playlist.name,
            body: shown.body,
            segment: idea ? idea.segment : "",
            locale: shown.locale,
            metrics: metricsPayload(d)
          },
          ctrl.signal
        );
        if (fresh()) patch({ score, scoring: false });
      } catch (err) {
        if (!fresh()) return;
        const e = toError(err);
        patch(e ? { scoring: false, error: e } : { scoring: false });
      }
    }

    async function save() {
      const d = state.digest;
      const shown = viewCopy(state);
      const idea = shown.idea;
      patch({ busy: "Saving draft…", error: null });
      retry.current = save;
      // The save is a write, so it is never cancelled and its result is fenced on mount only. The
      // notification stays outside the fence: if the draft reached the workspace, that is true
      // whether or not the panel is still open to hear it.
      try {
        const record = await Migma.api.saveDraft({
          name: `${d.playlist.name} — ${idea ? idea.angle : "campaign"}`,
          subject: idea && idea.subject ? idea.subject : d.playlist.name,
          preheader: idea ? idea.preheader : "",
          segment: idea ? idea.segment : "",
          body: shown.body,
          html: composeHtml(d, shown, settings, activeKit),
          locale: shown.locale || settings.locale || "",
          reviewer_id: settings.reviewerId || "",
          brand_kit_id: activeKit ? activeKit.id : "",
          // Whatever is on screen is saved as the campaign; every other variant travels with it so
          // the workspace holds the same set of languages the canvas did.
          translations: Object.keys(state.variants)
            .filter(l => l !== shown.locale)
            .map(l => Object.assign({ locale: l }, state.variants[l])),
          preflight: state.score
            ? {
                probability: state.score.probability,
                band: state.score.band.key,
                source: state.score.source,
                window: state.score.window,
                confidence: state.score.confidence,
                factors: state.score.factors
              }
            : null,
          metrics: metricsPayload(d)
        });
        if (mounted.current) patch({ draft: record, busy: null });
        Spicetify.showNotification("Draft saved to Migma");
      } catch (err) {
        if (mounted.current) patch({ busy: null, error: toError(err) });
      }
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
        tab: "angles",
        reading: false,
        digest: null,
        ideas: null,
        ideaId: null,
        body: "",
        streaming: false,
        draft: null,
        error: null,
        stale: false,
        comments: null,
        commentsOff: false,
        commentDraft: "",
        variants: {},
        lang: "",
        score: null,
        notice: null
      });
    }

    function ErrorBody() {
      const e = state.error;
      const badKey = e.status === 401 || e.status === 403;
      return h(U.StateView, {
        glyph: e.status === 429 ? "⏱" : badKey ? "⚿" : "!",
        tone: e.status === 429 ? "warn" : "err",
        title: badKey ? "Key no longer valid" : e.status === 429 ? "Slow down a moment" : "Migma didn't respond",
        note: e.message,
        meta: [e.status || "network", e.requestId].filter(Boolean).join(" · "),
        action: badKey
          ? h(U.Btn, { size: "sm", onClick: openSettings }, "Update key")
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
    const selected = (state.ideas || []).find(i => i.id === state.ideaId);
    const connected = Migma.store.isConnected();

    // Movement is backwards only: the rail offers a step already finished, never one not yet
    // reached. Leaving a step abandons whatever it had asked for, so the request is cancelled here
    // and the streaming flag goes with it rather than being cleared a tick later by the catch.
    const stepTo = i => {
      const to = STEP_IDS[i];
      // A write in flight is never cancelled, so there is nowhere to step to while one is running:
      // its result belongs to the step that issued it.
      if (!to || i >= stepIndex || state.draft || state.busy) return;
      cancelPending();
      patch({ view: to, streaming: false, error: null });
    };

    const title =
      state.view === "settings"
        ? "Settings"
        : !connected
        ? "Migma"
        : state.view === "pick"
        ? state.digest
          ? state.digest.playlist.name
          : state.source && state.reading
          ? state.source.name
          : "Pick a playlist"
        : state.view === "refine"
        ? selected
          ? selected.angle
          : "Choose & refine"
        : state.draft
        ? "Campaign ready"
        : "Save & export";

    const subtitle =
      state.view === "settings"
        ? connected
          ? settings.projectName
          : "Not connected"
        : !connected
        ? "Connect a workspace to begin"
        : state.view === "pick"
        ? state.digest
          ? `${state.digest.trackCount} tracks · ${state.digest.artistCount} artists`
          : state.reading
          ? "Reading the audience…"
          : settings.projectName
        : state.view === "refine"
        ? state.digest
          ? state.digest.playlist.name
          : ""
        : state.draft
        ? "Saved as draft"
        : state.score
        ? state.score.source === "migma"
          ? "Scored by Migma"
          : "In-client estimate"
        : "Scoring…";

    let body;
    if (state.error && state.view !== "settings") {
      body = h(ErrorBody);
    } else if (state.view === "settings" || !connected) {
      // Step one owns the connect form: an unconnected workspace has nothing to pick from, so the
      // key, the project and the appearance sit exactly where the flow already is.
      body = h(ConnectView, {
        theme: settings.theme,
        onTheme: v => onSetting({ theme: v }),
        onConnected: () => {
          setSettings(Migma.store.get());
          patch({ view: "pick", error: null });
          bootstrap();
        },
        onForget: connected
          ? () => {
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
        onQuery: q => patch({ query: q }),
        onPick: p => analyse(p),
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
        onAngle: chooseAngle,
        onOwnBrief: () => chooseAngle(null),
        onKit: pickKit,
        onLang: v => patch({ lang: v }),
        onTranslate: () => translate(state.lang),
        onNotice: n => patch({ notice: n }),
        onDraft: v => patch({ commentDraft: v }),
        onComment: sendComment,
        onRetry: retryComment
      });
    } else {
      body = h(ExportView, { state, settings, kit: activeKit, onSetting });
    }

    // The spectrum-bordered accent is reserved for the two actions that invoke Migma's
    // generative side; every other forward action is the monochrome raised primary. Once angles
    // exist, step one's forward action is a way back to them rather than a second request — a
    // back-jump taken to re-read the audience must not cost the copy already written.
    const actions = {
      pick: state.ideas
        ? h(U.Btn, { size: "sm", onClick: () => patch({ view: "refine", error: null }) }, "Continue")
        : h(
            U.Btn,
            { variant: "accent", size: "sm", disabled: !state.digest, onClick: loadIdeas },
            "Choose an angle"
          ),
      refine: h(
        U.Btn,
        { size: "sm", disabled: !state.body || state.streaming, onClick: preflight },
        "Pre-flight & save"
      ),
      export: state.draft
        ? h(U.Btn, { variant: "ghost", size: "sm", onClick: reset }, "Create another")
        : h(
            U.Btn,
            { size: "sm", disabled: state.scoring || Boolean(state.busy), onClick: save },
            state.busy || "Save to Migma"
          )
    };
    const action = connected && !state.error ? actions[state.view] || null : null;
    const chars = state.view === "refine" && state.body && !state.error ? `${state.body.length} chars` : null;

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
          state.streaming
            ? h("span", { className: "mg-chip mg-chip--ai" }, "Generating…")
            : connected && state.view !== "settings"
            ? h("span", { className: "mg-chip mg-chip--ok" }, "Connected")
            : null,
          // Nothing to open before a workspace is connected: step one is already showing the same
          // form, so a Settings button there would lead back to where it was pressed.
          state.view === "settings"
            ? h(U.Btn, { variant: "ghost", size: "sm", onClick: closeSettings }, "Close")
            : connected
            ? h(U.Btn, { variant: "ghost", size: "sm", onClick: openSettings }, "Settings")
            : null
        )
      ),
      // The rail is the navigation model, so it sits directly under the header rather than in the
      // footer: the three names are read on the way in, and a finished step is the way back to it.
      // It shows before the workspace is connected too — three words are the clearest thing a first
      // run can be told about what this does. A write in flight and a saved draft both close it to
      // jumps: the receipt describes copy that has already left, and a write's result belongs to the
      // step that issued it. Closing it means dropping `onJump`, so the steps render as inert text
      // rather than as buttons the guard would silently refuse.
      stepIndex >= 0
        ? h(U.Rail, { steps: STEPS, index: stepIndex, onJump: state.draft || state.busy ? null : stepTo })
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

