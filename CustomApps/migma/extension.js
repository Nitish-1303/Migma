(function migmaExtension() {
  const ready =
    window.Spicetify &&
    Spicetify.Platform &&
    Spicetify.Platform.History &&
    Spicetify.ContextMenu &&
    Spicetify.Topbar &&
    Spicetify.URI &&
    window.Migma &&
    Migma.store;

  if (!ready) {
    setTimeout(migmaExtension, 300);
    return;
  }

  const ICON =
    '<svg role="img" height="16" width="16" viewBox="84 86 192 192" fill="currentColor">' +
    '<path d="M250.819 105.74C254.815 103.241 260 106.114 260 110.827V253C260 256.314 257.314 259 254 259H106' +
    'C102.686 259 100 256.314 100 253V110.827C100 106.114 105.185 103.241 109.181 105.74L176.819 148.029' +
    'C178.765 149.246 181.235 149.246 183.181 148.029L250.819 105.74Z"/></svg>';

  function isPlaylist(uri) {
    try {
      return Spicetify.URI.isPlaylistV1OrV2(uri);
    } catch (e) {
      return /^spotify:(user:[^:]+:)?playlist:/.test(String(uri));
    }
  }

  function routeUri() {
    const path = String((Spicetify.Platform.History.location || {}).pathname || "");
    const m = path.match(/playlist\/([a-zA-Z0-9]+)/);
    return m ? `spotify:playlist:${m[1]}` : "";
  }

  // `direct` says the user aimed at this playlist on purpose, so the app opens on the
  // digest instead of the picker. Both entry points here carry that intent.
  function open(uri, direct = true) {
    if (uri) Migma.store.setHandoff(uri, direct);
    Spicetify.Platform.History.push("/migma");
  }

  const button = new Spicetify.Topbar.Button("Migma", ICON, () => open(routeUri(), true), false);
  button.element.classList.add("mg-topbar");

  const label = document.createElement("span");
  label.className = "mg-topbar__label";
  button.element.appendChild(label);

  function sync() {
    const uri = routeUri();
    if (uri) Migma.store.noteVisited(uri);

    const onPlaylist = Boolean(uri);
    const text = onPlaylist ? "Campaign" : "Migma";
    label.textContent = text;
    button.label = onPlaylist ? "Create a Migma campaign from this playlist" : "Open Migma";
    button.element.setAttribute("aria-label", button.label);
    button.element.classList.toggle("is-hot", onPlaylist);
  }

  sync();
  Spicetify.Platform.History.listen(sync);

  new Spicetify.ContextMenu.Item(
    "Create Migma campaign",
    uris => open(uris[0], true),
    uris => uris.length === 1 && isPlaylist(uris[0]),
    ICON
  ).register();
})();
