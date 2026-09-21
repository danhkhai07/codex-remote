# Combined encrypted API / migration / Hours candidate

Historical integration evidence for 3c5a7e7. The current fix candidate and
re-review handoff are in [encrypted-api-review-fixes.md](encrypted-api-review-fixes.md).
Leader confirmed Hours LIVE on 2026-09-21 at 16:53 (PID1758426, b763a0f7…16702e93);
this supersedes the recovery-pending status below. No deployment is performed here.

Branch `integration/secure-api-foundation-hours`, worktree
`/root/WORKTREES/cr-secure-api-foundation-hours`. Candidate only: no main merge,
production key, live configuration change, DNS creation, release arming or restart.
Independent protocol review is still required. Root/fullAccess remains available;
the tunnel does not weaken inner authorization, CSRF, file rules or Plan controls.

## Exact integration

- Started at encryption/cache `d88b163dc9c39412307031e037f655576e2ee311`.
- Merged foundation `1706f3ba9b844885ccffea8069015e13894052c7` as `a810097`.
  PreviewMigrationGate encloses SecureGate. The installed migration callback calls
  ensurePreviewMigrationReady(true) before setup/login/unlock; api.session rechecks
  too. A late legacy tab blocks key proof, not only initial mounting. Root barriers,
  trusted proxy IP selection and login admission before body reads are preserved.
  Proof attempts have their own bounded LoginRateLimiter, reserving before body
  reads and finishing in finally; password success cannot clear proof failures.
- Merged main `783b1e3ae0efd683458c9fa0b3518b2e476b06a9` as `4c4de07`.
  Pause/resume, paused state, continuous baseline, generator/template and bridge
  commands remain intact. JS build SHA equals the new approved Hours hash:
  `b763a0f7b74c0341684e196855e85b3f5e3b123915a373b27463c17916702e93`.
  This supersedes the old a9a74ac pin. Leader later confirmed Hours recovery complete (16:53). Source equality never
  authorizes editing its runner/seal/runtime.
