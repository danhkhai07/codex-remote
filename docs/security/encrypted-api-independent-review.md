# Independent review: encrypted API and browser cache

Reviewed source: **d88b163dc9c39412307031e037f655576e2ee311**
(`feat/secure-api-cache`), 2026-09-21. Review worktree:
`/root/WORKTREES/cr-secure-api-protocol-review`, branch
`review/secure-api-protocol`. Task `0abe7a7d-aa09-4d68-96ff-7f6b03b27682`.

**Do not roll out this fixed candidate unchanged.** Findings below concern this
hash, not CR3's parallel integration tree. No integrated candidate is approved
by this report. Only review fixtures and this report are changed here; the
integrator owns implementation fixes and subsequent acceptance checks.

## Findings

### R1 — P1: a pending unlock can undo a later Lock

Locations: `src/secureApi.ts:27-36`, `src/secureApi.ts:38-48`,
`src/SecureGate.tsx:18-25` (all line numbers refer to reviewed d88b163).

`unlockSecure` awaits migration readiness and fresh setup before calling the
transport's unlock. It does not capture/check the wrapper's operation epoch.
Lock increments that epoch and clears the current transport, but a previously
started unlock can subsequently call `secureTransport.unlock` with a fresh
transport epoch and restore the owner key/channel. The submit handler can then
mount private UI again. The transport's own handshake epoch checks do not cover
waits *before* transport unlock starts.

Reproduction: start unlock with the migration hook or setup request delayed;
invoke the same `lockSecure(false, false)` action used by the cross-tab receiver;
release the old wait. Both PoCs observe `secureUnlocked() === true`; the first
also successfully reads a private canary through the encrypted API. No second
unlock intent is supplied. The setup-delay variant exists even before the
foundation migration hook is installed. The browser module, transport, real
crypto and isolated server are exercised; the timing hook is controlled by the
test, not a real browser scheduler or real BroadcastChannel.

Minimal fix: an operation token must cover the entire unlock, starting before
its first await, with checks before publishing owner/cache/UI state and after
each wait. Lock/logout/unmount must invalidate pending gate submissions too.
Superseded work must not clear a newer successful unlock. Use a local cache
candidate until its unlock succeeds and the operation is still current.

Acceptance: release each old migration/setup/proof/cache wait after Lock and
after Lock + a distinct new unlock. Old work rejects without restoring private
UI/key/cache or cancelling the newer operation. Add a real two-tab browser case
with Lock while the other tab's setup/proof is held.

### R2 — P1: pre-lock mutations can execute after a new unlock

Locations: `src/secureApi.ts:60-69`, `src/secureApi.ts:78-99`.

`secureFetch` captures an epoch but awaits cache identity/read before dispatch
without checking it. A request queued before Lock can therefore continue on the
new global transport after re-unlock. Checks on selected GET return paths are
too late to prevent a POST effect; the generic non-GET return has no wrapper
epoch check. The cache-miss/refetch catch also catches cancellation and can
dispatch through a newer transport.

Reproduction: unlock, hold `CipherCache.identify`, start a fake POST, Lock, unlock
again, then release identity lookup. The isolated server records exactly one
mutation *after* the second unlock. The test delays an actual asynchronous cache
boundary; it does not manually call the dispatcher or reuse a transport packet.
This is stale user intent crossing the lock boundary, not cryptographic replay.

Minimal fix: validate the captured generation before every dispatch/refetch and
after asynchronous cache operations; preserve cancellation as cancellation.
Never adopt a new transport/session silently for an older operation. Check
generic response delivery as well. Apply the same intent lifetime to downloads
awaiting a file picker/writable handle and UI async continuations.

Acceptance: held identity, cache read, body-decrypt fallback and picker operations
cannot read/write under a later unlock; side-effect count remains zero. Ordinary
same-epoch cache corruption still refetches GET once. Never replay a mutation on
unknown outcome.

### R3 — P1: native effects can begin after session/channel invalidation

Locations: `server/http-app.ts:620-625`, `server/secure-api.ts:139-150`.

The tunnel checks authorization before dispatch and closes response/request
streams when the session/channel becomes invalid. However, an async business
handler already past body parsing can resume after a pending access check and
invoke a new native effect. Destroying its streams does not cancel JavaScript
continuations. The interrupt route awaits `controller.assertThreadAccess`, then
calls `userStop`/`interruptTurn` without checking request/session/channel liveness.

Reproduction: real HTTP router and encrypted transport, fake controller access
check held on a promise, fake native interrupt spy. Log out on a concurrent
encrypted request; it returns `{ok:true}`. Further private access is rejected and
the held request loses its connection. Release the access check: only **then**
does the native interrupt spy run. No real thread/RPC is involved. Equivalent
expiry and key-rotation cases are included in the fixture.

