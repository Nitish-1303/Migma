// Client integration tests. The plugin's scripts are browser IIFEs, so they load here under
// minimal Spicetify/fetch stubs and are exercised the way the app drives them. No network, no key.
// Run: node --test CustomApps/migma/test/
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const assert = require("node:assert/strict");

const dir = path.join(__dirname, "..");
const store = {};
const seen = [];
let polls = 0;

// Instant timers so the polling backoff does not slow the suite.
const realSetTimeout = global.setTimeout;
global.setTimeout = fn => { fn(); return 0; };
global.clearTimeout = () => {};
global.document = { createElement: () => ({ click() {}, setAttribute() {}, appendChild() {}, classList: { add() {}, toggle() {} }, style: {} }) };
global.window = global;

global.Spicetify = {
  React: {
    createElement: (type, props, ...kids) => ({ type, props: props || {}, kids }),
    Fragment: "Fragment",
    useState: v => [typeof v === "function" ? v() : v, () => {}],
    useEffect: () => {},
    useRef: v => ({ current: v }),
    useReducer: (r, i) => [i, () => {}],
    useCallback: f => f,
    useMemo: f => f()
  },
  LocalStorage: { get: k => (k in store ? store[k] : null), set: (k, v) => { store[k] = v; } },
  CosmosAsync: { get: async () => ({ items: [], artists: [], total: 0 }) },
  Platform: { AuthorizationAPI: { getState: () => ({ accessToken: "spotify-token" }) } },
  showNotification: () => {}
};

global.fetch = async (url, opts = {}) => {
  const u = new URL(url);
  const p = u.pathname + u.search;
  seen.push((opts.method || "GET") + " " + p);
  const json = body => ({ ok: true, status: 200, headers: new Map(), json: async () => body });
  if (p === "/session") return json({ success: true, data: { token: "ms1.a.b", expires_in: 900 } });
  if (p === "/v1/projects") return json({ success: true, data: [{ id: "proj1", name: "Launch" }] });
  if (p === "/v1/projects/import")
    return json({ success: true, data: { brand: { id: "acme", name: "Acme", accent: "#2b50aa", paper: "#ffffff" } } });
  if (p === "/v1/projects/emails/generate")
    return json({ success: true, data: { conversationId: "c1", status: "pending" } });
  if (p.startsWith("/v1/projects/emails/c1/status")) {
    polls++;
    if (polls < 2) return json({ success: true, data: { status: "pending" } });
    return json({
      success: true,
      data: { status: "completed", result: { emails: [
        { emailId: "e-en", language: "en", subject: "Your weekly mix", html: "<p>Hi.</p><p>Enjoy.</p>" },
        { emailId: "e-es", language: "es", subject: "Tu mezcla", html: "<p>Hola.</p>" }
      ] } }
    });
  }
  return { ok: false, status: 404, headers: new Map(), json: async () => ({ success: false, error: "no route" }) };
};

const load = f => vm.runInThisContext(fs.readFileSync(path.join(dir, f), "utf8"), { filename: f });
load("store.js");
load("api.js");
load("metrics.js");
load("ui.js");
load("index.js");
const M = global.Migma;
M.store.set({ proxyUrl: "https://proxy.example", projectId: "proj1" });

test.after(() => { global.setTimeout = realSetTimeout; });

test("ENDPOINTS names only routes the proxy serves", () => {
  const e = M.api.ENDPOINTS;
  assert.equal(e.projects, "/v1/projects");
  assert.equal(e.import, "/v1/projects/import");
  assert.equal(e.generate, "/v1/projects/emails/generate");
  assert.equal(e.status("c1"), "/v1/projects/emails/c1/status");
  for (const fake of ["ideas", "score", "translate", "reviewers", "comments", "save", "brandKits"]) {
    assert.ok(!(fake in e), `${fake} must not be an endpoint`);
  }
  for (const fn of ["ideas", "translate", "score", "saveDraft", "reviewers", "comments", "brandKits"]) {
    assert.equal(typeof M.api[fn], "undefined", `${fn}() must be gone`);
  }
});

test("PENDING_MIGMA_API names the capabilities with no endpoint", () => {
  assert.deepEqual(
    Object.keys(M.api.PENDING_MIGMA_API).sort(),
    ["comments", "ideas", "reviewers", "score", "translate"]
  );
  assert.ok(Object.isFrozen(M.api.PENDING_MIGMA_API));
});

test("generate runs as an async job and polls to completion", async () => {
  const ticks = [];
  const out = await M.api.generate({ prompt: "Write it", languages: ["es"] }, { onTick: s => ticks.push(s) });
  assert.equal(out.conversationId, "c1");
  assert.equal(out.emails.length, 2);
  assert.equal(out.emails[0].subject, "Your weekly mix");
  assert.ok(ticks.includes("pending") && ticks.includes("completed"));
  assert.ok(seen.includes("POST /v1/projects/emails/generate"));
  assert.ok(seen.some(s => s.startsWith("GET /v1/projects/emails/c1/status")));
});

