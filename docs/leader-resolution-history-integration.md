# Task resolution and focused Leader history

Historical candidate100381e record. The independent review found three P2 issues;
see [the follow-up implementation and evidence](leader-resolution-history-review-fixes.md).
Its delivery-aware history policy supersedes the always-visible-old-error policy
below. Neither this record nor that implementation constitutes independent approval.

Task `bb4743c7-40ed-43ff-95c2-9ab6adb2d01d`, candidate only; not deployed.
Branch `integration/leader-resolution-history-security`, preserved worktree
`/root/WORKTREES/cr-leader-resolution-history-security`.

Exact base **d07206aeaefc591f7d4ae35a4b858883c154e53d** was verified against the
remote before creating this new worktree. It includes the eight-worker/model
integration on accepted security SOURCE **00f9e197285e9c918372367f626c0b744d47d0d6**
(application 80843c0). The previous review worktree was not edited.

## Resolution

Commit **067ef9df704b84ddd0ad2735a4510b2a9b218dc5** adapts the feature delta from
**e1c1aca8f1a54a7451b367f0679c85f23aecad36**. Both model and resolution test groups
were retained when resolving their end-of-file conflict. No stale runner,
controller, HTTP implementation or transport was imported.

- Explicit recovery metadata contains summary, evidence, confirming leader,
  timestamp and epoch; original failed/interrupted/cancelled status and result
  remain intact. Same-record retries are idempotent; conflicting records fail409.
- CLI requires a current Code leader capability. HTTP keeps encrypted access,
  session/CSRF, thread access and request-lifetime guards, then checks current
  leader/epoch and the persisted Plan/Code mode. Same-folder task scope remains.
- Resolution cannot finish while a cancelled turn/start and its compensating
  interrupt are still settling. Late completion cannot replace terminal history.
- State version1 accepts the optional metadata without resetting older state.
  Recovery survives restart and emits no model turn, acknowledgement, manual
  release, rename, archive or other conversation mutation.

## Leader history

The follow-up commit adds a pure selection function and one history toggle:

- Every creating/queued/starting/running/stopping task remains visible.
- Every unresolved failure/interruption remains visible, regardless of age,
  result count or delivery status. Time and hiding never imply resolution.
- At most three other terminal outcomes from the last24hours are shown by
  default, including cancelled work and verified recoveries. Recovery time is
  used for an old task taken over recently. These thresholds are implementation
  choices, not user-specified limits or scheduler budgets.
- “Xem lịch sử (N)” / “Thu gọn (N)” reveals the remaining retained tasks.
  The API returns all retained same-folder tasks instead of a positional100-row
  tail that could drop active work or errors. Existing retention remains200
  inactive tasks plus unfinished work; this is not unlimited archival storage.
- Recovery summary and badge are visible; evidence and original error remain
  expandable. The history toggle has keyboard access and a44px touch target.
  Leader remains its own page; Files, [x], draft/scroll, Plan and Reload are kept.

## Verification

All heavy checks used `codex-heavy`, sequentially, with one Vitest worker.
Final **npm run check passed:505 Vitest tests/77files +11 Node readiness tests,
lint, TypeScript, client/server builds and PWA validation**. The existing large
client-chunk advisory remains non-fatal; no dependency or runner changes.

```sh
codex-heavy --label leader-history-full-check -- bash -c 'VITEST_MAX_WORKERS=1 npm run check && PLAYWRIGHT_MODULE=/tmp/working-hours-browser/node_modules/playwright/index.mjs TEAM_SCREENSHOTS=/tmp/cr-leader-history-browser node scripts/team-panel-browser.mjs'
```

Browser fixture passed1280×900,320×600,390×844,390×600: default/history counts,
new failures/interruption arriving through live refresh, old unresolved errors,
recovery/original evidence, keyboard expand/collapse, draft and scroll retention,
separate Leader page, Files right, cancel failure/retry, compact Plan, Reload,
leader/worker controls and fallback. Screenshots were also visually inspected.

Tests cover time boundaries/order/old timestamps, active work beyond limits,
snapshot history beyond100, Code/worker/folder/epoch rejection, idempotency,
restart, late completion and in-flight cancellation, encrypted resolve and
logout/expiry/key rotation during an awaited access check. Eight-worker capacity,
pinned Astra/Sol settings, manual/Plan permissions and unchanged security guards
remain covered. No real model turn, user task resolution or Nginx fixture ran.

Evidence: `/tmp/cr-leader-history-full-check.log`; first focused resolution check
`/tmp/cr-leader-resolution-verified.log`; screenshots
`/tmp/cr-leader-history-browser/{current,history,resolved,leader-plan}-*.png`.
Only temporary fixture servers/native processes were used and closed; no hosted
service, Services registration or production port/config/key change was made.

## Incremental deployment delta

Comparing all90backend artifacts against the previous task build yields exactly:

| Artifact | SHA256 |
| --- | --- |
| http-app.js | 1a3e4d21e0f5154a746ded3d3a9440493d60618ded2ce1b742cfa60db99342f0 |
| http-app.js.map | e55e6b39060d87f8bd7445e3c9d6dbd102f52d9100a22b2fe684668a35e4e19f |
| orchestration.js | a83a303843487c0c9ac3ea709a364e050fa7cc00af5573daf5d4c7e2fecc9774 |
| orchestration.js.map | d3bc165b699492e112e1797ff1b1a2a132ea9ba22900e5d15c33f4c84041ec53 |

The combined delta against the accepted security release's46sealed artifacts
also includes the previous task's `controller.js`/map (unchanged here; hashes in
`docs/leader-capacity-model-integration.md`). Complete comparison including old
and new hashes: `/tmp/cr-leader-resolution-history-artifact-delta.json`.
Do not apply this small delta to old production783b1e3: it depends on security.
The client must be published as a complete matching build, including hashed assets
and entry HTML/PWA files; source changes are ConversationTeam, teamTaskSelection
and styles. No secure client/transport or other product module was edited.

Hours JS remains **b763a0f7b74c0341684e196855e85b3f5e3b123915a373b27463c17916702e93**,
map **6a76da381331d7a802da5d844d341da742f0bfc3809f0cfe3b74370d55c42fb8**, matching
the read-only live comparison. Hours source, generator and template are untouched.

## Activation handoff

Leader reviews this later integration candidate independently of security/TLS
rollout; it neither changes nor replaces the accepted security payload/seals.
Prepare a NEW reviewed release against the then-current accepted baseline, with
the complete client and exact backend allowlist. Backend activation needs a fresh
process through the authorized ALL-idle `scripts/restart-when-idle.mjs` workflow;
there is no hotpatch or restart bypass here.

Before activation, privately back up the actual modules/client and
`.state/Orchestration.json`. Rollback restores matching code/assets while retaining
current task state, including any recovery records; never overwrite later task
results with an old state snapshot. No state migration or reset is required.
Only AFTER this feature is live may the leader recheck the requested real
Rename/Archive takeover evidence and mark that target resolved via the authorized
API/CLI. No real target was resolved during this task. No main merge, deploy,
restart, release/seal edit or pending security/TLS work was performed.
