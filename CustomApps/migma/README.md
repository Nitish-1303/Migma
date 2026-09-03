# Migma for Spotify

Turns a Spotify playlist into a ready-to-send Migma email campaign without leaving the desktop client.
Reads the playlist's metadata, derives an audience digest, asks Migma for campaign angles, streams the
finished email into a live preview, then saves it as a draft in a Migma project.

The whole plugin is three steps — **Pick a playlist → Choose & refine → Save & export** — and each one is
a single surface that changes what it shows as the work progresses rather than a screen that hands off to
the next. Progress is one continuous rail under the header: a filled track, the three names beneath it,
and a step already behind you is a button back to it.

An enterprise workspace adds the parts of a campaign that are not copy. Step two takes a team comment
thread, a brand kit that repaints the artifact in the workspace's own typography and colour, and
secondary-language variants of the generated copy; step three takes the reviewer assignment and a
pre-flight score read before anything is written to the workspace.

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
`extension.js` as an extension so the topbar button exists on every page, not just inside the app.

## Entry points

| Surface | Behaviour |
| --- | --- |
| Sidebar | Custom-app route at `/migma` |
| Topbar button | Reads "Campaign" on a playlist page, "Migma" everywhere else |
| Playlist context menu | "Create Migma campaign" |

Both the topbar button and the context-menu item call `open(uri, direct)`, which records an explicit
intent flag through `store.setHandoff(uri, direct)`. A `direct` handoff means the user aimed at that
playlist on purpose, so step one skips its playlist list and opens straight on that playlist's audience.
Anything the app merely infers — the current route, the last playlist visited, the playing context — only
preselects the playlist in the list and still waits to be chosen. The handoff is consumed once, so a
refresh does not replay it.

## First run

Open **Migma** in the sidebar, paste a workspace API key, press **Check key**, pick a project, then
**Connect**. An unconnected client is already standing on step one — the connect form *is* that step's
surface, so there is no separate setup screen and the rail reads the same either way. The key and defaults
are kept in the Spotify client's local storage under `migma:settings` and are sent only to the configured
base URL. It is plain text on disk — use a scoped, revocable key.

Two further keys are caches, both short-lived and both discardable: `migma:digests` holds computed audience
digests so re-opening a playlist does not re-read it, and `migma:workspace` holds the reviewer and brand-kit
lists so the canvas can paint before the network answers. Digests keep 12 playlists for 30 minutes, workspace
lists 8 entries for 10 minutes, and both are ordered by when they were last written rather than when they were
first seen — so the playlist you keep returning to is the last one evicted, not an arbitrary one. Expired
entries are dropped on the next write to the same cache, so neither grows while the app is closed.

Local storage is finite and shared with the client itself, so a cache write is never allowed to fail a
campaign. A full store drops both caches and retries once; if the write still will not land it is abandoned
without a word and the plugin runs uncached. Settings outrank both caches and are the one write permitted to
evict them.

Clear it any time with **Settings → Disconnect and clear key**. That also drops `migma:workspace`, because
reviewers and brand kits belong to the key that fetched them. Appearance is a display preference rather than
a credential, so it survives; so does the digest cache, which is derived from Spotify and holds nothing of
Migma's.

## Files

| File | Role |
| --- | --- |
| `manifest.json` | Spicetify app manifest, load order, sidebar icons |
| `extension.js` | Topbar button, playlist context-menu item, route tracking |
| `index.js` | App shell, three-step state machine, every surface, `render()` |
| `ui.js` | Presentational atoms over `Spicetify.React.createElement` |
| `api.js` | Spotify reads via `CosmosAsync`, Migma client with retry and SSE streaming, workspace and scoring calls |
| `metrics.js` | Playlist → audience digest, brief text, export-ready email HTML |
| `store.js` | Settings, digest cache, workspace cache, context-menu handoff |
| `style.css` | Everything visual; both theme token sets, the email token set, and every rule |
| `MigmaAIDisplayTitle-Bold.woff2` | Migma's display face, used for every heading |
| `MigmaAIDisplayTitle-BoldItalic.woff2` | Italic cut of the same face |

## The three steps

`pick → refine → export`. Settings sits outside the sequence and remembers the step it was opened from, so
closing it gives that step back rather than restarting the flow.

**Pick a playlist** is onboarding, source detection and the audience digest on one surface. Unconnected, it
is the connect form. Connected, it is the playlist that is on screen right now plus a searchable list of
your own — and choosing one *is* what starts the read, so nothing sits between picking a playlist and
watching its audience fill in beneath the name. `reading` is the flag that keeps the list from coming back
in the gap between the choice and the digest. The line naming the chosen playlist carries **Change**, which
invalidates the read in flight so a late digest cannot resurrect the surface it belonged to.

