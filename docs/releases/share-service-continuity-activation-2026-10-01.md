# Share service continuity activation runner — prepared, not armed

Task `8217c4fa-6e9c-4a46-bcef-88fe14b660ac` prepares the NEW-only activation adapter for product source `cf292a496b6652cce378a75f9f7f4d98b9b7e69e`. Runner source starts from post-TLS preparation commit `d010cb038131a4971a80b6913736a67f0f21765b`. The package must remain **not armed and not applied** until CR1 resolves its independent review.

The only production publication is `dist-server/services.js`, its map, `scripts/services.mjs`, and replacement of the single existing `CODEX_REMOTE_PREVIEW_SHARE_PORTS` assignment with the ten exact ports `2345,5180,5210,5211,5212,5213,5215,5217,5221,5222`. It performs no client, Nginx, certificate, Services registry, grant, key, Hours, native-history or dependency write. The product process restarts exactly once after real ALL-idle, with no task exemption.

The sealed baseline binds the complete backend/client/script graphs; source tree and changed source blobs; payload; one-field environment patch; active Nginx symlink/target; ten-SAN certificate, private-key and renewal preimages; Services/grant/key file hashes and identities; complete isolated Hours files plus generator/adapter/template/backend; package lock and node_modules target; NEW/OLD service definitions, PID and lifetime. Activation takes a private backup of code/env/registry/grants under the shared publication lock. Registry and grants are evidence only and are never restored after startup.

The frozen `core.mjs` workflow checks encrypted metadata twice five seconds apart, locks, checks again before backup/publication, then checks all queues again before restart. The runner writes an exclusive attempt before entering the workflow. A crash or SIGKILL leaves that marker and blocks replay. Pre-publication drift requires a fresh package; after any publication use verify-only or a reviewed forward fix.

After restart, verification requires a new PID, public and loopback health, all ten public and loopback preview hosts returning the anonymous `401` boundary, encrypted read-only `/api/services` and `/api/preview-shares`, persisted registration IDs, unchanged registry/grants/Hours/key/client/TLS/dependencies and OLD still disabled. It creates no real share.

Prepared package and exact seal are recorded in the external delivery evidence. Future activation order, only after CR1 acceptance:

1. Run `runner.mjs check` and compare the exact reviewed seal.
2. Run `runner.mjs arm SEAL_SHA256`; this writes only the package arm receipt.
3. Start `runner.mjs apply` through `codex-heavy` in a detached NEW-only unit. It waits for ALL-idle itself; do not exempt the initiating task.
4. Trust LIVE only after `verified.json`. If publication occurred but verification failed, restore service availability and use `runner.mjs verify`; never rerun apply or restore the saved registry/grants.

Checks are scoped to the runner: environment allowlist, fake ALL-idle lifecycle, immediate/locked drift, exclusive attempt and a real child SIGKILL between attempt and completion. Existing product source/browser/server evidence is reused unchanged; this task does not rerun or reinterpret CR1's independent review.

## Prepared receipt

Package: `/root/.local/state/codex-remote-secure/releases/share-service-continuity-activation-8217c4fa`. Runner source `6fd245eb86f19113e0cfe91fd8f27fc0f508619e`; seal SHA-256 `4db62fcd62fbefe67d65ab01f867f993842bf8b595bab9145a18185765844338`. The read-only package check observed NEW PID `1923100`, OLD disabled, all ten public/local TLS endpoints auth-gated, and readiness `busy=2`, `queued=2`, so no activation was attempted. There is no `armed.json`, `apply-attempt.json`, backup, restart intent or verified marker.
