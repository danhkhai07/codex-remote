# Independent re-review of 80843c0

Date: 2026-09-21. Task: `495dde6f-4bd0-48db-b209-512662cf0f04`.
Exact reviewed implementation: **80843c0947c5e665a51a6207dbb871bf2c06a421**,
`fix/secure-api-review-findings`. Independent checkout:
`/root/WORKTREES/cr-secure-api-fixes-review`, branch
`review/secure-api-fixes-80843c0`.

**No remaining P1/P2 blocker found in this focused re-review. R1-R4 are closed
for this exact implementation.** This supersedes their open status at d88b163,
not the historical evidence in [the original review](encrypted-api-independent-review.md).
It is not an exhaustive audit, assurance against root/XSS/frontend substitution,
or approval of a production release/runner that has not been reviewed here.

Only two additional fake controls and this report are changed in the review
branch. Application implementation remains byte-identical to 80843c0. No main
merge, production key provision, deployment, restart or production state changes
were performed. Maintained Vault updates are separate checked writes.

## Finding disposition

Line numbers below refer to the exact implementation hash.

| Finding | Status | Source and independently exercised evidence |
| --- | --- | --- |
| R1 P1: pending unlock crosses Lock | **Closed** | `src/secureApi.ts:14-20,44-63` captures lifetime before migration/setup; key proof/cache readiness publish only while current. Cache is local until ready; a stale catch cannot lock a later unlock. `SecureGate.tsx:9-31` invalidates submit/unmount state; `secure-client.ts` also guards connection epochs. Original inversions and setup/proof/cache newer-unlock controls pass. Real Chromium two-tab BroadcastChannel/setup/proof/unmount checks pass. |
| R2 P1: old mutation adopts a later unlock | **Closed** | `src/secureApi.ts:83-130` checks identity/cache reads, every dispatch/refetch and return; cancellation cannot enter the cache-corruption fallback on a newer channel. `src/api.ts:25-71` checks body parsing; `SecureFiles.tsx:33-51` binds picker/writable/blob work to original intent. Delayed POST has zero effects; stale picker sends no GET; stale writable receives zero bytes and aborts; fresh upload executes once. Multi-step upload/new-conversation, push and Hours continuations retain intent checks. |
| R3 P1: late native effects after revocation | **Closed for uncommitted effects** | `server/secure-api.ts:156-159` refreshes owner generation and validates session/channel/socket in the explicit request guard; `http-app.ts:288-295` composes it with session liveness. Router/controller preconditions recheck. Crucially `codex-app-server.ts:107-112` rechecks immediately after awaited startup, before synchronous stdio write; mutating controller calls pass this callback. All three actual fake-native startup cases and six controller metadata cases pass. Accepted operations deliberately remain accepted; independent controls below verify no automatic interrupt or loss of accepted bookkeeping. |
| R4 P1 operational: fixture mutates host Nginx paths | **Closed** | `scripts/nginx-fixture.mjs:21-52` uses five owned temp paths, pid/lock/access/error files, `-e stderr`, non-root systemd syntax/start units, strict read-only filesystem with one writable fixture directory, inaccessible host Nginx paths, empty capabilities and loopback-only networking. The new safe 25 MiB upload fixture passed here; host path owner/group/mode/inode and service/process identities matched before/after. Old fixture was not executed. |

### R3 boundary and independent controls

Reviewed native paths include create/resume, rename/archive with their existing
role/capability guards, skill/access/metadata reads preceding mutation, context
injection before turn start, interrupt and orchestration cancellation. Request
liveness is a distinct optional argument from role authorization. The final
stdio callback invokes both where applicable; a successful role check does not
substitute for a live browser request.

`request-lifetime.ts` uses an explicit WeakMap, not inheritable async context.
Scheduler-created jobs omit an HTTP guard while retaining their own role guard.
The source checks after asynchronous body/file/context work cover Vault writes,
uploads, group/read-state writes, preview grant creation and PPTX staging/new
converter spawn. Synchronous stores execute after a liveness check without an
intervening await. Accepted logout cleanup and accepted native-result bookkeeping
are intentionally allowed to finish.

Two new controls in `server/secure-independent-review.test.ts` hold a fake
`turn/start` reply **after the fake RPC has accepted the effect**, then logout or
abort the browser transport. They release the accepted reply and establish:

- the controller still records the running turn (a duplicate remains busy);
- no `turn/interrupt` is sent because the browser locked/logged out;
- a subsequent native completion notification is processed;
- an independent native/background create, without an HTTP lifetime, still
  succeeds with the fullAccess parameter retained.

These two controls use fake RPC acceptance; the existing startup tests use an
actual fake subprocess/stdio and prove cancellation before pipe dispatch. Neither
uses the real model or a real user thread. Already dispatched operations, shared
read-only queries or an already started bounded converter may finish; disconnect
is not rollback and does not promise to erase an accepted effect. An unknown
mutation result still must not be retried automatically.

## Integration and additional hardening

The changes from d88b163 through integrated
`3c5a7e7e2e2bd950ef33f31db932e3affd5396d3` and then 80843c0 were inspected,
including foundation1706f3b and Hours main783b1e3 compatibility.

- **Migration:** `main.tsx` mounts PreviewMigrationGate before SecureGate/business
  pages. `secureApi.ts:28` installs `ensurePreviewMigrationReady(true)` by default;
  setup/login/unlock and legacy restore paths await it. Focused migration tests
  pass. This is a known-residue barrier, not proof that arbitrary old same-origin
  SW/documents are absent; preserving URL still requires a clean browser profile.
