# migma-spotify-proxy

The service that stands between the Migma Spicetify plugin and `https://api.migma.ai/v1`.

It exists for one reason: Migma publishes no browser-safe key type. Both `sk_test_` and
`sk_live_` are secrets, and the vendor's own authentication page says to keep keys *"out of
client-side code and git."* A Spicetify plugin is client-side code by definition, so the key
cannot live there. This proxy holds it and hands the plugin a short-lived, scoped session
instead.

Zero runtime dependencies. Node 18.17 or newer supplies everything it uses — `node:http`,
`fetch`, `AbortSignal.timeout`, `node:crypto` and `node:test`.

## Run it

```bash
cp .env.example .env
```

Fill in `MIGMA_API_KEY`, and a `SESSION_SECRET` of at least 32 characters:

```bash
openssl rand -hex 32
```

Then:

```bash
npm start
```

It refuses to start on an incomplete configuration and reports every problem at once, rather
than binding a socket and sending unauthenticated calls upstream.

Point the plugin's proxy setting at wherever this listens. The default is
`http://127.0.0.1:8788`.

## Configuration

Everything is read once at boot. The process environment always wins over `.env`, so a
platform secret store overrides the file rather than fighting it.

| Variable | Default | Notes |
| --- | --- | --- |
| `MIGMA_API_KEY` | — | Required. Must begin `sk_live_` or `sk_test_`. Never leaves this process. |
| `MIGMA_BASE_URL` | `https://api.migma.ai/v1` | Must be https. |
| `MIGMA_VALIDATE_PATH` | `/validate/deliverability` | See *Unconfirmed* below. |
| `SESSION_SECRET` | — | Required, 32 characters minimum. Signs the sessions this proxy issues. |
| `SESSION_TTL_SECONDS` | `900` | 60–86400. |
| `ALLOWED_ORIGINS` | `https://xpui.app.spotify.com` | Comma-separated exact origins. Never `*`. |
| `ALLOWED_SPOTIFY_USERS` | empty | Comma-separated Spotify user ids. Empty means any account Spotify authenticates. |
| `PORT` / `HOST` | `8788` / `127.0.0.1` | Loopback by default; `0.0.0.0` behind a load balancer. |
| `UPSTREAM_TIMEOUT_MS` | `30000` | Brand import overrides this to 90s, which is its documented range. |
| `SPOTIFY_TIMEOUT_MS` | `5000` | Applies to the single `GET /v1/me` probe. |
| `MAX_BODY_BYTES` | `131072` | Counted as it arrives, not read from `Content-Length`. |
| `RATE_LIMIT_PER_MINUTE` | `120` | Authenticated routes, keyed per Spotify account. |
| `SESSION_RATE_LIMIT_PER_MINUTE` | `10` | `POST /session`, keyed per address. |
| `LOG_LEVEL` | `info` | `error` \| `warn` \| `info` \| `debug`. |
| `TRUST_PROXY_HEADERS` | `false` | Read `X-Forwarded-For` for rate limiting. Only true behind a proxy you control. |

## What it exposes

| Route | Session | Scope | Upstream |
| --- | --- | --- | --- |
| `GET /healthz` | no | — | none |
| `POST /session` | no | — | `GET https://api.spotify.com/v1/me` |
| `GET /v1/projects` | yes | `projects:read` | `GET /projects` |
| `POST /v1/projects/import` | yes | `projects:import` | `POST /projects/import` |
| `POST /v1/projects/emails/generate` | yes | `emails:generate` | `POST /projects/emails/generate` |
| `GET /v1/projects/emails/:conversationId/status` | yes | `emails:read` | `GET /projects/emails/{id}/status` |
| `POST /v1/validate/deliverability` | yes | `validate:read` | `MIGMA_VALIDATE_PATH` |

Every reply, in both directions and including refusals that never reach the network, uses one
envelope: `{ success: true, data, metadata }` or `{ success: false, error, metadata }` with
`error` a plain string, matching upstream. `metadata` always carries `timestamp` and
`requestId`, and the id is echoed in `X-Request-Id`.

## How a request is handled

The order is the design. Nothing reaches an upstream call until every step has passed.

1. **CORS.** An `Origin` off the allowlist is refused with 403 and *no* CORS headers, so the
   browser reports it as blocked rather than handing the page a body to read. A caller with no
   `Origin` — curl, a health checker — is not making a CORS request and is left alone.
2. **Routing.** Path parameters are constrained by a per-route pattern at the router, so a
   value shaped like a traversal never reaches a handler. Known path with the wrong verb is
   405 and names the verbs it does take; unknown path is 404.

3. **Session.** `Migma-Session` is verified signature-first: parsing a payload this proxy has
   not authenticated would be reading attacker input as structure. A missing, unreadable,
   forged or elapsed session is 401 with which of those it was; a valid session without the
   route's scope is 403.
4. **Rate limit.** Authenticated traffic is keyed per Spotify account, so one client stuck in a
   retry loop cannot spend another listener's share. `POST /session` is keyed per address on a
   tighter bucket, because each attempt costs a call to Spotify.
5. **Handler.** Body and query are validated here, then a request is composed from scratch for
   upstream.

## The session

`POST /session` takes the token the Spotify desktop client is already using — in
`spotify_token`, or as `Authorization: Bearer` — and probes `GET /v1/me`. That endpoint needs
no scope, which is why it is the right check: a 200 means Spotify authenticated the caller, and
the `id` in the reply becomes the session's subject. Only `id`, `product` and `country` are
kept; display name, email and images are not this proxy's business and would turn a log line
into personal data.

What comes back is an HMAC-SHA256 statement, `ms1.<claims>.<signature>`, carrying
`{ sub, scp, iat, exp, jti }`. It is a signed statement rather than a row in a store, so two
instances behind a load balancer accept each other's sessions and a restart does not sign every
client out.

