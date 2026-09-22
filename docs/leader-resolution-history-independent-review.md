# Independent review of Leader resolution/history — 100381e

Decision: **changes requested before this feature candidate is approved for
rollout**. Three bounded P2 findings are detailed below. No new P1 was found in
this review. The author of this report has not changed product implementation;
green inverse probes demonstrate defects, not acceptance. Accepted security
app80843c0/source00f9e197 and the separately accepted R6 runner are not reopened.

Exact candidate: `100381eaabe7c54a55cc051a03f9a5499f6fe297`, pushed branch
`integration/leader-resolution-history-security`. Feature delta reviewed:
`d07206aeaefc591f7d4ae35a4b858883c154e53d..100381e`. New independent worktree:
`/root/WORKTREES/cr-leader-resolution-history-review`, branch
`review/leader-resolution-history-security`; CR4's checkout remains unchanged.

Taskb01200b4-a7a4-43c8-a455-3622b64277af maps to native turn
`01a0c6fb-c3f5-72b0-896f-467ed26a4563`. Read-only task/native-thread inspection
confirmed the current turn matches and runs `gpt-6-astra/max`. The live old task
snapshot does not expose per-task model fields; this model evidence is the
matching native thread, not a fabricated field in that response. No capability,
session token, key or real task content is saved with the settings evidence.

## L1 — P2: restart loses the native-dispatch settlement barrier

Locations in exact100381e: `server/orchestration.ts:61`, `:344`, `:445`, `:497`.

`#dispatchingTasks` correctly prevents resolve while an in-flight start and its
compensating interrupt settle in the same process. But it is only an in-memory
Set. Cancellation before turn/start's reply sets a durable `cancelled` outcome
without a turnId. After restart, startup reconciliation only inspects creating,
starting, running and stopping; it skips that cancelled record. The Set is now
empty, so `resolveTask()` accepts recovery even if the accepted native turn is
still active and its cancellation has never been confirmed.

Independent inverse reproduction uses the real orchestrator, a temporary Vault
and fake native driver. The driver accepts a turn (including its Task-ID) and
holds the reply. Cancel persists `cancelled` with no turnId; resolve initially
rejects409. Stop/reconstruct/start the orchestrator from that checkpoint while
the native fixture reports inProgress. Resolve now succeeds; no interrupt was
confirmed or even issued by the recovered instance, and the native fixture stays
inProgress. This is a restart boundary test, not a real user/model turn or a
claim that any particular production cancellation had this outcome.

Impact: the new “Đã xử lý” guard can report recovery of an attempt whose native
effect is still uncertain. Existing ambiguous-cancellation behavior predates the
feature; the new resolver relies on it without a durable settlement check.
Supplied summary/evidence is a leader assertion, not backend proof of recovery.

Minimal correction: persist the pending/uncertain native-dispatch settlement
state before sending, independently of the user-facing cancellation outcome.
Reconcile such records at startup even if status is cancelled; retain the block
until the exact original turn is known terminal or its interrupt is confirmed.
Unknown outcomes should require inspection, never blind replay or interruption
of a different user-owned turn. Keep current same-process compensation guards.

Acceptance: the inverse must instead reject409 before and after restart while
uncertain; once exact native settlement is confirmed, resolution succeeds once,
same-record retry is idempotent and late completion preserves the recovery.
Normal completed/cancelled tasks, manual control and eight-worker slots must
remain correct. No broad protocol change or model invocation is needed.

## L2 — P2: retention can immediately delete a newly recorded recovery

Locations: `server/orchestration.ts:83`, `:351-353`.

The retained terminal array is clipped with `slice(-200)`, by insertion order.
Resolving an old task updates its resolution/resolvedAt/updatedAt but leaves its
position unchanged. With 200 retained terminal tasks and one running task, resolve
the oldest failed task. The response correctly contains the recovery. Complete
the running task: the very next save discards that just-resolved record and keeps
199 stale completions. The recovered record is gone from snapshot and restart
persistence, so the UI cannot show it as a recent recovery or in history.

