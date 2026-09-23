# Push, Services and Hours integration — prepare only

Task `4cbf9b25-4abd-4e3e-aefe-87e73fe5cfdb`. This document is a NEW-only
deployment/verification runbook for leader review, **not an armed release**.
No publication, restart, key/state migration or real push is part of preparation.

## Included source and pending work

Dedicated branch `integration/push-services-hours`, worktree
`/root/WORKTREES/cr-push-services-hours`, starts at Push `ba81b13` with owner Files
baseline reconciliation `51e7785`. Integrated in order:

| Source | Integration commit | Change |
| --- | --- | --- |
| `de807078` | `ec9d442` | Hours today-total template |
| `f83dd808` | `4a46a7b` | NEW Hours path in page and Files bridge |
| `7b8fd6b` | `719bb1c` | Hours spacing |
| `44dd726` | `df333b0` | Services middle-click tab with existing encrypted preview grants |

All cherry-picks were clean. Push modifies App navigation/main/SW and three
backend modules; Services modifies LocalhostPreview/ServicesPage plus its tab
helper; Hours modifies the template and shared timer path. No competing product
hunks or package/lock changes. Live owner Files, remembered device, mobile login
and PWA source remain inherited. No backend Hours or generator changes.

**Files browser-title task `fb24d24d` is not included.** At integration,
`fix/files-browser-title` still pointed to its Services base `44dd726`; no product
commit had been handed over. Do not copy its dirty checkout or wait/poll for it.
Leader can add the eventual reviewed commit and rerun affected checks/build to
produce a new matching client/manifest. This candidate must not be described as
including that feature.

CR4 owns Hours publication task `c9f7285e`. Its frontend/template release is
independent of this preparation. Do not compete for publication or use an older
frontend baseline to roll it back.

## Checks and evidence

Sequential `codex-heavy` checks run full `npm run check`, then generator tests and
contextual-push, Services-middle-click and working-hours-secure browser fixtures
against the combined build. Use `TMPDIR=/tmp` and external
Playwright `/tmp/working-hours-browser/node_modules/playwright/index.mjs`.
Fixtures use fake credentials/state/native RPCs; no live subscription or model
turn is used. Push fixture stubs only privileged OS focus for synthetic clicks.
Physical Safari/iOS notification delivery is outside this coverage.

Result: 588 Vitest tests/85 files, 11 restart-readiness tests, lint (zero warnings),
typecheck, client/server builds and PWA passed. Four generator tests passed.
Push and Services fixtures passed at 1280/390 widths; actual encrypted Hours page
and Files bridge passed at 1280/390/320. No real model turns or user push sent.

Evidence paths: `/tmp/push-services-hours-check.log`, `/tmp/push-services-hours-fixtures.log`,
`/tmp/push-services-hours-evidence/candidate-manifest.json`, and browser
screenshots in that evidence directory. The full check passed before Python
discovery returned "no tests"; only the remaining generator/browser checks were
resumed in a second queued job. No broad check was repeated.
Run generator tests explicitly as `python3 working-hours/test-update.py` because
unittest discovery skips this hyphenated filename. The manifest is a code inventory with a **provisional
observed** runtime comparison, not a seal authorizing deployment.

## Publication boundary

Only these backend files may be replaced together:

```
dist-server/controller.js
dist-server/controller.js.map
dist-server/index.js
dist-server/index.js.map
dist-server/push.js
dist-server/push.js.map
```

Publish the complete matched built client/SW; retain old content-hashed assets
for open tabs. Do not copy `dist-server` wholesale: browser-shared
`secure-client.js`/map and historical `event-hub.js.map` differ from live outside
the push delta. Every other backend/module/script/dependency stays byte-identical
to the fresh runtime baseline. In particular, preserve Hours JS/map
`b763a0f7b74c0341684e196855e85b3f5e3b123915a373b27463c17916702e93` /
`6a76da381331d7a802da5d844d341da742f0bfc3809f0cfe3b74370d55c42fb8`.

The candidate template is the same `7b8fd6b` source CR4 is publishing. After CR4
verification, compare it with BOTH runtime `working-hours/dashboard.template.html`
and isolated `hours/dashboard.template.html`. This rollout must not rewrite or
regenerate Hours. If either is different, stop and reconcile with CR4/root.

## NEW-only ALL-idle runbook for the subsequent activation stage

