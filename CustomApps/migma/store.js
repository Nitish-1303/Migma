window.Migma = window.Migma || {};

Migma.store = (() => {
  const KEY = "migma:settings";
  const CACHE_KEY = "migma:digests";
  const WS_KEY = "migma:workspace";
  const CACHE_TTL = 30 * 60 * 1000;
  const WS_TTL = 10 * 60 * 1000;

  const defaults = {
    baseUrl: "https://api.migma.ai/v1",
    apiKey: "",
    projectId: "",
    projectName: "",
    theme: "system",
    tone: "direct",
    length: "standard",
    ctaLabel: "Listen now",
    ctaUrl: "",
    accent: "#1d1e20",
    includeTracklist: true,
    includeArtwork: true,
    brandKitId: "",
    brandKit: null,
    locale: "",
    reviewerId: ""
  };

  let settings = null;
  const listeners = new Set();

  function ls() {
    return Spicetify.LocalStorage;
  }

  // Local storage is finite and shared with the client itself, so a cache write must never be the
  // thing that fails a campaign. Every write goes through here: a full store drops the derived
  // caches and tries once more, and a second failure is abandoned silently — the plugin then runs
  // uncached rather than surfacing a storage error as a Migma one. Settings outrank both caches,
  // so a settings write is the one allowed to evict them.
  function write(key, value) {
    try {
      ls().set(key, value);
      return true;
    } catch (e) {
      try {
        if (key !== CACHE_KEY) ls().set(CACHE_KEY, "{}");
        if (key !== WS_KEY) ls().set(WS_KEY, "{}");
        ls().set(key, value);
        return true;
      } catch (e2) {
        return false;
      }
    }
  }

  function get() {
    if (settings) return settings;
    let stored = {};
    try {
      stored = JSON.parse(ls().get(KEY) || "{}");
    } catch (e) {
      stored = {};
    }
    settings = Object.assign({}, defaults, stored);
    return settings;
  }

  function set(patch) {
    settings = Object.assign({}, get(), patch);
    write(KEY, JSON.stringify(settings));
    listeners.forEach(fn => fn(settings));
    return settings;
  }
  // Appearance is a display preference, not a credential, so it survives a disconnect.
  // Workspace resources belong to the key that fetched them, so they do not.
  function forget() {
    const theme = get().theme;
    settings = Object.assign({}, defaults, { theme });
    write(KEY, JSON.stringify({ theme }));
    write(WS_KEY, "{}");
    listeners.forEach(fn => fn(settings));
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function isConnected() {
    const s = get();
    return Boolean(s.apiKey && s.projectId);
  }

  function readDigests() {
    try {
      return JSON.parse(ls().get(CACHE_KEY) || "{}");
    } catch (e) {
      return {};
    }
  }

  // A digest is the largest thing the plugin stores, so this cap is what bounds the store.
  // Eviction is by age rather than by insertion order: re-caching a playlist updates its
  // entry in place without moving it, so trimming the tail of the object would drop a playlist
  // the user keeps returning to and keep eleven staler ones.
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

  // Reviewers and brand kits are workspace-level and change rarely, so a short-lived cache
  // keeps the canvas from refetching them on every visit. Only successful reads are written.
  function readWorkspace() {
    try {
      return JSON.parse(ls().get(WS_KEY) || "{}");
    } catch (e) {
      return {};
    }
  }

  // Expired entries are dropped on write as well as on read, so a key the workspace stopped
  // exposing cannot sit in the store indefinitely just because nothing asks for it any more.
  function cacheWorkspace(name, value) {
    const all = readWorkspace();
    all[name] = { at: Date.now(), value };
    const kept = Object.entries(all)
      .filter(([, v]) => v && Date.now() - v.at < WS_TTL)
      .slice(-8);
    write(WS_KEY, JSON.stringify(Object.fromEntries(kept)));
  }

  function cachedWorkspace(name) {
    const hit = readWorkspace()[name];
    if (!hit || Date.now() - hit.at > WS_TTL) return null;
    return hit.value;
  }

  // Set by extension.js when the user enters through the context menu or topbar,
  // consumed once by the app so a refresh does not replay the old target.
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
    cacheWorkspace,
    cachedWorkspace,
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
