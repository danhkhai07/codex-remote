# Encrypted API review fixes — candidate for independent re-review

Task d2e6f946-a4e3-4b4c-8d35-63f31a20c0f7. Worktree
`/root/WORKTREES/cr-secure-api-review-fixes`, branch
`fix/secure-api-review-findings`, from exact
`3c5a7e7e2e2bd950ef33f31db932e3affd5396d3`.
The independent report/fixtures a3db351 were cherry-picked as 0c74904. Their
original green results demonstrated vulnerabilities. All seven cases now assert
rejection/no late effect; additional controls exercise normal authorized work.
R3 backend b3406c9, browser lifetimes 962a6a0, frame bounds 44c5994 and
IDB/browser races cc45fb1 are separate commits. A final stdio-dispatch guard was
added in 1d50930 after source review found that native startup itself awaits before sending.
Fixture-only 95fa889 waits for the authenticated Plan acknowledgement rather than
assuming a browser click has already produced a native receipt.
The historical [independent report](encrypted-api-independent-review.md) remains
unchanged as evidence. This response is implementation evidence, not audit approval.

## Findings and implementation

| Finding | Fix | Acceptance evidence |
| --- | --- | --- |
| R4 P1, root Nginx fixture can mutate host paths | Addressed first, c8c7c6b. All five temp paths, pid, lock and logs use a newly owned directory. Syntax/start run as nobody in separate restricted systemd units, `-e stderr`, ProtectSystem=strict/ProtectHome, writable temp directory only, host Nginx directories inaccessible, loopback-only networking. | Safe 25 MiB fixture and host metadata/service/process identity equality before/after. Static inverse R4 asserts all five paths and restrictions. |
| R1 P1, stale unlock crosses Lock | Wrapper lifetime begins before migration/setup/proof/cache. Local cache candidate publishes only while current. Transport handshake and Gate submission/unmount lifetimes prevent old completions from restoring private state or clearing a newer unlock. | Original two inversions; setup/proof/cache newer-unlock controls; real Chromium Gate/two-tab BroadcastChannel with held setup/proof; migration held across actual Gate unmount. |
| R2 P1, old intent adopts a fresh channel | Guard before/after cache identify/read/body/refetch, request dispatch and response parse. File picker/writable/blob completion keeps original intent. Multi-step conversation/upload/turn, push, Services, Hours bridge and session migration restore check continuation lifetime. | Original inverse mutation; held get/body tests prove no fallback dispatch; real browser held identity mutation, picker and writable completion produce zero new effects/bytes; fresh explicit upload succeeds once. |
| R3 P1, async business handler starts native effect after revoke | Explicit request-lifetime guard binds response/channel/session/owner generation; router checks after awaits, controller checks native boundaries and forwards to the final stdio dispatch after startup/reconnect, PPTX checks before new writes/converter spawn, orchestration cancel forwards guard. Role guards remain independent. | Original logout/expiry/rotation inversions; real controller metadata waits for rename/archive/resume/interrupt/start-turn/skills; context injection accepted before logout but no later turn/start; rotation checked without another setup request; normal interrupt emits exactly one native interrupt; actual fake-native subprocess held at initialization emits zero mutations after logout/expiry/rotation, then accepts a fresh normal control. |
| Frame/decompression hardening | Reject empty body frames; independent 1,024-body-frame / 36 MiB wire caps; standard client coalesces into 64 KiB frames. Exact protected-header allowlist runs before jose decrypt, with maxDecompressedLength=0. | Empty and 1,025-frame requests have zero dispatch, tiny source chunks still work, wire/line limit and zip/extra-header tests. Safe Nginx upload verifies maximum standard payload. |
| IDB accounting hardening | Reject negative/NaN/infinite/fractional/mismatched byte counts; cursor retains bounded metadata, pending writes bounded, namespace purge uses key ranges. No getAll in cache implementation. | Real IDB rows with six malformed accounting variants are rejected/pruned; instrumented getAll throws and is never called; existing quota/corruption/LRU/wrong-key browser regressions. |

`server/request-lifetime.ts` stores guards explicitly on synthetic/native requests.
It deliberately avoids inheritable async context: ongoing agent jobs and scheduler
callbacks continue independently after browser Lock/logout. Controller liveness is
a separate optional argument from the existing role/capability guard, preserving
manual control, leader permissions, Plan/sandbox/fullAccess behavior. Bodies and
native-effect preconditions recheck immediately before new effects. Accepted valid
RPCs are not rolled back; necessary accepted-result bookkeeping and logout cleanup
remain. A conversion already started may finish within its existing sandbox/time
limits, while response delivery still requires a live channel. Socket closure is
not claimed to cancel JavaScript or undo effects. No automatic mutation retry was added.

