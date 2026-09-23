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
app-server`. Approval prompts are disabled for every remote turn. By default,
threads and turns still use `workspace-write` under the configured workspace
roots. Explicit YOLO mode changes future turns to `dangerFullAccess`, which can
access the VPS host and network as the service user. It exposes no arbitrary
shell endpoint outside authenticated Codex turns.

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

Use the pencil beside the active conversation title or beside a sidebar entry to
rename that conversation. Names are trimmed, limited to 200 characters, and saved
via Codex `thread/name/set`, not just browser storage. Renaming leaves drafts and
running turns untouched; authenticated SSE clients receive `thread/name/updated`.
The dialog preserves input on failure, disables saving offline, and supports
Cancel/Escape and keyboard focus trapping.

The UI lists only threads whose recorded working directory matches an allowed
root. Selecting or sending to a thread resumes it through App Server so live
notifications reach the Server-Sent Events connection. The server retains a bounded
in-memory event ring for reconnects; the client applies events to the conversation
without retaining a separate raw-output feed. Thread history remains persisted by
Codex itself. The conversation toolbar also opens the working-directory file browser.

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
metadata and the event ID/server epoch in IndexedDB on that device. Lightweight
screen state (open file/link/browser, folder filters, draft text per conversation,
reading positions, Markdown mode and Word zoom/scroll) is saved locally with a
seven-day lifetime. Draft images are stored separately in IndexedDB as files,
not temporary blob URLs. Device storage is best-effort when quota is exhausted.

Fifteen recently opened conversation histories are retained in an in-memory LRU and
the device snapshot. Each cached history is limited to 5,000,000 bytes of UTF-8 JSON, retaining the newest
content; partial history is labeled until the server refreshes it. Switching
renders cached history immediately, including offline, while read/resume requests
run separately. Stale requests cannot overwrite the newly selected conversation.
History is not serialized into synchronous localStorage, and blocked IndexedDB
operations time out rather than holding startup indefinitely.

Persisted UI values are validated before rendering. A render error offers recovery
without deleting drafts or logging out, and a static reload link remains when the
JavaScript entry bundle fails to load. Shell cache updates publish HTML only after
its bundles are available and use the prior shell on gateway errors. Hashed build
assets are retained for already-open tabs; deployment maintenance should account
for these retained assets when managing disk usage.

A previously verified, unexpired session's workspace metadata can display the
cached screen while session validation retries in the background. Credentials
and CSRF tokens are not cached; sending remains disabled until validation succeeds.
Only an actual 401 opens the login screen, not a network error or gateway timeout.
Explicit logout clears these private snapshots and drafts. File contents are
fetched again on cold reload; external cross-origin frames and native PDF viewers
cannot expose their internal scroll/navigation state to the app.

Stop has independent per-conversation progress and duplicate-click protection.
An RPC acknowledgement alone does not mark a turn stopped: completion events or
bounded history polling must confirm the exact turn is terminal. After 20 seconds
without confirmation the UI allows retry; the interrupt RPC itself has a 10-second
timeout and duplicate server requests are coalesced. Stop never kills the shared
App Server or other conversations. Neither instructions nor Stop are automatically
resent on reconnect.

Browsers, especially iOS, may suspend all page JavaScript in the background, so
no PWA can promise a permanent SSE connection. Codex Remote keeps SSE connected
while the page is visible or a turn is active and closes it only when the page is
both hidden and idle. The turn itself continues in App Server on the host. Web
Push signals completion while the page is suspended, and the cached event cursor
plus thread refresh reconcile any missed updates when the page becomes visible.

Type `/` in the composer to open the local command palette. `/model` discovers
picker-visible entries from App Server `model/list`; `/effort` uses the selected
model's advertised reasoning levels. The selection is sent as a `turn/start`
override on future turns. Approval policy is always `never`. `/yolo on` saves
`dangerFullAccess` for future authenticated turns on this device; `/yolo off`
returns future turns to `workspaceWrite`. The preference survives reloads,
logout/login and gateway restarts on the same browser origin. A visible header
badge remains while full VPS host access is enabled.
`/status`, `/new`, `/threads`, `/archive`, `/stop`,
`/lock`, and `/help` are handled by the Remote client and are never forwarded as
agent prompts. `/status` also reads live ChatGPT usage windows through
`account/rateLimits/read`, including percent used/remaining and reset times when
the current authentication mode exposes them.

The composer accepts up to four files of any type per turn, up to 25 MB each.
PNG/JPEG/WebP images are signature-validated and sent as native `localImage`
inputs. Other uploads remain opaque files; Codex receives their server-owned
paths, names, sizes and MIME types in a text input. Upload IDs are session-bound.
Unsent files expire after ten minutes. Accepted images are deleted on completion
(with a 24-hour fallback); other files remain up to 24 hours for follow-up turns.
Restarting the gateway clears temporary uploads. Failed sends restore drafts.
User messages render as escaped plain text, never HTML or Markdown, and retain
whitespace. The textarea accepts text input without rich-text formatting.

Absolute file links in agent messages open an authenticated file viewer instead
of navigating the PWA to a host filesystem path. The viewer renders UTF-8
text/source files, Word DOCX, PDF and signature-validated PNG/JPEG/WebP/GIF images, honors
the optional `:line` or `#L…` target for text, and offers a **Download** action
for every regular file type. Downloads use an attachment response so the same
link can save onto the phone, tablet or computer currently running Codex Remote.

