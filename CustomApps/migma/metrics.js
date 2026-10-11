window.Migma = window.Migma || {};

Migma.metrics = (() => {
  const NIGHT_GENRES = [
    "shoegaze", "dream pop", "ambient", "downtempo", "lo-fi", "slowcore",
    "trip hop", "darkwave", "drone", "chillwave", "sadcore", "bedroom pop"
  ];

  const pct = (n, total) => Math.round((n / (total || 1)) * 100);

  function runtimeParts(ms) {
    const mins = Math.round(ms / 60000);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return {
      short: h ? `${h}:${String(m).padStart(2, "0")}` : `${m}m`,
      long: h ? `${h} hr ${m} min` : `${m} min`
    };
  }

  const clock = ms => {
    const s = Math.round(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };

  function digest(playlist, tracks, artistIndex) {
    const count = tracks.length;
    const artistIds = new Set();
    const genreHits = new Map();
    const decades = new Map();
    const artistTracks = new Map();
    const thisYear = new Date().getFullYear();
    let runtimeMs = 0;
    let popSum = 0;
    let explicit = 0;
    let recent = 0;
    let throwback = 0;

    for (const t of tracks) {
      runtimeMs += t.duration_ms || 0;
      popSum += t.popularity || 0;
      if (t.explicit) explicit++;

      const year = Number(String((t.album && t.album.release_date) || "").slice(0, 4));
      if (year) {
        const decade = Math.floor(year / 10) * 10;
        decades.set(decade, (decades.get(decade) || 0) + 1);
        if (thisYear - year <= 1) recent++;
        if (year < 2010) throwback++;
      }
      // Genres are counted once per track, not once per artist, so a prolific
      // contributor cannot skew the mix.
      const trackGenres = new Set();
      for (const a of t.artists || []) {
        if (!a.id) continue;
        artistIds.add(a.id);
        artistTracks.set(a.id, (artistTracks.get(a.id) || 0) + 1);
        const meta = artistIndex.get(a.id);
        if (meta) (meta.genres || []).forEach(g => trackGenres.add(g));
      }
      trackGenres.forEach(g => genreHits.set(g, (genreHits.get(g) || 0) + 1));
    }

    const genreTotal = [...genreHits.values()].reduce((a, b) => a + b, 0);
    const genres = [...genreHits.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 6)
      .map(([name, hits]) => ({ name, share: pct(hits, genreTotal) }));

    const eras = [...decades.entries()]
      .sort((a, b) => b[0] - a[0])
      .slice(0, 5)
      .map(([decade, n]) => ({
        label: decade >= 2000 ? `${decade}s` : `${String(decade).slice(2)}s`,
        share: pct(n, count)
      }));

    const topArtists = [...artistTracks.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, n]) => ({ name: (artistIndex.get(id) || {}).name || "Unknown", tracks: n }));

    const avgPopularity = count ? Math.round(popSum / count) : 0;
    const tags = [];
    if (avgPopularity < 45) tags.push("low-mainstream");
    else if (avgPopularity >= 70) tags.push("mainstream-leaning");
    if (runtimeMs > 3 * 3600 * 1000) tags.push("long-session");
    if (count && artistIds.size / count > 0.6) tags.push("discovery-forward");
    if (genres.some(g => NIGHT_GENRES.includes(g.name))) tags.push("night listeners");
    if (pct(recent, count) > 30) tags.push("fresh-release");
    if (pct(throwback, count) > 40) tags.push("throwback");

    const runtime = runtimeParts(runtimeMs);

    return {
      playlist: {
        id: playlist.id,
        name: playlist.name,
        description: String(playlist.description || "").replace(/<[^>]*>/g, ""),
        owner: (playlist.owner || {}).display_name || "",
        followers: (playlist.followers || {}).total || 0,
        image: ((playlist.images || [])[0] || {}).url || ""
      },
      trackCount: count,
      artistCount: artistIds.size,
      avgPopularity,
      explicitShare: pct(explicit, count),
      runtimeShort: runtime.short,
      runtimeLong: runtime.long,
      genres,
      eras,
      topArtists,
      tags,
      tracks: tracks.slice(0, 10).map(t => ({
        name: t.name,
        artist: ((t.artists || [])[0] || {}).name || "",
        duration: clock(t.duration_ms || 0),
        image: ((((t.album || {}).images) || [])[2] || (((t.album || {}).images) || [])[0] || {}).url || ""
      }))
    };
  }

  // A single track, reduced to the same shape digest() returns so every downstream surface —
  // preview, brief, export — reads it without a special case. It stands in as a one-track
  // "playlist" whose owner is the primary artist, which is exactly how an artist announcement
  // frames a new release.
  function trackDigest(track, artistIndex) {
    const genreSet = new Set();
    for (const a of track.artists || []) {
      const meta = artistIndex.get(a.id);
      if (meta) (meta.genres || []).forEach(g => genreSet.add(g));
    }
    const size = genreSet.size || 1;
    const genres = [...genreSet].slice(0, 6).map(name => ({ name, share: Math.round(100 / size) }));

    const year = Number(String((track.album && track.album.release_date) || "").slice(0, 4));
    const decade = year ? Math.floor(year / 10) * 10 : 0;
    const eras = year
      ? [{ label: decade >= 2000 ? `${decade}s` : `${String(decade).slice(2)}s`, share: 100 }]
      : [];

    const runtime = runtimeParts(track.duration_ms || 0);
    const primary = ((track.artists || [])[0] || {}).name || "";
    const tags = [];
    if (year && new Date().getFullYear() - year <= 1) tags.push("fresh-release");

    return {
      playlist: {
        id: track.id,
        name: track.name,
        description: "",
        owner: primary,
        followers: 0,
        image: ((((track.album || {}).images) || [])[0] || {}).url || ""
      },
      trackCount: 1,
      artistCount: (track.artists || []).length,
      avgPopularity: track.popularity || 0,
      explicitShare: track.explicit ? 100 : 0,
      runtimeShort: runtime.short,
      runtimeLong: runtime.long,
      genres,
      eras,
      topArtists: (track.artists || [])
        .slice(0, 5)
        .map(a => ({ name: (artistIndex.get(a.id) || {}).name || a.name || "Unknown", tracks: 1 })),
      tags,
      tracks: [
        {
          name: track.name,
          artist: primary,
          duration: clock(track.duration_ms || 0),
          image: ((((track.album || {}).images) || [])[2] || (((track.album || {}).images) || [])[0] || {}).url || ""
        }
      ],
      single: true
    };
  }

  // Album objects → the releases within the last `days`, newest first, de-duplicated. Spotify
  // dates come as YYYY, YYYY-MM or YYYY-MM-DD, so each is normalised before the window is applied.
  function releaseTime(rd) {
    const s = String(rd || "");
    const iso = s.length === 4 ? `${s}-01-01` : s.length === 7 ? `${s}-01` : s;
    return Date.parse(iso) || 0;
  }
  function mapAlbum(a) {
    return {
      id: (a && a.id) || "",
      title: (a && a.name) || "Untitled",
      artist: ((a && a.artists) || []).map(x => x && x.name).filter(Boolean).join(", ") || "Unknown",
      date: String((a && a.release_date) || ""),
      image: ((((a || {}).images) || [])[0] || {}).url || "",
      url: ((a && a.external_urls) || {}).spotify || ""
    };
  }
  function recentReleases(albums, days) {
    const windowMs = (days || 7) * 24 * 3600 * 1000;
    const now = Date.now();
    const seen = new Set();
    const out = [];
    for (const a of albums || []) {
      const t = releaseTime(a && a.release_date);
      if (!t || now - t > windowMs || t > now + 86400000) continue;
      const m = mapAlbum(a);
      if (m.id && seen.has(m.id)) continue;
      if (m.id) seen.add(m.id);
      out.push(m);
    }
    return out.sort((x, y) => (y.date || "").localeCompare(x.date || ""));
  }
  // The single newest release regardless of age — what the watch compares against last time.
  function latestRelease(albums) {
    const mapped = (albums || []).map(mapAlbum).filter(x => x.id);
    mapped.sort((x, y) => releaseTime(y.date) - releaseTime(x.date));
    return mapped[0] || null;
  }
  // A new release is a latest whose id differs from the one last seen — and only once a baseline
  // exists, so the first poll of a watch does not fire a banner for an already-published release.
  function isNewRelease(latest, seen) {
    return Boolean(latest && latest.id && seen && latest.id !== seen);
  }

  return { digest, trackDigest, recentReleases, latestRelease, isNewRelease, clock };
})();

