# MigmaAI for Spotify

Turns a Spotify playlist — or a single track — into a ready-to-send Migma email campaign without
leaving the desktop client. It reads the source's metadata, derives an audience digest, writes a
brief from it, and sends that brief to Migma's **asynchronous email-generation job**. When the job
completes it returns one email per language, which the plugin previews and exports as clean HTML.

The whole plugin is three steps — **Pick → Choose & refine → Review & export** — and each one is a
single surface that changes what it shows as the work progresses rather than a screen that hands off
to the next. Progress is one continuous rail under the header: a filled track, the three names
beneath it, and a step already behind you is a button back to it.

Two things it deliberately does **not** do: it stores no Migma key (a proxy you run holds it), and it
calls no Migma route that Migma does not publish. Capabilities the plugin has a surface for but Migma
has not shipped an endpoint for — suggested angles, draft scoring, on-demand translation, reviewer
assignment, comment threads — render a plain *pending Migma API* state instead of calling a route
that does not exist. See [API alignment](#api-alignment).

Ships as a Spicetify **custom app** (sidebar route) plus a bundled **extension** (topbar button and
playlist context-menu item).

## Install

Copy this folder into the Spicetify custom apps directory:

| OS | Path |
| --- | --- |
| Windows | `%APPDATA%\spicetify\CustomApps\migma` |
| macOS / Linux | `~/.config/spicetify/CustomApps/migma` |

Then register and apply:

```bash
spicetify config custom_apps migma
```

```bash
spicetify apply
```

`manifest.json` loads `store.js`, `api.js`, `metrics.js` and `ui.js` before `index.js`, and registers
`extension.js` as an extension so the topbar button exists on every page, not just inside the app. The
folder name stays `migma` (and the route stays `/migma`); the app's display name is **MigmaAI**.

## Entry points

| Surface | Behaviour |
| --- | --- |
| Sidebar | Custom-app route at `/migma` |
| Topbar button | "Campaign" on a playlist page, "Announce" on a track page, "MigmaAI" everywhere else |
| Playlist context menu | "Create MigmaAI campaign" |
| Track context menu | "Create MigmaAI announcement" — opens artist-announcement mode on that track |

Both the topbar button and the context-menu item call `open(uri, direct)`, which records an explicit
intent flag through `store.setHandoff(uri, direct)`. A `direct` handoff means the user aimed at that
playlist on purpose, so step one skips its playlist list and opens straight on that playlist's audience.
Anything the app merely infers — the current route, the last playlist visited, the playing context —
only preselects the playlist in the list and still waits to be chosen. The handoff is consumed once, so
a refresh does not replay it.

## First run

Open **MigmaAI** in the sidebar, enter the URL of your proxy, press **Check connection**, pick a
project, then **Connect**. An unconnected client is already standing on step one — the connect form
*is* that step's surface, so there is no separate setup screen and the rail reads the same either way.
The proxy address and the defaults are kept in the Spotify client's local storage under
`migma:settings`. No Migma key is, because the plugin never receives one — see
[Why no key is stored here](#why-no-key-is-stored-here).

One further key is a cache: `migma:digests` holds computed audience digests (playlists and single
tracks) so re-opening a source does not re-read it. It keeps 12 entries for 30 minutes, ordered by
when they were last written rather than first seen — so the source you keep returning to is the last
one evicted. Expired entries are dropped on the next write, so it does not grow while the app is closed.

Local storage is finite and shared with the client itself, so a cache write is never allowed to fail a
campaign. A full store drops the digest cache and retries once; if the write still will not land it is
abandoned without a word and the plugin runs uncached. Settings outrank the cache and are the one write
permitted to evict it.

Clear it any time with **Settings → Disconnect**. That drops the in-memory proxy session and the
imported brand and copy defaults, because they belong to the connection. Appearance is a display
preference rather than a credential, so it survives; so does the digest cache, which is derived from
Spotify and holds nothing of Migma's.

## Files

| File | Role |
| --- | --- |
| `manifest.json` | Spicetify app manifest, load order, sidebar icons |
| `extension.js` | Topbar button, playlist context-menu item, route tracking |
| `index.js` | App shell, three-step state machine, every surface, `render()` |
| `ui.js` | Presentational atoms over `Spicetify.React.createElement` |
| `api.js` | Spotify reads via `CosmosAsync`; the Migma client — documented routes only, retry, the async generate-and-poll job, brand import, kit sanitisation |
| `metrics.js` | Source → audience digest (playlist or single track), brief text, export-ready email HTML |
| `store.js` | Settings, digest cache, context-menu handoff |
| `style.css` | Everything visual; both theme token sets, the email token set, and every rule |
| `MigmaAIDisplayTitle-Bold.woff2` | Migma's display face, used for every heading |
| `MigmaAIDisplayTitle-BoldItalic.woff2` | Italic cut of the same face |
| `migma-app-logo-512.webp` | The gradient Migma M, used as the in-UI mark |
| `migma-app-icon-512.webp` | The dark squircle app icon |
| `migma-wordmark-white.png` | White wordmark, for dark backgrounds |
| `test/client.test.cjs` | Headless integration tests (`node --test CustomApps/migma/test/client.test.cjs`) |

## The three steps

`pick → refine → export`. Settings sits outside the sequence and remembers the step it was opened
from, so closing it gives that step back rather than restarting the flow.

**Pick** is onboarding, source selection and the audience digest on one surface. Unconnected, it is the
connect form. Connected, it carries a **campaign-type** toggle — *Playlist campaign* or *Artist
announcement* — then the source. For a playlist campaign it is the playlist on screen now plus a
searchable list of your own; choosing one *is* what starts the read. For an artist announcement the
same picker applies, and a single track can be pasted as a Spotify link or taken from the track playing
now. `reading` keeps the list from coming back in the gap between the choice and the digest, and the
line naming the chosen source carries **Change**, which invalidates the read in flight so a late digest
cannot resurrect the surface it belonged to.

**Choose & refine** is the brief and the preview in one pane. The brief is seeded from the digest and
the campaign type, and tracks tone, length and CTA until you edit it by hand. **Generate** starts
Migma's asynchronous job and polls it to completion; the preview fills when the emails arrive. Extra
languages are chosen here and returned per language, so the preview switches between them without a
second request. The pane also carries **Angles** and **Review** tabs — both render a *pending Migma
API* state, because Migma publishes no endpoint for either (see [API alignment](#api-alignment)).

**Review & export** is the artifact's receipt. Deliverability scoring would belong here, but Migma
publishes no endpoint for it, so the surface says so plainly rather than show a number it cannot stand
behind. The generated email is the deliverable: **Copy HTML** and **Download .html** hand back Migma's
own markup verbatim, and a preview image is linked when the job returns one. **Finish** closes the
sequence; the way on from it is **Create another**.

Backward movement is the rail's job alone. It offers a step already finished and never one not yet
reached, and a generation or brand import in flight — and a finished export — close it to jumps,
because the work in flight belongs to its step and the receipt describes copy already made.

## Campaign types

The pick step's toggle chooses what the campaign is built from. Both types share the same
generate-and-poll pipeline, languages and export; only the brief template differs.

- **Playlist campaign** — the flagship. A playlist's audience, drafted into a campaign email: tone,
  length and CTA over a brief built from the digest's genres, eras, popularity and tags.
- **Artist announcement** — a fan-release email in the artist's own voice, sourced from a playlist or a
  single track. A track is read with `GET /v1/tracks/{id}` and reduced by `metrics.trackDigest` to the
  same digest shape a playlist produces, so the preview, brief and export need no special case.

## Brand and languages

**Brand import.** The brief pane imports a brand from a site through Migma's real project-import route
(`POST /v1/projects/import`). Migma reads the site and returns the brand it inferred; that inferred
brand is workspace-authored, untrusted input, so it passes through `normKit` before it can touch the
email artifact. Every colour must be a three- or six-digit hex and nothing else, so a `var()` reference
or a value trailing a second declaration falls back to the token it was meant to replace; font stacks
are read one family at a time against a whitelist (a bare or fully quoted name, at most eight in 120
characters, no room for a `url()`, scheme, unbalanced quote, comment, brace or semicolon); locales must
match a language-tag pattern; and an ink that fails 4.5:1 against its own paper is re-derived rather
than honoured. One rejected family rejects the whole stack. A kit is normalised on write *and* on read,
so one stored on an earlier visit is validated again rather than trusted for having come from local
storage. Migma's own generation already carries the imported brand, so the kit only retints the local
preview and the pre-generation export.

**Languages.** The brief offers extra generation languages as toggles. They are passed to the generate
job as `languages[]`; a completed job returns one email per language, and the preview's language select
switches between the returned emails. There is no separate translate call — the one that used to exist
hit a route Migma does not publish, and it is now a pending capability.

## Resource and lifecycle

Nothing outlives the view that started it. The generation job runs under an `AbortController` held on a
ref, aborted from the app's unmount cleanup and from each transition that abandons it — a new analysis,
**Stop**, **Create another**, and any backward jump on the rail. The brand import runs on its own
controller, aborted on unmount. Closing the app mid-job therefore leaves no poll loop running in the
background and no timer waiting to fire into a component that is gone.

The polling backoff is abortable: no interval is published, so the client paces itself — a short first
wait growing geometrically to a ceiling under an overall budget — and the wait rejects the moment the
signal fires rather than at the end of the delay. A `429` during polling or any other call is handled
the same way; its `retry-after` wait is abortable too, so an abandoned request leaves no live timer.

Replies that land after an `await` are fenced twice: the app must still be mounted, and the reply must
be the newest one asked for on its own channel — the digest read and the generation each keep their own
counter — so a slow answer to a question the user has moved on from is dropped rather than painted over
the current one. The brand import is fenced on mount alone, because an import that reached Migma is a
real result whether or not the pane is still open to hear it.

## Themes

**Settings → Appearance** offers Dark, White and System. `system` is resolved in JavaScript against
`prefers-color-scheme` and re-resolved whenever the OS setting changes, so only a concrete `dark` or
`light` ever reaches the DOM as `data-mg-theme` on the app root. The stylesheet therefore only ever has
two states to reason about.

Dark is the base: the theme properties are declared on `.mg-app`, and `.mg-app[data-mg-theme="light"]`
overrides the ones that invert. Nothing is light-only, so a token can never resolve to nothing if the
attribute is missing. The invariants are the non-colour concerns — type stack, radii (including the
pill radius CTAs take), durations, easings — plus the brand constants: the official four-stop Migma
gradient, the named palette (Migma Pink and the Cream/Ink/Plum/Terracotta/Sage set), the Pink selection
tint, and the status hues `#22c55e` / `#f38c05` / `#ef4444`.

A separate `--mg-em-*` set is declared on `.mg-email`, defaults to the palette `metrics.js` writes, and
is the only channel a brand kit has into the DOM — kit colours arrive as inline custom properties on
that one element. A workspace therefore cannot reach the app's own two palettes at all, only the
artifact inside the preview frame.

Three exceptions hold regardless of theme:

- **The topbar button stays host-toned.** Spotify's own chrome has no light mode, so a white button
  sitting in it would read as broken rather than themed.
- **The email preview stays light.** It is the artifact the recipient opens, not app chrome, so its
  palette matches whatever the export carries. It does not follow the app theme, because the
  recipient's inbox will not either.
- **Status text darkens in light mode only.** The brand hues stay verbatim for borders and washes, but
  `#22c55e` on white is unreadable at 11px, so text runs use darker variants of the same hue.

Contrast is measured against the substrate a run lands on, not against the page. The warm brand colours
are accents only — they never carry body text or paint the shell. Text tiers hold a 4.5:1 WCAG AA floor;
the one documented exemption is `.mg-select:disabled`, which WCAG exempts as an inactive component.

Both `.woff2` files are bundled and are the only source `@font-face` names — the plugin makes no
remote request for a font — falling through to the system sans if the local face is unavailable. The
in-UI mark, app icon and wordmark are bundled `.webp`/`.png` too, so the app references nothing off-box.
The plugin never paints Spotify's green itself — that colour arrives from the client's own chrome
around it.

## What it reads

Read-only, through the client's own session, so there is no second OAuth prompt and no scopes to
request: `/v1/playlists/{id}`, `/v1/playlists/{id}/tracks` (paged, capped at 1000), `/v1/artists?ids=`
(batched 50), `/v1/me/playlists`, and `/v1/tracks/{id}` for a single-track announcement.

Audience tags come from genre, popularity, runtime and release dates. Nothing is inferred from audio —
Spotify's `audio-features` endpoint is closed to new clients, so there is no energy or valence scoring.

## The Migma API

The published reference is **[docs.migma.ai](https://docs.migma.ai)**; start at
[`/llms.txt`](https://docs.migma.ai/llms.txt) for the full index, and
[`/api-reference/introduction`](https://docs.migma.ai/api-reference/introduction) for the envelope,
status codes, rate limits and idempotency.

**Transport.** Base URL `https://api.migma.ai/v1`, authenticated with `Authorization: Bearer <key>` —
set only by the proxy, never by this client. Every reply carries one envelope:

```json
{ "success": true, "data": {}, "metadata": { "timestamp": "…", "requestId": "…" } }
```

A failure is `{ "success": false, "error": "…" }`. **`error` is a plain string** — there is no
machine-readable code field, so the status line is the only thing worth branching on. The request id
lives under `metadata`, not in a header.

**Rate limits.** Standard is 500/min and 10,000/day; Enterprise 1,000 and 50,000. `X-RateLimit-Reset`
is an **epoch timestamp**, not a number of seconds; a `429` body also carries `retryAfter`. `api.js`
reads both and takes whichever is plausible.

**Keys are account-wide**, so a call touching a project-owned resource needs an explicit `projectId`;
leaving it out answers `404`, not `403`. Both key prefixes (`sk_test_`, `sk_live_`) are secret — there
is no browser-safe key type — which is the whole reason for the proxy.

**The pipeline.** Generation is an asynchronous job, not a stream. `POST /v1/projects/emails/generate`
with `{ projectId, prompt, languages[] }` answers `{ conversationId, status: "pending" }`; from there
`GET /v1/projects/emails/{conversationId}/status` is polled until `status` reads `completed`, at which
point `data.result.emails[]` holds one entry per language carrying `emailId`, `subject`, `html` and
`screenshotUrl`. No polling interval is published; the only timing the docs commit to is 30–60 seconds
for a brand import.

## API alignment

What is live is wired to a route Migma actually publishes. What is pending has a surface in the UI but
no endpoint yet, so the plugin renders a *pending Migma API* state and makes **no** call —
`Migma.api.PENDING_MIGMA_API` is the flag the UI reads, and the proxy exposes none of the invented
routes (a request to one is a `404`).

| Feature | Status | Route |
| --- | --- | --- |
| Connect (Spotify session → scoped proxy session) | **Live** | proxy `POST /session` → Spotify `GET /v1/me` |
| List projects | **Live** | `GET /v1/projects` |
| Import a brand from a site | **Live** | `POST /v1/projects/import` |
| Generate campaign email(s) | **Live** | `POST /v1/projects/emails/generate` → poll `…/{conversationId}/status` |
| Multi-language output | **Live** | `languages[]` on generate (one email per language) |
| Export HTML (copy / download) | **Live** | local — Migma's returned `html`, verbatim |
| Playlist / track / artist reads | **Live** | Spotify, through the client's own session |
| Suggested angles | **Pending** | no published route (was `/campaigns/ideas`) |
| Draft / deliverability scoring | **Pending** | no published route (was `/campaigns/score`) |
| On-demand translation of existing copy | **Pending** | no published route (was `/campaigns/translate`); use `languages[]` instead |
| Reviewer assignment | **Pending** | dashboard-only (was `/workspaces/reviewers`) |
| Comment threads | **Pending** | dashboard / real-time only (was `/workspaces/comments`) |

There is no server-side campaign save: `POST /v1/campaigns` wraps an already-generated `emailId` rather
than storing a draft, so the plugin does not call it. Export is terminal and local.

`Migma.api.ENDPOINTS` names only the live routes above; realigning the client to a schema change is
confined to that map and the normalisers beneath it.

## Why no key is stored here

`/authentication` is explicit: *"Keep keys out of client-side code and git."* A Spicetify custom app is
client-side code by construction, and its local storage is shared with the player, so a key pasted into
the plugin would sit in plain text beside the host client's own state.

So the plugin holds none. It posts the Spotify session this client is already using to a proxy you run,
and the proxy answers with a short-lived scoped session. Migma's secret stays on the proxy, which is the
only party that ever sets `Authorization: Bearer`. The exchanged session lives in `api.js` module scope,
keyed by the proxy that issued it, and is never written to disk — a reload mints another, and a `401`
mid-call mints one and repeats the call rather than failing it.

## Boundaries

No sending, no recipient lists, no unsubscribe handling inside Spotify. The plugin produces HTML and
hands off; Migma owns delivery and consent. `{{unsubscribe_url}}` is left as a merge token in the
exported HTML, in the footer's `href`, for Migma's merge step to resolve.

Two things are **unverified against a live Spicetify client** and are boundaries rather than claims:

1. **CORS from the client origin.** Whether a browser request from `https://xpui.app.spotify.com`
   reaches the proxy has not been exercised end to end; a probe to Migma directly from that origin was
   inconclusive. The proxy must send `Access-Control-*` for that origin whatever Migma does.
2. **Spotify session-token retrieval.** `spotifyToken()` reads four accessor shapes in turn because
   Spicetify names the client's own token differently across releases, and returns `""` rather than
   guessing when none answers. Which shape is live has not been exercised against a running client.



