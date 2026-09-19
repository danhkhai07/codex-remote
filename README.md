# Codex Remote

Standalone phone client and local Codex App Server bridge.

Requirements: Node 22.23.2, the Codex CLI installed on the host, and a working
Codex login on that host. Codex Remote starts `codex app-server` itself.

```sh
cd /path/to/codex-remote
cp .env.example .env
# Edit .env with this machine's values before starting.
npm ci
npm run check
npm start
```

`npm start`, `npm run dev`, and `npm run status` load the ignored `.env`.
Keep credentials and `.remote-push.json` private; preserve both across moves.
See [operation and configuration](docs/codex-remote-control.md).

All deployment-specific values belong in `.env`: public origin, gateway password,
session secret, Codex binary, and workspace roots. Historical Codex threads retain
their original workspace path; changing roots does not rewrite those histories.

Attachments: choose, paste, or drop up to four files of any type, 25 MB each.
PNG/JPEG/WebP files use native image input; other files are passed to Codex as
local file paths with names and types. User messages display as plain text,
including literal HTML/Markdown, preserving whitespace and line breaks.
Uploads remain local and session-owned. Accepted images remain available until
the turn completes, with a 24-hour cleanup fallback for missing completion
events. Other accepted files remain for up to 24 hours for follow-up turns.
Unsent files expire after ten minutes; restarting clears temporary
uploads. Failed sends retain the browser draft for retry.

Server files: click an absolute file link in a Codex response to open the
authenticated in-app viewer. Text/source files, Word DOCX, PowerPoint PPTX, PDF, PNG, JPEG, WebP and GIF can
be previewed; every regular file can be downloaded to the current device. Paths
are canonicalized and must stay inside `CODEX_REMOTE_WORKSPACE_ROOTS`, including
after symlink resolution. Text preview is capped at 10 MB; larger or unsupported
files remain download-only. Markdown files open as rendered documents by default
with a Preview/Raw toggle; line-target links open in Raw mode so the requested
line remains highlighted.

The **Files** button opens a read-only browser at the selected conversation's working
directory. Navigate folders, enter a workspace path, search filenames, show hidden
files, or page through large directories. Selecting a file opens the same preview
and download window used by chat links; closing it returns to the folder.

Conversation rows show a numbered badge for unread Codex replies and include the
rename pencil inside the row. Opening a loaded conversation while the app is
visible clears its badge. Counts are stored on this device and reconciled after
backgrounding or reconnecting; the first scan treats existing history as read.
User messages and tool activity do not increment the badge.

DOCX files up to 20 MB open inside the viewer with fit-to-screen and zoom controls.
The browser renders tables, images and text locally in a script-disabled frame;
files are not sent to an external document service. Download / Save / Share keeps
the original Word file. Corrupt or larger documents remain downloadable. Complex
Word pagination may differ from the desktop application.

PPTX files up to 20 MB open as static slides with previous/next, zoom, and restored
slide position. LibreOffice Impress converts a private copy to PDF on this host;
PDF.js renders one slide at a time in the browser, including on mobile. Animations,
audio and video do not play, and unavailable fonts may affect layout. Downloads
always preserve the original PPTX. No documents are sent to third-party services.
The Linux server requires LibreOffice Impress, systemd, and permission to launch
an unprivileged `nobody:nogroup` transient service (the supplied root service has
this permission). Conversion has no network access or access to the workspace,
uses a separate profile/extension cache, and is capped at 256 MB, 50% CPU, and
45 seconds. Only one conversion runs at a time; up to three resulting previews
(32 MB total) are cached in memory and invalidated by source size/modification
time. Temporary copies are deleted after success or failure. Failed or oversized
presentations remain downloadable.

External web links open in the same closable viewer shell. Sites that block
embedded previews can be opened in a separate browser window without replacing
the installed PWA. On iPhone and iPad, supported files use the native Save / Share
sheet so “Save to Files” returns to the existing app instead of navigating the
PWA into Quick Look.

