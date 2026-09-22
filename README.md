# Codex Remote

Standalone phone client and local Codex App Server bridge.

Requirements: Node 22.23.2, the Codex CLI installed on the host, and a working
Codex login on that host. Codex Remote starts `codex app-server` itself.

On the shared VPS, run build/test/render workloads with
`codex-heavy --label task-check -- <command>`. The runner serializes jobs and
places them in separate systemd services with memory, CPU and time limits;
see [bounded workloads](docs/bounded-workloads.md) for installation and diagnostics.

```sh
cd /path/to/codex-remote
cp .env.example .env
# Edit .env with this machine's values before starting.
npm ci
npm run check
# Before the first production start, provision the separate unlock key locally:
# see docs/security/encrypted-api-rollout.md (never put a real key in this repo).
npm start
```

`npm start`, `npm run dev`, and `npm run status` load the ignored `.env`.
Keep credentials and `.remote-push.json` private; preserve both across moves.
See [operation and configuration](docs/codex-remote-control.md).

The encrypted API candidate adds a separate owner key after login and requires
unlock again on reload. Private API responses can use an IndexedDB ciphertext
cache after fresh server authorization; keys and decrypted responses are not
persisted by that cache. Preview apps keep their separate HTTPS origin and
private HTTP revalidation. See the [protocol/review contract](docs/security/encrypted-api-protocol.md)
and [rollout, compatibility and evidence](docs/security/encrypted-api-rollout.md).
This candidate includes migration/limiter and pause-aware Hours integration, and
still requires independent protocol review and a fresh rollout baseline;
it is not a statement that the live deployment has this feature.

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
be previewed. In encrypted mode, large downloads stream to a file in browsers
with File System Access; other browsers have an explicit 64 MiB download/preview
limit. Paths are canonicalized and must stay inside `CODEX_REMOTE_FILE_ROOTS`
(workspace roots by default), including
after symlink resolution. Text preview is capped at 10 MB; larger or unsupported
files remain download-only. Markdown files open as rendered documents by default
with a Preview/Raw toggle; line-target links open in Raw mode so the requested
line remains highlighted.

Conversation folders can each have one **leader**. Click ☆ next to a conversation's
title, or choose **⭐ Đặt làm leader** in its menu. A filled star marks the leader.
Choosing another conversation transfers the role without changing either history;
moving or archiving the leader clears its role. Existing conversations work too.

Ask the leader to create workers or assign bounded tasks. Workers are ordinary
visible conversations in the same folder, with their own histories. The leader gets
a private, expiring command capability for `scripts/conversations.mjs` each turn.
Commands use a local Unix socket, with a private file mailbox under the conversation
folder when the native sandbox blocks sockets. They do not require `.env`, a login
cookie, network access, or a caller-supplied leader ID. The backend checks the current
leader and folder on every operation and again before dispatch. Workers cannot
delegate recursively. Capabilities are workflow controls on a shared trusted host,
not isolation from another process with unrestricted access to the same OS account.

Expand **Công việc** above the chat to inspect tasks, open workers, view results or
stop work. Busy conversations queue delegated tasks. Direct chat with a worker
takes priority and pauses further assignments until the user clicks **Cho leader
giao việc trở lại**. If it is working, stop the current turn before sending a direct
message. Stopping the leader also stops automatic wakeups until another user turn.
Results go to the current leader when it is idle. Workers and automatic result
turns inherit the leader's Plan/Code mode; planning tasks remain in Plan mode.
Each direct leader instruction
allows at most 20 tasks, 8 automatic result wakeups and 12 unfinished tasks.
Concurrent worker turns per folder use the shared `MAX_CONCURRENT_WORKERS` in
[`server/orchestration.ts`](server/orchestration.ts), also reported by
`status.limits.concurrent` and the injected leader help. The leader is excluded;
this is a ceiling, not a target number of workers. Heavy checks still queue one
job at a time through `codex-heavy`. These budgets survive restart; ambiguous
in-flight sends are flagged for review rather than automatically repeated. Task
state lives in the vault's generated `.state/Orchestration.json`, separate from
knowledge notes. Use stable `requestId` values when retrying commands. Code tasks
must follow the existing rule of separate worktrees and hosted-service registration.

Before assigning work, use the capability command `{"action":"models"}` to inspect
the runtime catalog, filtered to **gpt-6-astra** and **gpt-5.6-sol**, with supported
efforts for each. Add top-level `model` and `effort` to a `spawn` or `delegate`
command, for example `"model":"gpt-5.6-sol","effort":"high"` **only if the catalog
lists that pair**. Omitted fields inherit the leader turn. Missing, unavailable,
disallowed or unsupported values fail before task reservation or conversation
creation; no fallback or effort reduction occurs. Queued tasks are revalidated
before dispatch. Stable request IDs retain the original choice even on retries.

