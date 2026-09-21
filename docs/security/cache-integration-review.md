# Independent review: security + browser cache candidate

Reviewed fixed base `2fd0cff7bec12ea0de1320fdd082675aeff6c240` in a new worktree,
branch `integration/security-preview-cache`. Cache ported from `93c197c`/`cce4c71`;
no edit to the security worker checkout, main or release state. This supersedes
the earlier dirty snapshot review for the findings below, not the live audit.
Model/effort inherits the CLI turn; no claim that task override is live.

## Findings and disposition

| Priority / finding | Implementation evidence and result |
| --- | --- |
| P1 credential generation, password-only restart | Base now signs v2 tokens with a credentialVersion derived from signing secret and password; SessionRegistry validates it. Real HTTP regression starts a second gateway with changed fake password/same secret/state; old token under normal and renamed cookie returns 401. Existing durable-registry test covers restart/revoke and corrupt-state failure. Fixed in base; cookie rename alone is not the defense. |
| P1 isolated previews and parent grant revocation | Base routes `/preview/port` to a ticket redirect only, or 503 without isolation; iframe/direct app execution belongs to per-port origin. Parent nonce/generation/expiry are bound to grants. HTTPS browser regression and real-registry cache fixture exercise login/ticket/logout/replay. No path adapter restored. |
| P1 private Vault mailbox | Base denied `.state`, but not `Conversations/<id>/.orchestration`, where orchestration-mailbox.ts reads capability-bearing request/processing JSON. Integration adds lexical/canonical `.orchestration` deny. Fake canaries for info/content/HTML/PPTX, symlink alias and hidden listing are denied. No real mailbox content was read. |
| P1 file/parent symlink replacement | Base `policyOpen` validates `/proc/self/fd` and file type after NOFOLLOW open; `openInspectedFile` compares dev/ino/size/mtime and reads the same descriptor. Content/HTML/PPTX use that path. Real file/parent replacement canaries reject. This protects path substitution, not a hostile root actor rewriting the same inode/hardlinking/copying a secret. |
| P2 directory listing race | Base realpath/stat followed by pathname readdir could enumerate a private replacement directory. Integration opens/validates a directory descriptor, enumerates via that descriptor and validates child metadata descriptors. Deterministic real-filesystem rename/symlink at readdir boundary returns only the original public names. The same test against exact base source fails by exposing the fake private filename, confirming the regression. |
| P2 proxy control response headers | Base cleanHeaders removed hop headers/cookie Domain/clear-site-data but passed X-Accel-* to Nginx. Integration drops X-Accel-* and X-Sendfile before HTTP/WS responses, avoiding upstream control over internal redirects/buffering/cache directives. Unit fixture checks injected canaries are absent; no production exploit claimed. |
| P2 stream expiry timer | Base clamped a 30-day TTL timer to ~24.86 days and then closed early. Integration rearms until real expiry. Fake-clock test proves no early close and eventual close. |
| P2 expiry at cache/upgrade boundary | Recheck actual SessionRegistry after synchronous hashing and before WebSocket upgrade forwarding, in addition to watchers. Real-registry tests advance time during read and immediately after real hashing; no late body/304. |
| P2 F5 trusted proxy/rate limits | Base uses exact configured peers and a single validated X-Real-IP; rejects invalid/comma/port values, normalizes mapped IPv4, does not walk XFF/CF headers. HTTP fixture isolates A's 429 from B's 200; untrusted spoof stays rate-limited. Runtime Nginx/Cloudflare trust configuration remains a separate unverified deployment gate. |
| **P2 remaining: rate-limit key memory** | `login-rate-limit.ts` retains expired keys until the same key is queried again; no global TTL sweep/cap exists. Trusted-proxy spoofing is fixed, but many distinct real IP failures can grow the map. Add a bounded admission policy plus expiry pruning in a follow-up; do not claim this part of the earlier F5 acceptance is complete. |
| **P1 remaining: old SW/tab migration** | Browser reproduction below confirms the residual. Do not mark complete from unregister unit tests or a fresh browser profile. |