Conversation history responses and individual history-cache entries are capped at
5,000,000 bytes of UTF-8 JSON (5 MB). Oversized histories keep the newest content and
shorten the chronological beginning, including individual oversized tool outputs.
The viewer labels shortened content; the latest turn ID/status is retained
separately so trimming cannot hide the current run state. Streaming output is
bounded too. Original Codex rollout files and model context are not modified.
This cap applies after Codex returns history; it cannot by itself fix a stalled
`thread/read` RPC inside Codex.

The installed PWA caches the latest conversation on-device and paints it before
network refreshes complete. Codex turns continue on the host when the browser is
suspended. The live event stream stays connected while the app is visible or a
turn is active, and disconnects while hidden and idle to avoid needless battery
and network use. Web Push reports completion when the operating system suspends
the PWA's JavaScript.

Reverse proxies must accept bodies larger than the 25 MB file limit. Nginx defaults
to 1 MB, so use `client_max_body_size 26m;`; see
[`deploy/nginx/codex-remote.conf`](deploy/nginx/codex-remote.conf).

HTML files (`.html` and `.htm`, up to 10 MB) open with Preview / Raw modes.
Preview supports inline CSS and JavaScript in an isolated iframe. Resources must
be embedded in the file (inline or data URLs); external and sibling assets and
network requests are blocked. Download keeps the original file.

Click ☆ beside a file or folder to pin it, and ★ to unpin it. Pinned paths
appear in the collapsible “Đã ghim” section across conversations. The
file viewer also has a pin button. Pins persist on the current browser/device;
★ removes a pin. Opening a pin uses the usual workspace access checks.

File browsing, previews and downloads use `CODEX_REMOTE_FILE_ROOTS` (comma-separated
absolute directories). It defaults to `CODEX_REMOTE_WORKSPACE_ROOTS`; setting it
to `/` enables browsing outside home, including `/tmp`, `/etc` and `/var`. The
Up button can then reach `/`. Existing authentication and OS file permissions
still apply. Workspace selection continues to use `CODEX_REMOTE_WORKSPACE_ROOTS`.

SVG files (up to the 10 MB text-preview limit) support Preview / Raw modes.
Preview uses an image element, so embedded scripts do not execute and external
resources are not loaded. The checkerboard background shows transparency.

To apply an update after active turns finish, run `scripts/restart-when-idle.mjs`
with the gateway environment in a separate service/process group. It checks the
full returned thread list twice, leaves active or unknown states running, restarts
`codex-remote.service` once, and verifies health. A partial/paginated list blocks
the restart. `--check` reports readiness without restarting. Status is written to
`~/.local/state/codex-remote/restart-when-idle.json`.

Model and reasoning-effort choices are stored together per conversation on this
browser, without the screen cache's seven-day expiry. Switching conversations,
refreshing history or reconnecting does not reset them. Changing model preserves
the current effort if supported; otherwise it selects that model's default.
The exact displayed model/effort is sent with each new turn. Existing global
choices are migrated to the last cached conversation on first load.

The conversation `!` badge means a completed answer is unread. Progress messages,
streaming output, and failed/interrupted turns do not create badges. Each successful
turn counts once. Reading an answer clears its badge across devices via server-stored
receipts; hidden or stale cached views do not acknowledge answers they have not rendered.
Receipts persist across browser and gateway restarts in
`~/.local/state/codex-remote/read-state.json` (override with `CODEX_REMOTE_READ_STATE_FILE`
and use a persistent writable path in containers). Live events synchronize changes,
with a ten-second snapshot poll and a refresh on reconnect as a fallback.

Use the **Skills** button beside model/effort, or `/skills`, to list skills available
for the current conversation's working directory. Search, refresh, and select skills
for your next message; disabled skills are listed but cannot be selected. Selections
are kept separately with each conversation draft, restored after a failed send, and
cleared after a successful send. The gateway refreshes and validates selected skills
and sends native skill inputs to Codex; arbitrary client-supplied skill paths are rejected.

### Direct working-hours link

Open `/working-hours` (or `/working-hours/`) to access the shared working-hours dashboard directly. It uses the existing Codex login, requires authentication before loading the private dashboard, and uses the same JSON database and timer as the file preview. `/workboard` is a separate existing application and is not mapped to this dashboard.