Choose Sol for routine bounded work and Astra for security, architecture or
high-risk work, with a brief explanation based on the task. Security work should
plan carefully and use xhigh/max when listed in the catalog; do not assume high
meets that requirement or invent supported efforts. This is a leader decision,
not keyword-based routing. Task snapshots and result reports include the chosen
model/effort. Overrides do not change user/global settings, active turns, access
permissions or Plan/Code mode. Automatic wakeups keep the leader's settings.

Leaders in **Code** mode can also manage conversations through that same private
command capability:

```json
{"action":"rename","threadId":"worker-id","name":"A clear conversation name"}
{"action":"archive","threadId":"worker-id","requestId":"archive-worker-once"}
{"action":"resolve","taskId":"failed-task-id","summary":"Leader completed and verified the recovery","evidence":"Commit/deployment/verification reference"}
```

Rename accepts the same trimmed, single-line 1–200-character names as the UI and
may rename the leader itself. Archive hides an unnecessary worker using native
`thread/archive`; it does not permanently delete history, vault notes or completed
task reports. **Archive conversations whose work is finished after saving useful
results and knowledge in self-contained Vault notes and confirming reports were
received.** Keeping the full transcript is not required; its retention is current
native Archive behavior, not an obligation to keep every conversation. Cancelled
work need not be recorded as completed. Saving useful knowledge is the leader's
workflow responsibility: the backend does not verify that a note was written.
Rename for clarity; do not perform unrelated bulk cleanup or purge history.
Neither command overrides a worker under
manual user control. Archive cannot target the current leader, a busy/starting
conversation, unfinished work, or undelivered/unconfirmed results. It never
interrupts work to make it archivable. Plan mode rejects both mutations.

After taking over and verifying a failed, interrupted or cancelled task, the
current leader must use `resolve` in Code mode with a concrete summary and evidence.
The card then shows “Đã xử lý”, with the recovery result, confirming leader and date.
The original attempt status/result remain available for audit. Reassignment alone
is not completion. Resolution is durable, emits no model turn and is idempotent
for the same task/summary/evidence; a conflicting record is rejected. It does not
release manual control, acknowledge pending reports or change worker conversations.
The authenticated team API also accepts `resolve` with the current `leaderEpoch`,
behind the existing session and CSRF checks.

The separate Leader page defaults to all queued/active work, unsettled native
dispatches, new failures/interruptions and errors whose result delivery is still
pending or uncertain. These never count toward the three-result limit. It also
shows up to three recent terminal results within 24 hours (including verified
recoveries, dated by recovery time). The thresholds are display choices, never
worker limits. Older errors with a confirmed per-task delivery receipt move into
history while preserving their original failure and evidence. Delivery only means
the native leader turn accepted the report, not recovery or human acknowledgement.
“Xem lịch sử (N)” / “Thu gọn (N)” shows or hides the other retained results; it
does not resolve, acknowledge, archive or delete anything. Recovery summaries stay
visible; evidence and the original attempt are expandable. History remains bounded
by the existing server retention (200 inactive tasks plus all unfinished work),
not an unlimited audit archive. Outstanding reports take priority over delivered
history. Each accepted unfinished task reserves space for its result: new
spawn/delegate commands fail409 before creation or dispatch when the global total
of outstanding reports and unfinished tasks reaches200. Delivery, not resolution,
releases that reservation. Pre-existing excess stays fully accessible; admissions
remain blocked until capacity is available, so later completions cannot lose old
unreported evidence. No unknown delivery is automatically acknowledged or replayed.
Error reports still use the existing result flow and wakeup/notice budgets.

Use the same `requestId` to retry an archive. `status` includes archive receipts:
100 recent completions are retained; the total is capped at 200 including uncertain
operations. A retry acknowledges the original completion only while the target
remains unassigned, and never touches a restored/moved conversation. Old receipts
are not an indefinite retry guarantee. In-flight/uncertain attempts are not replayed,
even after restart; `review` requires inspecting the outcome. An already dispatched
native RPC cannot be revoked. If roles/membership change during it, the newer folder
state is preserved and the receipt is flagged for review. Automatic delegation is
blocked for a conversation with an unresolved archive outcome. The user can still
inspect/manage it directly through the app.

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

## Knowledge vault

`/knowledge` is the authenticated second-brain workspace. It provides searchable notes,
status/scope/source links, editing, revision history with a changed-range diff, restore,
recent context traces and a retrieval preview for an existing conversation. It is also
listed in `/services`; no extra conversation-toolbar button is added.

