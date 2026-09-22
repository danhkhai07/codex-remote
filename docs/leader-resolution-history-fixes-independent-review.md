# Independent re-review of Leader fixes at 3f7e139

Decision: **changes requested**. L2 is closed. The original L1 dispatch barrier
and L3 delivery/selection defects are corrected, but two bounded P2 gaps remain
in their lifecycle and retention guarantees. No new P1 was found in this scope.
This report does not approve activation or reopen the accepted security app,
R6 runner, Workboard or infrastructure reviews. Product implementation is
unchanged in this review branch; passing inverse tests below reproduce defects.

Exact reviewed candidate: `3f7e139c25f42943d15bab6bb18f982646228193`, pushed branch
`fix/leader-resolution-history-review-findings`. Delta from prior independent
review `790c064da950a46bfb6a6a862d606421f11f0627` comprises author commits
95b9929, 898f712 and 3f7e139. New review worktree:
`/root/WORKTREES/cr-leader-resolution-history-fixes-review`, branch
`review/leader-resolution-history-fixes`. Author and prior review trees remain
clean and preserved.

Task `7b6b6525-acbd-41cb-9507-f0040fa05cbc` matches native turn
`01a0c734-f068-7632-8e94-1bb3c2abba7b`. Read-only inspection confirms
**gpt-6-astra / max** on that turn. This is actual inherited native-thread
settings, not a claim that the candidate's model override feature is live.
No capability, credential or real task content is included in the evidence.

## L1 — original barrier fixed; P2 remains for delayed reads after stop

Exact candidate locations: `server/orchestration.ts:495-506` (startup reads),
`:511-518` (stop/reconcile), and `:435-440` (settlement writes).
The new stopped-instance checks at :550 and :587 protect late **start replies**,
but not late **read replies** or startup finalization.

Two independent inverse probes show the same remaining issue:

1. Start one fake native task, take manual control and begin `reconcile()` with
   its native read held. Stop the old orchestrator. A new instance sees the exact
   original turn terminal, settles it and records verified recovery.
2. Release the old read with the exact terminal turn. The old task object still
   has `dispatchPending`; `#settle` writes its stale whole-state snapshot.
   The new instance's in-memory recovery survives, but a fresh reader of disk
   sees **no resolution record**. No turn is replayed or unrelated work stopped.
3. The startup variant holds `start()`'s recovery read, calls `stop()`, starts
   the next instance and records recovery, then releases the old startup read.
   It likewise overwrites the new record and continues startup finalization.

Reproductions: `server/orchestration.test.ts`, tests beginning
`CR2 re-review inverse: a stopped reconciler...` and
`CR2 re-review inverse: a stopped startup read...` (lines1040 and1066 in this
review). They use temporary Vaults and the real orchestrator with delayed fake
native reads. This is a class-lifecycle interleaving, not a claim that two live
systemd gateway processes were observed overlapping. A process already killed
cannot produce a late callback; ALL-idle deployment remains a separate safeguard.
The stated guarantee that stopped instances cannot rewrite recovered state is
nevertheless incomplete.

Minimal fix: make stopped/superseded lifecycle ownership guard every asynchronous
reconciliation/startup continuation before mutating tasks, saving, finalizing
startup or installing a timer. Guard related late cancellation/completion writes
consistently. A lifecycle generation avoids reusing a stopped boolean if the same
instance can be started again. Do not solve this by restoring state, replaying a
turn or changing original error evidence.

Acceptance: invert both probes so the persisted file remains byte-identical to
the new instance's recovery; no old callback writes, interrupts, creates a timer
or resumes scheduling. Keep normal startup, same-process cancellation, exact-turn
terminal reconciliation, idempotent resolution and eight-worker controls passing.

What is closed: `dispatchPending` is persisted before native start (:547-549),
including a new independent assertion **inside the driver before its effect**.
Known pre-dispatch rejection releases it safely; uncertain transport retains it.
Startup and periodic reconciliation require the exact turn ID or a unique strict
original user Task-ID header. A known turn ID cannot fall back to a different
matching header (independent control). Cancelled uncertainty blocks resolve409,
reserves capacity and preserves manual control. Existing tests cover lost replies,
ambiguous/quoted markers, unknown native status, failed compensation, late start
reply and terminal notification without replacing the original result/recovery.

