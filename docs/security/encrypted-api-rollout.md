# Encrypted API candidate: review and rollout

Base `9151e6746e56687b0bdac896ce9b36726f8a71b6`, branch
`feat/secure-api-cache`, worktree `/root/WORKTREES/cr-secure-api-cache`.
This is a candidate, not a deployed feature or completed security audit.
See [the protocol and threat model](encrypted-api-protocol.md).

## Behavior and limits

Production configuration defaults to mandatory encryption. Explicit
`CODEX_REMOTE_SECURE_API=required` also lets maintenance commands know the policy
without inheriting the gateway's NODE_ENV. `off` is an explicit legacy/development
mode, never a fallback after failed proof, network errors or missing key files.
The maintenance adapter also discovers a required server and upgrades its own
connection; discovery cannot weaken an explicit local requirement.

Browser login still uses HTTPS and the login password. Unlock uses a distinct,
random 256-bit owner key, encoded as 43 canonical base64url characters. The input
is a password field with autocomplete=current-password and distinct label/name;
choose a separately named password-manager item. There is no programmatic access
to saved passwords. Each reload/tab opening requires unlock. Existing unlocked
pages reconnect with fresh channels using their memory-only key. Tab visibility
does not lock. Lock/logout unmount private UI, abort transport, revoke generated
object URLs and forget module state; jobs on the VPS keep running. This removes
references, not a guarantee of zeroizing JavaScript/OS memory.

All private HTTP API routes, including localhost requests, go through the tunnel.
The only public API responses are login, minimal health, and secure setup; challenge
and handshake additionally require a valid session. Unauthenticated failures are
minimal and contain no private ciphertext. Business errors, method, path, query,
CSRF/header values, JSON/text/binary payloads and SSE records are encrypted. Cookies,
HTTP envelope headers, packet context, sizes and timing remain visible. Bootstrap
HTML/JS/configuration delivery must be trusted: active frontend/bootstrap tampering
is outside this feature's threat model. HTTPS is still required in production.

GET revalidation executes the existing authorized resource handler and hashes its
current representation, including path/range and delivered bytes. It can return
an encrypted unchanged result; it does not return HTTP 304 for a POST or trust a
client revision to skip authorization/file checks. Session expiry/revocation is
checked again around async decrypt/encrypt and while streams run. Key-file changes
are checked per request and every second for existing channels/streams. Password
changes take effect with the configured restart, invalidating old credentials.

The IDB store is `codex-remote-cipher-cache-v1`. Its nonsecret salt is per browser
installation. Namespace is app instance + key generation + owner (one owner v1).
Encrypted metadata holds paths, headers and revisions; resource/body bindings use
opaque HMAC identifiers. JWE protected headers are visible and contain no raw
revision. Cache bodies are independently encrypted, never transport-frame replays.
Limits: total 64 MiB ciphertext, one entry <=8 MiB ciphertext, seven-day TTL, LRU.
Base64 overhead means some bodies below 8 MiB are not cached. Corrupt/missing/quota
entries safely fall back to online reads. There is no offline private restore and
no stale cache display before fresh authorization. Lock retains ciphertext;
logout deletes only this app's encrypted namespaces, and rotation replaces that
namespace. Other site/preview storage and user drafts are not cleared. A server
cannot remotely erase an already downloaded file or a copy of ciphertext.

Downloads use authenticated 64 KiB records with ordering, byte/chunk count and end
checks. Server transport streams with backpressure; successful responses <=8 MiB
can buffer for revalidation. Uploads keep the existing 25 MiB per-file cap, encrypt
in chunks, and assemble the bounded request before dispatch. No side effects occur
on incomplete uploads. Aggregate transport request/cache buffers are capped at
64 MiB; this excludes allocations inside existing business handlers and JS/runtime
overhead. Encrypted uploads have a five-minute total deadline; handshake admission
and stalled response consumers have 30-second deadlines. SSE retains epoch/cursor/fragment semantics,
reconnects and rejects truncated records. Mutations are not automatically retried
when the result is uncertain; inspect current state before manually retrying.
SSE cursors live in the current unlocked page. Reload revalidates current thread
bodies and uses the server's bounded event replay; v1 does not restore a persisted
live transcript/cursor pair or open history offline.

**Incomplete browser compatibility:** File System Access supports streaming large
saves on compatible desktop browsers. Other browsers use an explicit 64 MiB Blob
fallback; larger saves fail visibly. Mobile/Safari large-file parity is not
implemented, and actual iOS/Safari/password-manager products were not tested.
PDF/DOCX/PPTX renderer fidelity was not re-proven with end-to-end document fixtures
in this task; the checked Files browser paths were HTML/text, raw binary save and
upload. Include those document formats in the independent compatibility review.
Existing native-share and text/DOCX/PPTX conversion limits remain. Blob collectors
enforce actual response bytes as well as declared length: 20 MiB for share/DOCX,
32 MiB for a PPTX's converted PDF, 64 MiB for other file-preview/download fallbacks.
This also bounds a file that grows between metadata inspection and content fetch.
The Files HTML
viewer receives plaintext only in an opaque sandbox (allow-scripts without
allow-same-origin; connections/forms/remote resources denied). DOCX has a static
script-free render shell; PDF/images use revocable object URLs. No plaintext URL
fallback is used for large files.

