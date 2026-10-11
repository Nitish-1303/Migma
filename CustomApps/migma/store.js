window.Migma = window.Migma || {};

Migma.store = (() => {
  const KEY = "migma:settings";
  const CACHE_KEY = "migma:digests";
  const CACHE_TTL = 30 * 60 * 1000;

  const defaults = {
    proxyUrl: "http://localhost:8788",
    projectId: "",
    projectName: "",
    theme: "system",
    campaignType: "playlist",
    sourceKind: "playlist",
    tone: "direct",
    length: "standard",
    ctaLabel: "Listen now",
    ctaUrl: "",
    accent: "#1d1e20",
    includeTracklist: true,
    includeArtwork: true,
    brandSite: "",
    brandKitId: "",
    brandKit: null,
    languages: [],
    showArtist: "",
    dates: [],
    labelName: "",
    roster: [],
    watchArtist: "",
    watchOn: false,
    watchSeen: ""
  };

  let settings = null;
  const listeners = new Set();

  function ls() {
    return Spicetify.LocalStorage;
  }

  // Local storage is finite and shared with the client itself, so a cache write must never be the thing that fails a campaign.
  function write(key, value) {
    try {
      ls().set(key, value);
      return true;
    } catch (e) {
      try {
        if (key !== CACHE_KEY) ls().set(CACHE_KEY, "{}");
        ls().set(key, value);
        return true;
      } catch (e2) {
        return false;
      }
    }
  }

  // Settings held as lists would otherwise reach the request builders as something they cannot iterate if an older store or a hand-edit left them a non-array.
  function normalise(next) {
    for (const key of ["languages", "dates", "roster"]) {
      if (!Array.isArray(next[key])) next[key] = [];
    }
    return next;
  }

  function get() {
    if (settings) return settings;
    let stored = {};
    try {
      stored = JSON.parse(ls().get(KEY) || "{}");
    } catch (e) {
      stored = {};
    }
    settings = normalise(Object.assign({}, defaults, stored));
    return settings;
  }

  function set(patch) {
    settings = normalise(Object.assign({}, get(), patch));
    write(KEY, JSON.stringify(settings));
    listeners.forEach(fn => fn(settings));
    return settings;
  }

  // Appearance is a display preference, not a credential, so it survives a disconnect.
  function forget() {
    const theme = get().theme;
    settings = normalise(Object.assign({}, defaults, { theme }));
    write(KEY, JSON.stringify({ theme }));
    listeners.forEach(fn => fn(settings));
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  // A proxy and a project are the whole of it.
  function isConnected() {
    const s = get();
    return Boolean(s.proxyUrl && s.projectId);
  }

  function readDigests() {
    try {
      return JSON.parse(ls().get(CACHE_KEY) || "{}");
    } catch (e) {
      return {};
    }
  }

  // A digest is the largest thing the plugin stores, so this cap is what bounds the store.
  function cacheDigest(playlistId, digest) {
    const all = readDigests();
    all[playlistId] = { at: Date.now(), digest };
    const kept = Object.entries(all)
      .filter(([, v]) => v && Date.now() - v.at < CACHE_TTL)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, 12);
    write(CACHE_KEY, JSON.stringify(Object.fromEntries(kept)));
  }

  function cachedDigest(playlistId) {
    const hit = readDigests()[playlistId];
    if (!hit || Date.now() - hit.at > CACHE_TTL) return null;
    return hit.digest;
  }

  // Set by extension.js when the user enters through the context menu or topbar, consumed once by the app so a refresh does not replay the old target.
  let handoff = null;
  let lastPlaylist = "";

  return {
    defaults,
    get,
    set,
    forget,
    subscribe,
    isConnected,
    cacheDigest,
    cachedDigest,
    setHandoff: (uri, direct = true) => { handoff = uri ? { uri, direct } : null; },
    takeHandoff: () => {
      const taken = handoff;
      handoff = null;
      return taken;
    },
    noteVisited: uri => { if (uri) lastPlaylist = uri; },
    lastVisited: () => lastPlaylist
  };
})();