## Confirmed legacy-origin migration residual

`scripts/security-migration-browser.mjs` runs a temporary legacy origin, installs
a preview-scoped service worker that caches a canary HTML response, switches its
network route to the candidate gateway, and runs the actual compiled
`src/legacyPreviewWorkers.ts` helper. It uses fake credentials only.

Observed Chromium results:

- After cutover, direct reload and iframe still execute cached preview HTML with
  the administrator origin, including offline reload, before cleanup runs.
- Actual cleanup removes preview registration, keeps the root app worker and
  local draft, but the already-open legacy document can still read the NEW
  `/api/session` response/CSRF after login. No secret values are logged.
- Closing the legacy iframe/tab then opening a fresh URL reaches candidate 503
  when isolation is unconfigured. This proves scoped cleanup + closed clients in
  the fixture; it does not establish that every user's old client is closed.

Rollout must require closing ALL old same-origin preview/workboard documents and
cleaning their registrations before new authentication. The current cleanup is
fire-and-forget and does not enforce that ordering, so this remains a P1 migration
gate. If arbitrary prior same-origin compromise is in the threat model, a clean
browser profile or new administrative origin is the stronger boundary; a known
scope-only unregister cannot prove removal of arbitrary persistence/root-worker
replacement. Operator/user policy must be explicit. No claim of compromise on a
real device, no production browser exploit, and no claim of complete remediation.

## Scope limits and rollout manifest

Gateway/executor still run as root and authorized fullAccess remains available.
Path filtering is not an OS sandbox or general secret classifier. Preview apps
can keep bytes they already received in their own origin/service-worker storage.
Same-site distinct-origin HTTPS topology is browser-tested; arbitrary cross-site
iframes/Safari/device configurations are not established by these fixtures.

Create a NEW release/baseline after leader review, not a change to existing
prepared releases. Relative to runtime main, security backend modules plus maps:

`auth`, `config`, `directory-listing`, `file-policy`, `http-app`,
`localhost-preview`, `pptx-preview`, `request-ip`, `server-files`,
`session-registry`, **`preview-cache`**: 22 `.js`/`.js.map` artifacts total.

Include the security client build (legacy cleanup/file-root UI), install assets
before atomic index switch and retain previous hashed assets. Controller,
orchestration and work-hours runtime files are outside this manifest. Preserve
`work-hours.js` SHA256
`a9a74ac46cd4c72b5ff350188d3edf648d8b4ffe2a5fbf4a494f68fab691bd91`.
Do not deploy this list with the old runner unchanged: review its module allowlist,
new candidate seal and fresh baseline together. DNS/TLS/Nginx/Workboard integration
and idle/pending gates belong to the leader; no merge/deploy/restart here.

## Verification record

`codex-heavy` sequential, `VITEST_MAX_WORKERS=1`: full `npm run check` passed
382 Vitest tests / 69 files, 11 Node readiness tests, lint (0 warnings/errors),
typecheck, client/server builds and PWA validation. One additional late-upgrade
expiry test then passed in a focused 20-test regression run plus lint; no
production source changed after the full check. Vite emitted the existing >500kB
bundle advisory (not a failure).

Browser fixtures passed: real-registry Vite cache (215,529 -> 0 body bytes / 5x304),
HTTPS isolation with fake native RPC (0 calls, iframe/direct-tab access denied,
logout/replay401, existing preview WS closed), Files 1280x900 + 390x600, and Plan
questions (desktop/mobile/custom/Skip/retry/reload/reconnect/Stop). Migration
fixture deliberately asserts and reports the residual P1 described above.
Temporary exact-base directory test reproduced the private-filename leak;
fixed descriptor implementation passed. All canaries/credentials are fake.
Local logs: `/tmp/cr-security-cache-check.log`,
`/tmp/cr-security-cache-browser.log`, `/tmp/cr-directory-race-baseline.log`.
These temporary logs are supplementary; committed scripts/tests preserve the
reproducible evidence. No real Codex/model turn, production session or service
restart was used.