**Choose & refine** is the angles, the brief and the streaming preview in one pane. Angles arrive in the
first tab, the brief is seeded from the one Migma ranked first, and choosing a different angle re-seeds it
without leaving the surface — the live preview beside them never goes away. The third tab is the team
thread.

**Save & export** scores the campaign on the way in, takes the reviewer assignment, then saves. Once the
draft exists the step becomes its receipt — what was saved, where it went, and the two exports that never
touch the workspace. A saved draft also closes the rail to backward jumps, because a receipt describes copy
that has already left: the way on from it is **Create another**.

Backward movement is the rail's job alone. It offers a step already finished and never one not yet
reached, and leaving a step cancels whatever that step had asked for. A back-jump to step one taken to
re-read the audience does not cost the copy already written: while angles exist, step one's forward action
is a way back to them rather than a second request to Migma.

## Enterprise surfaces

All four are optional capabilities. A workspace that exposes none of them still reaches a saved draft
through `pick → refine → export` unchanged — a failed lookup degrades to an empty list and is reported in
the canvas bar, never in the error view that would discard the draft. A lookup the app itself cancelled is
not a failed one and says nothing: leaving the canvas mid-request must not leave a note claiming the plan
lacks a feature it has.

**Review.** Step two's pane carries **Angles**, **Brief** and **Review** tabs. Review holds a comment
thread keyed on the playlist and the chosen angle, so switching angle loads that angle's own notes; the
reviewer select itself lives in step three, because who the draft is handed to is settled at the hand-off
rather than while the copy is being written. A posted comment joins the feed immediately and keeps its
text whatever the network does: an accepted note takes the server's id and timestamp, a rejected one is
marked *not sent* and offers **Send again**. Notes still carrying a local state survive a refetch rather
than being replaced by a thread that does not contain them. A workspace without a thread endpoint says so
once and keeps the notes in the window.

**Pre-flight.** Entering step three calls `/campaigns/score`, which returns a conversion probability, a
peak listening window, and the factors that moved the number. If the workspace exposes no scorer, the same
card is produced by a local model over the digest's own signals — followers, track and artist count,
popularity spread, genre concentration, explicit share, runtime, subject length, copy length — and the card
says which of the two it is. The local model is deterministic: the same digest and brief always produce the
same number, and nothing about it is random or time-dependent.

**Brand kits.** Step two's header carries a kit select fed by `/workspaces/brand-kits`. A kit repaints the
preview and the exported HTML — paper, ink, copy, muted, rules, footer, CTA fill and label, display and
body font stacks — and replaces the brand-colour row in the brief with the kit's own swatch, since a kit's
accent overrides that field on export and a picker left beside it would edit nothing. Kits are
workspace-authored input and are treated as untrusted: every
colour must be a three- or six-digit hex and nothing else, so a `var()` reference or a value trailing a
second declaration falls back to the token it was meant to replace; font stacks are read one family at a
time against a whitelist, where a family is a bare name or a fully quoted one and at most eight may appear
in 120 characters, which leaves no room for a `url()`, a scheme, an unbalanced quote, a comment, a brace or
a semicolon; locales must match a language-tag pattern; and an ink that fails 4.5:1 against its own paper is
re-derived rather than honoured. One rejected family rejects the whole stack rather than silently shipping a
partial one. A kit is normalised on write *and* on read, so one stored on an earlier visit is validated again
rather than trusted for having come from local storage, and normalising an already-normalised kit changes
nothing.

**Languages.** The header's language select offers whatever locales the workspace's kits declare, then the
common set. **Translate** sends the source copy to `/campaigns/translate`; the result is stored as a
variant, and the preview, **Copy HTML**, the download and the saved payload all read whichever variant is
on screen, so what is on screen is what ships. Every translation runs from the source copy rather than from
another translation, so a second language cannot inherit the drift of the first. Merge tokens are checked
across the round trip and any the translator paraphrased are named, because a rewritten
`{{unsubscribe_url}}` is a dead link in the send. Regenerating the body clears the variants with it.

## Resource and lifecycle

Nothing outlives the view that started it. Every generative request runs under an `AbortController` held on
a ref, and the controller is aborted from the app's unmount cleanup and from each transition that clears the
body it was writing into — a new analysis, a different angle chosen in step two, **Stop**, **Create
another**, and any backward jump on the rail. Step two's own reviewer and comment reads get a second
controller scoped to the effect that issues them, so leaving that step cancels them on the way out. Closing
the app mid-stream therefore leaves no reader draining in the background and no timer waiting to fire into a
component that is gone.