1. Obtain CR4's completed publication/live verification receipt, and leader's
   decision to include or explicitly defer Files title. Verify exact remote
   source commit, clean checkout, candidate checks and hashes. If adding source,
   rebuild the matching client and replace the inventory before proceeding.
2. Create a new private immutable release directory under
   `/root/.local/state/codex-remote-secure/releases/`. Freeze reviewed runner,
   original authenticated maintenance/config/readiness dependency closure,
   payload and hash manifest there. Do not reuse/arm a historical release.
   Adapt the guarded workflow from the previously reviewed owner-files release;
   do not execute its old runner unchanged (it assumes OLD is still running).
3. Start the reviewed watcher in a separate bounded systemd service with clean
   environment plus NEW `instance.env`; never inherit OLD environment. Pin
   runtime `/root/RUNNING-SERVICES/codex-remote-secure`, origin
   `https://remote.danhkhai.io.vn`, host `127.0.0.1`, port `5174`, required encrypted
   API and service **`codex-remote-secure.service`**. Reject mismatches. OLD
   `codex-remote.service` must stay inactive/disabled. Never use stock
   `scripts/restart-when-idle.mjs`: it targets OLD service/state.
4. After CR4 has finished, capture a fresh exact code/frontend/template,
   dependencies, units, NEW PID/start-time and config/key-identity baseline.
   Keep secret values private and out of logs/manifests. Record key/VAPID/session
   identity and state locations without replacing them. Active Hours accounting
   can legitimately advance; do not require stale state-byte equality or restore
   mutable state from a snapshot.
5. Through the frozen NEW encrypted maintenance adapter, check ALL listed threads
   and pending native questions using `restartReadiness`. Require ready=true,
   busy=0, pending=0, incomplete=false; a nextCursor/incomplete/unknown/error
   response blocks. System-error threads require the helper's terminal-history
   proof. Also inspect orchestration snapshots for every current group using its
   leader or an assigned member; missing/incomplete access blocks:
   queued/starting/running/stopping/unfinished dispatch or report delivery blocks
   restart. Never assume this worker or leader's own turn is exempt. Do not
   interrupt/cancel work to reach idle.
6. Require two idle observations at least five seconds apart. Acquire the shared
   publication lock `/root/.local/state/codex-remote/deployment.lock` with owner
   identity through the existing reviewed lock implementation. Never steal or
   remove a foreign lock. Under lock recheck immutable baseline, CR4 receipt,
   payload hashes and ALL-idle immediately before the first write. Baseline drift
   blocks instead of silently rebasing the release. Existing idle checks have a
   small admission race; recheck again before restart and never restart on newly
   observed work. Do not claim a hard request-admission barrier exists.
7. Back up exactly the six backend preimages and the complete existing frontend,
   with hashes and private permissions. Do not restore/copy key, env, VAPID,
   subscription/session/native/Vault/Hours data as part of apply or rollback.
   Publish using atomic per-file replacements: assets first, six backend files,
   worker/root assets, then client entry last. Verify changed and excluded bytes.
   If work arrives, preserve staged bytes and wait again; do not restart a busy
   process. Recheck ALL-idle and code baseline directly before the one NEW restart.
8. Verify NEW health locally/publicly, new PID/start-time, no restart loop, exact
   public/local entry and referenced assets/SW/manifest, OLD still inactive. Read
   harmless `/etc/hosts` through encrypted Files and confirm cookie-only denial;
   do not log credentials. Verify `/services`, `/working-hours` and Files NEW
   Hours path with the current owner gate; assert the dashboard/template and
   Hours backend identities, not a frozen live total. Check login/remembered
   device/mobile/PWA regression evidence remains applicable. Confirm no unlisted
   runtime bytes or key/VAPID identity changed. Do not send a synthetic real push
   or create a real model turn; physical-device push acceptance remains explicit.
9. Only after verification, record rollout evidence and update existing Services
   metadata and Vault by revision check. On failure record the exact stage. A
   rollback restores only this release's code preimages with drift checks and
   the same NEW-only idle gate; never overwrite CR4/another release, restore old
   mutable state, rotate keys or resurrect OLD. If the API is unavailable and
   idle cannot be established, stop for leader recovery rather than infer idle.

Remaining activation gates are concrete: CR4 live receipt/fresh baseline, Files
title scope resolution, exact reviewed release runner/seal and ALL-idle. This
preparation neither arms a watcher nor requests new user authorization.