Each turn selects up to 24,000 UTF-8 bytes of note excerpts. Shared rules and confirmed
global preferences come first, followed by the current handoff/group and relevant topics.
Selection uses the task text, conversation title, repository/worktree, scope, aliases and
direct links. Unused allocations expand clipped notes. Paragraphs/headings are kept intact
where possible; an oversized paragraph is explicitly marked when clipped. `superseded`
and `archived` notes are omitted unless the task asks for history. This is deterministic
text/link retrieval, not semantic search, and a selected proposal remains a proposal.
The latest 100 successfully injected context snapshots retain exact excerpts, revisions,
selection reasons and budget information. Preview requests are not recorded as used context.

Use the checked write path for agent-maintained notes (run in the Codex Remote repository):

```sh
npm run knowledge -- read --path Projects/Example.md
npm run knowledge -- write --path Projects/Example.md --file /tmp/knowledge-draft.md --revision READ_REVISION --actor CONVERSATION_ID
npm run knowledge -- versions --path Projects/Example.md
npm run knowledge -- version --path Projects/Example.md --id VERSION_ID
npm run knowledge -- restore --path Projects/Example.md --id VERSION_ID --revision CURRENT_REVISION
npm run knowledge -- preview --thread CONVERSATION_ID --text 'Sau khi PR merge cần dọn gì?'
```

New notes use `--revision ''`. On HTTP 409, keep the draft, read the new note and merge;
never retry by simply substituting the newer revision without reviewing its contents.
The page preserves the draft and shows the conflicting content for this purpose.
Generated indexes/transcripts, `.state`, paths outside the vault and symlink paths are not
editable through this API. Notes are limited to 256 KB; larger files are reported for splitting.

Versions live locally under `.state/Knowledge/Notes`, with content hashes and source labels.
All API/CLI writes run synchronously through the gateway and compare the supplied revision.
A filesystem observation runs at startup and every 30 seconds, as well as during reads,
to record edits/deletions made by Obsidian or direct file tools. It cannot capture every
intermediate direct write or prevent an external process from writing during a save.
This local history is not an off-machine backup. An initial baseline starts when a note
is first observed; earlier versions cannot be reconstructed automatically.

Supported retrieval properties are simple YAML scalars and inline/block lists: `type`,
`status`, `scope`, `updated`, `sources`, `related`, `aliases`, `repositories`, `decision-key`,
and `supersedes`. Other frontmatter is preserved; advanced YAML constructs are not interpreted.
Repositories may list canonical checkout paths; sibling `-worktrees/<task>` paths map back
to that checkout. The review list flags missing provenance/scope, stale dates, broken wiki
links, exact duplicate bodies and overlapping confirmed decision keys. These are review
signals, not automatic semantic judgments or permission to replace decisions.

See [knowledge evaluation](docs/knowledge-evaluation.md) for acceptance cases and how to
separately assess retrieval and the model's use of the retrieved knowledge.

### Plan mode

Use `/plan` to enter Codex's native Plan mode for the current conversation, or
`/plan <prompt>` to enter it and send a planning request (multiline text and
attachments are supported). Plan mode asks Codex to investigate, clarify, and
propose a plan before implementation. The Plan/Code control and Shift+Tab switch
back to Code. Mode changes are disabled while a turn is running. The selection
is saved per conversation on this device, including across reloads.

A completed native plan offers **Implement plan**, which explicitly starts a Code
turn. You can instead send more feedback while staying in Plan. Planning questions
support suggested choices, a free-text answer, and Skip. The gateway uses
`turn/start.collaborationMode` with the installed Codex's built-in instructions;
it preserves the selected model, effort, and permissions. Plan mode is a native
behavioral mode, not a separate filesystem sandbox.

Pending questions appear above the composer, independently of transcript scroll.
They show one question at a time with numbered choices and a description for the
selected choice. Other answer opens a custom input. Back preserves answers; Skip
omits only the current question. Next advances without sending; Send (or Skip on
the last question) submits the combined answers. Arrow keys select choices and
Enter selects/advances within question controls, without affecting the chat draft.
Reload/reconnect restores unanswered questions. Submitting the final response,
Stop, turn completion, or app-server shutdown removes the relevant pending requests.

To check the native question flow without starting any model turns, run
`npm run build` then `node scripts/plan-questions-browser.mjs` with Playwright and
Chromium installed. For an external Playwright installation, set
`PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs`. This isolated smoke test
uses a fake stdio app-server and an ephemeral HTTP listener; it verifies long-history
visibility, choice/custom answers, Skip, mobile reload, reconnect beyond SSE replay,
and Stop cleanup. It does not use production conversations or credentials.

Protocol verified against Codex CLI 0.155.0 and the official
[CLI commands](https://developers.openai.com/codex/cli/slash-commands/) and
[App Server](https://developers.openai.com/codex/app-server/) documentation.