A cancelled stream is cancelled at the body, not merely unhooked from it: the reader is cancelled *and*
released, because releasing the lock alone would hand the stream back while leaving the response open. Both
calls are guarded, since neither is meaningful on a stream that has already ended by itself.

Retry backoff is abortable too. A `429` may carry a `retry-after` measured in tens of seconds, and the wait
rejects the moment the signal fires rather than at the end of the delay, so an abandoned request leaves no
live timer and issues no retry.

Replies that land after an `await` are fenced twice: the app must still be mounted, and the reply must be the
newest one asked for on its own channel — ideas, body, score, workspace, comments and translation each keep
their own counter, so a slow answer to a question the user has moved on from is dropped rather than painted
over the current one. Writes are the exception and are not cancelled: a saved draft or a posted comment may
already have been accepted by the workspace, and marking it un-sent would contradict the workspace's own
record. They are fenced on mount alone, and a posted note's failure notice is pinned to the thread it
belongs to.

## Themes

**Settings → Appearance** offers Dark, White and System. `system` is resolved in JavaScript against
`prefers-color-scheme` and re-resolved whenever the OS setting changes, so only a concrete `dark` or
`light` ever reaches the DOM as `data-mg-theme` on the app root. The stylesheet therefore only ever
has two states to reason about.

Dark is the base: all 68 theme properties are declared on `.mg-app`, and
`.mg-app[data-mg-theme="light"]` overrides the 50 that invert. Nothing is light-only, so a token can
never resolve to nothing if the attribute is missing. The 18 that stay put are the non-colour concerns
— type stack, radii, durations, easings — plus the brand constants: the eight-stop spectrum, the
selection pair, and `#22c55e` / `#f38c05` / `#ef4444`.

Ten further properties sit outside that engine entirely. `--mg-em-*` is declared on `.mg-email`, defaults
to the palette `metrics.js` writes, and is the only channel a brand kit has into the DOM — kit colours
arrive as inline custom properties on that one element. A workspace therefore cannot reach the app's own
two palettes at all, only the artifact inside the preview frame, which is why the 68/50 split above stays
true no matter what a kit contains.

| Token | Dark | White |
| --- | --- | --- |
| `--mg-surface` | `#0a0a0a` | `#f9f9f9` |
| `--mg-page` | `#0f0f0f` | `#ffffff` |
| `--mg-raised` | `#161616` | `#f0f0f0` |
| `--mg-line` | `#2a2a2a` | `#e5e5e5` |
| body text | `#e2e2e3` | `#111111` |
| status / success | `#22c55e` | `#22c55e` |

Three exceptions:

- **The topbar button stays host-toned.** Spotify's own chrome has no light mode, so a white button
  sitting in it would read as broken rather than themed.
- **The email preview stays light.** It is the artifact the recipient opens, not app chrome, so its
  palette matches whatever the export carries — the HTML `metrics.js` writes, or the active brand kit's.
  It does not follow the app theme, because the recipient's inbox will not either.
- **Status text darkens in light mode only.** The three brand hues stay verbatim for borders and
  washes, but `#22c55e` on white is unreadable at 11px, so text runs use darker variants of the same
  hue.

Contrast is measured against the substrate a run lands on, not against the page. Cards darken as
they are used — `#f0f0f0` at rest, `#e9e9ea` on hover, `#e7e7e7` once selected — so the two light greys
that carry 10–12px text are set against the deepest of those rather than against white: `--mg-tx3`
`#5f5f64` and `--mg-tx4` `#66666b` clear 4.5:1 on every light substrate, the tightest being 4.53:1. Dark
clears it everywhere too, with one exception: `--mg-tx4` on `--mg-fill` reaches 4.17:1, and its only use is
`.mg-select:disabled`, which WCAG exempts as an inactive component.

The rail follows the same rule. Its labels sit on `--mg-surface` — 5.42:1 at the dimmest — and the number
inside a not-yet-reached circle takes `--mg-tx3` rather than `--mg-tx4`, because `--mg-fill` is the one
substrate where the lighter grey drops to that exempt 4.17:1 and a step number is text either way. The
finished circle pairs `--mg-tx` with `--mg-step` for 7.37:1, not `--mg-inv-tx`, which would land at 2.72:1.

## Design tokens

The palette, radii, easings, display face and the raised-button geometry in `style.css` are read out of
migma.ai's own stylesheet and `/brandkit/` rather than approximated: zinc borders, a 3px bottom border on
raised buttons that collapses to 1px on press, 4/6/8/12/16px radii and no pill shapes. The warm eight-stop
spectrum reaches exactly six rules and nothing else: the streaming chip and its hover, the metric bar's
leading fill, the score meter's fill, and the two buttons that invoke Migma's generative side —
**Choose an angle** and **Generate**. On the buttons and the chip it is a wash beneath a flat overlay, so the
spectrum reads as a warm edge rather than a rainbow. Every other forward action is the monochrome raised
primary, which inverts per theme: white with black text on dark, near-black with white text on white,
because a white button on a white page has nothing to stand on.