`GET /api/files/list` is authenticated and read-only. It lists one canonical
directory within configured file roots, supports filename search, hidden-file
filtering and pagination (100 entries by default, maximum 200). Child symlinks are
checked before metadata is returned; unavailable/outside targets cannot be opened.
The Files dialog starts at the conversation cwd and preserves its location while
the existing file preview is open above it.

Word preview is capped at 20 MB and lazy-loads the DOCX renderer. It preserves
document widths and provides fit/zoom controls with scrolling on mobile. The
authenticated `/api/files/docx-frame` isolates document styles; its CSP and iframe
sandbox disable scripts and external resources. Images and fonts are embedded data
URLs, HTML alternative chunks are disabled, and links route through the existing
file/link viewers. Preview is approximate; downloads retain the original DOCX.

The gateway resolves the real path on every metadata, preview and download
request and rejects files outside `CODEX_REMOTE_FILE_ROOTS` (defaulting to
`CODEX_REMOTE_WORKSPACE_ROOTS`); a symlink
cannot escape that boundary. File APIs require the signed session, use
`private, no-store`, stream bytes instead of buffering whole downloads, and
support byte ranges for browser PDF viewers. Text preview is limited to 10 MB to
protect mobile rendering; a larger text file remains downloadable. Setting file
roots to `/` enables browsing the host filesystem outside home. With narrower
file roots, every regular file below an allowed root is eligible
for authenticated download, so using `/root` exposes substantially more than a
single repository to a logged-in Codex Remote device.

The reverse proxy must allow request bodies larger than the application's 25 MB
file limit. Nginx defaults to 1 MB and otherwise rejects ordinary phone photos
before they reach Codex Remote. Set `client_max_body_size 26m;` in the HTTPS
server block; the complete example in `deploy/nginx/codex-remote.conf` also
disables buffering for the Server-Sent Events stream.

The header bell registers real Web Push completion notifications. Enable it in
the installed PWA and grant notification permission. On iPhone, use the Home
Screen app. The bell shows **On** only after the server accepts the subscription.
The gateway sends notifications directly to the browser's push service when an
allowed, loaded thread completes, even with no browser event stream connected.
While enabled, a visible app sends a short-lived per-device heartbeat so the
gateway does not send that subscription a completion push. The service worker
also suppresses an accepted push when any local Codex Remote window is visible
or focused. Otherwise it displays the group and conversation names, with a
**Leader** label only when that conversation is the group's leader at completion.
Names are bounded (60/80 characters), and failed/interrupted turns are identified.
Ungrouped/unnamed conversations have explicit fallbacks. No answer excerpt or
transcript is sent. The approved names, role and thread ID travel in the encrypted
Web Push payload; the operating system may display those names on the lock screen.
Retries retain a single completion's metadata snapshot rather than mixing later
renames or role changes with an older completion.

Tapping opens the matching conversation through the normal authenticated API.
An existing app routes in place, preserving per-conversation drafts and running
turns. A locked app keeps only the target ID in its URL fragment until unlock.
Files/Hours editors are left open; older app clients that cannot acknowledge the
route open a new app window. Missing targets show a recoverable error. The gateway
must remain running, and the device must eventually have network access.

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

## Automatic screen-time tracking

Set `CODEX_REMOTE_WORK_PRESENCE_FILE` to a writable JSONL path to enable the authenticated `/api/work-presence` endpoint. The client reports visible/hidden and processing state every 15 seconds, on visibility changes, and on page exit. No typing is required. Gaps longer than 45 seconds are discarded; no open-tab idle allowance is added. The server stores only timestamp intervals and state, with no conversation text. Server turn-start/completion events let the vault subtract processing across concurrent threads. Multi-tab/device intervals are merged by the vault calculator. Restart only when turns are idle; reload the client to begin reporting.

## Shared working-hours database

`CODEX_REMOTE_WORK_HOURS_FILE` enables `/api/working-hours` for the single authenticated account. The server is the sole writer to a JSON state file, with atomic replacement, a previous-state backup, and revision checks to reject stale writes. The fixed dashboard preview uses a restricted bridge for GET and start/stop/replace-total commands; browser-local data is not silently imported. Timer timestamps come from the server and stop commits totals and clears the timer in one transaction. The client polls every five seconds.