- `0780238` updates only the Vitest dependency family 4.1.10 -> 4.1.11, retaining
  unrelated package pins. Verified against the [maintainer's advisory](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9).
  Initial npm 10.9.8 install hit an Arborist optional-peer graph error. Lock update
  used legacy-peer-deps, then normal npm ci succeeded. No global npm/config change.
- `12e0a2c` fixes a reproduced blank sandboxed native PDF iframe. PDF uses existing
  PDF.js bounded page/canvas/zoom rendering (64 MiB body cap); original downloads
  remain byte-identical. DOCX and PPTX paths remain protected by their existing
  body/conversion limits. No new renderer or fixture dependency.

Mandatory tunnel rejects cookie-only legacy private APIs, including localhost.
Isolated-only preview origins, parent-session grants/revocation, preview private
revalidation, response filtering and HMR remain in place. No same-origin fallback.

## Evidence and reproducibility

All heavy commands run sequentially in codex-heavy, Vitest one worker. Fixtures use
fake credentials/keys and native RPC; no real model call, production pause, real key
or live state is involved. See the final checked revision in the worker handoff.

```sh
codex-heavy --label combined-check -- env VITEST_MAX_WORKERS=1 npm run check
codex-heavy --label combined-documents -- env PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/secure-documents-browser.mjs
codex-heavy --label combined-secure-browser -- env PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/secure-api-browser.mjs
codex-heavy --label combined-preview -- env PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs SECURE_FIXTURE=1 node scripts/preview-cache-browser.mjs
```

Combined verification: npm ci/audit reported zero findings; npm run check passed
432 Vitest tests (73 files), 11 Node readiness tests, lint, TypeScript, client/server
builds and PWA validation. Four generator Python tests passed during the Hours
merge. Final regression log: `/tmp/cr-secure-combined-fullcheck.log`; document
fixture log: `/tmp/cr-encrypted-documents-acceptance.log` and screenshots under
`/tmp/cr-encrypted-documents/` (local evidence, not production state).
The aggregate command initially ended at the legacy Hours browser fixture: its
mock lacked the new file-roots response. Added explicit legacy setup/file-roots
mock responses, then reran only that fixture and lint; see
`/tmp/cr-secure-combined-remaining.log`. The real encrypted Hours fixture had already
passed. No production-code change or repeat full suite was needed for that mock fix.

The document fixture generates real OOXML/PDF using Python's standard library,
then exercises actual gateway file handlers, SessionRegistry and secure transport.
PPTX runs the actual isolated LibreOffice converter. The matching UI build replaces
only the fixed Hours path with a temporary file path; actual WorkHoursStore and
bridge run against fake state/time. No production dashboard is read or modified.

Confirmed fixture behavior at 1280x900, 390x844 and 320x700: DOCX text/table/zoom;
PPTX conversion and slide 2; PDF page 2; original PDF/DOCX/PPTX saves byte-for-byte;
explicit >64 MiB save refusal without FileSystemAccess; page and Files Hours bridge
pause/resume, stopping a manual timer, paused totals after reload and encrypted
commands. Network instrumentation sees only public setup/login and secure routes,
no private document path/content/key in transport payloads. Screenshots were
inspected; this is Chromium at mobile dimensions, not an actual iOS/Safari test.

The secure browser fixture also rechecks late legacy-tab refusal before proof,
reload ciphertext cache/changed bytes/deletion, malformed/quota/wrong-key storage,
Plan answers, encrypted SSE/reconnect, attachments, checked-revision Vault,
orchestration, multi-tab lock/logout and key rotation. Maintenance CLI and Nginx
fixtures cover fake provisioning/rotation, authenticated adapters and 25 MiB
uploads across the 36 MiB wire limit. The inherited HTTPS/migration/Files/Plan
fixtures remain additional regression evidence; legacy-mode fixtures are not
reported as encrypted-transport evidence.

Measured fixture API body bytes after reload/login/unlock/revalidation:
193,998 -> 1,135 (99.41% saved). Updated isolated Vite preview: 215,580 -> 0 bytes,
five 304s, HMR/current bytes/two-port separation and logout WS/grant denial pass.
Nginx passes 26,214,400 plaintext bytes as 35,063,561 encrypted wire bytes; combined
Node client/gateway peak RSS 352,380 KiB. Document fixture runner peak memory was
867,905,536 bytes, no OOM. Browser heap sample after cache stress was 195,142,648
bytes; the 64 MiB persistent ciphertext cap is not a renderer memory claim.
The full regression runner peaked at 1,309,958,144 bytes, with memory-high throttling
and no OOM.
These fixture results do not predict user-device latency or memory.

## New manifest and rollout contract

After final build/commit, generate an exclusive-create inventory outside the repo:

```sh
codex-heavy --label candidate-inventory -- node scripts/secure-candidate-manifest.mjs /temporary/NEW-candidate-manifest.json
```

This is **not a seal or armable release**. It records commit, dirty state, all client
hashes, changed backend JS/maps against exact main783b1e3, dependencies, operator
CLI, admin Nginx snippet and preserved Hours artifacts. It reads no runtime file,
credential, marker or user state. A final delivery inventory must have dirty=false.

Backend JS/map stems to include (38 files): auth, config, directory-listing,
file-policy, http-app, localhost-preview, login-rate-limit, pptx-preview,
preview-cache, push, request-ip, secure-api, secure-client, secure-key,
secure-response, secure-viewer, secure-wire, server-files, session-registry.
Install the complete matching client asset tree/index last, including
migration-check-sw.js and the matching app SW. Runtime dependency jose6.2.12 is new;
Vitest4.1.11 is development-only. Existing PDF.js/docx-preview lazy dependencies
remain. Preserve source/build work-hours.js/map and generator/template from main783b1e3.
Never restore the old estimator over a pause-aware state.

Operator set: secure-key.mjs, secure-maintenance.mjs, knowledge.mjs, services.mjs,
restart-when-idle.mjs, restart-readiness.mjs and session-cookie.mjs. Use the reviewed
old watcher for the first pre-restart idle gate (old gateway lacks secure setup),
then public post-restart health and the new authenticated CLI for verification.
Later restarts use the new adapter. Do not execute incompatible historical
plaintext private-API smoke/apply scripts in required mode.

Admin Nginx: exact /api/secure/request location with 36m body cap, existing trusted
proxy header filters, request/response buffering off and long stream timeout.
Do not apply this location to preview apps. The isolated preview TLS/vhost and
Workboard configuration remain separately reviewed leader artifacts; sample
configs must not overwrite deployed vhosts blindly.

**NEW release baseline pending:** Hours recovery has been verified by the leader.
Capture a NEW release inventory (runtime/client/config/generator/template and fresh
PID/state evidence), then seal matching artifacts after independent re-review.
Existing release2fd0cff/resolution/Hours seals are not edited or
armed by this task. Leader gates also include DNS/TLS/Nginx/Workboard and a new
browser profile before new credentials/key, followed by ALL-idle activation and
live verification. No plaintext fallback is an acceptable recovery mechanism.

## Remaining limits

The migration inspector is a known-URL residue check, not proof that arbitrary old
same-origin SW/tab/cache code is absent. Preserve the foundation's residual attack
reproduction and clean-profile requirement. Tests alone do not approve the protocol.

PDF preview is static: pages/zoom; no interactive forms/scripts/media/annotations
or text selection. Download the original for those functions. The three small
fixtures do not prove fidelity for every complex document. Saves >64 MiB without
FileSystemAccess explicitly fail; actual Safari and password-manager products have
not been exercised. Transport and renderer limits are documented in
[the rollout notes](encrypted-api-rollout.md), as are persisted draft/storage
residuals, root/XSS/bootstrap threats and the inability to erase downloaded copies.