Legacy limitation is explicit: unsuccessful records missing settlement metadata
are conservative, even when cancellation may actually have happened before send.
Missing/truncated exact history can leave resolution, archive and capacity blocked
indefinitely. That is not false settlement; there is no operator override in this
candidate, and this review invents none.

## L2 — closed within the specified inactive-history bound

Locations: `server/orchestration.ts:49-53`, `:101-108`, `:392-394`.
Inactive selection now uses the maximum recorded recovery/update time, with
creation time then zero as stable legacy fallback. Stable sorting resolves equal
timestamps deterministically. It retains all active and native-uncertain work
outside the 200-inactive bound.

The converted inverse passes: a new recovery on the oldest of 200 records survives
a subsequent completion, save and reconstruction; genuinely older inactive work
is evicted. Fresh failures, all unfinished statuses, native uncertainty, invalid
legacy dates and repeated saves are covered. Saves do not invent activity times
or restore old state. The bound itself is retained. The separate L3 issue below
concerns **which unsuccessful delivery states qualify for that bound**, not
regression of recovery-time ordering.

## L3 — delivery/selector fixed; P2 remains at retention boundary

Exact candidate locations: `server/orchestration.ts:44-47`, `:101-107`,
`:136-145`; `src/teamTaskSelection.ts:16-29` only sees the records that survived
that server filter.

The server considers a terminal task with `dispatchPending:false` inactive even
when `resultDelivery:'review'`. It can therefore delete an unreported error from
the task snapshot while retaining many already delivered history entries. Its review notice survives, leaving a count whose
suggestion to inspect that task cannot be followed in the task UI.

Concrete valid-boundary reproduction:

- Start with exactly 200 inactive records: one January failed task with a lost
  leader receipt (`review`), plus 199 February known-delivered failures; no recovery
  is recorded. One additional task is still running.
- Complete that running task with a fresh failure. The200-record save keeps
  199 delivered outcomes plus the new failure and removes the January unreported
  task. The unconfirmed-result count is still1. The task is absent from both
  current/history and remains absent after reconstruction.
- A separate 205-delivered stress case reproduces the same result. The 199 case
  does not depend on an already oversized/corrupt state file.

Independent inverse: `CR2 re-review inverse: %i delivered outcomes can evict an
older report still needing review` in `server/orchestration.test.ts:1094`, run
with 199 and 205. It does not claim that the underlying conversation transcript or
notice text was erased; the **per-task current/history API entry** was dropped.

This violates the promised visibility of unreported/uncertain errors. It is not
necessary to retain unlimited old delivered history to fix it. At minimum reserve
retention priority for outstanding/unconfirmed task reports before evicting known
delivered history, preserving original result and recovery. Explicitly handle the
case where outstanding reports alone exceed capacity (bounded admission or a
visible, accessible overflow policy); do not silently mark delivery, fabricate
recovery or introduce unbounded retention by accident.

Acceptance: both inverse cases retain the unreported task and fresh failure,
evict a known-delivered old result first, and survive save/restart. The selector
must keep the unresolved delivery current. All busy/native-uncertain reservations
and fresh recovery retention must remain intact; overflow behavior must have a
bounded test and must not reduce an unreported failure to an inaccessible count.

What is closed: new task notices carry taskId and require exact folder/worker
association. A nonempty native leader turn receipt, not a sent flag alone, changes
delivery to delivered. Pending/sending/review/unknown/missing, ambiguous or wrong
legacy links never become delivered from inference. Restart converts sending to
review; late old-instance send replies/errors do not rewrite it. Known rejection
retries restore wakeup budget; uncertain delivery never auto-replays. Delivery
state is copied before sent-notice pruning, and pending overflow stays unknown.
Receipt means native model turn accepted the report, **not human acknowledgement
or verified recovery**.

For records actually returned by the API, current/history behavior passes. The
independent browser extension supplies 205 old delivered errors, five uncertain
states including an absent receipt, one fresh error, one running task and one
uncertain native cancellation: 8 current, 205 history, 213 expanded. Old error/result
stay intact. Three other recent outcomes/24h remain documented implementation
choices, not a new user preference. The browser routes deliberately mock the team
snapshot and therefore do not disprove the real server retention finding.

## Checks, evidence and limits

All heavy work used codex-heavy, Node22, heap1024MiB, sequential jobs and one
Vitest worker. No full app build or527-test rerun; author full-check evidence is
reused, hash-verified and distinguished from independent execution.