test("importBrand normalises the inferred brand through normKit", async () => {
  const kit = await M.api.importBrand("https://acme.example");
  assert.equal(kit.id, "acme");
  assert.equal(kit.accent, "#2b50aa");
});

test("normKit rejects junk and keeps the email readable", () => {
  assert.equal(M.api.normKit({ foo: 1 }), null);
  const k = M.api.normKit({ id: "x", paper: "#000000", ink: "#111111" });
  assert.equal(k.ink, "#ffffff");
});

test("artist mode frames a fan announcement brief", () => {
  const trackDigest = M.metrics.trackDigest(
    {
      id: "t1",
      name: "Midnight Static",
      duration_ms: 215000,
      popularity: 40,
      explicit: false,
      album: { release_date: `${new Date().getFullYear()}-01-01`, images: [{ url: "x" }] },
      artists: [{ id: "a1", name: "Hale" }]
    },
    new Map([["a1", { name: "Hale", genres: ["shoegaze", "dream pop"] }]])
  );
  assert.equal(trackDigest.single, true);
  assert.equal(trackDigest.trackCount, 1);
  assert.equal(trackDigest.playlist.owner, "Hale");
  assert.ok(trackDigest.tags.includes("fresh-release"));

  const brief = M.compose.brief(trackDigest, null, { campaignType: "artist_announce", tone: "warm", length: "short", ctaLabel: "Listen now" });
  assert.match(brief, /fan announcement/i);
  assert.match(brief, /Hale/);
  assert.match(brief, /Midnight Static/);
  assert.match(brief, /brand-new release/i);
});

test("store defaults carry the campaign type and source kind", () => {
  assert.equal(M.store.defaults.campaignType, "playlist");
  assert.equal(M.store.defaults.sourceKind, "playlist");
});

test("a track uri survives the handoff mechanism and is consumed once", () => {
  M.store.setHandoff("spotify:track:4iV5W9uYEdYUVa79Axb7Rh", true);
  const h = M.store.takeHandoff();
  assert.equal(h.uri, "spotify:track:4iV5W9uYEdYUVa79Axb7Rh");
  assert.equal(h.direct, true);
  assert.equal(M.store.takeHandoff(), null);
});

test("playlist mode brief stays a campaign brief", () => {
  const digest = {
    playlist: { id: "pl", name: "Mix", owner: "DJ", followers: 10, image: "" },
    trackCount: 20, artistCount: 15, avgPopularity: 55, runtimeLong: "1 hr",
    genres: [{ name: "house", share: 40 }], eras: [], tags: ["discovery-forward"], topArtists: [{ name: "A" }], tracks: []
  };
  const brief = M.compose.brief(digest, null, { campaignType: "playlist", tone: "direct", length: "standard", ctaLabel: "Listen" });
  assert.match(brief, /campaign email for the Spotify playlist/i);
  assert.doesNotMatch(brief, /fan announcement/i);
});

test("the local composer produces standalone html carrying the merge token", () => {
  const digest = {
    playlist: { id: "pl", name: "Mix", owner: "DJ", followers: 0, image: "" },
    trackCount: 1, tracks: [{ name: "T", artist: "A", duration: "3:00", image: "" }]
  };
  const html = M.compose.emailHtml({ digest, idea: null, body: "Hello\n\nWorld", settings: M.store.get() });
  assert.ok(html.includes("<!DOCTYPE html>"));
  assert.ok(html.includes("{{unsubscribe_url}}"));
});

test("the app loaded and exposed its entry points", () => {
  assert.equal(typeof M.App, "function");
  assert.equal(typeof render, "function");
});

