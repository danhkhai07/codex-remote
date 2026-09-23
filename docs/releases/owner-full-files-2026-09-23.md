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

## Validation commands — NOT recorded as passed

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
No Vault/native/history/session/Hours data mutation, Nginx/preview changes or
old-instance artifact replacement. Preserve the existing key identity.

The watcher must be scoped to **codex-remote-secure.service**, port **5174**,
origin **https://remote.danhkhai.io.vn**, NEW instance.env and NEW marker.
**Stock restart-when-idle.mjs hardcodes the OLD service and old marker: never run
it blindly.** Reuse its reviewed `restartReadiness` helper and two ALL-thread /
zero-pending checks five seconds apart, plus a fresh check immediately before
mutation/restart. Freeze/load the old maintenance/config import closure and
old config before replacing files; it must still authenticate the current
required-encrypted gateway while waiting. If drift, abort without overwriting.
A tested new-service-specific watcher/runner and built/sealed manifest remain a
prerequisite, not an artifact fabricated in this blocked environment.

Only after fresh PID, unchanged old PID/runtime/config, both Hours hashes,
unchanged key identity, local/public health + HTML + entry asset bytes,
authenticated encrypted harmless `/etc/hosts` metadata/content comparison,
and cookie-only denial pass may a NEW deployment marker say complete. Avoid any
smoke of actual secrets. Update NEW Services metadata and Vault through NEW CLI.
Existing tabs need Reload for the Open/link UI.

## Current execution limitation

Sandbox is workspace-write/network-restricted with approval never.
`codex-heavy` failed before execution: read-only `/var/log/codex-heavy`.
NEW encrypted knowledge CLI failed `connect EPERM 127.0.0.1:5174`.
`systemctl show` failed `Failed to connect to bus: Operation not permitted`.
No permission bypass attempted. Full tests/build/browser have **not run**; no
release payload/seal, arm/restart, live file smoke, Services or Vault write.
Git push is also blocked: `Could not resolve hostname github.com: Temporary
failure in name resolution`. Only source, fixtures and this exact rollout
contract are prepared. The current
native receipt reports `gpt-6-astra` / `xhigh`; do not label it max.
