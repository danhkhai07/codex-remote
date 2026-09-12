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

Images: attach, paste, or drop up to four PNG/JPEG/WebP files, 10 MB each.
Uploads remain local and session-owned. Accepted images remain available until
the turn completes, with a 24-hour cleanup fallback for missing completion
events. Unsent images expire after ten minutes; restarting clears temporary
uploads. Failed sends retain the browser draft for retry.

Server files: click an absolute file link in a Codex response to open the
authenticated in-app viewer. Text/source files, Word DOCX, PowerPoint PPTX, PDF, PNG, JPEG, WebP and GIF can
be previewed; every regular file can be downloaded to the current device. Paths
are canonicalized and must stay inside `CODEX_REMOTE_WORKSPACE_ROOTS`, including
after symlink resolution. Text preview is capped at 2 MB; larger or unsupported
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
5,000,000 bytes of UTF-8 JSON (5 MB). Oversized histories keep the beginning and
shorten the chronological tail, including individual oversized tool outputs.
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

Reverse proxies must accept bodies larger than the image limit. Nginx defaults
to 1 MB, so use `client_max_body_size 11m;`; see
[`deploy/nginx/codex-remote.conf`](deploy/nginx/codex-remote.conf).
