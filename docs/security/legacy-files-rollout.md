# Legacy Files hardening: preparation, not publication

Base is live783b1e3. This keeps the old UI/login/service/native root and fullAccess.
Only `file-policy`, `server-files`, `directory-listing`, `pptx-preview`, `http-app`,
`config` JS/map pairs are published (12 files). No client, dependency, auth,
preview, controller, Hours, Vault/native state, generator or template is installed.
Legacy same-origin previews and session behavior remain unchanged residual risks.

Implementation reuses accepted808 file guards. HTTP HTML/download and PPTX consume
the inspected descriptor; async reads are awaited. Additional descriptor cleanup
handles a response closed during file validation. Tests use fake private files and
converter adapters, never real credentials/native turns. Existing normal JSON,
HTML/PDF/PPTX/range/HEAD/download response shapes remain intact.

Environment delta is **only** `CODEX_REMOTE_FILE_ROOTS`:
`/root/GITHUB,/root/RUNNING-SERVICES,/root/WORKTREES,/root/VAULTS`.
All exist as real directories. Native workspace `/root`, password/session values,
old origin, port, presence and Hours settings are unchanged. Broad root pins now
fail; existing Files path editing opens the allowed project/data directories.
Private `.env`, `.codex`, `.local`, `.state`, `.orchestration`, SSH/system paths
and the standard `owner-key.json` / `.remote-push.json` credential filenames
remain denied under allowed roots. The new owner key must still live outside
exposed roots; this is not isolation against an authorized root agent.

`scripts/legacy-files-stage.mjs` stages a NEW private release from a clean built
worktree. It validates the environment with the candidate parser without starting
any service; only paths/hash evidence are printed. `environment.desired` contains
existing secrets and must stay root-private, never printed/Git/Vault. Runtime
event-hub.js.map is an existing non-patch build difference; runtime JS matches.
The installer preserves that map and all other excluded runtime files by hash.

After independent review, root may fast-forward/push main to the exact delivered
commit. That source update is compatible with the still-running old auth/CLI.
Do not copy compiled modules yet. Run `install.mjs --check RELEASE`: it must pass
current source/runtime/environment/unit/PID lifetime/artifact checks. A changed
baseline requires a NEW reviewed release, never overriding the prior inventory.

Exact activation commands (set RELEASE to the delivered immutable directory):

```sh
/usr/local/bin/node "$RELEASE/install.mjs" --check "$RELEASE"
systemd-run --unit=codex-legacy-files-install --collect \
  --property=Type=exec --property=User=root --property=UMask=0077 \
  --property=KillMode=control-group \
  /usr/local/bin/node "$RELEASE/install.mjs" --apply "$RELEASE"
```

The unit must be separately owned; do not arm inside codex-heavy or an active
gateway child. Installer does not arm itself. It accepts only the old service.
It requires local/remote main at the exact candidate, a fresh attempt and its
exclusive cooperative lock. It waits for complete ALL-idle/zero-pending twice
five seconds apart, checks once more and rechecks drift immediately before backup
and publication. It takes a fresh private preimage of only touched backend/env
files; absent new file-policy entries are recorded in baseline. Dependencies are
published before consumers, environment last. No mutable database is restored.
The original frozen `scripts/restart-when-idle.mjs` performs its own final checks
before ordinary restart of **codex-remote.service**. New arrivals can delay it.
No early key initialization, shutdown/retirement, or new-instance restart occurs.

The marker `/root/.local/state/codex-remote/legacy-files-deploy.json` reaches
`phase=complete` only after a fresh PID, exact payload and excluded-file hashes,
unchanged frontend, local/public health and HTML hashes, authenticated private
canary403 and normal project file200. Backup/phase evidence is in
`RELEASE.activation`. Checks do not start a native model turn or alter Hours.
After actual publication root should update the existing `/services` work summary
and checked Vault status. This preparation does not claim those live updates.

On interruption or failed checks: preserve marker/activation/lock and determine
actual PID/module/env state; do not re-run blindly or restore databases. The old
frontend remains unchanged and the last known module/env preimage is retained.
Once the new instance has a key, restoring the permissive Files module or `/`
roots would expose it again: prefer a forward fix. Any rollback needs an explicit
phase-specific plan that keeps all same-host secrets protected. Do not clear
unknown lock/evidence, stop active work or permanently retire the old service.
