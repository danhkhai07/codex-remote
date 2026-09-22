# Independent Leader lifecycle/retention review at 82b4367

Decision: **changes requested — one residual P2 admission-lifecycle finding**.
L2 remains closed and L3 is closed within the stated retention/admission bounds.
The two original L1 delayed-read defects are fixed, but L1 cannot be closed end to
end: creation does not carry the lifetime guard into the controller/native boundary.
No new P1 is identified in this bounded review. This is source/feature review,
not activation approval or a reopening of app808/R6/W1 security reviews.

Reviewed product HEAD: `82b4367efb52f9340a2301c64273de7ab3de58a2`.
Scope: `fc40c05b607b99b04d63e812c443d1c309745031..82b4367`, product commits
e998252 (generations) and82b4367 (report admission/retention). Prior dispatch,
receipt and selector findings retain their earlier acceptance except the specific
residual below. The candidate implementation is unchanged in this review branch.

Task4209e210-672f-4bbd-ad06-b71ab3da6e1d; new worktree
`/root/WORKTREES/cr-leader-lifecycle-retention-review`, branch
`review/leader-lifecycle-retention-82b`. Author and earlier trees remain preserved.
Read-only native-turn receipt confirms **gpt-6-astra/max**, turn
`01a0c7fd-fd3e-7942-beac-26407d1821e8`, matching this task. This is inherited
actual settings, not a claim that model override is live.

## L1/P2 — creation effects escape the new lifetime guard

Locations in exact candidate:

- `server/orchestration.ts:37`: `OrchestrationDriver.create` accepts no guard;
  `:351-355` checks admission before calling it and lifetime only after it returns.
- `server/controller.ts:77`: the driver adapter calls `createThread` without its
  existing optional `live` callback.
- `server/controller.ts:288-297`: the native `thread/start` receives that absent
  callback, then the asynchronous reply is followed by cache/export and persisted
  folder assignment without a fresh lifetime check.
- `server/codex-app-server.ts:107-112`: the real request awaits startup/reconnect
  before its final pipe write. It already supports a `beforeDispatch` callback;
  this creation path supplies none.

Two independent inverse probes use the real `RemoteController`,
`ConversationOrchestrator` and `CodexAppServer.request`/stdio transport, an owned
minimal fake native process, and a temporary Vault. The child records native
effects and explicitly rejects model-turn starts.

1. **Effect begins after stop/restart.** Hold the request's actual `await start()`
   continuation before `thread/start` reaches the fake pipe. Verify zero effects.
   Stop and restart the same orchestrator; recovery sees the reserved task without
   a native identity and a verified fixture recovery is recorded. Release the old
   request. It sends **one new `thread/start`** and assigns the resulting conversation
   to the original group. Only then does the outer command reject409. The retained
   task still has `threadId:''`, so the newly created conversation is unassociated
   with that task. The orchestration state file stays byte-identical: the outer
   generation fix works, but rejection occurs after the escaped effect.
2. **Late accepted reply replaces a newer assignment.** Let native `thread/start`
   finish legitimately, then hold its reply before the controller processes it.
   Stop the orchestrator, assign the existing fake conversation to a different
   folder and restart. Releasing the old reply runs `assignThread(..., oldGroup)`
   before the outer lifetime rejection. The newer folder assignment is overwritten.
   There is no second native creation or rename, and orchestration recovery bytes
   are preserved. The defect is the subsequent stale local mutation.

Tests: `server/orchestration-lifecycle-retention.review.test.ts:77` and`:101`.
Both are deliberately named **INVERSE**: green means the defect was reproduced.
The normal control at`:64` uses the same delayed transport without changing the
lifetime and creates/names exactly one ordinary queued conversation.

Impact: a supposedly stopped admission can create an orphan visible conversation
or restore old folder ownership. No extra model turn, recovery deletion or actual
production overlap is claimed. These are the class stop/start interleavings in
the requested lifecycle contract; a killed process cannot run a late continuation.
The usual ALL-idle activation policy remains independent.