Migma.compose = (() => {
  const LENGTHS = { short: "roughly 90 words", standard: "roughly 180 words", long: "roughly 320 words" };

  // `context` carries the type-specific inputs a brief needs beyond the digest: a pitch target, a
  // date list, a release list. The playlist and artist briefs ignore it.
  function brief(digest, idea, settings, context) {
    const d = digest;
    const ctx = context || {};
    const len = LENGTHS[settings.length] || LENGTHS.standard;

    // Artist announcement: a fan-release email in the artist's own voice, built from either a
    // single track or a release playlist. Same digest shape, different framing.
    if (settings.campaignType === "artist_announce") {
      const artist = (d.topArtists[0] && d.topArtists[0].name) || d.playlist.owner || "the artist";
      const release = d.single ? `the new track "${d.playlist.name}"` : `the release "${d.playlist.name}"`;
      return [
        `Write a ${settings.tone}, ${len} fan announcement email from ${artist} about ${release}.`,
        d.single
          ? `Track: "${d.playlist.name}" by ${artist}${d.eras.length ? `, released ${d.eras[0].label}` : ""}, ${d.runtimeLong}.`
          : `Release: ${d.trackCount} tracks, ${d.runtimeLong}, average popularity ${d.avgPopularity}/100.`,
        d.genres.length ? `Sound: ${d.genres.slice(0, 4).map(g => g.name).join(", ")}.` : "",
        d.tags.includes("fresh-release") ? "This is a brand-new release — lead with that." : "",
        "Write to existing fans in the artist's own voice; invite them to listen and share, warmly and without hype.",
        `Call to action: "${settings.ctaLabel}".`,
        "Do not invent song, album or artist names beyond what is given."
      ].filter(Boolean).join("\n");
    }

    // Playlist pitch: a professional note from the artist to a curator, not a fan email. It names
    // the track, why it fits the target, and references the target's own tracks.
    if (settings.campaignType === "playlist_pitch") {
      const t = ctx.target || {};
      const artist = (d.topArtists[0] && d.topArtists[0].name) || d.playlist.owner || "the artist";
      const titles = (t.trackTitles || []).slice(0, 4);
      return [
        `Write a ${settings.tone}, ${len} pitch email from ${artist} to the curator of the playlist "${t.name || "the target playlist"}".`,
        `Pitching the track "${d.playlist.name}" by ${artist}${d.eras.length ? `, released ${d.eras[0].label}` : ""}.`,
        d.genres.length ? `The track's sound: ${d.genres.slice(0, 4).map(g => g.name).join(", ")}.` : "",
        t.description ? `The playlist describes itself as: "${t.description}".` : "",
        titles.length
          ? `It already features tracks like ${titles.map(x => `"${x}"`).join(", ")} — explain why this track sits naturally alongside them.`
          : "",
        "Keep it short and respectful: one clear reason it fits, one listening link, a polite close. This is a professional pitch to a curator, never a fan blast.",
        `Call to action: "${settings.ctaLabel}".`,
        "Do not invent names beyond what is given."
      ].filter(Boolean).join("\n");
    }

    // Show promo: a live-date announcement to fans, one ticket CTA per date.
    if (settings.campaignType === "show_promo") {
      const artist = ctx.artist || d.playlist.owner || "the artist";
      const dates = (ctx.dates || []).filter(x => x && (x.city || x.venue || x.date));
      return [
        `Write a ${settings.tone}, ${len} live-show announcement email from ${artist} to their fans.`,
        dates.length ? "Dates to announce, in this order:" : "No dates entered yet.",
        ...dates.map(x => `- ${[x.city, x.venue, x.date].filter(Boolean).join(", ")}${x.ticket ? ` — tickets: ${x.ticket}` : ""}`),
        "Give each date its own line with a clear ticket call to action. Warm and direct, no hype.",
        `Primary call to action: "${settings.ctaLabel}".`,
        "Do not invent dates, venues or cities beyond those listed."
      ].filter(Boolean).join("\n");
    }

    // Label digest: a weekly round-up of new releases across a roster, in the label's voice.
    if (settings.campaignType === "label_digest") {
      const label = ctx.label || "the label";
      const releases = ctx.releases || [];
      return [
        `Write a ${settings.tone}, ${len} weekly new-release digest email from ${label} to its subscribers.`,
        releases.length ? "This week's releases:" : "No new releases in the last 7 days.",
        ...releases.map(r => `- "${r.title}" by ${r.artist}${r.date ? ` (${r.date})` : ""}`),
        "Introduce the week briefly, then list each release with a listening link. Use the label's voice, not any single artist's.",
        `Call to action: "${settings.ctaLabel}".`,
        "List only the releases given; do not invent any."
      ].filter(Boolean).join("\n");
    }

    return [
      `Write a ${settings.tone}, ${len} campaign email for the Spotify playlist "${d.playlist.name}".`,
      `Playlist: ${d.trackCount} tracks, ${d.artistCount} artists, ${d.runtimeLong}, average popularity ${d.avgPopularity}/100.`,
      d.genres.length ? `Dominant genres: ${d.genres.slice(0, 4).map(g => `${g.name} (${g.share}%)`).join(", ")}.` : "",
      d.eras.length ? `Release era: ${d.eras.slice(0, 3).map(e => `${e.label} ${e.share}%`).join(", ")}.` : "",
      d.tags.length ? `Audience reads as: ${d.tags.join(", ")}.` : "",
      d.topArtists.length ? `Most represented artists: ${d.topArtists.map(a => a.name).join(", ")}.` : "",
      `Call to action: "${settings.ctaLabel}".`,
      "Do not invent track or artist names — the tracklist is inserted separately."
    ].filter(Boolean).join("\n");
  }

  const esc = s =>
    String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const paragraphs = body =>
    String(body || "")
      .split(/\n{2,}/)
      .map(p => p.trim())
      .filter(Boolean);

  function emailHtml(campaign) {
    const { digest, idea, body, settings } = campaign;
    const accent = settings.accent || "#1d1e20";
    const link = settings.ctaUrl || `https://open.spotify.com/playlist/${digest.playlist.id}`;

    const hero =
      settings.includeArtwork && digest.playlist.image
        ? `<tr><td style="padding:0 0 22px"><img src="${esc(digest.playlist.image)}" width="560" alt="${esc(
            digest.playlist.name
          )}" style="display:block;width:100%;max-width:560px;border-radius:8px"></td></tr>`
        : "";

    const copy = paragraphs(body)
      .map(
        p =>
          `<tr><td style="padding:0 0 14px;font:400 15px/1.65 Helvetica,Arial,sans-serif;color:#52525b">${esc(p)}</td></tr>`
      )
      .join("");

    const rows = digest.tracks
      .slice(0, 5)
      .map(
        t => `<tr>
      <td width="44" style="padding:9px 12px"><img src="${esc(t.image)}" width="32" height="32" alt="" style="display:block;border-radius:4px"></td>
      <td style="padding:9px 0;font:600 13px/1.4 Helvetica,Arial,sans-serif;color:#18181b">${esc(t.name)}<br><span style="font-weight:400;color:#71717a">${esc(t.artist)}</span></td>
      <td align="right" style="padding:9px 12px;font:400 12px Helvetica,Arial,sans-serif;color:#71717a">${esc(t.duration)}</td>
    </tr>`
      )
      .join("");

    const tracklist = settings.includeTracklist
      ? `<tr><td style="padding:4px 0 22px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"
          style="border:1px solid #e4e4e7;border-radius:8px;border-collapse:separate">${rows}</table></td></tr>`
      : "";

    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(idea ? idea.subject : digest.playlist.name)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f5">
<div style="display:none;font-size:1px;color:#f4f4f5">${esc(idea ? idea.preheader : "")}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5">
<tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px">
<tr><td style="padding:32px 32px 8px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${hero}
<tr><td style="padding:0 0 14px;font:700 26px/1.25 Helvetica,Arial,sans-serif;color:#18181b;letter-spacing:.5px">${esc(
      idea ? idea.angle : digest.playlist.name
    )}</td></tr>
${copy}
${tracklist}
<tr><td align="center" style="padding:0 0 8px"><a href="${esc(link)}"
  style="display:inline-block;background:${esc(accent)};color:#ffffff;font:700 15px Helvetica,Arial,sans-serif;
  text-decoration:none;padding:15px 30px;border-radius:8px">${esc(settings.ctaLabel)}</a></td></tr>
</table></td></tr>
<tr><td style="padding:22px 32px;background:#f8f8fa;border-top:1px solid #e4e4e7;border-radius:0 0 16px 16px;
  font:400 11px/1.7 Helvetica,Arial,sans-serif;color:#71717a;text-align:center">
Sent by ${esc(digest.playlist.owner)} via Migma &middot; <a href="{{unsubscribe_url}}" style="color:#71717a">Unsubscribe</a>
</td></tr>
</table></td></tr></table></body></html>`;
  }

  return { brief, emailHtml, paragraphs };
})();

