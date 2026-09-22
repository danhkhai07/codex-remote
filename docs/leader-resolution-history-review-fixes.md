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

## L2: retain recent terminal and recovery activity

The inactive audit trail stays capped at 200 records, chosen by the newest actual
terminal/recovery timestamp rather than position in the array. Invalid/missing
legacy activity dates fall back to creation time, then a stable zero timestamp;
equal timestamps preserve existing order. No save invents activity using its own
clock. Every queued/active task and unsettled native effect stays retained.

The independent inverse is now acceptance: recovery on the oldest of 200 records
survives the next completion and restart, while the genuinely oldest inactive
record is removed. A fresh failure likewise survives a later completion, repeated
saves and reconstruction. Legacy fallback, the bound and every unfinished status
are covered. Focused suites: 90 tests, lint and server build pass, with a final
targeted L2 run after extending the subsequent-completion assertion.
Logs `/tmp/cr-leader-l2-retention.log`, `/tmp/cr-leader-l2-final.log`.

## L3: delivery-aware current work and history

Each task exposes only a safe result-delivery state: pending, sending, delivered,
review or unknown. New result notices link to their exact task; a nonempty native
leader-turn receipt establishes delivery. It does not establish successful
recovery or human acknowledgement. Missing/lost replies stay under review without
automatic replay. A known pre-dispatch rejection remains pending and restores its
wakeup budget. Restart changes in-flight sends to review, and late replies/errors
from the stopped instance cannot overwrite that state.

Legacy migration requires one exact task/folder/worker notice (an explicit task
link or the original strict result header). A sent marker without a turn receipt,
an unrelated/ambiguous notice or missing evidence remains unknown. Receipts are
saved on the task before the existing 100-sent-notice log is pruned. Retiring a
notice at the existing 40-pending cap does not falsely claim delivery. No notice
or wakeup budget was raised and no result is silently acknowledged.

All busy/queued work and uncertain native dispatches remain current. Every new
failure/interruption within 24 hours, plus every unreported/uncertain error at any
age, remains current beyond the three-result threshold. Old reliably delivered
errors go into explicit history without changing status, result or recovery.
Up to three other recent outcomes/recoveries stay current. The finite thresholds
are implementation choices. Unknown error age remains visible conservatively.
Unsettled terminal cards say “Chờ xác nhận lượt”; pending counts include them.

The independent inverse fixtures now assert acceptance: 200 old delivered errors
go behind history, with the exact count; fresh errors, all delivery uncertainty
states and unsettled native work remain current. History retains the original
error and evidence. Keyboard, draft/scroll, Files, stop and Plan behavior remain
covered by the existing desktop/mobile fixture. Focused L3 checks passed 85 tests
plus lint/typecheck/server build; final check also covers the subsequent safe-retry
regression. Log `/tmp/cr-leader-l3-delivery.log`.

## Final verification

One final `npm run check` after source stabilization passed: **527 Vitest tests
in 78 files, 11 Node readiness tests, lint, TypeScript, client/server builds and
PWA validation**. The existing non-fatal large-chunk advisory remains. The 21
controller/orchestration integration tests and all seven encrypted resolve tests
(including independent role/epoch/Plan races) passed. No transport/controller/
HTTP implementation, dependency, runner or security-final preparation changed.

The matching built-client browser fixture passed **1280×900, 320×600, 390×844,
390×600**, including the L3 acceptance case, keyboard toggle/count, original
error/recovery evidence, draft/scroll, separate Leader page, Files right, [x]
failure/retry, compact Plan and logo Reload. Desktop, narrow mobile, old-error
history and short-screen Plan screenshots were visually inspected. Owned fixture
processes were closed; the bounded job ended with no running main process.

```sh
codex-heavy --label leader-review-fixes-full -- bash -c 'VITEST_MAX_WORKERS=1 npm run check && PLAYWRIGHT_MODULE=/tmp/working-hours-browser/node_modules/playwright/index.mjs TEAM_SCREENSHOTS=/tmp/cr-leader-review-fixes-browser node scripts/team-panel-browser.mjs'
codex-heavy --label leader-review-fixes-artifacts -- bash -c 'node scripts/leader-review-fixes-artifacts.mjs > /tmp/cr-leader-review-fixes-artifacts.json'
```

