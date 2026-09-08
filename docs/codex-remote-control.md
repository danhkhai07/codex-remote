# Codex Remote Control

Codex Remote is a private, phone-friendly client for the Codex App Server that
runs on the same host as the repositories it controls. The browser never
receives the host's Codex credentials. The Node gateway owns authentication,
workspace selection, App Server lifecycle and JSON-RPC request correlation.

```text
phone browser --HTTPS--> Node gateway --JSONL/stdin--> codex app-server
                              |                             |
                              +-- REST + SSE                +-- allowed checkout
```

The gateway deliberately does not expose App Server's experimental WebSocket
listener. It binds to `127.0.0.1` by default and should be reached through a
TLS reverse proxy, a private VPN, SSH forwarding or an authenticated tunnel.

## Configuration

Run commands from the standalone app directory. Copy `.env.example` to the
ignored `.env`; it is the sole source of deployment-specific configuration:

| Variable | Contract |
| --- | --- |
| `CODEX_REMOTE_PUBLIC_ORIGIN` | Exact browser origin accepted by Host and Origin checks |
| `CODEX_REMOTE_PASSWORD` | Independent 16+ character login password |
| `CODEX_REMOTE_SESSION_SECRET` | Independent 32+ character cookie-signing secret |
| `CODEX_REMOTE_WORKSPACE_ROOTS` | Comma-separated canonical absolute repository roots |
| `CODEX_REMOTE_HOST`, `CODEX_REMOTE_PORT` | Loopback listener, default `127.0.0.1:5173` |
| `CODEX_REMOTE_SESSION_TTL_SECONDS` | Session lifetime from 5 minutes through 30 days |
| `CODEX_REMOTE_CODEX_BIN` | Codex executable, default `codex` |

Remote secrets are removed from the environment inherited by `codex
app-server`. The app starts and resumes threads only under the configured
workspace roots, with `workspace-write`, `on-request` approvals and the user as
approval reviewer. It exposes no arbitrary shell endpoint.

Eight failed password attempts from the gateway client address trigger a
15-minute login lockout. A successful login clears that failure window. Session
cookies are signed, HttpOnly and SameSite=Strict; production HTTPS also marks
them Secure and enables HSTS.

## Run locally

Install dependencies after cloning or changing the lockfile:

```bash
npm ci
```

Build and start the production server:

```bash
npm run check
npm start
```

The process serves both the static PWA and API. Check its App Server readiness:

```bash
npm run status
```

Development uses one Node process with Vite middleware:

```bash
npm run dev
```

## Publish through ngrok

Keep the application bound to loopback. In a separate supervised process, run:

```bash
ngrok http --url=https://your-domain.ngrok-free.app 5173
```

Set `CODEX_REMOTE_PUBLIC_ORIGIN` to the matching HTTPS origin before starting
the app. If another local service already owns `127.0.0.1:5173`, bind Codex
Remote to another loopback address and pass that full target to ngrok, for
example `http://127.0.0.2:5173`. Do not expose port 5173 directly to the public network. The app rejects
unrecognized Host headers, cross-origin mutations, missing CSRF tokens and
unauthenticated event streams. Login attempts are bounded per direct peer.

## Operation

The UI lists only threads whose recorded working directory matches an allowed
root. Selecting or sending to a thread resumes it through App Server so live
notifications reach the Server-Sent Events connection. Every App Server message
is retained in a bounded in-memory ring and rendered under **All output**; thread
history remains persisted by Codex itself.

Large events are delivered as bounded `fragment` SSE frames and reassembled
losslessly by the client. The SSE cursor advances only on the final fragment,
so a reconnect replays an interrupted event in full. Headers are flushed
immediately and heartbeat/subscription cleanup follows the response lifetime.
When changing this transport, verify a public stream with megabyte-sized
history and at least two 15-second heartbeats; health checks alone do not
verify streaming through the tunnel.

Command/file approvals, permission requests and Codex questions appear above
the conversation. Approval decisions go back to the exact JSON-RPC request ID.
Closing the browser does not auto-approve pending work. Restarting the gateway
ends its active event stream and interrupts active turns; schedule updates while
idle. Signed browser sessions remain valid until expiry when the signing secret
is preserved, and persisted Codex threads can be resumed after reconnecting.

