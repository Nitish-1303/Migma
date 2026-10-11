# Demo video shot list

A 45-60 second product demo for Migma x Spotify, Music Campaign Automator. Clean cuts only, no
gimmicks. Real screens from the live storyboard (https://migma-wireframe.vercel.app/) and the repo.

## Look

- Shell background #0f0f0f, surfaces #161616 / #1e1e1e.
- Migma Pink #F21F62; gradient accents #F4021E -> #E501B7 -> #F48402.
- Headings in MigmaAIDisplayTitle Bold; body in the system sans.
- Dark, minimal, generous whitespace.

## Shots

| # | Time | On screen | Source |
| --- | --- | --- | --- |
| 1 | 0:00-0:06 | Storyboard cover, animated MigmaAI logo spins up, title "Migma x Spotify - Music Campaign Automator" | live cover / `wireframe/migma-logo-animated.gif` |
| 2 | 0:06-0:17 | Entry points inside the Spotify client: sidebar item, topbar button, playlist right-click menu | `wireframe/assets/flow/flow-entry.png` |
| 3 | 0:17-0:29 | Source step: campaign-type toggle, playlist "Late Night Static" selected, digest reads (128 tracks, night listeners, shoegaze) | `wireframe/assets/flow/flow-source.png` |
| 4 | 0:29-0:44 | Brief rail generating the email live: "Generating..." with the animated mark, copy fills in, preview-player thumbnails | `wireframe/assets/flow/flow-canvas.png` |
| 5 | 0:44-0:53 | Review & export: "Campaign exported", Copy HTML / Download, the "Simulated locally" note | `wireframe/assets/flow/flow-deliver.png` |
| 6 | 0:53-0:59 | Closing pitch card on the dark shell with the pink gradient | caption below |

## Closing caption

"Migma has plugins for ChatGPT, Claude and Slack - nothing for music. This is that plugin."

## Notes

- Prefer the live site for shots 1-5 where it renders; fall back to the bundled PNGs for stills.
- No external assets: fonts, logo and frame stills are all bundled under `wireframe/`.
- The live Flow section already auto-advances through steps 2-5 on a 4s cadence, which can carry shots 2-5 with no editing.
- Total runtime about 59 seconds.
