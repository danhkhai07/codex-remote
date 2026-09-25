# NEW-only twenty-message history package — not armed

User contract:20 newest user/assistant messages excluding tools; upward lazy paging; encrypted device cache. Native/model/Vault history is retained. Validation and measured limits are in `../performance/history-window-2026-09-25.md`. This is a candidate for leader review, not a live deployment or permission to arm during this task.

## Payload and preserved boundary

Build only `/root/WORKTREES/cr-history-window-cache`. The fixed backend allowlist is16 files: `config`, `controller`, `http-app`, `read-state`, `history-pages`, `history-json`, `history-paginated`, `rollout-history`, each JS + map, plus the whole matching client/PWA. New emitted byte changes outside that list abort preparation. Three exact pre-existing build/live pairs (`secure-client.js`/map and `event-hub.js.map`) are bound in `PRESERVED_BUILD_DIFFERENCES`, documented by the accepted Push rollout, and **excluded from publication**. Their source must remain identical to live-source6f6fe30; either-side hash drift aborts. The runtime secure-client helper stays old while the matching browser bundle keeps its existing remembered-device implementation. No file is silently normalized or copied over those runtime artifacts. There is no dependency or environment change. Node22.23.2 built-in SQLite is exercised by the tests/browser and the actual installed native0.155 oracle.

Preserve Hours JS `b763a0f7b74c0341684e196855e85b3f5e3b123915a373b27463c17916702e93`, map `6a76da381331d7a802da5d844d341da742f0bfc3809f0cfe3b74370d55c42fb8`, live703ad317 template/generator/data, Push answer behavior, Files owner-full/title, Services middle click, all other backend modules, keys/config/native/Vault/session state. No full dist-server copy. OLD remains disabled; the fixed restart target is **codex-remote-secure.service/127.0.0.1:5174**. Never invoke the stock restart script with its default OLD target.

The new derived cache is private0700/0600 at `/root/.local/state/codex-remote-secure/history-index`, a sibling of the configured context Vault. CODEX_HOME remains unchanged. Do not preinstall test cache DBs. Cold indexing scans the source once; warm unchanged reads only small guards. Checkpoint v3 rebuilds earlier derived indexes, never native data. All37 inspected current native headers are unreferenced paginated; future non-null prefix/fork lineage is explicitly unsupported, so inspect any new metadata drift before activation. This package does not claim universal native format compatibility.

## Preparation (read-only toward runtime)

After committing reviewed source, run sequentially through `codex-heavy` from the worktree. Use a NEW output/release path if any pre-existing attempt exists; never overwrite a seal. The following paths are reserved for task724ec8b2:

```sh
node scripts/history-release/artifacts.mjs \
  /root/.local/state/codex-remote-secure/history-window-724ec8b2 \
  /tmp/history-window-final-724ec8b2.log \
  /tmp/history-window-controls-724ec8b2.log \
  /tmp/history-window-validation-724ec8b2-run3.log \
  /tmp/history-window-excluded-artifacts-724ec8b2.log
node scripts/history-release/deploy.mjs prepare \
  /root/.local/state/codex-remote-secure/releases/history-window-724ec8b2 \
  /root/WORKTREES/cr-history-window-cache \
  /root/.local/state/codex-remote-secure/history-window-724ec8b2/candidate.json
node /root/.local/state/codex-remote-secure/releases/history-window-724ec8b2/deploy.mjs baseline \
  /root/.local/state/codex-remote-secure/releases/history-window-724ec8b2 \
  /root/.local/state/codex-remote-secure/releases/hours-chart-669d66d4/LIVE.json
```

`artifacts` requires clean HEAD, successful log evidence supplied by the operator, previous LIVE6f6fe30 payload bytes unchanged, exact emitted backend delta and matching complete frontend. It hashes logs; it does not infer that arbitrary log text proves a passed check. Leader must inspect the recorded outcomes. `prepare` freezes the **currently installed** maintenance/config/auth import closure and dependency path before publication. Candidate and runner bytes, source HEAD and artifact evidence are bound by manifest; `baseline` adds current full runtime inventories, environment digest, key physical identity, VAPID digest, systemd definitions/lifetime, Hours receipt and an immutable seal. No secret bytes are printed or copied into Git/Vault.