The PWA stores the latest selected thread, its live transcript, thread-list
metadata and the last received event ID in IndexedDB on that device. It renders
that snapshot immediately after session validation, then refreshes from the
gateway and replays only newer events. Explicit logout clears the snapshot; it
contains no password, cookie, Codex credential or pending image file.

Browsers, especially iOS, may suspend all page JavaScript in the background, so
no PWA can promise a permanent SSE connection. Codex Remote keeps SSE connected
while the page is visible or a turn is active and closes it only when the page is
both hidden and idle. The turn itself continues in App Server on the host. Web
Push signals completion while the page is suspended, and the cached event cursor
plus thread refresh reconcile any missed updates when the page becomes visible.

Type `/` in the composer to open the local command palette. `/model` discovers
picker-visible entries from App Server `model/list`; `/effort` uses the selected
model's advertised reasoning levels. The selection is sent as a `turn/start`
override on future turns. `/yolo on` saves the `never` approval policy for future
authenticated turns on this device; `/yolo off` saves `on-request`. The preference
survives reloads, logout/login and gateway restarts on the same browser origin.
YOLO deliberately keeps the `workspace-write` sandbox and configured workspace
roots, and a visible header badge remains until the mode is turned off.
`/status`, `/new`, `/threads`, `/archive`, `/stop`,
`/lock`, and `/help` are handled by the Remote client and are never forwarded as
agent prompts. `/status` also reads live ChatGPT usage windows through
`account/rateLimits/read`, including percent used/remaining and reset times when
the current authentication mode exposes them.

The composer accepts up to four JPEG, PNG or WebP images per turn, with a 10 MB
limit for each image. The authenticated gateway validates the declared MIME type
against the file signature, stores each upload in a private temporary directory
and sends only its server-owned `localImage` path to App Server. Opaque upload
IDs are bound to the login session and expire after ten minutes when unsent. An
accepted image remains readable until its turn completes, then is deleted; a
24-hour cleanup fallback covers a missing completion event. A rejected request
keeps the browser draft available to retry.

The reverse proxy must allow request bodies larger than the application's 10 MB
image limit. Nginx defaults to 1 MB and otherwise rejects ordinary phone photos
before they reach Codex Remote. Set `client_max_body_size 11m;` in the HTTPS
server block; the complete example in `deploy/nginx/codex-remote.conf` also
disables buffering for the Server-Sent Events stream.

The header bell registers real Web Push completion notifications. Enable it in
the installed PWA and grant notification permission. On iPhone, use the Home
Screen app. The bell shows **On** only after the server accepts the subscription.
The gateway sends notifications directly to the browser's push service when an
allowed, loaded thread completes, even with no browser event stream connected.
The service worker displays a generic alert without conversation content; tapping
it focuses the app without reloading an existing draft. The gateway must remain
running, and the device must eventually have network access.

Subscriptions, stable VAPID keys, recent completion IDs and pending deliveries
are stored in `.remote-push.json` with owner-only permissions.
Keep this ignored file private and preserve it across deployments. Delivery
retries transient failures up to five attempts; queued alerts coalesce to the
latest completion per device. Push-service expiry is at most one hour and never
longer than the associated login session. Logout or the bell's disable action
removes server subscriptions; expired sessions and rejected subscriptions are
pruned. Already accepted push messages cannot be recalled. Signing-secret
rotation resets push state and requires enabling notifications again. Supported
delivery services are Chrome/Android FCM, Firefox Mozilla Push, and Apple Web
Push; arbitrary endpoints are rejected. Browser event replay does not send push.

## Verification

`npm run check` runs lint, protocol/auth/model tests, TypeScript checks
and both client/server production builds. Protocol tests use a fake JSONL child
process and do not consume model quota. For a live smoke, start the configured
server, log in, create a thread in a disposable allowed checkout and confirm a
read-only instruction reaches `turn/completed` through SSE.

Set `CODEX_REMOTE_SMOKE_ORIGIN` to the public HTTPS origin to run the same live
smoke through a reverse proxy or tunnel instead of directly against loopback.
The smoke uploads and deletes an image payload larger than Nginx's 1 MB default,
so it verifies the proxy upload limit as well as authentication and SSE.
