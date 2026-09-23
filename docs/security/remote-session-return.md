# Returning to the secure app: confirmed cause and bounded fix

Task 9f0d77ec-4990-44cb-ac00-53646aa8f91a. New worktree from deployed lineage
4de7808e2438c523b0e233c10e3f566c932b8e6a (application10f52e9).
No modification of CR3's mobile/menu/SecureGate checkout or production.

## Evidence, not an assumption that cookies disappear

Live5174's configured session TTL is604800 seconds (7 days). No session token or
owner key was fetched for this investigation. `server/auth.ts:90` sets persistent
Max-Age, HttpOnly, SameSite=Strict and Secure on HTTPS; the secure hostname uses a
host-only cookie. `server/secure-client.ts:8,27-33` retains the imported owner key
only in the current JavaScript instance. `src/SecureGate.tsx:13-19` starts at
Unlock on every new page. `src/secureApi.ts:65-75` broadcasts explicit Lock/logout;
there is no automatic visibility/background timer that clears the key.

An isolated real Chromium persistent profile with a390x844 mobile viewport,
actual Gate/transport/HTTP server/SessionRegistry and only generated fake secrets
shows: frozen->active keeps access; page reload, close/reopen tab, and complete
browser close/reopen retain the exact cookie but discard the RAM key. Entering
only the unlock key restores access; a repeated password is unnecessary. This is
not proof of the user's precise device state: mobile OS process eviction has the
same RAM lifetime consequence, but Safari/iOS was not tested. Cross-site opening
may omit Strict cookies for navigation; same-origin API fetches then send them.
No change to SameSite or cookie TTL is justified by this evidence.

## Fixed independently: avoid first-install PWA reload

The prior controllerchange handler reloaded even on the first service-worker
claim, discarding an already entered RAM key. `src/pwaController.ts` tracks whether
the page was previously controlled: first claim keeps the existing page; replacing
an existing controller still flushes screen state and reloads once. This is a
concrete secondary cause of needless unlock, not a complete solution to cold
reopening a RAM-only app. No key persistence or authentication bypass was added.

The browser fixture runs the exact previous small controllerchange behavior with
RETURN_LEGACY_CONTROLLER=1 and the new helper normally: first claim loses the key
before, retains it after. An actual second worker activated by SKIP_WAITING still
reloads exactly once in both. Existing browser fixtures now wait for controller
ownership rather than relying on an unnecessary first-install reload.

## CR3 / leader integration

Cherry-pick this branch's focused changes onto the combined mobile/menu candidate,
then build the complete matching client. There is no backend module delta and no
backend restart needed for this fix. Do not copy this worktree's standalone client
over CR3's current UI. SecureGate.tsx/styles/App are not edited here.

Suggested Gate copy for CR3: distinguish “Mở khóa dữ liệu” from password login and
explain that a valid login can remain while the RAM key is gone. Do not switch to
password login on every401: a wrong encryption proof can also return401. Do not
classify every network failure as logout or clear drafts. A future explicit typed
challenge/session error can guide the login phase; no plaintext private API probe
or weakening of proof is proposed.

## Pending product/security decision: durable trusted browser

A question with two options has been sent: add explicit “Tin cậy thiết bị này”
(default off), or retain RAM-only keys and ask for the key on cold open. No answer
was received when this report was prepared. This is a choice about durable key
capability, not another generic code/deployment approval. Cold reopen without
entering a key remains unimplemented; do not report the whole user complaint fixed.

If chosen, the bounded design is an opt-in nonextractable HKDF CryptoKey stored by
IndexedDB structured clone under exact origin/app/key-generation, maximum7 days
and no later than the authenticated session expiry, with no sliding extension.
It must never store raw owner-key text or password in local/sessionStorage. A new
page must pass migration readiness, fetch fresh setup, validate TTL/generation,
perform a fresh cookie-bound proof and authenticate session before mounting any
private UI or decrypting cached content. Cookie expiry/revocation and key rotation
must not silently reuse a remembered key with a later session.

Explicit Lock/logout/forget-device must remove durable capability and invalidate
concurrent saves/restores across tabs. Gate unmount or ordinary page exit must
only clear RAM; it must not be confused with explicit forget. Storage failure,
blocked IDB, stale async operations and unknown outcomes must fail closed. A
synchronous nonsecret revocation marker plus bounded transactional lifecycle can
prevent a queued stale save resurrecting trust; test crash/2-tab/cleanup races.
Do not auto-renew trust or expose cached plaintext before fresh authorization.

This is browser-profile trust, **not** OS biometric/device-bound hardware storage:
nonextractable blocks export through WebCrypto, not use by same-origin XSS or a
compromised browser/profile. Remote per-device credential revocation independent
of session would require a distinct credential protocol/backend, not a claim this
client-only design provides it. Source: W3C Web Cryptography, key storage/security
considerations and CryptoKey serialization:
https://www.w3.org/TR/webcrypto/#security-considerations
https://www.w3.org/TR/webcrypto/#cryptokey-interface

## Checks and limits

All heavy commands via codex-heavy sequentially, one worker/heap1024MiB:
- build:server for isolated fixture only; no production build.
- Real browser before/after plus reload/tab/browser reopen/background, two-tab
  Lock, actual fake-key rotation rejection, logout-cookie replay401, expiry401.
-9 Vitest: secure migration/session registry/auth. Lint, typecheck, client build
  and PWA validation pass. Normal chunk-size warning remains.

Logs /tmp/cr2-remote-session-return-{baseline,fix,before-after}.log. Fake native
model calls/effects zero. Browser processes/profile/server cleaned in finally.
No real password/key/session in logs, screenshots, Git or Vault. No backend
restart/deploy, old app changes, Hours mutations or Services updates.
