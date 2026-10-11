# Migma × Spotify - Music Campaign Automator

Migma has plugins for ChatGPT, Claude and Slack. Nothing for the 600M-user music industry. This is
that plugin, designed and running.

[Live storyboard](TODO-VERCEL-LINK)

![60-second run of the live plugin](TODO-DEMO-GIF)

## Why Migma should care

- Music is the biggest creator economy, and it has no owned-channel tooling.
- Artists rent their audience from Spotify; they can't email it directly.
- The plugin turns a listening surface (playlist, track, show, roster) into an email campaign.
- Every campaign type reuses Migma's existing generate-and-poll pipeline.
- All real Spotify data, one honest mock.

Everything except final generation runs against the real Spotify API today. Give me sandbox API
access and this runs against Migma tomorrow.

---

## What this is

Turn a Spotify surface (playlist, track, show, roster) into a ready-to-send Migma campaign without
leaving the client.

Three pieces:

- `CustomApps/migma/`, the Spicetify custom app. Pick a source, write a brief, generate through
  Migma's async job, export HTML. [README](CustomApps/migma/README.md).
- `proxy/`, a zero-dependency Node BFF. Holds the Migma key, swaps the Spotify session for a scoped
  one, forwards only documented Migma routes. [README](proxy/README.md).
- `wireframe/`, single-file storyboard, deployable as a static site.

The app calls only endpoints Migma publishes. Anything Migma has no route for shows a "pending Migma
API" state; the one spot that would need data no API provides is marked MOCK.

## Campaign types

| Type | Source | Notes |
| --- | --- | --- |
| Playlist campaign | A playlist | |
| Artist announcement | A playlist or a single track | |
| Playlist pitch | A track + a target playlist | |
| Show promo | Manual date list | nearest-city ordering is MOCK (no listener-location API) |
| Label digest | A roster of artists | releases from the last 7 days |
| New-release watch | A watched artist | polls while the app is open, drafts on a new release |

All run the same generate-and-poll pipeline. Deliverability scoring is pending (no Migma endpoint).
The plugin produces HTML and hands off; sending and lists stay in Migma.

## Tests

```bash
cd proxy && npm test
```

```bash
node --test CustomApps/migma/test/client.test.cjs
```

## Deploy the storyboard (Vercel)

Static site, no build step, no external requests. In the Vercel dashboard: Add New → Project, import
this repo, set Root Directory to `wireframe/`, Framework Preset Other (no build/install command,
pinned by `wireframe/vercel.json`), Deploy.

## Install the plugin

Copy `CustomApps/migma/` into Spicetify's `CustomApps`, then:

```bash
spicetify config custom_apps migma && spicetify apply
```

Point it at a running `proxy/`. Full notes in [CustomApps/migma/README.md](CustomApps/migma/README.md).
