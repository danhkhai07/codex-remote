# NEW Push / Browser / Files release runner

Task f27191c3. Actual runner: `scripts/push-release/deploy.mjs`, with frozen
`core.mjs` and `readiness.mjs`. Preparation only: no apply/watcher/restart here.
This supersedes the earlier runbook's old Hours chip/template pin.

Source starts from ec8638f; includes corrected Hours 9a05871 + 27f50a7, cherry-picked
as d75dc4b + b52f4ad. Correction is template-only; reuse matching app artifacts
already checked at ec8638f, with exact source and hash validation rather than
rebuilding the same frontend. CR4 LIVE receipt is
`/root/.local/state/codex-remote-secure/releases/hours-chart-669d66d4/LIVE.json`:
23 September 2026 21:07:14 +07, template
`703ad317215c7b1b9e7059169c1613d0128cb2a0d993a94e601f33e352e06df0`.
No template or Hours generator/data/backend is in this runner's payload or backup.

## Commands and modes

The operator chooses a new private directory under
`/root/.local/state/codex-remote-secure/releases/push-browser-*`.
Commands below are examples for leader review; **apply is not run by preparation**.
Use `/usr/local/bin/node` and a clean environment (`env -i PATH=/usr/local/bin:/usr/bin:/bin`),
not inherited OLD settings. Runner reads and validates only NEW instance.env.

```
node scripts/push-release/deploy.mjs prepare RELEASE \
  /root/WORKTREES/cr-push-services-hours \
  /tmp/push-services-hours-title-evidence/candidate-manifest.json
node RELEASE/deploy.mjs check RELEASE
node RELEASE/deploy.mjs baseline RELEASE \
  /root/.local/state/codex-remote-secure/releases/hours-chart-669d66d4/LIVE.json
node RELEASE/deploy.mjs check RELEASE
```

`prepare` verifies the reused source/artifacts, freezes the current runtime
maintenance/auth dependency closure, copies the six allowed backend files and
matched full client, and creates an immutable manifest. `check` before baseline
returns pending, never ready. `baseline` requires the corrected CR4 LIVE receipt,
matching integrated source/current runtime/isolated templates, no old chip,
reviewed backend bytes, and current NEW/OLD identities. It creates immutable
baseline/seal files without activation. If any drift occurs, prepare a new release;
do not patch the old seal or invent a passing receipt.

After independent Push review and leader review of exact runner/manifest/seal,
the subsequent operator can launch **one separate systemd watcher**, for example:

```
systemd-run --unit=codex-secure-push-RELEASE-ID --collect \
  --property=MemoryMax=256M --property=CPUQuota=25% \
  /usr/bin/env -i PATH=/usr/local/bin:/usr/bin:/bin \
  /usr/local/bin/node RELEASE/deploy.mjs apply RELEASE
```

No exclusion for the current worker, leader, task ID or queued jobs. End actual
turns and deliver reports normally. Do not wait synchronously inside an active
chat for its own idle condition. The watcher waits independently up to 12 hours;
unknown/missing auth/readiness data fails closed. No task is interrupted, marked
complete or otherwise mutated by this runner.

## Guarded operation and recovery

- Only NEW runtime/service/origin is accepted. OLD must remain PID0,
  inactive/disabled. Stock restart script is never invoked.
- Encrypted thread/pending API uses the frozen original maintenance adapter.
  Per-group team snapshots and read-only global Orchestration.json additionally
  cover creating/queued/starting/running/stopping work, unsettled dispatch and
  pending/sending reports, including orphan groups. Historical review notices
  are not active dispatches; the runner does not resolve or discard them.
- Require two idle observations and immediate checks before publication and
  restart. Shared publication lock uses the existing ownership protocol; no
  stale/foreign lock reclamation. Runtime code/config/key identity/VAPID keys,
  package/dependencies, service definitions and both corrected Hours templates
  are pinned. Mutable sessions/subscriptions/Hours totals may advance normally.
- Six backend files only: controller/index/push JS + maps. Other compiled bytes
  (including secure-client and event-hub maps) are never copied. Private backup
  contains only those code preimages and frontend. Hash-addressed assets remain
  for old tabs; browser entry is published last with atomic file replacement.
- apply-attempt.json is exclusive and permanent. restart-intent.json is written
  and fsynced before the only `systemctl restart codex-remote-secure.service`.
  Rerunning apply is rejected even after partial/ambiguous failure. There is no
  automatic retry of restart and no automatic rollback. No config/key/VAPID/
  subscriptions/session/native/Vault/Hours mutable-state backup restoration.
- status.json records current stage, last written file or partial failure;
  verified.json records NEW PID/lifetime, health, public/local route entries,
  assets/SW/manifest, encrypted harmless Files and corrected Hours HTML, cookie-only
  denial, unchanged excluded identities and OLD disabled. It sends no push or
  model turn. Physical iOS/Safari remains an acceptance limitation.
- `node RELEASE/deploy.mjs verify RELEASE` can recheck a completed/ambiguous
  restart without restarting again. It requires the new PID, exact published
  bytes and preserved identities. On failure, retain backup/journal and have
  leader inspect the exact partial state; do not replay apply or restore a broad
  old code/data tree. A separate reviewed code-only recovery must retain the
  corrected Hours template and use the same idle/lock/drift rules.
- There is no hard request-admission barrier: new work can arrive between final
  observation and restart. The runner narrows that interval with rechecks and
  waits again for any observed work; this known race is not claimed eliminated.

## Validation

Run focused fake-operations tests, syntax and lint via codex-heavy:

```
node --check scripts/push-release/deploy.mjs
node --test scripts/push-release/core.node-test.mjs
npx oxlint scripts/push-release
```

Tests cover busy/own queued work, before-write and post-write drift, new work
arriving during publication, partial publication, restart/verification failures,
private atomic files and foreign lock refusal, API + global orchestration checks.
Existing application full/focused/browser receipts are reused. No app rebuild
or real model turn/push is necessary for this rollout-only change.