PPTX/file inspection, HTML sandboxing, upload ownership, Vault optimistic revisions,
CSRF/origin checks, isolated preview grants and revocation remain in force. There
is no same-origin preview fallback, plaintext API fallback, model turn or real
Hours/pause mutation in these fixtures.

## Verification

All heavy commands use codex-heavy and VITEST_MAX_WORKERS=1; browser and CLI checks
run sequentially. Fixtures generate temporary fake credentials/key/state only.
No live `.env`, owner key or runtime state is copied. Final check results and
inventory path are recorded in the delivery handoff and Vault checked revision.

Confirmed browser/CLI regression log: `/tmp/cr-review-browser-cli-regressions.log`.
Real PDF/DOCX/PPTX and fake-state encrypted Hours page/Files pass at 1280/390/320.
Secure API cache after reload/unlock/revalidation: 193,998 -> 1,135 response bytes
(99.41% saved); the final rerun private cache stress totals 61,579,420 encoded bytes, renderer heap
sample 71,077,054 bytes (measured in the final-verified log below). Isolated preview Vite: 215,584 -> 0 body bytes, five 304s,
current bytes/HMR/two ports and logout/grant/WS denial pass. Safe Nginx:
26,214,400 plaintext -> 35,063,561 wire bytes, max-upload equality and oversized
local rejection, Node peak RSS 325,308 KiB; all host identities/metadata unchanged.
These fixture measurements do not predict user-device latency or memory.

The final fullcheck passes 462 Vitest tests in 75 files + 11 Node tests,
lint/typecheck/client+server build/PWA. After adding the final stdio boundary,
75 focused tests also pass, including 24 review acceptance cases and actual
fake-native startup revocation. The complete run and affected secure-browser/CLI/Plan follow-up are in
`/tmp/cr-review-final-verified.log`. Earlier mock-signature failures were
fixed to assert the new liveness argument; the Plan fixture now waits for its
receipt. No failing result is counted as accepted.

Reproducible commands (inside codex-heavy):

```sh
export VITEST_MAX_WORKERS=1
export PLAYWRIGHT_MODULE=/tmp/working-hours-browser/node_modules/playwright/index.mjs
npm run check
node scripts/secure-lifetime-browser.mjs
node scripts/secure-api-browser.mjs
node scripts/secure-documents-browser.mjs
node scripts/secure-maintenance-fixture.mjs
node scripts/secure-proxy-fixture.mjs
SECURE_FIXTURE=1 node scripts/preview-cache-browser.mjs
node scripts/security-browser.mjs
node scripts/security-migration-browser.mjs
node scripts/plan-questions-browser.mjs
```

Only the updated safe Nginx helper may run. A source audit of repository scripts
found no other Nginx start/syntax-test fixture. `-p` alone does not confine compiled
absolute Nginx temp paths. Neither tests nor this task repair/chown/reload production
Nginx; the leader owns host remediation. The fixture aborts if before/after host
metadata or service/process identity differs. This equality check describes the
fixture run, not an audit of prior host operations.

## Rollout and remaining gates

Leader reports Hours LIVE verified 2026-09-21 16:53 Asia/Ho_Chi_Minh, PID1758426,
SHA256 `b763a0f7b74c0341684e196855e85b3f5e3b123915a373b27463c17916702e93`.
Recovery-pending wording in the historical candidate is superseded. Preserve this
backend JS/map plus pause-aware generator/template from main783b1e3. Do not copy
all dist-server files. The new manifest enumerates changed files only and asserts
the preserved Hours build hash; the leader still needs a fresh release inventory.

The release must include matched client assets, backend JS/maps (including new
request-lifetime and changed controller/orchestration/codex-app-server), package/lock with existing
jose6.2.12 and patched Vitest4.1.11, maintenance CLI set and reviewed 36m admin tunnel
Nginx location. This fix adds no dependency. Generate a NEW inventory using
`scripts/secure-candidate-manifest.mjs`; do not edit/arm historical releases.
Independent CR2 re-review, DNS/TLS/Nginx/Workboard, clean browser profile, operator
key provisioning after approval, new seal and ALL-idle watcher remain leader gates.
Nothing has been merged, armed, deployed or restarted by this task.

Residual scope is unchanged: known-URL migration inspection cannot prove absence
of arbitrary old same-origin service workers/tabs; the residual reproduction and
clean-profile requirement remain. No true Safari/password-manager product test,
no root/VPS/XSS-while-unlocked defense, no model-provider E2E, no retroactive erase
of downloads or existing plaintext drafts/storage. The fixture proves its bounded
cases, not protocol audit completion or user-device latency/memory guarantees.