Minimal fix: carry the captured admission/lifetime guard through `driver.create`
and the controller adapter to `createThread`, so the existing request callback
checks it immediately before the native write after any startup await. Recheck
the same guard after the native reply before local cache/export/membership writes.
Do not merely add another check after `driver.create` has already returned.
Do not undo an already valid native creation, replay an uncertain request, or save
the stopped orchestrator's snapshot as compensation. Existing idempotency and
uncertain-result rules must remain intact.

Acceptance: invert both probes. The first must leave the native effect log empty
and create no membership; the second must retain the newer folder assignment and
the original one accepted native effect. Both preserve the new orchestration file
byte-for-byte and reject the stale command. The unchanged-lifetime control still
creates/names once. Test the guard reaching the actual pipe callback, not a mock
that only throws from the outer orchestrator.

## L1 — other inspected lifetime boundaries pass

The original stopped startup/reconcile probes now assert byte-identical persisted
recovery and no old timer/start/interrupt. They pass independently, including the
same-object restart variants and repeated-start idempotency. Restart reloads disk;
an already running start returns without adding a timer.

Source inspection confirms captured lifetime checks after catalog/read, rename,
archive, cancellation, scheduling inspection, worker-start and result-start awaits.
Archive callbacks and interruption guards retain the lifetime through their driver
boundaries. Old pump completion clears the promise only by exact identity; stale
finally blocks cannot delete the new lifetime's dispatch/management reservations.
Stopped completion/change callbacks and pumps are inert. The creation gap above
is specifically downstream of the otherwise-correct outer admission check.

Independent existing controls retain exact original-turn settlement, durable
pre-dispatch marker, ambiguous-result blocking, failed cancellation compensation,
manual control, eight-worker reservations, idempotent retries and original model
settings. Encrypted resolution controls still reject changed leader/epoch/Plan,
logout, expiry and key rotation after the awaited access check. No actual task or
user state was resolved or changed.

## L2 and L3 — closed within their documented limits

At `server/orchestration.ts:112-124`, all inactive reports lacking reliable delivery
are retained ahead of delivered history. Remaining delivered slots use the L2
maximum recovery/update timestamp and stable creation/zero fallback. The explicit
zero-slot branch avoids `slice(-0)`. Every unfinished/native-uncertain task remains
retained separately. Original result and recovery fields are not replaced.

At`:318-343`, existing request IDs return their committed task, including after a
catalog yield. Capacity is checked globally after that yield and synchronously
before budget spending/task reservation/create/rename/send. Its predicate counts
each task once: **outstanding inactive + unfinished <=200** for new admissions.
The persisted creating task reserves its result before asynchronous creation.
Already accepted work can finish at the boundary without requesting another slot.

The 199/205-delivered acceptance cases retain the old review error and fresh
failure across completion/save/restart while evicting delivered history first.
The 200/205-outstanding cases retain inherited excess, original evidence/recovery
and accepted work; repeated new spawn/delegate attempts return409 without effects
or dispatch-budget consumption, including another folder in the same shared state.
Concurrent last-slot commands admit one task; retry does not consume another slot.
A confirmed fake-native delivery frees exactly one future-result reservation;
resolution alone does not. Missing/lost delivery never silently acknowledges,
replays or increases a budget. These independent executions pass.

Finite bounds are explicit. Normal state retains at most200 inactive entries plus
at most200 accepted unfinished reservations globally; inherited excess is preserved
but cannot grow by new admission while full. Completing accepted legacy work only
converts its existing reservation. Recent **delivered** recovery/history can be
evicted when outstanding reports need its slot; L2 only orders the delivered slots
that remain. Unknown settlement/delivery can block indefinitely. No operator
override or new acknowledgement API was requested or added by this review.

## Execution, reused evidence and UI limits

All tests/artifact verification used codex-heavy sequentially, Node22.23.2,
heap1024MiB and `VITEST_MAX_WORKERS=1`. Independent result: **64 cases in five
files:62 acceptance/normal controls plus2 inverse reproductions**, not64 feature
acceptances. Detailed logs live under the private evidence directory below:

- `native-probes.log`:1 normal control +2 inverse cases, real fake-native pipe.
- `acceptance.log`:45 selected existing lifecycle/retention/capacity/manual/model
  controls;44 unrelated tests in that file intentionally skipped.
- `selector-encrypted-controls.log`:9 selector +7 encrypted resolution controls.
- `lint.log`: the new review test passes with zero warnings/errors.
- `artifacts.json`: independent source/emission/map/client boundary verification.
- `reused-evidence.json`: hash verification of all7 author evidence files and
  all31 browser screenshots; records what was reused rather than rerun.

Author126-tests/5files, server build/lint and four-viewport browser evidence are
reused where unaffected. No full527/whole-app build or new protocol audit was run.
The client is byte-identical to3f7e139. Source and browser harness review confirms
native details/summary controls, keyboard-operable history with aria-expanded and
aria-controls, wrapping results, independent scroll and visible composer/Files.
Independently viewed hash-matched `current-320x600.png`,
`leader-plan-320x600.png`, and `outstanding-overflow-evidence-390x600.png`.
The latter exposes original evidence of the oldest of205 outstanding reports.
The author's mocked-team browser fixture verifies207 current entries and viewport
containment; it is UI evidence, not proof of server pruning. Real orchestrator
tests above establish retention. No new browser execution, real Safari/device
test or comprehensive accessibility audit is claimed.

To reproduce the new bounded probes in this retained review checkout:

```sh
codex-heavy --label cr3-leader-lifetime-native-probes --timeout 180 -- \
  env VITEST_MAX_WORKERS=1 NODE_OPTIONS=--max-old-space-size=1024 \
  node node_modules/vitest/vitest.mjs run \
  server/orchestration-lifecycle-retention.review.test.ts \
  --maxWorkers=1 --reporter=verbose
```

The checkout has an owned dependency resolver/cache directory; dependency packages
are read from the unchanged private app-fix worktree. No test writes into a sealed
release or another checkout's cache. Fake native processes exit during cleanup.

## Artifact and runtime boundary

Copied only verified author build artifacts into this isolated review checkout,
then ran the reviewed read-only provenance verifier. No rebuild is claimed.
90 backend files and46 accepted security entries compared; JS/map emission agrees
with source. Incremental delta from3f7e139 is exactly:

| Artifact | SHA256 |
| --- | --- |
| orchestration.js | eca9771bb59e80ca0263cb4a3d4b5a1f33c49e364796e51fcc6ef8dc2a6c28eb |
| orchestration.js.map | 587bc839a66f476a2a1987f6c6beb22b75d22bc67fe7387c70a6986f3a32ac62 |

Combined app808/source00f9 boundary remains controller/http-app/orchestration
JS+maps plus the **whole matching client**.25 client files,9 reachable JS/CSS entries,
58 matching source-map sources and unchanged SW. HTML SHA256
`554846255773e35b4dd367413481e1ffc8839a3940dad68f2948c6447e7b9d20`;
entry `assets/index-BssRLWrJ.js`. No Leader payload is mixed into the separate
security package or any seal. All six backend hashes are in `artifacts.json`.

Hours JS stays`b763a0f7b74c0341684e196855e85b3f5e3b123915a373b27463c17916702e93`,
map`6a76da381331d7a802da5d844d341da742f0bfc3809f0cfe3b74370d55c42fb8`;
source/generator/template and dependencies remain unchanged. Read-only runtime
check confirms main783b1e3 and gatewayPID1758426 with the same Hours hashes.
No main merge/push, arm, deployment, restart, Services/config/state/key change,
real task resolution, production fixture, recursive agent or security-release edit.

Private decision/evidence directory:
`/root/.local/state/codex-remote/reviews/leader-lifecycle-retention-82b4367-cr3`.
`review-decision.json` binds this reviewed product hash, report/tests and evidence;
`delivery.json` records the final report commit, remote and clean-tree check after
push. Keep this checkout and earlier trees. Next action is the small author fix
and inversion of the two probes, then review its exact candidate; do not activate
82b4367 on the basis of this report.
