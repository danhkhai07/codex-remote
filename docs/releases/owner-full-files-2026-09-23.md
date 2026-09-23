# Owner Files restoration — new remote instance only

User correction/task 110a04d4 explicitly authorizes the authenticated owner to
read all filesystem paths, including hidden/configuration/key files. This
supersedes the earlier assistant-imposed exclusions **on remote.danhkhai.io.vn**.
The old codex instance retains its own deployed source/config/service.

Application base: `10f52e9410dd593e9182483701f043b43338ccf1`.
New runtime is a publication directory, not a Git checkout:
`/root/RUNNING-SERVICES/codex-remote-secure`.
Prestart helper was imported byte-for-byte from deployment helper source
`4de7808e2438c523b0e233c10e3f566c932b8e6a`, then adapted only at the
file-access/key-validation call. Do not overwrite the other activation helpers.

## Change boundary

`CODEX_REMOTE_FILE_ACCESS=owner-full` requires the encrypted owner API and
exposes `/`. Private/system path name exclusions apply only to the default
`restricted` mode. No hidden credential/key deny list remains in owner-full.
Files follows ordinary symlinks, inspects opened descriptors and refuses a
changed identity when reopening. File-type checks reject devices/FIFOs/kernel
virtual interfaces before reading; this is stream safety, not a secret filter.
Preview allocation reads the inspected byte length, with an explicit bound.

Owner key regular-file/uid/0600/format validation remains. Only the incompatible
outside-file-roots rule is waived in explicit owner-full. Existing key is reused;
no init, copying, rotation or native fullAccess/workspace changes.

The missing Open action and raw conversation/new-tab URLs now use the app viewer
`/files?path=…`. Each tab/reload unlocks before file loading. Ordinary clicks stay
in the current unlocked viewer; modified clicks retain browser link behavior.
HTML remains sandboxed. Download uses the existing encrypted stream/save flow.

## Validation commands

Run from this worktree, with the accepted dependency installation linked as
node_modules and no production credentials inherited. All checks
remain serialized and use one worker via codex-heavy:

```sh
codex-heavy --label owner-full-files-check -- \
  env PATH=/usr/local/bin:/usr/bin:/bin \
  PLAYWRIGHT_MODULE=/tmp/working-hours-browser/node_modules/playwright/index.mjs \
  OWNER_FILES_SCREENSHOTS=/tmp/owner-full-files-browser \
  sh scripts/owner-files-check.sh
```

The script runs full check (client + server), then real required-encrypted
maintenance with fake credentials, then browser desktop/mobile. New Vitest
controls cover explicit config/default denial, hidden/private/outside-root
canaries, symlinks, identity replacement, FIFO/device/pseudo rejection, key
physical validation, proof gating, metadata/HTML/PPTX mock/download/range,
logout, liveness after open, bounded append, and app link routing.
Browser fixture covers URL/login/unlock/reload/new tab, download, hidden files,
symlink, HTML sandbox, conversation links/draft, and Lock. PPTX HTTP acceptance
mocks conversion; existing converter tests remain in full check.

## Exact future rollout scope and prerequisites

Do not publish before the above checks and diff review pass. Do not reuse an
old accepted security seal or the old Files release. Capture a fresh manifest
and baseline immediately before preparing this release; the other worker may
have published unrelated NEW client changes. If the client/source has advanced,
integrate those source changes and rerun affected checks instead of overwriting.

Expected changed backend allowlist (verify actual compiler output against the
installed 90 backend files, abort on any extra delta):

- config.js + .map
- file-policy.js + .map
- secure-key.js + .map
- secure-api.js + .map (only key-policy argument)
- server-files.js + .map
- directory-listing.js + .map
- http-app.js + .map
- pptx-preview.js + .map

Publish the complete matching client, retaining old hashed assets; index.html
last. Matching maintenance scripts: `scripts/secure-maintenance.mjs`,
`scripts/secure-key.mjs`, `scripts/remote-instance/prestart.mjs` only.
The key CLI is published for compatibility; **do not invoke init/rotate**.
No dependency change or full dist-server copy.

Only two env fields change in the NEW private instance.env, with all other
values preserved in memory and no secret logging:

```dotenv
CODEX_REMOTE_SECURE_API=required # existing value, must remain required
CODEX_REMOTE_FILE_ACCESS=owner-full
CODEX_REMOTE_FILE_ROOTS=/
```

Runtime preparation must guard exact env preimage, all replaced artifact hashes,
all excluded backend bytes, current frontend identity, key dev/ino/size/mtime/
ctime/mode/uid, old/new process lifetime, independent state paths, and prestart
helper identity. Back up artifact/env preimages privately; no database restore.
Hours JS must remain
`b763a0f7b74c0341684e196855e85b3f5e3b123915a373b27463c17916702e93`, map
`6a76da381331d7a802da5d844d341da742f0bfc3809f0cfe3b74370d55c42fb8`.
Publication never replaces Vault/native/history/session/Hours data; postverify
updates only the named task/project notes and Services through the API. No
Nginx/preview changes or old-instance artifact replacement. Preserve the existing key identity.