Minimal fix: propagate an authorization/lifetime guard into business dispatch;
recheck after asynchronous preconditions and immediately before starting each
new effect, with session, channel generation/expiry and request cancellation
covered. Audit other access/file/upload/knowledge/orchestration awaits with the
same pattern. Do not pretend that closing a socket rolls back an effect already
committed while authorization was valid; define that boundary explicitly.

Acceptance: logout, expiry and owner-key rotation while the access check is held
prevent the later native call entirely; a normal same-session continuation still
executes once. A previously committed mutation may have an unknown outcome and
must not be replayed automatically. SSE closure tests alone do not cover this.

### R4 — P1 operational: the Nginx fixture can change live temp-directory owners

Location: `scripts/secure-proxy-fixture.mjs:33-41`.

The generated config sets a temporary prefix/pid and stderr logging but omits
all five HTTP temp path directives. The VPS Nginx binary has absolute compiled
defaults: `/var/lib/nginx/body`, `/var/lib/nginx/proxy`,
`/var/lib/nginx/fastcgi`, `/var/lib/nginx/uwsgi`, `/var/lib/nginx/scgi`.
`-p <temporary-directory>` does not rewrite absolute defaults. Both the syntax
test and fixture startup initialize configured paths; when run as root they can
create/chown those host directories to the fixture's default Nginx user. Other
live Nginx workers can then lose access. `master_process off` does not isolate
filesystem effects, nor does the resource-limited codex-heavy cgroup.

Evidence: read-only `/usr/sbin/nginx -V`; fixture source; upstream Nginx
`ngx_get_full_name` leaves absolute names unchanged, `ngx_init_cycle` calls
`ngx_create_paths`, which changes ownership to `ccf->user`. The included static
test detects all five missing directives **without executing Nginx**. This is
not a claim that this particular script caused an earlier production incident;
historical attribution would require separate execution evidence.

Minimal fix: explicitly place **all five** temp paths, pid, lock, startup/runtime
logs under the owned fixture directory; pass `-e stderr` for startup as well.
Prefer a non-root process or isolated filesystem namespace with exact writable
paths. Ensure configuration includes no default host temp paths, then verify
owner/mode of production paths are unchanged before/after a safely isolated
fixture run. Do not rerun the current fixture on the shared VPS to prove the bug.

Acceptance: syntax test and the 25 MiB encrypted upload fixture pass in a
restricted filesystem, all writes stay under fixture storage, and host Nginx
directory metadata and service identity remain unchanged. No production
ownership/config changes are authorized by this review task.

## Security boundaries examined

This is a targeted source/fixture review, not a cryptographic proof or exhaustive
penetration test. No claim is made against VPS/root compromise, XSS while
unlocked, hostile bootstrap/frontend substitution, already downloaded files or
an attacker already holding the owner key and authorized root execution.
Root/fullAccess is an explicit accepted user constraint.

| Area | Review result at fixed hash |
| --- | --- |
| Owner key | Provision/rotate uses CSPRNG 32-byte canonical base64url, private parent/0600 file, atomic replacement; loader checks fd/canonical location outside roots, owner/mode and rejects symlink/nonregular files. No production key was created/read. |
| Proof/session binding | HKDF context includes app, owner generation, session nonce/credential digest, challenge/channel and direction. Challenge is consumed before asynchronous proof verification. Session/key refresh is checked around handshake awaits. See R3 for dispatcher lifetime. |
| Wire authentication | Pinned jose `dir`/`A256GCM`, exact protected context/header set, independent proof/request/response keys. Ordered authenticated frames plus mandatory final bytes/chunks and request reservation before dispatch. No successful wrong-key/cookie-only/replay bypass found in inspected paths and existing focused tests. |
| Algorithms/compression | Application permits only the specified algorithms and rejects unexpected headers. Local pinned jose 6.2.12 supports `zip: DEF` with a default 250,000-byte decompression limit *before* the application's header check. Explicit `maxDecompressedLength: 0` or a pre-decrypt header allowlist would enforce the documented no-compression rule earlier; not an observed authentication bypass. |
| HTTP/private routing | Outer gate precedes private route dispatch, including errors, file APIs, Vault, services, orchestration, events, upload/download and preview-ticket issuance. Maintenance adapter uses cookie plus owner proof; no localhost plaintext exception. Public renderer routes contain no private payload. |
| Fresh cache authorization | Encrypted unchanged is produced only after current business authorization/handler/hash. Cache path/representation/revision are checked; HMAC body context binds id + encrypted revision. Ciphertext does not replace fresh authorization. |
| Cache/key persistence | Independent HKDF cache body/index domains, nonextractable keys held in memory, random-IV JWE, opaque resource/body IDs, encrypted metadata. LRU updates serialized in a transaction, quota/corruption falls back online. R1/R2 remain lifecycle blockers. |
| Rendering | HTML uses response CSP plus opaque `allow-scripts` sandbox; DOCX shell is scriptless with altChunks disabled; SVG is image-only; PDF has no script permission. Generated URLs revoke on lock/unmount. No admin-origin active-document escape was demonstrated. |
| Streaming/errors | Backpressure, frame/context validation, encrypted business errors, authenticated completion and uncertain-mutation failure without automatic retry. Existing focused tests cover expiry/logout/rotation stream closure and truncation. Socket closure alone does not cancel all dispatcher continuations (R3). |
| Admission/bounds | Pending challenges, handshake concurrency, channels, active requests, seen IDs, frame size, request bytes and aggregate counted buffers have explicit limits/TTL. This is not a proof of constant total heap use: per-frame/container overhead, IDB `getAll`, queued cache writes and slow consumers require integration/load coverage. |

