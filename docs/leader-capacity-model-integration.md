# Eight workers and per-task models on the accepted security source

Task `d883faa2-cc98-4744-808f-d6cf4588e4d5`; branch
`integration/leader-capacity-model-security`; worktree
`/root/WORKTREES/cr-leader-capacity-model-security`.

Exact base: **00f9e197285e9c918372367f626c0b744d47d0d6** (accepted application
80843c0 plus independent review controls). This branch is a separate follow-up;
it does not change any immutable security release/seal or authorize production
activation. Do not deploy its four-module delta onto the old production783b1e3.

## Changes

- `d310533`: one exported `MAX_CONCURRENT_WORKERS = 8` drives the scheduler,
  snapshots, injected leader help and browser fixture. README points to that
  source. Leaders are excluded. Budgets remain 20 dispatches, 8 result wakeups per
  direct user cycle and 12 unfinished tasks per folder. Eight is a ceiling, not a
  request to fill every slot or run eight heavy builds.
- `81f7ebb`: adapted **be185b7** without replacing the accepted controller or HTTP
  implementation. `models` exposes only Astra/Sol and catalog-supported efforts;
  `spawn`/`delegate` validate inherited or explicit model/effort before reservation
  and again before dispatch, with no silent fallback. Settings survive retries
  and queued-task restart. Plan/Code/fullAccess remain inherited, and result
  wakeups keep the leader's settings. The original **bdd1f7a** README guidance is
  integrated alongside this report. No model-picker UI was introduced.
- Integration closes admission/recovery races: reserved tasks stay `creating`
  until the worker read/create completes, cancellation cannot be overwritten by
  the final `queued` transition, spawned-worker rename retains the admission
  guard through native dispatch, and startup reconciliation blocks new pumps
  until accepted turns own their slots. Uncertain work is not blindly replayed.

The real task receipt was read without changing it: gpt-6-astra/max, default mode,
fullAccess inherited from the leader. This is evidence about this task's inherited
settings, not a claim that the new override is live. All test turns use fake
threads, temporary vaults and stub/native-fixture RPC; no real model invocation.

## Accepted behavior preserved

Controller source differs from the accepted security base by exactly one line:
`models: () => this.listModels()`. Request-lifetime and role guards remain distinct,
including the final native-before-effect callback. HTTP, encrypted API/wire,
session revocation, native transport, files, keys, frontend and package/lockfile
are unchanged. Accepted-effect bookkeeping still completes after logout/abort;
revoked uncommitted effects do not dispatch.

Working Hours source/generator/template unchanged. Compiled JS remains
`b763a0f7b74c0341684e196855e85b3f5e3b123915a373b27463c17916702e93`, map remains
`6a76da381331d7a802da5d844d341da742f0bfc3809f0cfe3b74370d55c42fb8`.
Do not restore the pre-pause estimator or its stale handoff/release.

## Validation and incremental backend allowlist

Final bounded run, one Vitest worker: **170 tests in 9 files +11 Node readiness
tests**, lint and server build passed. Suites: orchestration47,
orchestration-integration21, controller26, controller-memory3, security-integration9,
secure-independent-review26, secure-api24, secure-wire3, work-hours11.

Controls include eighth/ninth admission, one-slot completion/cancel, starting and
stopping reservations, concurrent pumps, startup in both call orders with uncertain
accepted turns, two independent folders, same-thread serialization, permissions,
archive/epoch guards, cancellation during admission, supported catalog overrides,
missing/hidden/invalid settings, retries/restart pinning, disappearing catalog
support, Plan worker and leader wakeup settings, Code Astra/max with inherited
fullAccess, logout/expiry/rotation and actual fake-native pre-effect checks.

```sh
codex-heavy --label leader-capacity-model-verified -- bash -c 'npx vitest run server/orchestration.test.ts server/orchestration-integration.test.ts server/controller.test.ts server/controller-memory.test.ts server/security-integration.test.ts server/secure-independent-review.test.ts server/secure-api.test.ts server/secure-wire.test.ts server/work-hours.test.ts --maxWorkers=1 && node --test scripts/restart-readiness.test.mjs && npm run lint && npm run build:server'
```

Evidence: `/tmp/cr-leader-capacity-model-verified.log`. Backend-only change; no new
frontend source, browser feature, hosted fixture or Services/port change. The
existing team browser fixture now takes its mock limit from the shared constant;
no claim of a new browser rollout or full npm check.

Only these artifacts differ when compared with the accepted security release's
46 sealed backend artifacts:

| Artifact | Candidate SHA256 |
| --- | --- |
| controller.js | 15d3fc0d0251a8ff9cbbc4e01fcb32601d128b7b182ec0a0af3979deffaea9b7 |
| controller.js.map | 1e9436a6ace5d4a6856b58914ed07423d610c737b415d0fde5f939aa698166f3 |
| orchestration.js | 1b58c40cd918804356874f3ef5146b85e26c6264344b1e3123eef77d936ac6fa |
| orchestration.js.map | 6ced6900642b6614e47b9b4025c602a59b2d758c75999a24259cdca456abffb8 |

Reference artifact set:
`/root/.local/state/codex-remote/releases/secure-api-80843c0-review-key-cutover-8b395de/payload/dist-server`.
It was read for comparison only. Source diff also confirms no changes outside the
scoped orchestration/controller code, tests, README and this report.

## Handoff

Leader review/integration is separate from security/TLS deployment already in
progress. Preserve its accepted source/hash until a new controlled integration is
explicitly prepared; never arm an old baseline for this delta. No production
merge, deploy, restart, configuration/key/port change, seal edit or Services write
was performed. Keep this clean pushed worktree for review. The next resolution
flag/Leader-history task must create its own worktree from the reported final HEAD.