Log: `/tmp/cr-leader-review-fixes-full.log`. Screenshots:
`/tmp/cr-leader-review-fixes-browser/`, especially `current-1280x900.png`,
`current-320x600.png`, `old-delivered-errors-current-390x600.png`,
`old-delivered-errors-history-390x600.png`, `leader-plan-390x600.png`.
The fixtures use fake native data and temporary listeners, with no real model
turn, target resolution, hosted service or unsafe root Nginx fixture.

## Exact artifact boundary

Read-only provenance checks compare all 90 backend outputs against candidate
100381e and d07206a, and the accepted security inventory's 46 sealed outputs.
The three combined changed modules match narrow emission from their exact source.
The complete matching client has 25 files, a nine-file reachable JS/CSS graph and
58 matching application source-map sources. The manifest includes every client
and backend SHA256 and all old-to-new deltas; it is evidence, not a release seal.

- Incremental from reviewed candidate100381e/review790c064: **orchestration.js
  and orchestration.js.map only**.
- Since capacity/model d07206a: also **http-app.js and http-app.js.map**.
- Combined against accepted security00f9/app808: also **controller.js and
  controller.js.map**. HTTP/controller are unchanged by these three fixes.

| Combined backend artifact | New SHA256 |
| --- | --- |
| controller.js | 15d3fc0d0251a8ff9cbbc4e01fcb32601d128b7b182ec0a0af3979deffaea9b7 |
| controller.js.map | 1e9436a6ace5d4a6856b58914ed07423d610c737b415d0fde5f939aa698166f3 |
| http-app.js | 1a3e4d21e0f5154a746ded3d3a9440493d60618ded2ce1b742cfa60db99342f0 |
| http-app.js.map | e55e6b39060d87f8bd7445e3c9d6dbd102f52d9100a22b2fe684668a35e4e19f |
| orchestration.js | a489b6867c94fed79379e64abecc1c478615020cf7599dc338c0198f3c0475a5 |
| orchestration.js.map | 1b086af71e79e579c8a77399435531bceb9320703eefc72bdaaaa9770dc58604 |

For the incremental pair, old100381e hashes are respectively
`a83a303843487c0c9ac3ea709a364e050fa7cc00af5573daf5d4c7e2fecc9774`
and `d3bc165b699492e112e1797ff1b1a2a132ea9ba22900e5d15c33f4c84041ec53`.
Publish the entire matching `dist/`, with entry `assets/index-BssRLWrJ.js`,
`assets/rolldown-runtime-aKtaBQYM.js`, `assets/index-3gFugtZF.css` and all matching
lazy/assets/PWA files. Index HTML SHA256 is
`554846255773e35b4dd367413481e1ffc8839a3940dad68f2948c6447e7b9d20`.

Hours JS stays **b763a0f7b74c0341684e196855e85b3f5e3b123915a373b27463c17916702e93**,
map **6a76da381331d7a802da5d844d341da742f0bfc3809f0cfe3b74370d55c42fb8**.
Source, generator and template hashes also match the preserved candidate. The
secure transport and dependencies are unchanged. No production state/config/key,
Services entry, main branch, runtime, existing release or seal was modified.

## Review and later activation

Keep this worktree for leader review. All three inverse findings now have passing
acceptance evidence, but independent approval remains the leader/reviewer's step.
These feature fixes do not delay or replace accepted security/R6/Workboard work.
Do not insert them into an old seal or apply the small delta to production783b1e3.
After review, prepare a NEW release against the then-current accepted baseline,
with the combined backend allowlist and full matching client above. Activation
requires the authorized ALL-idle `scripts/restart-when-idle.mjs` path; this task
does not arm it, merge, deploy or restart anything.

Privately back up the current modules/client and Orchestration.json before any
future rollout. Keep current task state and all later results/recovery during
rollback; never restore an old state snapshot. Optional version1 fields require
no destructive migration. Rolling back to100381e would reopen these findings;
choose a separately reviewed rollback baseline instead. Unknown legacy settlement
or delivery remains conservative until exact evidence is available.

The real target c83e1387-d98b-4f20-a669-5a0fcecd108a remains unresolved here.
Only after the feature is live and Rename/Archive evidence is rechecked may the
leader resolve it through the authorized API. No implementation/check blocker
remains; review and activation are separate outstanding steps.