Further boundedness hardening: empty authenticated request-body frames currently
increment a parts array without charging payload bytes (`secure-api.ts:126-136`).
Reject empty body frames and bound frame count/wire overhead independently of
plaintext bytes. IDB bookkeeping should validate nonnegative finite `bytes` and
avoid trusting corrupted accounting fields; `getAll()` can materialize more
storage than intended if that bookkeeping is corrupt. These are source-review
limits/hardening suggestions, not confirmed remote cookie-only memory attacks.

## Required integration and rollout gates

- This baseline intentionally has a no-op migration hook and the older login
  limiter. Compose foundation1706f3b: install `ensurePreviewMigrationReady(true)`
  before initial restore/login/unlock and use bounded `beginAttempt`/`finish`
  admission, including handshake composition. These are known integration
  contracts, not new discoveries or already-fixed claims in this review.
- Arbitrary same-origin legacy SW/documents cannot be proven absent by cleanup
  script or an acknowledgement checkbox. Preserving the admin URL requires the
  reviewed clean-profile operator procedure; a new admin origin is a separate
  explicit infrastructure choice. DNS/TLS/Workboard still need their own evidence.
- Production Working Hours is now main783b1e3 with module SHA
  `b763a0f7b74c0341684e196855e85b3f5e3b123915a373b27463c17916702e93`.
  The old a9a74ac preserve instruction in the fixed candidate docs is superseded.
  Final integrated release must rebaseline and preserve the deployed Hours module,
  generator/template and all excluded files, not copy an old full dist-server.
- Dependency/runtime/CLI artifacts and deployment manifest must match the final
  reviewed integration hash. Resolve R1-R4, then run focused inverse regressions,
  actual two-tab browser lifecycle, Plan/chat/Files/document-format compatibility,
  maintenance CLI and safe Nginx coverage on that hash. Full checks alone do not
  approve this protocol. No merge, arm, deploy or restart was performed here.

## Reproductions and validation

`server/secure-independent-review.test.ts` uses temporary fake keys/session state,
ephemeral loopback listeners, real transport crypto and fake native effects.
Tests deliberately **assert observed vulnerable behavior**; green means the
finding reproduced, not that the implementation is secure. Integrator acceptance
must invert the bad-state/effect assertions after applying fixes.

Run sequentially via codex-heavy with Node 22, one worker and heap 1024 MiB:

```sh
codex-heavy --label secure-independent-review -- bash -c '
  set -e
  export PATH=/usr/local/bin:$PATH NODE_OPTIONS=--max-old-space-size=1024 VITEST_MAX_WORKERS=1
  npm exec vitest -- run server/secure-independent-review.test.ts server/secure-api.test.ts
  npm exec oxlint -- server/secure-independent-review.test.ts
'
```

Final focused run: **29 passed (seven independent reproductions + 22 existing
secure API tests)**; focused oxlint: zero warnings/errors; diff whitespace check
clean. Node 22, one worker, heap 1024 MiB, codex-heavy unit
`codex-heavy-689c976dc64a48669153148f2d920171.service`, exit 0,
17:11 UTC+7 on 2026-09-21. Log: `/tmp/secure-review-final-fixtures.log`.
All three R3 invalidation variants reproduced. An initial R3 fixture omitted its
JSON content type and timed out before reaching the access check; this was fixed
in the fixture and all final cases reach the intended boundary.

Commit evidence is recorded in the checked Vault delivery reference. Existing
candidate tests passing is distinct from independently demonstrating its failure
cases. No model turns, real conversations, production
credentials/keys, pause/resume operations, production Nginx execution or runtime
mutation were used. No fresh full build/browser suite was claimed in this
test/report-only branch, and no mobile/Safari or real password-manager coverage
was added.

## Primary references

- [RFC 7516: JSON Web Encryption](https://www.rfc-editor.org/rfc/rfc7516)
- [RFC 5869: HKDF context separation](https://www.rfc-editor.org/rfc/rfc5869#section-3.2)
- [jose compactDecrypt API](https://github.com/panva/jose/blob/main/docs/jwe/compact/decrypt/functions/compactDecrypt.md)
- [Nginx command switches](https://nginx.org/en/docs/switches.html)
- [Nginx path resolution and creation source](https://github.com/nginx/nginx/blob/master/src/core/ngx_file.c)
- [Nginx cycle initialization source](https://github.com/nginx/nginx/blob/master/src/core/ngx_cycle.c)