The independent inverse starts from the normal stored layout (terminal rows,
then unfinished work), not a corrupted or artificially unsorted legacy array.
It confirms the running task was visible before completion and the completed
result is kept, but the new recovery disappears. The 200-record limit is an
accepted existing bound; this finding does not ask for unlimited retention.

Minimal correction: choose retained inactive records by actual most-recent
terminal/recovery activity with a stable fallback for older timestamp formats,
then append every unfinished record. Preserve the bound and original status/
result. Acceptance: a new recovery and new failures survive subsequent saves
and restart at the boundary; genuinely oldest inactive records are evicted;
busy tasks and same-folder access are never clipped by a positional limit.

## L3 — P2: all old unresolved errors bypass focused history indefinitely

Locations: `src/teamTaskSelection.ts:8`, `:17-25`,
`src/ConversationTeam.tsx:68-71`.

The user asked for active/waiting work, recent outcomes and new errors by default,
with old noise available through history. They also explicitly prohibited hiding
new/unreported failures and required truthful reporting/recovery. Three outcomes
and24hours are an assistant implementation choice, not user-specified numbers.

The candidate makes every failed/interrupted task without resolution “current”
forever, irrespective of age or whether its report already reached the leader.
There is no per-task delivery distinction available to the selector. With200
month-old already-reported errors, one active task and one fresh failure, all202
rows stay in the default list and history is empty: the user has no history
button with which to move that old noise out of the current view. This is an
intentional implementation policy, but materially misses the focused-history
request; it is not an authorization/security bypass.

The independent pure inverse and mobile browser fixture exercise this exact
case. “Already reported” is fixture scenario context: the snapshot cannot convey
it to the selector, which is precisely the missing distinction. This report does
not equate report delivery with successful recovery or human acknowledgement.

Minimal correction: distinguish recent/unreported-or-uncertain errors from old
known-delivered outcomes, and put only the latter behind explicit history while
keeping their original failed/interrupted status. Expose reliable per-task report
delivery/uncertainty where needed; an aggregate count or an old timestamp alone
is insufficient. Never hide a pending/review/unknown delivery merely to hit the
three-result threshold, or label an old error resolved just to dismiss it.
Retain access/count, and preserve task result delivery to the leader.

Acceptance: all active/waiting and new/unreported failures are directly visible;
old reported errors can be accessed through history without false resolution;
history counts remain exact. Existing draft/scroll, Plan, Files and Leader-page
behavior must remain intact. Leader should retain the user requirements and
treat precise thresholds as implementation choices when selecting the fix.

## What passed within the reviewed scope

- HTTP adds only the resolve action at `server/http-app.ts:536`, inside the
  existing encrypted private dispatch, session/CSRF and awaited access checks.
  `live()` executes after access and body await; resolver mutation is synchronous.
  Code mode/current leader/epoch/same-folder checks are made at mutation time.
- Existing encrypted tests reject cookie-only requests, invalid CSRF, worker
  callers, cross-folder access, Plan, stale epoch and revoked/expired/rotated
  credentials during access. Three additional independent races change leader,
  round-trip epoch or switch to Plan while access is waiting: each rejects;
  a fresh authorized retry then succeeds/idempotently repeats with no model RPC.
- Original status/result remain intact, summary/evidence are separate bounded
  nonempty strings, duplicate same record is stable and conflicting record409.
  Ordinary restart persistence and late completion work outside L1/L2. Resolve
  does not send a model turn, acknowledge notices or release manual control.
- Retained snapshot no longer slices at100 and excludes other folders. Existing
  tests cover busy work/errors in that tail, selector ordering/timestamps, recent
  recovery and all busy statuses. New errors are not capped by the recent3 limit.
- Retained d072 controls pass for eight worker slots, supported Astra/Sol model/
  effort selection, pinned retries, current roles, manual/Plan permissions,
  startup admission and native guards. This is not a second full security audit.

## Evidence and limits