test("no external font or brand-asset URLs are referenced from the plugin", () => {
  const sources = ["style.css", "store.js", "api.js", "metrics.js", "ui.js", "index.js", "extension.js"];
  for (const f of sources) {
    const text = fs.readFileSync(path.join(dir, f), "utf8");
    // The brand host must never be fetched at runtime — fonts and the logo are bundled locally.
    assert.ok(!/migma\.ai/.test(text), `${f} must not reference migma.ai`);
  }
  // No stylesheet url() may point off-box: fonts and the mark are local files or data URIs.
  const css = fs.readFileSync(path.join(dir, "style.css"), "utf8");
  assert.ok(!/url\(\s*['"]?https?:\/\//i.test(css), "style.css url() must not fetch an external resource");
  assert.ok(css.includes('url("migma-app-logo-512.webp")'), "the mark should be the bundled logo");
  // The bundled assets exist on disk.
  for (const asset of ["migma-app-logo-512.webp", "migma-app-icon-512.webp", "migma-wordmark-white.png", "migma-logo-animated.gif", "MigmaAIDisplayTitle-Bold.woff2"]) {
    assert.ok(fs.existsSync(path.join(dir, asset)), `${asset} must be bundled`);
  }
});

test("pitch brief names the track, the target playlist and its tracks", () => {
  const td = M.metrics.trackDigest(
    { id: "t2", name: "Glass Harbor", duration_ms: 200000, popularity: 30, explicit: false, album: { release_date: "2026-02-01", images: [{ url: "x" }] }, artists: [{ id: "a2", name: "Veil" }] },
    new Map([["a2", { name: "Veil", genres: ["dream pop"] }]])
  );
  const brief = M.compose.brief(td, null, { campaignType: "playlist_pitch", tone: "direct", length: "short", ctaLabel: "Give it a listen" }, { target: { name: "Fresh Finds Indie", description: "Weekly indie discoveries", trackTitles: ["Paper Lungs", "Slow Tide"] } });
  assert.match(brief, /Glass Harbor/);
  assert.match(brief, /Fresh Finds Indie/);
  assert.match(brief, /Paper Lungs|Slow Tide/);
  assert.doesNotMatch(brief, /fan announcement/i);
});

test("show brief lists every date and its ticket link", () => {
  const digest = { playlist: { owner: "" }, topArtists: [] };
  const dates = [
    { city: "Berlin", venue: "Berghain", date: "2026-11-02", ticket: "https://tix.example/berlin" },
    { city: "Paris", venue: "La Cigale", date: "2026-11-05", ticket: "https://tix.example/paris" }
  ];
  const brief = M.compose.brief(digest, null, { campaignType: "show_promo", tone: "warm", length: "standard", ctaLabel: "Get tickets" }, { artist: "Hale", dates });
  assert.match(brief, /Hale/);
  for (const d of dates) {
    assert.ok(brief.includes(d.city), `brief should name ${d.city}`);
    assert.ok(brief.includes(d.ticket), `brief should carry ${d.ticket}`);
  }
});

test("recentReleases keeps the last 7 days and drops older", () => {
  const day = 86400000;
  const iso = ms => new Date(ms).toISOString().slice(0, 10);
  const albums = [
    { id: "r1", name: "New One", artists: [{ name: "A" }], release_date: iso(Date.now() - 2 * day), images: [{ url: "x" }], external_urls: { spotify: "u1" } },
    { id: "r2", name: "Old One", artists: [{ name: "B" }], release_date: iso(Date.now() - 8 * day), images: [], external_urls: {} }
  ];
  const rel = M.metrics.recentReleases(albums, 7);
  assert.equal(rel.length, 1);
  assert.equal(rel[0].id, "r1");
});

test("label brief lists the given releases, and an empty roster is honest", () => {
  const brief = M.compose.brief({ playlist: { owner: "" } }, null, { campaignType: "label_digest", tone: "editorial", length: "standard", ctaLabel: "Listen" }, { label: "Night Tapes", releases: [{ title: "New One", artist: "A", date: "2026-10-10" }] });
  assert.match(brief, /Night Tapes/);
  assert.match(brief, /New One/);
  assert.equal(M.metrics.recentReleases([], 7).length, 0);
  const empty = M.compose.brief({ playlist: { owner: "" } }, null, { campaignType: "label_digest", tone: "warm", length: "short", ctaLabel: "Listen" }, { label: "X", releases: [] });
  assert.match(empty, /No new releases/i);
});

test("the watch triggers once on a new release id and not on the same id", () => {
  const albums = [
    { id: "old", name: "Old", artists: [{ name: "A" }], release_date: "2026-01-01" },
    { id: "new", name: "New", artists: [{ name: "A" }], release_date: "2026-10-01" }
  ];
  const latest = M.metrics.latestRelease(albums);
  assert.equal(latest.id, "new");
  assert.equal(M.metrics.isNewRelease(latest, "new"), false);
  assert.equal(M.metrics.isNewRelease(latest, "old"), true);
  assert.equal(M.metrics.isNewRelease(latest, ""), false);
});

test("the email links track artwork to a preview when present, else to spotify", () => {
  const digest = {
    playlist: { id: "pl", name: "Mix", owner: "DJ", image: "" },
    trackCount: 2,
    tracks: [
      { name: "A", artist: "X", duration: "3:00", image: "https://img/a", preview: "https://p.scdn.co/mp3-preview/abc", url: "https://open.spotify.com/track/aaa" },
      { name: "B", artist: "Y", duration: "2:30", image: "https://img/b", preview: "", url: "https://open.spotify.com/track/bbb" }
    ]
  };
  const html = M.compose.emailHtml({ digest, idea: null, body: "Hi", settings: Object.assign({}, M.store.get(), { includeTracklist: true }) });
  assert.ok(html.includes("https://p.scdn.co/mp3-preview/abc"), "preview link present");
  assert.ok(html.includes("https://open.spotify.com/track/bbb"), "spotify fallback present");
  assert.doesNotMatch(html, /href=""/, "no empty player link");
});