Existing plaintext conversation snapshots are no longer read/written in required
mode. Existing persisted drafts/images, pinned paths, settings and screen state
remain a residual outside the storage-migration scope. Server history/storage is
not newly encrypted. The owner key is not an end-to-end key to the model and cannot
protect against VPS/root compromise or XSS while unlocked. Push bodies generated
by the gateway are generic. Native Unix orchestration capabilities remain local
workflow controls, not an HTTP/key bypass or root isolation boundary.

## Independent review and CR2 merge contract

Review `server/secure-{wire,client,key,api,response}.ts` and
`src/{secureApi,secureCache,secureEvents}.ts` as a security-critical protocol.
Fixtures are implementation evidence, not a substitute for independent review.
Review challenge binding/consumption, admission caps, nonce/sequence/context,
unknown mutation outcome, lifecycle races and ciphertext cache authorization.

CR2 owns old service-worker/tab migration and login limiter changes. This branch
has not copied or approved those patches. Install `installMigrationReady(hook)`
from `src/secureApi.ts` before rendering `SecureGate`; the hook is awaited before
initial restore/setup, login and unlock and must reject while migration is unsafe.
The default hook is only a composition point, so this branch alone is NOT ready
for rollout. Merge conflicts are expected around `src/main.tsx`, `server/http-app.ts`
and environment/docs. Preserve the hook, mandatory private-API gate, isolated
preview origins, parent-session grants/watchers and security response filters.
Do not replace the new gate with legacy unregister-only cleanup.

The first operator migration must terminate old same-origin preview documents and
workers before entering credentials/key. Do not mark that P1 fixed using these
new-page browser fixtures. Keep the base migration reproduction and CR2 acceptance
proof. Workboard must obtain an encrypted preview ticket through the client flow;
required mode rejects old cookie-only `/preview/<port>/` administrator shortcuts.
HTTPS/DNS/TLS/Nginx/Workboard and P2 limiter acceptance remain leader gates.

## Local provisioning and rotation (after review, not executed on production)

Use the same gateway OS account and a private 0700 directory outside all file roots
and the Vault. Never place a key value in env, command-line arguments, Git, URLs,
logs or Vault. The CLI writes/rotates an owner-only 0600 file and prints no key:

```sh
NODE_ENV=production node --env-file=.env scripts/secure-key.mjs init /private/codex-remote/owner-key.json
NODE_ENV=production node --env-file=.env scripts/secure-key.mjs rotate /private/codex-remote/owner-key.json
```

Set CODEX_REMOTE_SECURE_KEY_FILE to that absolute path. Use trusted SSH and your
password manager to retrieve/store its `key` value privately; do not paste it into
a conversation. The CLI checks lexical/canonical roots and an anchored private
parent directory, uses exclusive creation, fsync and atomic replacement. Rotation
keeps the app ID, changes key generation/key, invalidates channels/cache and keeps
history. Back up the key securely; there is no password-only recovery of ciphertext.
Docker needs the private directory mounted outside file roots with matching owner
UID; a directory mount lets atomic rotations appear inside the container.

`knowledge.mjs`, `services.mjs` and `restart-when-idle.mjs` use
`secure-maintenance.mjs` and the same proof/tunnel with a signed short-lived session.
They have no localhost exception. The adapter requires a matching gateway exposing
secure setup; missing setup fails closed. Historical apply/smoke scripts that still
call private plaintext endpoints are incompatible with required mode; do not use
those for rollout validation. Public status/health needs no private metadata.

## Artifact manifest and deployment sequence

Do not arm/edit old releases, copy this worktree over live files, or restart from
this task. Leader prepares a NEW seal after independent review and CR2 integration.

| Group | Artifacts to include in the new seal |
| --- | --- |
| Runtime dependency | package.json, package-lock.json, exact jose 6.2.12 installed via npm ci; existing pinned Node/npm |
| New backend | dist-server/secure-wire.js, secure-key.js, secure-client.js, secure-api.js, secure-response.js, secure-viewer.js and matching maps |
| Changed backend | dist-server/config.js, http-app.js, push.js and matching maps; union with base security/cache and CR2 manifests |
| Client | complete matching dist/ tree including hashed JS/CSS and lazy assets; cache/public shell files from the same seal |
| Operator tools | scripts/secure-key.mjs, secure-maintenance.mjs, knowledge.mjs, services.mjs, restart-when-idle.mjs; retain restart-readiness/session-cookie helpers |
| Configuration/private state | reviewed required mode/key path; operator-provisioned key directory (not a release artifact); preserve session registry/history/attachments/other runtime data |
| Admin proxy | deploy/nginx/secure-api-location.conf in the NEW seal; exact request location allows 36 MiB wire data, retains header filters and disables request/response buffering; keep preview's separate policy |
| Preserve exactly | live work-hours.js SHA256 a9a74ac46cd4c72b5ff350188d3edf648d8b4ffe2a5fbf4a494f68fab691bd91, plus its matching map |