- **Admission:** bounded password and separate proof limiters use `beginAttempt`
  before awaited request bodies and `finish` in finally. A password success does
  not reset key-proof failures. Capacity refuses new identities with Retry-After;
  existing blocked identities are not evicted. Exact trusted proxy IP handling is
  retained. Distinct-client/churn/expiry/spoof and slow-body focused tests pass.
- **Preview/session/file foundation:** proxy isolation, session registry, file
  access policy and legacy-worker source match the reviewed foundation1706f3b
  for those modules. Revocation/expiry and preview HTTP/WS protections remain.
  Required-mode outer private API gate and maintenance cookie + owner proof have
  no localhost/plaintext fallback. This re-review did not activate DNS/TLS/routes.
- **Framing:** `secure-wire.ts:35-62` rejects unexpected/zip headers before JOSE
  decrypt, explicitly disables decompression, caps request wire at 36 MiB and
  body frames at 1,024; server rejects empty bodies. Client coalesces tiny source
  chunks into 64 KiB records. Independent wire/empty/frame-count tests and maximum
  25 MiB upload pass. Ordered context/end checks and replay reservations remain.
- **IDB:** `secureCache.ts:5-6,39-45,118-188` validates byte accounting and row
  identity, replaces getAll with cursor scanning and bounded retained metadata,
  caps scan count/row count/pending writes/queued body bytes, and deletes namespaces
  by key range. Real browser malformed negative/NaN/infinite/zero/fractional/large
  counters are rejected and pruned; instrumented getAll is never invoked. Cache
  keys remain separate and in memory; plaintext reuse requires fresh authorization.
- **Documents:** PDF/PPTX use bounded PDF.js canvas rendering with no annotation
  or scripting action layer. HTML remains opaque sandbox + restrictive response
  CSP; DOCX uses a scriptless shell with altChunks disabled; SVG is image-only.
  API blob/text completion and Gate unmount prevent stale private display.
  Renderer source was reviewed; this turn reran lifecycle Chromium, not the full
  PDF/DOCX/PPTX desktop/mobile matrix already reported by CR3.
- **Hours preservation:** `server/work-hours.ts` and `working-hours/` have no diff
  against main783b1e3. The fresh server build in this review worktree produced
  work-hours.js SHA **b763a0f7b74c0341684e196855e85b3f5e3b123915a373b27463c17916702e93**,
  matching production. Pause/resume bridge is retained; no real Hours mutation.

## Independent checks performed

All test/build/browser work ran sequentially through codex-heavy, Node 22,
`VITEST_MAX_WORKERS=1`, `NODE_OPTIONS=--max-old-space-size=1024`.

1. `/tmp/secure-rereview-80843c0.log`, unit
   `codex-heavy-15656bf2184b44a2976ffd86954196d4.service`, exit 0:
   **114 tests in eight files passed**, including the 24 inverse review cases,
   wire/API/controller/orchestration/migration/limiter/security integration.
   Fresh isolated server build passed, followed by real two-tab Chromium/Gate/
   BroadcastChannel/IDB/picker/writable lifecycle fixture, zero page errors.
2. `/tmp/secure-rereview-controls-nginx.log`, unit
   `codex-heavy-7ea90fcff7df4a8c837fd275f1e604a1.service`, exit 0:
   **two additional accepted-work controls passed** (24 already-run cases skipped
   intentionally), focused lint zero warnings/errors, new restricted Nginx fixture
   passed. 26,214,400 plaintext bytes became 35,063,561 encrypted wire bytes with
   exact uploaded content; oversize upload rejected before dispatch. Node peak RSS
   365,348 KiB. Host Nginx metadata/process/service unchanged.
3. Diff whitespace check clean. Main remained 783b1e3, gateway PID1758426 active;
   production Hours hash unchanged. No production Nginx metadata/config repair.

The full CR3 462 + 11 suite is not claimed as independently rerun here. Focused
coverage was chosen because this branch changes tests/report only. Revocation
fixtures intentionally log generic expired-authorization/aborted-request errors;
those are exercised rejection paths, not failing tests.

## Residual limits and release handoff

- This reviews code and bounded fake executions. It does not establish absolute
  security, constant total process heap, cryptographic formal verification, real
  Safari/device/password-manager behavior or performance at deployment load.
  IDB must materialize an individual row before validating it; an arbitrarily
  altered browser database or XSS is not proven harmless by the cursor tests.
- Counts/budgets bound tracked state and application queues, not every temporary
  allocation or already-dispatched native work. Storage/network failure may
  discard ciphertext cache and fall back to authorized online GET. Logout purge
  remains best-effort; retained ciphertext is not offline-authorized plaintext.
- Root/fullAccess, active XSS/frontend substitution, model-provider E2E, existing
  plaintext drafts and downloaded copies remain the documented accepted/excluded
  boundaries. No new claim is made to resolve them.
- Leader still reviews the **new** immutable release/runner, baseline and rollback;
  DNS/TLS/exact preview hosts, trusted proxy/Nginx activation, Workboard, clean
  browser profile, operator access and approved owner-key provisioning remain
  rollout gates. Preserve current Hours JS/map/generator/template and all excluded
  files. Activate only through the reviewed ALL-idle watcher. No old seal was
  changed and no runner was armed by this task.

No implementation patch is requested by this re-review. Keep the added controls
as regression coverage when integrating; the rollout implementation remains
pinned to 80843c0 unless leader explicitly reviews later application changes.
