# Leader review findings — implementation candidate

Task b4d2cc8f-ca2d-42f4-bc50-a1d36d828485. New worktree
`/root/WORKTREES/cr-leader-resolution-history-fixes`, branch
`fix/leader-resolution-history-review-findings`, exact remote-verified base
`790c064da950a46bfb6a6a862d606421f11f0627` (candidate100381e plus independent
report/fixtures). Both earlier author and reviewer checkouts are preserved.
These fixes are implementation evidence, not independent approval or deployment.
The original findings remain in `leader-resolution-history-independent-review.md`.

## L1: durable native settlement

`dispatchPending` is saved before native start, independently of the task outcome.
New unsent tasks explicitly have no outstanding effect. Cancelled tasks whose
start/interrupt is still uncertain remain blocked from resolution across restart
and retain a worker reservation. Startup and periodic reconciliation use the
exact turn ID, or a unique original user-message header/Task-ID if the reply was
lost. A quote, different user turn, missing/truncated history or unknown native
status cannot prove settlement. No start is replayed; recovery never interrupts
another user-owned turn. Known terminal status or an acknowledged exact interrupt
settles the effect while preserving the original cancellation/result.

Same-process compensation still uses the original turn and a final guard. Failure
keeps the original cancellation and its uncertainty instead of claiming it stopped.
Late replies from a stopped instance cannot overwrite the recovered record. Native
terminal notifications and resolution retries preserve already-recorded recovery.
Manual pause, eight worker slots and same-thread exclusion remain enforced.

Legacy unsuccessful records with no settlement marker are conservatively inspected;
if exact settlement cannot be established they remain uncertain, not auto-resolved.
They may continue to reserve capacity until the original effect can be verified.
There is no override, blind replay or inference from unrelated user work.

Focused check: orchestration, controller integration and independent encrypted
access races pass (89 tests), lint and server build. This intermediate run still
contains the separate L2 inverse probe; it is not evidence that L2 is fixed.
Log `/tmp/cr-leader-l1-verified.log`. All checks use codex-heavy, one Vitest worker,
temporary vault/native fixtures and no real model turn or task resolution.