The progress rail is outside that scheme: a 3px track filled with `--mg-inv`, a `--mg-step` circle
on a finished step, `--mg-fill` on one not yet reached. Progress is structure, not a generative event, so it
carries none of the spectrum.

Both `.woff2` files are bundled so headings render offline; each `@font-face` lists the local file first
and `https://migma.ai/fonts/…` second, then falls through to the system sans if Spotify's CSP blocks the
remote fetch.

The plugin never paints Spotify's green itself — that colour arrives from the client's own chrome around
it. Everything the app draws is Migma's.

## What it reads

Read-only, through the client's own session, so there is no second OAuth prompt and no scopes to request:
`/v1/playlists/{id}`, `/v1/playlists/{id}/tracks` (paged, capped at 1000), `/v1/artists?ids=` (batched 50),
`/v1/me/playlists`.

Audience tags come from genre, popularity, runtime and release dates. Nothing is inferred from audio —
Spotify's `audio-features` endpoint is closed to new clients, so there is no energy or valence scoring.

## Assumptions to confirm

1. **Migma API shape.** The nine calls in `Migma.api.ENDPOINTS` (`/projects`, `/campaigns/ideas`,
   `/campaigns/generate`, `/campaigns`, `/campaigns/score`, `/campaigns/translate`,
   `/workspaces/reviewers`, `/workspaces/comments`, `/workspaces/brand-kits`) are a plausible shape, not a
   documented one. Response normalisers accept several common field spellings. Point them at the real
   reference and nothing else needs to change.
2. **Streaming format.** `/campaigns/generate` is read as SSE (`data:` frames carrying `delta` / `text` /
   `content`). If the response is plain JSON instead, the client falls back to reading it whole.
3. **Which capabilities are gated.** Reviewers, comments, brand kits, scoring and translation are assumed
   to be enterprise-plan features that answer `403` or `404` on a workspace without them. Each is treated
   as absent rather than broken on any failure, so a wrong guess here costs a line in the canvas bar, not
   a campaign.
4. **Reviewer notification.** `reviewer_id` travels with the saved draft on the assumption that Migma
   notifies the assignee. The plugin sends nothing itself. If assignment is a separate call, it is one
   request added beside the save.
5. **Comment thread key.** Threads are addressed by a composite of playlist id and idea id, since a
   campaign has no server id until it is saved. If Migma keys comments on the draft instead, the thread
   moves after the first save and the composite becomes the pre-save key only.
6. **Scoring contract.** `/campaigns/score` is expected to return a probability, a band, a peak window and
   weighted factors. The in-client model is the documented fallback, not a stand-in for a missing
   implementation — it is labelled as an estimate wherever it appears, because it reads the
   playlist and the copy and knows nothing about the workspace's own campaign history.
7. **Brand tokens.** Taken from the public migma.ai build, as described above. If the internal design
   system has moved past it, the two token blocks at the top of `style.css` are the only thing to touch.
8. **Brand kit fields.** Kit colour and font keys are read under several spellings (`cta_text_color`,
   `ctaTextColor`, `display_font`, `heading_font`, …) and anything unrecognised is derived from what is
   there. A kit that declares only an accent still renders correctly.
9. **Segments.** Assumed to come from Migma alongside each idea. If they live elsewhere, the segment
   select becomes free text.
10. **System appearance.** Whether `prefers-color-scheme` varies inside Spotify's Electron shell
    depends on how that shell sets `nativeTheme.themeSource`. If it pins one value, **System** will sit on
    it and the explicit Dark and White options are the way to switch.

One internal coupling is worth naming: `metrics.js` writes the export's palette and type as literal values,
and brand kits are applied to that output by substituting those literals. Every anchor lives in one place —
`brandedHtml` in `index.js` — so changing a colour or a font shorthand in `metrics.js` means updating that
function in the same edit.

## Boundaries

No sending, no recipient lists, no unsubscribe handling inside Spotify. The plugin produces a draft and
hands off; Migma owns delivery and consent. `{{unsubscribe_url}}` is left as a merge token in the exported
HTML, in the footer's `href`, for Migma's merge step to resolve.

The same line holds for the enterprise surfaces: assignment and comments are recorded against the workspace,
not delivered by the plugin, and the pre-flight score is an estimate read before the save rather than a
gate on it. Nothing on the pre-flight card blocks a campaign, and nothing on it leaves the client until the
draft is saved.