- `/tmp/cr2-leader-fixes-acceptance-final.log`: 38 passing targeted cases across
  orchestrator, selector and encrypted resolve. **34 controls/acceptance cases;
  four inverse cases demonstrate the remaining defects**. Of these, two controls
  and four inverses were newly authored. Seven encrypted HTTP cases retain
  current leader/folder/epoch/Code/CSRF and request-lifetime revocation across
  awaited access. No actual model turn or real task resolution.
- `/tmp/cr2-leader-fixes-browser-final.log`: 1280×900,320×600,390×844,390×600 pass.
  Fake native child and mocked team routes cover History counts/keyboard, draft,
  scroll, Files, separate Leader page, cancel failure/retry, short Plan and reload.
  Screenshots `/tmp/cr2-leader-fixes-browser/`; independently viewed desktop,
  mobile205-history and original error, plus Plan320×600/390×600. Browser/native
  children closed. No Safari/device test or broad encrypted-protocol audit.
- `/tmp/cr2-leader-fixes-lint-final.log`: 0 errors/warnings.
- `/tmp/cr2-leader-fixes-artifacts-final.json`: exact source/artifact boundary,
  narrow JS **and source-map** emission for the three combined backend modules,
  complete client hashes and reachable current source-map graph. Copies exist
  only in this review worktree; no fixture transformations or publication.
- Reused `/tmp/cr-leader-review-fixes-full.log`:527 Vitest/78files +11 Node,
  lint/typecheck/client/server/PWA and author browser controls. SHA256
  `648cae3f3ccac69b8808461b757864cc5b0b079aec3ad8b08b954993dba834a3`.
  This also covers retained controller/native dispatch/model pin/no-fallback
  controls; they were reviewed in source, not claimed as a second full audit.

An initial browser harness edit accidentally changed an unrelated expected count
from7 to8; it failed there, was corrected, then all four viewports passed. That
was a review-fixture correction, not a candidate defect. Earlier probe logs are
retained; the final logs above are authoritative for this report.

## Artifact and production boundary

90 backend artifacts compared against100381e/d072;46 against accepted security.
Incremental100381e ->3f7e139 changes **orchestration.js/map only**; combined security
boundary remains **controller/http-app/orchestration JS+maps** and the **whole
matching client**, not a partial bundle. JS/source-map emission matches source.
25 client files, nine reachable JS/CSS entries and58 matching application map
sources. Entry `assets/index-BssRLWrJ.js`; HTML SHA256
`554846255773e35b4dd367413481e1ffc8839a3940dad68f2948c6447e7b9d20`.
Orchestration JS `a489b6867c94fed79379e64abecc1c478615020cf7599dc338c0198f3c0475a5`,
map `1b086af71e79e579c8a77399435531bceb9320703eefc72bdaaaa9770dc58604`.

Hours JS `b763a0f7b74c0341684e196855e85b3f5e3b123915a373b27463c17916702e93`,
map `6a76da381331d7a802da5d844d341da742f0bfc3809f0cfe3b74370d55c42fb8`, source,
generator/template and dependencies unchanged. Main remains783b1e3, gateway
PID1758426 active, with the same Hours hashes on read-only checks. Production
state/config/Services/key, main/runtime, runner/seals and other worktrees were not
modified. Checked Vault review/handoff notes are the only requested external
writes. The real targetc83 remains untouched.

Next: fix the two focused gaps, independently recheck, then prepare any combined
release under a **new** app manifest/baseline/seal. This review supplies no rollout,
profile, Full(strict), key or DNS/TLS readiness receipt and does not approve
folding this new app hash into the accepted808 payload or its old seal.

Focused reproduction commands (inside a codex-heavy job, matching dependencies):

```sh
NODE_OPTIONS=--max-old-space-size=1024 VITEST_MAX_WORKERS=1 \
  ./node_modules/.bin/vitest run --maxWorkers=1 -t 'CR2 re-review' server/orchestration.test.ts
node scripts/leader-fixes-independent-artifacts.mjs
PLAYWRIGHT_MODULE=/tmp/working-hours-browser/node_modules/playwright/index.mjs \
  TEAM_SCREENSHOTS=/tmp/cr2-leader-fixes-browser node scripts/team-panel-browser.mjs
```
