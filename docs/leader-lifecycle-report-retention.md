# Leader lifecycle and outstanding report retention

Implementation task699b2436-efa4-4746-9d65-26456738c898, not independent approval
or activation. New worktree `/root/WORKTREES/cr-leader-lifecycle-report-retention`,
branch `fix/leader-lifecycle-report-retention`, exact pushed review base
`fc40c05b607b99b04d63e812c443d1c309745031`. Previous author/reviewer trees are
preserved. Original report: `leader-resolution-history-fixes-independent-review.md`.
L2 and the original dispatch-marker/receipt/selector fixes remain accepted within
their earlier review scope; this task addresses only the two residual findings.

Actual read-only receipt: task699b2436 maps to current native turn
`01a0c7de-7f14-7fb1-abe0-b9403107ceb9`, **gpt-6-astra/max**, current turn matches.
Evidence `/tmp/cr-leader-lifecycle-settings.json` contains only these settings
and identifiers, no credentials or real task content.

## L1: lifetime ownership of asynchronous continuations

Each running lifetime has its own identity. Stop invalidates it permanently;
restarting the same object creates a new identity and reads current persisted
state. It does not restore a stale snapshot. Every awaited startup/reconcile read
checks that identity before any settlement/write, and startup checks again before
finalization/timer installation. A repeated start while running is idempotent.

Scheduler inspection, catalog/start/interrupt replies and result deliveries carry
the same ownership guard. An old pump's finally cannot clear a new pump's lock
or dispatch reservations. Late cancellation success/failure cannot replace new
state; its guard also reaches the existing native interrupt boundary. Admission
and archive continuations use the same rule. A stopped instance ignores completion
and change callbacks and cannot restart scheduling. Normal exact-turn settlement,
manual control, supported model settings, encrypted guards and eight-worker
capacity are retained.

Both independent delayed-read inverses now assert acceptance: after the new
instance records recovery, releasing the old startup/reconcile reply leaves the
persisted file byte-identical. No old timer, start or interrupt occurs. Additional
fixtures cover same-object stop/start, late scheduler inspection, create reply,
accepted/rejected cancellation and late worker/result replies across both kinds
of restart. No production process overlap is asserted from these class fixtures.

Focused orchestration/controller/encrypted resolution suites:110 passing tests,
lint and server build. `/tmp/cr-leader-lifecycle-focused.log`. This intermediate
run still contains the two separate retention inverse cases, not L3 acceptance.
Further late-callback controls: `/tmp/cr-leader-lifecycle-final-controls.log`.
All heavy work uses codex-heavy sequentially with one Vitest worker and fake
native/temporary Vault data. No actual model turn or real resolution is performed.