Checks use Node22, `codex-heavy`, heap1024MiB and one Vitest worker. No full app
build/check was rerun. CR4's505Vitest+11Node/fullcheck/PWA evidence is reused where
unchanged and hashed in the artifact result; it is not presented as this review's
independent execution.

- `/tmp/leader-resolution-independent-tests.log`:85 existing affected tests
  passed, plus two inverse probes; an initial missing-vs-undefined assertion in
  the third probe needed correction. The product source was not changed.
- `/tmp/leader-resolution-review-probes.log`: all3 final inverse probes reproduce
  L1/L2/L3;54 unrelated tests intentionally excluded by name filter.
- `/tmp/leader-resolution-access-races.log`:3 additional independent encrypted
  authorization races pass;4 existing cases intentionally not repeated.
- `/tmp/leader-resolution-independent-browser.log` and screenshot directory
  `/tmp/leader-resolution-independent-browser/`: exact compiled candidate client
  and backend, owned HTTP/native fixture, PASS1280×900/320×600/390×844/390×600
  desktop/mobile controls and L3 inverse. Visually inspected current desktop,
  mobile old-error case and mobile pending Plan screenshots.
- `/tmp/leader-resolution-artifacts-review.json`:90 compiled backend comparisons,
  exact incremental/combined allowlists, narrow source-to-JS emission check for
  the3 changed modules, reachable client/lazy/static-worker source-map graph and
  unchanged dependencies/Hours. No full recompilation is needed for those checks.

Fixture setup initially referenced CR4's removed node_modules symlink, then used
the accepted sealed dependencies. Artifact traversal was corrected to recognize
root-level migration-check-sw.js rather than classify it as a missing lazy asset;
the earlier guessed aggregate source-count threshold was replaced by checking
the actual reachable maps and required changed source filenames. Current graph
has9 entries and58 matching application map sources;10 retained unreferenced
assets are not claimed as current entry code. Complete copied client hashes
are recorded separately, retaining old hashed assets without mistaking them for
the current bundle's source provenance.
Those are review-harness corrections, not candidate defects. No Nginx fixture,
production key/session mutation, target resolution, real history edit, service
restart, model turn or release/seal change occurred. Only checked Vault notes
are updated as the requested review handoff.

## Integration boundary

Compared with d072, only `http-app.js`/map and `orchestration.js`/map change.
Combined against accepted security, `controller.js`/map from d072 also differs;
its source change is the model catalog driver adapter. Full matching client
publication is required. Hours JS b763a0f7...16702e93, map6a76da38...c42fb8 and
Hours source/generator/template remain outside the delta.

Do not fold these artifacts into the accepted80843c0 release under its old app
hash or apply the incremental four files onto old production783b1e3. After the
bounded findings are fixed/reviewed, prepare a new combined candidate and exact
client/backend manifest, then a new final release baseline/seal. This review does
not create profile/Full(strict)/TLS/rollout receipts or block unrelated security
preparation. The real takeover task remains unresolved until the feature is
actually live and the leader rechecks evidence and uses the authorized API.

Focused reproduction (inside a `codex-heavy` job, Node22, heap1024MiB):

```sh
./node_modules/.bin/vitest run --maxWorkers=1 -t 'CR2 inverse' \
  server/orchestration.test.ts src/teamTaskSelection.review.test.ts
./node_modules/.bin/vitest run --maxWorkers=1 -t 'CR2: rejects' \
  server/orchestration-resolution-security.test.ts
node scripts/leader-resolution-artifacts-review.mjs
PLAYWRIGHT_MODULE=/tmp/working-hours-browser/node_modules/playwright/index.mjs \
TEAM_SCREENSHOTS=/tmp/leader-resolution-independent-browser \
node scripts/team-panel-browser.mjs
```

Artifact helper uses read-only exact CR4 outputs and copies/verifies them only
under this review worktree; it does not rebuild or publish. Install/link matching
accepted dependencies locally for test execution. Review fixtures/report may be
cherry-picked for correction work; the product implementation is untouched here.
