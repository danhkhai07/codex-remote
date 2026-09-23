# Contextual Web Push candidate

Candidate branch: `feat/contextual-web-push`. Review/integration only; no production
publication, service restart, real push or native model turn was performed.

## Behavior and privacy

- A completion snapshots the current explicit conversation name, group name,
  actual leader role and outcome. Native rename events update the loaded name.
  Group/role changes affect subsequent completions; retries retain the original
  event's snapshot. Workers never inherit their group's leader label.
- Names are sanitized and capped at 80/60 Unicode code points. The thread ID is
  restricted to 1–128 ASCII letters, digits, underscore or hyphen. No answer,
  preview, turn ID, key or arbitrary destination URL enters the payload.
- Existing subscription ownership, revocation, expiry, visibility heartbeat,
  completion deduplication and per-device coalescing remain in force. Legacy
  queued deliveries show the generic fallback. Preserve the private push state
  and VAPID keys; this feature requires no subscription reset or migration.
- A click sends the ID to a top-level root app through an acknowledged worker
  message. The app reads the thread through its existing encrypted API before
  switching. The owner gate remains mandatory. Locked/cold apps retain the ID
  in a URL fragment until unlock. Missing targets produce a recoverable error.
- Existing clients retain their document, per-conversation drafts and active
  turns. A newer manual selection wins over a pending lookup. Standalone Files/
  Hours pages and nested frames are not navigation targets. An incompatible old
  app opens a new root app window after the bounded acknowledgement timeout.

## Verified source baseline and publication boundary

The live NEW frontend matched `9ca8c1855633135d095ddec0c8c8c90b3b5f5e5b` from
`/root/WORKTREES/cr-remove-browser-external-hint`. The publication directory is
`/root/RUNNING-SERVICES/codex-remote-secure`, not a Git checkout. Its owner Files
backend matched source `8aedf3e7da9b8779a3da7db9dfc6ee0ec253ec12` from
`/root/WORKTREES/cr-owner-full-files-access` (89/90 JS/map bytes; the sole original
difference was `event-hub.js.map`). Baseline commit `51e7785` reconciles those
already-live owner Files sources without reverting the newer client shared
secure-client helper/tests. It is separate from the push feature commit.

The **push backend publication delta is only** `controller.js`, `index.js`,
`push.js` and their three maps, plus the matched rebuilt frontend/service worker.
Do not bulk-copy `dist-server`: the newer browser-shared `secure-client.js`/map
and the historical `event-hub.js.map` also differ from live but are outside this
backend feature. Preserve Hours and other independently staged modules. Leader
must integrate concurrent frontend work, build the combined client and schedule
one NEW backend restart when idle. OLD is retired and must remain stopped.
Older workers show the generic body until the new service worker activates.

## Verification

Run sequentially through `codex-heavy` with `TMPDIR=/tmp`: `npm run check`, then
`PUSH_SCREENSHOTS=/tmp/contextual-push-evidence node scripts/contextual-push-browser.mjs`.
The browser fixture uses temporary fake keys, native RPCs, sessions and vault data
with the real owner gate, encrypted API, App and worker messaging. It covers cold
and locked targets, desktop/mobile, both drafts, active turn preservation and
missing-thread fallback. Synthetic clicks lack OS activation, so only the
privileged `WindowClient.focus()` is stubbed; routing and its acknowledgement are
real. No OS notification or physical iOS delivery is tested. Worker unit tests
separately verify display payload, suppression, safe openWindow fallback and
malformed input handling. Delivery tests include retry/restart, queued/in-flight
coalescing and owner/visibility invalidation.
