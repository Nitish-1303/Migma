# Migma × Spotify

Turn a Spotify playlist — or a track, a release, a tour, a label roster — into a ready-to-send Migma
email campaign without leaving the desktop client. This repo is three pieces:

- **`CustomApps/migma/`** — the Spicetify custom app (the plugin). Pick a source, refine a brief,
  generate through Migma's async job, export clean HTML. See [its README](CustomApps/migma/README.md).
- **`proxy/`** — a zero-dependency Node backend-for-frontend. It holds the Migma key, exchanges the
  Spotify session for a short-lived scoped one, and forwards only documented Migma routes. See
  [its README](proxy/README.md).
- **`wireframe/`** — a single-file storyboard of the whole product, deployable as a static site.

The guiding rule: **every claim the app makes is real.** It calls only endpoints Migma publishes;
capabilities Migma has not shipped a route for render a "pending Migma API" state instead of calling a
fake route, and the one place that would otherwise need data no API provides is marked **MOCK**.

## Campaign types

| Type | Source | Data |
| --- | --- | --- |
| Playlist campaign | A playlist | Real (Spotify reads → brief → Migma generate) |
| Artist announcement | A playlist or a single track | Real |
| Playlist pitch | A track + a target playlist | Real |
| Show promo | Manual date list | Real inputs; nearest-city ordering is **MOCK** (no listener-location API) |
| Label digest | A roster of artists | Real (releases from the last 7 days) |
| New-release watch | A watched artist | Real; polls while the app is open, drafts an announcement on a new release |

All of them run the same generate-and-poll pipeline. Deliverability scoring is **pending** (no Migma
endpoint). Nothing sends email — the plugin produces HTML and hands off; Migma owns delivery and consent.

## Tests

```bash
cd proxy && npm test
```

```bash
node --test CustomApps/migma/test/client.test.cjs
```

The proxy suite runs over a real socket with no Migma key and no network; the client suite loads the
plugin's browser scripts under stubs and checks the honest-API contracts, the campaign briefs, the
release filter and the email preview player.

## Deploy the storyboard (Vercel, dashboard)

The storyboard is a static site with no build step and **no external requests** — fonts and brand
assets are bundled in `wireframe/`.

1. Push this repo to GitHub (done: `github.com/Nitish-1303/Migma`).
2. In the Vercel dashboard: **Add New → Project**, then **Import** this repository.
3. Set **Root Directory** to `wireframe/`.
4. Leave Framework Preset as **Other**; there is no build or install command (`wireframe/vercel.json`
   pins this). Output directory is the root (`.`).
5. **Deploy.** The storyboard loads at the project URL with zero console errors.

## Install the plugin

See [CustomApps/migma/README.md](CustomApps/migma/README.md). In short: copy the folder into
Spicetify's `CustomApps`, `spicetify config custom_apps migma`, `spicetify apply`, and point it at a
running `proxy/`.