The scopes are this proxy's own — `projects:read`, `projects:import`, `emails:generate`,
`emails:read`, `validate:read` — not Migma's. No Migma scope string is invented here, and no
client-held session can widen what the key itself may do. There is deliberately no send scope
and no billing scope: the plugin does not send email, so a session that could would be a
liability.

## The key

`lib/migma.js` is the only file that reads `MIGMA_API_KEY` and the only one that sets an
`Authorization` header. Nothing inbound is forwarded — not a header, not a cookie, not a
tracing id — so a caller cannot smuggle its own credential through this hop. Only six upstream
response headers come back: the four rate-limit ones, `Retry-After` and `Idempotent-Replayed`.

Logs are JSON lines, and redaction runs over the serialised line rather than field by field, so
a credential that reaches a field nobody expected is still caught. Key-shaped strings, bearer
headers, `ms1.` sessions and JWT-shaped values are replaced before anything is written.

## CORS

Preflight and response headers are written out explicitly rather than delegated. The allowed
origin is echoed exactly, never `*`, because the allowlist is the access control on the
client-facing side. Credentials are not allowed: the session travels in a header, so no cookie
needs to ride along.

`Access-Control-Allow-Headers` lists `Content-Type`, `Authorization`, `Migma-Session`,
`X-Migma-Client` and `Idempotency-Key`. **`X-Migma-Client` is not optional.** The plugin sends
it on every request; leaving it out fails the preflight and blocks every call before it is made.
`Accept` is CORS-safelisted and needs no listing. `Content-Type` is not safelisted at
`application/json` and does.

## Known limits

These are stated here rather than left to be discovered.

**Rate-limit state is per instance.** Two replicas allow twice the configured rate. The limit
protects the workspace's upstream quota — Standard is 500/min and 10,000/day across the whole
account — so a deployment that needs an exact ceiling wants a shared counter instead of this
in-memory bucket.

**Rotating `SESSION_SECRET` is the only revocation lever.** A stateless session cannot be
withdrawn one at a time; rotating invalidates all of them at once, and clients mint another on
the next 401. `SESSION_TTL_SECONDS` is what bounds the damage of a leaked session, so keep it
short.

**No route here honours `Idempotency-Key`.** Upstream accepts it only on `POST /v1/sending`,
campaign send and schedule, and the three contact writes. None of those is a route this proxy
exposes. The header is accepted and length-checked so a caller learns the 100-character rule
without spending a round trip, and it is not forwarded, because forwarding it would imply a
guarantee upstream does not make on these paths.

**A wrong `projectId` answers 404, not 403.** Migma keys are account-wide, so asking for a
project resource the key cannot see is indistinguishable from asking for one that does not
exist. On a project-scoped route the proxy appends a note saying so, because the alternative is
an hour of debugging a permission problem that is really a typo.

**Unconfirmed: the deliverability route.** Its upstream path and body are the one part of this
bridge taken from a summary rather than read off the API reference. Confirm both against
<https://docs.migma.ai/api-reference/introduction> before relying on it; `MIGMA_VALIDATE_PATH`
exists so a correction is a restart rather than a patch. Note also what it forecasts — inbox
placement, whether a message lands in the inbox rather than a spam folder. It is not a
conversion estimate, and a surface that reports a number to a user should not conflate them.

## Before this bridge carries the plugin

Two gaps sit on the client side of the hop, not in this service.

**Generation is a job, not a stream.** Upstream answers `POST /projects/emails/generate` with
`{ conversationId, status: "pending" }`, and the caller polls
`GET /projects/emails/{conversationId}/status` until it reads `completed`, at which point
`data.result.emails[]` carries `{ emailId, subject, html, screenshotUrl }` per language. The
plugin reads that route as `text/event-stream` and parses `data:` lines, so the generate bridge
cannot complete until the client polls instead. No polling interval is published, so this proxy
sets none — it reports upstream's status verbatim and lets the client pace itself, because
inventing a cadence here would hide the fact that nobody has committed to one. The only timing
upstream does commit to is 30–60 seconds for a brand import.

**Most of the plugin's endpoints have no upstream counterpart.** Of the paths the client asks
for, `/projects` is the one that matches the published API. `/campaigns/ideas`,
`/campaigns/generate`, `/campaigns/score`, `/campaigns/translate`, `/workspaces/reviewers`,
`/workspaces/comments` and `/workspaces/brand-kits` are not routes on `api.migma.ai/v1`, and
this proxy deliberately does not invent them. Adding a passthrough for a path that does not
exist would turn a missing feature into a 404 at runtime instead of a decision made in the open.

## Deploy

```bash
docker build -t migma-spotify-proxy .
```

Run it with the environment supplied by the platform rather than a baked `.env`; the image
copies source files by name and `.dockerignore` keeps a local `.env` out of the build context
either way. `HOST` defaults to `0.0.0.0` inside the image because a container's loopback is not
reachable from outside it.

`node` is PID 1 and installs its own `SIGTERM` handler, so `--init` is not needed for the
shutdown path to run: the listener stops accepting, in-flight requests finish, and a request
still waiting on upstream cannot hold a rollout open past fifteen seconds.

Terminate TLS in front of this. Nothing here speaks https, and the Spotify token that arrives at
`POST /session` must not cross a network in the clear.

## Tests

```bash
npm test
```

Zero-dependency `node:test`. The suite covers session forgery, tampering and expiry; the CORS
allowlist including the `X-Migma-Client` requirement; the input guards; router traversal
refusal; and the service end to end over a real socket — preflight, the 401/403 gate, 404/405,
the body cap and the mint limit. None of it needs a Migma key or a network, because what it
proves is that the gate closes, not that Migma replies.