The watcher must be scoped to **codex-remote-secure.service**, port **5174**,
origin **https://remote.danhkhai.io.vn**, NEW instance.env and NEW marker.
**Stock restart-when-idle.mjs hardcodes the OLD service and old marker: never run
it blindly.** Reuse its reviewed `restartReadiness` helper and two ALL-thread /
zero-pending checks five seconds apart, plus a fresh check immediately before
mutation/restart. Freeze/load the old maintenance/config import closure and
old config before replacing files; it must still authenticate the current
required-encrypted gateway while waiting. If drift, abort without overwriting.
The NEW-only runner is `scripts/owner-files-release/deploy.mjs`, using the frozen
original `restartReadiness`/maintenance/config closure. Apply, recovery verify
and explicit code-only rollback share a private deployment lock. Actual
publication/verification also acquires the existing host-wide cooperative
`/root/.local/state/codex-remote/deployment.lock`; a foreign/stale owner is
never reclaimed automatically.

Only after fresh PID, unchanged old PID/runtime/config, both Hours hashes,
unchanged key identity, local/public health + HTML + entry asset bytes,
authenticated encrypted harmless `/etc/hosts` metadata/content comparison,
and cookie-only denial pass may a NEW deployment marker say complete. Avoid any
smoke of actual secrets. Update NEW Services metadata and Vault through NEW CLI.
Existing tabs need Reload for the Open/link UI.

## Current continuation (task 17468a2b)

Full Access/network are now available. Native receipt at 2026-09-23T10:27:05.885Z:
`gpt-6-astra / xhigh`, sandbox `danger-full-access`, approval `never`.
The previous workspace-write/network blocker is historical and superseded.

The candidate also incorporates the two already-live menu/login commits
0b6c787/1424647 (cherry-picked as 072d003/f19bda3), preserving the current UI. It also retains the live PWA first-controller-claim
fix aed96d8 (022071e here); first claim does not reload away the RAM unlock.
Browser acceptance caught a mobile CSS rule hiding Open; the narrow-screen
link is now visible. Fixtures use disposable credentials/files/native messages,
never a model turn or production file payload. Hours acceptance is read-only;
its fixture rewrites only the dashboard path in a separate temporary build,
never in the release client. Actual Hours JS/map/source/template remain intact.

See the current private delivery/checks JSON for exact executed commands,
counts, screenshot hashes and outcome. Do not interpret an earlier failed log
as the latest receipt, or a prepared release as live. Actual Safari/iOS hardware
is not covered by Chromium viewport tests.

## NEW-only release commands and recovery

Run all preparation/check scans through codex-heavy. Use a fresh immutable
release directory after committing/pushing the final source; do not reuse an
old seal. The helper requires a clean tracked tree and exactly the 16 compiled
backend files listed above; matching dependency lock/package must be unchanged.

```sh
# From the task worktree; checks.json contains verified test receipts only.
RELEASE=/root/.local/state/codex-remote-secure/releases/owner-files-COMMIT
codex-heavy --label owner-files-stage -- /usr/local/bin/node \
  scripts/owner-files-release/deploy.mjs prepare "$RELEASE" /PRIVATE/checks.json
codex-heavy --label owner-files-preflight -- /usr/local/bin/node \
  "$RELEASE/deploy.mjs" check "$RELEASE"
# check validates bytes/config/startup and reports readiness; it never restarts.
systemd-run --unit=codex-remote-secure-owner-files-COMMIT --collect \
  --property=UMask=0077 --property=MemoryMax=512M --property=RuntimeMaxSec=14h \
  --property=WorkingDirectory="$RELEASE" \
  /usr/bin/env -i PATH=/usr/local/bin:/usr/bin:/bin \
  /usr/local/bin/node "$RELEASE/deploy.mjs" apply "$RELEASE"
```

The runner performs complete/zero-pending readiness twice five seconds apart
and again immediately before publication and ordinary NEW-only restart. Any
turn arriving during publication must finish before restart. Source/config/
key/process/excluded-byte drift aborts. OLD is inspected only, never targeted.
The operator must end their active NEW turn after arming so it can become idle.
No stock watcher command targeting codex-remote.service is invoked.

The private backup contains code/client/config preimages only, never database,
native/Vault/history/Hours data or a key copy. Publication writes only the exact
allowlist, retains previous hashed assets, changes the two Files env fields and
publishes index last. Frozen original maintenance still works while the old
NEW-instance process is running. Ordinary future restart retains the key.

Marker: `/root/.local/state/codex-remote-secure/owner-files-deploy.json`.
`complete` requires fresh NEW PID; excluded bytes, OLD, key and Hours preserved;
local/public health, HTML and entry asset SHA; encrypted harmless `/etc/hosts`
read and cookie-only403; NEW Services and checked-revision knowledge updates.
No actual secret payload is used as a file smoke.

If postverification failed after publication/restart, inspect marker/evidence
and service lifetime; do not rerun apply or restore state. A scoped retry is:

```sh
/usr/local/bin/node "$RELEASE/deploy.mjs" verify "$RELEASE"
```

For a reviewed code regression, explicit `rollback "$RELEASE"` validates sealed
preimages and old/new-only installed bytes, waits for ALL NEW turns idle again,
restores only code/client/env and restarts only NEW. It never restores data or
regenerates a key. It is not automatic. A SIGKILL may leave the lock directory;
verify its owning unit/process is gone before removing that exact empty lock.
Unknown mutation outcomes require inspecting marker/runtime before choosing
verify or rollback. Keep the worktree while the source baseline is guarded.

Existing tabs need Reload to receive Open/link changes. No provision/rotation,
old-instance retirement, Nginx/preview changes, or model turn is part of this
release. Full owner Files deliberately lets an unlocked owner read secret files;
login, proof, encryption and preview boundaries still apply.