## Private localhost previews

Open **Localhost** or navigate directly to `/preview/<port>/`, for example
`https://codex.example.com/preview/3000/`. This uses the existing Codex domain and
login, with no extra DNS, certificate, or ngrok setup. The app must keep running
on the VPS; the proxy does not start it. Localhost links in replies open the same
viewer. You can run previews for different ports concurrently.

Requests are forwarded to `127.0.0.1:<port>` after removing the preview prefix.
The gateway adjusts common HTML/CSS asset paths and JavaScript module imports;
an injected adapter routes fetch, XMLHttpRequest, EventSource and WebSocket
requests through the prefix. Binary files and event streams are forwarded as-is.
Codex auth cookies are never sent to the upstream app, and upstream cookies and
service-worker scope are restricted to the selected preview path. The Codex PWA
excludes preview routes from its offline cache.

Path previews share the Codex browser origin, so use apps you trust. They are
not a sandbox for untrusted HTML. Apps with restrictive CSP, custom client-side
routing or hard-coded navigation may need their base/public path configured as
`/preview/<port>/`. For Vite, for example, use `vite --base=/preview/3000/` when
running on port 3000. Keep the application's upstream HTTP port between 1024 and
65535; the gateway's own port is excluded. Text resources rewritten by the proxy
are limited to 16 MB. Only HTTP upstreams are supported.

Nginx must forward WebSocket Upgrade headers on the existing Codex vhost; see
[`deploy/nginx/codex-remote.conf`](deploy/nginx/codex-remote.conf). Backend updates
still use `scripts/restart-when-idle.mjs` to wait for active turns.

An optional separate-origin mode remains available via
`CODEX_REMOTE_PREVIEW_ORIGIN_TEMPLATE=https://p{port}.preview.example.com` for
stronger browser isolation. Only that optional mode requires wildcard DNS/TLS
and [`deploy/nginx/localhost-preview.conf`](deploy/nginx/localhost-preview.conf).
If Codex runs inside Docker, localhost is the container's network namespace;
use host networking on Linux to reach host-only services.

## Services registry and Browser

`/services` lists hosted localhost apps and named paths on Codex Remote (such as
`/working-hours`). Entries persist on the server in
`~/.local/state/codex-remote/services.json` (override with
`CODEX_REMOTE_SERVICES_FILE`). The authenticated page supports add/edit/remove,
search, PR links, branch/worktree details, and checks registered loopback ports
every 30 seconds while visible. Removing a listing does not stop its process.

Whenever hosting an app or adding a path, register its name, purpose and PR before
handing over the link. Explicitly use `Không có PR` or `Chưa xác định PR` when
appropriate; never invent a PR association. From this repository:

```sh
npm run services -- register --port 5183 --name 'Kiotclone · PRINT-01' \
  --summary 'Review custom print templates by branch' --pr 'PR #125 · PRINT-01' \
  --pr-url 'https://github.com/iTCuong090/PhuTungOToTinhMo/pull/125' \
  --branch 'feat/print-01-custom-templates' \
  --directory '/root/GITHUB/PhuTungOToTinhMo-worktrees/print-01'
npm run services -- register --path /working-hours --name 'Working hours' \
  --summary 'Shared working hours' --pr 'Không có PR'
npm run services -- list
npm run services -- remove --key port:5183
```

The helper uses the gateway's existing `.env` locally and never prints session
credentials. Use the API/helper for updates instead of editing the live JSON.
Updates to the same port or internal path replace that entry. A stopped app stays
listed as stopped until removed; register new metadata when reusing its port.

The Browser entry in conversations opens HTTP/HTTPS URLs, root-relative paths,
or VPS localhost ports. Conversation links use the same viewer. Each conversation
retains its own last address on that device (seven-day screen cache), restored on
reopening. Website framing policies and HTTPS mixed-content restrictions still
apply; **Mở tab ngoài** opens sites that do not permit embedding. Internal pages
permit only same-origin framing. URLs are cached, not external page content or
cross-origin browser navigation history.