The baseline is intentionally exact. Source/worktree, runtime files, unit definitions, key/config, Hours, dependencies or publication drift requires a new reviewed package/baseline; do not rewrite the existing seal or broaden allowlists to suppress a mismatch. Normal mutable user state is not copied/restored or used as an immutable baseline.

## Later activation — leader only after review

Do not execute these commands as part of preparation. A check uses encrypted read-only maintenance and reports busy status; being busy is expected while coordinating this task:

```sh
/usr/local/bin/node /root/.local/state/codex-remote-secure/releases/history-window-724ec8b2/deploy.mjs check /root/.local/state/codex-remote-secure/releases/history-window-724ec8b2
systemd-run --unit=codex-history-window-724ec8b2 --collect --property=Type=exec \
  --property=UMask=0077 --property=RuntimeMaxSec=54000 \
  /usr/local/bin/node /root/.local/state/codex-remote-secure/releases/history-window-724ec8b2/deploy.mjs apply \
  /root/.local/state/codex-remote-secure/releases/history-window-724ec8b2
```

Then end the coordinating turns; do not hold a turn polling its own idle condition. The fixed NEW adapter uses the frozen stock complete-thread/restart-readiness helper, plus group and persisted orchestration queue/result guards. No own-task exemption. It requires ALL threads complete/zero pending and all queued/native-unsettled jobs/results finished twice5seconds apart, then again immediately before copying. It takes the shared publication lock, rechecks all preimages, and makes private code/client backups (new modules have explicit null tombstones). It never backs up/restores user databases or keys.

Backend and new hashed assets publish first, retaining old assets. Existing index and SW remain until the replacement backend is healthy. If new work arrives during publication, wait for it to finish; recheck ALL-idle and exact published bytes immediately before the single ordinary NEW restart. A failed/ambiguous attempt is recorded, never retried automatically or rolled back. This cooperative check is not an admission lock against a request arriving in the last systemctl gap; no active turns are deliberately interrupted.

After a fresh process lifetime/health is proven, publish SW then **index last**. Verify all expected/excluded runtime bytes, NEW/OLD status, unchanged key/config/Hours identities, local/public HTML and entry assets/SW/manifest, anonymous/cookie-only denial and encrypted harmless `/etc/hosts` read. No synthetic real history page, model turn, Pause/Resume, push send or task-resolution mutation. `status.json=complete` requires these checks, with detailed `verified.json`. It is code/publication verification; Services/Vault publication facts are updated separately afterward with checked revisions.

## Failure and recovery

Never rerun `apply` after `apply-attempt.json` exists. Inspect status, backups, actual PID/lifetime and exact inventories. Do not restore native/Vault/session/Hours data or rotate keys. If activation did not restart, leave current service running and resolve drift at idle. If replacement is unhealthy, a forward fix or explicit code-only NEW rollback must itself respect ALL-idle; preserve all user data.

`verify` is a **scoped recovery action**, not a wholly read-only command: it may finish deferred SW/index publication after proving the replacement PID/lifetime and exact partial payload. It recognizes only the sealed pre-entry, SW-only and completed states, holds the shared lock and refuses other drift. It never copies backend or restarts:

```sh
/usr/local/bin/node /root/.local/state/codex-remote-secure/releases/history-window-724ec8b2/deploy.mjs verify /root/.local/state/codex-remote-secure/releases/history-window-724ec8b2
```

Retain worktree and evidence while runner references them. Do not mark live until actual postverification. After publication, update Services and the maintained history reference via NEW clean-env knowledge/services CLI; do not edit root Context. Open tabs should reload to receive the matching new client.
