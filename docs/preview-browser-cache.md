# Browser cache for isolated preview resources

Candidate only; not deployed. Based on security candidate `2fd0cff`, with no
same-origin path fallback. Browser storage uses `private, no-cache, must-revalidate`.
Every reuse reaches session authentication and reads current upstream bytes. Even
immutable/long max-age assets revalidate: port ownership, upstream restart and
session revocation must not leave an HTTP freshness window.

JavaScript/CSS and HTML with an explicit upstream validator/cache directive are
eligible. Upstream/request no-store, upstream Set-Cookie (including stripped
reserved cookies), Vary:*, Authorization, range/write preconditions, non-200,
API/auth/session/events/ticket routes, encoded bodies and other content types
remain no-store. Dynamic HTML without an upstream signal is not opted into
storage. Upstream Vary is retained with Cookie added; no-transform is retained.
Apps must mark their sensitive responses no-store; a proxy cannot infer secrets
from arbitrary application bytes or route names.

ETags are SHA-256 over the delivered representation, separate from upstream
validators. If-None-Match/If-Modified-Since are removed from upstream requests;
changed bytes produce 200 even if the upstream ETag is unchanged. Matching
GET/HEAD returns 304 without a body or Content-Length. HEAD fetches GET upstream
for identical hash/length, then suppresses the body. Isolated responses are not
rewritten. Eligible bodies buffer up to 16 MiB per response; larger bodies fall
back to no-store streaming. No shared/CDN/disk/body cache is added.

The real SessionRegistry is checked before forwarding and before/after hashing.
Its watcher stays attached through buffering and HTTP/WebSocket streaming.
Logout/expiry abort an in-flight response; cached validators cannot bypass
revocation. Ticket redirects and errors remain no-store. A cache cannot erase
bytes already delivered, a rendered page or a service worker's own storage.

## Verification

Run through codex-heavy with VITEST_MAX_WORKERS=1; browser scripts need a built
server/client and PLAYWRIGHT_MODULE pointing to an available Playwright install.
All fixtures use fake credentials, temporary files/listeners and no model turns.

- `npx vitest run server/preview-cache.test.ts server/preview-cache-session.test.ts server/localhost-preview.test.ts --maxWorkers=1`
- `node scripts/preview-cache-browser.mjs`
- `node scripts/security-migration-browser.mjs`
- `npm run check` and existing security HTTPS / Plan / Files browser regressions.

Real-login Vite browser fixture: first load 215,529 response-body bytes, reload
0 response-body bytes across 5 responses with status 304 (100% body-byte reduction
in this fixture). Headers/requests/TLS are excluded; upstream still reads bytes.
This is not a measurement of user-device latency. HMR without reload, changed
content after reload, separate ports, API no-store, WebSocket close on logout,
replayed administrator tokens and preview grants returning 401 all pass.

Real HTTP/registry tests cover logout/expiry during an upstream read and expiry
immediately after the real hash (clock advanced deterministically before timer
dispatch), with no late content/304, plus closing an existing HTTP stream.

## Rollout gates

Review the combined security candidate, provision reviewed isolated-origin
DNS/TLS/Nginx and Workboard redirect/embedding, and close old administrative-origin
preview/workboard clients **before** reauthentication. The migration browser
fixture proves unregister alone does not terminate old same-origin documents;
see `security/cache-integration-review.md`. Do not claim P1 migration complete.

Use a NEW pinned release/baseline manifest and the idle watcher; never arm/edit
old `app-security-2fd0cff` or task-resolution releases. Backend manifest adds
`preview-cache.js` and its map to the security set. Preserve `work-hours.js` SHA256:
`a9a74ac46cd4c72b5ff350188d3edf648d8b4ffe2a5fbf4a494f68fab691bd91`.
No main merge, rollout, restart, real credential rotation or production cache
verification was performed by this integration task.
