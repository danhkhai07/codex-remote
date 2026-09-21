# Migration readiness contract (CR2 / future encrypted unlock)

Import `ensurePreviewMigrationReady` from `src/legacyPreviewWorkers`.
`await ensurePreviewMigrationReady()` is the initial single-flight barrier.
`await ensurePreviewMigrationReady(true)` rechecks immediately before a login,
credential derivation/unlock or session-restoration path which can restore secrets.
Never swallow a rejection or interpret timeout as ready. Show the error and retry
from the same action; do not send a password, derive/unseal sensitive local keys,
restore a session snapshot, open authenticated SSE, or expose decrypted data first.
There is no localStorage "migration complete" flag or checkbox-based bypass.

`PreviewMigrationGate` wraps all root pages BEFORE children mount, including their
cached-session restore effects. `api.session` awaits the barrier; `api.login`
rechecks. An encrypted API transport must preserve these awaits when replacing
those calls and add the recheck to any direct unlock path. No encryption protocol
is implemented here. Any new server-side authentication route must retain the
LoginRateLimiter.beginAttempt admission/finish contract, trusted IP resolution and
Retry-After behavior; transport encryption must not become a limiter bypass. This module does not import api.ts (no dependency cycle).

The inspector uses `/migration-check-sw.js`, scope `/__codex_migration__/`, and
MessageChannel protocol `CHECK_LEGACY_CLIENTS_V1` / `{type:'LEGACY_CLIENTS_V1',count}`.
It has no fetch handler, cache writes, clients.claim or root-worker replacement.
It counts same-origin window clients including uncontrolled ones at `/preview[/]`
and `/workboard[/]`. The app closes its own legacy iframes; it does not navigate or
close arbitrary user tabs. Scope unregister is awaited and verified, known legacy
CacheStorage response URLs are deleted without deleting app caches/drafts/storage.
Rejections and 8-second timeouts block with retry. No SW API means enumeration is
unavailable; it is NOT a claim that no legacy clients exist.

The result assumes the app/worker code loaded is trustworthy. URL detection is a
best-effort known-residue check within the current browser storage partition.
Unrelated-scope/root-worker replacement, arbitrary caches/IndexedDB,
other profiles/devices and open hostile same-origin code are not proven absent.
The browser fixture deliberately demonstrates an old document controlled by an arbitrary-scope worker reading a
fresh fake session after URL detection: it MUST NOT be reported as fixed by this
helper. Preserve-URL rollout therefore requires a NEW browser profile before new
credentials are entered; no acknowledgement checkbox counts as evidence. A new
admin origin remains a deployment parameter pending the user's decision.

References:
- https://developer.mozilla.org/en-US/docs/Web/API/Clients/matchAll
- https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/unregister