The base build emits a different work-hours.js from the pinned live artifact even
without source edits. Exclude it from the copied artifact manifest and preserve the
pinned live file/map; no Working Hours backend change is required by this feature.
Only the parent UI transport adapter changes. Do not replace all dist-server files
indiscriminately.

Review and seal client/server/dependency/CLI together. Provision the key privately
only after approval, prepare config and backups, and await the reviewed idle watcher
without interrupting turns. An upgrade from the old gateway must use a sealed old
readiness watcher for the pre-restart check: the new adapter intentionally does not
fall back to a gateway without secure setup. The watcher’s post-restart public health
probe remains usable; validate private functionality with the new encrypted adapter.
Subsequent restarts use the new encrypted watcher. Coordinate rollback of server,
client, CLI and configuration as one reviewed release; never silently switch to
plaintext to recover availability. Verify migration/DNS/TLS/preview and unlock,
revalidation, logout/replay and SSE after deployment before calling the feature live.

The encrypted 25 MiB upload is 35,063,561 bytes in the fixture. The old 26 MiB proxy
limit is too small. Include the new exact-location snippet in the reviewed admin
vhost (adjust loopback port), run `nginx -t`, and check the edge proxy's body/timeout
limits. No change to the isolated preview vhost's upload policy is needed. The
fixture starts a separate Nginx with a temporary prefix/config; it neither reads
nor reloads the production vhost.

## Checked evidence

All checks use codex-heavy with one Vitest worker, fake credentials/native RPC,
temporary listeners/key files and no real model turn. Existing integration/security
worktree and runtime were left unchanged.

Final `npm run check`: 409 Vitest tests in 71 files, 11 Node tests, lint, TypeScript,
client/server builds and PWA validation pass. Fixture commands below also pass.

Reproduction commands, after build:

```sh
codex-heavy --label secure-check -- env VITEST_MAX_WORKERS=1 npm run check
codex-heavy --label secure-browser -- node scripts/secure-api-browser.mjs
codex-heavy --label secure-cli -- node scripts/secure-maintenance-fixture.mjs
codex-heavy --label secure-nginx -- node scripts/secure-proxy-fixture.mjs
codex-heavy --label secure-preview -- env SECURE_FIXTURE=1 node scripts/preview-cache-browser.mjs
```

Browser checks need PLAYWRIGHT_MODULE pointing to an external Playwright install
(pass it with `env` inside the runner). NGINX_FIXTURE_BIN defaults to /usr/sbin/nginx.
The HTTPS isolation, Files desktop/mobile and full Plan question/reconnect suites
also pass; those older compatibility fixtures run with encryption disabled. The
new secure browser fixture tests encrypted chat history/Plan answers/SSE reconnect,
Files HTML/binary save/upload, checked-revision Vault, orchestration, mobile unlock,
multitab lock, object URL revocation, UI logout/draft retention, rotation, cache
corruption/quota/LRU/wrong key and service-worker/IDB/localStorage inspections.

Measured encrypted file response: 193,998 -> 1,135 body bytes after reload and fresh
unlock/revalidation (99.41% reduction). Content changes refetch and deleted files
are denied. IDB stress retains eleven 4 MiB bodies under the 64 MiB ciphertext cap.
Vite isolated preview: 215,541 -> 0 body bytes / five 304 responses; HMR/new bytes,
separate ports, API no-store, logout WebSocket close and replayed grants/session
401 all pass with preview tickets obtained through encrypted API.

The Nginx fixture accepts and byte-compares a full 25 MiB encrypted upload, then
verifies oversized input is rejected locally before dispatch. Its combined
gateway/client process peak RSS was 348,824 KiB. A full browser/regression runner
cgroup peaked at 1,288,323,072 bytes, with no OOM. Renderer heap samples after IDB
stress varied substantially with GC (about 127–422 MiB); the persistent 64 MiB
limit is not a claim of a 64 MiB renderer RAM bound. These are artificial fixture
measurements, not user-device latency/memory forecasts. Large mobile save support
and real password-manager/iOS behavior remain unproved as stated above.

The only added runtime dependency is exact jose 6.2.12. The main client bundle
grows by about 15 KiB gzip; existing lazy PDF/DOCX bundles remain separate. The
existing Vite >500 kB bundle advisory remains. `npm audit` reports two inherited
moderate development dependency entries (vitest/@vitest/mocker 4.1.10), no jose
finding. This candidate does not update the unrelated test runner; review the
[maintainer advisory and 4.1.11 fix](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9)
with the security/dependency owner. Do not report the overall dependency audit as
clean or treat fixtures as independent cryptographic review.
